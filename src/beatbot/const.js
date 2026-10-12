// -----------------------------------------------------------------------------
// Beatbot cloud constants.
//
// Ported from the official Python client published by Beatbot Robotics
// (github.com/Beatbot-Robotics/beatbot-cloud-python, Apache-2.0), which is the
// reference implementation of this "open API": same URLs, same paths, same
// capability keys. Keep them in sync with it when Beatbot changes its cloud.
// -----------------------------------------------------------------------------

export const HTTP_TIMEOUT_MS = 30_000;

export const OAUTH2_AUTHORIZE_URL = 'https://oauth.beatbot.com/oauth2/authorize';
export const OAUTH2_TOKEN_URL = 'https://oauth.beatbot.com/oauth2/token';
// The public OAuth client Beatbot publishes in its open-source library. A
// public client (PKCE, no secret): the config can override it if Beatbot
// issues a dedicated one.
export const DEFAULT_OAUTH2_CLIENT_ID = 'home-assistant';
export const OAUTH2_SCOPE = 'device:info';

// The access token carries a `region` claim: the account lives in ONE region,
// and calling another one would route the traffic to the wrong backend.
export const REGION_API_BASE_URL = {
  eu: 'https://eu-iot.beatbot.com',
  na: 'https://na-iot.beatbot.com',
  cn: 'https://cn-iot.beatbot.com',
};
export const REGIONS = Object.keys(REGION_API_BASE_URL);

export const DEVICES_PATH = '/openapi/v1/ha';
export const DEVICE_STATES_PATH = '/openapi/v1/ha/state';
export const DEVICE_ACTIONS_PATH = '/openapi/v1/ha';
export const EVENTS_PATH = '/openapi/v1/ha/ws';
export const RESULT_SUCCESS_CODE = 200;

// Capability keys (`interfaceInfo`) a device advertises at discovery. States
// are reported under the same keys; actions are POSTed with them.
export const INTERFACE = {
  VACUUM_STATE: 'vacuum.state',
  VACUUM_BATTERY: 'vacuum.battery',
  SENSOR_ERROR: 'sensor.error',
  WORK_MODE: 'select.work_mode',
  CHILD_LOCK: 'switch.child_lock',
  VOICE_DISTURB: 'switch.voice_disturb',
  START: 'vacuum.start',
  PAUSE: 'vacuum.pause',
  RETURN_TO_BASE: 'vacuum.return_to_base',
};

// WebSocket close codes the Beatbot event stream uses.
export const WS_CLOSE = {
  TOKEN_REJECTED: 4001, // refresh the token once, then reconnect
  REPLACED: 4002, // a newer connection of the same account took over
  FORBIDDEN: 4003, // the account lost its authorization
};
