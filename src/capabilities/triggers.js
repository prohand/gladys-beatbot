// -----------------------------------------------------------------------------
// Scene triggers (SDK v0.14+, Gladys 5.1+): "this happened, with details".
//
// The values themselves (state, battery, mode) are device features: a scene
// can already react to them with the standard "device state" trigger. The
// triggers below say what a state alone cannot: a status CHANGE with the
// status it left, a cleaning cycle that ended (and how long it lasted), a
// fault that just appeared.
//
// The tracker diffs each device against what it saw last. Its first look at
// a device only sets the baseline: a restart of the integration never fires a
// "cleaning finished" for a cycle that ended hours ago. One event per
// transition, never one per frame (the core admits 300 events/minute).
// -----------------------------------------------------------------------------

import {
  ERROR_LABELS,
  POOL_CLEANING_CODES,
  POOL_CYCLE_HOLD_CODES,
  PRODUCT_CATEGORY,
  activeErrors,
  decodeStatus,
  labelOf,
  simpleStatusOf,
} from '../beatbot/protocol.js';
import { deviceExternalId } from '../devices/poolRobot.js';

// Keys as declared in the manifest `scene_triggers` field. Scenes store them:
// never rename one.
export const TRIGGER = {
  STATUS_CHANGED: 'status_changed',
  CLEANING_FINISHED: 'cleaning_finished',
  ERROR_RAISED: 'error_raised',
};
export const SCENE_TRIGGER_KEYS = Object.values(TRIGGER);

export class SceneTriggerTracker {
  /**
   * @param {object} gladys the SDK instance (externalIds)
   * @param {() => number} [now]
   */
  constructor(gladys, now = Date.now) {
    this.gladys = gladys;
    this.now = now;
    this.seen = new Map();
  }

  forget(deviceId) {
    this.seen.delete(deviceId);
  }

  /** The cycle a pool robot is in, if any (for the widget). */
  cycleOf(deviceId) {
    return this.seen.get(deviceId)?.cycleStartedAt ?? null;
  }

  lastFinishedOf(deviceId) {
    return this.seen.get(deviceId)?.lastFinished ?? null;
  }

  /**
   * Compare a device with its previous look.
   * @returns {Array<{ key: string, data: object }>} the scene events to publish
   */
  observe(model) {
    if (model.workStatus === null || model.workStatus === undefined) {
      return []; // nothing read yet
    }
    const status = simpleStatusOf(model);
    const detail = decodeStatus(model.productCategory, model.workStatus).status;
    const faults = activeErrors(model.productCategory, model.errorCode, { includeNotices: false });
    const isPool = model.productCategory === PRODUCT_CATEGORY.POOL_CLEAN_BOT;
    const cleaningNow = isPool && POOL_CLEANING_CODES.has(model.workStatus);

    const previous = this.seen.get(model.deviceId);
    const current = {
      status,
      faults,
      cycleStartedAt: previous?.cycleStartedAt ?? null,
      // A cycle already running at the first look started at an unknown time.
      cycleStartExact: previous?.cycleStartExact ?? false,
      lastFinished: previous?.lastFinished ?? null,
    };
    if (cleaningNow && current.cycleStartedAt === null) {
      current.cycleStartedAt = this.now();
      current.cycleStartExact = Boolean(previous);
    }
    this.seen.set(model.deviceId, current);

    if (!previous) {
      return [];
    }

    const device = deviceExternalId(this.gladys, model.deviceId);
    const events = [];

    if (status !== previous.status) {
      events.push({
        key: TRIGGER.STATUS_CHANGED,
        data: { device, status, previous_status: previous.status, detail },
      });
    }

    for (const error of faults.filter((key) => !previous.faults.includes(key))) {
      events.push({
        key: TRIGGER.ERROR_RAISED,
        data: {
          device,
          error,
          label_en: labelOf(ERROR_LABELS, error, 'en'),
          label_fr: labelOf(ERROR_LABELS, error, 'fr'),
        },
      });
    }

    // A cycle ends when the robot leaves the pool work for anything but a
    // pause; a fault ending it is an error_raised, not a finished cleaning.
    const holding = POOL_CYCLE_HOLD_CODES.has(model.workStatus);
    if (current.cycleStartedAt !== null && !cleaningNow && !holding) {
      const startedAt = current.cycleStartedAt;
      current.cycleStartedAt = null;
      if (faults.length === 0) {
        const durationMinutes = current.cycleStartExact
          ? Math.max(0, Math.round((this.now() - startedAt) / 60_000))
          : null;
        current.lastFinished = { at: this.now(), durationMinutes };
        events.push({
          key: TRIGGER.CLEANING_FINISHED,
          data: {
            device,
            duration_minutes: durationMinutes,
            battery: Number.isFinite(model.batteryLevel) ? model.batteryLevel : null,
          },
        });
      }
    }
    return events;
  }
}
