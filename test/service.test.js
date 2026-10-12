import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES, POST_COMMAND_REFRESH_MS, BeatbotService } from '../src/service.js';
import { TOKEN_KEYS, normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  createFakeBeatbot,
  createFakeWebSocketClass,
  flush,
  makeJwt,
  rawDevice,
} from './helpers/fakeBeatbot.js';

const DEVICE = 'ext:beatbot-test:beatbot:dev-1';
const F = (key) => `${DEVICE}:${key}`;

function setup({ linked = true, raw = {} } = {}) {
  const cloud = createFakeBeatbot();
  const tokens = linked ? cloud.seedTokens() : null;
  const gladys = createFakeGladys({
    config: tokens
      ? {
          [TOKEN_KEYS.ACCESS_TOKEN]: tokens.access_token,
          [TOKEN_KEYS.REFRESH_TOKEN]: tokens.refresh_token,
          [TOKEN_KEYS.REGION]: 'eu',
          ...raw,
        }
      : raw,
  });
  const WebSocketImpl = createFakeWebSocketClass();
  let changes = 0;
  const config = normalizeConfig(gladys.config);
  const service = new BeatbotService({
    gladys,
    getConfig: () => config,
    onChange: () => (changes += 1),
    fetchImpl: cloud.fetch,
    WebSocketImpl,
  });
  return { cloud, gladys, service, WebSocketImpl, changes: () => changes };
}

const sendEvent = (ws, n, deviceId, interfaceInfo, value) =>
  ws.send({
    eventId: `e${n}`,
    type: 'properties_changed',
    deviceId,
    payload: { interfaceInfo, value },
  });

test('without a linked account, the Configuration screen asks to connect', async () => {
  const { service, gladys, WebSocketImpl } = setup({ linked: false });
  await service.start();
  assert.deepEqual(gladys.connectionStatuses, [{ connected: false, message: MESSAGES.NOT_LINKED }]);
  assert.equal(WebSocketImpl.instances.length, 0);
});

test('an account without region claim nor chosen region is reported, never guessed', async () => {
  const { service, gladys } = setup({
    raw: { [TOKEN_KEYS.REGION]: '', [TOKEN_KEYS.ACCESS_TOKEN]: makeJwt({ sub: 'no-region' }) },
  });
  await service.start();
  assert.deepEqual(gladys.connectionStatuses.at(-1), {
    connected: false,
    message: MESSAGES.UNKNOWN_REGION,
  });
});

test('start: discovery, states, transport badges, connection status, event stream', async () => {
  const { service, gladys, WebSocketImpl } = setup();
  await service.start();

  assert.equal(gladys.discovered.length, 1);
  assert.equal(gladys.discovered[0][0].external_id, DEVICE);
  assert.equal(gladys.lastState(F('state')).state, 6, 'charge_done -> DOCKED');
  assert.equal(gladys.lastState(F('battery')).state, 87);
  assert.equal(gladys.lastState(F('work-mode')).text, 'Floor');
  assert.deepEqual(gladys.transports, [{ external_id: DEVICE, transport: 'cloud' }]);
  assert.deepEqual(gladys.connectionStatuses, [{ connected: true, message: undefined }]);
  assert.equal(gladys.sceneEvents.length, 0, 'start-up only sets the baseline');

  const ws = WebSocketImpl.last();
  assert.equal(ws.url, 'wss://eu-iot.beatbot.com/openapi/v1/ha/ws');
  service.stop();
});

test('unsupported categories are left out of the discovery', async () => {
  const { service, gladys, cloud } = setup();
  cloud.devices.push(rawDevice({ deviceId: 'mower', productCategory: 'lawn_mower' }));
  await service.start();
  assert.deepEqual(
    gladys.discovered[0].map((d) => d.external_id),
    [DEVICE],
  );
  service.stop();
});

test('pushed events update the states, fire scene events and nudge the widget', async () => {
  const { service, gladys, WebSocketImpl, changes } = setup();
  await service.start();
  const ws = WebSocketImpl.last();
  ws.open();
  const before = changes();

  sendEvent(ws, 1, 'dev-1', 'vacuum.state', 5);
  await flush();
  assert.equal(gladys.lastState(F('state')).state, 1, 'RUNNING');
  assert.equal(gladys.lastState(F('run-mode')).state, 1);
  assert.deepEqual(gladys.sceneEvents.at(-1), {
    key: 'status_changed',
    data: { device: DEVICE, status: 'cleaning', previous_status: 'docked', detail: 'cleaning' },
  });
  assert.ok(changes() > before);

  ws.send({ eventId: 'e2', type: 'status', deviceId: 'dev-1', payload: { online: false } });
  await flush();
  assert.deepEqual(gladys.transports.at(-1), { external_id: DEVICE, transport: 'unreachable' });
  service.stop();
});

test('a reconnection of the stream reads every state back', async () => {
  const { service, cloud, WebSocketImpl } = setup();
  await service.start();
  WebSocketImpl.last().open();
  await flush();
  const reads = () => cloud.requests.filter((r) => r.path === '/openapi/v1/ha/state').length;
  const before = reads();
  // Second connection of the same stream object = a reconnection.
  service.stream.hasConnected = true;
  WebSocketImpl.last().onopen();
  await flush();
  assert.equal(reads(), before + 1);
  service.stop();
});

