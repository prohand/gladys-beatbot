import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  BeatbotEventStream,
  IDLE_TIMEOUT_MS,
  RECONNECT_DELAYS_MS,
  parseEvent,
} from '../src/beatbot/eventStream.js';
import { BeatbotAuthError } from '../src/beatbot/errors.js';
import { createFakeWebSocketClass, flush } from './helpers/fakeBeatbot.js';

const event = (overrides = {}) => ({
  eventId: 'e1',
  type: 'properties_changed',
  deviceId: 'dev-1',
  payload: { interfaceInfo: 'vacuum.state', value: 5 },
  ...overrides,
});

function setup({ refresh } = {}) {
  const WebSocketImpl = createFakeWebSocketClass();
  const received = [];
  const connections = [];
  const stops = [];
  let token = 'token-1';
  const stream = new BeatbotEventStream({
    url: 'wss://eu-iot.beatbot.com/openapi/v1/ha/ws',
    getAccessToken: async () => token,
    refreshAccessToken:
      refresh ??
      (async () => {
        token = `token-${Number(token.split('-')[1]) + 1}`;
        return token;
      }),
    onEvent: (e) => received.push(e),
    onConnected: (info) => connections.push(info),
    onStopped: (reason) => stops.push(reason),
    WebSocketImpl,
    random: () => 0.5, // no jitter
  });
  return { stream, WebSocketImpl, received, connections, stops };
}

test('parseEvent accepts the documented envelopes', () => {
  assert.equal(parseEvent(JSON.stringify(event())).type, 'properties_changed');
  assert.ok(parseEvent(JSON.stringify(event({ type: 'status', payload: { online: false } }))));
  assert.ok(
    parseEvent(JSON.stringify(event({ type: 'device_added', payload: { deviceId: 'dev-1' } }))),
  );
  assert.ok(parseEvent(JSON.stringify(event({ type: 'device_removed', payload: null }))));
});

test('parseEvent rejects malformed frames', () => {
  assert.equal(parseEvent('not json'), null);
  assert.equal(parseEvent('[]'), null);
  assert.equal(parseEvent(JSON.stringify(event({ eventId: '' }))), null);
  assert.equal(
    parseEvent(JSON.stringify(event({ payload: { interfaceInfo: 'vacuum.state', value: '5' } }))),
    null,
    'integer property sent as a string',
  );
  assert.equal(
    parseEvent(
      JSON.stringify(event({ payload: { interfaceInfo: 'switch.child_lock', value: 1 } })),
    ),
    null,
    'boolean property sent as a number',
  );
  assert.equal(parseEvent(JSON.stringify(event({ type: 'status', payload: {} }))), null);
  assert.equal(
    parseEvent(JSON.stringify(event({ type: 'device_added', payload: { deviceId: 'other' } }))),
    null,
  );
  assert.equal(parseEvent(JSON.stringify(event({ type: 'device_removed', payload: {} }))), null);
});

test('connects with the bearer token and delivers events once', async () => {
  const { stream, WebSocketImpl, received, connections } = setup();
  stream.start();
  await flush();
  const ws = WebSocketImpl.last();
  assert.equal(ws.url, 'wss://eu-iot.beatbot.com/openapi/v1/ha/ws');
  assert.equal(ws.authorization, 'Bearer token-1');
  ws.open();
  ws.send(event());
  ws.send(event()); // replayed by the cloud
  ws.send(event({ eventId: 'e2' }));
  ws.send('garbage');
  await flush();
  assert.deepEqual(
    received.map((e) => e.eventId),
    ['e1', 'e2'],
  );
  assert.deepEqual(connections, [{ reconnect: false }]);
  stream.stop();
});

