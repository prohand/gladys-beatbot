// -----------------------------------------------------------------------------
// The Beatbot service: keeps the Gladys devices in step with the cloud.
//
//   - discovery + states over REST, at start-up and every `refresh_interval`
//     minutes (reconciliation: an event missed while the link was down is
//     caught there); only the values that changed reach Gladys;
//   - the account event stream for everything in between, in real time;
//   - Gladys commands -> Beatbot actions, then one state read a few seconds
//     later (the robot does not report the new state the instant it obeys);
//   - scene events on transitions, transport badges (cloud / unreachable),
//     the connection status shown in the Configuration screen.
//
// Holds no Gladys wiring of its own: index.js registers the handlers.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { BeatbotAccount } from './beatbot/account.js';
import { BeatbotClient, applyStates } from './beatbot/client.js';
import { INTERFACE } from './beatbot/const.js';
import { BeatbotEventStream } from './beatbot/eventStream.js';
import { BeatbotAuthError } from './beatbot/errors.js';
import {
  buildDevice,
  canControl,
  commandFor,
  defaultName,
  deviceExternalId,
  deviceIdOf,
  isSupported,
  statesOf,
} from './devices/poolRobot.js';
import { SceneTriggerTracker } from './capabilities/triggers.js';

const logger = createLogger({ name: 'service' });

// Delay before reading a device back after a command.
export const POST_COMMAND_REFRESH_MS = 5_000;
// device_added / device_removed often come in bursts: one discovery for all.
const DISCOVERY_DEBOUNCE_MS = 2_000;
const MAX_BATCH = 100;
// States go through publishChangedStates: the reconciliation timer and every
// pushed event re-read whole devices, and Gladys writes one row per state it
// receives (300 states a minute at most). An unchanged value is still re-sent
// after this long, so a stable one never looks stale in Gladys.
export const STATE_HEARTBEAT_MS = 30 * 60_000;

export const MESSAGES = {
  NOT_LINKED: {
    en: 'Click Connect to link your Beatbot account.',
    fr: 'Cliquez sur Connecter pour lier votre compte Beatbot.',
    de: 'Klicke auf Verbinden, um dein Beatbot-Konto zu verknüpfen.',
    es: 'Pulse Conectar para vincular su cuenta de Beatbot.',
  },
  UNKNOWN_REGION: {
    en: 'Your Beatbot account did not give its region: choose it in the Region field.',
    fr: "Votre compte Beatbot n'a pas indiqué sa région : choisissez-la dans le champ Région.",
    de: 'Dein Beatbot-Konto hat seine Region nicht angegeben: Wähle sie im Feld Region.',
    es: 'Su cuenta de Beatbot no ha indicado su región: elíjala en el campo Región.',
  },
  AUTH_LOST: {
    en: 'The Beatbot authorization expired or was revoked: click Connect again.',
    fr: "L'autorisation Beatbot a expiré ou a été révoquée : cliquez à nouveau sur Connecter.",
    de: 'Die Beatbot-Autorisierung ist abgelaufen oder wurde widerrufen: Klicke erneut auf Verbinden.',
    es: 'La autorización de Beatbot ha caducado o se ha revocado: pulse de nuevo Conectar.',
  },
  UNREACHABLE: {
    en: 'Beatbot cloud unreachable, retrying.',
    fr: 'Cloud Beatbot injoignable, nouvel essai en cours.',
    de: 'Beatbot-Cloud nicht erreichbar, neuer Versuch läuft.',
    es: 'Nube de Beatbot inaccesible, reintentando.',
  },
};

const chunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
};

export class BeatbotService {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK instance
   * @param {() => object} options.getConfig current normalized config
   * @param {() => void} [options.onChange] called when a device changed (widgets)
   * @param {typeof fetch} [options.fetchImpl]
   * @param {typeof WebSocket} [options.WebSocketImpl]
   * @param {() => number} [options.now]
   */
  constructor({ gladys, getConfig, onChange = () => {}, fetchImpl, WebSocketImpl, now }) {
    this.gladys = gladys;
    this.getConfig = getConfig;
    this.onChange = onChange;
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.now = now ?? Date.now;
    this.account = new BeatbotAccount({ gladys, getConfig, fetchImpl, now: this.now });
    this.tracker = new SceneTriggerTracker(gladys, this.now);
    this.devices = new Map();
    this.client = null;
    this.stream = null;
    this.reconcileTimer = null;
    this.discoveryTimer = null;
    this.refreshTimers = new Map();
    // What the Configuration screen shows: null = not reported yet.
    this.connected = null;
    this.lastSyncAt = null;
    this.streamState = 'stopped';
  }

