// -----------------------------------------------------------------------------
// Beatbot device protocol: raw values -> meaning.
//
// The cloud reports numbers: a work status code (`vacuum.state`) whose meaning
// depends on the product category, and an error BITMASK (`sensor.error`). The
// tables below are the ones of the official Python client
// (beatbot_cloud/protocol.py); the Gladys mapping follows the activity mapping
// of Beatbot's own Home Assistant integration.
// -----------------------------------------------------------------------------

export const PRODUCT_CATEGORY = {
  POOL_CLEAN_BOT: 'pool_clean_bot',
  CLEAN_BASE_STATION: 'clean_base_station',
  LAWN_MOWER: 'lawn_mower',
};

// Categories this integration exposes. Lawn mowers have no status table yet:
// they would show up as devices that never say anything.
export const SUPPORTED_CATEGORIES = [
  PRODUCT_CATEGORY.POOL_CLEAN_BOT,
  PRODUCT_CATEGORY.CLEAN_BASE_STATION,
];

// Categories whose devices carry their own battery (a base station reports
// the paired robot charging in its status, but has no battery itself).
export const BATTERY_CATEGORIES = [PRODUCT_CATEGORY.POOL_CLEAN_BOT];

// Gladys VACUUM_CLEANER_STATE (server/utils/constants.js of Gladys).
export const GLADYS_VACUUM_STATE = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
  ERROR: 3,
  RETURNING_TO_DOCK: 4,
  CHARGING: 5,
  DOCKED: 6,
};

// Gladys VACUUM_CLEANER_MODE: the run-mode feature is "cleaning or not".
export const GLADYS_RUN_MODE = { IDLE: 0, CLEANING: 1 };

const S = GLADYS_VACUUM_STATE;

// Raw work status -> [detailed status key, Gladys state].
const STATUS_BY_CATEGORY = {
  [PRODUCT_CATEGORY.POOL_CLEAN_BOT]: {
    0: ['standby', S.STOPPED],
    1: ['goto_charge', S.RETURNING_TO_DOCK],
    2: ['charging', S.CHARGING],
    3: ['charge_done', S.DOCKED],
    4: ['paused', S.PAUSED],
    5: ['cleaning', S.RUNNING],
    6: ['sleep', S.STOPPED],
    7: ['return_trip', S.RETURNING_TO_DOCK],
    8: ['clean_done', S.STOPPED],
    9: ['remote_control', S.RUNNING],
    10: ['clean_wait', S.STOPPED],
    11: ['wifi_connect', S.STOPPED],
    12: ['diving', S.RUNNING],
    13: ['emerge', S.RUNNING],
    14: ['auto_dock', S.RETURNING_TO_DOCK],
    15: ['finish_connect', S.RETURNING_TO_DOCK],
    16: ['dock', S.DOCKED],
    17: ['self_cleaning', S.RUNNING],
    18: ['replenish_energy', S.STOPPED],
    19: ['chase_light', S.RUNNING],
    20: ['dock_done', S.DOCKED],
  },
  [PRODUCT_CATEGORY.CLEAN_BASE_STATION]: {
    0: ['cleaning', S.RUNNING],
    1: ['cleaning', S.RUNNING],
    2: ['standby', S.STOPPED],
    3: ['uncheck', S.STOPPED],
    4: ['self_checking', S.PAUSED],
    5: ['check_down', S.PAUSED],
  },
};

// Raw statuses during which a pool robot is actually working a pool: what
// opens a cleaning cycle (and what the `cleaning_finished` trigger closes).
export const POOL_CLEANING_CODES = new Set([5, 9, 12, 13, 19]);
// Statuses that interrupt a cycle without ending it.
export const POOL_CYCLE_HOLD_CODES = new Set([4, 10]);

