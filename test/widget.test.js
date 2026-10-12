import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { POOL_ROBOT_WIDGET, WIDGETS, refreshWidgets } from '../src/capabilities/widget.js';
import { BeatbotService } from '../src/service.js';
import { TOKEN_KEYS, normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeBeatbot, createFakeWebSocketClass } from './helpers/fakeBeatbot.js';

const DEVICE = 'ext:beatbot-test:beatbot:dev-1';
const widget = WIDGETS[POOL_ROBOT_WIDGET];

async function startedService({ linked = true } = {}) {
  const cloud = createFakeBeatbot();
  const tokens = linked ? cloud.seedTokens() : null;
  const gladys = createFakeGladys({
    config: tokens
      ? {
          [TOKEN_KEYS.ACCESS_TOKEN]: tokens.access_token,
          [TOKEN_KEYS.REFRESH_TOKEN]: tokens.refresh_token,
        }
      : {},
  });
  const config = normalizeConfig(gladys.config);
  const service = new BeatbotService({
    gladys,
    getConfig: () => config,
    fetchImpl: cloud.fetch,
    WebSocketImpl: createFakeWebSocketClass(),
  });
  await service.start();
  return { service, cloud, gladys };
}

const buttons = (content) =>
  content.components.filter((c) => c.type === 'button').map((c) => c.action.key);

test('the content fits the core vocabulary and budget exactly', async () => {
  const { service } = await startedService();
  const content = await widget.get(service, { settings: { robot: DEVICE } });
  assert.deepEqual(validateWidgetContent(content), []);
  const battery = content.components.find((c) => c.type === 'value');
  assert.equal(battery.device_feature, `${DEVICE}:battery`, 'live tile bound to the feature');
  service.stop();
});

test('the buttons follow the robot: Start when idle, Pause when cleaning', async () => {
  const { service } = await startedService();
  const model = service.modelOf(DEVICE);
  assert.deepEqual(buttons(await widget.get(service, { settings: { robot: DEVICE } })), [
    'start',
    'return_to_base',
  ]);
  model.workStatus = 5;
  model.errorCode = 1 << 18;
  let content = await widget.get(service, { settings: { robot: DEVICE } });
  assert.deepEqual(validateWidgetContent(content), []);
  model.errorCode = 0;
  content = await widget.get(service, { settings: { robot: DEVICE } });
  assert.deepEqual(buttons(content), ['pause', 'return_to_base']);
  for (const key of buttons(content)) {
    const button = content.components.find((c) => c.action?.key === key);
    assert.deepEqual(button.action.params, { device: DEVICE });
  }
  service.stop();
});

test('a tapped button sends the order and answers a toast', async () => {
  const { service, cloud } = await startedService();
  const toast = await widget.action(service, {
    actionKey: 'return_to_base',
    params: { device: DEVICE },
  });
  assert.equal(toast.en, 'Order sent to the robot.');
  assert.deepEqual(cloud.actions.at(-1), {
    deviceId: 'dev-1',
    interfaceInfo: 'vacuum.return_to_base',
  });
  await assert.rejects(
    widget.action(service, { actionKey: 'self_destruct', params: { device: DEVICE } }),
    /Unknown widget action/,
  );
  service.stop();
});

test('an unknown robot or no account shows a short explanation', async () => {
  const { service } = await startedService();
  let content = await widget.get(service, { settings: { robot: 'ext:beatbot-test:beatbot:gone' } });
  assert.equal(content.components[0].type, 'text');
  assert.deepEqual(validateWidgetContent(content), []);

  const unlinked = await startedService({ linked: false });
  content = await widget.get(unlinked.service, { settings: {} });
  assert.match(content.components[0].text.en, /Link your Beatbot account/);
  service.stop();
  unlinked.service.stop();
});

test('refreshWidgets nudges every declared widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.widgetRefreshes, Object.keys(WIDGETS));
});
