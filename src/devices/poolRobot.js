// -----------------------------------------------------------------------------
// Device type: BEATBOT POOL ROBOT (and its cleaning base station).
//
// One Gladys device per Beatbot device of the account. Its features follow
// what the device ADVERTISES (the discovery `capabilities`), never what its
// category is assumed to support: a command the cloud did not announce is not
// offered, a capability flagged `nonControllable` is shown read-only.
//
// Feature keys end up in external ids, which Gladys keys history, scenes and
// dashboards on: they are forever, never rename one.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { INTERFACE } from '../beatbot/const.js';
import {
  BATTERY_CATEGORIES,
  GLADYS_RUN_MODE,
  GLADYS_VACUUM_STATE,
  PRODUCT_CATEGORY,
  SUPPORTED_CATEGORIES,
  decodeStatus,
  gladysStateOf,
} from '../beatbot/protocol.js';

// External id type: ext:<selector>:beatbot:<deviceId>[:<feature>]
export const DEVICE_TYPE = 'beatbot';

export const FEATURE = {
  STATE: 'state',
  RUN_MODE: 'run-mode',
  DOCK: 'dock',
  BATTERY: 'battery',
  CHARGING: 'charging',
  WORK_MODE: 'work-mode',
  CHILD_LOCK: 'child-lock',
  VOICE_MUTE: 'voice-mute',
};

// Raw statuses during which the robot is heading home or already there.
const DOCK_STATES = new Set([
  GLADYS_VACUUM_STATE.RETURNING_TO_DOCK,
  GLADYS_VACUUM_STATE.CHARGING,
  GLADYS_VACUUM_STATE.DOCKED,
]);

export const isSupported = (model) => SUPPORTED_CATEGORIES.includes(model.productCategory);

export const hasCapability = (model, key) => Boolean(model.capabilities?.[key]);

/** The device advertises the capability AND lets it be driven. */
export const canControl = (model, key) =>
  hasCapability(model, key) && !model.capabilities[key].nonControllable;

export const deviceExternalId = (gladys, deviceId) =>
  gladys.externalIds(DEVICE_TYPE, deviceId).device;

/** The Beatbot device id behind a Gladys device external id, or null. */
export function deviceIdOf(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  return typeof externalId === 'string' && externalId.startsWith(prefix)
    ? externalId.slice(prefix.length) || null
    : null;
}

export function defaultName(model) {
  if (model.name) {
    return model.name;
  }
  if (model.model) {
    return `Beatbot ${model.model}`;
  }
  return model.productCategory === PRODUCT_CATEGORY.CLEAN_BASE_STATION
    ? 'Beatbot base station'
    : 'Beatbot pool robot';
}

function featureList(model) {
  const runControllable = canControl(model, INTERFACE.START) || canControl(model, INTERFACE.PAUSE);
  const list = [
    {
      key: FEATURE.STATE,
      name: 'State',
      category: DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER,
      type: DEVICE_FEATURE_TYPES.VACUUM_CLEANER.STATE,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 6,
    },
    {
      key: FEATURE.RUN_MODE,
      name: 'Cleaning',
      category: DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER,
      type: DEVICE_FEATURE_TYPES.VACUUM_CLEANER.RUN_MODE,
      read_only: !runControllable,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    },
  ];
  if (canControl(model, INTERFACE.RETURN_TO_BASE)) {
    list.push({
      key: FEATURE.DOCK,
      name: 'Return to base',
      category: DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER,
      type: DEVICE_FEATURE_TYPES.VACUUM_CLEANER.DOCK,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      min: 0,
      max: 1,
    });
  }
  if (BATTERY_CATEGORIES.includes(model.productCategory)) {
    list.push(
      {
        key: FEATURE.BATTERY,
        name: 'Battery',
        category: DEVICE_FEATURE_CATEGORIES.BATTERY,
        type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 100,
      },
      {
        key: FEATURE.CHARGING,
        name: 'Charging',
        category: DEVICE_FEATURE_CATEGORIES.BATTERY,
        type: DEVICE_FEATURE_TYPES.BATTERY.CHARGING,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 1,
      },
    );
  }
  if (model.workModeOptions?.size) {
    list.push({
      key: FEATURE.WORK_MODE,
      name: 'Cleaning mode',
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
      read_only: !canControl(model, INTERFACE.WORK_MODE),
      has_feedback: true,
      keep_history: false,
      min: 0,
      max: 0,
      // The cloud takes the mode by its label: the label is the value too.
      supported_options: [...model.workModeOptions.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, label], index) => ({ value: label, label, sort_order: index })),
    });
  }
  if (hasCapability(model, INTERFACE.CHILD_LOCK)) {
    list.push({
      key: FEATURE.CHILD_LOCK,
      name: 'Child lock',
      category: DEVICE_FEATURE_CATEGORIES.CHILD_LOCK,
      type: DEVICE_FEATURE_TYPES.CHILD_LOCK.BINARY,
      read_only: !canControl(model, INTERFACE.CHILD_LOCK),
      has_feedback: true,
      keep_history: false,
      min: 0,
      max: 1,
    });
  }
  if (hasCapability(model, INTERFACE.VOICE_DISTURB)) {
    list.push({
      key: FEATURE.VOICE_MUTE,
      name: 'Do not disturb (voice prompts off)',
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      read_only: !canControl(model, INTERFACE.VOICE_DISTURB),
      has_feedback: true,
      keep_history: false,
      min: 0,
      max: 1,
    });
  }
  return list;
}

