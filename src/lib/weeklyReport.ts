import { formatDateLong, formatWeekRange, toISODate } from './date';
import { computeWorkload, workloadColors, workloadLevel, type WorkloadLevel } from './workload';
import type { Absence, PlanningSlot, ProjectTask, TeamMember, TimeEntry } from '../types';

export type WeatherLevel = 'ensoleille' | 'eclaircies' | 'nuageux' | 'orageux';

export const weatherMeta: Record<WeatherLevel, { emoji: string; label: string }> = {
  ensoleille: { emoji: '☀️', label: 'Ensoleillé' },
  eclaircies: { emoji: '🌤️', label: 'Éclaircies' },
  nuageux: { emoji: '☁️', label: 'Nuageux' },
  orageux: { emoji: '⛈️', label: 'Orageux' },
};

export interface MemberWeekStats {
  member: TeamMember;
  workloadRatio: number;
  workloadLevel: WorkloadLevel;
  hoursLogged: number;
  hoursTarget: number;
  tasksCompleted: ProjectTask[];
  absenceDays: number;
}

export interface WeeklyReport {
  weekDays: Date[];
  weather: WeatherLevel;
  weatherScore: number;
  weatherFactors: string[];
  avgWorkloadRatio: number;
  overloadedCount: number;
  openCriticalIncidents: ProjectTask[];
  incidentsResolved: ProjectTask[];
  incidentsOpened: ProjectTask[];
  tasksCompleted: ProjectTask[];
  overdueTasks: ProjectTask[];
  totalHoursLogged: number;
  totalHoursTarget: number;
  perMember: MemberWeekStats[];
  absencesThisWeek: Absence[];
  nextWeekAbsences: Absence[];
  nextWeekFillRatio: number;
}

export function computeWeeklyReport(opts: {
  weekDays: Date[];
  nextWeekDays: Date[];
  members: TeamMember[];
  tasks: ProjectTask[];
  timeEntries: TimeEntry[];
  absences: Absence[];
  planningSlots: PlanningSlot[];
}): WeeklyReport {
  const { weekDays, nextWeekDays, members, tasks, timeEntries, absences, planningSlots } = opts;
  const isoDays = new Set(weekDays.map(toISODate));
  const weekEndIso = toISODate(weekDays[weekDays.length - 1]);

  const perMember: MemberWeekStats[] = members.map((m) => {
    const load = computeWorkload(m.id, weekDays, planningSlots, absences);
    const hoursLogged = timeEntries.filter((e) => e.memberId === m.id && isoDays.has(e.date)).reduce((s, e) => s + e.hours, 0);
    const tasksCompleted = tasks.filter((t) => t.assigneeIds.includes(m.id) && t.completedAt && isoDays.has(t.completedAt.slice(0, 10)));
    const absenceDays = absences.filter((a) => a.memberId === m.id && isoDays.has(a.date)).length;
    return {
      member: m,
      workloadRatio: load.ratio,
      workloadLevel: workloadLevel(load.ratio),
      hoursLogged,
      hoursTarget: load.capacityHours,
      tasksCompleted,
      absenceDays,
    };
  });

  const avgWorkloadRatio = perMember.reduce((s, p) => s + p.workloadRatio, 0) / Math.max(perMember.length, 1);
  const overloadedCount = perMember.filter((p) => p.workloadLevel === 'surcharge').length;

  const tasksCompleted = tasks.filter((t) => t.completedAt && isoDays.has(t.completedAt.slice(0, 10)));
  const incidentsResolved = tasksCompleted.filter((t) => t.type === 'Incident');
  const incidentsOpened = tasks.filter((t) => t.type === 'Incident' && isoDays.has(t.createdAt.slice(0, 10)));
  const openCriticalIncidents = tasks.filter(
    (t) => t.type === 'Incident' && t.status !== 'termine' && (t.priority === 'critique' || t.priority === 'haute')
  );
  const overdueTasks = tasks.filter((t) => t.dueDate && t.dueDate < weekEndIso && t.status !== 'termine');

  const totalHoursLogged = perMember.reduce((s, p) => s + p.hoursLogged, 0);
  const totalHoursTarget = perMember.reduce((s, p) => s + p.hoursTarget, 0);

  const absencesThisWeek = absences.filter((a) => isoDays.has(a.date));
  const nextIso = new Set(nextWeekDays.map(toISODate));
  const nextWeekAbsences = absences.filter((a) => nextIso.has(a.date));
  const nextWeekSlots = planningSlots.filter((s) => nextIso.has(s.date));
  const nextWeekFillRatio = nextWeekSlots.length > 0 ? nextWeekSlots.filter((s) => s.taskId).length / nextWeekSlots.length : 0;

  // --- Météo de la semaine ---
  // Score composite, pensé pour rester lisible et vérifiable : charge moyenne de l'équipe
  // (jusqu'à 40 pts), incidents critiques/hauts encore ouverts (15 pts chacun), tâches en
  // retard (8 pts chacune), personnes en surcharge (10 pts chacune). Seuils : score <= 15
  // Ensoleillé, <= 35 Éclaircies, <= 60 Nuageux, au-delà Orageux. Les facteurs bruts sont
  // toujours affichés à côté de l'icône dans le rapport, pour que ce ne soit jamais une
  // boîte noire face à des responsables.
  let score = 0;
  if (avgWorkloadRatio > 1) score += 40;
  else if (avgWorkloadRatio > 0.85) score += 25;
  else if (avgWorkloadRatio > 0.5) score += 10;
  score += openCriticalIncidents.length * 15;
  score += overdueTasks.length * 8;
  score += overloadedCount * 10;

  const weather: WeatherLevel = score <= 15 ? 'ensoleille' : score <= 35 ? 'eclaircies' : score <= 60 ? 'nuageux' : 'orageux';

  const weatherFactors = [
    `Charge moyenne équipe : ${Math.round(avgWorkloadRatio * 100)}%`,
    `${overloadedCount} personne(s) en surcharge`,
    `${openCriticalIncidents.length} incident(s) critique/haut encore ouvert(s)`,
    `${overdueTasks.length} tâche(s) en retard`,
  ];

  return {
    weekDays,
    weather,
    weatherScore: score,
    weatherFactors,
    avgWorkloadRatio,
    overloadedCount,
    openCriticalIncidents,
    incidentsResolved,
    incidentsOpened,
    tasksCompleted,
    overdueTasks,
    totalHoursLogged,
    totalHoursTarget,
    perMember,
    absencesThisWeek,
    nextWeekAbsences,
    nextWeekFillRatio,
  };
}

