import type { Absence, JournalEntry, ProjectTask, TimeEntry } from '../types';

/**
 * Purge automatique : tâches terminées (et leurs saisies) au-delà de RETENTION_ACTIVITE_JOURS,
 * absences passées au-delà de RETENTION_ABSENCES_JOURS.
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

/**
 * DEUX durées, pas une — et c'est la correction d'un défaut sérieux.
 *
 * Une seule durée de 10 jours s'appliquait aux tâches terminées comme aux absences. Les
 * saisies de temps partant avec leur tâche, l'historique de charge sur 3, 6 et 12 mois se
 * vidait à mesure : sur six mois d'activité simulée, 440 h saisies tombaient à 40 h, et
 * le graphique montrait un effondrement de la charge qui n'avait jamais eu lieu. Les
 * heures consommées d'un projet et la relecture d'une semaine passée subissaient la même
 * chose.
 *
 * - ACTIVITÉ (tâches terminées et leurs saisies de temps) : 400 jours. Treize mois, soit
 *   la fenêtre de 12 mois du graphique plus une marge. C'est la mémoire de l'équipe, elle
 *   doit couvrir ce que l'application prétend montrer.
 * - ABSENCES : 10 jours, inchangé. Ce sont des données personnelles — congés, formations —
 *   dont l'application n'a aucun usage une fois la date passée. Les garder treize mois
 *   serait de la conservation sans objet.
 */
export const RETENTION_ACTIVITE_JOURS = 400;
export const RETENTION_ABSENCES_JOURS = 10;


const DAY = 24 * 60 * 60 * 1000;

/** Date « AAAA-MM-JJ » à partir de laquelle un élément est conservé ; tout ce qui est
 *  strictement antérieur est périmé. */
export function cutoffDate(now: Date, days: number = RETENTION_ACTIVITE_JOURS): string {
  return new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
}

export interface ExpiredRecords {
  /** Limite de l'activité (tâches terminées et saisies de temps). */
  cutoff: string;
  /** Limite des absences, plus courte : données personnelles. */
  cutoffAbsences: string;
  tasks: ProjectTask[];
  absences: Absence[];
  timeEntries: TimeEntry[];
  total: number;
}

/** Ce qui serait supprimé, sans rien supprimer. C'est cette fonction que la page
 *  Paramètres interroge pour annoncer le prochain passage. */
export function findExpired(
  data: { tasks: ProjectTask[]; absences: Absence[]; timeEntries: TimeEntry[]; journalEntries?: JournalEntry[] },
  now: Date,
  days: number = RETENTION_ACTIVITE_JOURS,
  joursAbsences: number = RETENTION_ABSENCES_JOURS
): ExpiredRecords {
  const cutoff = cutoffDate(now, days);
  const cutoffAbsences = cutoffDate(now, joursAbsences);
  const noteParTache = new Set((data.journalEntries ?? []).filter((e) => e.nature === 'note').map((e) => e.taskId));

  const tasks = data.tasks.filter((t) => {
    if (t.status !== 'termine') return false;
    // Une tâche que quelqu'un a pris la peine de commenter n'est pas purgée : le journal
    // sert justement à répondre six mois plus tard, et dix jours après la clôture est
    // exactement le moment où l'on cesse d'y penser. Seules les notes écrites à la main
    // comptent — les entrées automatiques, toute tâche en a, et plus rien ne serait purgé.
    if (noteParTache.has(t.id)) return false;

    // Pas de date d'achèvement : on ne purge PAS. Une tâche marquée terminée avant que ce
    // champ n'existe n'a aucune date fiable, et se rabattre sur createdAt supprimerait une
    // tâche créée il y a un an et terminée ce matin.
    if (!t.completedAt) return false;
    return t.completedAt.slice(0, 10) < cutoff;
  });

  const absences = data.absences.filter((a) => Boolean(a.date) && a.date < cutoffAbsences);

  const taskIds = new Set(tasks.map((t) => t.id));
  // Les saisies de temps partent avec leur tâche : sans elle, elles ne s'affichent nulle
  // part — tous les écrans passent par le titre de la tâche — tout en continuant à peser.
  const timeEntries = data.timeEntries.filter((e) => taskIds.has(e.taskId));

  return { cutoff, cutoffAbsences, tasks, absences, timeEntries, total: tasks.length + absences.length + timeEntries.length };
}