/** The feature keys a device carries (for dispatch and the tests). */
export const featureKeysOf = (model) => featureList(model).map((f) => f.key);

/**
 * The discovery payload of one Beatbot device.
 */
export function buildDevice(gladys, model) {
  const ids = gladys.externalIds(DEVICE_TYPE, model.deviceId);
  const firmware = model.versions
    ?.map((v) => v.version)
    .filter(Boolean)
    .join(' / ');
  const params = [
    { name: 'model', value: model.model || '-' },
    { name: 'product_id', value: model.productId || '-' },
    { name: 'category', value: model.productCategory || '-' },
  ];
  if (firmware) {
    params.push({ name: 'firmware', value: firmware });
  }
  return {
    name: defaultName(model),
    external_id: ids.device,
    // Cloud push: no polling, the event stream and the periodic refresh
    // publish the states.
    should_poll: false,
    params,
    features: featureList(model).map(({ key, ...feature }) => ({
      ...feature,
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The current values of a device, as a publishStates batch. Values never read
 * yet are left out rather than published as a made-up 0.
 */
export function statesOf(gladys, model) {
  const ids = gladys.externalIds(DEVICE_TYPE, model.deviceId);
  const keys = new Set(featureKeysOf(model));
  const states = [];
  const push = (key, value) => {
    if (keys.has(key) && value !== null && value !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), ...value });
    }
  };

  if (model.workStatus !== null && model.workStatus !== undefined) {
    const gladysState = gladysStateOf(model);
    push(FEATURE.STATE, { state: gladysState });
    push(FEATURE.RUN_MODE, {
      state:
        gladysState === GLADYS_VACUUM_STATE.RUNNING
          ? GLADYS_RUN_MODE.CLEANING
          : GLADYS_RUN_MODE.IDLE,
    });
    push(FEATURE.DOCK, { state: DOCK_STATES.has(gladysState) ? 1 : 0 });
    push(FEATURE.CHARGING, {
      state: decodeStatus(model.productCategory, model.workStatus).status === 'charging' ? 1 : 0,
    });
  }
  if (model.batteryLevel !== null && model.batteryLevel !== undefined) {
    push(FEATURE.BATTERY, { state: Math.max(0, Math.min(100, Math.round(model.batteryLevel))) });
  }
  const workModeLabel = model.workModeOptions?.get(model.workMode);
  if (workModeLabel) {
    push(FEATURE.WORK_MODE, { text: workModeLabel });
  }
  if (model.childLock !== null && model.childLock !== undefined) {
    push(FEATURE.CHILD_LOCK, { state: model.childLock ? 1 : 0 });
  }
  if (model.voiceDisturb !== null && model.voiceDisturb !== undefined) {
    push(FEATURE.VOICE_MUTE, { state: model.voiceDisturb ? 1 : 0 });
  }
  return states;
}

/**
 * Translate a Gladys command into a Beatbot cloud call.
 * @returns {{ type: 'action', interfaceInfo: string }
 *   | { type: 'work_mode', label: string }
 *   | { type: 'switch', interfaceInfo: string, on: boolean }
 *   | { type: 'none' }}
 * @throws when the device does not offer that command
 */
export function commandFor(model, featureKey, value) {
  const require = (key) => {
    if (!canControl(model, key)) {
      throw new Error(`${defaultName(model)} does not accept "${key}"`);
    }
  };
  switch (featureKey) {
    case FEATURE.RUN_MODE: {
      const key = Number(value) === GLADYS_RUN_MODE.CLEANING ? INTERFACE.START : INTERFACE.PAUSE;
      require(key);
      return { type: 'action', interfaceInfo: key };
    }
    case FEATURE.DOCK:
      if (Number(value) !== 1) {
        return { type: 'none' };
      }
      require(INTERFACE.RETURN_TO_BASE);
      return { type: 'action', interfaceInfo: INTERFACE.RETURN_TO_BASE };
    case FEATURE.WORK_MODE: {
      require(INTERFACE.WORK_MODE);
      const label = String(value);
      if (![...(model.workModeOptions?.values() ?? [])].includes(label)) {
        throw new Error(`Unknown cleaning mode "${label}"`);
      }
      return { type: 'work_mode', label };
    }
    case FEATURE.CHILD_LOCK:
      require(INTERFACE.CHILD_LOCK);
      return { type: 'switch', interfaceInfo: INTERFACE.CHILD_LOCK, on: Number(value) === 1 };
    case FEATURE.VOICE_MUTE:
      require(INTERFACE.VOICE_DISTURB);
      return { type: 'switch', interfaceInfo: INTERFACE.VOICE_DISTURB, on: Number(value) === 1 };
    default:
      throw new Error(`Feature "${featureKey}" is read-only`);
  }
}
