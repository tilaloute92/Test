import { useState } from 'react';
import { useStore } from '../store/useStore';
import { addDays, formatDateLong, isToday, toISODate } from '../lib/date';
import { absencesToday, getTaskById, hoursLoggedToday } from '../lib/selectors';
import { Avatar, Card, PriorityBadge, TaskTypeBadge } from './ui';
import { useConfirm } from './ConfirmProvider';
import type { Period, TaskStatus } from '../types';

const PERIOD_LABEL: Record<Period, string> = { matin: 'Matin — MCO & incidents', apres_midi: 'Après-midi — Projets' };
const eligibleTypes: Record<Period, ('MCO' | 'Incident' | 'Projet')[]> = {
  matin: ['MCO', 'Incident'],
  apres_midi: ['Projet'],
};

export function DailyView() {
  const { members, tasks, planningSlots, timeEntries, absences, setPlanningSlot, updateTask, addTimeEntry } = useStore();
  const confirm = useConfirm();
  const [date, setDate] = useState(new Date());
  const [logging, setLogging] = useState<{ memberId: string; period: Period; taskId: string } | null>(null);
  const [hours, setHours] = useState('3.5');
  const [note, setNote] = useState('');

  const iso = toISODate(date);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Activité du jour</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{formatDateLong(date)}</p>
        </div>
        <div className="flex items-center gap-2">
          <NavButton onClick={() => setDate((d) => addDays(d, -1))}>◀</NavButton>
          <button
            onClick={() => setDate(new Date())}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Aujourd'hui
          </button>
          <NavButton onClick={() => setDate((d) => addDays(d, 1))}>▶</NavButton>
        </div>
      </div>

      <div className="space-y-3">
        {members.map((m) => {
          const absence = absencesToday(absences, m.id, date);
          const loggedToday = hoursLoggedToday(timeEntries, m.id, date);

          return (
            <Card key={m.id} className="p-4">
              <div className="mb-3 flex items-center gap-3">
                <Avatar name={m.name} color={m.color} initials={m.initials} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{m.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{m.role}</div>
                </div>
                <div className="ml-auto text-right text-xs text-slate-500 dark:text-slate-400">
                  <div>Temps saisi aujourd'hui</div>
                  <div className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{loggedToday}h / 7h</div>
                </div>
              </div>

              {absence?.period === 'jour' ? (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  Absent(e) toute la journée — {absence.label ?? absence.type}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(['matin', 'apres_midi'] as Period[]).map((period) => {
                    const isAbsentPeriod = absence && (absence.period === 'jour' || absence.period === period);
                    const slot = planningSlots.find((s) => s.memberId === m.id && s.date === iso && s.period === period);
                    const task = getTaskById(tasks, slot?.taskId);
                    const memberTasks = tasks.filter(
                      (t) => t.assigneeId === m.id && eligibleTypes[period].includes(t.type) && t.status !== 'termine'
                    );

                    return (
                      <div key={period} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{PERIOD_LABEL[period]}</span>
                          {isToday(date) && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              aujourd'hui
                            </span>
                          )}
                        </div>

                        {isAbsentPeriod ? (
                          <div className="text-sm text-slate-400">Absent(e) — {absence?.label ?? absence?.type}</div>
                        ) : (
                          <>
                            <select
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              value={task?.id ?? ''}
                              onChange={async (e) => {
                                const value = e.target.value;
                                const label = value ? memberTasks.find((t) => t.id === value)?.title : 'aucune tâche';
                                if (await confirm({ title: 'Confirmer la modification', message: `Affecter "${label}" à ${m.name} sur ce créneau ?` })) {
                                  setPlanningSlot(m.id, iso, period, value || null);
                                }
                              }}
                            >
                              <option value="">— Non planifié —</option>
                              {memberTasks.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.title}
                                </option>
                              ))}
                            </select>

                            {task && (
                              <div className="mt-2 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <TaskTypeBadge type={task.type} />
                                  <PriorityBadge priority={task.priority} />
                                </div>
                                <div className="flex items-center gap-2">
                                  <select
                                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    value={task.status}
                                    onChange={async (e) => {
                                      const value = e.target.value as TaskStatus;
                                      if (await confirm({ title: 'Confirmer la modification', message: `Changer le statut de "${task.title}" ?` })) {
                                        updateTask(task.id, { status: value });
                                      }
                                    }}
                                  >
                                    <option value="a_faire">À faire</option>
                                    <option value="en_cours">En cours</option>
                                    <option value="en_attente">En attente</option>
                                    <option value="termine">Terminé</option>
                                  </select>
                                  <button
                                    className="ml-auto rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700"
                                    onClick={() => {
                                      setLogging({ memberId: m.id, period, taskId: task.id });
                                      setHours('3.5');
                                      setNote('');
                                    }}
                                  >
                                    + Saisir temps
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {logging && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={() => setLogging(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Saisir le temps passé</h3>
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Heures</label>
            <input
              type="number"
              min="0"
              max="7"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="mb-3 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Note (optionnel)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex : diagnostic terminé, ticket clôturé..."
              className="mb-4 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setLogging(null)} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
                Annuler
              </button>
              <button
                onClick={() => {
                  addTimeEntry({
                    taskId: logging.taskId,
                    memberId: logging.memberId,
                    date: iso,
                    period: logging.period,
                    hours: parseFloat(hours) || 0,
                    note: note || undefined,
                  });
                  setLogging(null);
                }}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
      <StatusHint />
    </div>
  );
}

function NavButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  );
}

function StatusHint() {
  return (
    <p className="text-xs text-slate-400 dark:text-slate-500">
      Le matin est réservé au MCO et aux incidents, l'après-midi aux projets. Choisissez la tâche en cours pour chaque créneau et
      saisissez le temps passé au fil de l'eau.
    </p>
  );
}
