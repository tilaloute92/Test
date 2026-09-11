import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { acquireGraphToken, isAuthConfigured } from '../auth/msalClient';
import {
  PLANNER_SCOPES,
  describeError,
  listPlanTasks,
  listPlans,
  toTaskDraft,
  type PlannerPlan,
  type PlannerTask,
} from '../lib/msPlanner';
import { Avatar, TaskTypeBadge } from './ui';
import type { TaskType } from '../types';

/**
 * Import des tâches d'un plan Microsoft Planner (Teams) dans l'onglet Tâches.
 *
 * Import à sens unique et non destructif : rien n'est écrit dans Planner, et une tâche déjà
 * importée (repérée par `plannerTaskId`) ne peut pas l'être une seconde fois. Par défaut seules
 * les tâches récurrentes sont proposées, puisque c'est le cas d'usage visé — le filtre se retire.
 */
export function PlannerImportModal({ onClose }: { onClose: () => void }) {
  const { authSettings, members, tasks, addTask } = useStore();
  const configured = isAuthConfigured(authSettings);

  const [token, setToken] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlannerPlan[]>([]);
  const [planId, setPlanId] = useState('');
  const [plannerTasks, setPlannerTasks] = useState<PlannerTask[]>([]);
  const [recurrenceAvailable, setRecurrenceAvailable] = useState(true);
  const [onlyRecurring, setOnlyRecurring] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [type, setType] = useState<TaskType>('MCO');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<'connexion' | 'plan' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  /** Tâches Planner déjà présentes dans l'appli — on ne les propose pas deux fois. */
  const alreadyImported = useMemo(
    () => new Set(tasks.map((t) => t.plannerTaskId).filter((id): id is string => Boolean(id))),
    [tasks]
  );

  const visibleTasks = plannerTasks.filter((t) => !onlyRecurring || t.recurrence !== null);
  const importable = visibleTasks.filter((t) => !alreadyImported.has(t.id));

  const connect = async () => {
    setBusy('connexion');
    setError(null);
    try {
      const accessToken = await acquireGraphToken(authSettings, PLANNER_SCOPES);
      setToken(accessToken);
      setPlans(await listPlans(accessToken));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const loadPlan = async (id: string) => {
    setPlanId(id);
    setSelectedIds([]);
    setImported(null);
    if (!id || !token) {
      setPlannerTasks([]);
      return;
    }
    setBusy('plan');
    setError(null);
    try {
      const result = await listPlanTasks(token, id);
      setPlannerTasks(result.tasks);
      setRecurrenceAvailable(result.recurrenceAvailable);
      if (!result.recurrenceAvailable) setOnlyRecurring(false);
    } catch (e) {
      setError(describeError(e));
      setPlannerTasks([]);
    } finally {
      setBusy(null);
    }
  };

  const runImport = () => {
    setBusy('import');
    const chosen = importable.filter((t) => selectedIds.includes(t.id));
    for (const task of chosen) {
      addTask(toTaskDraft(task, { type, assigneeIds, project: plans.find((p) => p.id === planId)?.title, estimatedHours: 3.5 }));
    }
    setImported(chosen.length);
    setSelectedIds([]);
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div
        className="my-8 w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Importer depuis Microsoft Planner</h3>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            Fermer
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Récupère les tâches d'un plan Planner (onglet Tasks de Teams) et les crée dans l'onglet Tâches. L'import est à sens unique :
          rien n'est modifié dans Planner, et les occurrences des tâches récurrentes continuent d'être générées par Planner.
        </p>

        {!configured && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            La connexion Microsoft n'est pas configurée. Renseignez l'ID de locataire (tenant), l'ID d'application (client) et l'URI de
            redirection dans l'onglet <strong>Paramètres</strong>, puis revenez ici. L'application Entra ID doit aussi avoir le
            consentement pour les permissions déléguées{' '}
            {PLANNER_SCOPES.map((scope, i) => (
              <span key={scope}>
                {i > 0 && ' et '}
                <code className="rounded bg-amber-100 px-1 font-mono dark:bg-amber-500/20">{scope}</code>
              </span>
            ))}
            .
          </div>
        )}

        {configured && !token && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={connect}
              disabled={busy !== null}
              className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {busy === 'connexion' ? 'Connexion…' : 'Se connecter à Microsoft'}
            </button>
            <span className="text-xs text-slate-400">Une fenêtre Microsoft s'ouvre pour demander l'accès en lecture à vos plans.</span>
          </div>
        )}

        {token && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Plan</label>
              <select
                value={planId}
                onChange={(e) => loadPlan(e.target.value)}
                className="min-w-64 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                <option value="">— Choisir un plan —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              {busy === 'plan' && <span className="text-xs text-slate-400">Chargement des tâches…</span>}
              {plans.length === 0 && <span className="text-xs text-slate-400">Aucun plan Planner accessible avec ce compte.</span>}
            </div>

            {planId && !busy && (
              <>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={onlyRecurring}
                      disabled={!recurrenceAvailable}
                      onChange={(e) => {
                        setOnlyRecurring(e.target.checked);
                        setSelectedIds([]);
                      }}
                    />
                    Tâches récurrentes uniquement
                  </label>
                  <button
                    onClick={() => setSelectedIds(importable.map((t) => t.id))}
                    className="text-xs text-violet-600 hover:underline dark:text-violet-400"
                  >
                    Tout sélectionner ({importable.length})
                  </button>
                  {selectedIds.length > 0 && (
                    <button onClick={() => setSelectedIds([])} className="text-xs text-slate-400 hover:underline">
                      Tout décocher
                    </button>
                  )}
                </div>

                {!recurrenceAvailable && (
                  <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                    Votre locataire n'expose pas la récurrence des tâches Planner (elle n'existe que sur l'API Graph bêta). Impossible de
                    distinguer les tâches récurrentes : toutes les tâches du plan sont listées.
                  </p>
                )}

                <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-800">
                  {visibleTasks.length === 0 ? (
                    <p className="p-3 text-xs text-slate-400">
                      {onlyRecurring ? 'Aucune tâche récurrente dans ce plan.' : 'Ce plan ne contient aucune tâche.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-50 dark:divide-slate-800/60">
                      {visibleTasks.map((t) => {
                        const done = alreadyImported.has(t.id);
                        return (
                          <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              disabled={done}
                              checked={selectedIds.includes(t.id)}
                              onChange={(e) =>
                                setSelectedIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((id) => id !== t.id)))
                              }
                            />
                            <span className={`min-w-0 flex-1 truncate ${done ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100'}`}>
                              {t.title}
                            </span>
                            {t.recurrence && (
                              <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                                🔁 {t.recurrence}
                              </span>
                            )}
                            {t.dueDate && <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{t.dueDate}</span>}
                            {done && <span className="shrink-0 text-[10px] text-slate-400">déjà importée</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Créer en tant que</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as TaskType)}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="MCO">MCO</option>
                    <option value="Incident">Incident</option>
                    <option value="Projet">Projet</option>
                  </select>
                  <TaskTypeBadge type={type} />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Assigner à (optionnel)</label>
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m) => {
                      const on = assigneeIds.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          onClick={() => setAssigneeIds((ids) => (on ? ids.filter((id) => id !== m.id) : [...ids, m.id]))}
                          className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs transition-colors ${
                            on
                              ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'
                              : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                          }`}
                        >
                          <Avatar name={m.name} color={m.color} initials={m.initials} size={20} />
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}

        {imported !== null && (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
            {imported} tâche(s) importée(s) dans l'onglet Tâches.
          </p>
        )}

        {token && planId && (
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
              Terminer
            </button>
            <button
              onClick={runImport}
              disabled={selectedIds.length === 0 || busy !== null}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
            >
              Importer {selectedIds.length > 0 ? `${selectedIds.length} tâche(s)` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
