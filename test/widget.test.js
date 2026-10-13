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
    'set_cleaning_mode',
  ]);
  model.workStatus = 5;
  model.errorCode = 1 << 18;
  let content = await widget.get(service, { settings: { robot: DEVICE } });
  assert.deepEqual(validateWidgetContent(content), []);
  model.errorCode = 0;
  content = await widget.get(service, { settings: { robot: DEVICE } });
  assert.deepEqual(buttons(content), ['pause', 'return_to_base', 'set_cleaning_mode']);
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

test('the Cleaning mode button lists the advertised modes, pre-filled with the current one', async () => {
  const { service } = await startedService();
  const content = await widget.get(service, { settings: { robot: DEVICE } });
  assert.deepEqual(validateWidgetContent(content), []);
  const button = content.components.find((c) => c.action?.key === 'set_cleaning_mode');
  assert.deepEqual(button.action.params, { device: DEVICE });
  const [field] = button.action.fields;
  assert.equal(field.type, 'select');
  assert.equal(field.required, true);
  assert.deepEqual(
    field.options.map((option) => option.value),
    ['Floor', 'Walls', 'Waterline'],
  );
  assert.equal(field.default, 'Floor');
  assert.ok(content.components.filter((c) => c.type === 'button').length <= 4);
  service.stop();
});

test('no Cleaning mode button when the cloud reports the mode as not controllable', async () => {
  const { service } = await startedService();
  const model = service.modelOf(DEVICE);
  model.capabilities['select.work_mode'].nonControllable = true;
  const content = await widget.get(service, { settings: { robot: DEVICE } });
  assert.ok(!buttons(content).includes('set_cleaning_mode'));
  service.stop();
});

test('the Cleaning mode form sets the mode through the scene action path', async () => {
  const { service, cloud } = await startedService();
  const toast = await widget.action(service, {
    actionKey: 'set_cleaning_mode',
    params: { device: DEVICE },
    values: { mode: 'Walls' },
  });
  assert.equal(toast.en, 'Cleaning mode set to Walls.');
  assert.equal(service.modelOf(DEVICE).workMode, 1, 'the new mode is reflected at once');
  assert.deepEqual(cloud.actions.at(-1), {
    deviceId: 'dev-1',
    interfaceInfo: 'select.work_mode',
    label: 'Walls',
  });

  const refused = await widget.action(service, {
    actionKey: 'set_cleaning_mode',
    params: { device: DEVICE },
    values: { mode: 'Turbo' },
  });
  assert.match(refused.en, /does not accept that cleaning mode/);
  service.stop();
});

test('a tap relayed without values (core older than 5.2) changes nothing', async () => {
  const { service } = await startedService();
  const before = service.modelOf(DEVICE).workMode;
  const toast = await widget.action(service, {
    actionKey: 'set_cleaning_mode',
    params: { device: DEVICE },
  });
  assert.match(toast.en, /Gladys 5\.2/);
  for (const lang of ['fr', 'de', 'es']) {
    assert.ok(toast[lang], lang);
  }
  assert.equal(service.modelOf(DEVICE).workMode, before);
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

// Every multi-language object of a content (labels, values, texts) carries the
// four languages of the Gladys interface.
function multiLanguageTexts(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((item) => multiLanguageTexts(item, out));
  } else if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      out.push(node);
    } else {
      Object.values(node).forEach((value) => multiLanguageTexts(value, out));
    }
  }
  return out;
}

test('every widget text is written in English, French, German and Spanish', async () => {
  const { service } = await startedService();
  const content = await widget.get(service, { settings: { robot: DEVICE } });
  const unknown = await widget.get(service, {
    settings: { robot: 'ext:beatbot-test:beatbot:nope' },
  });
  const texts = multiLanguageTexts([content, unknown]);
  assert.ok(texts.length > 5);
  for (const text of texts) {
    for (const lang of ['en', 'fr', 'de', 'es']) {
      assert.ok(text[lang], `${text.en} needs ${lang}`);
    }
  }
  service.stop();
});

test('refreshWidgets nudges every declared widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.widgetRefreshes, Object.keys(WIDGETS));
});
