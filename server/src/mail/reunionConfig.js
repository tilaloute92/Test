import { readJson, readText, removeText, writeJson, writeText } from '../dataStore.js';

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

/** Au-delà, on ne relit jamais les plus anciens. */
const MAX_ENVOIS = 30;

/**
 * Les documents conservés vivent dans des fichiers à part, UN PAR ENVOI, et non dans
 * config.json.
 *
 * Ils pèsent ~35 Ko pièce : trente d'entre eux faisaient un config.json d'un mégaoctet.
 * Or ce fichier est relu et reparsé à chaque contrôle de droit administrateur
 * (voir auth/admin.js) et réécrit en entier au moindre changement de réglage. La trace
 * reste exactement la même pour qui la consulte ; c'est son rangement qui change.
 */
const fichierDocument = (id) => `envoi-${id}.html`;

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
  const id = `${Date.now()}`;
  const envoi = {
    id,
    envoyeLe: new Date().toISOString(),
    par: par || '',
    objet,
    destinataires,
    resultats,
    echecs: resultats.filter((r) => r.statut === 'echec').length,
    taille: document ? document.length : 0,
  };
  if (document) writeText(fichierDocument(id), document);

  const envois = [envoi, ...etat.envois];
  // Les documents des envois sortis de la liste n'ont plus personne pour les ouvrir :
  // les laisser sur le disque ferait grossir le dossier sans fin.
  for (const vieux of envois.slice(MAX_ENVOIS)) {
    try {
      removeText(fichierDocument(vieux.id));
    } catch {
      // Un fichier déjà absent n'est pas une erreur : la trace, elle, est bien retirée.
    }
  }
  ecrire({ ...etat, envois: envois.slice(0, MAX_ENVOIS) });
  return envoi;
}

/** Liste des traces, sans les documents — ils sont dans des fichiers à part. */
export function listerEnvois() {
  return lire().envois.map(({ document, ...reste }) => ({
    ...reste,
    // `document` subsiste sur les traces écrites par les versions précédentes : on en
    // garde la taille, et `lireEnvoi` sait encore le servir.
    taille: reste.taille ?? (document ? document.length : 0),
  }));
}

export function lireEnvoi(id) {
  const envoi = lire().envois.find((e) => e.id === id);
  if (!envoi) return null;
  // Trace d'avant le rangement en fichiers : le document y est encore en ligne.
  const document = envoi.document ?? readText(fichierDocument(envoi.id));
  return { ...envoi, document };
}
