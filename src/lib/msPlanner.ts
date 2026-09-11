import type { Priority, ProjectTask, TaskStatus, TaskType } from '../types';

/**
 * Import des tâches Microsoft Planner (l'onglet "Tasks/Planner" de Teams) via Microsoft Graph.
 *
 * L'appli est purement cliente : elle appelle Graph directement avec le jeton de l'utilisateur
 * connecté (voir acquireGraphToken dans src/auth/msalClient.ts). Elle ne voit donc que les plans
 * auxquels CET utilisateur a accès, et ne peut rien écrire dans Planner — l'import est à sens
 * unique, de Planner vers l'onglet Tâches.
 *
 * Sur la récurrence : `recurrence` est une propriété de plannerTask exposée par l'endpoint /beta
 * de Graph, pas par /v1.0. On interroge donc /beta en premier et on retombe sur /v1.0 si le
 * tenant le refuse — dans ce cas la récurrence est inconnue et l'appli le dit plutôt que de
 * laisser croire qu'aucune tâche n'est récurrente.
 */

/** Scopes délégués nécessaires. Tasks.Read suffit à lire les plans et les tâches de l'utilisateur ;
 *  Group.Read.All permet en plus de nommer le groupe/équipe propriétaire du plan. */
export const PLANNER_SCOPES = ['Tasks.Read', 'Group.Read.All'];

const GRAPH_V1 = 'https://graph.microsoft.com/v1.0';
const GRAPH_BETA = 'https://graph.microsoft.com/beta';

export interface PlannerPlan {
  id: string;
  title: string;
}

export interface PlannerTask {
  id: string;
  title: string;
  planId: string;
  percentComplete: number;
  priority: number;
  dueDate?: string;
  /** Récurrence en clair, null si la tâche n'est pas récurrente. */
  recurrence: string | null;
}

export interface PlannerTasksResult {
  tasks: PlannerTask[];
  /** false quand seul /v1.0 a répondu : on ne sait alors pas dire quelles tâches sont récurrentes. */
  recurrenceAvailable: boolean;
}

class GraphError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GraphError';
    this.status = status;
  }
}

async function graphGet<T>(base: string, path: string, token: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    // Graph renvoie { error: { code, message } } — on remonte le message tel quel, il est explicite
    // (consentement manquant, plan introuvable, licence absente...).
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.error?.message) detail = body.error.message;
    } catch {
      /* réponse non-JSON : on garde le code HTTP */
    }
    throw new GraphError(detail, response.status);
  }
  return response.json() as Promise<T>;
}

/** Les plans Planner de l'utilisateur connecté. */
export async function listPlans(token: string): Promise<PlannerPlan[]> {
  const body = await graphGet<{ value: { id: string; title: string }[] }>(GRAPH_V1, '/me/planner/plans', token);
  return body.value.map((p) => ({ id: p.id, title: p.title || 'Plan sans titre' }));
}

interface RawPlannerTask {
  id: string;
  title?: string;
  planId?: string;
  percentComplete?: number;
  priority?: number;
  dueDateTime?: string | null;
  recurrence?: { schedule?: { pattern?: { type?: string; interval?: number } } } | null;
}

/**
 * Décrit la récurrence d'une tâche Planner en français, ou null si la tâche n'est pas récurrente.
 * Les motifs suivent `plannerRecurrenceSchedule` de Graph (daily, weekly, monthly, yearly...).
 */
export function describeRecurrence(raw: RawPlannerTask['recurrence']): string | null {
  const pattern = raw?.schedule?.pattern;
  if (!pattern?.type) return null;
  const interval = pattern.interval && pattern.interval > 1 ? pattern.interval : 1;
  const type = pattern.type.toLowerCase();

  if (type.startsWith('daily')) return interval === 1 ? 'Tous les jours' : `Tous les ${interval} jours`;
  if (type.startsWith('weekly')) return interval === 1 ? 'Toutes les semaines' : `Toutes les ${interval} semaines`;
  if (type.startsWith('absolutemonthly') || type.startsWith('relativemonthly') || type.startsWith('monthly'))
    return interval === 1 ? 'Tous les mois' : `Tous les ${interval} mois`;
  if (type.startsWith('absoluteyearly') || type.startsWith('relativeyearly') || type.startsWith('yearly'))
    return interval === 1 ? 'Tous les ans' : `Tous les ${interval} ans`;
  return 'Récurrente';
}

function mapRawTask(raw: RawPlannerTask, planId: string): PlannerTask {
  return {
    id: raw.id,
    title: raw.title?.trim() || 'Tâche sans titre',
    planId: raw.planId ?? planId,
    percentComplete: raw.percentComplete ?? 0,
    priority: raw.priority ?? 5,
    dueDate: raw.dueDateTime ? raw.dueDateTime.slice(0, 10) : undefined,
    recurrence: describeRecurrence(raw.recurrence),
  };
}

/** Les tâches d'un plan. Passe par /beta pour connaître les récurrences, /v1.0 en repli. */
export async function listPlanTasks(token: string, planId: string): Promise<PlannerTasksResult> {
  const path = `/planner/plans/${encodeURIComponent(planId)}/tasks`;
  try {
    const body = await graphGet<{ value: RawPlannerTask[] }>(GRAPH_BETA, path, token);
    return { tasks: body.value.map((t) => mapRawTask(t, planId)), recurrenceAvailable: true };
  } catch (error) {
    // Un 401/403 vient du consentement, pas de la version d'API : inutile de réessayer sur /v1.0.
    if (error instanceof GraphError && (error.status === 401 || error.status === 403)) throw error;
    const body = await graphGet<{ value: RawPlannerTask[] }>(GRAPH_V1, path, token);
    return { tasks: body.value.map((t) => mapRawTask(t, planId)), recurrenceAvailable: false };
  }
}

/** Priorité Planner (0 = la plus haute, 10 = la plus basse) → priorité de l'appli. */
export function mapPriority(plannerPriority: number): Priority {
  if (plannerPriority <= 1) return 'critique';
  if (plannerPriority <= 3) return 'haute';
  if (plannerPriority <= 5) return 'normale';
  return 'basse';
}

export function mapStatus(percentComplete: number): TaskStatus {
  if (percentComplete >= 100) return 'termine';
  if (percentComplete > 0) return 'en_cours';
  return 'a_faire';
}

/** La tâche de l'appli à créer à partir d'une tâche Planner, prête pour `addTask`. */
export function toTaskDraft(
  task: PlannerTask,
  options: { type: TaskType; assigneeIds: string[]; project?: string; estimatedHours: number }
): Omit<ProjectTask, 'id' | 'createdAt'> {
  return {
    title: task.title,
    type: options.type,
    project: options.project,
    assigneeIds: options.assigneeIds,
    status: mapStatus(task.percentComplete),
    priority: mapPriority(task.priority),
    estimatedHours: options.estimatedHours,
    dueDate: task.dueDate,
    plannerTaskId: task.id,
    recurrence: task.recurrence ?? undefined,
    description: task.recurrence ? `Importée de Microsoft Planner — récurrence : ${task.recurrence}.` : 'Importée de Microsoft Planner.',
  };
}

/** Message lisible pour l'utilisateur à partir de n'importe quelle erreur remontée ici. */
export function describeError(error: unknown): string {
  if (error instanceof GraphError) {
    if (error.status === 401 || error.status === 403)
      return `Accès refusé par Microsoft (${error.status}). L'application doit avoir le consentement pour les permissions ${PLANNER_SCOPES.join(' et ')}. ${error.message}`;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
