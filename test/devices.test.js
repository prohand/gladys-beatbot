import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES } from '@gladysassistant/integration-sdk';
import { applyStates, parseDevice } from '../src/beatbot/client.js';
import {
  FEATURE,
  buildDevice,
  commandFor,
  deviceIdOf,
  featureKeysOf,
  isSupported,
  statesOf,
} from '../src/devices/poolRobot.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { rawDevice } from './helpers/fakeBeatbot.js';

const gladys = createFakeGladys();

const robot = (overrides) => {
  const model = parseDevice(rawDevice(overrides));
  applyStates(model, {
    'vacuum.state': 5,
    'vacuum.battery': 64,
    'sensor.error': 0,
    'select.work_mode': 1,
    'switch.child_lock': true,
    'switch.voice_disturb': false,
  });
  return model;
};

const feature = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));

test('a fully featured pool robot exposes every feature, with stable external ids', () => {
  const device = buildDevice(gladys, robot());
  assert.equal(device.external_id, 'ext:beatbot-test:beatbot:dev-1');
  assert.equal(device.name, 'AquaSense 2 Ultra');
  assert.equal(device.should_poll, false);
  assert.deepEqual(featureKeysOf(robot()), [
    FEATURE.STATE,
    FEATURE.RUN_MODE,
    FEATURE.DOCK,
    FEATURE.BATTERY,
    FEATURE.CHARGING,
    FEATURE.WORK_MODE,
    FEATURE.CHILD_LOCK,
    FEATURE.VOICE_MUTE,
  ]);
  assert.equal(feature(device, 'state').external_id, 'ext:beatbot-test:beatbot:dev-1:state');
  assert.ok(device.params.some((p) => p.name === 'firmware' && p.value === '1.2.3'));
});

test('every feature declares min and max (NOT NULL in Gladys)', () => {
  for (const f of buildDevice(gladys, robot()).features) {
    assert.equal(typeof f.min, 'number', f.external_id);
    assert.equal(typeof f.max, 'number', f.external_id);
  }
});

test('controls follow the advertised capabilities', () => {
  const device = buildDevice(gladys, robot());
  assert.equal(feature(device, FEATURE.RUN_MODE).read_only, false);
  assert.equal(feature(device, FEATURE.CHILD_LOCK).read_only, false);
  assert.equal(feature(device, FEATURE.VOICE_MUTE).read_only, true, 'nonControllable');

  const stateOnly = buildDevice(
    gladys,
    robot({ capabilities: [{ interfaceInfo: 'vacuum.state', retrievable: true }] }),
  );
  assert.equal(feature(stateOnly, FEATURE.RUN_MODE).read_only, true);
  assert.equal(feature(stateOnly, FEATURE.DOCK), undefined, 'no return_to_base advertised');
  assert.equal(feature(stateOnly, FEATURE.WORK_MODE), undefined);
  assert.equal(feature(stateOnly, FEATURE.CHILD_LOCK), undefined);
});

test('the cleaning mode is a dynamic select whose options are the device labels', () => {
  const workMode = feature(buildDevice(gladys, robot()), FEATURE.WORK_MODE);
  assert.equal(workMode.category, DEVICE_FEATURE_CATEGORIES.TEXT);
  assert.deepEqual(
    workMode.supported_options.map((o) => o.value),
    ['Floor', 'Walls', 'Waterline'],
  );
});

test('a base station has no battery', () => {
  const station = robot({ productCategory: 'clean_base_station', capabilities: [] });
  const keys = featureKeysOf(station);
  assert.ok(!keys.includes(FEATURE.BATTERY));
  assert.ok(!keys.includes(FEATURE.CHARGING));
  assert.equal(isSupported(station), true);
  assert.equal(isSupported(robot({ productCategory: 'lawn_mower' })), false);
});

test('states are published for the values known, and only those', () => {
  const states = statesOf(gladys, robot());
  const byKey = Object.fromEntries(
    states.map((s) => [s.device_feature_external_id.split(':').at(-1), s]),
  );
  assert.equal(byKey.state.state, 1, 'RUNNING');
  assert.equal(byKey['run-mode'].state, 1);
  assert.equal(byKey.dock.state, 0);
  assert.equal(byKey.battery.state, 64);
  assert.equal(byKey.charging.state, 0);
  assert.deepEqual(byKey['work-mode'].text, 'Walls');
  assert.equal(byKey['child-lock'].state, 1);
  assert.equal(byKey['voice-mute'].state, 0);

  const fresh = parseDevice(rawDevice());
  assert.deepEqual(statesOf(gladys, fresh), [], 'nothing read yet: nothing published');
});

test('a charging robot is docked, charging and not cleaning', () => {
  const model = robot();
  applyStates(model, { 'vacuum.state': 2 });
  const byKey = Object.fromEntries(
    statesOf(gladys, model).map((s) => [s.device_feature_external_id.split(':').at(-1), s.state]),
  );
  assert.equal(byKey.state, 5, 'CHARGING');
  assert.equal(byKey.charging, 1);
  assert.equal(byKey.dock, 1);
  assert.equal(byKey['run-mode'], 0);
});

test('Gladys commands translate to Beatbot actions', () => {
  const model = robot();
  assert.deepEqual(commandFor(model, FEATURE.RUN_MODE, 1), {
    type: 'action',
    interfaceInfo: 'vacuum.start',
  });
  assert.deepEqual(commandFor(model, FEATURE.RUN_MODE, 0), {
    type: 'action',
    interfaceInfo: 'vacuum.pause',
  });
  assert.deepEqual(commandFor(model, FEATURE.DOCK, 1), {
    type: 'action',
    interfaceInfo: 'vacuum.return_to_base',
  });
  assert.deepEqual(commandFor(model, FEATURE.DOCK, 0), { type: 'none' });
  assert.deepEqual(commandFor(model, FEATURE.WORK_MODE, 'Waterline'), {
    type: 'work_mode',
    label: 'Waterline',
  });
  assert.deepEqual(commandFor(model, FEATURE.CHILD_LOCK, 0), {
    type: 'switch',
    interfaceInfo: 'switch.child_lock',
    on: false,
  });
});

test('commands the device does not offer are refused', () => {
  const model = robot();
  assert.throws(() => commandFor(model, FEATURE.VOICE_MUTE, 1), /does not accept/);
  assert.throws(() => commandFor(model, FEATURE.WORK_MODE, 'Turbo'), /Unknown cleaning mode/);
  assert.throws(() => commandFor(model, FEATURE.BATTERY, 1), /read-only/);
  const stateOnly = robot({ capabilities: [{ interfaceInfo: 'vacuum.state' }] });
  assert.throws(() => commandFor(stateOnly, FEATURE.RUN_MODE, 1), /does not accept/);
});

test('deviceIdOf reads the Beatbot id back from an external id', () => {
  assert.equal(deviceIdOf(gladys, 'ext:beatbot-test:beatbot:dev-1'), 'dev-1');
  assert.equal(deviceIdOf(gladys, 'ext:beatbot-test:other:dev-1'), null);
  assert.equal(deviceIdOf(gladys, undefined), null);
});
