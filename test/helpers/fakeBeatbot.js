// -----------------------------------------------------------------------------
// A fake Beatbot cloud for the tests: a `fetch` implementation answering the
// OAuth token endpoint and the REST API the way the real one does (envelope
// `{ code, message, data }`, bearer tokens, regional base URL), plus a fake
// WebSocket class driven by the test. Nothing ever touches the network.
// -----------------------------------------------------------------------------

/** An unsigned JWT carrying the given claims (the integration never verifies it). */
export function makeJwt(claims) {
  const part = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(claims)}.sig`;
}

/** A discovery entry as the cloud returns it. */
export function rawDevice(overrides = {}) {
  return {
    deviceId: 'dev-1',
    productId: 'sblekiy3t188s9ql',
    productCategory: 'pool_clean_bot',
    name: 'AquaSense 2 Ultra',
    model: 'AquaSense 2 Ultra',
    isOnline: true,
    versions: [{ channel: 0, version: '1.2.3' }],
    capabilities: [
      { interfaceInfo: 'vacuum.state', retrievable: true, proactivelyReported: true },
      { interfaceInfo: 'vacuum.battery', retrievable: true, proactivelyReported: true },
      { interfaceInfo: 'sensor.error', retrievable: true, proactivelyReported: true },
      { interfaceInfo: 'vacuum.start' },
      { interfaceInfo: 'vacuum.pause' },
      { interfaceInfo: 'vacuum.return_to_base' },
      {
        interfaceInfo: 'select.work_mode',
        retrievable: true,
        configuration: JSON.stringify({
          options: [
            { value: 0, label: 'Floor' },
            { value: 1, label: 'Walls' },
            { value: 2, label: 'Waterline' },
          ],
        }),
      },
      { interfaceInfo: 'switch.child_lock', retrievable: true },
      { interfaceInfo: 'switch.voice_disturb', retrievable: true, nonControllable: true },
    ],
    ...overrides,
  };
}

const json = (status, body) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export function createFakeBeatbot({ region = 'eu', sub = 'account-42' } = {}) {
  let tokenCounter = 0;
  const issue = () => {
    tokenCounter += 1;
    return {
      access_token: makeJwt({ sub, region, n: tokenCounter }),
      refresh_token: `refresh-${tokenCounter}`,
      expires_in: 3600,
    };
  };

  const cloud = {
    base: `https://${region}-iot.beatbot.com`,
    devices: [rawDevice()],
    states: {
      'dev-1': {
        isOnline: true,
        states: {
          'vacuum.state': 3,
          'vacuum.battery': 87,
          'sensor.error': 0,
          'select.work_mode': 0,
          'switch.child_lock': false,
          'switch.voice_disturb': false,
        },
      },
    },
    validAccessTokens: new Set(),
    validRefreshTokens: new Set(),
    requests: [],
    actions: [],
    tokenRequests: [],
    // Knobs for failure paths.
    refreshFailure: null, // null | 'auth' | 'server'
    apiFailure: null, // null | number (HTTP status) | 'network'
    discoveryAsString: false,

    /** Tokens a "previous sign-in" left in the Gladys config. */
    seedTokens() {
      const tokens = issue();
      cloud.validAccessTokens.add(tokens.access_token);
      cloud.validRefreshTokens.add(tokens.refresh_token);
      return tokens;
    },

    async fetch(url, init = {}) {
      const method = init.method ?? 'GET';
      const target = new URL(url);

      if (target.origin === 'https://oauth.beatbot.com') {
        const params = Object.fromEntries(new URLSearchParams(init.body));
        cloud.tokenRequests.push(params);
        if (params.grant_type === 'authorization_code') {
          if (params.code !== 'good-code' || !params.code_verifier) {
            return json(400, { error: 'invalid_grant' });
          }
        } else if (params.grant_type === 'refresh_token') {
          if (cloud.refreshFailure === 'server') {
            return json(503, { error: 'unavailable' });
          }
          if (
            cloud.refreshFailure === 'auth' ||
            !cloud.validRefreshTokens.has(params.refresh_token)
          ) {
            return json(400, { error: 'invalid_grant' });
          }
          cloud.validRefreshTokens.delete(params.refresh_token);
        }
        const tokens = issue();
        cloud.validAccessTokens.add(tokens.access_token);
        cloud.validRefreshTokens.add(tokens.refresh_token);
        return json(200, tokens);
      }

      cloud.requests.push({ method, path: target.pathname, body: init.body });
      if (cloud.apiFailure === 'network') {
        throw new TypeError('fetch failed');
      }
      if (typeof cloud.apiFailure === 'number') {
        return json(cloud.apiFailure, { code: cloud.apiFailure });
      }
      const auth = init.headers?.Authorization ?? '';
      if (!cloud.validAccessTokens.has(auth.replace(/^Bearer /, ''))) {
        return json(401, { code: 401, message: 'unauthorized' });
      }
      if (target.origin !== cloud.base) {
        return json(404, { code: 404 });
      }

      const path = target.pathname;
      if (method === 'GET' && path === '/openapi/v1/ha') {
        const data = { devices: cloud.devices };
        return json(200, {
          code: 200,
          data: cloud.discoveryAsString ? JSON.stringify(data) : data,
        });
      }
      if (method === 'GET' && path === '/openapi/v1/ha/state') {
        return json(200, {
          code: 200,
          data: {
            devices: Object.entries(cloud.states).map(([deviceId, s]) => ({ deviceId, ...s })),
          },
        });
      }
      let match = path.match(/^\/openapi\/v1\/ha\/([^/]+)\/state$/);
      if (method === 'GET' && match) {
        return json(200, { code: 200, data: cloud.states[decodeURIComponent(match[1])] ?? {} });
      }
      match = path.match(/^\/openapi\/v1\/ha\/([^/]+)\/actions$/);
      if (method === 'POST' && match) {
        cloud.actions.push({ deviceId: decodeURIComponent(match[1]), ...JSON.parse(init.body) });
        return json(200, { code: 200, data: null });
      }
      return json(404, { code: 404 });
    },
  };
  cloud.fetch = cloud.fetch.bind(cloud);
  return cloud;
}

/**
 * A fake WebSocket class: every instance is recorded in `FakeWebSocket.instances`,
 * and the test drives it (open, message, close).
 */
export function createFakeWebSocketClass() {
  class FakeWebSocket {
    static instances = [];

    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.readyState = 0;
      this.closed = false;
      FakeWebSocket.instances.push(this);
    }

    get authorization() {
      return this.options?.headers?.Authorization;
    }

    open() {
      this.readyState = 1;
      this.onopen?.();
    }

    send(event) {
      this.onmessage?.({ data: typeof event === 'string' ? event : JSON.stringify(event) });
    }

    serverClose(code) {
      this.readyState = 3;
      this.onclose?.({ code });
    }

    close() {
      this.closed = true;
      this.readyState = 3;
    }

    static last() {
      return FakeWebSocket.instances.at(-1);
    }
  }
  return FakeWebSocket;
}

/** Let pending promise callbacks run. */
export const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
