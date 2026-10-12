import type { ProjectTask, TaskType, TimeEntry } from '../types';

/**
 * Regroupement du temps saisi par projet, par tâche et par type.
 *
 * L'onglet Temps totalisait par personne et par jour : il répondait à « qui a saisi
 * combien cette semaine ? », jamais à « combien d'heures avons-nous passé sur la migration
 * AD ? ». C'est pourtant la seconde qu'on pose en COPIL, et c'est elle qui donne une raison
 * de saisir du temps — sans quoi la saisie n'est qu'une corvée dont personne ne voit le
 * produit.
 *
 * Le réalisé est systématiquement présenté face à l'ESTIMÉ. Un nombre d'heures seul ne dit
 * rien : 31h sur une tâche est excellent ou catastrophique selon qu'on en avait prévu 40 ou
 * 12, et c'est le dépassement qui doit sauter aux yeux.
 */

export const HORS_PROJET = 'Hors projet — MCO & incidents';
export const TACHE_SUPPRIMEE = 'Tâches supprimées';

export interface TaskRollup {
  taskId: string;
  titre: string;
  type: TaskType | null;
  /** Heures réellement saisies sur la période. */
  passe: number;
  /** Charge estimée de la tâche. 0 si la tâche n'existe plus. */
  estime: number;
  /** Qui a saisi, pour afficher les pastilles sans refaire le tour des saisies. */
  memberIds: string[];
}

export interface GroupRollup {
  cle: string;
  label: string;
  passe: number;
  estime: number;
  taches: TaskRollup[];
  /** Nombre de tâches du groupe sur lesquelles RIEN n'a été saisi : l'estimé les compte,
   *  et l'omettre ferait passer un groupe à peine commencé pour un groupe en avance. */
  tachesSansTemps: number;
}

function trieGroupes(groupes: GroupRollup[]): GroupRollup[] {
  // Du plus consommé au moins consommé : c'est l'ordre dans lequel on les regarde.
  // « Hors projet » et « Tâches supprimées » descendent en bas quoi qu'il arrive, ce ne
  // sont pas des projets et les voir en tête brouillerait la lecture.
  const rang = (g: GroupRollup) => (g.cle === TACHE_SUPPRIMEE ? 2 : g.cle === HORS_PROJET ? 1 : 0);
  return groupes.sort((a, b) => rang(a) - rang(b) || b.passe - a.passe);
}

/** Agrège les saisies en tâches, pour un sous-ensemble déjà filtré. */
function agregeTaches(entries: TimeEntry[], tasks: ProjectTask[]): Map<string, TaskRollup> {
  const parTache = new Map<string, TaskRollup>();
  for (const e of entries) {
    const t = tasks.find((x) => x.id === e.taskId);
    let r = parTache.get(e.taskId);
    if (!r) {
      r = {
        taskId: e.taskId,
        titre: t?.title ?? 'Tâche supprimée',
        type: t?.type ?? null,
        passe: 0,
        estime: t?.estimatedHours ?? 0,
        memberIds: [],
      };
      parTache.set(e.taskId, r);
    }
    r.passe += e.hours;
    if (!r.memberIds.includes(e.memberId)) r.memberIds.push(e.memberId);
  }
  return parTache;
}

/**
 * Par projet. L'estimé d'un projet compte TOUTES ses tâches, y compris celles sur
 * lesquelles rien n'a encore été saisi : c'est le budget du projet, et le comparer au seul
 * estimé des tâches déjà entamées ferait croire à un dépassement dès la première heure.
 */
export function rollupByProject(entries: TimeEntry[], tasks: ProjectTask[]): GroupRollup[] {
  const cleDe = (t: ProjectTask | undefined) => (t ? t.project || HORS_PROJET : TACHE_SUPPRIMEE);

  const parTache = agregeTaches(entries, tasks);
  const groupes = new Map<string, GroupRollup>();
  const ajoute = (cle: string) => {
    let g = groupes.get(cle);
    if (!g) {
      g = { cle, label: cle, passe: 0, estime: 0, taches: [], tachesSansTemps: 0 };
      groupes.set(cle, g);
    }
    return g;
  };

  for (const r of parTache.values()) {
    const t = tasks.find((x) => x.id === r.taskId);
    const g = ajoute(cleDe(t));
    g.taches.push(r);
    g.passe += r.passe;
  }

  // L'estimé vient des tâches, pas des saisies : une tâche jamais pointée pèse quand même
  // dans le budget de son projet.
  for (const t of tasks) {
    const cle = cleDe(t);
    // Les tâches supprimées n'existent pas dans `tasks` : ce groupe n'a donc pas d'estimé.
    if (cle === TACHE_SUPPRIMEE) continue;
    const g = groupes.get(cle);
    if (!g) continue;
    g.estime += t.estimatedHours;
    if (!parTache.has(t.id)) g.tachesSansTemps += 1;
  }

  for (const g of groupes.values()) g.taches.sort((a, b) => b.passe - a.passe);
  return trieGroupes([...groupes.values()]);
}

/** Par type (MCO / Incident / Projet) : la répartition que demande un bilan annuel. */
export function rollupByType(entries: TimeEntry[], tasks: ProjectTask[]): GroupRollup[] {
  const parTache = agregeTaches(entries, tasks);
  const groupes = new Map<string, GroupRollup>();

  for (const r of parTache.values()) {
    const cle = r.type ?? TACHE_SUPPRIMEE;
    let g = groupes.get(cle);
    if (!g) {
      g = { cle, label: cle, passe: 0, estime: 0, taches: [], tachesSansTemps: 0 };
      groupes.set(cle, g);
    }
    g.taches.push(r);
    g.passe += r.passe;
    g.estime += r.estime;
  }

  for (const g of groupes.values()) g.taches.sort((a, b) => b.passe - a.passe);
  return trieGroupes([...groupes.values()]);
}

/** Total général, pour les pourcentages affichés à côté de chaque groupe. */
export function totalPasse(groupes: GroupRollup[]): number {
  return groupes.reduce((s, g) => s + g.passe, 0);
}
