// -----------------------------------------------------------------------------
// Beatbot real-time event stream (WebSocket), port of beatbot_cloud's
// websocket.py + event_client.py.
//
// One account-scoped connection pushes every state change of every robot:
//   { eventId, type, deviceId, payload }
//   - properties_changed: payload { interfaceInfo, value }
//   - status:             payload { online }
//   - device_added:       payload { deviceId }
//   - device_removed:     payload null
//
// The stream reconnects by itself (1, 2, 4, 8, 30, 60 s, ±20 %), drops the
// events it already delivered (the cloud may replay after a reconnection),
// and maps the close codes: 4001 = token rejected (refresh once and retry),
// 4002 = replaced by a newer connection of the same account (stop), 4003 =
// authorization revoked (stop, the user must sign in again).
//
// Node 22+ ships a WHATWG WebSocket (undici) that accepts the non-standard
// `headers` option: no extra dependency.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { WS_CLOSE } from './const.js';

const logger = createLogger({ name: 'event-stream' });

export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 30_000, 60_000];
const RECONNECT_JITTER = 0.2;
// No frame for that long: the link is considered dead (same as the Python
// client's receive timeout).
export const IDLE_TIMEOUT_MS = 90_000;
const DEDUP_CACHE_SIZE = 256;

const INTEGER_PROPERTIES = new Set([
  'vacuum.state',
  'vacuum.battery',
  'sensor.error',
  'select.work_mode',
]);
const BOOLEAN_PROPERTIES = new Set(['switch.child_lock', 'switch.voice_disturb']);

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

/**
 * Parse and validate one event frame.
 * @returns {{ eventId: string, type: string, deviceId: string, payload: any } | null}
 *   null for a malformed frame (logged and skipped, never fatal).
 */
export function parseEvent(raw) {
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return null;
  }
  const { eventId, type, deviceId, payload } = event;
  if (!isNonEmptyString(eventId) || !isNonEmptyString(type) || !isNonEmptyString(deviceId)) {
    return null;
  }
  if (type === 'device_removed') {
    if (payload !== null && payload !== undefined) {
      return null;
    }
  } else if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  if (type === 'properties_changed') {
    const { interfaceInfo, value } = payload;
    if (!isNonEmptyString(interfaceInfo) || !('value' in payload)) {
      return null;
    }
    if (INTEGER_PROPERTIES.has(interfaceInfo) && !Number.isInteger(value)) {
      return null;
    }
    if (BOOLEAN_PROPERTIES.has(interfaceInfo) && typeof value !== 'boolean') {
      return null;
    }
  } else if (type === 'status' && typeof payload.online !== 'boolean') {
    return null;
  } else if (type === 'device_added' && payload.deviceId !== deviceId) {
    return null;
  }
  return { eventId, type, deviceId, payload: payload ?? null };
}

export class BeatbotEventStream {
  /**
   * @param {object} options
   * @param {string} options.url wss:// endpoint (BeatbotClient#eventStreamUrl)
   * @param {() => Promise<string>} options.getAccessToken
   * @param {(rejectedToken: string) => Promise<string>} options.refreshAccessToken
   * @param {(event: object) => (void | Promise<void>)} options.onEvent
   * @param {(info: { reconnect: boolean }) => (void | Promise<void>)} [options.onConnected]
   * @param {(reason: string) => void} [options.onStopped] called once when the
   *   stream gives up for good (`auth` or `replaced`)
   * @param {typeof WebSocket} [options.WebSocketImpl]
   * @param {() => number} [options.random]
   */
  constructor({
    url,
    getAccessToken,
    refreshAccessToken,
    onEvent,
    onConnected = () => {},
    onStopped = () => {},
    WebSocketImpl = globalThis.WebSocket,
    random = Math.random,
  }) {
    this.url = url;
    this.getAccessToken = getAccessToken;
    this.refreshAccessToken = refreshAccessToken;
    this.onEvent = onEvent;
    this.onConnected = onConnected;
    this.onStopped = onStopped;
    this.WebSocketImpl = WebSocketImpl;
    this.random = random;

    this.ws = null;
    this.stopped = true;
    this.failures = 0;
    this.hasConnected = false;
    this.tokenRefreshAttempted = false;
    this.nextAccessToken = null;
    this.currentToken = null;
    this.reconnectTimer = null;
    this.idleTimer = null;
    this.seenEventIds = new Set();
    // Serialize the event handlers: a state applied out of order would
    // publish an older value over a newer one.
    this.dispatchChain = Promise.resolve();
  }

