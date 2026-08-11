import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { Avatar, Card, TaskTypeBadge } from './ui';
import type { Priority, TaskStatus, TaskType } from '../types';

export function TasksView() {
  const { members, tasks, timeEntries, addTask, updateTask, removeTask } = useStore();
  const [typeFilter, setTypeFilter] = useState<TaskType | 'Tous'>('Tous');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('Tous');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'Tous'>('Tous');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);

  const spentByTask = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of timeEntries) map[e.taskId] = (map[e.taskId] ?? 0) + e.hours;
    return map;
  }, [timeEntries]);

  const filtered = tasks
    .filter((t) => typeFilter === 'Tous' || t.type === typeFilter)
    .filter((t) => assigneeFilter === 'Tous' || t.assigneeId === assigneeFilter)
    .filter((t) => statusFilter === 'Tous' || t.status === statusFilter)
    .filter((t) => t.title.toLowerCase().includes(search.toLowerCase()) || (t.project ?? '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.status === 'termine' ? 1 : 0) - (b.status === 'termine' ? 1 : 0));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Tâches, incidents & projets</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{filtered.length} élément(s)</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          + Nouvelle tâche
        </button>
      </div>

      <Card className="flex flex-wrap gap-2 p-3">
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

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400 dark:border-slate-800">
              <th className="px-3 py-2 font-medium">Tâche</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Assigné</th>
              <th className="px-3 py-2 font-medium">Priorité</th>
              <th className="px-3 py-2 font-medium">Statut</th>
              <th className="px-3 py-2 font-medium">Temps</th>
              <th className="px-3 py-2 font-medium">Échéance</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const member = members.find((m) => m.id === t.assigneeId);
              const spent = spentByTask[t.id] ?? 0;
              const over = spent > t.estimatedHours;
              return (
                <tr key={t.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800 dark:text-slate-100">{t.title}</div>
                    {t.project && <div className="text-xs text-slate-400">{t.project}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <TaskTypeBadge type={t.type} />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={t.assigneeId ?? ''}
                      onChange={(e) => updateTask(t.id, { assigneeId: e.target.value || null })}
                      className="rounded-md border border-transparent bg-transparent px-1 py-1 text-xs hover:border-slate-200 dark:hover:border-slate-700 dark:text-slate-200"
                    >
                      <option value="">Non assigné</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    {member && <Avatar name={member.name} color={member.color} initials={member.initials} size={20} />}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={t.priority}
                      onChange={(e) => updateTask(t.id, { priority: e.target.value as Priority })}
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
                      onChange={(e) => updateTask(t.id, { status: e.target.value as TaskStatus })}
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
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => removeTask(t.id)}
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

      {showForm && (
        <NewTaskForm
          memberIds={members.map((m) => ({ id: m.id, name: m.name }))}
          onCancel={() => setShowForm(false)}
          onCreate={(payload) => {
            addTask(payload);
            setShowForm(false);
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

function NewTaskForm({
  memberIds,
  onCancel,
  onCreate,
}: {
  memberIds: { id: string; name: string }[];
  onCancel: () => void;
  onCreate: (payload: { title: string; type: TaskType; project?: string; assigneeId: string | null; status: TaskStatus; priority: Priority; estimatedHours: number; dueDate?: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TaskType>('Incident');
  const [project, setProject] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState<Priority>('normale');
  const [estimatedHours, setEstimatedHours] = useState('3.5');
  const [dueDate, setDueDate] = useState('');

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Nouvelle tâche</h3>
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
          <Field label="Assigné à">
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="input">
              <option value="">Non assigné</option>
              {memberIds.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Charge estimée (h)">
              <input type="number" step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} className="input" />
            </Field>
            <Field label="Échéance">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
            Annuler
          </button>
          <button
            disabled={!title.trim()}
            onClick={() =>
              onCreate({
                title: title.trim(),
                type,
                project: type === 'Projet' ? project || undefined : undefined,
                assigneeId: assigneeId || null,
                status: 'a_faire',
                priority,
                estimatedHours: parseFloat(estimatedHours) || 0,
                dueDate: dueDate || undefined,
              })
            }
            className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          >
            Créer
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
