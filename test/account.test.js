import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BeatbotAccount, EXPIRY_MARGIN_MS } from '../src/beatbot/account.js';
import { BeatbotAuthError, BeatbotConnectionError } from '../src/beatbot/errors.js';
import { TOKEN_KEYS, normalizeConfig } from '../src/config.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeBeatbot, makeJwt } from './helpers/fakeBeatbot.js';

function setup({ raw = {}, now = () => 1_000_000 } = {}) {
  const cloud = createFakeBeatbot();
  const gladys = createFakeGladys();
  let config = normalizeConfig(raw);
  const account = new BeatbotAccount({
    gladys,
    getConfig: () => config,
    fetchImpl: cloud.fetch,
    now,
  });
  return { cloud, gladys, account, setConfig: (r) => (config = normalizeConfig(r)) };
}

const authorizeParams = (url) => new URL(url).searchParams;

test('a full sign-in stores the tokens, the region and the account id', async () => {
  const { gladys, account } = setup();
  const url = account.startAuthorization('https://gladys.local/cb');
  const state = authorizeParams(url).get('state');

  await account.completeAuthorization({
    code: 'good-code',
    state,
    redirectUri: 'https://gladys.local/cb',
  });

  assert.equal(account.linked, true);
  assert.equal(account.region, 'eu', 'read from the region claim');
  assert.equal(account.accountId, 'account-42');
  const stored = gladys.configWrites.at(-1);
  assert.equal(stored[TOKEN_KEYS.REFRESH_TOKEN], 'refresh-1');
  assert.equal(stored[TOKEN_KEYS.REGION], 'eu');
  assert.ok(stored[TOKEN_KEYS.ACCESS_TOKEN]);
});

test('a callback whose state does not match is refused', async () => {
  const { account } = setup();
  account.startAuthorization('https://gladys.local/cb');
  await assert.rejects(
    account.completeAuthorization({ code: 'good-code', state: 'forged' }),
    /state does not match/,
  );
  assert.equal(account.linked, false);
});

test('a callback without a sign-in in progress is refused', async () => {
  const { account } = setup();
  await assert.rejects(
    account.completeAuthorization({ code: 'good-code', state: 'x' }),
    /No sign-in in progress/,
  );
});

test('the region chosen in the config wins over the token claim', async () => {
  const { account, setConfig } = setup();
  const state = authorizeParams(account.startAuthorization('https://g/cb')).get('state');
  await account.completeAuthorization({ code: 'good-code', state, redirectUri: 'https://g/cb' });
  setConfig({ region: 'na' });
  assert.equal(account.region, 'na');
});

test('an access token about to expire is refreshed first; the rotated token is kept', async () => {
  let now = 1_000_000;
  const { cloud, gladys, account } = setup({ now: () => now });
  const seeded = cloud.seedTokens();
  account.load(
    normalizeConfig({
      [TOKEN_KEYS.ACCESS_TOKEN]: seeded.access_token,
      [TOKEN_KEYS.REFRESH_TOKEN]: seeded.refresh_token,
      [TOKEN_KEYS.EXPIRES_AT]: now + EXPIRY_MARGIN_MS + 1_000,
      [TOKEN_KEYS.REGION]: 'eu',
    }),
  );
  assert.equal(await account.getAccessToken(), seeded.access_token, 'still valid');

  now += 2_000; // inside the margin
  const fresh = await account.getAccessToken();
  assert.notEqual(fresh, seeded.access_token);
  assert.equal(account.tokens.refreshToken, 'refresh-2', 'rotated refresh token adopted');
  assert.equal(gladys.configWrites.at(-1)[TOKEN_KEYS.REFRESH_TOKEN], 'refresh-2');
});

test('concurrent refreshes share one call; a stale rejected token gets the current one', async () => {
  const { cloud, account } = setup();
  const seeded = cloud.seedTokens();
  account.load(
    normalizeConfig({
      [TOKEN_KEYS.ACCESS_TOKEN]: seeded.access_token,
      [TOKEN_KEYS.REFRESH_TOKEN]: seeded.refresh_token,
    }),
  );
  const [a, b] = await Promise.all([
    account.refresh(seeded.access_token),
    account.refresh(seeded.access_token),
  ]);
  assert.equal(a, b);
  assert.equal(cloud.tokenRequests.length, 1);
  assert.equal(await account.refresh(seeded.access_token), a, 'already replaced: no new call');
  assert.equal(cloud.tokenRequests.length, 1);
});

test('a dead refresh token is an auth error; a down endpoint is not', async () => {
  const { cloud, account } = setup();
  account.load(
    normalizeConfig({
      [TOKEN_KEYS.ACCESS_TOKEN]: 'old',
      [TOKEN_KEYS.REFRESH_TOKEN]: 'refresh-unknown',
    }),
  );
  await assert.rejects(account.refresh(), BeatbotAuthError);
  cloud.refreshFailure = 'server';
  await assert.rejects(account.refresh(), BeatbotConnectionError);
  assert.equal(account.linked, true, 'tokens kept: the next try may work');
});

test('tokens already in memory win over an older copy from the config', () => {
  const { account } = setup();
  account.load(normalizeConfig({ [TOKEN_KEYS.ACCESS_TOKEN]: 'newest' }));
  account.load(normalizeConfig({ [TOKEN_KEYS.ACCESS_TOKEN]: 'stale' }));
  assert.equal(account.tokens.accessToken, 'newest');
});

test('a token write Gladys refuses does not break the session', async () => {
  const { gladys, account } = setup();
  gladys.failSetConfig = true;
  const state = authorizeParams(account.startAuthorization('https://g/cb')).get('state');
  await account.completeAuthorization({ code: 'good-code', state, redirectUri: 'https://g/cb' });
  assert.equal(account.linked, true);
});

test('a stored copy without region nor account id reads them from the token', () => {
  const { account } = setup();
  account.load(
    normalizeConfig({ [TOKEN_KEYS.ACCESS_TOKEN]: makeJwt({ sub: 'acc-7', region: 'na' }) }),
  );
  assert.equal(account.region, 'na');
  assert.equal(account.accountId, 'acc-7');
});

test('without an account, asking for a token is an auth error', async () => {
  const { account } = setup();
  await assert.rejects(account.getAccessToken(), BeatbotAuthError);
});
