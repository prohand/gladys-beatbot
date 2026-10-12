import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildAuthorizeUrl,
  createPkce,
  decodeAccessToken,
  exchangeCode,
  refreshTokens,
} from '../src/beatbot/oauth.js';
import { BeatbotAuthError, BeatbotConnectionError } from '../src/beatbot/errors.js';
import { createFakeBeatbot, makeJwt } from './helpers/fakeBeatbot.js';

test('the PKCE challenge is the S256 of the verifier', () => {
  const { verifier, challenge, state } = createPkce();
  assert.ok(verifier.length >= 43 && verifier.length <= 128, 'RFC 7636 verifier length');
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  assert.ok(state.length >= 16);
  assert.notEqual(createPkce().state, state, 'a new state every time');
});

test('the authorize URL carries the client, the redirect, the scope and the challenge', () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: 'home-assistant',
      redirectUri: 'https://gladys.local/oauth/callback',
      challenge: 'abc',
      state: 'xyz',
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://oauth.beatbot.com/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'home-assistant');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://gladys.local/oauth/callback');
  assert.equal(url.searchParams.get('scope'), 'device:info');
  assert.equal(url.searchParams.get('state'), 'xyz');
  assert.equal(url.searchParams.get('code_challenge'), 'abc');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('decodeAccessToken reads the claims and tolerates garbage', () => {
  assert.deepEqual(decodeAccessToken(makeJwt({ sub: 'a', region: 'eu' })), {
    sub: 'a',
    region: 'eu',
  });
  assert.equal(decodeAccessToken('not-a-jwt'), null);
  assert.equal(decodeAccessToken('a.bm90LWpzb24.c'), null);
  assert.equal(decodeAccessToken(undefined), null);
});

test('the code exchange sends the verifier and computes the expiry', async () => {
  const cloud = createFakeBeatbot();
  const tokens = await exchangeCode(
    { clientId: 'home-assistant', code: 'good-code', redirectUri: 'https://g/cb', verifier: 'v' },
    { fetchImpl: cloud.fetch, now: () => 1_000 },
  );
  assert.equal(tokens.refreshToken, 'refresh-1');
  assert.equal(tokens.expiresAt, 1_000 + 3600 * 1000);
  assert.deepEqual(cloud.tokenRequests[0], {
    grant_type: 'authorization_code',
    client_id: 'home-assistant',
    code: 'good-code',
    redirect_uri: 'https://g/cb',
    code_verifier: 'v',
  });
});

test('a refused grant is an auth error, an unavailable endpoint a connection error', async () => {
  const cloud = createFakeBeatbot();
  await assert.rejects(
    refreshTokens({ clientId: 'c', refreshToken: 'unknown' }, { fetchImpl: cloud.fetch }),
    BeatbotAuthError,
  );
  cloud.refreshFailure = 'server';
  await assert.rejects(
    refreshTokens({ clientId: 'c', refreshToken: 'x' }, { fetchImpl: cloud.fetch }),
    BeatbotConnectionError,
  );
  const offline = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(
    refreshTokens({ clientId: 'c', refreshToken: 'x' }, { fetchImpl: offline }),
    BeatbotConnectionError,
  );
});
