import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_LABELS,
  GLADYS_VACUUM_STATE,
  PRODUCT_CATEGORY,
  SIMPLE_STATUSES,
  SIMPLE_STATUS_LABELS,
  STATUS_LABELS,
  activeErrors,
  decodeStatus,
  errorKeysFor,
  gladysStateOf,
  labelOf,
  simpleStatusOf,
} from '../src/beatbot/protocol.js';

const POOL = PRODUCT_CATEGORY.POOL_CLEAN_BOT;
const STATION = PRODUCT_CATEGORY.CLEAN_BASE_STATION;

test('pool robot statuses decode to a detailed status and a Gladys state', () => {
  assert.deepEqual(decodeStatus(POOL, 5), {
    status: 'cleaning',
    gladysState: GLADYS_VACUUM_STATE.RUNNING,
  });
  assert.equal(decodeStatus(POOL, 2).gladysState, GLADYS_VACUUM_STATE.CHARGING);
  assert.equal(decodeStatus(POOL, 7).gladysState, GLADYS_VACUUM_STATE.RETURNING_TO_DOCK);
  assert.equal(decodeStatus(POOL, 16).gladysState, GLADYS_VACUUM_STATE.DOCKED);
  assert.equal(decodeStatus(STATION, 4).gladysState, GLADYS_VACUUM_STATE.PAUSED);
});

test('an unknown status code (newer firmware) reads as unknown, never throws', () => {
  assert.deepEqual(decodeStatus(POOL, 99), {
    status: 'unknown',
    gladysState: GLADYS_VACUUM_STATE.STOPPED,
  });
  assert.equal(decodeStatus('lawn_mower', 1).status, 'unknown');
});

test('the error bitmask decodes bit by bit', () => {
  assert.deepEqual(activeErrors(POOL, 0), []);
  assert.deepEqual(activeErrors(POOL, 1), ['dust_box_full']);
  assert.deepEqual(activeErrors(POOL, (1 << 18) | (1 << 2)), ['power_low', 'trapped']);
});

test('station notices are information, not faults', () => {
  const notice = 1 << 24; // notice_clean_done_normal
  assert.deepEqual(activeErrors(STATION, notice), ['notice_clean_done_normal']);
  assert.deepEqual(activeErrors(STATION, notice, { includeNotices: false }), []);
  const model = { productCategory: STATION, workStatus: 2, errorCode: notice };
  assert.equal(gladysStateOf(model), GLADYS_VACUUM_STATE.STOPPED);
});

test('an active fault makes the Gladys state ERROR whatever the status', () => {
  const model = { productCategory: POOL, workStatus: 5, errorCode: 1 << 18 };
  assert.equal(gladysStateOf(model), GLADYS_VACUUM_STATE.ERROR);
  assert.equal(simpleStatusOf(model), 'error');
});

test('every status, simple status and fault has an English and a French label', () => {
  for (const code of Array.from({ length: 21 }, (_, i) => i)) {
    const { status } = decodeStatus(POOL, code);
    assert.ok(STATUS_LABELS[status]?.en && STATUS_LABELS[status]?.fr, status);
  }
  for (const code of [0, 1, 2, 3, 4, 5]) {
    const { status } = decodeStatus(STATION, code);
    assert.ok(STATUS_LABELS[status]?.fr, status);
  }
  for (const status of SIMPLE_STATUSES) {
    assert.ok(SIMPLE_STATUS_LABELS[status]?.fr, status);
  }
  for (const category of [POOL, STATION]) {
    for (const error of errorKeysFor(category, { includeNotices: false })) {
      assert.ok(ERROR_LABELS[error]?.en && ERROR_LABELS[error]?.fr, error);
    }
  }
});

test('labelOf falls back to English, then to the raw key', () => {
  assert.equal(labelOf(ERROR_LABELS, 'trapped', 'fr'), 'Robot coincé');
  assert.equal(labelOf(ERROR_LABELS, 'trapped', 'de'), 'Robot stuck');
  assert.equal(labelOf(ERROR_LABELS, 'brand_new_error', 'fr'), 'brand_new_error');
});
