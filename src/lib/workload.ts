import { PERIOD_HOURS, toISODate } from './date';
import type { Absence, PlanningSlot } from '../types';

export interface WorkloadResult {
  capacityHours: number;
  plannedHours: number;
  freeHours: number;
  ratio: number; // plannedHours / capacityHours
}

export function isAbsent(absences: Absence[], memberId: string, date: Date, period: 'matin' | 'apres_midi'): boolean {
  const iso = toISODate(date);
  return absences.some(
    (a) => a.memberId === memberId && a.date === iso && (a.period === 'jour' || a.period === period)
  );
}

export function computeWorkload(
  memberId: string,
  days: Date[],
  planningSlots: PlanningSlot[],
  absences: Absence[]
): WorkloadResult {
  let capacityHours = 0;
  let plannedHours = 0;

  for (const day of days) {
    for (const period of ['matin', 'apres_midi'] as const) {
      const absent = isAbsent(absences, memberId, day, period);
      if (!absent) capacityHours += PERIOD_HOURS;

      const iso = toISODate(day);
      const slot = planningSlots.find(
        (s) => s.memberId === memberId && s.date === iso && s.period === period
      );
      if (slot?.taskId && !absent) plannedHours += PERIOD_HOURS;
    }
  }

  const freeHours = Math.max(capacityHours - plannedHours, 0);
  const ratio = capacityHours > 0 ? plannedHours / capacityHours : 0;

  return { capacityHours, plannedHours, freeHours, ratio };
}

export type WorkloadLevel = 'sous-charge' | 'equilibre' | 'charge' | 'surcharge';

export function workloadLevel(ratio: number): WorkloadLevel {
  if (ratio < 0.5) return 'sous-charge';
  if (ratio < 0.85) return 'equilibre';
  if (ratio <= 1.05) return 'charge';
  return 'surcharge';
}

export const workloadColors: Record<WorkloadLevel, { bg: string; text: string; bar: string; label: string }> = {
  'sous-charge': { bg: 'bg-sky-500/10', text: 'text-sky-600 dark:text-sky-400', bar: 'bg-sky-500', label: 'Sous-chargé' },
  equilibre: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500', label: 'Équilibré' },
  charge: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500', label: 'Chargé' },
  surcharge: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', bar: 'bg-red-500', label: 'Surchargé' },
};
