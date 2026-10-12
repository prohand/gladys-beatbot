// -----------------------------------------------------------------------------
// Beatbot REST client (region-aware), port of beatbot_cloud/client.py.
//
// Every answer is an envelope `{ code, message, data }`, `code: 200` meaning
// success; `data` is sometimes a JSON string rather than an object, so it is
// parsed again when needed.
// -----------------------------------------------------------------------------

import {
  DEVICE_ACTIONS_PATH,
  DEVICE_STATES_PATH,
  DEVICES_PATH,
  EVENTS_PATH,
  HTTP_TIMEOUT_MS,
  INTERFACE,
  REGION_API_BASE_URL,
  RESULT_SUCCESS_CODE,
} from './const.js';
import { BeatbotAuthError, BeatbotConnectionError } from './errors.js';

const parseMaybeJson = (raw) => {
  if (typeof raw !== 'string') {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * A fresh device model from a discovery entry, runtime values unknown until
 * the first state read. `null` for an entry without id.
 */
export function parseDevice(raw) {
  const deviceId = raw?.deviceId;
  if (!deviceId || typeof deviceId !== 'string') {
    return null;
  }
  const capabilities = {};
  const workModeOptions = new Map();
  for (const capability of Array.isArray(raw.capabilities) ? raw.capabilities : []) {
    const key = capability?.interfaceInfo;
    if (!key) {
      continue;
    }
    capabilities[key] = {
      retrievable: Boolean(capability.retrievable),
      proactivelyReported: Boolean(capability.proactivelyReported),
      nonControllable: Boolean(capability.nonControllable),
    };
    if (key === INTERFACE.WORK_MODE) {
      const configuration = parseMaybeJson(capability.configuration);
      for (const option of configuration?.options ?? []) {
        if (option?.value !== undefined && option?.value !== null && option?.label) {
          workModeOptions.set(Number(option.value), String(option.label));
        }
      }
    }
  }
  return {
    deviceId,
    productId: raw.productId ?? '',
    productCategory: raw.productCategory ?? '',
    name: raw.name ?? '',
    model: raw.model ?? '',
    versions: (Array.isArray(raw.versions) ? raw.versions : [])
      .filter((v) => v && typeof v === 'object')
      .map((v) => ({ channel: v.channel ?? 0, version: v.version ?? '' })),
    isOnline: Boolean(raw.isOnline),
    capabilities,
    workModeOptions,
    // Runtime state: null = not read yet.
    workStatus: null,
    workMode: null,
    errorCode: 0,
    batteryLevel: null,
    childLock: null,
    voiceDisturb: null,
  };
}

// interfaceInfo -> field of the device model.
const STATE_FIELDS = {
  [INTERFACE.VACUUM_STATE]: 'workStatus',
  [INTERFACE.VACUUM_BATTERY]: 'batteryLevel',
  [INTERFACE.SENSOR_ERROR]: 'errorCode',
  [INTERFACE.WORK_MODE]: 'workMode',
  [INTERFACE.CHILD_LOCK]: 'childLock',
  [INTERFACE.VOICE_DISTURB]: 'voiceDisturb',
};

/**
 * Apply runtime values (keyed by interfaceInfo) to a device model.
 * @returns {string[]} the fields that actually changed.
 */
export function applyStates(device, states, isOnline) {
  const changed = [];
  for (const [key, value] of Object.entries(states ?? {})) {
    const field = STATE_FIELDS[key];
    if (!field || value === undefined) {
      continue;
    }
    // The switches arrive as booleans, 0/1 or "on"/"off" depending on the path.
    const normalized =
      field === 'childLock' || field === 'voiceDisturb'
        ? value === true || value === 1 || value === 'on'
        : Number(value);
    if (field !== 'childLock' && field !== 'voiceDisturb' && !Number.isFinite(normalized)) {
      continue;
    }
    if (device[field] !== normalized) {
      device[field] = normalized;
      changed.push(field);
    }
  }
  if (typeof isOnline === 'boolean' && device.isOnline !== isOnline) {
    device.isOnline = isOnline;
    changed.push('isOnline');
  }
  return changed;
}

export class BeatbotClient {
  /**
   * @param {object} options
   * @param {string} options.region one of REGION_API_BASE_URL keys
   * @param {() => Promise<string>} options.getAccessToken
   * @param {(rejectedToken: string) => Promise<string>} [options.refreshAccessToken]
   *   called once when the cloud answers 401, before giving up
   * @param {typeof fetch} [options.fetchImpl]
   */
  constructor({ region, getAccessToken, refreshAccessToken, fetchImpl = fetch }) {
    const baseUrl = REGION_API_BASE_URL[region];
    if (!baseUrl) {
      throw new Error(`Unknown or missing Beatbot region: ${region}`);
    }
    this.region = region;
    this.baseUrl = baseUrl;
    this.getAccessToken = getAccessToken;
    this.refreshAccessToken = refreshAccessToken;
    this.fetchImpl = fetchImpl;
  }

  /** The WebSocket endpoint of the account's event stream. */
  get eventStreamUrl() {
    return `${this.baseUrl.replace(/^https:\/\//, 'wss://')}${EVENTS_PATH}`;
  }

  async request(method, path, body) {
    const accessToken = await this.getAccessToken();
    try {
      return await this.requestWith(accessToken, method, path, body);
    } catch (err) {
      // An access token can die before its announced expiry (revoked, clock
      // skew): one refresh, one retry, then the error stands.
      if (!(err instanceof BeatbotAuthError) || !this.refreshAccessToken) {
        throw err;
      }
      const fresh = await this.refreshAccessToken(accessToken);
      return this.requestWith(fresh, method, path, body);
    }
  }

  async requestWith(accessToken, method, path, body) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      throw new BeatbotConnectionError(`Beatbot cloud unreachable: ${err.message}`);
    }

    let text;
    try {
      text = await response.text();
    } catch (err) {
      throw new BeatbotConnectionError(`Beatbot cloud answer lost: ${err.message}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new BeatbotAuthError(`Unauthorized: ${response.status}`);
    }
    if (response.status >= 400) {
      throw new BeatbotConnectionError(`API request failed: ${response.status}`);
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new BeatbotConnectionError(`API returned non-JSON response (${response.status})`);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BeatbotConnectionError('API returned an invalid response envelope');
    }
    if (payload.code !== RESULT_SUCCESS_CODE) {
      throw new BeatbotConnectionError(`API error ${payload.code}: ${payload.message ?? ''}`);
    }
    return payload.data;
  }

  /** Devices of the account, with their capabilities. */
  async getDevices() {
    const raw = await this.request('GET', DEVICES_PATH);
    if (!raw) {
      return [];
    }
    const discovery = parseMaybeJson(raw);
    if (discovery === null) {
      throw new BeatbotConnectionError('Invalid discovery payload');
    }
    return (discovery?.devices ?? []).map(parseDevice).filter(Boolean);
  }

  /** Runtime state of every device: `{ [deviceId]: { isOnline, states } }`. */
  async getDeviceStates() {
    const payload = parseMaybeJson(await this.request('GET', DEVICE_STATES_PATH));
    const result = {};
    for (const device of payload?.devices ?? []) {
      if (device?.deviceId) {
        result[device.deviceId] = { isOnline: device.isOnline, states: device.states ?? {} };
      }
    }
    return result;
  }

  /** Runtime state of one device: `{ isOnline, states }`. */
  async getDeviceState(deviceId) {
    const payload = parseMaybeJson(
      await this.request('GET', `${DEVICE_ACTIONS_PATH}/${encodeURIComponent(deviceId)}/state`),
    );
    if (!payload || typeof payload !== 'object') {
      return { isOnline: undefined, states: {} };
    }
    return { isOnline: payload.isOnline, states: payload.states ?? {} };
  }

  /** A parameterless action: `vacuum.start`, `vacuum.pause`, `vacuum.return_to_base`. */
  async sendAction(deviceId, interfaceInfo) {
    await this.request('POST', `${DEVICE_ACTIONS_PATH}/${encodeURIComponent(deviceId)}/actions`, {
      interfaceInfo,
    });
  }

  /** Set the work mode by its advertised LABEL (that is what the cloud expects). */
  async setWorkMode(deviceId, label) {
    await this.request('POST', `${DEVICE_ACTIONS_PATH}/${encodeURIComponent(deviceId)}/actions`, {
      interfaceInfo: INTERFACE.WORK_MODE,
      label,
    });
  }

  /** Turn an on/off capability on or off. */
  async setSwitch(deviceId, interfaceInfo, on) {
    await this.request('POST', `${DEVICE_ACTIONS_PATH}/${encodeURIComponent(deviceId)}/actions`, {
      interfaceInfo,
      label: on ? 'on' : 'off',
    });
  }
}
