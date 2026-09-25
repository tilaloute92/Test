import bcrypt from 'bcryptjs';
import { readJson, writeJson } from '../dataStore.js';

const FILE = 'users.json';

/**
 * Compte créé par l'installateur quand aucun n'existe, pour que l'application soit utilisable
 * immédiatement. Son mot de passe est PUBLIC : il figure dans ce dépôt et dans la
 * documentation. Tant qu'il n'a pas été changé, n'importe qui connaissant le produit peut
 * entrer — d'où `usesDefaultPassword()`, qui permet à l'application de le rappeler sans
 * relâche à l'écran plutôt que de laisser cet état s'installer.
 */
export const DEFAULT_ADMIN = { username: 'admin', password: 'SuiviInfra2026!', name: 'Administrateur' };

/**
 * Mots de passe que l'on doit considérer comme connus de tous sur le compte « admin ».
 *
 * Le premier est le mot de passe par défaut assumé. Le second est un accident : dans la
 * version ad871b1 de l'installateur, le mot de passe était transmis à Node par un argument
 * positionnel vide, que Windows PowerShell 5.1 escamote ; le nom complet « Administrateur »
 * glissait à sa place et devenait le mot de passe du compte. Le défaut est corrigé, mais les
 * installations déjà faites gardent ce mot de passe — désormais public, puisqu'il est écrit
 * ici et dans les notes de version. Il doit donc déclencher le même bandeau rouge que
 * l'autre : le danger est identique, et l'administrateur qui a subi le bogue est précisément
 * celui qui ignore quel mot de passe protège son application.
 */
const MOTS_DE_PASSE_PUBLICS = [DEFAULT_ADMIN.password, 'Administrateur'];

/**
 * Comptes locaux : server/data/users.json, créé automatiquement (liste vide)
 * au premier démarrage. Chaque entrée ne contient jamais le mot de passe en
 * clair — seulement son empreinte bcrypt. Gérés depuis l'application
 * (onglet Paramètres → Authentification locale) une fois connecté, ou via
 * `npm run create-user` sur le serveur pour créer le tout premier compte.
 */

function loadUsers() {
  return readJson(FILE, []);
}

export function listLocalUsers() {
  return loadUsers().map(({ username, name }) => ({ username, name }));
}

export async function verifyLocalLogin(username, password) {
  const users = loadUsers();
  const user = users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? { username: user.username, name: user.name } : null;
}

/**
 * Le compte « admin » a-t-il encore le mot de passe par défaut ? Vérifié par comparaison
 * bcrypt, comme une connexion : on ne stocke aucun indicateur qui pourrait se désynchroniser
 * du mot de passe réel.
 */
export async function usesDefaultPassword() {
  const user = loadUsers().find((u) => u.username.toLowerCase() === DEFAULT_ADMIN.username);
  if (!user) return false;
  for (const candidat of MOTS_DE_PASSE_PUBLICS) {
    if (await bcrypt.compare(candidat, user.passwordHash)) return true;
  }
  return false;
}

export async function upsertLocalUser(username, password, name) {
  const users = loadUsers();
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = users.findIndex((u) => u.username.toLowerCase() === username.toLowerCase());
  const entry = { username, name: name || username, passwordHash };
  if (existing >= 0) users[existing] = entry;
  else users.push(entry);
  writeJson(FILE, users);
}

export function removeLocalUser(username) {
  const users = loadUsers().filter((u) => u.username.toLowerCase() !== username.toLowerCase());
  writeJson(FILE, users);
}
