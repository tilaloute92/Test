import { toISODate } from './date';
import { formatDuree, formatHeure, PERIOD_RANGES, periodForHour } from './hours';
import { periodeDe, tranchesCouvertes, type Recurrence } from './recurrences';
import type { Period, ProjectTask, TaskCreneau, TimeEntry } from '../types';

/**
 * Les créneaux horaires posés sur une tâche : « mardi 9:00, 2 h pour A. Dupont ».
 *
 * Ils alimentent Activité du jour à la date et à l'heure dites, mais restent
 * PRÉVISIONNELS : un créneau ne devient du temps passé que le jour où quelqu'un le valide.
 * C'est la différence avec les créneaux récurrents (voir recurrences.ts), qui comptent
 * d'eux-mêmes : une réunion hebdomadaire a lieu, une intervention se reporte. Compter
 * automatiquement une intervention planifiée reviendrait à affirmer qu'elle a eu lieu
 * parce qu'elle était prévue — c'est précisément ce que le suivi doit éviter de dire.
 *
 * Un créneau ne vaut que pour UNE personne : une demande traitée à deux se pose en deux
 * créneaux, ce qui dit du même coup qui fait quoi.
 */

export interface CreneauPose {
  creneau: TaskCreneau;
  task: ProjectTask;
}

export function periodeDuCreneau(c: TaskCreneau): Period {
  return periodForHour(Math.floor(c.debut)) ?? (c.debut < 12 ? 'matin' : 'apres_midi');
}

/** Les tranches d'une heure que le créneau recouvre, même partiellement. */
export function tranchesDuCreneau(c: TaskCreneau): number[] {
  const { start, end } = PERIOD_RANGES[periodeDuCreneau(c)];
  const tranches: number[] = [];
  for (let h = Math.max(start, Math.floor(c.debut)); h < Math.min(end, Math.ceil(c.debut + c.duree)); h++) {
    tranches.push(h);
  }
  return tranches;
}

export function formatPlage(c: TaskCreneau): string {
  return `${formatHeure(c.debut)} → ${formatHeure(c.debut + c.duree)}`;
}

export { formatDuree, formatHeure };

/** Tous les créneaux posés sur une date, toutes tâches confondues. */
export function creneauxDuJour(tasks: ProjectTask[], date: Date, memberId?: string): CreneauPose[] {
  const iso = toISODate(date);
  const out: CreneauPose[] = [];
  for (const task of tasks) {
    for (const creneau of task.creneaux ?? []) {
      if (creneau.date !== iso) continue;
      if (memberId && creneau.memberId !== memberId) continue;
      out.push({ creneau, task });
    }
  }
  return out.sort((a, b) => a.creneau.debut - b.creneau.debut);
}

/**
 * Un créneau est-il déjà honoré ? C'est-à-dire : la personne a-t-elle saisi du temps sur
 * CETTE tâche pendant les heures du créneau ?
 *
 * On ne regarde que la tâche du créneau : avoir passé l'heure prévue sur autre chose ne
 * rend pas l'intervention faite, et le créneau doit rester visible pour qu'on décide quoi
 * en faire — le valider plus tard, ou le déplacer.
 */
export function creneauHonore(c: TaskCreneau, taskId: string, timeEntries: TimeEntry[]): boolean {
  const tranches = new Set(tranchesDuCreneau(c));
  return timeEntries.some(
    (e) =>
      e.taskId === taskId &&
      e.memberId === c.memberId &&
      e.date === c.date &&
      (e.hour === undefined ? false : tranches.has(Math.floor(e.hour)))
  );
}

/** Les créneaux d'une personne sur une demi-journée, et ce qu'il reste à en faire. */
export function creneauxDeLaDemiJournee(opts: {
  tasks: ProjectTask[];
  date: Date;
  memberId: string;
  period: Period;
  timeEntries: TimeEntry[];
}): CreneauPose[] {
  const { tasks, date, memberId, period, timeEntries } = opts;
  return creneauxDuJour(tasks, date, memberId)
    .filter((p) => periodeDuCreneau(p.creneau) === period)
    .filter((p) => !creneauHonore(p.creneau, p.task.id, timeEntries));
}

/**
 * Ce qui empêcherait de poser ce créneau : une récurrence, une saisie déjà faite, un autre
 * créneau. Renvoie le message à afficher, ou null.
 *
 * Vérifié au moment de poser plutôt que corrigé à l'affichage : deux activités sur la même
 * heure, c'est une heure comptée deux fois, et personne ne le remarque dans un total.
 */
export function conflitCreneau(opts: {
  creneau: TaskCreneau;
  taskId: string;
  tasks: ProjectTask[];
  recurrences: Recurrence[];
  timeEntries: TimeEntry[];
  nomDe: (memberId: string) => string;
}): string | null {
  const { creneau, taskId, tasks, recurrences, timeEntries, nomDe } = opts;
  const { start, end } = PERIOD_RANGES[periodeDuCreneau(creneau)];
  if (creneau.debut < start || creneau.debut + creneau.duree > end) {
    return `Un créneau de ${formatDuree(creneau.duree)} à ${formatHeure(creneau.debut)} déborde des heures ouvrées (${formatHeure(start)} – ${formatHeure(end)}).`;
  }

  const jour = new Date(`${creneau.date}T00:00:00`);
  const tranches = new Set(tranchesDuCreneau(creneau));

  const recurrente = recurrences.find(
    (r) =>
      r.jour === jour.getDay() &&
      (r.participants === null || r.participants.includes(creneau.memberId)) &&
      periodeDe(r) === periodeDuCreneau(creneau) &&
      tranchesCouvertes(r).some((h) => tranches.has(h))
  );
  if (recurrente) return `${nomDe(creneau.memberId)} a « ${recurrente.libelle} » sur ces heures-là.`;

  const saisie = timeEntries.find(
    (e) => e.memberId === creneau.memberId && e.date === creneau.date && e.hour !== undefined && tranches.has(Math.floor(e.hour))
  );
  if (saisie) return `${nomDe(creneau.memberId)} a déjà saisi du temps sur ces heures-là.`;

  for (const t of tasks) {
    for (const autre of t.creneaux ?? []) {
      if (autre.id === creneau.id) continue;
      if (autre.memberId !== creneau.memberId || autre.date !== creneau.date) continue;
      if (tranchesDuCreneau(autre).some((h) => tranches.has(h))) {
        return `${nomDe(creneau.memberId)} a déjà un créneau à cette heure-là${t.id === taskId ? '' : ` (${t.title})`}.`;
      }
    }
  }
  return null;
}
