import { PERIOD_RANGES, getHourSlots } from './hours';
import type { Period, PlanningSlot, TimeEntry } from '../types';

/**
 * Placement des activités dans les tranches d'une heure de la journée.
 *
 * Une demi-journée ne porte qu'une tâche "prévue" (PlanningSlot.taskId), alors qu'on peut y
 * travailler successivement sur plusieurs choses. Ce module calcule, pour chaque tranche
 * d'une heure, quelle activité l'occupe réellement : ce sont les SAISIES DE TEMPS qui font
 * foi, et les heures sans saisie retombent sur la tâche prévue.
 *
 * Deux façons de saisir, donc deux façons de placer :
 *
 *   - ANCRÉE : la saisie porte une heure (`TimeEntry.hour`), parce qu'elle a été validée sur
 *     une tranche précise depuis la grille horaire. Elle occupe cette tranche, un point
 *     c'est tout — valider 16:00 avant 14:00 doit afficher l'activité à 16:00.
 *   - FLOTTANTE : la saisie ne porte qu'une durée, parce qu'elle vient du formulaire
 *     « Saisir le temps passé » ou d'une version antérieure. Elle se range bout à bout
 *     depuis le début du créneau, dans les tranches laissées libres par les ancrées.
 *
 * Les ancrées sont placées EN PREMIER : sans cela, une flottante saisie plus tôt occuperait
 * une tranche qu'une ancrée revendique explicitement, et l'affichage contredirait ce que la
 * personne a validé de sa main.
 *
 * DEUX RÈGLES, APPRISES D'UN DÉFAUT. Une ancrée écrasait sa voisine : 3 h posées à 08:00
 * puis 1 h posée à 09:00 donnaient trois tranches occupées pour quatre heures saisies, et
 * la matinée était comptée 3 h. Et une ancrée qui débordait de la demi-journée (3 h à
 * 11:00) perdait purement et simplement ce qui dépassait. Désormais :
 *
 *   1. une tranche prise le reste — la première saisie posée la garde, la suivante se
 *      décale sur la première tranche libre plutôt que de la déloger ;
 *   2. ce qui ne rentre nulle part est COMPTÉ et renvoyé (`trancheseHorsGrille`), pour que
 *      l'écran puisse le dire. Une matinée n'a que quatre tranches : y saisir cinq heures
 *      est possible, le cacher ne l'est pas.
 *
 * Tout se compte en TRANCHES D'UNE HEURE, comme les créneaux récurrents : une saisie d'1 h 30
 * en occupe deux. La grille ne sait afficher que des tranches entières, et les heures
 * réellement saisies, elles, restent la somme des saisies — elles ne passent pas par ici.
 */

/** Ce qu'affiche une tranche d'une heure. */
export interface HourAssignment {
  hour: number;
  taskId: string | null;
  /** D'où vient l'information : temps réellement saisi, créneau prévisionnel, ou rien. */
  source: 'saisi' | 'prevu' | null;
}

export interface PlacedItem {
  taskId: string;
  hours: number;
  /** Tranche de début imposée. Absent = l'activité flotte à la suite des précédentes. */
  hour?: number;
}

/** Les tranches couvertes par une activité démarrant à `from` et durant `hours`.
 *  `end` borne la demi-journée ; `Infinity` donne la liste naturelle, débordement compris. */
function tranches(from: number, hours: number, end: number): number[] {
  const to = Math.min(from + hours, end);
  const couvertes: number[] = [];
  for (let h = Math.floor(from); h < Math.ceil(to); h++) {
    // Une tranche est attribuée à l'activité qui l'occupe au moment où elle commence.
    if (h + 1 <= from || h >= to) continue;
    couvertes.push(h);
  }
  return couvertes;
}

export interface Placement {
  /** Tranche d'une heure → identifiant de l'activité qui l'occupe. */
  parTranche: Map<number, string>;
  /** Tranches qu'aucune heure de la demi-journée n'a pu porter : elle est pleine. */
  trancheseHorsGrille: number;
}

/**
 * Répartit les activités sur les heures de la demi-journée (voir l'en-tête du module pour
 * les deux règles). Ce qui ne tient pas est compté, jamais effacé en silence.
 */
