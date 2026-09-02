#!/usr/bin/env node
// Crée ou met à jour un compte local, à exécuter sur le serveur :
//   npm run create-user -- <identifiant> <mot-de-passe> ["Nom complet"]
// Sert à créer le tout premier compte (nécessaire pour pouvoir ensuite gérer
// les autres depuis l'application, onglet Paramètres → Authentification locale,
// une fois connecté).
import 'dotenv/config';
import { upsertLocalUser } from '../src/auth/localAuth.js';

const [, , username, password, name] = process.argv;

if (!username || !password) {
  console.error('Usage : npm run create-user -- <identifiant> <mot-de-passe> ["Nom complet"]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Le mot de passe doit faire au moins 8 caractères.');
  process.exit(1);
}

await upsertLocalUser(username, password, name);
console.log(`Compte "${username}" créé/mis à jour.`);
