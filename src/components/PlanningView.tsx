import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { formatDateLong, formatDayLabel, formatWeekRange, getWeeks, isToday, isWeekend, toISODate } from '../lib/date';
import { PERIOD_LABELS, PERIOD_RANGES, getHourSlots, periodRangeLabel } from '../lib/hours';
import { assignHours, entriesFor } from '../lib/dayAllocation';
import { isAbsent } from '../lib/workload';
import { getTaskById } from '../lib/selectors';
import { Avatar, Card, ModeSwitcher, PrintButton, PrintHeader, TaskTypeBadge } from './ui';
import { useConfirm } from './ConfirmProvider';
import { useViewMode } from '../hooks/useViewMode';
import type { Absence, Period, PlanningSlot, ProjectTask, TaskType, TeamMember, TimeEntry } from '../types';

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
  const { members, tasks, planningSlots, timeEntries, absences, setPlanningSlot } = useStore();
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

      <GrilleHoraire
        members={members}
        currentWeek={currentWeek}
        tasks={tasks}
        planningSlots={planningSlots}
        timeEntries={timeEntries}
        absences={absences}
        selected={selected}
        onSelect={setSelected}
      />

      </>
      )}


      {mode === 'grille' && selected && selectedMember && (
        <Card className="p-4 print:hidden">
          <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
            Affecter — {selectedMember.name} · {formatDayLabel(new Date(selected.date))} · {PERIOD_LABELS[selected.period]} ({periodRangeLabel(selected.period)})
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

      {mode === 'personne' && (
        <PlanningByPerson
          members={members}
          weeks={weeks}
          tasks={tasks}
          planningSlots={planningSlots}
          timeEntries={timeEntries}
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

/** Vue par personne : le planning des 3 semaines d'une seule personne à la fois, avec le titre complet de chaque tâche (lecture seule — l'affectation se fait dans la vue Grille hebdo). */
function PlanningByPerson({
  members,
  weeks,
  tasks,
  planningSlots,
  timeEntries,
  absences,
  personId,
  setPersonId,
}: {
  members: TeamMember[];
  weeks: Date[][];
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  timeEntries: TimeEntry[];
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
                <div key={iso} className={`py-2 ${isWeekend(d) ? 'bg-amber-50/40 dark:bg-amber-500/5' : ''}`}>
                  <div className="mb-1 flex flex-wrap items-center gap-3">
                    <span className="w-24 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">{formatDayLabel(d)}</span>
                    {(['matin', 'apres_midi'] as Period[]).map((period) => {
                      const absentPeriod = isAbsent(absences, person.id, d, period);
                      const task = slotTask(planningSlots, tasks, person.id, iso, period);
                      const meta = task ? typeMeta[task.type] : null;
                      return (
                        <div key={period} className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                          <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{periodRangeLabel(period)}</span>
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
                  <DayHourStrip memberId={person.id} day={d} tasks={tasks} planningSlots={planningSlots} timeEntries={timeEntries} absences={absences} />
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
            <div className="space-y-3">
              {(['matin', 'apres_midi'] as Period[]).map((period) => {
                const rows = members
                  .map((m) => ({
                    member: m,
                    absentPeriod: isAbsent(absences, m.id, d, period),
                    task: slotTask(planningSlots, tasks, m.id, iso, period),
                  }))
                  .filter((r) => r.absentPeriod || r.task);
                return (
                  <div key={period}>
                    {/* Le créneau est nommé par ses heures réelles plutôt que par "Matin"/"Après-midi" seuls. */}
                    <h4 className="mb-1.5 flex items-baseline gap-2">
                      <span className="text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">{periodRangeLabel(period)}</span>
                      <span className="text-[11px] uppercase tracking-wide text-slate-400">{PERIOD_LABELS[period]}</span>
                    </h4>
                    {rows.length === 0 ? (
                      <p className="pl-4 text-xs text-slate-300 dark:text-slate-600">Rien de planifié.</p>
                    ) : (
                      /* Une ligne par personne, bornée par les heures réelles du créneau : chronologique
                         sans répéter quatre fois la même affectation, l'affectation étant à la demi-journée. */
                      <div className="space-y-1.5 border-l-2 border-slate-100 pl-3 dark:border-slate-800">
                        {rows.map(({ member, absentPeriod, task }) => {
                          const meta = task ? typeMeta[task.type] : null;
                          return (
                            <div key={member.id} className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="w-24 shrink-0 text-[11px] font-medium tabular-nums text-slate-400">
                                {periodRangeLabel(period)}
                              </span>
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

/**
 * Une tranche d'une heure. Chaque tranche porte le nom de sa tâche, y compris quand la même
 * tâche en occupe plusieurs d'affilée : une case vide se lit comme un créneau libre, alors
 * qu'elle est bel et bien occupée.
 */
function HourCell({
  task,
  absentPeriod,
  isPlanned = false,
  isSelected,
  title,
  onClick,
}: {
  task: ProjectTask | undefined;
  absentPeriod: boolean;
  /** Vrai quand l'heure retombe sur le prévisionnel faute de temps saisi : affichage atténué. */
  isPlanned?: boolean;
  isSelected: boolean;
  title: string;
  onClick: () => void;
}) {
  const ring = isSelected ? 'ring-2 ring-violet-500 ring-offset-1 dark:ring-offset-slate-900' : '';

  if (absentPeriod) {
    return (
      <div
        title={`${title} — absent(e)`}
        className={`flex h-6 items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50 text-[10px] text-slate-400 dark:border-slate-700 dark:bg-slate-800/40 ${ring}`}
      >
        Absent(e)
      </div>
    );
  }

  const meta = task ? typeMeta[task.type] : null;

  return (
    <button
      onClick={onClick}
      title={title}
      className={`block h-6 w-full min-w-0 rounded border px-1.5 text-left text-[10px] transition-colors ${
        meta
          ? `${meta.bg} ${meta.border} ${meta.text} ${isPlanned ? 'opacity-50 border-dashed' : ''}`
          : 'border-dashed border-slate-200 text-slate-400 hover:border-violet-300 dark:border-slate-700 dark:hover:border-violet-500/50'
      } ${ring}`}
    >
      <span className="flex min-w-0 items-center gap-1">
        {meta && <span className="shrink-0">{meta.icon}</span>}
        <span className="min-w-0 truncate">{task ? task.title : 'Non planifié'}</span>
      </span>
    </button>
  );
}

/** Le créneau (matin/après-midi) d'une personne un jour donné, et la tâche qui lui est affectée. */
function slotTask(planningSlots: PlanningSlot[], tasks: ProjectTask[], memberId: string, iso: string, period: Period) {
  const slot = planningSlots.find((s) => s.memberId === memberId && s.date === iso && s.period === period);
  return getTaskById(tasks, slot?.taskId);
}

/**
 * Grille hebdo, détaillée à l'heure : chaque personne a son propre sous-tableau, lignes = les
 * 13 tranches d'une heure de 06:00 à 19:00, colonnes = les 7 jours de la semaine.
 *
 * Le découpage horaire est un découpage d'AFFICHAGE (voir src/lib/hours.ts) : une tâche reste
 * affectée à une demi-journée entière, et chaque tranche affiche la tâche du créneau qui la
 * contient — d'où le titre sur la première heure et le simple prolongement sur les suivantes,
 * comme un bloc d'agenda de 4 heures. Cliquer sur n'importe quelle tranche ouvre l'affectation
 * de sa demi-journée.
 */
function GrilleHoraire({
  members,
  currentWeek,
  tasks,
  planningSlots,
  timeEntries,
  absences,
  selected,
  onSelect,
}: {
  members: TeamMember[];
  currentWeek: Date[];
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  timeEntries: TimeEntry[];
  absences: Absence[];
  selected: SelectedCell | null;
  onSelect: (cell: SelectedCell) => void;
}) {
  const hourSlots = useMemo(() => getHourSlots(), []);
  const template = '52px repeat(7, minmax(0, 1fr))';

  return (
    <Card className="overflow-x-auto p-3 print:overflow-visible">
      <div className="min-w-[900px] print:min-w-0">
        <div className="grid gap-1 pb-1" style={{ gridTemplateColumns: template }}>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Heure</div>
          {currentWeek.map((d) => (
            <div
              key={toISODate(d)}
              className={`rounded-lg px-2 py-1 text-center text-xs font-semibold ${
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
        </div>

        {members.map((m) => (
          <div key={m.id} className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
            <div className="mb-1 flex items-center gap-2">
              <Avatar name={m.name} color={m.color} initials={m.initials} size={22} />
              <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{m.name}</span>
            </div>
            <div className="grid gap-x-1 gap-y-0.5" style={{ gridTemplateColumns: template }}>
              {hourSlots.map((h) => (
                <div key={h.hour} className="contents">
                  <div
                    className={`flex items-center text-[10px] tabular-nums ${
                      h.period !== null && PERIOD_RANGES[h.period].start === h.hour
                        ? 'font-semibold text-violet-600 dark:text-violet-400'
                        : h.period === null
                          ? 'text-slate-300 dark:text-slate-600'
                          : 'font-medium text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {h.label}
                  </div>
                  {currentWeek.map((d) => {
                    const iso = toISODate(d);
                    const weekendBg = isWeekend(d) ? 'bg-amber-50/60 dark:bg-amber-500/5' : '';
                    if (h.period === null) {
                      return (
                        <div
                          key={iso}
                          title={`${h.rangeLabel} — hors horaires ouvrés`}
                          className={`h-4 rounded-sm ${weekendBg} bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgb(148_163_184_/_0.12)_4px,rgb(148_163_184_/_0.12)_8px)]`}
                        />
                      );
                    }
                    const period = h.period;
                    const slot = planningSlots.find((p) => p.memberId === m.id && p.date === iso && p.period === period);
                    const assignment = assignHours(slot, (per) => entriesFor(timeEntries, m.id, iso, per)).find(
                      (a) => a.hour === h.hour
                    );
                    const task = getTaskById(tasks, assignment?.taskId);
                    return (
                      <div key={iso} className={weekendBg}>
                        <HourCell
                          task={task}
                          absentPeriod={isAbsent(absences, m.id, d, period)}
                          isPlanned={assignment?.source === 'prevu'}
                          isSelected={selected?.memberId === m.id && selected.date === iso && selected.period === period}
                          title={`${m.name} · ${formatDayLabel(d)} · ${h.rangeLabel}${
                            task ? ` — ${task.title}${assignment?.source === 'prevu' ? ' (prévu)' : ' (temps saisi)'}` : ''
                          }`}
                          onClick={() => onSelect({ memberId: m.id, date: iso, period })}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
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
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgb(148_163_184_/_0.3)_3px,rgb(148_163_184_/_0.3)_6px)]" />
          Hors horaires
        </span>
      </div>
    </Card>
  );
}

/**
 * Bande horaire d'une journée pour une personne (vue par personne) : une case par tranche
 * d'une heure de 06:00 à 19:00, l'heure écrite dessous. Les heures ouvrées portent la couleur
 * de la tâche de leur demi-journée, les autres sont hachurées.
 */
function DayHourStrip({
  memberId,
  day,
  tasks,
  planningSlots,
  timeEntries,
  absences,
}: {
  memberId: string;
  day: Date;
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  timeEntries: TimeEntry[];
  absences: Absence[];
}) {
  const hourSlots = useMemo(() => getHourSlots(), []);
  const iso = toISODate(day);

  return (
    <div className="flex gap-px pl-24">
      {hourSlots.map((h) => {
        if (h.period === null) {
          return (
            <div key={h.hour} className="min-w-0 flex-1" title={`${h.rangeLabel} — hors horaires ouvrés`}>
              <div className="h-4 rounded-sm bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgb(148_163_184_/_0.18)_3px,rgb(148_163_184_/_0.18)_6px)]" />
              <div className="mt-0.5 text-center text-[9px] tabular-nums text-slate-300 dark:text-slate-600">{h.hour}h</div>
            </div>
          );
        }
        const absentPeriod = isAbsent(absences, memberId, day, h.period);
        const slot = planningSlots.find((p) => p.memberId === memberId && p.date === iso && p.period === h.period);
        const assignment = assignHours(slot, (per) => entriesFor(timeEntries, memberId, iso, per)).find((a) => a.hour === h.hour);
        const task = absentPeriod ? undefined : getTaskById(tasks, assignment?.taskId);
        const meta = task ? typeMeta[task.type] : null;
        return (
          <div
            key={h.hour}
            className="min-w-0 flex-1"
            title={`${h.rangeLabel} · ${PERIOD_LABELS[h.period]}${task ? ` — ${task.title}` : absentPeriod ? ' — absent(e)' : ' — non planifié'}`}
          >
            <div
              className={`h-4 rounded-sm border ${
                meta
                  ? `${meta.bg} ${meta.border} ${assignment?.source === 'prevu' ? 'opacity-50 border-dashed' : ''}`
                  : 'border-dashed border-slate-200 dark:border-slate-700'
              }`}
            />
            <div className="mt-0.5 text-center text-[9px] font-medium tabular-nums text-slate-500 dark:text-slate-400">{h.hour}h</div>
          </div>
        );
      })}
    </div>
  );
}
