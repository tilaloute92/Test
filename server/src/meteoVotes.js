import crypto from 'node:crypto';
import { readJsonEquipe, writeJsonEquipe } from './dataStore.js';

/**
 * PAR ÉQUIPE. Les voix étaient indexées par semaine seulement : deux équipes votant la
 * même semaine auraient vu leurs voix fusionnées dans un agrégat unique, et chacune
 * aurait lu la météo de l'autre. Les fichiers vivent donc dans le dossier de l'équipe.
 */
import { config } from './config.js';
import { getServiceConfig } from './serviceConfig.js';
import * as store from './businessData.js';

/**
 * Météo de la semaine votée par l'équipe, ANONYMEMENT.
 *
 * Tout ce fichier existe pour une seule raison : il doit être impossible de savoir qui a
 * voté quoi, y compris pour l'administrateur du serveur, fichiers de données sous les yeux.
 * D'où trois choix qui paraîtraient inutilement contournés sans cela :
 *
 * 1. DEUX FICHIERS SÉPARÉS. Les voix (`meteo-votes.json`) ne portent aucune identité. La
 *    liste des personnes ayant déjà voté (`meteo-jetons.json`) ne contient aucune voix. Ni
 *    l'un ni l'autre ne permet le rapprochement, et on ne les écrit jamais dans le même
 *    ordre (voir 3).
 * 2. DES JETONS À SENS UNIQUE. On n'enregistre pas « r.nelson a voté » mais l'empreinte
 *    HMAC-SHA256 de son identifiant, de la semaine et du secret du serveur. Elle suffit à
 *    refuser un second vote ; elle ne se retourne pas en identifiant. Le secret est celui
 *    des sessions : s'il fuite, le problème est déjà bien plus grave que l'anonymat d'un
 *    vote, et en avoir un second à protéger n'aurait rien amélioré.
 * 3. AUCUN HORODATAGE, ORDRE MÉLANGÉ À CHAQUE ÉCRITURE. À cinq, l'ordre d'arrivée des voix
 *    suffirait à les attribuer : la première voix du jeudi matin est celle de la personne
 *    qui ouvre l'application en arrivant. On brasse donc la liste à chaque dépôt et on
 *    n'écrit pas de date.
 *
 * Reste la possibilité de CHANGER sa voix, qui exige de savoir laquelle est la sienne. Le
 * serveur ne le sait pas : il renvoie au navigateur, une seule fois, un identifiant
 * aléatoire sans rapport avec la personne. Le navigateur le garde dans son stockage local.
 * Qui le perd ne peut plus modifier sa voix — c'est le prix, et l'interface le dit.
 */

const FICHIER_VOIX = 'meteo-votes.json';
const FICHIER_JETONS = 'meteo-jetons.json';

export const NIVEAUX = ['ensoleille', 'eclaircies', 'nuageux', 'orageux'];

/** Longueur maximale du mot facultatif laissé avec la voix. */
export const MOT_MAX = 200;

/** Jeudi : le vote ouvre deux jours avant la réunion du vendredi. */
const JOUR_OUVERTURE = 4;
/** Vendredi, jour de la réunion (voir src/lib/meetingReport.ts). */
const JOUR_CLOTURE = 5;

/** Semaines conservées. Au-delà, les voix sont effacées : une météo de l'an dernier
 *  n'intéresse personne, et moins il reste de voix stockées, moins il y a à protéger. */
const SEMAINES_CONSERVEES = 53;

