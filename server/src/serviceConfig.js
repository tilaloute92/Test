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

/**
 * Créneaux récurrents — voir src/lib/recurrences.ts, qui explique pourquoi ce n'est ni une
 * tâche ni une absence. Rangé ici plutôt que dans les données métier parce que c'est une
 * RÈGLE du service, pas un enregistrement : rien n'est écrit chaque semaine.
 */
const RECURRENCES_DEFAUT = [
  { id: 'reunion-hebdo', libelle: "Réunion d'équipe", jour: 5, debut: 14.5, duree: 1.5, participants: null },
];

function recurrenceValide(r) {
  return (
    r &&
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.libelle === 'string' &&
    r.libelle.trim().length > 0 &&
    Number.isInteger(r.jour) &&
    r.jour >= 1 &&
    r.jour <= 5 &&
    Number.isFinite(r.debut) &&
    r.debut >= 6 &&
    r.debut < 20 &&
    Number.isFinite(r.duree) &&
    r.duree > 0 &&
    r.duree <= 8 &&
    (r.participants === null || (Array.isArray(r.participants) && r.participants.every((x) => typeof x === 'string')))
  );
}

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
    // Liste absente = le service n'y a jamais touché : on sert la réunion d'équipe du
    // vendredi, qui existe de toute façon. Une liste VIDE est un choix délibéré et doit le
    // rester — la repeupler reviendrait à réimposer un créneau que l'administrateur a
    // supprimé.
    recurrences: Array.isArray(stocke.recurrences) ? stocke.recurrences.filter(recurrenceValide) : RECURRENCES_DEFAUT,
    parDefaut: stocke.seuilPresence === undefined,
  };
}

export function setServiceConfig({ seuilPresence, meteoCloture, recurrences }) {
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

  if (recurrences !== undefined) {
    if (!Array.isArray(recurrences)) throw new Error('Les créneaux récurrents doivent être envoyés sous forme de liste.');
    const mauvais = recurrences.findIndex((r) => !recurrenceValide(r));
    if (mauvais >= 0) throw new Error(`Créneau récurrent n°${mauvais + 1} incomplet ou hors limites.`);
    const ids = new Set(recurrences.map((r) => r.id));
    if (ids.size !== recurrences.length) throw new Error('Deux créneaux récurrents portent le même identifiant.');
    prochain.recurrences = recurrences.map((r) => ({
      id: r.id,
      libelle: r.libelle.trim(),
      jour: r.jour,
      debut: r.debut,
      duree: r.duree,
      participants: r.participants === null ? null : [...r.participants],
    }));
  }

  tout[CLE] = prochain;
  writeJson(FILE, tout);
  return getServiceConfig();
}