  get connected() {
    return this.ws !== null && this.ws.readyState === 1;
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.failures = 0;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.idleTimer);
    this.reconnectTimer = null;
    this.idleTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    }
  }

  async connect() {
    if (this.stopped) {
      return;
    }
    let token = this.nextAccessToken;
    this.nextAccessToken = null;
    try {
      token ??= await this.getAccessToken();
    } catch (err) {
      logger.warn(`Event stream: no access token (${err.message})`);
      this.giveUpOrRetry(err);
      return;
    }
    if (this.stopped) {
      return;
    }
    this.currentToken = token;

    let ws;
    try {
      ws = new this.WebSocketImpl(this.url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      logger.warn(`Event stream: cannot open (${err.message})`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      const reconnect = this.hasConnected;
      this.hasConnected = true;
      this.failures = 0;
      this.armIdleTimer();
      logger.info(`Event stream ${reconnect ? 're' : ''}connected`);
      this.enqueue(() => this.onConnected({ reconnect }));
    };

    ws.onmessage = (message) => {
      this.armIdleTimer();
      if (typeof message.data !== 'string') {
        return;
      }
      const event = parseEvent(message.data);
      if (!event) {
        logger.warn('Ignoring a malformed Beatbot event');
        return;
      }
      this.tokenRefreshAttempted = false;
      if (this.seenEventIds.has(event.eventId)) {
        return;
      }
      this.rememberEvent(event.eventId);
      this.enqueue(() => this.onEvent(event));
    };

    // Every failure ends with a close event: only that one decides.
    ws.onerror = () => {};

    ws.onclose = (closeEvent) => {
      if (this.ws !== ws) {
        return; // stopped, or replaced by stop()/a newer connect
      }
      this.ws = null;
      clearTimeout(this.idleTimer);
      this.handleClose(closeEvent?.code, opened);
    };
  }

  async handleClose(code, opened) {
    if (this.stopped) {
      return;
    }
    if (code === WS_CLOSE.REPLACED) {
      logger.warn(
        'Event stream replaced by another connection of the same Beatbot account; ' +
          'live updates stop, the periodic refresh keeps the states up to date',
      );
      this.finish('replaced');
      return;
    }
    if (code === WS_CLOSE.FORBIDDEN) {
      logger.warn('Event stream: the Beatbot authorization was revoked');
      this.finish('auth');
      return;
    }
    if (code === WS_CLOSE.TOKEN_REJECTED) {
      if (this.tokenRefreshAttempted) {
        logger.warn('Event stream rejected the refreshed access token');
        this.finish('auth');
        return;
      }
      try {
        this.nextAccessToken = await this.refreshAccessToken(this.currentToken);
        this.tokenRefreshAttempted = true;
        this.connect();
      } catch (err) {
        this.giveUpOrRetry(err);
      }
      return;
    }
    logger.warn(`Event stream ${opened ? 'disconnected' : 'could not connect'} (code ${code})`);
    this.scheduleReconnect();
  }

  // An auth error from the token provider is final; anything else is retried.
  giveUpOrRetry(err) {
    if (err?.name === 'BeatbotAuthError') {
      this.finish('auth');
    } else {
      this.scheduleReconnect();
    }
  }

  finish(reason) {
    this.stop();
    this.onStopped(reason);
  }

  scheduleReconnect() {
    if (this.stopped) {
      return;
    }
    this.failures += 1;
    const base = RECONNECT_DELAYS_MS[Math.min(this.failures - 1, RECONNECT_DELAYS_MS.length - 1)];
    const delay = Math.round(base * (1 - RECONNECT_JITTER + 2 * RECONNECT_JITTER * this.random()));
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  armIdleTimer() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      logger.warn('Event stream silent for too long, reconnecting');
      const ws = this.ws;
      if (ws) {
        // Close and treat it as a plain disconnection right away: a dead TCP
        // link may never deliver the close event.
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        this.ws = null;
        try {
          ws.close();
        } catch {
          // Already closed.
        }
      }
      this.scheduleReconnect();
    }, IDLE_TIMEOUT_MS);
  }

  rememberEvent(eventId) {
    this.seenEventIds.add(eventId);
    if (this.seenEventIds.size > DEDUP_CACHE_SIZE) {
      // A Set iterates in insertion order: the first one is the oldest.
      this.seenEventIds.delete(this.seenEventIds.values().next().value);
    }
  }

  enqueue(task) {
    this.dispatchChain = this.dispatchChain
      .then(task)
      .catch((err) => logger.error('Beatbot event handler failed', err));
    return this.dispatchChain;
  }
}
