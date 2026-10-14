import { readJson, writeJson } from './dataStore.js';

const FILE = 'config.json';
const CLE = 'service';

/**
 * Règles de fonctionnement du service, décidées par l'administrateur et valables pour
 * toute l'équipe.
 *
 * Côté serveur et non dans le navigateur : un seuil de présence est une règle de service,
 * pas une préférence d'affichage. Rangé dans le stockage local, chacun aurait le sien et
 * deux personnes regardant le même planning n'y verraient pas la même alerte.
 */

/** En dessous, il n'y a plus personne pour prendre un incident pendant qu'un autre est
 *  déjà dessus. Valeur de départ, modifiable depuis la page Paramètres. */
const SEUIL_PRESENCE_DEFAUT = 0.5;

export function getServiceConfig() {
  const stocke = readJson(FILE, {})[CLE] ?? {};
  const brut = Number(stocke.seuilPresence);
  return {
    // Bornes larges mais réelles : 0 désactiverait l'alerte sans le dire, et au-delà de 1
    // elle se déclencherait tous les jours.
    seuilPresence: Number.isFinite(brut) && brut > 0 && brut <= 1 ? brut : SEUIL_PRESENCE_DEFAUT,
    parDefaut: stocke.seuilPresence === undefined,
  };
}

export function setServiceConfig({ seuilPresence }) {
  const valeur = Number(seuilPresence);
  if (!Number.isFinite(valeur) || valeur <= 0 || valeur > 1) {
    throw new Error('Le seuil de présence doit être compris entre 1 et 100 %.');
  }
  const tout = readJson(FILE, {});
  tout[CLE] = { ...(tout[CLE] ?? {}), seuilPresence: valeur };
  writeJson(FILE, tout);
  return getServiceConfig();
}
