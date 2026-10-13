import { readJson, writeJson } from '../dataStore.js';

const FILE = 'config.json';
const CLE = 'rapportReunion';

/**
 * Ce qui doit survivre d'un envoi de rapport à l'autre : la liste des destinataires
 * extérieurs à l'équipe, et l'historique des envois.
 *
 * La liste est enregistrée parce que personne ne retape l'adresse de la direction toutes
 * les semaines, et qu'une adresse retapée est une adresse mal tapée. L'historique parce
 * qu'un rapport recalculé à chaque ouverture ne dit pas ce qui a été ENVOYÉ : sans trace,
 * impossible de répondre en novembre à « qu'est-ce qu'on vous avait annoncé en octobre ? ».
 */

/** Au-delà, le fichier de configuration grossit sans qu'on relise jamais les anciens. */
const MAX_ENVOIS = 30;

function lire() {
  const stocke = readJson(FILE, {})[CLE] ?? {};
  return {
    destinatairesExternes: Array.isArray(stocke.destinatairesExternes) ? stocke.destinatairesExternes : [],
    envois: Array.isArray(stocke.envois) ? stocke.envois : [],
  };
}

function ecrire(etat) {
  const tout = readJson(FILE, {});
  tout[CLE] = etat;
  writeJson(FILE, tout);
  return etat;
}

export function getReunionConfig() {
  const { destinatairesExternes, envois } = lire();
  return { destinatairesExternes, dernierEnvoi: envois[0] ?? null };
}

/** Adresses extérieures à l'équipe. Réservé à l'administrateur côté route : ajouter une
 *  adresse, c'est décider qui reçoit l'activité de l'équipe. */
export function setDestinatairesExternes(adresses) {
  const etat = lire();
  const propres = [...new Set(adresses.map((a) => String(a).trim()).filter(Boolean))];
  return ecrire({ ...etat, destinatairesExternes: propres }).destinatairesExternes;
}

/**
 * Trace d'un envoi. Le document complet y est conservé tel qu'il est parti : c'est le
 * seul exemplaire qui ne sera jamais recalculé, donc le seul qui dira encore dans six mois
 * ce qu'on avait annoncé.
 */
export function enregistrerEnvoi({ par, objet, destinataires, resultats, document }) {
  const etat = lire();
  const envoi = {
    id: `${Date.now()}`,
    envoyeLe: new Date().toISOString(),
    par: par || '',
    objet,
    destinataires,
    resultats,
    echecs: resultats.filter((r) => r.statut === 'echec').length,
    document,
  };
  ecrire({ ...etat, envois: [envoi, ...etat.envois].slice(0, MAX_ENVOIS) });
  return envoi;
}

/** Liste sans les documents : les renvoyer tous ferait une réponse de plusieurs mégaoctets. */
export function listerEnvois() {
  return lire().envois.map(({ document, ...reste }) => ({ ...reste, taille: document ? document.length : 0 }));
}

export function lireEnvoi(id) {
  return lire().envois.find((e) => e.id === id) ?? null;
}
