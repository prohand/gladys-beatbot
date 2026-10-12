import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, TOKEN_KEYS, normalizeConfig } from '../src/config.js';

test('an empty config gets the defaults and no tokens', () => {
  const config = normalizeConfig();
  assert.equal(config.region, DEFAULT_CONFIG.region);
  assert.equal(config.client_id, DEFAULT_CONFIG.client_id);
  assert.equal(config.refresh_interval, DEFAULT_CONFIG.refresh_interval);
  assert.deepEqual(config.tokens, {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    region: null,
    account: null,
  });
});

test('values sent as strings by the form are typed and bounded', () => {
  const config = normalizeConfig({ region: 'EU', refresh_interval: '2', client_id: '  my-app ' });
  assert.equal(config.region, 'eu');
  assert.equal(config.refresh_interval, 5, 'clamped to the minimum');
  assert.equal(config.client_id, 'my-app');
  assert.equal(normalizeConfig({ refresh_interval: '600' }).refresh_interval, 60);
  assert.equal(normalizeConfig({ refresh_interval: 'abc' }).refresh_interval, 10);
});

test('an unknown region falls back to automatic', () => {
  assert.equal(normalizeConfig({ region: 'mars' }).region, 'auto');
});

test('the tokens are read from their off-schema keys', () => {
  const config = normalizeConfig({
    [TOKEN_KEYS.ACCESS_TOKEN]: 'a',
    [TOKEN_KEYS.REFRESH_TOKEN]: 'r',
    [TOKEN_KEYS.EXPIRES_AT]: '1234',
    [TOKEN_KEYS.REGION]: 'na',
    [TOKEN_KEYS.ACCOUNT]: '',
  });
  assert.deepEqual(config.tokens, {
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: 1234,
    region: 'na',
    account: null,
  });
});
