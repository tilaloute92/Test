import type { Priority, ProjectTask, TaskStatus, TaskType, TeamMember } from '../types';

/**
 * Tri du tableau des tâches, sur n'importe quelle colonne.
 *
 * Isolé du composant parce que les règles ne sont pas « comparer deux chaînes » : une
 * priorité se trie de basse à critique et non par ordre alphabétique (« basse » avant
 * « critique » avant « haute » n'a aucun sens pour qui cherche l'urgent), une échéance
 * absente se range toujours en dernier quel que soit le sens du tri, et un tri par
 * personne assignée doit trier sur le NOM affiché et non sur l'identifiant interne.
 */

export const TASK_SORT_KEYS = ['titre', 'type', 'assignes', 'priorite', 'statut', 'temps', 'echeance'] as const;
export type TaskSortKey = (typeof TASK_SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';

/** Tri en cours ; `null` = ordre par défaut (tâches terminées en bas). */
export interface TaskSort {
  key: TaskSortKey;
  direction: SortDirection;
}

// Ordres métier, pas alphabétiques.
const PRIORITY_RANK: Record<Priority, number> = { basse: 0, normale: 1, haute: 2, critique: 3 };
const STATUS_RANK: Record<TaskStatus, number> = { a_faire: 0, en_cours: 1, en_attente: 2, termine: 3 };
const TYPE_RANK: Record<TaskType, number> = { Incident: 0, MCO: 1, Projet: 2 };

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/**
 * Trois états plutôt que deux : croissant, décroissant, puis retour à l'ordre par défaut.
 * Sans le troisième, on ne peut plus jamais revenir à la vue initiale — où les tâches
 * terminées sont reléguées en bas — sans recharger la page.
 */
export function nextSort(current: TaskSort | null, key: TaskSortKey): TaskSort | null {
  if (current?.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

function assigneeLabel(task: ProjectTask, members: TeamMember[]): string {
  // Les noms sont triés entre eux d'abord : sans cela, deux tâches portant les mêmes
  // personnes dans un ordre de saisie différent se rangeraient à des endroits différents.
  const noms = task.assigneeIds
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => collator.compare(a, b));
  return noms.join(', ');
}

function compareBy(key: TaskSortKey, a: ProjectTask, b: ProjectTask, members: TeamMember[], spent: Record<string, number>): number {
  switch (key) {
    case 'titre':
      return collator.compare(a.title, b.title);
    case 'type':
      return TYPE_RANK[a.type] - TYPE_RANK[b.type];
    case 'assignes': {
      const na = assigneeLabel(a, members);
      const nb = assigneeLabel(b, members);
      // « Non assigné » en dernier dans les deux sens : c'est une absence de valeur, pas
      // une valeur qui viendrait avant « Alice ».
      if (!na !== !nb) return na ? -1 : 1;
      return collator.compare(na, nb);
    }
    case 'priorite':
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    case 'statut':
      return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    case 'temps':
      return (spent[a.id] ?? 0) - (spent[b.id] ?? 0);
    case 'echeance':
      // Les dates sont au format AAAA-MM-JJ : l'ordre lexicographique est l'ordre
      // chronologique, sans conversion ni fuseau horaire à gérer.
      return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
    default:
      return 0;
  }
}

/** Ordre par défaut, inchangé : les tâches terminées descendent en bas de liste. */
function defaultCompare(a: ProjectTask, b: ProjectTask): number {
  return (a.status === 'termine' ? 1 : 0) - (b.status === 'termine' ? 1 : 0);
}

export function sortTasks(
  tasks: ProjectTask[],
  sort: TaskSort | null,
  members: TeamMember[],
  spent: Record<string, number>
): ProjectTask[] {
  const copie = [...tasks];
  if (!sort) return copie.sort(defaultCompare);

  const sansEcheance = (t: ProjectTask) => sort.key === 'echeance' && !t.dueDate;
  const sens = sort.direction === 'asc' ? 1 : -1;

  return copie.sort((a, b) => {
    // Une échéance absente reste en bas même en tri décroissant : « pas de date » n'est ni
    // la plus lointaine ni la plus proche, et la faire remonter noierait les retards.
    if (sansEcheance(a) !== sansEcheance(b)) return sansEcheance(a) ? 1 : -1;
    const base = compareBy(sort.key, a, b, members, spent) * sens;
    // Départage par titre : sans lui, deux tâches de même priorité changeraient de place
    // d'un affichage à l'autre, ce qui donne l'impression d'un tri qui ne tient pas.
    return base !== 0 ? base : collator.compare(a.title, b.title);
  });
}
