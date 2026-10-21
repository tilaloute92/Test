import { readJsonEquipe, writeJsonEquipe } from '../dataStore.js';
import { estConfigure, getConfig } from './config.js';
import {
  avecFiltre,
  compter,
  GlpiError,
  identifiantUtilisateur,
  initSession,
  killSession,
  optionsDeRecherche,
} from './client.js';

/**
 * Le relevé : combien de tickets, dans quel état, et combien pour la personne connectée.
 *
 * TROIS RÈGLES, et ce sont elles qui comptent :
 *
 * 1. ON NE MONTRE JAMAIS « 0 » QUAND ON NE SAIT PAS. Un compteur qui tombe à zéro parce
 *    que GLPI ne répond plus annonce une file vide à une équipe qui en a quarante. On
 *    garde donc le dernier relevé réussi, on le date, et l'écran dit qu'il est périmé.
 * 2. UN RELEVÉ PAR INTERVALLE, PARTAGÉ. Dix personnes qui ouvrent l'application ne font
 *    pas dix interrogations de GLPI : le résultat est en mémoire et resservi tel quel.
 * 3. LE RELEVÉ PERSONNEL EST PAR PERSONNE, mais suit le même cache : chacun ne voit que
 *    son propre nombre, personne ne voit celui d'un collègue.
 */

const HISTORIQUE_FILE = 'glpi-historique.json';
/** Treize mois, comme l'historique de charge : c'est ce que « la tendance sur un an »
 *  exigerait si on l'affiche un jour. Une ligne par jour, le fichier reste minuscule. */
const HISTORIQUE_MAX = 400;

/**
 * Les six états d'un ticket GLPI, regroupés en quatre qui veulent dire quelque chose pour
 * qui regarde sa journée. « Clos » (6) n'est pas compté : c'est du travail fini, il n'a
 * rien à faire dans un compteur de charge.
 */
export const BUCKETS = [
  { cle: 'nouveaux', libelle: 'Nouveaux', statuts: [1] },
  { cle: 'enCours', libelle: 'En cours', statuts: [2, 3] },
  { cle: 'enAttente', libelle: 'En attente', statuts: [4] },
  { cle: 'aClore', libelle: 'Résolus à clore', statuts: [5] },
];

/** equipe → { releve, erreur, personnels: Map } */
const caches = new Map();

function cache(equipe) {
  let c = caches.get(equipe);
  if (!c) {
    c = { releve: null, erreur: null, enCours: null, dernierEssai: null, personnels: new Map(), identifiants: new Map() };
    caches.set(equipe, c);
  }
  return c;
}

/** Appelé quand une équipe est supprimée ou sa configuration changée — sinon l'écran
 *  continuerait d'afficher le relevé de l'ancienne file pendant cinq minutes. */
export function oublierCache(equipe) {
  caches.delete(equipe);
}

function perime(at, minutes) {
  return !at || Date.now() - new Date(at).getTime() > minutes * 60 * 1000;
}

function filtreStatut(cfg, valeur) {
  return { field: cfg.champStatut, searchtype: 'equals', value: valeur };
}

/** Le login GLPI correspondant à un compte de l'application. Par défaut le même — les
 *  deux viennent en général du même annuaire — sauf correspondance déclarée. */
export function loginGlpi(cfg, username) {
  if (!username) return null;
  return cfg.correspondances[String(username).toLowerCase()] ?? username;
}

/** Un appel par statut GLPI, regroupés en quatre. Six petites requêtes qui ne
 *  rapatrient aucun ticket : c'est moins coûteux pour GLPI qu'une seule qui lirait la
 *  colonne « statut » de plusieurs centaines de lignes. */
async function compterBuckets(session, cfg, filtreSupplementaire = null) {
  const parStatut = {};
  for (const bucket of BUCKETS) {
    let n = 0;
    for (const statut of bucket.statuts) {
      const criteres = avecFiltre(cfg.criteres, filtreStatut(cfg, String(statut)));
      if (filtreSupplementaire) criteres.push({ link: 'AND', ...filtreSupplementaire });
      n += await compter(session, criteres);
    }
    parStatut[bucket.cle] = n;
  }
  return { parStatut, total: Object.values(parStatut).reduce((a, b) => a + b, 0) };
}

