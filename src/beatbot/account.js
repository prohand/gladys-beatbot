// -----------------------------------------------------------------------------
// The linked Beatbot account: its tokens, their refresh, their storage.
//
// The tokens are kept in memory and persisted in the Gladys config (off-schema
// keys, see src/config.js) so a restart does not ask the user to sign in again.
// Once loaded, memory wins: a refresh token can be ROTATED by the provider, and
// an older copy coming back from the config would be a dead one.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { REGIONS } from './const.js';
import { BeatbotAuthError } from './errors.js';
import {
  buildAuthorizeUrl,
  createPkce,
  decodeAccessToken,
  exchangeCode,
  refreshTokens,
} from './oauth.js';
import { TOKEN_KEYS } from '../config.js';

const logger = createLogger({ name: 'account' });

// Refresh a little before the expiry, so a request never leaves with a token
// that dies on the way.
export const EXPIRY_MARGIN_MS = 60_000;
// An authorization not completed within that delay is forgotten.
const PENDING_AUTHORIZATION_TTL_MS = 15 * 60_000;

export class BeatbotAccount {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK instance (setConfig)
   * @param {() => object} options.getConfig current normalized config
   * @param {typeof fetch} [options.fetchImpl]
   * @param {() => number} [options.now]
   */
  constructor({ gladys, getConfig, fetchImpl = fetch, now = Date.now }) {
    this.gladys = gladys;
    this.getConfig = getConfig;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.tokens = null;
    this.pending = null;
    this.refreshing = null;
  }

  /** Adopt the tokens stored in the config, unless some are already in memory. */
  load(config) {
    if (this.tokens?.accessToken) {
      return;
    }
    const { accessToken, refreshToken, expiresAt, region, account } = config.tokens;
    if (!accessToken) {
      this.tokens = null;
      return;
    }
    // A stored copy missing the region or the account id (a write Gladys
    // refused halfway): the token itself still carries them.
    const claims = decodeAccessToken(accessToken) ?? {};
    this.tokens = {
      accessToken,
      refreshToken,
      expiresAt,
      region: region ?? (typeof claims.region === 'string' ? claims.region : null),
      account: account ?? (typeof claims.sub === 'string' ? claims.sub : null),
    };
  }

  get linked() {
    return Boolean(this.tokens?.accessToken);
  }

  /**
   * The region to call: the one chosen in the config, or the account's own
   * (`region` claim of its token). Never a guess: null when unknown.
   */
  get region() {
    const chosen = this.getConfig().region;
    if (chosen && chosen !== 'auto') {
      return chosen;
    }
    const fromToken = this.tokens?.region;
    return REGIONS.includes(fromToken) ? fromToken : null;
  }

  /** The id of the linked account (JWT `sub`), for logs and the test action. */
  get accountId() {
    return this.tokens?.account ?? null;
  }

  /** Step 1 of the link: the URL the user's browser opens. */
  startAuthorization(redirectUri) {
    const { verifier, challenge, state } = createPkce();
    this.pending = { verifier, state, redirectUri, createdAt: this.now() };
    return buildAuthorizeUrl({
      clientId: this.getConfig().client_id,
      redirectUri,
      challenge,
      state,
    });
  }

  /** Step 2 of the link: Beatbot sent the browser back with a code. */
  async completeAuthorization({ code, state, redirectUri }) {
    const pending = this.pending;
    if (!pending || this.now() - pending.createdAt > PENDING_AUTHORIZATION_TTL_MS) {
      throw new Error('No sign-in in progress, or it expired: click Connect again.');
    }
    if (!state || state !== pending.state) {
      throw new Error('Sign-in refused: the state does not match (start again).');
    }
    if (!code) {
      throw new Error('Sign-in refused: Beatbot sent no authorization code.');
    }
    this.pending = null;
    const tokens = await exchangeCode(
      {
        clientId: this.getConfig().client_id,
        code,
        // The token endpoint compares it with the one of the authorize step.
        redirectUri: redirectUri ?? pending.redirectUri,
        verifier: pending.verifier,
      },
      { fetchImpl: this.fetchImpl, now: this.now },
    );
    const claims = decodeAccessToken(tokens.accessToken) ?? {};
    this.tokens = {
      ...tokens,
      region: typeof claims.region === 'string' ? claims.region : null,
      account: typeof claims.sub === 'string' ? claims.sub : null,
    };
    logger.info(`Beatbot account linked (region ${this.tokens.region ?? 'unknown'})`);
    await this.persist();
    return this.tokens;
  }

  /** A valid access token, refreshed first when it is about to expire. */
  async getAccessToken() {
    if (!this.tokens?.accessToken) {
      throw new BeatbotAuthError('No Beatbot account linked');
    }
    const { expiresAt, refreshToken } = this.tokens;
    if (refreshToken && expiresAt && this.now() >= expiresAt - EXPIRY_MARGIN_MS) {
      return this.refresh();
    }
    return this.tokens.accessToken;
  }

  /**
   * Refresh the access token. Concurrent callers share ONE refresh; a caller
   * reporting a token that was already replaced gets the new one directly.
   * @param {string} [rejectedToken]
   */
  async refresh(rejectedToken) {
    if (!this.tokens?.accessToken) {
      throw new BeatbotAuthError('No Beatbot account linked');
    }
    if (rejectedToken && rejectedToken !== this.tokens.accessToken) {
      return this.tokens.accessToken;
    }
    if (!this.tokens.refreshToken) {
      throw new BeatbotAuthError('The Beatbot session expired and cannot be renewed');
    }
    this.refreshing ??= (async () => {
      try {
        const fresh = await refreshTokens(
          { clientId: this.getConfig().client_id, refreshToken: this.tokens.refreshToken },
          { fetchImpl: this.fetchImpl, now: this.now },
        );
        const claims = decodeAccessToken(fresh.accessToken) ?? {};
        this.tokens = {
          accessToken: fresh.accessToken,
          refreshToken: fresh.refreshToken ?? this.tokens.refreshToken,
          expiresAt: fresh.expiresAt,
          region: typeof claims.region === 'string' ? claims.region : this.tokens.region,
          account: typeof claims.sub === 'string' ? claims.sub : this.tokens.account,
        };
        logger.debug('Beatbot access token refreshed');
        await this.persist();
        return this.tokens.accessToken;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async persist() {
    const t = this.tokens;
    try {
      await this.gladys.setConfig({
        [TOKEN_KEYS.ACCESS_TOKEN]: t?.accessToken ?? '',
        [TOKEN_KEYS.REFRESH_TOKEN]: t?.refreshToken ?? '',
        [TOKEN_KEYS.EXPIRES_AT]: t?.expiresAt ?? 0,
        [TOKEN_KEYS.REGION]: t?.region ?? '',
        [TOKEN_KEYS.ACCOUNT]: t?.account ?? '',
      });
    } catch (err) {
      // Memory keeps working; only a restart would need the sign-in again.
      logger.warn(`Could not store the Beatbot tokens in Gladys: ${err.message}`);
    }
  }
}