  // --- Lifecycle -------------------------------------------------------------

  /** (Re)start everything from the current config. */
  async start() {
    this.stop();
    // Report the status again even if unchanged: Gladys may have restarted.
    this.connected = null;
    this.account.load(this.getConfig());
    if (!this.account.linked) {
      await this.report(false, MESSAGES.NOT_LINKED);
      return;
    }
    const region = this.account.region;
    if (!region) {
      await this.report(false, MESSAGES.UNKNOWN_REGION);
      return;
    }
    this.client = new BeatbotClient({
      region,
      getAccessToken: () => this.account.getAccessToken(),
      refreshAccessToken: (rejected) => this.account.refresh(rejected),
      fetchImpl: this.fetchImpl,
    });
    logger.info(`Starting (region ${region})`);

    const synced = await this.sync({ discover: true });
    if (synced === 'auth') {
      return; // reported; only a new sign-in restarts the service
    }
    this.startStream();
    this.scheduleReconciliation();
  }

  stop() {
    this.stream?.stop();
    this.stream = null;
    this.streamState = 'stopped';
    clearInterval(this.reconcileTimer);
    clearTimeout(this.discoveryTimer);
    this.reconcileTimer = null;
    this.discoveryTimer = null;
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
    this.client = null;
  }

  startStream() {
    this.stream = new BeatbotEventStream({
      url: this.client.eventStreamUrl,
      getAccessToken: () => this.account.getAccessToken(),
      refreshAccessToken: (rejected) => this.account.refresh(rejected),
      onEvent: (event) => this.handleEvent(event),
      onConnected: ({ reconnect }) => {
        this.streamState = 'connected';
        // Events sent while the link was down are lost: read everything back.
        return reconnect ? this.sync({ discover: false }) : undefined;
      },
      onStopped: (reason) => {
        this.streamState = reason;
        if (reason === 'auth') {
          this.authLost();
        }
      },
      ...(this.WebSocketImpl ? { WebSocketImpl: this.WebSocketImpl } : {}),
    });
    this.streamState = 'connecting';
    this.stream.start();
  }

  scheduleReconciliation() {
    const minutes = this.getConfig().refresh_interval;
    this.reconcileTimer = setInterval(() => {
      this.sync({ discover: true });
    }, minutes * 60_000);
  }

  async authLost() {
    logger.warn('Beatbot authorization lost: waiting for a new sign-in');
    this.stop();
    await this.report(false, MESSAGES.AUTH_LOST);
  }

  async report(connected, message) {
    if (this.connected === connected && connected) {
      return;
    }
    this.connected = connected;
    try {
      await this.gladys.setConnectionStatus(connected, connected ? undefined : message);
    } catch (err) {
      logger.warn(`Could not report the connection status: ${err.message}`);
    }
  }

  // --- OAuth (relayed by Gladys) --------------------------------------------

  getAuthorizeUrl(redirectUri) {
    if (!redirectUri) {
      throw new Error('Gladys sent no redirect URI for the Beatbot sign-in');
    }
    return this.account.startAuthorization(redirectUri);
  }

  async completeAuthorization(params) {
    await this.account.completeAuthorization(params);
    // A new account may own other devices: start from scratch.
    this.devices.clear();
    await this.start();
  }

  // --- Cloud -> Gladys -------------------------------------------------------

