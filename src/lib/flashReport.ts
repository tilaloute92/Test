/**
 * Flash report projet : synthèse rapide d'un projet (regroupement par le champ `project` des
 * tâches de type "Projet"), pensée pour un point d'avancement en quelques secondes — statut
 * "feu tricolore" (RAG : Rouge / Orange / Vert), avancement, réalisations récentes, échéances
 * à venir, points de vigilance. Calculée à la demande à partir des données existantes (comme
 * le rapport hebdomadaire) — rien n'est stocké séparément, donc toujours à jour.
 *
 * Le statut RAG est calculé à partir de règles explicites (jamais une boîte noire) : les
 * raisons qui l'expliquent sont toujours retournées avec le résultat et affichées à l'écran.
 */

import { addDays, formatDateLong, toISODate } from './date';
import type { ProjectTask, TeamMember, TimeEntry } from '../types';

export type RagStatus = 'vert' | 'orange' | 'rouge';

export const ragLabels: Record<RagStatus, string> = { vert: 'Vert', orange: 'Orange', rouge: 'Rouge' };

export interface FlashReport {
  project: string;
  generatedAt: string;
  rag: RagStatus;
  ragReasons: string[];
  totalTasks: number;
  completedTasks: ProjectTask[];
  inProgressTasks: ProjectTask[];
  todoTasks: ProjectTask[];
  waitingTasks: ProjectTask[];
  overdueTasks: ProjectTask[];
  completionRatio: number;
  estimatedHours: number;
  spentHours: number;
  team: TeamMember[];
  recentlyCompleted: ProjectTask[];
  upcoming: ProjectTask[];
}

const RECENT_WINDOW_DAYS = 14;
const UPCOMING_WINDOW_DAYS = 14;

/** Projets distincts (champ `project` des tâches de type "Projet"), triés alphabétiquement. */
export function listProjects(tasks: ProjectTask[]): string[] {
  const names = new Set<string>();
  for (const t of tasks) {
    if (t.type === 'Projet' && t.project) names.add(t.project);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'fr'));
}

export function computeFlashReport(
  project: string,
  tasks: ProjectTask[],
  timeEntries: TimeEntry[],
  members: TeamMember[],
  referenceDate: Date = new Date()
): FlashReport {
  const projectTasks = tasks.filter((t) => t.type === 'Projet' && t.project === project);
  const todayIso = toISODate(referenceDate);
  const recentCutoff = toISODate(addDays(referenceDate, -RECENT_WINDOW_DAYS));
  const upcomingCutoff = toISODate(addDays(referenceDate, UPCOMING_WINDOW_DAYS));

  const completedTasks = projectTasks.filter((t) => t.status === 'termine');
  const inProgressTasks = projectTasks.filter((t) => t.status === 'en_cours');
  const todoTasks = projectTasks.filter((t) => t.status === 'a_faire');
  const waitingTasks = projectTasks.filter((t) => t.status === 'en_attente');
  const overdueTasks = projectTasks.filter((t) => t.dueDate && t.dueDate < todayIso && t.status !== 'termine');

  const taskIds = new Set(projectTasks.map((t) => t.id));
  const spentByTask = new Map<string, number>();
  for (const e of timeEntries) {
    if (!taskIds.has(e.taskId)) continue;
    spentByTask.set(e.taskId, (spentByTask.get(e.taskId) ?? 0) + e.hours);
  }
  const spentHours = Array.from(spentByTask.values()).reduce((s, h) => s + h, 0);
  const estimatedHours = projectTasks.reduce((s, t) => s + t.estimatedHours, 0);

  const memberIds = new Set(projectTasks.flatMap((t) => t.assigneeIds));
  const team = members.filter((m) => memberIds.has(m.id));

  const recentlyCompleted = completedTasks.filter((t) => t.completedAt && t.completedAt.slice(0, 10) >= recentCutoff);
  const upcoming = projectTasks.filter((t) => t.status !== 'termine' && !!t.dueDate && t.dueDate >= todayIso && t.dueDate! <= upcomingCutoff);

  // --- Statut RAG : règles explicites, du plus au moins grave ---
  const overdueCritical = overdueTasks.filter((t) => t.priority === 'critique' || t.priority === 'haute');
  const overrunTask = projectTasks.find((t) => t.estimatedHours > 0 && (spentByTask.get(t.id) ?? 0) > t.estimatedHours * 1.5);

  let rag: RagStatus = 'vert';
  const ragReasons: string[] = [];

  if (overdueCritical.length > 0) {
    rag = 'rouge';
    ragReasons.push(`${overdueCritical.length} tâche(s) en retard à priorité haute ou critique`);
  } else if (overdueTasks.length >= 2) {
    rag = 'rouge';
    ragReasons.push(`${overdueTasks.length} tâches en retard`);
  } else if (overdueTasks.length === 1) {
    rag = 'orange';
    ragReasons.push('1 tâche en retard');
  }
  if (waitingTasks.length > 0) {
    if (rag === 'vert') rag = 'orange';
    ragReasons.push(`${waitingTasks.length} tâche(s) en attente (bloquée(s))`);
  }
  if (overrunTask) {
    if (rag === 'vert') rag = 'orange';
    ragReasons.push(`dépassement de charge estimée sur "${overrunTask.title}" (plus de 150% du temps prévu)`);
  }
  if (ragReasons.length === 0) {
    ragReasons.push("Aucun signal d'alerte : pas de retard, pas de tâche bloquée, pas de dépassement de charge notable.");
  }

  return {
    project,
    generatedAt: referenceDate.toISOString(),
    rag,
    ragReasons,
    totalTasks: projectTasks.length,
    completedTasks,
    inProgressTasks,
    todoTasks,
    waitingTasks,
    overdueTasks,
    completionRatio: projectTasks.length > 0 ? completedTasks.length / projectTasks.length : 0,
    estimatedHours,
    spentHours,
    team,
    recentlyCompleted,
    upcoming,
  };
}

