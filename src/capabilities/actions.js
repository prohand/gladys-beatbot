// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
// Each key is declared in the manifest `actions` field; index.js registers
// them with `gladys.onAction(key, ...)`. The resolved message (multi-language)
// is shown under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { BeatbotAuthError } from '../beatbot/errors.js';
import {
  SIMPLE_STATUS_LABELS,
  labelOf,
  simpleStatusOf,
  SUPPORTED_CATEGORIES,
} from '../beatbot/protocol.js';
import { defaultName } from '../devices/poolRobot.js';

const logger = createLogger({ name: 'actions' });

const ONLINE = { en: 'online', fr: 'en ligne', de: 'online', es: 'en línea' };
const OFFLINE = { en: 'offline', fr: 'hors ligne', de: 'offline', es: 'sin conexión' };

const describe = (model, language) => {
  const online = model.isOnline
    ? (ONLINE[language] ?? ONLINE.en)
    : (OFFLINE[language] ?? OFFLINE.en);
  const known = model.workStatus !== null && model.workStatus !== undefined;
  const status = known ? labelOf(SIMPLE_STATUS_LABELS, simpleStatusOf(model), language) : '?';
  const battery = Number.isFinite(model.batteryLevel) ? `, ${model.batteryLevel} %` : '';
  return `${defaultName(model)} (${online}, ${status.toLowerCase()}${battery})`;
};

export const ACTIONS = {
  // Read the account now and say what it holds: the quickest proof that the
  // sign-in, the region and the cloud all work.
  async test_connection(service) {
    const { account } = service;
    if (!account.linked) {
      return {
        en: 'No Beatbot account linked yet: click Connect first.',
        fr: "Aucun compte Beatbot lié : cliquez d'abord sur Connecter.",
        de: 'Noch kein Beatbot-Konto verknüpft: Klicke zuerst auf Verbinden.',
        es: 'Aún no hay ninguna cuenta de Beatbot vinculada: pulse primero Conectar.',
      };
    }
    const region = account.region;
    if (!region) {
      return {
        en: 'The region of the account is unknown: choose it in the Region field and save.',
        fr: 'La région du compte est inconnue : choisissez-la dans le champ Région et enregistrez.',
        de: 'Die Region des Kontos ist unbekannt: Wähle sie im Feld Region und speichere.',
        es: 'La región de la cuenta es desconocida: elíjala en el campo Región y guarde.',
      };
    }
    if (!service.client) {
      await service.start();
    }
    if (!service.client) {
      return {
        en: 'The Beatbot authorization is no longer valid: click Connect again.',
        fr: "L'autorisation Beatbot n'est plus valide : cliquez à nouveau sur Connecter.",
        de: 'Die Beatbot-Autorisierung ist nicht mehr gültig: Klicke erneut auf Verbinden.',
        es: 'La autorización de Beatbot ya no es válida: pulse de nuevo Conectar.',
      };
    }
    try {
      const all = await service.client.getDevices();
      const result = await service.sync({ discover: true });
      if (result === 'auth') {
        throw new BeatbotAuthError('authorization lost');
      }
      const supported = [...service.devices.values()];
      const ignored = all.filter((m) => !SUPPORTED_CATEGORIES.includes(m.productCategory)).length;
      const list = (language) =>
        supported.length ? supported.map((m) => describe(m, language)).join(', ') : '-';
      return {
        en:
          `Connected (region ${region.toUpperCase()}). ${supported.length} device(s): ${list('en')}.` +
          (ignored ? ` ${ignored} unsupported device(s) ignored.` : ''),
        fr:
          `Connecté (région ${region.toUpperCase()}). ${supported.length} appareil(s) : ${list('fr')}.` +
          (ignored ? ` ${ignored} appareil(s) non pris en charge ignoré(s).` : ''),
        de:
          `Verbunden (Region ${region.toUpperCase()}). ${supported.length} Gerät(e): ${list('de')}.` +
          (ignored ? ` ${ignored} nicht unterstützte(s) Gerät(e) ignoriert.` : ''),
        es:
          `Conectado (región ${region.toUpperCase()}). ${supported.length} dispositivo(s): ${list('es')}.` +
          (ignored ? ` ${ignored} dispositivo(s) no compatible(s) ignorado(s).` : ''),
      };
    } catch (err) {
      logger.warn(`Test the connection failed: ${err.message}`);
      if (err instanceof BeatbotAuthError) {
        return {
          en: 'The Beatbot authorization is no longer valid: click Connect again.',
          fr: "L'autorisation Beatbot n'est plus valide : cliquez à nouveau sur Connecter.",
          de: 'Die Beatbot-Autorisierung ist nicht mehr gültig: Klicke erneut auf Verbinden.',
          es: 'La autorización de Beatbot ya no es válida: pulse de nuevo Conectar.',
        };
      }
      return {
        en: `The Beatbot cloud did not answer: ${err.message}`,
        fr: `Le cloud Beatbot n'a pas répondu : ${err.message}`,
        de: `Die Beatbot-Cloud hat nicht geantwortet: ${err.message}`,
        es: `La nube de Beatbot no ha respondido: ${err.message}`,
      };
    }
  },
};
