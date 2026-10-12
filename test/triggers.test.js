import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStates, parseDevice } from '../src/beatbot/client.js';
import { SceneTriggerTracker, TRIGGER } from '../src/capabilities/triggers.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { rawDevice } from './helpers/fakeBeatbot.js';

const DEVICE = 'ext:beatbot-test:beatbot:dev-1';

function setup(initial = { 'vacuum.state': 3, 'sensor.error': 0, 'vacuum.battery': 90 }) {
  let now = 0;
  const tracker = new SceneTriggerTracker(createFakeGladys(), () => now);
  const model = parseDevice(rawDevice());
  applyStates(model, initial);
  const step = (states, minutes = 0) => {
    now += minutes * 60_000;
    applyStates(model, states);
    return tracker.observe(model);
  };
  return { tracker, model, step };
}

test('the first look only sets the baseline', () => {
  const { tracker, model } = setup({ 'vacuum.state': 5, 'sensor.error': 1 << 18 });
  assert.deepEqual(tracker.observe(model), []);
});

test('nothing read yet: nothing observed', () => {
  const tracker = new SceneTriggerTracker(createFakeGladys());
  assert.deepEqual(tracker.observe(parseDevice(rawDevice())), []);
});

test('a status change fires status_changed with the previous status', () => {
  const { tracker, model, step } = setup();
  tracker.observe(model);
  assert.deepEqual(step({ 'vacuum.state': 12 }), [
    {
      key: TRIGGER.STATUS_CHANGED,
      data: { device: DEVICE, status: 'cleaning', previous_status: 'docked', detail: 'diving' },
    },
  ]);
  assert.deepEqual(step({ 'vacuum.state': 5 }), [], 'diving -> cleaning: same simple status');
});

test('a full cycle fires cleaning_finished with its duration and battery', () => {
  const { tracker, model, step } = setup();
  tracker.observe(model);
  step({ 'vacuum.state': 5 });
  step({ 'vacuum.state': 4 }, 10); // paused: the cycle holds
  step({ 'vacuum.state': 5 }, 5);
  const events = step({ 'vacuum.state': 7, 'vacuum.battery': 35 }, 75);
  const finished = events.find((e) => e.key === TRIGGER.CLEANING_FINISHED);
  assert.deepEqual(finished.data, { device: DEVICE, duration_minutes: 90, battery: 35 });
  assert.deepEqual(tracker.lastFinishedOf('dev-1'), { at: 90 * 60_000, durationMinutes: 90 });
  assert.equal(
    step({ 'vacuum.state': 16 }).filter((e) => e.key === TRIGGER.CLEANING_FINISHED).length,
    0,
    'one event per cycle',
  );
});

test('a cycle already running at start-up finishes without a duration', () => {
  const { tracker, model, step } = setup({ 'vacuum.state': 5, 'sensor.error': 0 });
  tracker.observe(model);
  const finished = step({ 'vacuum.state': 8 }, 30).find((e) => e.key === TRIGGER.CLEANING_FINISHED);
  assert.equal(finished.data.duration_minutes, null);
});

test('a fault fires error_raised once per new fault, and is no finished cleaning', () => {
  const { tracker, model, step } = setup();
  tracker.observe(model);
  step({ 'vacuum.state': 5 });
  const events = step({ 'vacuum.state': 0, 'sensor.error': 1 << 18 }, 20);
  assert.deepEqual(
    events.map((e) => e.key),
    [TRIGGER.STATUS_CHANGED, TRIGGER.ERROR_RAISED],
  );
  assert.deepEqual(events[1].data, {
    device: DEVICE,
    error: 'trapped',
    label_en: 'Robot stuck',
    label_fr: 'Robot coincé',
  });
  assert.deepEqual(
    step({ 'sensor.error': (1 << 18) | 1 }).map((e) => e.data.error),
    ['dust_box_full'],
    'only the new bit',
  );
  assert.deepEqual(
    step({ 'sensor.error': 0 }).map((e) => e.key),
    [TRIGGER.STATUS_CHANGED],
  );
});
