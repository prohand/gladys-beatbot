// -----------------------------------------------------------------------------
// Beatbot OAuth2: authorization code + PKCE, public client (no secret).
//
// Gladys relays the browser flow (manifest field of type `oauth2`): it asks
// for the authorization URL with its own redirect URI, then hands back the
// `code` and the `state`. Everything provider-specific happens here.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { HTTP_TIMEOUT_MS, OAUTH2_AUTHORIZE_URL, OAUTH2_SCOPE, OAUTH2_TOKEN_URL } from './const.js';
import { BeatbotAuthError, BeatbotConnectionError } from './errors.js';

const base64url = (buffer) => buffer.toString('base64url');

/**
 * A fresh PKCE pair (RFC 7636, S256) and an anti-CSRF state.
 */
export function createPkce() {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(24));
  return { verifier, challenge, state };
}

/**
 * The URL the user's browser opens to authorize Gladys on the Beatbot account.
 */
export function buildAuthorizeUrl({ clientId, redirectUri, challenge, state }) {
  const url = new URL(OAUTH2_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', OAUTH2_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Decode the claims of a JWT access token WITHOUT verifying it: only used to
 * read the account id (`sub`) and its `region`, never to trust anything.
 * @returns {Record<string, unknown> | null}
 */
export function decodeAccessToken(accessToken) {
  try {
    const payload = String(accessToken).split('.')[1];
    if (!payload) {
      return null;
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

/**
 * POST to the token endpoint and normalize the answer.
 * @returns {Promise<{ accessToken: string, refreshToken: string | null, expiresAt: number | null }>}
 */
async function requestToken(params, { fetchImpl = fetch, now = Date.now } = {}) {
  let response;
  try {
    response = await fetchImpl(OAUTH2_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    throw new BeatbotConnectionError(`Token endpoint unreachable: ${err.message}`);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Handled below: a non-JSON answer is never a token.
  }

  // 400 invalid_grant / 401: the grant is dead, only a new sign-in fixes it.
  // Anything else (5xx, gateway) is transient: keep the tokens, retry later.
  if (response.status === 400 || response.status === 401) {
    throw new BeatbotAuthError(`Token refused: ${body?.error ?? response.status}`);
  }
  if (!response.ok) {
    throw new BeatbotConnectionError(`Token endpoint failed: ${response.status}`);
  }
  if (!body || typeof body.access_token !== 'string' || !body.access_token) {
    throw new BeatbotConnectionError('Token endpoint returned no access token');
  }
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now() + expiresIn * 1000 : null,
  };
}

/**
 * Exchange the authorization code for the first tokens.
 */
export function exchangeCode({ clientId, code, redirectUri, verifier }, options) {
  return requestToken(
    {
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
    options,
  );
}

/**
 * Trade the refresh token for a new access token. The provider may rotate
 * the refresh token: the caller keeps the old one when none comes back.
 */
export function refreshTokens({ clientId, refreshToken }, options) {
  return requestToken(
    { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken },
    options,
  );
}
