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

/** Les tranches couvertes par une activité démarrant à `from` et durant `hours`. */
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

/**
 * Répartit les activités sur les heures de la demi-journée. Une activité qui déborde du
 * créneau est tronquée à sa dernière heure : le créneau ne s'étire pas au-delà de 12:00 ou
 * 18:00.
 */
export function placeItems(period: Period, items: PlacedItem[]): Map<number, string> {
  const { start, end } = PERIOD_RANGES[period];
  const placed = new Map<number, string>();

  // 1. Les ancrées, qui revendiquent une tranche précise.
  for (const item of items) {
    if (item.hours <= 0 || item.hour === undefined) continue;
    for (const h of tranches(item.hour, item.hours, end)) placed.set(h, item.taskId);
  }

  // 2. Les flottantes, à la suite, en sautant ce qui est déjà pris.
  let cursor = start;
  for (const item of items) {
    if (item.hours <= 0 || item.hour !== undefined) continue;
    let restant = item.hours;
    while (restant > 0 && cursor < end) {
      if (placed.has(Math.floor(cursor))) {
        cursor = Math.floor(cursor) + 1;
        continue;
      }
      const pas = Math.min(restant, Math.floor(cursor) + 1 - cursor || 1);
      for (const h of tranches(cursor, pas, end)) placed.set(h, item.taskId);
      cursor += pas;
      restant -= pas;
    }
  }

  return placed;
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
export function placeEntries(period: Period, entries: TimeEntry[]): Map<number, TimeEntry> {
  const parIndice = placeItems(
    period,
    entries.map((e, i) => ({ taskId: String(i), hours: e.hours, hour: e.hour }))
  );
  const resultat = new Map<number, TimeEntry>();
  for (const [heure, indice] of parIndice) resultat.set(heure, entries[Number(indice)]);
  return resultat;
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
      m = placeItems(period, toPlacedItems(entries(period)));
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
