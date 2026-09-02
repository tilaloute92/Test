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
