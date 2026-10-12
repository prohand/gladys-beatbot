// -----------------------------------------------------------------------------
// Integration configuration.
//
// Two kinds of keys live in the Gladys config of the integration:
//   - the `config_schema` keys the user fills in (DEFAULT_CONFIG below, which
//     MUST mirror the manifest defaults — test/manifest.test.js checks it);
//   - the OAuth tokens, written by the integration itself through
//     `gladys.setConfig()` under keys OUTSIDE the schema: never shown in the
//     UI, never sent through the frontend.
// -----------------------------------------------------------------------------

import { DEFAULT_OAUTH2_CLIENT_ID, REGIONS } from './beatbot/const.js';

export const DEFAULT_CONFIG = {
  region: 'auto', // 'auto' (from the account) | 'eu' | 'na' | 'cn'
  client_id: DEFAULT_OAUTH2_CLIENT_ID,
  refresh_interval: 10, // minutes between two full state reconciliations
};

export const REFRESH_INTERVAL_BOUNDS = { min: 5, max: 60 };

// Off-schema keys owned by the integration (see src/beatbot/account.js).
export const TOKEN_KEYS = {
  ACCESS_TOKEN: 'oauth_access_token',
  REFRESH_TOKEN: 'oauth_refresh_token',
  EXPIRES_AT: 'oauth_expires_at',
  REGION: 'oauth_region',
  ACCOUNT: 'oauth_account',
};

const nonEmptyString = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * Merge the user config with the defaults and force the types (a form may
 * send numbers as strings).
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const region = String(raw.region ?? DEFAULT_CONFIG.region).toLowerCase();
  const interval = Number(raw.refresh_interval ?? DEFAULT_CONFIG.refresh_interval);
  const expiresAt = Number(raw[TOKEN_KEYS.EXPIRES_AT]);
  return {
    region: region === 'auto' || REGIONS.includes(region) ? region : DEFAULT_CONFIG.region,
    client_id: nonEmptyString(raw.client_id) ?? DEFAULT_CONFIG.client_id,
    refresh_interval: Number.isFinite(interval)
      ? Math.min(REFRESH_INTERVAL_BOUNDS.max, Math.max(REFRESH_INTERVAL_BOUNDS.min, interval))
      : DEFAULT_CONFIG.refresh_interval,
    tokens: {
      accessToken: nonEmptyString(raw[TOKEN_KEYS.ACCESS_TOKEN]),
      refreshToken: nonEmptyString(raw[TOKEN_KEYS.REFRESH_TOKEN]),
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
      region: nonEmptyString(raw[TOKEN_KEYS.REGION]),
      account: nonEmptyString(raw[TOKEN_KEYS.ACCOUNT]),
    },
  };
}
