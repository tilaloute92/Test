import { PERIOD_HOURS, toISODate } from './date';
import type { Absence, PlanningSlot, TeamMember } from '../types';

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

/**
 * La charge d'une personne se mesure par rapport à son propre volume hebdomadaire
 * (`member.weeklyHours`, 40h par défaut mais modifiable par personne dans l'onglet
 * Équipe) — pas en comptant les jours affichés. C'est ce qui permet des horaires
 * décalés (travail le week-end, jours de repos en semaine) sans fausser le calcul :
 * ajouter samedi/dimanche à la grille ne change la capacité de personne, seul ce qui
 * est réellement planifié sur ces jours compte. Si une personne est planifiée au-delà
 * de son volume hebdomadaire (ex. week-end en plus d'une semaine déjà pleine), le ratio
 * dépasse 100% — c'est le signal de surcharge.
 *
 * `days` doit représenter une semaine complète (7 jours) pour que la comparaison avec
 * `weeklyHours` ait un sens.
 */
export function computeWorkload(
  member: TeamMember,
  days: Date[],
  planningSlots: PlanningSlot[],
  absences: Absence[]
): WorkloadResult {
  let absentHours = 0;
  let plannedHours = 0;

  for (const day of days) {
    for (const period of ['matin', 'apres_midi'] as const) {
      const absent = isAbsent(absences, member.id, day, period);
      if (absent) absentHours += PERIOD_HOURS;

      const iso = toISODate(day);
      const slot = planningSlots.find(
        (s) => s.memberId === member.id && s.date === iso && s.period === period
      );
      if (slot?.taskId && !absent) plannedHours += PERIOD_HOURS;
    }
  }

  const capacityHours = Math.max(member.weeklyHours - absentHours, 0);
  const freeHours = Math.max(capacityHours - plannedHours, 0);
  const ratio = capacityHours > 0 ? plannedHours / capacityHours : 0;

  return { capacityHours, plannedHours, freeHours, ratio };
}

/**
 * La cible d'une journée : le volume hebdomadaire sur cinq jours, moins ce que
 * l'absence du jour retire.
 *
 * Deux raisons de déduire. Un temps partiel ne doit pas être mesuré à l'aune d'une
 * journée pleine — d'où le volume hebdomadaire plutôt qu'une constante de 8 h. Et
 * quelqu'un d'absent le matin n'a pas une journée de 8 h : la cible restait pourtant
 * à 8 h, si bien qu'une demi-journée travaillée en entier s'affichait « 4h / 8h »,
 * comme un retard. La charge de la SEMAINE, elle, déduisait déjà les absences — les
 * deux écrans ne disaient pas la même chose.
 *
 * La déduction est proportionnelle (une demi-journée = la moitié de la cible) et non
 * de 4 h fixes : à 20 h par semaine, retirer 4 h d'une journée de 4 h la ramènerait à
 * zéro pour une simple matinée d'absence.
 *
 * Une seule définition pour les trois écrans qui l'affichent (Ma journée, Activité du
 * jour en fiches et en tableau) : la formule a déjà existé en trois exemplaires, et
 * c'est ainsi qu'elles finissent par diverger.
 */
export function cibleDuJour(member: TeamMember, absences: Absence[], date: Date): number {
  const demiJournees = (['matin', 'apres_midi'] as const).filter((p) => !isAbsent(absences, member.id, date, p)).length;
  return Math.round((member.weeklyHours / 5) * (demiJournees / 2) * 10) / 10;
}

/** « 4h / 8h », ou « absent(e) » quand la journée entière l'est : une cible de 0 h
 *  afficherait « 0h / 0h », ce qui se lit comme une journée vide et non comme une
 *  journée qui n'a pas eu lieu. Du temps saisi malgré l'absence reste montré. */
export function libelleTempsOccupe(occupe: number, cible: number, separateur = '/'): string {
  const h = Math.round(occupe * 100) / 100;
  if (cible > 0) return `${h}h ${separateur} ${cible}h`;
  return h > 0 ? `${h}h · absent(e)` : 'absent(e)';
}

export type WorkloadLevel = 'absent' | 'sous-charge' | 'equilibre' | 'charge' | 'surcharge';

/**
 * Le niveau de charge, à partir du ratio planifié / capacité.
 *
 * `capacityHours` est facultatif mais devrait toujours être passé : une personne absente
 * toute la semaine a une capacité de 0 h, donc un ratio de 0, et se retrouvait affichée
 * « Sous-chargé » en bleu. Elle n'est pas sous-chargée, elle n'est pas là — et ce 0 %
 * tirait en plus vers le bas la charge moyenne de l'équipe, qui pèse dans la météo. Un
 * niveau à part, hors échelle, évite les deux.
 */
export function workloadLevel(ratio: number, capacityHours?: number): WorkloadLevel {
  if (capacityHours === 0) return 'absent';
  if (ratio < 0.5) return 'sous-charge';
  if (ratio < 0.85) return 'equilibre';
  if (ratio <= 1.05) return 'charge';
  return 'surcharge';
}

/**
 * Teintes du document de réunion et du mail, où les classes Tailwind n'ont pas cours.
 * Le niveau est toujours écrit en toutes lettres à côté de la barre : la couleur ne
 * porte jamais l'information seule.
 */
export const workloadHex: Record<WorkloadLevel, string> = {
  absent: '#94a3b8',
  'sous-charge': '#16a34a',
  equilibre: '#16a34a',
  charge: '#d97706',
  surcharge: '#dc2626',
};

export const workloadColors: Record<WorkloadLevel, { bg: string; text: string; bar: string; label: string }> = {
  // Gris : « absent » n'est pas un degré de charge, c'est l'absence d'échelle. Lui donner
  // une couleur de la gamme le ferait lire comme un niveau parmi les autres.
  absent: { bg: 'bg-slate-500/10', text: 'text-slate-500 dark:text-slate-400', bar: 'bg-slate-400', label: 'Absent' },
  'sous-charge': { bg: 'bg-sky-500/10', text: 'text-sky-600 dark:text-sky-400', bar: 'bg-sky-500', label: 'Sous-chargé' },
  equilibre: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500', label: 'Équilibré' },
  charge: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500', label: 'Chargé' },
  surcharge: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', bar: 'bg-red-500', label: 'Surchargé' },
};
