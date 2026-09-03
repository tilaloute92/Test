import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { formatDateLong, getWeeks } from '../lib/date';
import { computeWorkload, workloadLevel, workloadColors } from '../lib/workload';
import { absencesToday, getCurrentTask, openTasksForMember } from '../lib/selectors';
import { Avatar, Card, PriorityBadge, StatusBadge, TaskTypeBadge, WorkloadBar, WorkloadPill } from './ui';

export function Dashboard({ onSelectMember }: { onSelectMember: (id: string) => void }) {
  const { members, tasks, planningSlots, absences } = useStore();
  const today = new Date();
  const weeks = useMemo(() => getWeeks(today, 3), []); // eslint-disable-line react-hooks/exhaustive-deps

  const todayIso = today.toISOString().slice(0, 10);
  const incidentsOuverts = tasks.filter((t) => t.type === 'Incident' && t.status !== 'termine').length;
  const enRetard = tasks.filter((t) => t.dueDate && t.dueDate < todayIso && t.status !== 'termine').length;
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Tableau de bord</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Aujourd'hui, {formatDateLong(today)} — vue d'ensemble de la charge et de l'activité de l'équipe
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Incidents ouverts" value={incidentsOuverts} accent="text-red-600 dark:text-red-400" />
        <KpiCard label="Tâches en retard" value={enRetard} accent="text-amber-600 dark:text-amber-400" />
        <KpiCard label="Charge moyenne équipe" value={`${chargeMoyenne}%`} accent="text-violet-600 dark:text-violet-400" />
        <KpiCard label="Présents aujourd'hui" value={`${presentsAujourdhui}/${members.length}`} accent="text-emerald-600 dark:text-emerald-400" />
      </div>

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
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
          {(['sous-charge', 'equilibre', 'charge', 'surcharge'] as const).map((lvl) => (
            <span key={lvl} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${workloadColors[lvl].bar}`} />
              {workloadColors[lvl].label}
            </span>
          ))}
        </div>
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
                    <span className="tabular-nums">{load.plannedHours}h / {load.capacityHours}h</span>
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
