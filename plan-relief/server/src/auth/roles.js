import { readJson, writeJson } from '../dataStore.js';
import { localUserRole } from './localAuth.js';

/**
 * Deux profils :
 *   - « admin »   : paramètres (comptes, LDAP, administrateurs), ajout, modification,
 *                   réanalyse et suppression de plans ;
 *   - « lecteur » : consultation des plans, recherche et tracés.
 *
 * Comptes locaux : rôle enregistré avec le compte (un compte créé avant l'arrivée des
 * profils est administrateur, pour ne retirer l'accès à personne).
 * Comptes Active Directory et Microsoft : lecteurs, sauf ceux de la liste des
 * administrateurs (Paramètres), comparés sans tenir compte des majuscules ; « jdupont »
 * désigne aussi « jdupont@monentreprise.fr » et « MONENTREPRISE\jdupont ».
 *
 * Le rôle est relu à chaque requête : un changement de droits s'applique sans attendre
 * l'expiration des sessions ouvertes.
 */
export const ROLES = ['admin', 'lecteur'];

const FILE = 'config.json';
const short = (s) => String(s || '').toLowerCase().trim().replace(/^.*\\/, '').replace(/@.*$/, '');

export function getAdminList() {
  const cfg = readJson(FILE, {});
  return Array.isArray(cfg.admins) ? cfg.admins : [];
}

export function setAdminList(list) {
  const clean = [...new Set((Array.isArray(list) ? list : []).map((s) => String(s).trim().slice(0, 200)).filter(Boolean))].slice(0, 500);
  const cfg = readJson(FILE, {});
  writeJson(FILE, { ...cfg, admins: clean });
  return clean;
}

/** Rôle d'une session (charge utile du jeton : sub, method). */
export function roleOf(user) {
  if (!user) return 'lecteur';
  if (user.method === 'local') return localUserRole(user.sub) ?? 'lecteur';
  const me = short(user.sub);
  return getAdminList().some((a) => short(a) === me) ? 'admin' : 'lecteur';
}