export function estLundiIso(valeur) {
  if (typeof valeur !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return false;
  const d = new Date(`${valeur}T00:00:00`);
  return !Number.isNaN(d.getTime()) && d.getDay() === 1;
}

/**
 * Fenêtre de vote de la semaine : du jeudi 0 h au vendredi à l'heure de clôture.
 * Calculée ici et pas dans le navigateur : une horloge de poste mal réglée, ou avancée
 * exprès, rouvrirait sinon un vote clos.
 */
export function fenetre(equipe, semaine) {
  // L'heure de clôture est un réglage de service : elle appartient à l'équipe.
  const { meteoCloture } = getServiceConfig(equipe);
  const lundi = new Date(`${semaine}T00:00:00`);
  const ouverture = new Date(lundi);
  ouverture.setDate(ouverture.getDate() + (JOUR_OUVERTURE - 1));
  const cloture = new Date(lundi);
  cloture.setDate(cloture.getDate() + (JOUR_CLOTURE - 1));
  cloture.setHours(meteoCloture, 0, 0, 0);
  return { ouverture, cloture, heureCloture: meteoCloture };
}

function etat(equipe, semaine, maintenant = new Date()) {
  const { ouverture, cloture } = fenetre(equipe, semaine);
  if (maintenant < ouverture) return 'a-venir';
  if (maintenant > cloture) return 'clos';
  return 'ouvert';
}

function jeton(username, semaine) {
  return crypto
    .createHmac('sha256', `${config.jwtSecret}|meteo`)
    .update(`${String(username).trim().toLowerCase()}|${semaine}`)
    .digest('hex');
}

/** Mélange de Fisher-Yates. `Math.random` suffit : il ne s'agit pas de résister à une
 *  attaque, seulement d'effacer l'ordre d'arrivée. */
function melanger(liste) {
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

function lireVoix(equipe) {
  return readJsonEquipe(equipe, FICHIER_VOIX, {});
}
function lireJetons(equipe) {
  return readJsonEquipe(equipe, FICHIER_JETONS, {});
}

/** Efface les semaines trop anciennes, des deux fichiers, à chaque écriture. */
function elaguer(objet) {
  const cles = Object.keys(objet).sort();
  while (cles.length > SEMAINES_CONSERVEES) delete objet[cles.shift()];
  return objet;
}

function effectif(equipe) {
  // Le dénominateur, c'est l'équipe telle qu'elle est déclarée dans l'onglet Équipe — et
  // non le nombre de comptes, qui peut inclure un compte de service ou un prestataire.
  return store.getSnapshot(equipe).members.length;
}

/**
 * Ce que tout le monde a le droit de voir : des nombres, des mots sans auteur, et —
 * uniquement pour la personne qui demande — si elle a déjà voté.
 */
export function agregat(equipe, semaine, username, maintenant = new Date()) {
  const voix = lireVoix(equipe)[semaine] ?? [];
  const comptes = Object.fromEntries(NIVEAUX.map((n) => [n, 0]));
  for (const v of voix) if (comptes[v.niveau] !== undefined) comptes[v.niveau] += 1;
  const { ouverture, cloture } = fenetre(equipe, semaine);
  const e = etat(equipe, semaine, maintenant);
  return {
    semaine,
    voix: comptes,
    total: voix.length,
    effectif: effectif(equipe),
    // Mots remélangés à la lecture : deux lectures successives ne donnent pas le même
    // ordre, donc l'ordre n'apprend rien sur qui a écrit quoi.
    mots: melanger(voix.map((v) => v.mot).filter(Boolean)),
    etat: e,
    ouvert: e === 'ouvert',
    ouvertureIso: ouverture.toISOString(),
    clotureIso: cloture.toISOString(),
    aVote: (lireJetons(equipe)[semaine] ?? []).includes(jeton(username, semaine)),
  };
}

function verifierNiveau(niveau) {
  if (!NIVEAUX.includes(niveau)) throw Object.assign(new Error('Niveau de météo inconnu.'), { statut: 400 });
}

function verifierMot(mot) {
  const texte = typeof mot === 'string' ? mot.trim() : '';
  if (texte.length > MOT_MAX) {
    throw Object.assign(new Error(`Le mot laissé avec la voix ne peut pas dépasser ${MOT_MAX} caractères.`), { statut: 400 });
  }
  return texte;
}

export function deposer({ equipe, semaine, username, niveau, mot }) {
  verifierNiveau(niveau);
  const texte = verifierMot(mot);
  const e = etat(equipe, semaine);
  if (e !== 'ouvert') {
    throw Object.assign(
      new Error(e === 'clos' ? 'Le vote de cette semaine est clos.' : "Le vote de cette semaine n'est pas encore ouvert."),
      { statut: 409 }
    );
  }

  const jetons = lireJetons(equipe);
  const liste = jetons[semaine] ?? [];
  const empreinte = jeton(username, semaine);
  if (liste.includes(empreinte)) {
    throw Object.assign(new Error('Vous avez déjà voté cette semaine.'), { statut: 409 });
  }

  const voixTout = lireVoix(equipe);
  const id = crypto.randomBytes(16).toString('hex');
  voixTout[semaine] = melanger([...(voixTout[semaine] ?? []), { id, niveau, mot: texte }]);
  // Les voix d'abord : si le serveur s'arrête entre les deux écritures, la voix est
  // comptée sans que le jeton le soit — la personne pourrait voter deux fois. L'inverse
  // perdrait une voix sans recours. Entre les deux, on préfère le risque réversible.
  writeJsonEquipe(equipe, FICHIER_VOIX, elaguer(voixTout));
  jetons[semaine] = melanger([...liste, empreinte]);
  writeJsonEquipe(equipe, FICHIER_JETONS, elaguer(jetons));
  return { id, ...agregat(equipe, semaine, username) };
}

/**
 * Changer sa voix, sur présentation de l'identifiant remis au dépôt. Le serveur ne vérifie
 * pas QUI modifie : il ne le peut pas, et c'est voulu. Connaître l'identifiant, c'est avoir
 * déposé cette voix — ou avoir eu accès au navigateur de la personne, auquel cas le vote
 * n'est plus le sujet.
 */
export function modifier({ equipe, semaine, username, id, niveau, mot }) {
  verifierNiveau(niveau);
  const texte = verifierMot(mot);
  if (etat(equipe, semaine) !== 'ouvert') {
    throw Object.assign(new Error('Le vote de cette semaine est clos : votre voix reste telle quelle.'), { statut: 409 });
  }
  const voixTout = lireVoix(equipe);
  const liste = voixTout[semaine] ?? [];
  const index = liste.findIndex((v) => v.id === id);
  if (index < 0) throw Object.assign(new Error('Voix introuvable.'), { statut: 404 });
  liste[index] = { id, niveau, mot: texte };
  voixTout[semaine] = melanger(liste);
  writeJsonEquipe(equipe, FICHIER_VOIX, voixTout);
  return { id, ...agregat(equipe, semaine, username) };
}
