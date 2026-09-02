import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { formatDayLabel, formatWeekRange, getWeeks, isToday, toISODate } from '../lib/date';
import { isAbsent } from '../lib/workload';
import { getTaskById } from '../lib/selectors';
import { Avatar, Card, TaskTypeBadge } from './ui';
import { useConfirm } from './ConfirmProvider';
import type { Period, TaskType } from '../types';

const typeColor: Record<TaskType, string> = {
  MCO: 'bg-slate-400 dark:bg-slate-500',
  Incident: 'bg-red-500',
  Projet: 'bg-violet-500',
};

interface SelectedCell {
  memberId: string;
  date: string;
  period: Period;
}

export function PlanningView() {
  const { members, tasks, planningSlots, absences, setPlanningSlot } = useStore();
  const confirm = useConfirm();
  const weeks = useMemo(() => getWeeks(new Date(), 3), []);
  const allDays = weeks.flat();
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  const selectedMember = selected ? members.find((m) => m.id === selected.memberId) : null;
  const selectedSlot = selected
    ? planningSlots.find((s) => s.memberId === selected.memberId && s.date === selected.date && s.period === selected.period)
    : null;
  const selectedTask = getTaskById(tasks, selectedSlot?.taskId);
  const eligibleTypes: TaskType[] = selected?.period === 'matin' ? ['MCO', 'Incident'] : ['Projet'];
  const eligibleTasks = selected
    ? tasks.filter((t) => t.assigneeId === selected.memberId && eligibleTypes.includes(t.type) && t.status !== 'termine')
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Planning prévisionnel — 3 semaines</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Matin = MCO / incidents · Après-midi = projets. Cliquez sur un créneau pour l'affecter.
        </p>
      </div>

      <Card className="overflow-x-auto p-3">
        <table className="w-full min-w-[1100px] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-44 bg-white text-left text-xs font-medium text-slate-400 dark:bg-slate-900">Équipe</th>
              {weeks.map((week, wi) => (
                <th key={wi} colSpan={5} className="pb-1 text-center text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Semaine {wi + 1} · {formatWeekRange(week)}
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 z-10 bg-white dark:bg-slate-900" />
              {allDays.map((d) => (
                <th
                  key={toISODate(d)}
                  className={`px-0.5 pb-1 text-center text-[11px] font-medium ${isToday(d) ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400'}`}
                >
                  {formatDayLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td className="sticky left-0 z-10 bg-white pr-2 dark:bg-slate-900">
                  <div className="flex items-center gap-2">
                    <Avatar name={m.name} color={m.color} initials={m.initials} size={26} />
                    <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{m.name}</span>
                  </div>
                </td>
                {allDays.map((d) => {
                  const iso = toISODate(d);
                  const absentDay = isAbsent(absences, m.id, d, 'matin') && isAbsent(absences, m.id, d, 'apres_midi');
                  return (
                    <td key={iso} className={`p-0.5 ${isToday(d) ? 'rounded bg-violet-50 dark:bg-violet-500/10' : ''}`}>
                      {absentDay ? (
                        <div
                          className="h-8 w-10 rounded bg-[repeating-linear-gradient(45deg,theme(colors.slate.200),theme(colors.slate.200)_4px,transparent_4px,transparent_8px)] dark:bg-[repeating-linear-gradient(45deg,theme(colors.slate.700),theme(colors.slate.700)_4px,transparent_4px,transparent_8px)]"
                          title="Absent(e)"
                        />
                      ) : (
                        <div className="flex h-8 w-10 flex-col gap-0.5">
                          {(['matin', 'apres_midi'] as Period[]).map((period) => {
                            const absentPeriod = isAbsent(absences, m.id, d, period);
                            const slot = planningSlots.find((s) => s.memberId === m.id && s.date === iso && s.period === period);
                            const task = getTaskById(tasks, slot?.taskId);
                            const isSelected = selected?.memberId === m.id && selected.date === iso && selected.period === period;
                            return (
                              <button
                                key={period}
                                disabled={absentPeriod}
                                title={task ? `${task.title} (${task.type})` : absentPeriod ? 'Absent(e)' : 'Non planifié'}
                                onClick={() => setSelected({ memberId: m.id, date: iso, period })}
                                className={`h-3.5 flex-1 rounded-sm ${
                                  absentPeriod ? 'bg-slate-100 dark:bg-slate-800' : task ? typeColor[task.type] : 'bg-slate-100 dark:bg-slate-800'
                                } ${isSelected ? 'ring-2 ring-violet-500 ring-offset-1 dark:ring-offset-slate-900' : ''}`}
                              />
                            );
                          })}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-slate-400" /> MCO</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-red-500" /> Incident</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-violet-500" /> Projet</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-slate-100 dark:bg-slate-800" /> Non planifié</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-[repeating-linear-gradient(45deg,theme(colors.slate.300),theme(colors.slate.300)_2px,transparent_2px,transparent_4px)]" />
            Absent(e)
          </span>
        </div>
      </Card>

      {selected && selectedMember && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
            Affecter — {selectedMember.name} · {formatDayLabel(new Date(selected.date))} · {selected.period === 'matin' ? 'Matin' : 'Après-midi'}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="min-w-64 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              value={selectedSlot?.taskId ?? ''}
              onChange={async (e) => {
                const value = e.target.value;
                const label = value ? eligibleTasks.find((t) => t.id === value)?.title : 'aucune tâche';
                if (
                  selectedMember &&
                  (await confirm({ title: 'Confirmer la modification', message: `Affecter "${label}" à ${selectedMember.name} sur ce créneau ?` }))
                ) {
                  setPlanningSlot(selected.memberId, selected.date, selected.period, value || null);
                }
              }}
            >
              <option value="">— Non planifié —</option>
              {eligibleTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            {selectedTask && <TaskTypeBadge type={selectedTask.type} />}
            <button
              onClick={() => setSelected(null)}
              className="ml-auto rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Fermer
            </button>
          </div>
          {eligibleTasks.length === 0 && (
            <p className="mt-2 text-xs text-slate-400">
              Aucune tâche {selected.period === 'matin' ? 'MCO/incident' : 'projet'} ouverte assignée à {selectedMember.name}. Créez-en une dans l'onglet Tâches.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
