// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the surface the integration relies on and records every call
// so tests can assert them, without a running Gladys or a real WebSocket.
// -----------------------------------------------------------------------------

export function createFakeGladys({ config = {} } = {}) {
  const fake = {
    config: { ...config },
    discovered: [],
    states: [],
    transports: [],
    connectionStatuses: [],
    sceneEvents: [],
    widgetRefreshes: [],
    configWrites: [],
    failSetConfig: false,

    externalIds(type, platformId) {
      const device = `ext:beatbot-test:${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },

    async publishDiscoveredDevices(devices) {
      fake.discovered.push(devices);
    },

    async publishState(featureExternalId, value) {
      fake.states.push(
        typeof value === 'number'
          ? { device_feature_external_id: featureExternalId, state: value }
          : { device_feature_external_id: featureExternalId, ...value },
      );
    },

    async publishStates(states) {
      if (states.length > 100) {
        throw new Error('publishStates: maximum 100 states per request');
      }
      fake.states.push(...states);
    },

    async publishTransports(entries) {
      if (entries.length > 100) {
        throw new Error('publishTransports: maximum 100 transports per request');
      }
      fake.transports.push(...entries);
    },

    async setConnectionStatus(connected, message) {
      fake.connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data = {}) {
      fake.sceneEvents.push({ key, data });
      return { success: true };
    },

    requestWidgetRefresh(key) {
      fake.widgetRefreshes.push(key);
    },

    async getConfig() {
      return { ...fake.config };
    },

    async setConfig(partial) {
      if (fake.failSetConfig) {
        throw new Error('Gladys refused the config');
      }
      fake.configWrites.push(partial);
      Object.assign(fake.config, partial);
      return { success: true };
    },

    /** The last published state of a feature external id. */
    lastState(featureExternalId) {
      return fake.states.findLast((s) => s.device_feature_external_id === featureExternalId);
    },
  };
  return fake;
}