async function relever(cfg) {
  const session = await initSession(cfg);
  try {
    const { total, parStatut } = await compterBuckets(session, cfg);
    return { total, parStatut, at: new Date().toISOString() };
  } finally {
    await killSession(session);
  }
}

/**
 * Relevé de l'équipe. Les appels concurrents partagent la même promesse : à l'ouverture
 * d'une journée, cinq navigateurs demandent la page en même temps et une seule
 * interrogation part vers GLPI.
 */
async function releveEquipe(equipe, cfg, { forcer = false } = {}) {
  const c = cache(equipe);
  if (!forcer && c.releve && !perime(c.releve.at, cfg.intervalleMinutes)) return c;
  // Un échec vaut une tentative : sans cette ligne, un GLPI en panne serait réinterrogé
  // par CHAQUE sondage de CHAQUE navigateur, puisque le relevé conservé reste périmé.
  // C'est au moment où il va mal qu'il faut le solliciter le moins.
  if (!forcer && c.dernierEssai && !perime(c.dernierEssai, cfg.intervalleMinutes)) return c;
  if (c.enCours) return c.enCours;

  c.enCours = (async () => {
    c.dernierEssai = new Date().toISOString();
    try {
      c.releve = await relever(cfg);
      c.erreur = null;
      noterHistorique(equipe, c.releve);
    } catch (erreur) {
      // Le relevé précédent est CONSERVÉ : il reste la meilleure information disponible,
      // et l'écran l'affiche en le datant plutôt que de montrer un compteur à zéro.
      c.erreur = erreur instanceof GlpiError ? erreur.message : `Relevé impossible — ${erreur.message}`;
    } finally {
      c.enCours = null;
    }
    return c;
  })();
  return c.enCours;
}

/** Relevé personnel : les tickets non clos dont la personne est le technicien attribué. */
async function relevePersonnel(equipe, cfg, username) {
  const c = cache(equipe);
  const cle = String(username).toLowerCase();
  const connu = c.personnels.get(cle);
  if (connu && !perime(connu.at, cfg.intervalleMinutes)) return connu;

  const login = loginGlpi(cfg, username);
  const session = await initSession(cfg);
  try {
    let id = c.identifiants.get(cle);
    if (id === undefined) {
      id = await identifiantUtilisateur(session, login);
      // Un identifiant TROUVÉ est gardé (il ne changera pas) ; une absence ne l'est pas :
      // un compte GLPI créé la semaine suivante doit finir par être reconnu, sans quoi il
      // faudrait redémarrer le service pour que le nombre personnel apparaisse.
      if (id !== null) c.identifiants.set(cle, id);
    }
    if (id === null) {
      // Pas de compte GLPI pour cette personne : ce n'est pas une panne, c'est une
      // information. L'écran dit « compte GLPI non trouvé » plutôt que d'afficher 0.
      const sans = { at: new Date().toISOString(), total: null, login, inconnu: true };
      c.personnels.set(cle, sans);
      return sans;
    }
    const { total } = await compterBuckets(session, cfg, {
      field: cfg.champTechnicien,
      searchtype: 'equals',
      value: String(id),
    });
    const releve = { at: new Date().toISOString(), total, login, inconnu: false };
    c.personnels.set(cle, releve);
    return releve;
  } finally {
    await killSession(session);
  }
}

/**
 * Ce que la route sert au navigateur. Ne lève jamais : une intégration secondaire ne doit
 * pas empêcher l'écran d'accueil de s'afficher.
 */
