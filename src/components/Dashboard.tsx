import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { formatDateLong, formatWeekRange, getWeeks } from '../lib/date';
import { computeWorkload, workloadLevel, workloadColors } from '../lib/workload';
import { computeRoadmapWeekStats } from '../lib/weeklyReport';
import { computeFlashReport, listProjects, type FlashReport } from '../lib/flashReport';
import { absencesToday, getCurrentTask, openTasksForMember } from '../lib/selectors';
import { useViewMode } from '../hooks/useViewMode';
import {
  Avatar,
  Card,
  ModeSwitcher,
  PriorityBadge,
  PrintButton,
  PrintHeader,
  RagBadge,
  StatusBadge,
  TaskTypeBadge,
  WorkloadBar,
  WorkloadPill,
} from './ui';
import type { ProjectTask, RoadmapItem, TeamMember } from '../types';
import type { Tab } from '../App';

const DASHBOARD_VIEW_MODES = ['complet', 'compact', 'charge'] as const;
type DashboardViewMode = (typeof DASHBOARD_VIEW_MODES)[number];

/**
 * Un point d'attention : le libellé résumé (ex. "3 incidents critiques"), mais aussi le
 * détail réel des éléments concernés, dépliable sur place — pour ne pas avoir à changer
 * d'onglet juste pour savoir *lesquels*. Le lien vers l'onglet d'origine reste disponible
 * pour agir dessus (modifier, réaffecter...).
 */
interface AttentionItem {
  key: string;
  label: string;
  tone: 'danger' | 'warning';
  tab: Tab;
  /** Lignes de détail en texte simple — utilisées pour la version imprimée. */
  printLines: string[];
  /** Détail riche affiché à l'écran quand on déplie le point d'attention. */
  details: React.ReactNode;
}

function memberNames(task: ProjectTask, members: TeamMember[]): string {
  const names = task.assigneeIds.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(', ') : 'Non assigné';
}