  /**
   * Read the account (discovery when asked) and every state, then publish.
   * @returns {Promise<'ok' | 'auth' | 'error'>}
   */
  async sync({ discover }) {
    const client = this.client;
    if (!client) {
      return 'error';
    }
    try {
      if (discover) {
        await this.discover(client);
      }
      const states = await client.getDeviceStates();
      if (client !== this.client) {
        return 'error'; // stopped meanwhile
      }
      for (const [deviceId, { isOnline, states: values }] of Object.entries(states)) {
        const model = this.devices.get(deviceId);
        if (model) {
          applyStates(model, values, typeof isOnline === 'boolean' ? isOnline : undefined);
        }
      }
      await this.publishAll();
      this.lastSyncAt = this.now();
      await this.report(true);
      return 'ok';
    } catch (err) {
      if (err instanceof BeatbotAuthError) {
        await this.authLost();
        return 'auth';
      }
      logger.warn(`Beatbot sync failed: ${err.message}`);
      await this.report(false, MESSAGES.UNREACHABLE);
      return 'error';
    }
  }

  async discover(client) {
    const found = (await client.getDevices()).filter((model) => {
      if (!isSupported(model)) {
        logger.info(`Ignoring ${model.deviceId}: category "${model.productCategory}" unsupported`);
        return false;
      }
      return true;
    });
    if (client !== this.client) {
      return;
    }
    const next = new Map();
    for (const model of found) {
      const known = this.devices.get(model.deviceId);
      if (known) {
        // Keep the runtime state: discovery carries none.
        for (const field of [
          'workStatus',
          'workMode',
          'errorCode',
          'batteryLevel',
          'childLock',
          'voiceDisturb',
        ]) {
          model[field] = known[field];
        }
      }
      next.set(model.deviceId, model);
    }
    for (const deviceId of this.devices.keys()) {
      if (!next.has(deviceId)) {
        this.tracker.forget(deviceId);
      }
    }
    this.devices = next;
    logger.info(`Beatbot account: ${next.size} device(s)`);
    await this.gladys.publishDiscoveredDevices(
      [...next.values()].map((model) => buildDevice(this.gladys, model)),
    );
  }

  async publishAll() {
    const models = [...this.devices.values()];
    const states = models.flatMap((model) => statesOf(this.gladys, model));
    // The SDK splits it into requests of 100 states.
    await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    await this.publishTransports(models);
    for (const model of models) {
      await this.fireSceneEvents(model);
    }
    this.onChange();
  }

