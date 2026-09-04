import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { Avatar, Card, ModeSwitcher, PrintButton, PrintHeader, PriorityBadge, RagBadge, StatusBadge, TaskTypeBadge } from './ui';
import { useConfirm } from './ConfirmProvider';
import { computeFlashReport, listProjects } from '../lib/flashReport';
import { FlashReportModal } from './FlashReportModal';
import { useViewMode } from '../hooks/useViewMode';
import { bucketTasksByDueDate, KANBAN_STATUSES } from '../lib/taskViews';
import type { Priority, ProjectTask, TaskStatus, TaskType, TeamMember } from '../types';

type ConfirmFn = ReturnType<typeof useConfirm>;

const TASK_VIEW_MODES = ['tableau', 'kanban', 'echeancier'] as const;
type TaskViewMode = (typeof TASK_VIEW_MODES)[number];

const statusColumnLabels: Record<TaskStatus, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  en_attente: 'En attente',
  termine: 'Terminé',
};

export function TasksView() {
  const { members, tasks, timeEntries, addTask, updateTask, removeTask } = useStore();
  const confirm = useConfirm();
  const [typeFilter, setTypeFilter] = useState<TaskType | 'Tous'>('Tous');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('Tous');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'Tous'>('Tous');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [openAssigneeMenu, setOpenAssigneeMenu] = useState<string | null>(null);
  const [flashReportProject, setFlashReportProject] = useState<string | null>(null);
  const [mode, setMode] = useViewMode<TaskViewMode>('taches', TASK_VIEW_MODES, 'tableau');

  const spentByTask = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of timeEntries) map[e.taskId] = (map[e.taskId] ?? 0) + e.hours;
    return map;
  }, [timeEntries]);

  const projects = useMemo(() => listProjects(tasks), [tasks]);
  const projectSummaries = useMemo(
    () => projects.map((p) => computeFlashReport(p, tasks, timeEntries, members)),
    [projects, tasks, timeEntries, members]
  );

  const filtered = tasks
    .filter((t) => typeFilter === 'Tous' || t.type === typeFilter)
    .filter((t) => assigneeFilter === 'Tous' || t.assigneeIds.includes(assigneeFilter))
    .filter((t) => statusFilter === 'Tous' || t.status === statusFilter)
    .filter((t) => t.title.toLowerCase().includes(search.toLowerCase()) || (t.project ?? '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.status === 'termine' ? 1 : 0) - (b.status === 'termine' ? 1 : 0));

  const toggleAssignee = async (t: ProjectTask, m: TeamMember) => {
    const has = t.assigneeIds.includes(m.id);
    const message = has ? `Retirer ${m.name} de "${t.title}" ?` : `Ajouter ${m.name} à "${t.title}" ?`;
    if (await confirm({ title: 'Confirmer la modification', message })) {
      const next = has ? t.assigneeIds.filter((id) => id !== m.id) : [...t.assigneeIds, m.id];
      updateTask(t.id, { assigneeIds: next });
    }
  };

  return (
    <div className="space-y-4">
      <PrintHeader title="Tâches, incidents & projets" subtitle={`${filtered.length} élément(s)`} />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Tâches, incidents & projets</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{filtered.length} élément(s) · plusieurs personnes peuvent être assignées à une même tâche</p>
        </div>
        <div className="flex items-center gap-2">
          <ModeSwitcher
            value={mode}
            onChange={setMode}
            options={[
              { value: 'tableau', label: 'Tableau', title: 'Liste filtrable, une ligne par tâche' },
              { value: 'kanban', label: 'Kanban', title: 'Colonnes par statut, glisser-déposer pour changer le statut' },
              { value: 'echeancier', label: 'Échéancier', title: 'Regroupé par échéance : en retard, cette semaine, ce mois-ci...' },
            ]}
          />
          <PrintButton />
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            + Nouvelle tâche
          </button>
        </div>
      </div>

      {projectSummaries.length > 0 && (
        <Card className="p-3 print:hidden">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Projets — flash reports</h2>
          <p className="mb-2 text-xs text-slate-400">
            Un flash report est un point d'avancement rapide par projet (statut Rouge/Orange/Vert calculé à partir des retards, blocages et
            dépassements de charge — jamais une estimation à l'œil).
          </p>
          <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
            {projectSummaries.map((r) => (
              <div key={r.project} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <RagBadge rag={r.rag} />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">{r.project}</span>
                <span className="text-xs text-slate-400">
                  {r.completedTasks.length}/{r.totalTasks} tâche(s) · {Math.round(r.completionRatio * 100)}%
                </span>
                <button
                  onClick={() => setFlashReportProject(r.project)}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-50 dark:border-slate-700 dark:text-violet-400 dark:hover:bg-violet-500/10"
                >
                  Flash report
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="flex flex-wrap gap-2 p-3 print:hidden">
        <input
          placeholder="Rechercher..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-40 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
        <Select value={typeFilter} onChange={setTypeFilter} options={['Tous', 'MCO', 'Incident', 'Projet']} />
        <Select value={statusFilter} onChange={setStatusFilter} options={['Tous', 'a_faire', 'en_cours', 'en_attente', 'termine']} labels={statusLabelMap} />
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        >
          <option value="Tous">Tous les membres</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Card>

      {mode === 'tableau' && (
        <TaskTable
          tasks={filtered}
          members={members}
          spentByTask={spentByTask}
          confirm={confirm}
          openAssigneeMenu={openAssigneeMenu}
          setOpenAssigneeMenu={setOpenAssigneeMenu}
          toggleAssignee={toggleAssignee}
          updateTask={updateTask}
          removeTask={removeTask}
          setEditingTask={setEditingTask}
        />
      )}

      {mode === 'kanban' && (
        <TaskKanban tasks={filtered} members={members} spentByTask={spentByTask} confirm={confirm} updateTask={updateTask} setEditingTask={setEditingTask} />
      )}

      {mode === 'echeancier' && (
        <TaskEcheancier tasks={filtered} members={members} spentByTask={spentByTask} setEditingTask={setEditingTask} />
      )}

      {(showForm || editingTask) && (
        <TaskForm
          members={members}
          initial={editingTask}
          confirm={confirm}
          onCancel={() => {
            setShowForm(false);
            setEditingTask(null);
          }}
          onCreate={(payload) => {
            addTask(payload);
            setShowForm(false);
          }}
          onUpdate={(id, patch) => {
            updateTask(id, patch);
            setEditingTask(null);
          }}
        />
      )}

      {flashReportProject && (
        <FlashReportModal
          project={flashReportProject}
          tasks={tasks}
          timeEntries={timeEntries}
          members={members}
          onClose={() => setFlashReportProject(null)}
        />
      )}
    </div>
  );
}

interface TaskListProps {
  tasks: ProjectTask[];
  members: TeamMember[];
  spentByTask: Record<string, number>;
  setEditingTask: (t: ProjectTask) => void;
}

/** Vue Tableau (mode par défaut) : une ligne par tâche, tout modifiable en place. */
function TaskTable({
  tasks,
  members,
  spentByTask,
  confirm,
  openAssigneeMenu,
  setOpenAssigneeMenu,
  toggleAssignee,
  updateTask,
  removeTask,
  setEditingTask,
}: TaskListProps & {
  confirm: ConfirmFn;
  openAssigneeMenu: string | null;
  setOpenAssigneeMenu: (id: string | null) => void;
  toggleAssignee: (t: ProjectTask, m: TeamMember) => void;
  updateTask: (id: string, patch: Partial<ProjectTask>) => void;
  removeTask: (id: string) => void;
}) {
  return (
    <Card className="overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[900px] text-sm print:min-w-0">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-400 dark:border-slate-800">
            <th className="px-3 py-2 font-medium">Tâche</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Assigné(s)</th>
            <th className="px-3 py-2 font-medium">Priorité</th>
            <th className="px-3 py-2 font-medium">Statut</th>
            <th className="px-3 py-2 font-medium">Temps</th>
            <th className="px-3 py-2 font-medium">Échéance</th>
            <th className="px-3 py-2 print:hidden" />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const assignees = t.assigneeIds.map((id) => members.find((m) => m.id === id)).filter((m): m is TeamMember => Boolean(m));
            const spent = spentByTask[t.id] ?? 0;
            const over = spent > t.estimatedHours;
            const menuOpen = openAssigneeMenu === t.id;
            return (
              <tr key={t.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800 dark:text-slate-100">{t.title}</div>
                  {t.project && <div className="text-xs text-slate-400">{t.project}</div>}
                </td>
                <td className="px-3 py-2">
                  <TaskTypeBadge type={t.type} />
                </td>
                <td className="relative px-3 py-2">
                  <button
                    onClick={() => setOpenAssigneeMenu(menuOpen ? null : t.id)}
                    className="flex items-center gap-1.5 rounded-md border border-transparent px-1 py-1 hover:border-slate-200 dark:hover:border-slate-700"
                  >
                    {assignees.length === 0 ? (
                      <span className="text-xs text-slate-400">Non assigné</span>
                    ) : (
                      <div className="flex -space-x-1.5">
                        {assignees.slice(0, 3).map((m) => (
                          <Avatar key={m.id} name={m.name} color={m.color} initials={m.initials} size={20} />
                        ))}
                        {assignees.length > 3 && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            +{assignees.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    <span className="text-xs text-slate-400">▾</span>
                  </button>

                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setOpenAssigneeMenu(null)} />
                      <div className="absolute left-3 top-full z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                        {members.map((m) => (
                          <label
                            key={m.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <input type="checkbox" checked={t.assigneeIds.includes(m.id)} onChange={() => toggleAssignee(t, m)} />
                            <Avatar name={m.name} color={m.color} initials={m.initials} size={18} />
                            <span className="truncate text-slate-700 dark:text-slate-200">{m.name}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={t.priority}
                    onChange={async (e) => {
                      const value = e.target.value as Priority;
                      if (await confirm({ title: 'Confirmer la modification', message: `Changer la priorité de "${t.title}" ?` })) {
                        updateTask(t.id, { priority: value });
                      }
                    }}
                    className="rounded-md border border-transparent bg-transparent px-1 py-1 text-xs hover:border-slate-200 dark:hover:border-slate-700"
                  >
                    <option value="basse">Basse</option>
                    <option value="normale">Normale</option>
                    <option value="haute">Haute</option>
                    <option value="critique">Critique</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={t.status}
                    onChange={async (e) => {
                      const value = e.target.value as TaskStatus;
                      if (await confirm({ title: 'Confirmer la modification', message: `Changer le statut de "${t.title}" ?` })) {
                        updateTask(t.id, { status: value });
                      }
                    }}
                    className="rounded-md border border-transparent bg-transparent px-1 py-1 text-xs hover:border-slate-200 dark:hover:border-slate-700"
                  >
                    <option value="a_faire">À faire</option>
                    <option value="en_cours">En cours</option>
                    <option value="en_attente">En attente</option>
                    <option value="termine">Terminé</option>
                  </select>
                </td>
                <td className={`px-3 py-2 tabular-nums ${over ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
                  {spent}h / {t.estimatedHours}h
                </td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{t.dueDate ?? '—'}</td>
                <td className="px-3 py-2 text-right print:hidden">
                  <button
                    onClick={() => setEditingTask(t)}
                    className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    Modifier
                  </button>
                  <button
                    onClick={async () => {
                      if (await confirm({ title: 'Supprimer la tâche', message: `Supprimer définitivement "${t.title}" ?`, confirmLabel: 'Supprimer', danger: true })) {
                        removeTask(t.id);
                      }
                    }}
                    className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                  >
                    Suppr.
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/** Vue Kanban : une colonne par statut, glisser-déposer une carte pour changer le statut (confirmation demandée, comme tout changement). */
function TaskKanban({
  tasks,
  members,
  spentByTask,
  confirm,
  updateTask,
  setEditingTask,
}: TaskListProps & { confirm: ConfirmFn; updateTask: (id: string, patch: Partial<ProjectTask>) => void }) {
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);

  const handleDrop = async (t: ProjectTask, status: TaskStatus) => {
    setDragOverColumn(null);
    if (t.status === status) return;
    if (await confirm({ title: 'Confirmer la modification', message: `Changer le statut de "${t.title}" en "${statusColumnLabels[status]}" ?` })) {
      updateTask(t.id, { status });
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4 print:gap-2">
      {KANBAN_STATUSES.map((status) => {
        const columnTasks = tasks.filter((t) => t.status === status);
        return (
          <div
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverColumn(status);
            }}
            onDragLeave={() => setDragOverColumn((c) => (c === status ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              const taskId = e.dataTransfer.getData('text/task-id');
              const t = tasks.find((x) => x.id === taskId);
              if (t) handleDrop(t, status);
            }}
            className={`flex flex-col gap-2 rounded-xl border p-2.5 transition-colors ${
              dragOverColumn === status
                ? 'border-violet-400 bg-violet-50/60 dark:border-violet-500 dark:bg-violet-500/10'
                : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{statusColumnLabels[status]}</h3>
              <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {columnTasks.length}
              </span>
            </div>
            <div className="flex min-h-16 flex-col gap-2">
              {columnTasks.map((t) => {
                const assignees = t.assigneeIds.map((id) => members.find((m) => m.id === id)).filter((m): m is TeamMember => Boolean(m));
                const spent = spentByTask[t.id] ?? 0;
                const over = spent > t.estimatedHours;
                return (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/task-id', t.id)}
                    onClick={() => setEditingTask(t)}
                    className="cursor-grab space-y-1.5 rounded-lg border border-slate-200 bg-white p-2.5 text-left shadow-sm active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.title}</span>
                      <TaskTypeBadge type={t.type} />
                    </div>
                    {t.project && <div className="truncate text-xs text-slate-400">{t.project}</div>}
                    <div className="flex items-center justify-between gap-2">
                      <PriorityBadge priority={t.priority} />
                      {assignees.length > 0 ? (
                        <div className="flex -space-x-1.5">
                          {assignees.slice(0, 3).map((m) => (
                            <Avatar key={m.id} name={m.name} color={m.color} initials={m.initials} size={18} />
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400">Non assigné</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className={over ? 'text-red-600 dark:text-red-400' : ''}>
                        {spent}h / {t.estimatedHours}h
                      </span>
                      {t.dueDate && <span>{t.dueDate}</span>}
                    </div>
                  </div>
                );
              })}
              {columnTasks.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-300 dark:border-slate-700 dark:text-slate-600">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Vue Échéancier : regroupée par proximité d'échéance plutôt que par statut — pour voir d'un coup d'œil ce qui presse. */
function TaskEcheancier({ tasks, members, spentByTask, setEditingTask }: TaskListProps) {
  const groups = useMemo(() => bucketTasksByDueDate(tasks), [tasks]);

  if (groups.length === 0) {
    return <Card className="p-6 text-center text-sm text-slate-400">Aucune tâche ne correspond aux filtres actuels.</Card>;
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g.key} className="p-3">
          <div className="mb-2 flex items-center gap-2">
            <h3 className={`text-xs font-semibold uppercase tracking-wide ${g.key === 'retard' ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
              {g.label}
            </h3>
            <span className="text-xs text-slate-300 dark:text-slate-600">({g.tasks.length})</span>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
            {g.tasks.map((t) => {
              const assignees = t.assigneeIds.map((id) => members.find((m) => m.id === id)).filter((m): m is TeamMember => Boolean(m));
              const spent = spentByTask[t.id] ?? 0;
              const over = spent > t.estimatedHours;
              return (
                <button
                  key={t.id}
                  onClick={() => setEditingTask(t)}
                  className="flex w-full flex-wrap items-center gap-2.5 py-2 text-left hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                >
                  <TaskTypeBadge type={t.type} />
                  <span className={`min-w-0 flex-1 truncate text-sm font-medium ${t.status === 'termine' ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100'}`}>
                    {t.title}
                  </span>
                  {t.project && <span className="text-xs text-slate-400">{t.project}</span>}
                  <StatusBadge status={t.status} />
                  <PriorityBadge priority={t.priority} />
                  {assignees.length > 0 && (
                    <div className="flex -space-x-1.5">
                      {assignees.slice(0, 3).map((m) => (
                        <Avatar key={m.id} name={m.name} color={m.color} initials={m.initials} size={18} />
                      ))}
                    </div>
                  )}
                  <span className={`text-xs tabular-nums ${over ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
                    {spent}h / {t.estimatedHours}h
                  </span>
                  <span className="text-xs text-slate-400">{t.dueDate ?? '—'}</span>
                </button>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

const statusLabelMap: Record<string, string> = {
  Tous: 'Tous statuts',
  a_faire: 'À faire',
  en_cours: 'En cours',
  en_attente: 'En attente',
  termine: 'Terminé',
};

function Select<T extends string>({ value, onChange, options, labels }: { value: T; onChange: (v: T) => void; options: T[]; labels?: Record<string, string> }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

interface TaskFormPayload {
  title: string;
  type: TaskType;
  project?: string;
  assigneeIds: string[];
  status: TaskStatus;
  priority: Priority;
  estimatedHours: number;
  dueDate?: string;
  description?: string;
}

function TaskForm({
  members,
  initial,
  confirm,
  onCancel,
  onCreate,
  onUpdate,
}: {
  members: TeamMember[];
  initial: ProjectTask | null;
  confirm: ConfirmFn;
  onCancel: () => void;
  onCreate: (payload: TaskFormPayload) => void;
  onUpdate: (id: string, patch: TaskFormPayload) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [type, setType] = useState<TaskType>(initial?.type ?? 'Incident');
  const [project, setProject] = useState(initial?.project ?? '');
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initial?.assigneeIds ?? []);
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? 'a_faire');
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'normale');
  const [estimatedHours, setEstimatedHours] = useState(String(initial?.estimatedHours ?? '3.5'));
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  const toggleAssignee = (id: string) => {
    setAssigneeIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const submit = async () => {
    const payload: TaskFormPayload = {
      title: title.trim(),
      type,
      project: type === 'Projet' ? project.trim() || undefined : undefined,
      assigneeIds,
      status,
      priority,
      estimatedHours: parseFloat(estimatedHours) || 0,
      dueDate: dueDate || undefined,
      description: description.trim() || undefined,
    };
    if (initial) {
      if (await confirm({ title: 'Confirmer la modification', message: `Enregistrer les modifications apportées à "${initial.title}" ?` })) {
        onUpdate(initial.id, payload);
      }
    } else {
      onCreate(payload);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{initial ? 'Modifier la tâche' : 'Nouvelle tâche'}</h3>
          {initial?.updatedBy && initial?.updatedAt && (
            <p className="mt-0.5 text-xs text-slate-400">
              Dernière modification par {initial.updatedBy}, le {new Date(initial.updatedAt).toLocaleString('fr-FR')}
            </p>
          )}
        </div>
        <div className="space-y-2.5">
          <Field label="Titre">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Type">
              <select value={type} onChange={(e) => setType(e.target.value as TaskType)} className="input">
                <option value="MCO">MCO</option>
                <option value="Incident">Incident</option>
                <option value="Projet">Projet</option>
              </select>
            </Field>
            <Field label="Priorité">
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="input">
                <option value="basse">Basse</option>
                <option value="normale">Normale</option>
                <option value="haute">Haute</option>
                <option value="critique">Critique</option>
              </select>
            </Field>
          </div>
          {type === 'Projet' && (
            <Field label="Projet">
              <input value={project} onChange={(e) => setProject(e.target.value)} className="input" placeholder="Ex : Migration Datacenter Nord" />
            </Field>
          )}
          {initial && (
            <Field label="Statut">
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="input">
                <option value="a_faire">À faire</option>
                <option value="en_cours">En cours</option>
                <option value="en_attente">En attente</option>
                <option value="termine">Terminé</option>
              </select>
            </Field>
          )}
          <Field label="Assigné(s) à">
            <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-700">
              {members.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input type="checkbox" checked={assigneeIds.includes(m.id)} onChange={() => toggleAssignee(m.id)} />
                  <Avatar name={m.name} color={m.color} initials={m.initials} size={18} />
                  <span className="truncate text-slate-700 dark:text-slate-200">{m.name}</span>
                </label>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Charge estimée (h)">
              <input type="number" step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} className="input" />
            </Field>
            <Field label="Échéance">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
            </Field>
          </div>
          <Field label="Description (optionnel)">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input" />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
            Annuler
          </button>
          <button
            disabled={!title.trim()}
            onClick={submit}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          >
            {initial ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}
