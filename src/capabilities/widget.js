// -----------------------------------------------------------------------------
// Dashboard widget (SDK v0.14+, Gladys 5.1+): one pool robot at a glance.
//
// The manifest `widgets` field declares it with one per-instance setting, the
// robot (a `"source": "devices"` select: the dashboard editor lists the
// integration's own devices). The content is declarative — the core renders
// it with its theme, dark mode and translations:
//   - a LIVE battery tile bound to the device feature (follows the published
//     states, nothing to refresh);
//   - a status list the integration computes (status, fault, link, mode,
//     last cleaning), nudged with requestWidgetRefresh on every change;
//   - Start / Pause / Return buttons, reaching onWidgetAction with the
//     `params` declared HERE (never user input: a dashboard can hang on a
//     public wall).
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { INTERFACE } from '../beatbot/const.js';
import {
  ERROR_LABELS,
  SIMPLE_STATUS_LABELS,
  STATUS_LABELS,
  activeErrors,
  decodeStatus,
  simpleStatusOf,
} from '../beatbot/protocol.js';
import { FEATURE, canControl, featureKeysOf } from '../devices/poolRobot.js';

const logger = createLogger({ name: 'widget' });

// Widget key, as declared in the manifest `widgets` field. Never rename it.
export const POOL_ROBOT_WIDGET = 'pool_robot';

// Button action keys -> the Beatbot action they send.
const WIDGET_ACTIONS = {
  start: INTERFACE.START,
  pause: INTERFACE.PAUSE,
  return_to_base: INTERFACE.RETURN_TO_BASE,
};

const STATUS_COLORS = {
  cleaning: WIDGET_COLORS.SUCCESS,
  paused: WIDGET_COLORS.WARNING,
  returning: WIDGET_COLORS.WARNING,
  charging: WIDGET_COLORS.INFO,
  docked: WIDGET_COLORS.INFO,
  stopped: WIDGET_COLORS.NEUTRAL,
  error: WIDGET_COLORS.DANGER,
};

const textOnly = (text) => ({
  ttl_seconds: 300,
  components: [{ type: 'text', variant: 'body', text }],
});

/**
 * The widget content for one robot.
 * @param {import('../service.js').BeatbotService} service
 * @param {string} externalId the device chosen in the widget settings
 */
export function buildPoolRobotContent(service, externalId) {
  if (!service.account.linked) {
    return textOnly({
      en: 'Link your Beatbot account in the integration configuration.',
      fr: "Liez votre compte Beatbot dans la configuration de l'intégration.",
    });
  }
  const model = externalId ? service.modelOf(externalId) : null;
  if (!model) {
    return textOnly({
      en: 'Robot not found: pick it again in the widget settings.',
      fr: 'Robot introuvable : choisissez-le à nouveau dans les réglages du widget.',
    });
  }

  const components = [];
  const features = featureKeysOf(model);
  if (features.includes(FEATURE.BATTERY)) {
    components.push({
      type: 'value',
      label: { en: 'Battery', fr: 'Batterie' },
      icon: 'battery',
      device_feature: `${externalId}:${FEATURE.BATTERY}`,
    });
  }

  const known = model.workStatus !== null && model.workStatus !== undefined;
  const simple = known ? simpleStatusOf(model) : null;
  const detail = known ? decodeStatus(model.productCategory, model.workStatus).status : null;
  const faults = activeErrors(model.productCategory, model.errorCode, { includeNotices: false });
  const lastFinished = service.tracker.lastFinishedOf(model.deviceId);
  const items = [
    {
      label: { en: 'Status', fr: 'État' },
      icon: 'activity',
      value: known
        ? (STATUS_LABELS[detail] ?? SIMPLE_STATUS_LABELS[simple])
        : { en: 'Unknown', fr: 'Inconnu' },
      color: known ? STATUS_COLORS[simple] : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: { en: 'Fault', fr: 'Défaut' },
      icon: 'alert-triangle',
      value: faults.length ? (ERROR_LABELS[faults[0]] ?? faults[0]) : { en: 'None', fr: 'Aucun' },
      color: faults.length ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      label: { en: 'Link', fr: 'Liaison' },
      icon: 'wifi',
      value: model.isOnline
        ? { en: 'Online', fr: 'En ligne' }
        : { en: 'Offline', fr: 'Hors ligne' },
      color: model.isOnline ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    },
  ];
  const mode = model.workModeOptions?.get(model.workMode);
  if (mode) {
    items.push({
      label: { en: 'Mode', fr: 'Mode' },
      icon: 'sliders',
      value: mode,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (lastFinished?.durationMinutes !== null && lastFinished?.durationMinutes !== undefined) {
    items.push({
      label: { en: 'Last cleaning', fr: 'Dernier nettoyage' },
      icon: 'clock',
      value: `${lastFinished.durationMinutes} min`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });

  const button = (key, label, icon, style) => ({
    type: 'button',
    label,
    icon,
    style,
    action: { key, params: { device: externalId } },
  });
  const cleaning = simple === 'cleaning';
  if (!cleaning && canControl(model, INTERFACE.START)) {
    components.push(button('start', { en: 'Start', fr: 'Démarrer' }, 'play', 'primary'));
  }
  if (cleaning && canControl(model, INTERFACE.PAUSE)) {
    components.push(button('pause', { en: 'Pause', fr: 'Pause' }, 'pause', 'secondary'));
  }
  if (canControl(model, INTERFACE.RETURN_TO_BASE)) {
    components.push(
      button('return_to_base', { en: 'Return', fr: 'Retour' }, 'corner-down-left', 'secondary'),
    );
  }

  return {
    // The computed rows are nudged on every change (requestWidgetRefresh):
    // the TTL is only a safety net.
    ttl_seconds: 300,
    components,
  };
}

export const WIDGETS = {
  [POOL_ROBOT_WIDGET]: {
    async get(service, { settings }) {
      logger.debug(`onWidgetGet <- ${POOL_ROBOT_WIDGET}`);
      return buildPoolRobotContent(service, settings?.robot);
    },

    // Resolve a toast; throwing reports the failure to the user.
    async action(service, { actionKey, params }) {
      logger.info(`onWidgetAction <- ${POOL_ROBOT_WIDGET}.${actionKey}`);
      const interfaceInfo = WIDGET_ACTIONS[actionKey];
      if (!interfaceInfo) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      if (!(await service.runAction(params?.device, interfaceInfo))) {
        return {
          en: 'This robot does not accept that order.',
          fr: "Ce robot n'accepte pas cet ordre.",
        };
      }
      return { en: 'Order sent to the robot.', fr: 'Ordre envoyé au robot.' };
    },
  },
};

/**
 * Freshness nudge: rate-limited core-side (1 per 10 s per widget) and
 * dropped while disconnected, so it is also sent after every (re)connection.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
