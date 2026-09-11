import type { Period } from '../types';

/**
 * Découpage horaire de la journée, utilisé par l'onglet Planning pour afficher le matin et
 * l'après-midi par tranches d'une heure.
 *
 * ATTENTION — c'est un découpage d'AFFICHAGE uniquement : l'affectation d'une tâche reste
 * faite à la demi-journée (voir `PlanningSlot.period` dans src/types.ts). Une tranche d'une
 * heure n'est donc jamais stockée ; elle hérite de la tâche du créneau (matin ou après-midi)
 * qui la contient. Cliquer sur 09:00 revient à cliquer sur "Matin".
 */

/** Première heure affichée dans la grille (6h) — avant les horaires ouvrés, pour les horaires décalés. */
export const DAY_START_HOUR = 6;

/** Dernière borne affichée (19h) : la dernière tranche est donc 18:00 → 19:00. */
export const DAY_END_HOUR = 19;

/** Horaires ouvrés de chaque demi-journée. `end` est exclusif : 8→12 = 8h, 9h, 10h et 11h. */
export const PERIOD_RANGES: Record<Period, { start: number; end: number }> = {
  matin: { start: 8, end: 12 },
  apres_midi: { start: 14, end: 18 },
};

export const PERIOD_LABELS: Record<Period, string> = { matin: 'Matin', apres_midi: 'Après-midi' };

export interface HourSlot {
  /** Heure de début, 6 à 18. */
  hour: number;
  /** "08:00" */
  label: string;
  /** "08:00 → 09:00" */
  rangeLabel: string;
  /** Demi-journée à laquelle la tranche appartient, ou null si elle est hors horaires ouvrés. */
  period: Period | null;
}

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** La demi-journée contenant cette heure, ou null hors horaires ouvrés (avant 8h, pause déjeuner, après 18h). */
export function periodForHour(hour: number): Period | null {
  for (const period of ['matin', 'apres_midi'] as Period[]) {
    const { start, end } = PERIOD_RANGES[period];
    if (hour >= start && hour < end) return period;
  }
  return null;
}

/** Toutes les tranches affichées, de 6h à 18h incluses (la dernière se termine à 19h). */
export function getHourSlots(): HourSlot[] {
  const slots: HourSlot[] = [];
  for (let hour = DAY_START_HOUR; hour < DAY_END_HOUR; hour++) {
    slots.push({
      hour,
      label: formatHour(hour),
      rangeLabel: `${formatHour(hour)} → ${formatHour(hour + 1)}`,
      period: periodForHour(hour),
    });
  }
  return slots;
}

/** "08:00 → 12:00" — l'amplitude ouvrée d'une demi-journée, pour l'afficher à côté de son nom. */
export function periodRangeLabel(period: Period): string {
  const { start, end } = PERIOD_RANGES[period];
  return `${formatHour(start)} → ${formatHour(end)}`;
}

/** Nombre d'heures ouvrées d'une demi-journée (4h le matin, 4h l'après-midi). */
export function periodHours(period: Period): number {
  const { start, end } = PERIOD_RANGES[period];
  return end - start;
}