// Error bitmask, bit 0 first. `notice_*` bits are information the station
// gives (cleaning ended, dust bin to empty), not faults.
const ERROR_BITS_BY_CATEGORY = {
  [PRODUCT_CATEGORY.POOL_CLEAN_BOT]: [
    'dust_box_full',
    'dust_box_loss',
    'power_low',
    'power_cutting',
    'env_high_temperature',
    'env_low_temperature',
    'motor_error',
    'motor_wheel_left',
    'motor_wheel_right',
    'motor_thruster_left',
    'motor_thruster_right',
    'motor_pump',
    'motor_airpump_left',
    'motor_airpump_right',
    'motor_brush',
    'motor_reagent',
    'motor_rod',
    'enter_shawdow_water_error',
    'trapped',
    'charge_high_temperature',
    'charge_low_temperature',
    'motor_thruster',
    'platform_clean_err',
  ],
  [PRODUCT_CATEGORY.CLEAN_BASE_STATION]: [
    'self_err_spray',
    'self_err_lever',
    'self_err_pusher',
    'self_err_clean_conflict',
    'err_dust_not_install',
    'notice_self_not_paired',
    'notice_self_base_dust',
    'notice_self_temp_low',
    'notice_self_robot_not_comm',
    'notice_self_robot_not_pos',
    'notice_self_robot_dust',
    'notice_clean_closed_dust',
    'notice_clean_spray_not_pos',
    'notice_clean_opend_dust',
    'notice_clean_comm',
    'notice_clean_robot_not_pos',
    'notice_clean_base_dust',
    'notice_clean_spray_leave_pos',
    'notice_clean_user_end_early',
    'notice_cleaned_spray_not_reset',
    'notice_cleaned_lever_not_reset',
    'notice_clean_drain_pump_empty',
    'notice_cln_robot_dust_not_pos',
    'notice_clean_lever_not_reset',
    'notice_clean_done_normal',
  ],
};

export const isNotice = (errorKey) => errorKey.startsWith('notice_');

/**
 * Every error key a category can report, in bit order.
 * @param {string} category
 * @param {{ includeNotices?: boolean }} [options]
 */
export function errorKeysFor(category, { includeNotices = true } = {}) {
  return (ERROR_BITS_BY_CATEGORY[category] ?? []).filter((key) => includeNotices || !isNotice(key));
}

/**
 * The active error keys of a raw bitmask, faults first in bit order.
 * @param {string} category
 * @param {number} errorCode
 * @param {{ includeNotices?: boolean }} [options]
 */
export function activeErrors(category, errorCode, { includeNotices = true } = {}) {
  const code = Number(errorCode) || 0;
  return (ERROR_BITS_BY_CATEGORY[category] ?? []).filter(
    (key, bit) => (includeNotices || !isNotice(key)) && (code & (1 << bit)) !== 0,
  );
}

/**
 * Decode a raw work status.
 * @returns {{ status: string, gladysState: number }} `status` is `unknown`
 *   for a code the table does not know (a newer firmware).
 */
export function decodeStatus(category, workStatus) {
  const entry = STATUS_BY_CATEGORY[category]?.[workStatus];
  if (!entry) {
    return { status: 'unknown', gladysState: S.STOPPED };
  }
  return { status: entry[0], gladysState: entry[1] };
}

/**
 * The Gladys vacuum state of a device: its status, unless a FAULT is active
 * (notices never make the device look faulted).
 */
export function gladysStateOf(device) {
  if (activeErrors(device.productCategory, device.errorCode, { includeNotices: false }).length) {
    return S.ERROR;
  }
  return decodeStatus(device.productCategory, device.workStatus).gladysState;
}

// The simplified status the scene trigger filters on and the widget shows.
export const SIMPLE_STATUS_BY_GLADYS_STATE = {
  [S.STOPPED]: 'stopped',
  [S.RUNNING]: 'cleaning',
  [S.PAUSED]: 'paused',
  [S.ERROR]: 'error',
  [S.RETURNING_TO_DOCK]: 'returning',
  [S.CHARGING]: 'charging',
  [S.DOCKED]: 'docked',
};
export const SIMPLE_STATUSES = Object.values(SIMPLE_STATUS_BY_GLADYS_STATE);

export const simpleStatusOf = (device) => SIMPLE_STATUS_BY_GLADYS_STATE[gladysStateOf(device)];

// Human labels (widget, action messages). Keys are the protocol slugs.
export const SIMPLE_STATUS_LABELS = {
  stopped: { en: 'Stopped', fr: 'Arrêté' },
  cleaning: { en: 'Cleaning', fr: 'Nettoyage' },
  paused: { en: 'Paused', fr: 'En pause' },
  error: { en: 'Error', fr: 'Erreur' },
  returning: { en: 'Returning', fr: 'Retour en cours' },
  charging: { en: 'Charging', fr: 'En charge' },
  docked: { en: 'Docked', fr: 'À la base' },
};