test('a Gladys command sends the action, then reads the device back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { service, gladys, cloud } = setup();
  await service.start();
  const device = gladys.discovered[0][0];
  const runMode = device.features.find((f) => f.external_id === F('run-mode'));

  await service.setValue(device, runMode, 1);
  assert.deepEqual(cloud.actions.at(-1), { deviceId: 'dev-1', interfaceInfo: 'vacuum.start' });

  cloud.states['dev-1'].states['vacuum.state'] = 5;
  t.mock.timers.tick(POST_COMMAND_REFRESH_MS);
  await flush();
  assert.equal(gladys.lastState(F('state')).state, 1);
  service.stop();
});

test('a new cleaning mode and a switch show at once', async () => {
  const { service, gladys, cloud } = setup();
  await service.start();
  const device = gladys.discovered[0][0];
  const feature = (key) => device.features.find((f) => f.external_id === F(key));

  await service.setValue(device, feature('work-mode'), 'Waterline');
  assert.deepEqual(cloud.actions.at(-1), {
    deviceId: 'dev-1',
    interfaceInfo: 'select.work_mode',
    label: 'Waterline',
  });
  assert.equal(gladys.lastState(F('work-mode')).text, 'Waterline');

  await service.setValue(device, feature('child-lock'), 1);
  assert.equal(gladys.lastState(F('child-lock')).state, 1);
  await assert.rejects(service.setValue(device, feature('voice-mute'), 1), /does not accept/);
  service.stop();
});

test('scene and widget helpers answer false for an order the robot cannot take', async () => {
  const { service, cloud } = setup();
  cloud.devices = [rawDevice({ capabilities: [{ interfaceInfo: 'vacuum.state' }] })];
  await service.start();
  assert.equal(await service.runAction(DEVICE, 'vacuum.start'), false);
  assert.equal(await service.runAction('ext:beatbot-test:beatbot:ghost', 'vacuum.start'), false);
  assert.equal(await service.runWorkMode(DEVICE, 'Floor'), false);
  assert.equal(cloud.actions.length, 0);
  service.stop();
});

test('runWorkMode matches the mode name without case', async () => {
  const { service, cloud } = setup();
  await service.start();
  assert.equal(await service.runWorkMode(DEVICE, ' walls '), true);
  assert.equal(cloud.actions.at(-1).label, 'Walls');
  service.stop();
});

test('a dead authorization stops everything and asks to connect again', async () => {
  const { service, gladys, cloud, WebSocketImpl } = setup({
    raw: { [TOKEN_KEYS.ACCESS_TOKEN]: makeJwt({ sub: 'x', region: 'eu' }) },
  });
  cloud.refreshFailure = 'auth';
  await service.start();
  assert.deepEqual(gladys.connectionStatuses.at(-1), {
    connected: false,
    message: MESSAGES.AUTH_LOST,
  });
  assert.equal(WebSocketImpl.instances.length, 0);
  assert.equal(service.client, null);
});

test('an unreachable cloud is reported and retried by the stream and the timer', async () => {
  const { service, gladys, cloud, WebSocketImpl } = setup();
  cloud.apiFailure = 'network';
  await service.start();
  assert.deepEqual(gladys.connectionStatuses.at(-1), {
    connected: false,
    message: MESSAGES.UNREACHABLE,
  });
  assert.equal(WebSocketImpl.instances.length, 1, 'stream still started');

  cloud.apiFailure = null;
  assert.equal(await service.sync({ discover: true }), 'ok');
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
  service.stop();
});

test('the OAuth callback links the account and starts the service', async () => {
  const { service, gladys } = setup({ linked: false });
  await service.start();
  const url = new URL(service.getAuthorizeUrl('https://gladys.local/cb'));
  await service.completeAuthorization({
    code: 'good-code',
    state: url.searchParams.get('state'),
    redirectUri: 'https://gladys.local/cb',
  });
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
  assert.equal(gladys.discovered.length, 1);
  assert.ok(gladys.config[TOKEN_KEYS.REFRESH_TOKEN]);
  service.stop();
});

test('device_added events trigger one discovery after the burst', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { service, gladys, cloud, WebSocketImpl } = setup();
  await service.start();
  const ws = WebSocketImpl.last();
  ws.open();
  cloud.devices.push(rawDevice({ deviceId: 'dev-2', name: 'Second' }));
  cloud.states['dev-2'] = { isOnline: true, states: { 'vacuum.state': 0 } };
  ws.send({
    eventId: 'a1',
    type: 'device_added',
    deviceId: 'dev-2',
    payload: { deviceId: 'dev-2' },
  });
  ws.send({
    eventId: 'a2',
    type: 'device_added',
    deviceId: 'dev-2',
    payload: { deviceId: 'dev-2' },
  });
  await flush();
  t.mock.timers.tick(2_000);
  await flush();
  assert.equal(gladys.discovered.length, 2);
  assert.equal(gladys.discovered[1].length, 2);
  service.stop();
});