export function Dashboard({ onSelectMember, onNavigate }: { onSelectMember: (id: string) => void; onNavigate: (tab: Tab) => void }) {
  const { members, tasks, timeEntries, planningSlots, absences, roadmapItems } = useStore();
  const today = new Date();
  const weeks = useMemo(() => getWeeks(today, 3), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useViewMode<DashboardViewMode>('vue-ensemble', DASHBOARD_VIEW_MODES, 'complet');
  const [expanded, setExpanded] = useState<string[]>([]);

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const todayIso = today.toISOString().slice(0, 10);
  const incidentsOuverts = tasks.filter((t) => t.type === 'Incident' && t.status !== 'termine').length;
  const overdueTasks = tasks.filter((t) => t.dueDate && t.dueDate < todayIso && t.status !== 'termine');
  const enRetard = overdueTasks.length;
  const presentsAujourdhui = members.filter((m) => !absencesToday(absences, m.id)).length;

  const loadThisWeek = useMemo(() => {
    const map: Record<string, ReturnType<typeof computeWorkload>> = {};
    for (const m of members) map[m.id] = computeWorkload(m, weeks[0], planningSlots, absences);
    return map;
  }, [members, weeks, planningSlots, absences]);

  const chargeMoyenne = Math.round(
    (members.reduce((sum, m) => sum + loadThisWeek[m.id].ratio, 0) / Math.max(members.length, 1)) * 100
  );

  const sortedMembers = [...members].sort((a, b) => loadThisWeek[b.id].ratio - loadThisWeek[a.id].ratio);

  // --- Points d'attention : regroupe en un seul endroit les signaux qui, sinon, obligent à
  // visiter Tâches, Planning, FDR et les flash reports séparément pour savoir "qu'est-ce qui
  // a besoin de moi aujourd'hui ?". Chaque signal reste calculé avec les mêmes règles que
  // dans son onglet d'origine (rien n'est réinventé ici), affiche le détail sur place, et
  // pointe vers l'onglet concerné pour agir.
  const criticalIncidents = tasks.filter(
    (t) => t.type === 'Incident' && t.status !== 'termine' && (t.priority === 'critique' || t.priority === 'haute')
  );
  const overloadedMembers = members.filter((m) => workloadLevel(loadThisWeek[m.id].ratio) === 'surcharge');
  const roadmapStats = computeRoadmapWeekStats(roadmapItems, today);
  const projectSummaries = listProjects(tasks).map((p) => computeFlashReport(p, tasks, timeEntries, members, today));
  const redProjects = projectSummaries.filter((r) => r.rag === 'rouge');
  const orangeProjects = projectSummaries.filter((r) => r.rag === 'orange');

  const attentionItems: AttentionItem[] = [];
  if (criticalIncidents.length > 0) {
    attentionItems.push({
      key: 'incidents',
      label: `${criticalIncidents.length} incident(s) critique(s)/haut(s) encore ouvert(s)`,
      tone: 'danger',
      tab: 'tasks',
      printLines: criticalIncidents.map((t) => `${t.title} — ${memberNames(t, members)}`),
      details: <TaskDetails tasks={criticalIncidents} members={members} />,
    });
  }
  if (overdueTasks.length > 0) {
    attentionItems.push({
      key: 'overdue',
      label: `${enRetard} tâche(s) en retard`,
      tone: 'danger',
      tab: 'tasks',
      printLines: overdueTasks.map((t) => `${t.title} — échéance ${t.dueDate} — ${memberNames(t, members)}`),
      details: <TaskDetails tasks={overdueTasks} members={members} showDue />,
    });
  }
  if (redProjects.length > 0) {
    attentionItems.push({
      key: 'red-projects',
      label: `${redProjects.length} projet(s) en statut Rouge (flash report)`,
      tone: 'danger',
      tab: 'tasks',
      printLines: redProjects.map((r) => `${r.project} — ${r.ragReasons.join(' · ')}`),
      details: <ProjectDetails reports={redProjects} />,
    });
  }
  if (overloadedMembers.length > 0) {
    attentionItems.push({
      key: 'overload',
      label: `${overloadedMembers.length} personne(s) en surcharge cette semaine`,
      tone: 'warning',
      tab: 'planning',
      printLines: overloadedMembers.map(
        (m) => `${m.name} — ${loadThisWeek[m.id].plannedHours}h planifiées / ${loadThisWeek[m.id].capacityHours}h (${Math.round(loadThisWeek[m.id].ratio * 100)}%)`
      ),
      details: <OverloadDetails members={overloadedMembers} load={loadThisWeek} onSelectMember={onSelectMember} />,
    });
  }
  if (orangeProjects.length > 0) {
    attentionItems.push({
      key: 'orange-projects',
      label: `${orangeProjects.length} projet(s) en statut Orange (flash report)`,
      tone: 'warning',
      tab: 'tasks',
      printLines: orangeProjects.map((r) => `${r.project} — ${r.ragReasons.join(' · ')}`),
      details: <ProjectDetails reports={orangeProjects} />,
    });
  }
  if (roadmapStats.notStartedButDue.length > 0) {
    attentionItems.push({
      key: 'roadmap',
      label: `${roadmapStats.notStartedButDue.length} initiative(s) FDR pas démarrée(s) alors que leur trimestre est atteint`,
      tone: 'warning',
      tab: 'roadmap',
      printLines: roadmapStats.notStartedButDue.map((r) => `${r.title} — ${r.domain}, ${r.quarter}`),
      details: <RoadmapDetails items={roadmapStats.notStartedButDue} />,
    });
  }

  return (
    <div className="space-y-6">
      <PrintHeader title="Tableau de bord" subtitle={`Aujourd'hui, ${formatDateLong(today)}`} />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Tableau de bord</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Aujourd'hui, {formatDateLong(today)} — vue d'ensemble de la charge et de l'activité de l'équipe
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModeSwitcher
            value={mode}
            onChange={setMode}
            options={[
              { value: 'complet', label: 'Complet', title: 'Charge détaillée + une fiche par personne (vue par défaut)' },
              { value: 'compact', label: 'Compact', title: "Tout l'essentiel sur un écran : un tableau dense, une ligne par personne" },
              { value: 'charge', label: 'Charge 3 semaines', title: 'Capacité et charge planifiée par personne sur les 3 prochaines semaines' },
            ]}
          />
          <PrintButton />
        </div>
      </div>

      <AttentionPanel items={attentionItems} expanded={expanded} onToggle={toggleExpanded} onNavigate={onNavigate} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Incidents ouverts" value={incidentsOuverts} accent="text-red-600 dark:text-red-400" />
        <KpiCard label="Tâches en retard" value={enRetard} accent="text-amber-600 dark:text-amber-400" />
        <KpiCard label="Charge moyenne équipe" value={`${chargeMoyenne}%`} accent="text-violet-600 dark:text-violet-400" />
        <KpiCard label="Présents aujourd'hui" value={`${presentsAujourdhui}/${members.length}`} accent="text-emerald-600 dark:text-emerald-400" />
      </div>

      {mode === 'complet' && (
        <>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Répartition de la charge — semaine en cours</h2>
            <div className="space-y-3">
              {sortedMembers.map((m) => {
                const load = loadThisWeek[m.id];
                const level = workloadLevel(load.ratio);
                return (
                  <button
                    key={m.id}
                    onClick={() => onSelectMember(m.id)}
                    className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <Avatar name={m.name} color={m.color} initials={m.initials} size={28} />
                    <span className="w-36 shrink-0 truncate text-sm text-slate-700 dark:text-slate-200">{m.name}</span>
                    <div className="flex-1">
                      <WorkloadBar ratio={load.ratio} level={level} />
                    </div>
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {Math.round(load.ratio * 100)}%
                    </span>
                    <div className="w-28 shrink-0 text-right">
                      <WorkloadPill level={level} />
                    </div>
                  </button>
                );
              })}
            </div>
            <WorkloadLegend />
          </Card>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Activité par personne</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {members.map((m) => {
                const currentTask = getCurrentTask(planningSlots, tasks, m.id);
                const absence = absencesToday(absences, m.id);
                const load = loadThisWeek[m.id];
                const level = workloadLevel(load.ratio);
                const openTasks = openTasksForMember(tasks, m.id);
                const weekRatios = weeks.map((wDays) => computeWorkload(m, wDays, planningSlots, absences).ratio);

                return (
                  <Card key={m.id} className="flex flex-col gap-3 p-4">
                    <button className="flex items-center gap-3 text-left" onClick={() => onSelectMember(m.id)}>
                      <Avatar name={m.name} color={m.color} initials={m.initials} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{m.name}</div>
                        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{m.role}</div>
                      </div>
                      <div className="ml-auto">
                        <WorkloadPill level={level} />
                      </div>
                    </button>

                    {absence ? (
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                        Absent(e) aujourd'hui — {absence.label ?? absence.type}
                      </div>
                    ) : currentTask ? (
                      <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                        <div className="mb-1 flex items-center gap-2">
                          <TaskTypeBadge type={currentTask.type} />
                          <StatusBadge status={currentTask.status} />
                        </div>
                        <div className="truncate text-sm text-slate-800 dark:text-slate-100" title={currentTask.title}>
                          {currentTask.title}
                        </div>
                        {currentTask.project && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{currentTask.project}</div>}
                      </div>
                    ) : (
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                        Aucune tâche planifiée sur ce créneau
                      </div>
                    )}

                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>Charge semaine en cours</span>
                        <span className="tabular-nums">
                          {load.plannedHours}h / {load.capacityHours}h
                        </span>
                      </div>
                      <WorkloadBar ratio={load.ratio} level={level} />
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>Tendance 3 semaines</span>
                      <div className="flex items-center gap-1">
                        {weekRatios.map((r, i) => {
                          const lvl = workloadLevel(r);
                          return <span key={i} className={`h-3 w-3 rounded-sm ${workloadColors[lvl].bar}`} title={`S${i + 1}: ${Math.round(r * 100)}%`} />;
                        })}
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <span>{openTasks.length} tâche(s) en cours</span>
                      {openTasks[0] && <PriorityBadge priority={openTasks[0].priority} />}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </>
      )}

      {mode === 'compact' && (
        <Card className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[760px] text-sm print:min-w-0">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400 dark:border-slate-800">
                <th className="px-3 py-2 font-medium">Personne</th>
                <th className="px-3 py-2 font-medium">Charge (semaine en cours)</th>
                <th className="px-3 py-2 font-medium">En ce moment</th>
                <th className="px-3 py-2 font-medium">Tâches ouvertes</th>
              </tr>
            </thead>
            <tbody>
              {sortedMembers.map((m) => {
                const load = loadThisWeek[m.id];
                const level = workloadLevel(load.ratio);
                const currentTask = getCurrentTask(planningSlots, tasks, m.id);
                const absence = absencesToday(absences, m.id);
                const openTasks = openTasksForMember(tasks, m.id);
                return (
                  <tr key={m.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
                    <td className="px-3 py-2">
                      <button onClick={() => onSelectMember(m.id)} className="flex items-center gap-2 text-left hover:underline">
                        <Avatar name={m.name} color={m.color} initials={m.initials} size={22} />
                        <span className="truncate font-medium text-slate-800 dark:text-slate-100">{m.name}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-28 shrink-0">
                          <WorkloadBar ratio={load.ratio} level={level} />
                        </div>
                        <span className="w-10 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {Math.round(load.ratio * 100)}%
                        </span>
                        <WorkloadPill level={level} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {absence ? (
                        <span className="text-xs text-slate-400">Absent(e) — {absence.label ?? absence.type}</span>
                      ) : currentTask ? (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <TaskTypeBadge type={currentTask.type} />
                          <span className="truncate text-slate-700 dark:text-slate-200">{currentTask.title}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">Rien de planifié</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{openTasks.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {mode === 'charge' && (
        <Card className="overflow-x-auto p-4 print:overflow-visible">
          <h2 className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">Charge et capacité — 3 prochaines semaines</h2>
          <p className="mb-3 text-xs text-slate-400">
            Heures planifiées / capacité réellement disponible (volume hebdomadaire de la personne, moins ses absences) — pour repérer une
            surcharge à venir avant qu'elle n'arrive.
          </p>
          <table className="w-full min-w-[760px] text-sm print:min-w-0">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400 dark:border-slate-800">
                <th className="px-3 py-2 font-medium">Personne</th>
                {weeks.map((w, i) => (
                  <th key={i} className="px-3 py-2 font-medium">
                    Semaine {i + 1}
                    <div className="font-normal text-slate-300 dark:text-slate-600">{formatWeekRange(w)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-slate-50 last:border-0 dark:border-slate-800/60">
                  <td className="px-3 py-2">
                    <button onClick={() => onSelectMember(m.id)} className="flex items-center gap-2 text-left hover:underline">
                      <Avatar name={m.name} color={m.color} initials={m.initials} size={22} />
                      <span className="truncate font-medium text-slate-800 dark:text-slate-100">{m.name}</span>
                    </button>
                  </td>
                  {weeks.map((wDays, i) => {
                    const load = computeWorkload(m, wDays, planningSlots, absences);
                    const level = workloadLevel(load.ratio);
                    return (
                      <td key={i} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-20 shrink-0">
                            <WorkloadBar ratio={load.ratio} level={level} />
                          </div>
                          <span className={`shrink-0 text-xs tabular-nums ${workloadColors[level].text}`}>
                            {load.plannedHours}h / {load.capacityHours}h
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <WorkloadLegend />
        </Card>
      )}
    </div>
  );
}

function AttentionPanel({
  items,
  expanded,
  onToggle,
  onNavigate,
}: {
  items: AttentionItem[];
  expanded: string[];
  onToggle: (key: string) => void;
  onNavigate: (tab: Tab) => void;
}) {
  return (
    <Card className="p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">Points d'attention</h2>
      {items.length === 0 ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <span aria-hidden="true">✓</span> Rien à signaler pour l'instant — pas de retard, pas de surcharge, pas d'alerte FDR ni de projet en
          Rouge/Orange.
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-400 print:hidden">Cliquez sur une ligne pour voir directement les éléments concernés, sans changer d'onglet.</p>
          <div className="space-y-1.5 print:hidden">
            {items.map((it) => {
              const isOpen = expanded.includes(it.key);
              const toneClasses =
                it.tone === 'danger'
                  ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300';
              const hoverClasses =
                it.tone === 'danger' ? 'hover:bg-red-100 dark:hover:bg-red-500/20' : 'hover:bg-amber-100 dark:hover:bg-amber-500/20';
              return (
                <div key={it.key} className={`overflow-hidden rounded-lg ${toneClasses}`}>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onToggle(it.key)}
                      aria-expanded={isOpen}
                      className={`flex flex-1 items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${hoverClasses}`}
                    >
                      <span className="shrink-0 text-xs opacity-70" aria-hidden="true">
                        {isOpen ? '▾' : '▸'}
                      </span>
                      <span className="flex-1">{it.label}</span>
                    </button>
                    <button
                      onClick={() => onNavigate(it.tab)}
                      title="Ouvrir l'onglet correspondant pour agir dessus"
                      className={`mr-2 shrink-0 rounded px-2 py-1 text-xs opacity-70 transition-colors hover:opacity-100 ${hoverClasses}`}
                    >
                      Ouvrir →
                    </button>
                  </div>
                  {isOpen && <div className="border-t border-black/5 bg-white/60 px-3 py-2 dark:border-white/10 dark:bg-slate-900/40">{it.details}</div>}
                </div>
              );
            })}
          </div>
          {/* Version imprimable : tous les détails dépliés, sans affordance de clic */}
          <div className="hidden space-y-2 text-sm text-slate-700 print:block">
            {items.map((it) => (
              <div key={it.key}>
                <div className="font-medium">• {it.label}</div>
                <ul className="ml-4 text-xs text-slate-600">
                  {it.printLines.map((line) => (
                    <li key={line}>– {line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function TaskDetails({ tasks, members, showDue = false }: { tasks: ProjectTask[]; members: TeamMember[]; showDue?: boolean }) {
  return (
    <ul className="space-y-1.5">
      {tasks.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <TaskTypeBadge type={t.type} />
          <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
          {t.project && <span className="text-xs text-slate-400">{t.project}</span>}
          <StatusBadge status={t.status} />
          <PriorityBadge priority={t.priority} />
          {showDue && t.dueDate && <span className="text-xs font-medium">échéance {t.dueDate}</span>}
          <span className="text-xs text-slate-400">{memberNames(t, members)}</span>
        </li>
      ))}
    </ul>
  );
}

function ProjectDetails({ reports }: { reports: FlashReport[] }) {
  return (
    <ul className="space-y-2">
      {reports.map((r) => (
        <li key={r.project} className="text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <RagBadge rag={r.rag} />
            <span className="font-medium text-slate-800 dark:text-slate-100">{r.project}</span>
            <span className="text-xs text-slate-400">
              {r.completedTasks.length}/{r.totalTasks} tâche(s) · {Math.round(r.completionRatio * 100)}%
            </span>
          </div>
          {/* Les raisons du statut sont toujours affichées : un flash report ne donne jamais une couleur sans dire pourquoi. */}
          <ul className="ml-1 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {r.ragReasons.map((reason) => (
              <li key={reason}>• {reason}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function OverloadDetails({
  members,
  load,
  onSelectMember,
}: {
  members: TeamMember[];
  load: Record<string, ReturnType<typeof computeWorkload>>;
  onSelectMember: (id: string) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {members.map((m) => {
        const l = load[m.id];
        const level = workloadLevel(l.ratio);
        return (
          <li key={m.id}>
            <button onClick={() => onSelectMember(m.id)} className="flex w-full items-center gap-2 text-left text-sm hover:underline">
              <Avatar name={m.name} color={m.color} initials={m.initials} size={20} />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">{m.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {l.plannedHours}h planifiées / {l.capacityHours}h disponibles
              </span>
              <span className="w-20 shrink-0">
                <WorkloadBar ratio={l.ratio} level={level} />
              </span>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums">{Math.round(l.ratio * 100)}%</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function RoadmapDetails({ items }: { items: RoadmapItem[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
          <span className="text-xs text-slate-400">
            {r.domain} · {r.quarter} {r.year} · avancement {r.progress}%
          </span>
        </li>
      ))}
    </ul>
  );
}

function WorkloadLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
      {(['sous-charge', 'equilibre', 'charge', 'surcharge'] as const).map((lvl) => (
        <span key={lvl} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${workloadColors[lvl].bar}`} />
          {workloadColors[lvl].label}
        </span>
      ))}
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <Card className="p-4">
      <div className={`text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </Card>
  );
}
