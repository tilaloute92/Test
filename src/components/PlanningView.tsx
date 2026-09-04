import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { formatDateLong, formatDayLabel, formatWeekRange, getWeeks, isToday, isWeekend, toISODate } from '../lib/date';
import { isAbsent } from '../lib/workload';
import { getTaskById } from '../lib/selectors';
import { Avatar, Card, ModeSwitcher, PrintButton, PrintHeader, TaskTypeBadge } from './ui';
import { useConfirm } from './ConfirmProvider';
import { useViewMode } from '../hooks/useViewMode';
import type { Absence, Period, PlanningSlot, ProjectTask, TaskType, TeamMember } from '../types';

const PLANNING_VIEW_MODES = ['grille', 'personne', 'liste'] as const;
type PlanningViewMode = (typeof PLANNING_VIEW_MODES)[number];

const typeMeta: Record<TaskType, { icon: string; bg: string; border: string; text: string; dot: string }> = {
  MCO: {
    icon: '🔧',
    bg: 'bg-slate-100 dark:bg-slate-800',
    border: 'border-slate-300 dark:border-slate-600',
    text: 'text-slate-700 dark:text-slate-200',
    dot: 'bg-slate-400',
  },
  Incident: {
    icon: '🔥',
    bg: 'bg-red-50 dark:bg-red-500/10',
    border: 'border-red-200 dark:border-red-500/40',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
  Projet: {
    icon: '📁',
    bg: 'bg-violet-50 dark:bg-violet-500/10',
    border: 'border-violet-200 dark:border-violet-500/40',
    text: 'text-violet-700 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
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
  const [weekIndex, setWeekIndex] = useState(0);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [mode, setMode] = useViewMode<PlanningViewMode>('planning', PLANNING_VIEW_MODES, 'grille');
  const [personId, setPersonId] = useState<string>(members[0]?.id ?? '');
  const currentWeek = weeks[weekIndex];

  const selectedMember = selected ? members.find((m) => m.id === selected.memberId) : null;
  const selectedSlot = selected
    ? planningSlots.find((s) => s.memberId === selected.memberId && s.date === selected.date && s.period === selected.period)
    : null;
  const selectedTask = getTaskById(tasks, selectedSlot?.taskId);
  const eligibleTypes: TaskType[] = selected?.period === 'matin' ? ['MCO', 'Incident'] : ['Projet'];
  const eligibleTasks = selected
    ? tasks.filter((t) => t.assigneeIds.includes(selected.memberId) && eligibleTypes.includes(t.type) && t.status !== 'termine')
    : [];

  return (
    <div className="space-y-4">
      <PrintHeader title="Planning prévisionnel — 3 semaines" subtitle={`Semaine ${weekIndex + 1} affichée en détail : ${formatWeekRange(currentWeek)}`} />
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Planning prévisionnel — 3 semaines</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Matin = MCO / incidents · Après-midi = projets, du lundi au dimanche (équipe en horaires décalés). Cliquez sur un créneau pour
            l'affecter — le week-end est repéré par un fond légèrement teinté.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModeSwitcher
            value={mode}
            onChange={setMode}
            options={[
              { value: 'grille', label: 'Grille hebdo', title: 'Grille par personne et par jour, semaine par semaine' },
              { value: 'personne', label: 'Vue par personne', title: 'Planning détaillé sur les 3 semaines, une personne à la fois' },
              { value: 'liste', label: 'Liste chronologique', title: 'Agenda jour par jour de la semaine sélectionnée, dans l’ordre' },
            ]}
          />
          <PrintButton />
        </div>
      </div>

      {mode === 'grille' && (
      <>
      {/* Mini aperçu des 3 semaines — vue d'ensemble compacte, la semaine sélectionnée est encadrée */}
      <Card className="overflow-x-auto p-3 print:hidden">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Aperçu 3 semaines</h2>
        <div className="space-y-1.5">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <Avatar name={m.name} color={m.color} initials={m.initials} size={20} />
              <span className="w-32 shrink-0 truncate text-xs text-slate-600 dark:text-slate-300">{m.name}</span>
              <div className="flex gap-2">
                {weeks.map((week, wi) => (
                  <div
                    key={wi}
                    className={`flex gap-1 rounded-md p-1 ${wi === weekIndex ? 'bg-violet-50 ring-1 ring-violet-300 dark:bg-violet-500/10 dark:ring-violet-500/50' : ''}`}
                  >
                    {week.map((d) => {
                      const iso = toISODate(d);
                      const dayAbsent = isAbsent(absences, m.id, d, 'matin') && isAbsent(absences, m.id, d, 'apres_midi');
                      return (
                        <div key={iso} className="flex flex-col gap-0.5">
                          {(['matin', 'apres_midi'] as Period[]).map((period) => {
                            if (dayAbsent || isAbsent(absences, m.id, d, period)) {
                              return <span key={period} className="h-1.5 w-1.5 rounded-sm bg-slate-200 dark:bg-slate-700" />;
                            }
                            const slot = planningSlots.find((s) => s.memberId === m.id && s.date === iso && s.period === period);
                            const task = getTaskById(tasks, slot?.taskId);
                            return (
                              <span
                                key={period}
                                className={`h-1.5 w-1.5 rounded-sm ${task ? typeMeta[task.type].dot : 'bg-slate-100 dark:bg-slate-800'}`}
                              />
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Semaine sélectionnée en détail */}
      <div className="flex gap-2 print:hidden">
        {weeks.map((week, wi) => (
          <button
            key={wi}
            onClick={() => setWeekIndex(wi)}
            className={`rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
              wi === weekIndex
                ? 'bg-violet-600 text-white'
                : 'bg-white text-slate-500 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <div>Semaine {wi + 1}</div>
            <div className="opacity-80">{formatWeekRange(week)}</div>
          </button>
        ))}
      </div>

      <Card className="overflow-x-auto p-3 print:overflow-visible">
        <div className="grid min-w-[1200px] grid-cols-[160px_repeat(7,minmax(0,1fr))] gap-2 print:min-w-0">
          <div />
          {currentWeek.map((d) => (
            <div
              key={toISODate(d)}
              className={`rounded-lg px-2 py-1.5 text-center text-xs font-semibold ${
                isToday(d)
                  ? 'bg-violet-600 text-white'
                  : isWeekend(d)
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                    : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {formatDayLabel(d)}
            </div>
          ))}

          {members.map((m) => (
            <div key={m.id} className="contents">
              <div className="flex items-center gap-2 py-1">
                <Avatar name={m.name} color={m.color} initials={m.initials} size={28} />
                <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{m.name}</span>
              </div>
              {currentWeek.map((d) => {
                const iso = toISODate(d);
                const dayAbsent = isAbsent(absences, m.id, d, 'matin') && isAbsent(absences, m.id, d, 'apres_midi');
                const weekendBg = isWeekend(d) ? 'bg-amber-50/50 dark:bg-amber-500/5 rounded-lg' : '';
                if (dayAbsent) {
                  return (
                    <div
                      key={iso}
                      className={`flex items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-3 text-center text-[11px] text-slate-400 dark:border-slate-700 dark:bg-slate-800/40`}
                    >
                      Absent(e)
                    </div>
                  );
                }
                return (
                  <div key={iso} className={`min-w-0 space-y-1 p-0.5 ${weekendBg}`}>
                    {(['matin', 'apres_midi'] as Period[]).map((period) => {
                      const absentPeriod = isAbsent(absences, m.id, d, period);
                      const slot = planningSlots.find((s) => s.memberId === m.id && s.date === iso && s.period === period);
                      const task = getTaskById(tasks, slot?.taskId);
                      const isSelected = selected?.memberId === m.id && selected.date === iso && selected.period === period;
                      return (
                        <PeriodChip
                          key={period}
                          task={task}
                          absentPeriod={absentPeriod}
                          isSelected={isSelected}
                          onClick={() => setSelected({ memberId: m.id, date: iso, period })}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">🔧 MCO</span>
          <span className="inline-flex items-center gap-1.5">🔥 Incident</span>
          <span className="inline-flex items-center gap-1.5">📁 Projet</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm border border-dashed border-slate-300 dark:border-slate-600" /> Non planifié / Absent(e)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-amber-50 dark:bg-amber-500/10" /> Week-end
          </span>
        </div>
      </Card>

      {selected && selectedMember && (
        <Card className="p-4 print:hidden">
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
      </>
      )}

      {mode === 'personne' && (
        <PlanningByPerson
          members={members}
          weeks={weeks}
          tasks={tasks}
          planningSlots={planningSlots}
          absences={absences}
          personId={personId}
          setPersonId={setPersonId}
        />
      )}

      {mode === 'liste' && (
        <PlanningTimeline
          members={members}
          weeks={weeks}
          weekIndex={weekIndex}
          setWeekIndex={setWeekIndex}
          tasks={tasks}
          planningSlots={planningSlots}
          absences={absences}
        />
      )}
    </div>
  );
}

function PeriodChip({
  task,
  absentPeriod,
  isSelected,
  onClick,
}: {
  task: ProjectTask | undefined;
  absentPeriod: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  if (absentPeriod) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 px-2 py-1.5 text-[11px] text-slate-400 dark:border-slate-700">
        Absent(e)
      </div>
    );
  }
  const meta = task ? typeMeta[task.type] : null;
  return (
    <button
      onClick={onClick}
      title={task ? `${task.title} (${task.type})` : 'Non planifié'}
      className={`block w-full min-w-0 rounded-lg border px-2 py-1.5 text-left text-[11px] transition-colors ${
        meta ? `${meta.bg} ${meta.border} ${meta.text}` : 'border-dashed border-slate-200 text-slate-400 hover:border-violet-300 dark:border-slate-700 dark:hover:border-violet-500/50'
      } ${isSelected ? 'ring-2 ring-violet-500 ring-offset-1 dark:ring-offset-slate-900' : ''}`}
    >
      <div className="flex min-w-0 items-center gap-1">
        {meta && <span className="shrink-0">{meta.icon}</span>}
        <span className="min-w-0 truncate">{task ? task.title : 'Non planifié'}</span>
      </div>
    </button>
  );
}

/** Vue par personne : le planning des 3 semaines d'une seule personne à la fois, avec le titre complet de chaque tâche (lecture seule — l'affectation se fait dans la vue Grille hebdo). */
function PlanningByPerson({
  members,
  weeks,
  tasks,
  planningSlots,
  absences,
  personId,
  setPersonId,
}: {
  members: TeamMember[];
  weeks: Date[][];
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  absences: Absence[];
  personId: string;
  setPersonId: (id: string) => void;
}) {
  const person = members.find((m) => m.id === personId) ?? members[0];

  if (!person) {
    return <Card className="p-6 text-center text-sm text-slate-400 print:hidden">Aucun membre dans l'équipe.</Card>;
  }

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap gap-1.5 p-2 print:hidden">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => setPersonId(m.id)}
            className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-sm transition-colors ${
              m.id === person.id
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <Avatar name={m.name} color={m.color} initials={m.initials} size={22} />
            {m.name}
          </button>
        ))}
      </Card>

      <PrintHeader title={`Planning — ${person.name}`} subtitle="3 semaines" />

      {weeks.map((week, wi) => (
        <Card key={wi} className="p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Semaine {wi + 1} · {formatWeekRange(week)}
          </h3>
          <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
            {week.map((d) => {
              const iso = toISODate(d);
              return (
                <div key={iso} className={`flex flex-wrap items-center gap-3 py-2 ${isWeekend(d) ? 'bg-amber-50/40 dark:bg-amber-500/5' : ''}`}>
                  <span className="w-24 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">{formatDayLabel(d)}</span>
                  {(['matin', 'apres_midi'] as Period[]).map((period) => {
                    const absentPeriod = isAbsent(absences, person.id, d, period);
                    const slot = planningSlots.find((s) => s.memberId === person.id && s.date === iso && s.period === period);
                    const task = getTaskById(tasks, slot?.taskId);
                    const meta = task ? typeMeta[task.type] : null;
                    return (
                      <div key={period} className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                        <span className="shrink-0 text-[11px] text-slate-400">{period === 'matin' ? 'Matin' : 'Après-midi'}</span>
                        {absentPeriod ? (
                          <span className="text-xs text-slate-400">Absent(e)</span>
                        ) : task ? (
                          <span className={`inline-flex min-w-0 items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-xs ${meta!.bg} ${meta!.text}`}>
                            {meta!.icon} {task.title}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300 dark:text-slate-600">Non planifié</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Vue Liste chronologique : agenda jour par jour de la semaine sélectionnée, matin puis après-midi, dans l'ordre — pratique pour un point d'équipe. */
function PlanningTimeline({
  members,
  weeks,
  weekIndex,
  setWeekIndex,
  tasks,
  planningSlots,
  absences,
}: {
  members: TeamMember[];
  weeks: Date[][];
  weekIndex: number;
  setWeekIndex: (i: number) => void;
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  absences: Absence[];
}) {
  const currentWeek = weeks[weekIndex];

  return (
    <div className="space-y-3">
      <div className="flex gap-2 print:hidden">
        {weeks.map((week, wi) => (
          <button
            key={wi}
            onClick={() => setWeekIndex(wi)}
            className={`rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
              wi === weekIndex
                ? 'bg-violet-600 text-white'
                : 'bg-white text-slate-500 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <div>Semaine {wi + 1}</div>
            <div className="opacity-80">{formatWeekRange(week)}</div>
          </button>
        ))}
      </div>

      <PrintHeader title="Planning — Liste chronologique" subtitle={`Semaine ${weekIndex + 1} : ${formatWeekRange(currentWeek)}`} />

      {currentWeek.map((d) => {
        const iso = toISODate(d);
        return (
          <Card key={iso} className={`p-3 ${isWeekend(d) ? 'bg-amber-50/30 dark:bg-amber-500/5' : ''}`}>
            <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{formatDateLong(d)}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(['matin', 'apres_midi'] as Period[]).map((period) => {
                const rows = members.map((m) => {
                  const absentPeriod = isAbsent(absences, m.id, d, period);
                  const slot = planningSlots.find((s) => s.memberId === m.id && s.date === iso && s.period === period);
                  const task = getTaskById(tasks, slot?.taskId);
                  return { member: m, absentPeriod, task };
                });
                const active = rows.filter((r) => r.absentPeriod || r.task);
                return (
                  <div key={period}>
                    <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {period === 'matin' ? 'Matin' : 'Après-midi'}
                    </h4>
                    {active.length === 0 ? (
                      <p className="text-xs text-slate-300 dark:text-slate-600">Rien de planifié.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {active.map(({ member, absentPeriod, task }) => {
                          const meta = task ? typeMeta[task.type] : null;
                          return (
                            <div key={member.id} className="flex min-w-0 items-center gap-1.5 text-sm">
                              <Avatar name={member.name} color={member.color} initials={member.initials} size={18} />
                              <span className="shrink-0 truncate text-xs text-slate-500 dark:text-slate-400">{member.name}</span>
                              {absentPeriod ? (
                                <span className="text-xs text-slate-400">Absent(e)</span>
                              ) : (
                                <span className={`inline-flex min-w-0 items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-xs ${meta!.bg} ${meta!.text}`}>
                                  {meta!.icon} {task!.title}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
