import { deplacerVersEquipe, dossiersEquipes, readJson, writeJson } from './dataStore.js';

/**
 * Le registre des équipes.
 *
 * Une équipe, c'est un identifiant (qui sert de nom de dossier), un nom affiché, et rien
 * d'autre : ses réglages vivent dans son propre dossier, ses données aussi. Le registre
 * ne sert qu'à savoir lesquelles existent et comment les appeler.
 *
 * POURQUOI UN FICHIER À PART et non une clé de config.json : ce dernier est relu à chaque
 * contrôle de droit, et le registre le sera encore plus souvent — à chaque requête, pour
 * résoudre l'équipe de l'appelant. Les deux grossiraient ensemble sans raison.
 */

const FICHIER = 'equipes.json';

/**
 * L'équipe que reçoivent les données d'une installation mono-équipe lors de la migration.
 * Son identifiant ne doit jamais changer : c'est le nom du dossier où se trouvent, après
 * migration, toutes les données existantes.
 */
export const EQUIPE_DEFAUT = { id: 'equipe-1', nom: 'Équipe 1' };

/** Un identifiant d'équipe : minuscules, chiffres et tirets. Il finit dans un chemin de
 *  fichier, et il est affiché dans des URL d'administration — il doit rester sobre. */
export function identifiantValide(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);
}

