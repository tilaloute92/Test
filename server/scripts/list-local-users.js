#!/usr/bin/env node
// Liste les comptes locaux existants, à exécuter sur le serveur depuis une console
// ADMINISTRATEUR :
//   npm run list-users
//
// Répond à la seule question qui compte quand une connexion est refusée : le compte que
// j'essaie d'utiliser existe-t-il seulement ? Les mots de passe ne sont pas stockés en clair
// et ne peuvent donc pas être affichés — pour en reprendre un, utiliser
// Reset-SuiviInfraAdmin.ps1.
import 'dotenv/config';

let listLocalUsers;
let usesDefaultPassword;
try {
  ({ listLocalUsers, usesDefaultPassword } = await import('../src/auth/localAuth.js'));
} catch (err) {
  if (err?.code === 'EPERM' || err?.code === 'EACCES') {
    console.error(
      `Accès refusé au dossier de données (${err.path || 'server\\data'}).\n` +
        'Rouvrez PowerShell en tant qu\'administrateur puis relancez cette commande.'
    );
    process.exit(1);
  }
  throw err;
}

const comptes = listLocalUsers();
if (comptes.length === 0) {
  console.log('Aucun compte local. Créez-en un : .\\Reset-SuiviInfraAdmin.ps1 (console administrateur).');
  process.exit(0);
}

console.log(`${comptes.length} compte(s) local(aux) :`);
for (const { username, name } of comptes) {
  console.log(`  - ${username}${name && name !== username ? ` (${name})` : ''}`);
}

if (await usesDefaultPassword()) {
  console.log('');
  console.log('ATTENTION : le compte "admin" utilise un mot de passe PUBLIC.');
  console.log('Changez-le : Parametres -> Authentification locale, ou .\\Reset-SuiviInfraAdmin.ps1');
}