export async function etat(equipe, username) {
  const cfg = getConfig(equipe);
  if (!estConfigure(cfg)) return { actif: false };

  const c = await releveEquipe(equipe, cfg);
  let mien = null;
  let mienInconnu = false;
  if (c.releve && username) {
    try {
      const perso = await relevePersonnel(equipe, cfg, username);
      mien = perso.total;
      mienInconnu = perso.inconnu;
    } catch {
      // Le nombre personnel est un complément : son échec ne doit pas emporter le total
      // de l'équipe, qui lui est bien connu. L'échec est daté dans le cache pour la même
      // raison que ci-dessus : ne pas réinterroger un GLPI en panne à chaque sondage.
      caches.get(equipe)?.personnels.set(String(username).toLowerCase(), {
        at: new Date().toISOString(),
        total: null,
        inconnu: false,
      });
      mien = null;
    }
  }

  return {
    actif: true,
    // L'adresse de l'interface, déduite de celle de l'API : le compteur doit mener aux
    // tickets qu'il compte, sinon il faut aller rouvrir GLPI à la main. Ce n'est pas un
    // secret — contrairement aux deux jetons, qui ne quittent jamais le serveur.
    lien: cfg.url.replace(/\/apirest\.php$/, '/front/ticket.php'),
    total: c.releve?.total ?? null,
    parStatut: c.releve?.parStatut ?? null,
    releveLe: c.releve?.at ?? null,
    perime: c.releve ? perime(c.releve.at, cfg.intervalleMinutes * 3) : true,
    erreur: c.erreur,
    mien,
    mienInconnu,
    intervalleMinutes: cfg.intervalleMinutes,
  };
}

/** Essai de raccordement depuis la page de paramétrage : relevé immédiat, erreur en clair. */
export async function tester(equipe, cfg, username) {
  const session = await initSession(cfg);
  try {
    const { total, parStatut } = await compterBuckets(session, cfg);
    const login = loginGlpi(cfg, username);
    const id = login ? await identifiantUtilisateur(session, login) : null;
    return {
      ok: true,
      total,
      parStatut,
      login,
      compteTrouve: id !== null,
    };
  } finally {
    await killSession(session);
  }
}

// -------------------------------------------------------------- Historique
/**
 * UN RELEVÉ PAR JOUR, archivé dès maintenant alors que RIEN NE L'AFFICHE encore.
 *
 * C'est délibéré : GLPI ne conserve pas l'historique de ses propres compteurs. Le jour où
 * l'on voudra montrer la tendance (« la file monte ou descend »), il faudra quatorze
 * jours de relevés — commencer à archiver ce jour-là, c'est attendre deux semaines pour
 * un graphique vide. Le coût est d'une ligne par jour et par équipe.
 */
function noterHistorique(equipe, releve) {
  const jour = releve.at.slice(0, 10);
  const lignes = readJsonEquipe(equipe, HISTORIQUE_FILE, []);
  const liste = Array.isArray(lignes) ? lignes : [];
  const dernier = liste[liste.length - 1];
  // Le dernier relevé du jour écrase celui du matin : c'est l'état de fin de journée qui
  // raconte quelque chose, pas celui de 8 h 02.
  const ligne = { date: jour, total: releve.total, parStatut: releve.parStatut };
  const suite = dernier?.date === jour ? [...liste.slice(0, -1), ligne] : [...liste, ligne];
  writeJsonEquipe(equipe, HISTORIQUE_FILE, suite.slice(-HISTORIQUE_MAX));
}

export function historique(equipe, jours = 14) {
  const lignes = readJsonEquipe(equipe, HISTORIQUE_FILE, []);
  return (Array.isArray(lignes) ? lignes : []).slice(-jours);
}

/**
 * Les deux numéros de champ, lus sur l'instance plutôt que devinés.
 *
 * On ne cherche pas un numéro connu d'avance : on cherche la COLONNE que le champ
 * désigne. `status` sur la table des tickets, et le champ dont la clé de liaison est
 * `users_id_assign` — le technicien attribué. Cette identification-là ne bouge pas d'une
 * version à l'autre, alors que les numéros, si.
 */
export async function detecterChamps(cfg) {
  const session = await initSession(cfg);
  try {
    const options = await optionsDeRecherche(session, 'Ticket');
    const statut = options.find((o) => o.champ === 'status' && o.table === 'glpi_tickets');
    const technicien = options.find((o) => o.lien === 'users_id_assign');
    return {
      ok: true,
      statut: statut ? { id: statut.id, nom: statut.nom } : null,
      technicien: technicien ? { id: technicien.id, nom: technicien.nom } : null,
      nombreDeChamps: options.length,
    };
  } finally {
    await killSession(session);
  }
}
