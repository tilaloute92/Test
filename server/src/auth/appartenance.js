import { readJson, writeJson } from '../dataStore.js';
import { EQUIPE_DEFAUT, equipeExiste, listerEquipes } from '../equipes.js';

/**
 * À quelle équipe appartient chaque personne.
 *
 * DEUX SOURCES, dans cet ordre :
 *
 * 1. L'ANNUAIRE. Une correspondance « groupe LDAP → équipe » est déclarée par
 *    l'administrateur de plateforme. À chaque connexion LDAP, le groupe de la personne
 *    est relu et son appartenance réécrite ici. L'annuaire fait donc autorité : c'est là
 *    que les mouvements de personnel sont déjà tenus à jour, et une double saisie finit
 *    toujours par diverger.
 * 2. LA TABLE, tenue à la main. Elle sert aux comptes locaux, et aux personnes dont
 *    aucun groupe ne permet de conclure.
 *
 * CE QUE ÇA IMPLIQUE, et qu'il faut savoir : déplacer quelqu'un dans la table prend effet
 * à sa requête suivante ; le déplacer dans l'annuaire prend effet à sa PROCHAINE
 * CONNEXION. Rafraîchir les groupes à chaque requête voudrait dire interroger le LDAP des
 * dizaines de fois par minute et par personne, ce qui n'est pas tenable — et laisserait
 * l'application à l'arrêt chaque fois que l'annuaire tousse.
 *
 * Une personne appartient à UNE équipe. C'est le choix retenu : la bascule d'équipe est
 * réservée à l'administrateur de plateforme, et l'écran affiche en permanence le nom de
 * l'équipe courante pour qu'on sache toujours où l'on écrit.
 */

const FICHIER = 'appartenances.json';

/** En mémoire : la table est lue à CHAQUE requête pour résoudre l'équipe de l'appelant.
 *  Invalidée à l'écriture, qui passe toute par ici. */
let cache = null;

function lire() {
  if (!cache) {
    const brut = readJson(FICHIER, {});
    cache = {
      /** username (minuscules) → { equipe, source } */
      personnes: brut?.personnes && typeof brut.personnes === 'object' ? brut.personnes : {},
      /** [{ groupe, equipe }] — la correspondance annuaire. */
      groupes: Array.isArray(brut?.groupes) ? brut.groupes : [],
    };
  }
  return cache;
}

function ecrire(etat) {
  cache = etat;
  writeJson(FICHIER, etat);
  return etat;
}

const cle = (username) => String(username ?? '').trim().toLowerCase();

// ------------------------------------------------------- Correspondance annuaire

export function listerCorrespondances() {
  return lire().groupes.map((g) => ({ ...g }));
}

export function definirCorrespondances(couples) {
  const propres = (Array.isArray(couples) ? couples : [])
    .map((g) => ({ groupe: String(g?.groupe ?? '').trim(), equipe: String(g?.equipe ?? '').trim() }))
    .filter((g) => g.groupe && equipeExiste(g.equipe));
  return ecrire({ ...lire(), groupes: propres }).groupes;
}

/**
 * L'équipe déduite des groupes d'annuaire d'une personne. `null` si aucun ne correspond.
 *
 * Comparaison tolérante sur la forme, comme pour la restriction par groupe existante : un
 * administrateur qui écrit « Techniciens Infra » plutôt que le DN complet a raison de
 * s'attendre à ce que cela marche.
 */
export function equipeDepuisGroupes(memberOf) {
  const groupes = (Array.isArray(memberOf) ? memberOf : memberOf ? [memberOf] : []).map((d) => String(d).toLowerCase());
  for (const { groupe, equipe } of lire().groupes) {
    const voulu = groupe.trim().toLowerCase();
    if (!voulu) continue;
    const trouve = groupes.some((dn) => dn === voulu || dn.match(/^cn=([^,]+)/)?.[1] === voulu.replace(/^cn=/, ''));
    if (trouve && equipeExiste(equipe)) return equipe;
  }
  return null;
}

// ------------------------------------------------------------- Appartenances

export function equipeDe(username) {
  const entree = lire().personnes[cle(username)];
  return entree && equipeExiste(entree.equipe) ? entree.equipe : null;
}

export function appartenanceDe(username) {
  const entree = lire().personnes[cle(username)];
  return entree ? { ...entree } : null;
}

export function listerAppartenances() {
  return Object.entries(lire().personnes).map(([username, v]) => ({ username, ...v }));
}

export function affecter(username, equipe, source = 'manuel') {
  const u = cle(username);
  if (!u) throw new Error('Identifiant manquant.');
  if (!equipeExiste(equipe)) throw new Error('Équipe inconnue.');
  const etat = lire();
  return ecrire({ ...etat, personnes: { ...etat.personnes, [u]: { equipe, source } } }).personnes[u];
}

export function desaffecter(username) {
  const etat = lire();
  const personnes = { ...etat.personnes };
  delete personnes[cle(username)];
  ecrire({ ...etat, personnes });
}

/**
 * Enregistre ce que dit l'annuaire à la connexion. N'écrit QUE si un groupe a permis de
 * conclure : une connexion LDAP sans groupe correspondant ne doit pas effacer une
 * affectation posée à la main, qui est précisément là pour ce cas.
 */
export function noterAppartenanceLdap(username, memberOf) {
  const equipe = equipeDepuisGroupes(memberOf);
  if (!equipe) return null;
  return affecter(username, equipe, 'ldap');
}

/**
 * L'équipe à servir à une personne, ou `null` si elle n'en a aucune.
 *
 * Le repli sur l'équipe initiale ne vaut QUE tant qu'il n'existe qu'une seule équipe :
 * c'est le cas d'une installation qui vient d'être mise à jour, où personne n'a encore
 * été affecté et où se tromper est impossible. Dès qu'une deuxième équipe existe, une
 * personne sans affectation n'entre nulle part — mieux vaut un refus explicite qu'un
 * accès silencieux aux données d'une équipe qui n'est pas la sienne.
 */
export function equipeEffective(username) {
  const directe = equipeDe(username);
  if (directe) return directe;
  const equipes = listerEquipes();
  if (equipes.length === 1) return equipes[0].id;
  return null;
}

export { EQUIPE_DEFAUT };
