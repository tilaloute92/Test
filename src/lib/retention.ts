import type { Absence, ProjectTask, TimeEntry } from '../types';

/**
 * Purge automatique : tâches terminées et absences passées de plus de RETENTION_DAYS jours.
 *
 * Ce fichier est le pendant client de server/src/retention.js, et les deux règles doivent
 * rester identiques — voir `findExpired` là-bas. Elles sont écrites deux fois parce que le
 * serveur est en JavaScript simple et l'application en TypeScript, et qu'un module partagé
 * obligerait l'un des deux à changer d'outillage pour trente lignes.
 *
 * QUI PURGE QUOI. En mode client/serveur, c'est le serveur, et lui seul : les données n'y
 * sont pas dans le navigateur, et dix postes ouverts émettraient dix suppressions
 * concurrentes des mêmes éléments. Le code ci-dessous ne s'exécute donc qu'en mode
 * AUTONOME, où le navigateur détient effectivement les données.
 *
 * CE QUI EST SUPPRIMÉ EST SUPPRIMÉ. Le seul retour en arrière est l'historique de
 * sauvegarde local ou un export (Paramètres → Sauvegarde).
 */

export const RETENTION_DAYS = 10;

const DAY = 24 * 60 * 60 * 1000;

/** Date « AAAA-MM-JJ » à partir de laquelle un élément est conservé ; tout ce qui est
 *  strictement antérieur est périmé. */
export function cutoffDate(now: Date, days: number = RETENTION_DAYS): string {
  return new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
}

export interface ExpiredRecords {
  cutoff: string;
  tasks: ProjectTask[];
  absences: Absence[];
  timeEntries: TimeEntry[];
  total: number;
}

/** Ce qui serait supprimé, sans rien supprimer. C'est cette fonction que la page
 *  Paramètres interroge pour annoncer le prochain passage. */
export function findExpired(
  data: { tasks: ProjectTask[]; absences: Absence[]; timeEntries: TimeEntry[] },
  now: Date,
  days: number = RETENTION_DAYS
): ExpiredRecords {
  const cutoff = cutoffDate(now, days);

  const tasks = data.tasks.filter((t) => {
    if (t.status !== 'termine') return false;
    // Pas de date d'achèvement : on ne purge PAS. Une tâche marquée terminée avant que ce
    // champ n'existe n'a aucune date fiable, et se rabattre sur createdAt supprimerait une
    // tâche créée il y a un an et terminée ce matin.
    if (!t.completedAt) return false;
    return t.completedAt.slice(0, 10) < cutoff;
  });

  const absences = data.absences.filter((a) => Boolean(a.date) && a.date < cutoff);

  const taskIds = new Set(tasks.map((t) => t.id));
  // Les saisies de temps partent avec leur tâche : sans elle, elles ne s'affichent nulle
  // part — tous les écrans passent par le titre de la tâche — tout en continuant à peser.
  const timeEntries = data.timeEntries.filter((e) => taskIds.has(e.taskId));

  return { cutoff, tasks, absences, timeEntries, total: tasks.length + absences.length + timeEntries.length };
}