/** « Équipe Infra & Réseau » → « equipe-infra-reseau ». Proposé à la création, modifiable. */
export function identifiantDepuisNom(nom) {
  const base = String(nom ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'equipe';
}

/**
 * Le registre, en mémoire.
 *
 * Mis en cache parce qu'il est consulté à CHAQUE requête pour résoudre l'équipe de
 * l'appelant : le relire sur disque à chaque fois ferait de la lecture de fichier le
 * chemin le plus chaud du serveur. Invalidé à chaque écriture, qui passe toute par ici.
 */
let cache = null;

function lire() {
  if (cache) return cache;
  const brut = readJson(FICHIER, null);
  cache = Array.isArray(brut) ? brut.filter((e) => identifiantValide(e?.id)) : null;
  if (!cache) {
    // Première lecture d'une installation qui n'a jamais eu de registre : on le crée à
    // partir de ce qui existe sur le disque, pour que la migration n'ait pas à être
    // rejouée et qu'une restauration de sauvegarde retrouve ses équipes.
    const surDisque = dossiersEquipes().filter(identifiantValide);
    cache = surDisque.length > 0
      ? surDisque.map((id) => ({ id, nom: id === EQUIPE_DEFAUT.id ? EQUIPE_DEFAUT.nom : id }))
      : [{ ...EQUIPE_DEFAUT }];
    writeJson(FICHIER, cache);
  }
  return cache;
}

export function listerEquipes() {
  return lire().map((e) => ({ ...e }));
}

export function equipeExiste(id) {
  return lire().some((e) => e.id === id);
}

export function nomEquipe(id) {
  return lire().find((e) => e.id === id)?.nom ?? id;
}

export function creerEquipe({ id, nom }) {
  const identifiant = identifiantValide(id) ? id : identifiantDepuisNom(nom);
  if (!identifiantValide(identifiant)) throw new Error("Identifiant d'équipe invalide.");
  if (equipeExiste(identifiant)) throw new Error(`L'équipe « ${identifiant} » existe déjà.`);
  const libelle = String(nom ?? '').trim().slice(0, 80) || identifiant;
  cache = [...lire(), { id: identifiant, nom: libelle }];
  writeJson(FICHIER, cache);
  return { id: identifiant, nom: libelle };
}

export function renommerEquipe(id, nom) {
  const libelle = String(nom ?? '').trim().slice(0, 80);
  if (!libelle) throw new Error("Donnez un nom à l'équipe.");
  if (!equipeExiste(id)) throw new Error('Équipe inconnue.');
  cache = lire().map((e) => (e.id === id ? { ...e, nom: libelle } : e));
  writeJson(FICHIER, cache);
  return { id, nom: libelle };
}

/**
 * Supprimer une équipe retire son INSCRIPTION, pas son dossier.
 *
 * Les données restent sur le disque : une équipe dissoute l'est rarement par erreur, mais
 * quand elle l'est, « on a perdu deux ans de saisies parce qu'on a cliqué sur la croix »
 * n'est pas une phrase qu'on veut entendre. Le dossier se supprime à la main, sur le
 * serveur, par quelqu'un qui sait ce qu'il fait.
 */
export function retirerEquipe(id) {
  if (id === EQUIPE_DEFAUT.id) throw new Error("L'équipe initiale ne peut pas être retirée.");
  if (!equipeExiste(id)) throw new Error('Équipe inconnue.');
  cache = lire().filter((e) => e.id !== id);
  writeJson(FICHIER, cache);
}

/**
 * Migration depuis la disposition mono-équipe : les fichiers métier étaient à la racine
 * de `data/`, ils passent dans `data/equipes/<equipe-1>/`.
 *
 * Jouée une seule fois, au démarrage, et silencieuse quand il n'y a rien à faire. Elle
 * DÉPLACE les fichiers au lieu de les copier : deux exemplaires d'une même collection,
 * l'un lu et l'autre pas, est une confusion qu'on paie des mois plus tard.
 */
const FICHIERS_A_MIGRER = [
  'business-members.json',
  'business-tasks.json',
  'business-planningSlots.json',
  'business-timeEntries.json',
  'business-absences.json',
  'business-roadmapItems.json',
  'business-copils.json',
  'business-journalEntries.json',
  'business-meta.json',
];

/**
 * Rattache à l'unique équipe tous les comptes locaux qui n'en ont pas.
 *
 * Sans cela, la mise à jour passe inaperçue — une seule équipe, le repli joue — jusqu'au
 * jour où l'administrateur crée la DEUXIÈME équipe : le repli cesse alors de s'appliquer
 * et toute l'équipe se retrouve dehors d'un coup, sans que personne n'ait rien changé à
 * son compte. On affecte donc au moment de la migration, quand c'est encore sans risque
 * de se tromper : il n'y a qu'une équipe possible.
 *
 * Les comptes d'annuaire, eux, ne sont pas énumérables : ils seront rattachés à leur
 * première connexion par la correspondance de groupes, ou à la main.
 */
export async function rattacherComptesSansEquipe() {
  const equipes = lire();
  // UNIQUEMENT quand il n'y a qu'une équipe : c'est le seul cas où rattacher d'office ne
  // peut pas se tromper. Dès qu'il y en a deux, choisir à la place de l'administrateur
  // serait décider qui voit quoi — ce n'est pas à un démarrage de service de le faire.
  if (equipes.length !== 1) return 0;
  const { listLocalUsers } = await import('./auth/localAuth.js');
  const { affecter, equipeDe } = await import('./auth/appartenance.js');
  let n = 0;
  for (const { username } of listLocalUsers()) {
    if (equipeDe(username)) continue;
    affecter(username, equipes[0].id, 'automatique');
    n += 1;
  }
  return n;
}

export function migrerSiBesoin() {
  const deplaces = FICHIERS_A_MIGRER.filter((f) => deplacerVersEquipe(f, EQUIPE_DEFAUT.id));
  if (deplaces.length === 0) return { migre: false, fichiers: 0 };
  // Le registre est reconstruit : il doit contenir l'équipe qui vient de recevoir les
  // données, même s'il avait été écrit avant.
  cache = null;
  lire();
  if (!equipeExiste(EQUIPE_DEFAUT.id)) {
    cache = [{ ...EQUIPE_DEFAUT }, ...lire()];
    writeJson(FICHIER, cache);
  }
  return { migre: true, fichiers: deplaces.length };
}
