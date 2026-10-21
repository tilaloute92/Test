import { readJsonEquipe, writeJsonEquipe } from '../dataStore.js';

/**
 * Raccordement à GLPI, PAR ÉQUIPE.
 *
 * Chaque équipe a sa file de tickets : l'équipe réseau ne compte pas ceux de l'équipe
 * applicative. La configuration vit donc dans `data/equipes/<id>/glpi.json`, comme les
 * règles de service, et non dans la configuration commune.
 *
 * LES JETONS NE SORTENT JAMAIS DU SERVEUR. `getConfig` les rend tels quels pour l'usage
 * interne ; `pourAffichage` ne renvoie que « renseigné ou non ». C'est la raison d'être
 * de tout ce module : la console « Requêtes API » de l'application appelle depuis le
 * navigateur, ce qui mettrait le jeton d'un compte GLPI dans le stockage local de chaque
 * poste — lisible par n'importe quelle extension — et se ferait de toute façon refuser
 * par GLPI faute d'en-têtes CORS.
 */

const FILE = 'glpi.json';

/**
 * Numéros des champs de recherche GLPI. Ce sont les valeurs usuelles de GLPI 10 pour les
 * tickets — 12 le statut, 5 le technicien attribué — mais elles DÉPENDENT DE LA VERSION
 * et des plugins installés. D'où le réglage : `GET /listSearchOptions/Ticket` sur
 * l'instance donne la liste exacte, et la carte de paramétrage permet de les corriger
 * sans toucher au code.
 */
const CHAMP_STATUT_DEFAUT = 12;
const CHAMP_TECHNICIEN_DEFAUT = 5;
const INTERVALLE_DEFAUT = 5;

export const CONFIG_VIDE = {
  actif: false,
  url: '',
  appToken: '',
  userToken: '',
  criteres: [],
  champStatut: CHAMP_STATUT_DEFAUT,
  champTechnicien: CHAMP_TECHNICIEN_DEFAUT,
  intervalleMinutes: INTERVALLE_DEFAUT,
  correspondances: {},
};

function entier(valeur, defaut, min, max) {
  const n = Number(valeur);
  if (!Number.isInteger(n) || n < min || n > max) return defaut;
  return n;
}

export function getConfig(equipe) {
  const brut = readJsonEquipe(equipe, FILE, {}) ?? {};
  return {
    actif: brut.actif === true,
    url: typeof brut.url === 'string' ? brut.url.trim() : '',
    appToken: typeof brut.appToken === 'string' ? brut.appToken : '',
    userToken: typeof brut.userToken === 'string' ? brut.userToken : '',
    criteres: Array.isArray(brut.criteres) ? brut.criteres : [],
    champStatut: entier(brut.champStatut, CHAMP_STATUT_DEFAUT, 1, 9999),
    champTechnicien: entier(brut.champTechnicien, CHAMP_TECHNICIEN_DEFAUT, 1, 9999),
    intervalleMinutes: entier(brut.intervalleMinutes, INTERVALLE_DEFAUT, 1, 120),
    correspondances:
      brut.correspondances && typeof brut.correspondances === 'object' && !Array.isArray(brut.correspondances)
        ? brut.correspondances
        : {},
  };
}

/** Ce que le navigateur a le droit de voir : tout, sauf les deux jetons. */
export function pourAffichage(cfg) {
  const { appToken, userToken, ...reste } = cfg;
  return { ...reste, appTokenSet: appToken.length > 0, userTokenSet: userToken.length > 0 };
}

/** Le raccordement est utilisable : coché, et les trois valeurs indispensables présentes. */
export function estConfigure(cfg) {
  return cfg.actif && cfg.url.length > 0 && cfg.appToken.length > 0 && cfg.userToken.length > 0;
}

// --------------------------------------------------------------- Validation

const PROFONDEUR_MAX = 3;
const CRITERES_MAX = 30;
const SEARCHTYPES = new Set([
  'contains',
  'equals',
  'notequals',
  'lessthan',
  'morethan',
  'under',
  'notunder',
  'notcontains',
  'beginswith',
  'endswith',
]);

/**
 * Les critères sont réémis tels quels dans une URL appelée par le serveur : ils sont
 * validés ici, forme par forme, plutôt que recopiés de confiance. Un objet inattendu
 * est refusé, pas « nettoyé » — mieux vaut un message clair qu'une recherche qui compte
 * autre chose que ce que l'on croit.
 */
