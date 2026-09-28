import { getSnapshot, purgeRecords } from './businessData.js';

/**
 * Purge automatique des éléments périmés : tâches terminées et absences passées de plus de
 * RETENTION_DAYS jours.
 *
 * Elle s'exécute ICI, sur le serveur, et nulle part ailleurs en mode client/serveur. Si
 * chaque navigateur purgeait de son côté, dix postes ouverts lanceraient dix suppressions
 * concurrentes de la même chose : la première réussit, les neuf autres émettent des
 * suppressions d'éléments déjà disparus et font remonter autant d'erreurs de synchronisation
 * à des utilisateurs qui n'ont rien demandé. Le serveur est le seul à détenir les données,
 * c'est donc lui qui les nettoie, et les navigateurs le découvrent au sondage suivant comme
 * n'importe quelle autre modification.
 *
 * CE QUI EST SUPPRIMÉ EST SUPPRIMÉ. Il n'y a pas de corbeille : le seul retour en arrière
 * est la sauvegarde du soir (voir packaging/scripts/Backup-SuiviInfra.ps1 et
 * Restore-SuiviInfra.ps1). C'est la raison pour laquelle la règle ci-dessous est
 * délibérément prudente sur les cas ambigus.
 */

export const RETENTION_DAYS = 10;

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Date « AAAA-MM-JJ » à partir de laquelle un élément est conservé. Tout ce qui est
 *  strictement antérieur est périmé. */
export function cutoffDate(now, days = RETENTION_DAYS) {
  return new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
}

/**
 * Ce qui serait supprimé, sans rien supprimer. Fonction pure : c'est elle qu'on éprouve, et
 * c'est elle que l'aperçu affiche avant que quiconque appuie sur un bouton.
 */
export function findExpired(snapshot, now, days = RETENTION_DAYS) {
  const limite = cutoffDate(now, days);

  const taches = snapshot.tasks.filter((t) => {
    if (t.status !== 'termine') return false;
    // Pas de date d'achèvement : on ne purge PAS. Une tâche marquée terminée avant que ce
    // champ n'existe, ou importée sans lui, n'a aucune date fiable — se rabattre sur
    // createdAt supprimerait une tâche créée il y a un an et terminée ce matin.
    if (!t.completedAt) return false;
    return String(t.completedAt).slice(0, 10) < limite;
  });

  const absences = snapshot.absences.filter((a) => a.date && a.date < limite);

  const taskIds = new Set(taches.map((t) => t.id));
  // Les saisies de temps rattachées partent avec la tâche : sans elle, elles ne s'affichent
  // nulle part (tous les écrans passent par le titre de la tâche) tout en continuant à peser
  // dans le fichier. Ce sont des heures de travail réelles : c'est la conséquence la plus
  // lourde de cette purge, et elle est annoncée comme telle dans l'application.
  const timeEntries = snapshot.timeEntries.filter((e) => taskIds.has(e.taskId));

  return {
    cutoff: limite,
    tasks: taches,
    absences,
    timeEntries,
    total: taches.length + absences.length + timeEntries.length,
  };
}

/** Applique la purge et renvoie le compte de ce qui a été retiré. */
export function purgeExpired(now = new Date(), days = RETENTION_DAYS) {
  const expired = findExpired(getSnapshot(), now, days);
  if (expired.total === 0) {
    return { ...counts(expired), purged: false, cutoff: expired.cutoff };
  }
  purgeRecords({
    taskIds: expired.tasks.map((t) => t.id),
    absenceIds: expired.absences.map((a) => a.id),
    timeEntryIds: expired.timeEntries.map((e) => e.id),
  });
  return { ...counts(expired), purged: true, cutoff: expired.cutoff };
}

function counts(expired) {
  return {
    tasks: expired.tasks.length,
    absences: expired.absences.length,
    timeEntries: expired.timeEntries.length,
  };
}

/**
 * Un passage au démarrage, puis un par heure. Pas de date de dernière exécution sur disque,
 * contrairement à l'envoi de mail : repasser n'a aucun effet de bord, puisque la règle porte
 * sur l'état des données et non sur un événement à ne pas rejouer.
 */
export function startRetentionScheduler() {
  const run = () => {
    try {
      const r = purgeExpired();
      if (r.purged) {
        console.log(
          `[purge] ${r.tasks} tâche(s) terminée(s), ${r.absences} absence(s) et ${r.timeEntries} saisie(s) de temps supprimées (antérieures au ${r.cutoff}).`
        );
      }
    } catch (error) {
      console.error(`[purge] Échec : ${error.message}`);
    }
  };
  console.log(`[purge] Rétention : ${RETENTION_DAYS} jours après achèvement ou après la date d'absence.`);
  setInterval(run, HOUR).unref();
  run();
}
