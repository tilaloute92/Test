#!/usr/bin/env node
// Crée ou met à jour un compte local, à exécuter sur le serveur :
//   npm run create-user -- <identifiant> <mot-de-passe> ["Nom complet"]
//
// Le mot de passe peut aussi être passé par la variable d'environnement
// SUIVI_INFRA_PASSWORD, pour qu'il n'apparaisse ni dans la liste des processus,
// ni dans l'historique du terminal. C'est la voie qu'emprunte Install-SuiviInfra.ps1.
//
// Sert à créer le tout premier compte ; les suivants se gèrent depuis l'application
// (onglet Paramètres -> Authentification locale) une fois connecté.
import 'dotenv/config';

const [, , username, passwordArg, name] = process.argv;
const password = passwordArg || process.env.SUIVI_INFRA_PASSWORD;

if (!username || !password) {
  console.error('Usage : npm run create-user -- <identifiant> <mot-de-passe> ["Nom complet"]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Le mot de passe doit faire au moins 8 caractères.');
  process.exit(1);
}

// Import différé : le module de stockage crée le dossier data\ dès son chargement, et c'est
// là que l'on bute sur les droits. Un import statique ferait remonter une trace de pile
// Node brute, illisible pour un administrateur qui veut juste savoir quoi faire.
let upsertLocalUser;
try {
  ({ upsertLocalUser } = await import('../src/auth/localAuth.js'));
} catch (err) {
  if (err?.code === 'EPERM' || err?.code === 'EACCES') {
    console.error(
      [
        `Accès refusé au dossier de données : ${err.path || 'server\\data'}`,
        '',
        "Ce dossier est réservé aux administrateurs et au compte SYSTEM : c'est voulu, il",
        'contient les empreintes des mots de passe et les données de l\'équipe.',
        '',
        'Rouvrez PowerShell en tant qu\'administrateur (clic droit -> "Exécuter en tant',
        "qu'administrateur\") puis relancez cette commande. Appartenir au groupe",
        'Administrateurs ne suffit pas : sans élévation, Windows retire ce groupe du jeton.',
      ].join('\n')
    );
    process.exit(1);
  }
  throw err;
}

await upsertLocalUser(username, password, name);
console.log(`Compte "${username}" créé/mis à jour.`);