  async publishDevice(model) {
    const states = statesOf(this.gladys, model);
    if (states.length) {
      await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
    await this.fireSceneEvents(model);
    this.onChange();
  }

  /**
   * A device the user just added in Gladys: the states published before it
   * existed were dropped by Gladys (and the SDK forgot them on the creation),
   * so they are sent now rather than at the next event or reconciliation.
   * @param {string} externalId device external id
   */
  async publishCreated(externalId) {
    const model = this.devices.get(deviceIdOf(this.gladys, externalId));
    if (!model) {
      return;
    }
    const states = statesOf(this.gladys, model);
    if (states.length) {
      await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
    await this.publishTransports([model]);
  }

  async publishTransports(models) {
    const entries = models.map((model) => ({
      external_id: deviceExternalId(this.gladys, model.deviceId),
      transport: model.isOnline ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE,
    }));
    for (const batch of chunks(entries, MAX_BATCH)) {
      try {
        await this.gladys.publishTransports(batch);
      } catch (err) {
        // A refused badge is cosmetic: never fail a sync for it.
        logger.warn(`Transport badges refused: ${err.message}`);
      }
    }
  }

  async fireSceneEvents(model) {
    for (const { key, data } of this.tracker.observe(model)) {
      try {
        await this.gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Scene event ${key} refused: ${err.message}`);
      }
    }
  }

  async handleEvent(event) {
    if (event.type === 'device_added' || event.type === 'device_removed') {
      this.scheduleDiscovery();
      return;
    }
    const model = this.devices.get(event.deviceId);
    if (!model) {
      this.scheduleDiscovery(); // a device discovery has not caught yet
      return;
    }
    if (event.type === 'properties_changed') {
      const changed = applyStates(model, { [event.payload.interfaceInfo]: event.payload.value });
      if (changed.length) {
        await this.publishDevice(model);
      }
    } else if (event.type === 'status') {
      const changed = applyStates(model, null, event.payload.online);
      if (changed.length) {
        await this.publishTransports([model]);
        this.onChange();
      }
    }
  }

  scheduleDiscovery() {
    clearTimeout(this.discoveryTimer);
    this.discoveryTimer = setTimeout(() => {
      this.discoveryTimer = null;
      this.sync({ discover: true });
    }, DISCOVERY_DEBOUNCE_MS);
  }

  /** Read one device back a few seconds after a command (debounced). */
  scheduleStateRefresh(deviceId) {
    clearTimeout(this.refreshTimers.get(deviceId));
    this.refreshTimers.set(
      deviceId,
      setTimeout(async () => {
        this.refreshTimers.delete(deviceId);
        const client = this.client;
        const model = this.devices.get(deviceId);
        if (!client || !model) {
          return;
        }
        try {
          const { isOnline, states } = await client.getDeviceState(deviceId);
          const changed = applyStates(
            model,
            states,
            typeof isOnline === 'boolean' ? isOnline : undefined,
          );
          if (changed.includes('isOnline')) {
            await this.publishTransports([model]);
          }
          if (changed.length) {
            await this.publishDevice(model);
          }
        } catch (err) {
          logger.warn(`State read-back of ${deviceId} failed: ${err.message}`);
        }
      }, POST_COMMAND_REFRESH_MS),
    );
  }

  // --- Gladys -> cloud -------------------------------------------------------

  requireClient() {
    if (!this.client) {
      throw new Error(
        this.account.linked
          ? 'The Beatbot cloud is not available right now'
          : 'No Beatbot account linked',
      );
    }
    return this.client;
  }

  /** The model behind a Gladys device external id. */
  modelOf(externalId) {
    const deviceId = deviceIdOf(this.gladys, externalId);
    return deviceId ? (this.devices.get(deviceId) ?? null) : null;
  }

  /** Handler of `onSetValue`. */
  async setValue(device, feature, value) {
    const model = this.modelOf(device.external_id);
    if (!model) {
      throw new Error(`Unknown Beatbot device ${device.external_id}`);
    }
    const featureKey = feature.external_id.slice(device.external_id.length + 1);
    const command = commandFor(model, featureKey, value);
    logger.info(`${defaultName(model)}: ${featureKey} <- ${value}`);
    await this.execute(model, command);
  }

  /** Run a translated command, then reflect it. */
  async execute(model, command) {
    const client = this.requireClient();
    switch (command.type) {
      case 'action':
        await client.sendAction(model.deviceId, command.interfaceInfo);
        break;
      case 'work_mode': {
        await client.setWorkMode(model.deviceId, command.label);
        // Accepted: show it now, the event confirms it later.
        const value = [...model.workModeOptions.entries()].find(([, l]) => l === command.label);
        if (value && applyStates(model, { [INTERFACE.WORK_MODE]: value[0] }).length) {
          await this.publishDevice(model);
        }
        break;
      }
      case 'switch':
        await client.setSwitch(model.deviceId, command.interfaceInfo, command.on);
        if (applyStates(model, { [command.interfaceInfo]: command.on }).length) {
          await this.publishDevice(model);
        }
        break;
      default:
        return;
    }
    this.scheduleStateRefresh(model.deviceId);
  }

  /**
   * A parameterless action on a device chosen by its Gladys external id
   * (scenes, widget). Resolves false when the device cannot do it: that is an
   * answer, not a failure.
   */
  async runAction(externalId, interfaceInfo) {
    const model = this.modelOf(externalId);
    if (!model || !canControl(model, interfaceInfo)) {
      return false;
    }
    await this.execute(model, { type: 'action', interfaceInfo });
    return true;
  }

  /** Set the cleaning mode by its label; false when the device has no such mode. */
  async runWorkMode(externalId, label) {
    const model = this.modelOf(externalId);
    const known = [...(model?.workModeOptions?.values() ?? [])];
    const match = known.find((l) => l.toLowerCase() === String(label).trim().toLowerCase());
    if (!model || !match || !canControl(model, INTERFACE.WORK_MODE)) {
      return false;
    }
    await this.execute(model, { type: 'work_mode', label: match });
    return true;
  }
}
