/**
 * Le relevé mensuel de la charge — ce qui reste d'un mois quand ses tâches ont été purgées.
 *
 * POURQUOI. L'historique de charge sur 3, 6 et 12 mois se calcule à partir des saisies de
 * temps. Or une saisie part avec sa tâche à la purge : plus la rétention est courte, plus
 * le graphique se vide par la gauche, et il affiche alors un effondrement de la charge qui
 * n'a jamais eu lieu. C'est ce qui obligeait à garder treize mois de tâches terminées.
 *
 * Ce module casse le lien : avant chaque purge, le mois écoulé est réduit à une ligne —
 * des heures par nature, un total, une capacité — et cette ligne-là ne se purge pas. Le
 * graphique lit le relevé pour les mois sortis de la fenêtre de rétention, les données
 * vivantes pour les autres. La durée de conservation des tâches devient alors un choix
 * d'organisation, et non plus une contrainte technique.
 *
 * CE QUI EST PERDU reste perdu : le détail par tâche, par personne, par jour. On ne garde
 * que ce que le graphique montre. Un relevé qui prétendrait tout reconstituer serait une
 * deuxième base de données à tenir juste.
 *
 * Le calcul reproduit volontairement celui de src/lib/chargeHistory.ts — le serveur et le
 * navigateur ne partagent pas de code. Les deux doivent donner le même chiffre pour un
 * même mois : toute correction ici en appelle une là-bas.
 */

/** Une demi-journée. Même valeur que PERIOD_HOURS côté navigateur. */
const HEURES_DEMI_JOURNEE = 4;

/** Cinq ans de relevés. Une ligne par mois : le fichier reste minuscule. */
export const RELEVES_MAX = 60;

/** Jusqu'où on remonte pour rattraper des mois jamais archivés (serveur longtemps arrêté). */
const MOIS_RATTRAPAGE = 36;

function cleMois(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function finDuMois(annee, mois) {
  return new Date(annee, mois + 1, 0).toISOString().slice(0, 10);
}

/**
 * La capacité du mois : le volume hebdomadaire de chacun ramené aux jours du mois, moins
 * les demi-journées d'absence. Calculée sur l'effectif ET les absences D'AUJOURD'HUI,
 * faute de mieux : les absences sont purgées au bout de dix jours, donc un mois archivé
 * tardivement verra une capacité surestimée. C'est une raison de plus d'archiver tôt —
 * le planificateur passe toutes les heures.
 */
function capaciteDuMois(annee, mois, members, absences) {
  const jours = new Date(annee, mois + 1, 0).getDate();
  const prefixe = `${annee}-${String(mois + 1).padStart(2, '0')}`;
  let capacite = 0;
  for (const m of members) capacite += (m.weeklyHours * jours) / 7;
  for (const a of absences) {
    if (!String(a.date ?? '').startsWith(prefixe)) continue;
    if (!members.some((m) => m.id === a.memberId)) continue;
    capacite -= a.period === 'jour' ? HEURES_DEMI_JOURNEE * 2 : HEURES_DEMI_JOURNEE;
  }
  return Math.max(0, Math.round(capacite));
}

function releveDuMois(snapshot, annee, mois) {
  const prefixe = `${annee}-${String(mois + 1).padStart(2, '0')}`;
  const taches = new Map(snapshot.tasks.map((t) => [t.id, t]));
  const heures = { Projet: 0, Incident: 0, MCO: 0, Demande: 0 };
  let heuresSansTache = 0;
  let total = 0;
  for (const e of snapshot.timeEntries) {
    if (!String(e.date ?? '').startsWith(prefixe)) continue;
    const t = taches.get(e.taskId);
    if (t && heures[t.type] !== undefined) heures[t.type] += e.hours;
    else heuresSansTache += e.hours;
    total += e.hours;
  }
  const arrondi = (n) => Math.round(n * 10) / 10;
  for (const n of Object.keys(heures)) heures[n] = arrondi(heures[n]);
  return {
    mois: `${annee}-${String(mois + 1).padStart(2, '0')}`,
    heures,
    heuresSansTache: arrondi(heuresSansTache),
    total: arrondi(total),
    capacite: capaciteDuMois(annee, mois, snapshot.members, snapshot.absences),
  };
}

/**
 * Les relevés à ajouter : les mois CLOS qui n'en ont pas encore un.
 *
 * Le mois en cours n'est jamais archivé — il n'est pas fini, et les données vivantes le
 * décrivent mieux. Un mois déjà archivé n'est jamais recalculé : son relevé a été pris
 * quand les données étaient complètes, le recalculer après une purge le ferait rétrécir.
 *
 * `partiel` marque un mois dont la purge a déjà pu emporter une partie des saisies avant
 * qu'on l'archive — serveur arrêté plusieurs mois, ou rétention très courte. Le chiffre
 * est alors un plancher, pas une mesure, et l'affichage doit le dire plutôt que de le
 * présenter comme les autres.
 */
export function relevesAAjouter(snapshot, archive, { now = new Date(), cutoff } = {}) {
  const lignes = Array.isArray(archive) ? archive : [];
  const connus = new Set(lignes.map((l) => l.mois));
  // AU PREMIER PASSAGE, rien n'est « partiel ». Le relevé est pris avant la purge du même
  // passage : les données qu'il voit sont celles qui existent, point. Ce n'est qu'une fois
  // le mécanisme en place qu'un mois archivé tardivement signifie qu'une purge est passée
  // entre-temps — et c'est ce cas-là, et lui seul, que le drapeau doit désigner.
  const dejaEnPlace = lignes.length > 0;
  const nouveaux = [];
  for (let i = MOIS_RATTRAPAGE; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const cle = cleMois(d);
    if (connus.has(cle)) continue;
    const releve = releveDuMois(snapshot, d.getFullYear(), d.getMonth());
    // UN MOIS SANS LA MOINDRE SAISIE N'EST PAS ARCHIVÉ. Un relevé à zéro ne dirait rien
    // de plus que l'absence de données — le graphique affiche zéro dans les deux cas —
    // mais il GÈLERAIT ce zéro : une saisie faite en retard sur ce mois, chose courante,
    // ne compterait plus une fois le mois sorti de la fenêtre. On archive ce qu'il y a à
    // conserver, pas le vide.
    if (releve.total === 0) continue;
    nouveaux.push({
      ...releve,
      partiel: dejaEnPlace && Boolean(cutoff && finDuMois(d.getFullYear(), d.getMonth()) < cutoff),
      arreteLe: now.toISOString(),
    });
  }
  return nouveaux;
}

/** Les relevés, du plus ancien au plus récent, bornés à RELEVES_MAX. */
export function fusionner(archive, nouveaux) {
  const tout = [...(Array.isArray(archive) ? archive : []), ...nouveaux];
  tout.sort((a, b) => a.mois.localeCompare(b.mois));
  return tout.slice(-RELEVES_MAX);
}