export function placeItems(period: Period, items: PlacedItem[]): Placement {
  const { start, end } = PERIOD_RANGES[period];
  const parTranche = new Map<number, string>();
  /** Ce qu'il reste à caser pour chaque activité, indexé comme `items`. */
  const restant = new Map<number, number>();

  // 1. Les ancrées, sur LEURS tranches — sans déloger celles déjà prises.
  items.forEach((item, i) => {
    if (item.hours <= 0 || item.hour === undefined) return;
    const voulues = tranches(item.hour, item.hours, Infinity);
    let obtenues = 0;
    for (const h of voulues) {
      if (h < start || h >= end || parTranche.has(h)) continue;
      parTranche.set(h, item.taskId);
      obtenues += 1;
    }
    if (voulues.length > obtenues) restant.set(i, voulues.length - obtenues);
  });

  // 2. Les flottantes, et ce que les ancrées n'ont pas pu poser, à la suite dans les
  //    tranches libres — dans l'ordre de saisie, celui des `items` : une activité notée
  //    avant une autre reste affichée avant elle.
  const reste = items
    .map((item, i) => ({
      taskId: item.taskId,
      tranches:
        item.hours <= 0 ? 0 : item.hour === undefined ? tranches(start, item.hours, Infinity).length : (restant.get(i) ?? 0),
    }))
    .filter((r) => r.tranches > 0);

  let curseur = start;
  let trancheseHorsGrille = 0;
  for (const r of reste) {
    let restant = r.tranches;
    while (restant > 0 && curseur < end) {
      if (!parTranche.has(curseur)) {
        parTranche.set(curseur, r.taskId);
        restant -= 1;
      }
      curseur += 1;
    }
    trancheseHorsGrille += restant;
  }

  return { parTranche, trancheseHorsGrille };
}

/** Les saisies de temps d'une personne sur une demi-journée, dans l'ordre où elles ont été faites. */
export function entriesFor(timeEntries: TimeEntry[], memberId: string, iso: string, period: Period): TimeEntry[] {
  return timeEntries.filter((e) => e.memberId === memberId && e.date === iso && e.period === period);
}

/** Convertit des saisies en éléments plaçables, en conservant leur ancrage éventuel. */
export function toPlacedItems(entries: TimeEntry[]): PlacedItem[] {
  return entries.map((e) => ({ taskId: e.taskId, hours: e.hours, hour: e.hour }));
}

/**
 * Quelle SAISIE occupe chaque tranche — et non plus seulement quelle tâche.
 *
 * La grille horaire d'Activité du jour en a besoin : pour annuler une heure il faut savoir
 * laquelle des saisies la couvre, et pour l'annoncer honnêtement il faut sa durée réelle —
 * retirer une tranche d'une saisie de trois heures les retire toutes les trois.
 *
 * L'indice sert de clé le temps du placement : deux saisies peuvent porter la même tâche
 * sur deux tranches différentes, et les distinguer par taskId les confondrait.
 */
export interface PlacementSaisies {
  parTranche: Map<number, TimeEntry>;
  /** Heures saisies qu'aucune tranche ne peut porter — la demi-journée n'en a que quatre.
   *  Affiché tel quel : une matinée à 5 h de saisies doit le dire, pas en perdre une. */
  heuresHorsGrille: number;
}

export function placeEntries(period: Period, entries: TimeEntry[]): PlacementSaisies {
  const { parTranche: parIndice, trancheseHorsGrille } = placeItems(
    period,
    entries.map((e, i) => ({ taskId: String(i), hours: e.hours, hour: e.hour }))
  );
  const parTranche = new Map<number, TimeEntry>();
  for (const [heure, indice] of parIndice) parTranche.set(heure, entries[Number(indice)]);
  return { parTranche, heuresHorsGrille: trancheseHorsGrille };
}

/**
 * Les 13 tranches de 06:00 à 19:00 pour une personne un jour donné : les saisies de temps
 * du créneau s'y rangent, et les heures restantes affichent la tâche prévue.
 */
export function assignHours(slot: PlanningSlot | undefined, entries: (period: Period) => TimeEntry[]): HourAssignment[] {
  // Calculé une fois par créneau plutôt qu'à chaque tranche : la version précédente
  // rappelait `entries()` et replaçait tout treize fois par personne et par jour.
  const parCreneau = new Map<Period, Map<number, string>>();
  const place = (period: Period) => {
    let m = parCreneau.get(period);
    if (!m) {
      m = placeItems(period, toPlacedItems(entries(period))).parTranche;
      parCreneau.set(period, m);
    }
    return m;
  };

  return getHourSlots().map(({ hour, period }) => {
    if (period === null) return { hour, taskId: null, source: null };

    const hit = place(period).get(hour);
    if (hit) return { hour, taskId: hit, source: 'saisi' };

    // Aucune activité saisie sur cette heure : on retombe sur le prévisionnel de la demi-journée.
    if (slot?.taskId) return { hour, taskId: slot.taskId, source: 'prevu' };
    return { hour, taskId: null, source: null };
  });
}
