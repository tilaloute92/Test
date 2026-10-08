import bcrypt from 'bcryptjs';
import { readJson, writeJson } from '../dataStore.js';

const FILE = 'users.json';

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

/** Rôle d'un compte local ; un compte d'avant les profils (sans rôle) est administrateur. */
const roleField = (u) => (u.role === 'lecteur' ? 'lecteur' : 'admin');

export function listLocalUsers() {
  return loadUsers().map((u) => ({ username: u.username, name: u.name, role: roleField(u) }));
}

export function localUserRole(username) {
  const u = loadUsers().find((x) => x.username.toLowerCase() === String(username).toLowerCase());
  return u ? roleField(u) : null;
}

/** Nombre d'administrateurs locaux si l'on retirait ou rétrogradait `except`. */
export function localAdminsExcept(except) {
  return loadUsers().filter((u) => roleField(u) === 'admin' && u.username.toLowerCase() !== String(except).toLowerCase()).length;
}

export async function verifyLocalLogin(username, password) {
  const users = loadUsers();
  const user = users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? { username: user.username, name: user.name } : null;
}

export async function upsertLocalUser(username, password, name, role = 'admin') {
  const users = loadUsers();
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = users.findIndex((u) => u.username.toLowerCase() === username.toLowerCase());
  const entry = { username, name: name || username, passwordHash, role: role === 'lecteur' ? 'lecteur' : 'admin' };
  if (existing >= 0) users[existing] = entry;
  else users.push(entry);
  writeJson(FILE, users);
}

export function removeLocalUser(username) {
  const users = loadUsers().filter((u) => u.username.toLowerCase() !== username.toLowerCase());
  writeJson(FILE, users);
}
