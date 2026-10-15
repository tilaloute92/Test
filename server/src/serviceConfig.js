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

/** Heure de clôture du vote de la météo, le vendredi (voir meteoVotes.js). Après elle, le
 *  rapport de réunion affiche la météo votée ; avant, il annonce le vote en cours. */
const METEO_CLOTURE_DEFAUT = 15;

export function getServiceConfig() {
  const stocke = readJson(FILE, {})[CLE] ?? {};
  const brut = Number(stocke.seuilPresence);
  const heure = Number(stocke.meteoCloture);
  return {
    // Bornes larges mais réelles : 0 désactiverait l'alerte sans le dire, et au-delà de 1
    // elle se déclencherait tous les jours.
    seuilPresence: Number.isFinite(brut) && brut > 0 && brut <= 1 ? brut : SEUIL_PRESENCE_DEFAUT,
    // Heure pleine : une clôture à 15 h 20 n'apporterait rien et compliquerait l'affichage.
    meteoCloture: Number.isInteger(heure) && heure >= 1 && heure <= 23 ? heure : METEO_CLOTURE_DEFAUT,
    parDefaut: stocke.seuilPresence === undefined,
  };
}

export function setServiceConfig({ seuilPresence, meteoCloture }) {
  const tout = readJson(FILE, {});
  const prochain = { ...(tout[CLE] ?? {}) };

  if (seuilPresence !== undefined) {
    const valeur = Number(seuilPresence);
    if (!Number.isFinite(valeur) || valeur <= 0 || valeur > 1) {
      throw new Error('Le seuil de présence doit être compris entre 1 et 100 %.');
    }
    prochain.seuilPresence = valeur;
  }

  if (meteoCloture !== undefined) {
    const heure = Number(meteoCloture);
    if (!Number.isInteger(heure) || heure < 1 || heure > 23) {
      throw new Error('L\'heure de clôture du vote doit être une heure pleine, entre 1 h et 23 h.');
    }
    prochain.meteoCloture = heure;
  }

  tout[CLE] = prochain;
  writeJson(FILE, tout);
  return getServiceConfig();
}