export const STATUS_LABELS = {
  unknown: { en: 'Unknown', fr: 'Inconnu' },
  standby: { en: 'Standby', fr: 'En veille' },
  goto_charge: { en: 'Going to charge', fr: 'Part se recharger' },
  charging: { en: 'Charging', fr: 'En charge' },
  charge_done: { en: 'Fully charged', fr: 'Charge terminée' },
  paused: { en: 'Paused', fr: 'En pause' },
  cleaning: { en: 'Cleaning', fr: 'Nettoyage' },
  sleep: { en: 'Sleeping', fr: 'En sommeil' },
  return_trip: { en: 'Returning', fr: 'Retour en cours' },
  clean_done: { en: 'Cleaning done', fr: 'Nettoyage terminé' },
  remote_control: { en: 'Remote control', fr: 'Pilotage manuel' },
  clean_wait: { en: 'Waiting to clean', fr: 'En attente de nettoyage' },
  wifi_connect: { en: 'Connecting to Wi-Fi', fr: 'Connexion Wi-Fi' },
  diving: { en: 'Diving', fr: 'Plongée' },
  emerge: { en: 'Surfacing', fr: 'Remontée' },
  auto_dock: { en: 'Docking', fr: 'Accostage' },
  finish_connect: { en: 'Connected, returning', fr: 'Connecté, retour' },
  dock: { en: 'At the base', fr: 'Sur la base' },
  self_cleaning: { en: 'Self-cleaning', fr: 'Auto-nettoyage' },
  replenish_energy: { en: 'Recharging (solar)', fr: 'Recharge (solaire)' },
  chase_light: { en: 'Following the light', fr: 'Suit la lumière' },
  dock_done: { en: 'Docked', fr: 'Amarré' },
  uncheck: { en: 'Not checked', fr: 'Non vérifiée' },
  self_checking: { en: 'Self-check', fr: 'Autotest' },
  check_down: { en: 'Self-check done', fr: 'Autotest terminé' },
};

export const ERROR_LABELS = {
  dust_box_full: { en: 'Filter basket full', fr: 'Panier filtrant plein' },
  dust_box_loss: { en: 'Filter basket missing', fr: 'Panier filtrant absent' },
  power_low: { en: 'Battery low', fr: 'Batterie faible' },
  power_cutting: { en: 'Power cut', fr: "Coupure d'alimentation" },
  env_high_temperature: { en: 'Water too hot', fr: 'Eau trop chaude' },
  env_low_temperature: { en: 'Water too cold', fr: 'Eau trop froide' },
  motor_error: { en: 'Motor fault', fr: 'Défaut moteur' },
  motor_wheel_left: { en: 'Left track motor fault', fr: 'Défaut moteur chenille gauche' },
  motor_wheel_right: { en: 'Right track motor fault', fr: 'Défaut moteur chenille droite' },
  motor_thruster_left: { en: 'Left thruster fault', fr: 'Défaut propulseur gauche' },
  motor_thruster_right: { en: 'Right thruster fault', fr: 'Défaut propulseur droit' },
  motor_pump: { en: 'Pump motor fault', fr: 'Défaut moteur de pompe' },
  motor_airpump_left: { en: 'Left air pump fault', fr: 'Défaut pompe à air gauche' },
  motor_airpump_right: { en: 'Right air pump fault', fr: 'Défaut pompe à air droite' },
  motor_brush: { en: 'Brush motor fault', fr: 'Défaut moteur de brosse' },
  motor_reagent: { en: 'Clarifier dispenser fault', fr: 'Défaut du diffuseur de clarifiant' },
  motor_rod: { en: 'Rod motor fault', fr: 'Défaut moteur de tige' },
  enter_shawdow_water_error: { en: 'Shallow water', fr: 'Eau trop peu profonde' },
  trapped: { en: 'Robot stuck', fr: 'Robot coincé' },
  charge_high_temperature: { en: 'Charging too hot', fr: 'Charge : trop chaud' },
  charge_low_temperature: { en: 'Charging too cold', fr: 'Charge : trop froid' },
  motor_thruster: { en: 'Thruster fault', fr: 'Défaut propulseur' },
  platform_clean_err: { en: 'Platform cleaning fault', fr: 'Défaut nettoyage plateforme' },
  self_err_spray: { en: 'Station: spray fault', fr: 'Station : défaut de pulvérisation' },
  self_err_lever: { en: 'Station: lever fault', fr: 'Station : défaut du levier' },
  self_err_pusher: { en: 'Station: pusher fault', fr: 'Station : défaut du poussoir' },
  self_err_clean_conflict: {
    en: 'Station: cleaning conflict',
    fr: 'Station : conflit de nettoyage',
  },
  err_dust_not_install: { en: 'Station: bin missing', fr: 'Station : bac absent' },
};

/**
 * The label of a status / error key in one language (English fallback, the
 * raw key for a value newer than this table).
 */
export function labelOf(table, key, language = 'en') {
  const label = table[key];
  if (!label) {
    return key;
  }
  return label[language] ?? label.en;
}
