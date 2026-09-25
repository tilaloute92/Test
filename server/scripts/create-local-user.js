#!/usr/bin/env node
// Crée ou met à jour un compte local, à exécuter sur le serveur :
//   npm run create-user -- <identifiant> <mot-de-passe> ["Nom complet"]
//   npm run create-user -- <identifiant> --name "Nom complet"     (mot de passe par SUIVI_INFRA_PASSWORD)
//
// Le mot de passe peut être passé par la variable d'environnement SUIVI_INFRA_PASSWORD,
// pour qu'il n'apparaisse ni dans la liste des processus, ni dans l'historique du terminal.
// C'est la voie qu'empruntent Install-SuiviInfra.ps1 et Reset-SuiviInfraAdmin.ps1.
//
// Le nom complet se passe alors par --name, JAMAIS par un mot de passe positionnel vide :
// Windows PowerShell 5.1 SUPPRIME purement et simplement les arguments vides transmis à un
// programme externe. « node create-local-user.js admin '' "Administrateur" » y arrive donc
// sous la forme « admin "Administrateur" », et le nom complet devient le mot de passe — un
// compte créé avec un mot de passe que personne n'a choisi ni ne connaît. D'où le refus
// explicite plus bas quand deux mots de passe sont fournis à la fois : c'est exactement la
// signature de ce décalage, et mieux vaut échouer bruyamment que créer un compte inutilisable.
//
// Sert à créer le tout premier compte ; les suivants se gèrent depuis l'application
// (onglet Paramètres -> Authentification locale) une fois connecté.
import 'dotenv/config';

const USAGE =
  'Usage : npm run create-user -- <identifiant> <mot-de-passe> ["Nom complet"]\n' +
  '        npm run create-user -- <identifiant> --name "Nom complet"   (avec SUIVI_INFRA_PASSWORD)';

const argv = process.argv.slice(2);
const positionnels = [];
let nomOption;
let motDePasseOption;

for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--name') {
    nomOption = argv[i + 1];
    i += 1;
  } else if (argv[i] === '--password') {
    motDePasseOption = argv[i + 1];
    i += 1;
  } else {
    positionnels.push(argv[i]);
  }
}

const [username, motDePassePositionnel, nomPositionnel] = positionnels;
const motDePasseEnv = process.env.SUIVI_INFRA_PASSWORD;

if (!username) {
  console.error(USAGE);
  process.exit(1);
}

// Deux sources de mot de passe : soit l'appelant s'est trompé, soit un argument vide a été
// escamoté et le nom complet a glissé à la place du mot de passe. Dans les deux cas, créer
// le compte serait pire que d'échouer.
const sources = [motDePasseOption, motDePasseEnv, motDePassePositionnel].filter(
  (v) => v !== undefined && v !== ''
);
if (sources.length > 1) {
  console.error(
    [
      'Mot de passe fourni plusieurs fois (argument ET variable SUIVI_INFRA_PASSWORD).',
      "Refus de créer le compte : impossible de savoir lequel serait le bon, et un compte doté",
      "d'un mot de passe involontaire est un compte auquel personne ne peut se connecter.",
      '',
      'Passez le nom complet avec --name, pas comme troisième argument positionnel.',
      '',
      USAGE,
    ].join('\n')
  );
  process.exit(1);
}

const password = sources[0];
const name = nomOption || nomPositionnel || username;

if (!password) {
  console.error(USAGE);
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
let verifyLocalLogin;
try {
  ({ upsertLocalUser, verifyLocalLogin } = await import('../src/auth/localAuth.js'));
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

// Relecture immédiate : le compte n'est annoncé prêt que si la connexion qu'il promet
// fonctionne réellement. Écrire le fichier ne prouve pas qu'on pourra entrer avec.
if (!(await verifyLocalLogin(username, password))) {
  console.error(
    `Compte "${username}" écrit, mais la connexion de contrôle échoue. N'utilisez pas ce compte ; relancez la commande.`
  );
  process.exit(1);
}

console.log(`Compte "${username}" créé/mis à jour (nom affiché : ${name}). Connexion de contrôle réussie.`);
