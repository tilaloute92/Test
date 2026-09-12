import { PERIOD_RANGES, getHourSlots } from './hours';
import type { Period, PlanningSlot, TimeEntry } from '../types';

/**
 * Placement des activités dans les tranches d'une heure de la journée.
 *
 * Une demi-journée ne porte qu'une tâche "prévue" (PlanningSlot.taskId), alors qu'on peut y
 * travailler successivement sur plusieurs choses. Ce module calcule, pour chaque tranche
 * d'une heure, quelle activité l'occupe réellement : ce sont les SAISIES DE TEMPS qui font
 * foi. Elles se suivent depuis le début du créneau — 1h sur A puis 1h sur B occupent la
 * première puis la deuxième heure — et les heures sans saisie retombent sur la tâche prévue.
 */

/** Ce qu'affiche une tranche d'une heure. */
export interface HourAssignment {
  hour: number;
  taskId: string | null;
  /** D'où vient l'information : temps réellement saisi, créneau prévisionnel, ou rien. */
  source: 'saisi' | 'prevu' | null;
  /** Vrai sur la première heure d'un bloc : c'est elle qui porte le titre. */
  isBlockStart: boolean;
  /** Durée du bloc auquel cette heure appartient, en heures. */
  blockHours: number;
}

export interface PlacedItem {
  taskId: string;
  hours: number;
}

/**
 * Répartit les activités sur les heures de la demi-journée, dans l'ordre où elles ont été
 * saisies et à la suite les unes des autres depuis le début du créneau. Une activité qui
 * déborde du créneau est tronquée à sa dernière heure : le créneau ne s'étire pas au-delà
 * de 12:00 ou 18:00.
 */
export function placeItems(period: Period, items: PlacedItem[]): Map<number, { taskId: string; blockHours: number; isStart: boolean }> {
  const { start, end } = PERIOD_RANGES[period];
  const placed = new Map<number, { taskId: string; blockHours: number; isStart: boolean }>();
  let cursor = start;

  for (const item of items) {
    if (item.hours <= 0) continue;
    const from = cursor;
    // Une tranche est attribuée à l'activité qui l'occupe au moment où elle commence.
    const to = from + item.hours;
    let first = true;
    for (let h = Math.floor(from); h < Math.ceil(to); h++) {
      if (h + 1 <= from || h >= to) continue;
      placed.set(h, { taskId: item.taskId, blockHours: item.hours, isStart: first });
      first = false;
    }
    cursor = Math.min(to, end);
  }

  return placed;
}

/** Les saisies de temps d'une personne sur une demi-journée, dans l'ordre où elles ont été faites. */
export function entriesFor(timeEntries: TimeEntry[], memberId: string, iso: string, period: Period): TimeEntry[] {
  return timeEntries.filter((e) => e.memberId === memberId && e.date === iso && e.period === period);
}

/**
 * Les 13 tranches de 06:00 à 19:00 pour une personne un jour donné : les saisies de temps
 * du créneau s'y rangent dans l'ordre, et les heures restantes affichent la tâche prévue.
 */
export function assignHours(slot: PlanningSlot | undefined, entries: (period: Period) => TimeEntry[]): HourAssignment[] {
  return getHourSlots().map(({ hour, period }) => {
    if (period === null) return { hour, taskId: null, source: null, isBlockStart: false, blockHours: 0 };

    const items: PlacedItem[] = entries(period).map((e) => ({ taskId: e.taskId, hours: e.hours }));
    const hit = placeItems(period, items).get(hour);
    if (hit) return { hour, taskId: hit.taskId, source: 'saisi', isBlockStart: hit.isStart, blockHours: hit.blockHours };

    // Aucune activité saisie sur cette heure : on retombe sur le prévisionnel de la demi-journée.
    if (slot?.taskId) {
      const firstFree = firstFreeHour(period, items);
      return {
        hour,
        taskId: slot.taskId,
        source: 'prevu',
        isBlockStart: hour === firstFree,
        blockHours: PERIOD_RANGES[period].end - (firstFree ?? PERIOD_RANGES[period].start),
      };
    }
    return { hour, taskId: null, source: null, isBlockStart: false, blockHours: 0 };
  });
}

/** Première heure du créneau qu'aucune activité n'occupe — celle qui portera le titre du prévisionnel. */
function firstFreeHour(period: Period, items: PlacedItem[]): number | null {
  const { start, end } = PERIOD_RANGES[period];
  const placed = placeItems(period, items);
  for (let h = start; h < end; h++) if (!placed.has(h)) return h;
  return null;
}