const absenceTypeLabels: Record<string, string> = {
  conge: 'congés',
  formation: 'formation',
  teletravail: 'télétravail',
  astreinte: 'astreinte',
  autre: 'absence',
};

function assigneeNames(task: ProjectTask, members: TeamMember[]): string {
  const names = task.assigneeIds.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(', ') : 'non assigné';
}

/** Rend le rapport en Markdown, pensé pour être collé tel quel dans un e-mail ou Teams/Slack. */
export function buildMarkdownReport(report: WeeklyReport, teamLabel: string, members: TeamMember[]): string {
  const w = weatherMeta[report.weather];
  const lines: string[] = [];

  lines.push(`# Rapport hebdomadaire — ${teamLabel}`);
  lines.push(`**Semaine du ${formatWeekRange(report.weekDays)}** · généré le ${formatDateLong(new Date())}`);
  lines.push('');
  lines.push(`## Météo de la semaine : ${w.emoji} ${w.label}`);
  for (const f of report.weatherFactors) lines.push(`- ${f}`);
  lines.push('');
  lines.push('## En bref');
  lines.push(`- Charge moyenne équipe : **${Math.round(report.avgWorkloadRatio * 100)}%**`);
  lines.push(`- Heures saisies : **${report.totalHoursLogged}h** / ${report.totalHoursTarget}h`);
  lines.push(`- Tâches terminées : **${report.tasksCompleted.length}** (dont ${report.incidentsResolved.length} incident(s))`);
  lines.push(`- Nouveaux incidents ouverts : **${report.incidentsOpened.length}**`);
  lines.push(`- Incidents critiques/hauts encore ouverts : **${report.openCriticalIncidents.length}**`);
  lines.push(`- Tâches en retard : **${report.overdueTasks.length}**`);
  lines.push('');
  lines.push('## Charge par personne');
  for (const p of report.perMember) {
    lines.push(
      `- **${p.member.name}** — ${Math.round(p.workloadRatio * 100)}% (${workloadColors[p.workloadLevel].label}) · ${p.hoursLogged}h saisies / ${p.hoursTarget}h · ${p.tasksCompleted.length} tâche(s) terminée(s)${p.absenceDays > 0 ? ` · ${p.absenceDays} jour(s) d'absence` : ''}`
    );
  }
  if (report.openCriticalIncidents.length > 0) {
    lines.push('');
    lines.push('## Incidents critiques/hauts encore ouverts');
    for (const t of report.openCriticalIncidents) lines.push(`- ${t.title} (${t.priority}) — ${assigneeNames(t, members)}`);
  }
  if (report.tasksCompleted.length > 0) {
    lines.push('');
    lines.push('## Terminé cette semaine');
    for (const t of report.tasksCompleted) lines.push(`- ${t.title}${t.project ? ` — ${t.project}` : ''} — ${assigneeNames(t, members)}`);
  }
  if (report.overdueTasks.length > 0) {
    lines.push('');
    lines.push('## Tâches en retard');
    for (const t of report.overdueTasks) lines.push(`- ${t.title} (échéance ${t.dueDate}) — ${assigneeNames(t, members)}`);
  }
  lines.push('');
  lines.push('## Semaine prochaine');
  lines.push(`- Planning déjà rempli à ${Math.round(report.nextWeekFillRatio * 100)}%`);
  if (report.nextWeekAbsences.length > 0) {
    for (const a of report.nextWeekAbsences) lines.push(`- Absence : ${a.label ?? absenceTypeLabels[a.type] ?? a.type} le ${a.date}`);
  } else {
    lines.push('- Aucune absence prévue');
  }

  return lines.join('\n');
}
