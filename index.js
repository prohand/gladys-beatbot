// -----------------------------------------------------------------------------
// Entry point of the Beatbot integration for Gladys Assistant.
//
// Role of this file: wire the SDK to the Beatbot service (src/service.js). It
// holds NO cloud logic. It only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects, then (re)starts the service with the stored configuration.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { BeatbotService } from './src/service.js';
import { ACTIONS } from './src/capabilities/actions.js';
import { SCENE_ACTIONS } from './src/capabilities/scenes.js';
import { WIDGETS, refreshWidgets } from './src/capabilities/widget.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

const service = new BeatbotService({
  gladys,
  getConfig: () => config,
  // A device changed: the widget's computed rows follow.
  onChange: () => refreshWidgets(gladys),
});

// --- OAuth2: the "Connect" button of the Configuration screen ----------------
// Gladys relays the browser flow: it asks for the authorization URL (with its
// own redirect URI), then hands back the code. Tokens are stored off-schema.
gladys.onOAuthAuthorizeUrl(async (_key, redirectUri) => service.getAuthorizeUrl(redirectUri));

gladys.onOAuthCallback(async (_key, params) => {
  logger.info('Beatbot sign-in callback received');
  await service.completeAuthorization(params);
});

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> reading the Beatbot account');
  await service.sync({ discover: true });
});

// --- Command: the user acts on a controllable feature ------------------------
// Throwing sends a success:false acknowledgement to Gladys.
gladys.onSetValue((device, feature, value) => service.setValue(device, feature, value));

// --- Manifest actions: buttons in the Configuration screen -------------------
for (const [actionKey, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(actionKey, (fields) => handler(service, { fields }));
}

// --- Scene actions (Gladys 5.1+) ---------------------------------------------
// Scene TRIGGERS need no handler: the service fires them on transitions.
for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) => handler(service, { fields }));
}

// --- Dashboard widgets (Gladys 5.1+) -----------------------------------------
for (const [widgetKey, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(widgetKey, (request) => widget.get(service, request));
  gladys.onWidgetAction(widgetKey, (actionKey, params, { settings, values }) =>
    widget.action(service, { actionKey, params, settings, values }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  const next = normalizeConfig(newConfig);
  // The token writes of the integration itself come back here too: only a
  // change of what the USER sets restarts the service.
  const changed =
    next.region !== config.region ||
    next.client_id !== config.client_id ||
    next.refresh_interval !== config.refresh_interval;
  config = next;
  if (changed) {
    logger.info('onConfigUpdated -> restarting with the new configuration');
    await service.start();
    refreshWidgets(gladys);
  }
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (under the `gladys-sdk` name).
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    await service.start();
    // Nudges sent while the socket to Gladys was down were dropped.
    refreshWidgets(gladys);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Protokolle der Integration an.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  service.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  service.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Beatbot integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
