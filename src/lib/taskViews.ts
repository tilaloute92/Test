import type { ProjectTask, TaskStatus } from '../types';
import { addDays, toISODate } from './date';

export const KANBAN_STATUSES: TaskStatus[] = ['a_faire', 'en_cours', 'en_attente', 'termine'];

export type DueBucketKey = 'retard' | 'aujourdhui' | 'semaine' | 'mois' | 'plus_tard' | 'sans_echeance';

export const DUE_BUCKET_LABELS: Record<DueBucketKey, string> = {
  retard: 'En retard',
  aujourdhui: "Aujourd'hui",
  semaine: 'Cette semaine',
  mois: 'Ce mois-ci',
  plus_tard: 'Plus tard',
  sans_echeance: 'Sans échéance',
};

const BUCKET_ORDER: DueBucketKey[] = ['retard', 'aujourdhui', 'semaine', 'mois', 'plus_tard', 'sans_echeance'];

function bucketFor(dueDate: string | undefined, todayISO: string, in7ISO: string, in31ISO: string): DueBucketKey {
  if (!dueDate) return 'sans_echeance';
  if (dueDate < todayISO) return 'retard';
  if (dueDate === todayISO) return 'aujourdhui';
  if (dueDate <= in7ISO) return 'semaine';
  if (dueDate <= in31ISO) return 'mois';
  return 'plus_tard';
}

/**
 * Regroupe les tâches par échéance (en retard / aujourd'hui / cette semaine / ce mois-ci /
 * plus tard / sans échéance), triées chronologiquement dans chaque groupe — vue
 * "Échéancier", pensée pour repérer d'un coup d'œil ce qui presse, contrairement au tableau
 * (trié par défaut) ou au Kanban (organisé par statut, pas par date).
 */
export function bucketTasksByDueDate(tasks: ProjectTask[]): { key: DueBucketKey; label: string; tasks: ProjectTask[] }[] {
  const today = new Date();
  const todayISO = toISODate(today);
  const in7ISO = toISODate(addDays(today, 7));
  const in31ISO = toISODate(addDays(today, 31));

  const groups: Record<DueBucketKey, ProjectTask[]> = {
    retard: [],
    aujourdhui: [],
    semaine: [],
    mois: [],
    plus_tard: [],
    sans_echeance: [],
  };

  for (const t of tasks) {
    groups[bucketFor(t.dueDate, todayISO, in7ISO, in31ISO)].push(t);
  }

  for (const key of BUCKET_ORDER) {
    groups[key].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  }

  return BUCKET_ORDER.filter((key) => groups[key].length > 0).map((key) => ({ key, label: DUE_BUCKET_LABELS[key], tasks: groups[key] }));
}
