import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { Avatar, Card, PrintButton, PrintHeader, TaskTypeBadge } from './ui';
import { useConfirm } from './ConfirmProvider';
import type { Priority, ProjectTask, TaskStatus, TaskType, TeamMember } from '../types';

type ConfirmFn = ReturnType<typeof useConfirm>;

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

  const spentByTask = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of timeEntries) map[e.taskId] = (map[e.taskId] ?? 0) + e.hours;
    return map;
  }, [timeEntries]);

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
          <PrintButton />
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            + Nouvelle tâche
          </button>
        </div>
      </div>

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
            {filtered.map((t) => {
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
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{initial ? 'Modifier la tâche' : 'Nouvelle tâche'}</h3>
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
