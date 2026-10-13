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
//     public wall);
//   - a "Cleaning mode" button opening a form (Gladys 5.2+): one `select`
//     whose options are the modes THIS robot advertises, written at content
//     time (an action field takes no `source`). The core validates the chosen
//     value against those options before relaying it as `values`.
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

// Button actions opening a form (`fields`): Gladys 5.2 is the first core that
// relays their `values`. test/manifest.test.js ties this list to the
// manifest `gladys_version`.
export const FORM_ACTIONS = ['set_cleaning_mode'];

// The core cuts an option label past 40 characters: cut it here, so a long
// cloud label never reaches the card half-truncated by somebody else.
const OPTION_LABEL_MAX = 40;

const CLEANING_MODE = {
  en: 'Cleaning mode',
  fr: 'Mode de nettoyage',
  de: 'Reinigungsmodus',
  es: 'Modo de limpieza',
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
      de: 'Verknüpfen Sie Ihr Beatbot-Konto in der Konfiguration der Integration.',
      es: 'Vincule su cuenta de Beatbot en la configuración de la integración.',
    });
  }
  const model = externalId ? service.modelOf(externalId) : null;
  if (!model) {
    return textOnly({
      en: 'Robot not found: pick it again in the widget settings.',
      fr: 'Robot introuvable : choisissez-le à nouveau dans les réglages du widget.',
      de: 'Roboter nicht gefunden: Wählen Sie ihn in den Widget-Einstellungen erneut aus.',
      es: 'Robot no encontrado: vuelva a elegirlo en la configuración del widget.',
    });
  }

  const components = [];
  const features = featureKeysOf(model);
  if (features.includes(FEATURE.BATTERY)) {
    components.push({
      type: 'value',
      label: { en: 'Battery', fr: 'Batterie', de: 'Akku', es: 'Batería' },
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
      label: { en: 'Status', fr: 'État', de: 'Status', es: 'Estado' },
      icon: 'activity',
      value: known
        ? (STATUS_LABELS[detail] ?? SIMPLE_STATUS_LABELS[simple])
        : STATUS_LABELS.unknown,
      color: known ? STATUS_COLORS[simple] : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: { en: 'Fault', fr: 'Défaut', de: 'Störung', es: 'Fallo' },
      icon: 'alert-triangle',
      value: faults.length
        ? (ERROR_LABELS[faults[0]] ?? faults[0])
        : { en: 'None', fr: 'Aucun', de: 'Keine', es: 'Ninguno' },
      color: faults.length ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      label: { en: 'Link', fr: 'Liaison', de: 'Verbindung', es: 'Conexión' },
      icon: 'wifi',
      value: model.isOnline
        ? { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' }
        : { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
      color: model.isOnline ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    },
  ];
  const mode = model.workModeOptions?.get(model.workMode);
  if (mode) {
    items.push({
      label: { en: 'Mode', fr: 'Mode', de: 'Modus', es: 'Modo' },
      icon: 'sliders',
      value: mode,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (lastFinished?.durationMinutes !== null && lastFinished?.durationMinutes !== undefined) {
    items.push({
      label: {
        en: 'Last cleaning',
        fr: 'Dernier nettoyage',
        de: 'Letzte Reinigung',
        es: 'Última limpieza',
      },
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
    components.push(
      button(
        'start',
        { en: 'Start', fr: 'Démarrer', de: 'Starten', es: 'Iniciar' },
        'play',
        'primary',
      ),
    );
  }
  if (cleaning && canControl(model, INTERFACE.PAUSE)) {
    components.push(
      button('pause', { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' }, 'pause', 'secondary'),
    );
  }
  if (canControl(model, INTERFACE.RETURN_TO_BASE)) {
    components.push(
      button(
        'return_to_base',
        { en: 'Return', fr: 'Retour', de: 'Zurück', es: 'Volver' },
        'corner-down-left',
        'secondary',
      ),
    );
  }
  // Same rule as the device feature: offered only when the cloud advertises
  // the mode as controllable. At most three buttons in all, under the four
  // the core renders.
  if (model.workModeOptions?.size && canControl(model, INTERFACE.WORK_MODE)) {
    components.push(cleaningModeButton(externalId, model));
  }

  return {
    // The computed rows are nudged on every change (requestWidgetRefresh):
    // the TTL is only a safety net.
    ttl_seconds: 300,
    components,
  };
}

/**
 * The "Cleaning mode" button: its form lists the modes of THIS robot, in the
 * cloud's order, pre-filled with the current one. The cloud sets a mode by its
 * label, so the label is the option value, as on the device feature.
 */
function cleaningModeButton(externalId, model) {
  const labels = [...model.workModeOptions.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, label]) => label)
    .filter((label) => typeof label === 'string' && label.length > 0);
  const current = model.workModeOptions.get(model.workMode);
  const field = {
    key: 'mode',
    type: 'select',
    required: true,
    label: CLEANING_MODE,
    options: labels.map((label) => {
      const text = label.slice(0, OPTION_LABEL_MAX);
      return { value: label, label: { en: text, fr: text, de: text, es: text } };
    }),
  };
  if (labels.includes(current)) {
    field.default = current;
  }
  return {
    type: 'button',
    label: CLEANING_MODE,
    icon: 'sliders',
    style: 'secondary',
    action: { key: 'set_cleaning_mode', params: { device: externalId }, fields: [field] },
  };
}

/**
 * The form of "Cleaning mode": the same path as the `set_cleaning_mode` scene
 * action (service.runWorkMode), which matches the label against the modes the
 * robot advertises and refuses an uncontrollable mode.
 */
async function setCleaningMode(service, params, values) {
  // A core older than 5.2 drops the form and relays the tap without
  // `values`: there is no mode to set, and guessing one would move the robot.
  if (typeof values?.mode !== 'string' || values.mode.length === 0) {
    return {
      en: 'Choose the mode in the form of the button (Gladys 5.2 or later).',
      fr: 'Choisissez le mode dans le formulaire du bouton (Gladys 5.2 ou plus récent).',
      de: 'Wählen Sie den Modus im Formular der Schaltfläche (Gladys 5.2 oder neuer).',
      es: 'Elija el modo en el formulario del botón (Gladys 5.2 o posterior).',
    };
  }
  if (!(await service.runWorkMode(params?.device, values.mode))) {
    return {
      en: 'This robot does not accept that cleaning mode.',
      fr: "Ce robot n'accepte pas ce mode de nettoyage.",
      de: 'Dieser Roboter akzeptiert diesen Reinigungsmodus nicht.',
      es: 'Este robot no acepta ese modo de limpieza.',
    };
  }
  return {
    en: `Cleaning mode set to ${values.mode}.`,
    fr: `Mode de nettoyage réglé sur ${values.mode}.`,
    de: `Reinigungsmodus auf ${values.mode} gesetzt.`,
    es: `Modo de limpieza cambiado a ${values.mode}.`,
  };
}

export const WIDGETS = {
  [POOL_ROBOT_WIDGET]: {
    async get(service, { settings }) {
      logger.debug(`onWidgetGet <- ${POOL_ROBOT_WIDGET}`);
      return buildPoolRobotContent(service, settings?.robot);
    },

    // Resolve a toast; throwing reports the failure to the user.
    async action(service, { actionKey, params, values }) {
      logger.info(`onWidgetAction <- ${POOL_ROBOT_WIDGET}.${actionKey}`);
      if (actionKey === 'set_cleaning_mode') {
        return setCleaningMode(service, params, values);
      }
      const interfaceInfo = WIDGET_ACTIONS[actionKey];
      if (!interfaceInfo) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      if (!(await service.runAction(params?.device, interfaceInfo))) {
        return {
          en: 'This robot does not accept that order.',
          fr: "Ce robot n'accepte pas cet ordre.",
          de: 'Dieser Roboter akzeptiert diesen Befehl nicht.',
          es: 'Este robot no acepta esa orden.',
        };
      }
      return {
        en: 'Order sent to the robot.',
        fr: 'Ordre envoyé au robot.',
        de: 'Befehl an den Roboter gesendet.',
        es: 'Orden enviada al robot.',
      };
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