export function verifierCriteres(criteres, profondeur = 1) {
  if (!Array.isArray(criteres)) throw new Error('Les critères de recherche doivent être envoyés sous forme de liste.');
  if (profondeur > PROFONDEUR_MAX) throw new Error('Critères de recherche trop imbriqués.');
  if (criteres.length > CRITERES_MAX) throw new Error(`Pas plus de ${CRITERES_MAX} critères de recherche.`);
  return criteres.map((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`Critère n°${i + 1} illisible.`);
    const link = c.link === 'OR' || c.link === 'AND NOT' || c.link === 'OR NOT' ? c.link : 'AND';
    if (Array.isArray(c.criteria)) return { link, criteria: verifierCriteres(c.criteria, profondeur + 1) };
    const field = Number(c.field);
    if (!Number.isInteger(field) || field < 1 || field > 99999) throw new Error(`Critère n°${i + 1} : champ invalide.`);
    const searchtype = SEARCHTYPES.has(c.searchtype) ? c.searchtype : 'equals';
    const value = c.value === undefined || c.value === null ? '' : String(c.value);
    if (value.length > 200) throw new Error(`Critère n°${i + 1} : valeur trop longue.`);
    return { link, field, searchtype, value };
  });
}

function verifierUrl(url) {
  const brut = String(url ?? '').trim();
  if (!brut) return '';
  let parsee;
  try {
    parsee = new URL(brut);
  } catch {
    throw new Error("L'adresse de GLPI n'est pas une URL valide (ex : https://glpi.exemple.fr/apirest.php).");
  }
  if (parsee.protocol !== 'http:' && parsee.protocol !== 'https:') {
    throw new Error("L'adresse de GLPI doit commencer par http:// ou https://.");
  }
  // On accepte l'adresse de l'interface comme celle de l'API : c'est la première qu'on a
  // sous la main, et oublier « /apirest.php » donnerait une erreur 404 incompréhensible.
  const chemin = parsee.pathname.replace(/\/+$/, '');
  if (!chemin.endsWith('apirest.php')) parsee.pathname = `${chemin}/apirest.php`;
  parsee.search = '';
  parsee.hash = '';
  return parsee.toString();
}

function verifierCorrespondances(valeur) {
  if (valeur === undefined) return undefined;
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) {
    throw new Error('Les correspondances de comptes doivent être envoyées sous forme d\'objet.');
  }
  const sortie = {};
  for (const [app, glpi] of Object.entries(valeur)) {
    if (typeof app !== 'string' || typeof glpi !== 'string') continue;
    const a = app.trim().toLowerCase();
    const g = glpi.trim();
    if (!a || !g) continue;
    if (a.length > 100 || g.length > 100) throw new Error('Identifiant de correspondance trop long.');
    sortie[a] = g;
  }
  return sortie;
}

/**
 * Enregistrement. Les deux jetons suivent la règle du mot de passe SMTP : absents ou
 * vides, ils restent ceux déjà en place — la page de paramétrage ne les affiche pas, elle
 * ne peut donc pas les renvoyer.
 */
export function setConfig(equipe, entree) {
  const actuel = getConfig(equipe);
  const prochain = { ...actuel };

  if (entree.url !== undefined) prochain.url = verifierUrl(entree.url);
  if (entree.actif !== undefined) prochain.actif = entree.actif === true;
  if (entree.criteres !== undefined) prochain.criteres = verifierCriteres(entree.criteres);
  if (entree.champStatut !== undefined) {
    const n = Number(entree.champStatut);
    if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Error('Le numéro du champ « statut » doit être un entier.');
    prochain.champStatut = n;
  }
  if (entree.champTechnicien !== undefined) {
    const n = Number(entree.champTechnicien);
    if (!Number.isInteger(n) || n < 1 || n > 9999) throw new Error('Le numéro du champ « technicien » doit être un entier.');
    prochain.champTechnicien = n;
  }
  if (entree.intervalleMinutes !== undefined) {
    const n = Number(entree.intervalleMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 120) throw new Error("L'intervalle de relevé doit être compris entre 1 et 120 minutes.");
    prochain.intervalleMinutes = n;
  }
  const corr = verifierCorrespondances(entree.correspondances);
  if (corr !== undefined) prochain.correspondances = corr;

  if (typeof entree.appToken === 'string' && entree.appToken.trim()) prochain.appToken = entree.appToken.trim();
  if (typeof entree.userToken === 'string' && entree.userToken.trim()) prochain.userToken = entree.userToken.trim();

  if (prochain.actif && (!prochain.url || !prochain.appToken || !prochain.userToken)) {
    throw new Error("Pour activer le compteur, l'adresse de GLPI et les deux jetons sont nécessaires.");
  }

  writeJsonEquipe(equipe, FILE, prochain);
  return getConfig(equipe);
}
