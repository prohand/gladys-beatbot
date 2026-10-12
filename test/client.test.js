import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BeatbotClient, applyStates, parseDevice } from '../src/beatbot/client.js';
import { BeatbotAuthError, BeatbotConnectionError } from '../src/beatbot/errors.js';
import { createFakeBeatbot, rawDevice } from './helpers/fakeBeatbot.js';

function setup(region = 'eu') {
  const cloud = createFakeBeatbot({ region });
  let token = cloud.seedTokens().access_token;
  const refreshed = [];
  const client = new BeatbotClient({
    region,
    getAccessToken: async () => token,
    refreshAccessToken: async (rejected) => {
      refreshed.push(rejected);
      token = cloud.seedTokens().access_token;
      return token;
    },
    fetchImpl: cloud.fetch,
  });
  return { cloud, client, refreshed, setToken: (t) => (token = t) };
}

test('an unknown region is refused rather than guessed', () => {
  assert.throws(() => new BeatbotClient({ region: 'mars', getAccessToken: async () => 't' }));
});

test('the event stream URL follows the region', () => {
  const { client } = setup('na');
  assert.equal(client.eventStreamUrl, 'wss://na-iot.beatbot.com/openapi/v1/ha/ws');
});

test('discovery parses capabilities and the work mode options', async () => {
  const { client } = setup();
  const [device] = await client.getDevices();
  assert.equal(device.deviceId, 'dev-1');
  assert.equal(device.productCategory, 'pool_clean_bot');
  assert.equal(device.isOnline, true);
  assert.deepEqual(
    [...device.workModeOptions.entries()],
    [
      [0, 'Floor'],
      [1, 'Walls'],
      [2, 'Waterline'],
    ],
  );
  assert.equal(device.capabilities['switch.voice_disturb'].nonControllable, true);
  assert.equal(device.capabilities['vacuum.start'].nonControllable, false);
  assert.equal(device.workStatus, null, 'no runtime value before a state read');
});

test('discovery also accepts its data as a JSON string, and skips entries without id', async () => {
  const { cloud, client } = setup();
  cloud.discoveryAsString = true;
  cloud.devices.push({ name: 'no id' });
  const devices = await client.getDevices();
  assert.equal(devices.length, 1);
});

test('batched and single states are read', async () => {
  const { client } = setup();
  const all = await client.getDeviceStates();
  assert.equal(all['dev-1'].states['vacuum.battery'], 87);
  const one = await client.getDeviceState('dev-1');
  assert.equal(one.isOnline, true);
  assert.equal(one.states['vacuum.state'], 3);
});

test('actions are posted with their interface key (and label)', async () => {
  const { cloud, client } = setup();
  await client.sendAction('dev-1', 'vacuum.start');
  await client.setWorkMode('dev-1', 'Walls');
  await client.setSwitch('dev-1', 'switch.child_lock', true);
  assert.deepEqual(cloud.actions, [
    { deviceId: 'dev-1', interfaceInfo: 'vacuum.start' },
    { deviceId: 'dev-1', interfaceInfo: 'select.work_mode', label: 'Walls' },
    { deviceId: 'dev-1', interfaceInfo: 'switch.child_lock', label: 'on' },
  ]);
});

test('a 401 refreshes the token once and retries', async () => {
  const { client, refreshed, setToken } = setup();
  setToken('revoked-token');
  const devices = await client.getDevices();
  assert.equal(devices.length, 1);
  assert.deepEqual(refreshed, ['revoked-token']);
});

test('errors are classified: auth vs connection', async () => {
  const { cloud, client } = setup();
  cloud.apiFailure = 403;
  await assert.rejects(client.getDevices(), BeatbotAuthError);
  cloud.apiFailure = 500;
  await assert.rejects(client.getDevices(), BeatbotConnectionError);
  cloud.apiFailure = 'network';
  await assert.rejects(client.getDevices(), BeatbotConnectionError);
});

test('an envelope with a code other than 200 is an error', async () => {
  const client = new BeatbotClient({
    region: 'eu',
    getAccessToken: async () => 't',
    fetchImpl: async () => new Response(JSON.stringify({ code: 500, message: 'boom' })),
  });
  await assert.rejects(client.getDevices(), /API error 500: boom/);
  const html = new BeatbotClient({
    region: 'eu',
    getAccessToken: async () => 't',
    fetchImpl: async () => new Response('<html>'),
  });
  await assert.rejects(html.getDevices(), /non-JSON/);
});

test('applyStates normalizes values and reports what changed', () => {
  const device = parseDevice(rawDevice());
  assert.deepEqual(
    applyStates(device, { 'vacuum.state': 5, 'switch.child_lock': 'on', 'unknown.key': 1 }, false),
    ['workStatus', 'childLock', 'isOnline'],
  );
  assert.equal(device.childLock, true);
  assert.deepEqual(applyStates(device, { 'vacuum.state': 5 }), [], 'same value, no change');
  assert.deepEqual(applyStates(device, { 'vacuum.battery': 'n/a' }), [], 'garbage ignored');
});