test('a dropped link reconnects with backoff and flags the reconnection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { stream, WebSocketImpl, connections } = setup();
  stream.start();
  await flush();
  WebSocketImpl.last().open();
  WebSocketImpl.last().serverClose(1006);
  await flush();
  assert.equal(WebSocketImpl.instances.length, 1, 'waits before reconnecting');

  t.mock.timers.tick(RECONNECT_DELAYS_MS[0]);
  await flush();
  assert.equal(WebSocketImpl.instances.length, 2);
  // It fails again without opening: the next delay is longer.
  WebSocketImpl.last().serverClose(1006);
  await flush();
  t.mock.timers.tick(RECONNECT_DELAYS_MS[0]);
  await flush();
  assert.equal(WebSocketImpl.instances.length, 2);
  t.mock.timers.tick(RECONNECT_DELAYS_MS[1] - RECONNECT_DELAYS_MS[0]);
  await flush();
  assert.equal(WebSocketImpl.instances.length, 3);

  WebSocketImpl.last().open();
  await flush();
  assert.deepEqual(connections, [{ reconnect: false }, { reconnect: true }]);
  stream.stop();
});

test('close 4001 refreshes the token once and reconnects at once', async () => {
  const { stream, WebSocketImpl, stops } = setup();
  stream.start();
  await flush();
  WebSocketImpl.last().serverClose(4001);
  await flush();
  assert.equal(WebSocketImpl.instances.length, 2);
  assert.equal(WebSocketImpl.last().authorization, 'Bearer token-2');

  // Rejected again before any event: the refreshed token is no better.
  WebSocketImpl.last().serverClose(4001);
  await flush();
  assert.deepEqual(stops, ['auth']);
  assert.equal(WebSocketImpl.instances.length, 2);
});

test('a refresh that fails for good stops the stream as an auth failure', async () => {
  const { stream, WebSocketImpl, stops } = setup({
    refresh: async () => {
      throw new BeatbotAuthError('invalid_grant');
    },
  });
  stream.start();
  await flush();
  WebSocketImpl.last().serverClose(4001);
  await flush();
  assert.deepEqual(stops, ['auth']);
});

test('close 4002 (replaced) and 4003 (revoked) stop the stream for good', async () => {
  for (const [code, reason] of [
    [4002, 'replaced'],
    [4003, 'auth'],
  ]) {
    const { stream, WebSocketImpl, stops } = setup();
    stream.start();
    await flush();
    WebSocketImpl.last().open();
    WebSocketImpl.last().serverClose(code);
    await flush();
    assert.deepEqual(stops, [reason]);
    assert.equal(WebSocketImpl.instances.length, 1, 'no reconnection');
  }
});

test('a silent link is dropped and reopened', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { stream, WebSocketImpl } = setup();
  stream.start();
  await flush();
  const first = WebSocketImpl.last();
  first.open();
  t.mock.timers.tick(IDLE_TIMEOUT_MS - 1);
  first.send(event()); // activity re-arms the timer
  t.mock.timers.tick(IDLE_TIMEOUT_MS - 1);
  assert.equal(first.closed, false);
  t.mock.timers.tick(1);
  assert.equal(first.closed, true);
  t.mock.timers.tick(RECONNECT_DELAYS_MS[0]);
  await flush();
  assert.equal(WebSocketImpl.instances.length, 2);
  stream.stop();
});

test('stop() closes the socket and cancels a pending reconnection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { stream, WebSocketImpl } = setup();
  stream.start();
  await flush();
  WebSocketImpl.last().serverClose(1006);
  await flush();
  stream.stop();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(WebSocketImpl.instances.length, 1);
});

test('events are handled one after the other, in order', async () => {
  const order = [];
  const WebSocketImpl = createFakeWebSocketClass();
  const stream = new BeatbotEventStream({
    url: 'wss://x',
    getAccessToken: async () => 't',
    refreshAccessToken: async () => 't',
    onEvent: async (e) => {
      order.push(`start ${e.eventId}`);
      await new Promise((resolve) => setImmediate(resolve));
      order.push(`end ${e.eventId}`);
    },
    WebSocketImpl,
  });
  stream.start();
  await flush();
  WebSocketImpl.last().open();
  WebSocketImpl.last().send(event({ eventId: 'a' }));
  WebSocketImpl.last().send(event({ eventId: 'b' }));
  await flush();
  assert.deepEqual(order, ['start a', 'end a', 'start b', 'end b']);
  stream.stop();
  mock.restoreAll();
});