function assigneeNames(task: ProjectTask, members: TeamMember[]): string {
  const names = task.assigneeIds.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(', ') : 'non assigné';
}

/** Rend le flash report en Markdown, pensé pour être collé dans un e-mail ou Teams/Slack. */
export function buildFlashReportMarkdown(report: FlashReport, members: TeamMember[]): string {
  const lines: string[] = [];
  lines.push(`# Flash report — ${report.project}`);
  lines.push(`**Statut : ${ragLabels[report.rag]}** · généré le ${formatDateLong(new Date(report.generatedAt))}`);
  lines.push('');
  lines.push('## Statut');
  for (const r of report.ragReasons) lines.push(`- ${r}`);
  lines.push('');
  lines.push('## Avancement');
  lines.push(`- ${report.completedTasks.length}/${report.totalTasks} tâche(s) terminée(s) (${Math.round(report.completionRatio * 100)}%)`);
  lines.push(`- Charge : ${report.spentHours}h passées / ${report.estimatedHours}h estimées`);
  lines.push(`- En cours : ${report.inProgressTasks.length} · À faire : ${report.todoTasks.length} · En attente : ${report.waitingTasks.length}`);
  lines.push(`- Équipe : ${report.team.map((m) => m.name).join(', ') || 'non attribuée'}`);
  if (report.recentlyCompleted.length > 0) {
    lines.push('');
    lines.push(`## Réalisé récemment (${RECENT_WINDOW_DAYS} derniers jours)`);
    for (const t of report.recentlyCompleted) lines.push(`- ${t.title} — ${assigneeNames(t, members)}`);
  }
  if (report.upcoming.length > 0) {
    lines.push('');
    lines.push(`## Échéances à venir (${UPCOMING_WINDOW_DAYS} prochains jours)`);
    for (const t of report.upcoming) lines.push(`- ${t.title} (échéance ${t.dueDate}) — ${assigneeNames(t, members)}`);
  }
  if (report.overdueTasks.length > 0) {
    lines.push('');
    lines.push('## Tâches en retard');
    for (const t of report.overdueTasks) lines.push(`- ${t.title} (échéance ${t.dueDate}, priorité ${t.priority}) — ${assigneeNames(t, members)}`);
  }
  if (report.waitingTasks.length > 0) {
    lines.push('');
    lines.push('## Tâches en attente / bloquées');
    for (const t of report.waitingTasks) lines.push(`- ${t.title} — ${assigneeNames(t, members)}`);
  }
  return lines.join('\n');
}
