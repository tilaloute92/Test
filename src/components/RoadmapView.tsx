import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { Avatar, Card, ModeSwitcher, PriorityBadge, PrintButton, PrintHeader, RoadmapDomainBadge, RoadmapStatusBadge } from './ui';
import { useConfirm } from './ConfirmProvider';
import { useViewMode } from '../hooks/useViewMode';
import type { Priority, ProjectTask, RoadmapDomain, RoadmapItem, RoadmapQuarter, RoadmapStatus, TeamMember } from '../types';

const FDR_VIEW_MODES = ['trimestres', 'liste', 'timeline'] as const;
type FdrViewMode = (typeof FDR_VIEW_MODES)[number];

type SortKey = 'title' | 'domain' | 'quarter' | 'status' | 'priority' | 'progress' | 'budget';
const QUARTER_ORDER: Record<RoadmapQuarter, number> = { T1: 1, T2: 2, T3: 3, T4: 4, annee: 0 };
const statusRagBg: Record<RoadmapStatus, string> = {
  idee: 'bg-slate-300 dark:bg-slate-600',
  planifie: 'bg-sky-400 dark:bg-sky-500',
  en_cours: 'bg-blue-500',
  termine: 'bg-emerald-500',
  reporte: 'bg-amber-500',
  abandonne: 'bg-slate-400 dark:bg-slate-500',
};

const DOMAINS: RoadmapDomain[] = ['Infrastructure', 'Réseau', 'Sécurité', 'Cloud', 'Poste de travail', 'Autre'];
const STATUSES: RoadmapStatus[] = ['idee', 'planifie', 'en_cours', 'termine', 'reporte', 'abandonne'];
const QUARTERS: { id: RoadmapQuarter; label: string; short: string }[] = [
  { id: 'T1', label: 'T1 — janv. à mars', short: 'T1' },
  { id: 'T2', label: 'T2 — avr. à juin', short: 'T2' },
  { id: 'T3', label: 'T3 — juil. à sept.', short: 'T3' },
  { id: 'T4', label: 'T4 — oct. à déc.', short: 'T4' },
  { id: 'annee', label: "Toute l'année", short: 'Année' },
];
const statusLabelMap: Record<string, string> = {
  Tous: 'Tous statuts',
  idee: 'Idée',
  planifie: 'Planifié',
  en_cours: 'En cours',
  termine: 'Terminé',
  reporte: 'Reporté',
  abandonne: 'Abandonné',
};

type ConfirmFn = ReturnType<typeof useConfirm>;

function csvEscape(v: string) {
  if (v.includes(';') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function RoadmapView() {
  const { members, tasks, roadmapItems, addRoadmapItem, updateRoadmapItem, removeRoadmapItem } = useStore();
  const confirm = useConfirm();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [domainFilter, setDomainFilter] = useState<RoadmapDomain | 'Tous'>('Tous');
  const [statusFilter, setStatusFilter] = useState<RoadmapStatus | 'Tous'>('Tous');
  const [ownerFilter, setOwnerFilter] = useState('Tous');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RoadmapItem | null>(null);
  const [mode, setMode] = useViewMode<FdrViewMode>('fdr', FDR_VIEW_MODES, 'trimestres');
  const [sortKey, setSortKey] = useState<SortKey>('quarter');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const yearItems = roadmapItems.filter((r) => r.year === year);
  const filtered = yearItems
    .filter((r) => domainFilter === 'Tous' || r.domain === domainFilter)
    .filter((r) => statusFilter === 'Tous' || r.status === statusFilter)
    .filter((r) => ownerFilter === 'Tous' || r.ownerIds.includes(ownerFilter));

  const stats = useMemo(() => {
    const byStatus = STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {} as Record<RoadmapStatus, number>);
    let budgetTotal = 0;
    let hasBudget = false;
    for (const r of yearItems) {
      byStatus[r.status]++;
      if (r.budgetEstimate != null) {
        budgetTotal += r.budgetEstimate;
        hasBudget = true;
      }
    }
    return { byStatus, budgetTotal, hasBudget };
  }, [yearItems]);

  const exportCsv = () => {
    const header = ['Titre', 'Domaine', 'Période', 'Statut', 'Priorité', 'Porteur(s)', 'Avancement (%)', 'Budget prévisionnel (€)', 'Description'];
    const rows = filtered.map((r) => {
      const owners = r.ownerIds
        .map((id) => members.find((m) => m.id === id)?.name)
        .filter((n): n is string => Boolean(n))
        .join(', ');
      const quarterLabel = QUARTERS.find((q) => q.id === r.quarter)?.short ?? r.quarter;
      return [
        r.title,
        r.domain,
        quarterLabel,
        statusLabelMap[r.status],
        r.priority,
        owners,
        String(r.progress),
        r.budgetEstimate != null ? String(r.budgetEstimate) : '',
        r.description ?? '',
      ];
    });
    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fdr_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doRemove = async (r: RoadmapItem) => {
    if (
      await confirm({
        title: "Supprimer l'initiative",
        message: `Supprimer définitivement "${r.title}" de la feuille de route ? Les tâches liées de l'onglet Tâches ne sont pas touchées.`,
        confirmLabel: 'Supprimer',
        danger: true,
      })
    ) {
      removeRoadmapItem(r.id);
    }
  };

  return (
    <div className="space-y-4">
      <PrintHeader title="Feuille de route (FDR)" subtitle={`Année ${year}${year === currentYear ? ' · en cours' : ''}`} />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Feuille de route (FDR)</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Initiatives stratégiques par trimestre, pour l'année en cours et les années suivantes — vision annuelle, à distinguer du planning
            opérationnel (3 semaines).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModeSwitcher
            value={mode}
            onChange={setMode}
            options={[
              { value: 'trimestres', label: 'Trimestres', title: 'Tableau par trimestre (vue par défaut)' },
              { value: 'liste', label: 'Liste triable', title: 'Liste plate, colonnes triables en cliquant sur l’en-tête' },
              { value: 'timeline', label: 'Timeline annuelle', title: "Vue chronologique de l'année, une ligne par initiative" },
            ]}
          />
          <PrintButton />
          <button onClick={exportCsv} className="btn-ghost">
            Exporter CSV
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            + Nouvelle initiative
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button onClick={() => setYear((y) => y - 1)} className="btn-ghost">
          ◀ {year - 1}
        </button>
        <div className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white">
          {year}
          {year === currentYear ? ' · année en cours' : ''}
        </div>
        <button onClick={() => setYear((y) => y + 1)} className="btn-ghost">
          {year + 1} ▶
        </button>
        {year !== currentYear && (
          <button onClick={() => setYear(currentYear)} className="text-xs text-violet-600 hover:underline dark:text-violet-400">
            Revenir à l'année en cours
          </button>
        )}
      </div>

      <Card className="flex flex-wrap items-center gap-x-4 gap-y-1.5 p-3 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {yearItems.length} initiative{yearItems.length > 1 ? 's' : ''} en {year}
        </span>
        {STATUSES.filter((s) => stats.byStatus[s] > 0).map((s) => (
          <span key={s} className="text-xs text-slate-500 dark:text-slate-400">
            {statusLabelMap[s]} : <strong className="text-slate-700 dark:text-slate-200">{stats.byStatus[s]}</strong>
          </span>
        ))}
        {stats.hasBudget && (
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            Budget prévisionnel cumulé :{' '}
            <strong className="text-slate-700 dark:text-slate-200">{stats.budgetTotal.toLocaleString('fr-FR')} €</strong>
          </span>
        )}
      </Card>

      <Card className="flex flex-wrap gap-2 p-3 print:hidden">
        <SimpleSelect value={domainFilter} onChange={setDomainFilter} options={['Tous', ...DOMAINS]} />
        <SimpleSelect value={statusFilter} onChange={setStatusFilter} options={['Tous', ...STATUSES]} labels={statusLabelMap} />
        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        >
          <option value="Tous">Tous les porteurs</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Card>

      {mode === 'trimestres' && (
        <div className="overflow-x-auto print:overflow-visible">
          <div className="grid min-w-[1200px] grid-cols-5 gap-3 print:min-w-0">
            {QUARTERS.map((q) => {
              const items = filtered.filter((r) => r.quarter === q.id);
              return (
                <div key={q.id} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400" title={q.label}>
                      {q.short}
                    </h2>
                    <span className="text-xs text-slate-300">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.length === 0 && (
                      <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-300 dark:border-slate-700">
                        —
                      </div>
                    )}
                    {items.map((r) => (
                      <RoadmapCard
                        key={r.id}
                        item={r}
                        members={members}
                        tasks={tasks}
                        onEdit={() => setEditing(r)}
                        onDelete={() => doRemove(r)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'liste' && (
        <RoadmapListView
          items={filtered}
          members={members}
          sortKey={sortKey}
          sortDir={sortDir}
          setSort={(key) => {
            if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
            else {
              setSortKey(key);
              setSortDir('asc');
            }
          }}
          onEdit={setEditing}
          onDelete={doRemove}
        />
      )}

      {mode === 'timeline' && <RoadmapTimeline items={filtered} members={members} onEdit={setEditing} />}

      {(showForm || editing) && (
        <RoadmapForm
          members={members}
          tasks={tasks}
          year={year}
          initial={editing}
          confirm={confirm}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onCreate={(payload) => {
            addRoadmapItem(payload);
            setShowForm(false);
          }}
          onUpdate={(id, patch) => {
            updateRoadmapItem(id, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function RoadmapCard({
  item,
  members,
  tasks,
  onEdit,
  onDelete,
}: {
  item: RoadmapItem;
  members: TeamMember[];
  tasks: ProjectTask[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const owners = item.ownerIds.map((id) => members.find((m) => m.id === id)).filter((m): m is TeamMember => Boolean(m));
  const linkedDone = item.linkedTaskIds.filter((id) => tasks.find((t) => t.id === id)?.status === 'termine').length;

  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <RoadmapDomainBadge domain={item.domain} />
        <div className="flex shrink-0 gap-1 print:hidden">
          <button onClick={onEdit} title="Modifier" className="text-xs text-slate-300 hover:text-violet-600 dark:hover:text-violet-400">
            ✎
          </button>
          <button onClick={onDelete} title="Supprimer" className="text-xs text-slate-300 hover:text-red-500">
            ✕
          </button>
        </div>
      </div>
      <button onClick={onEdit} className="block text-left text-sm font-medium leading-snug text-slate-800 hover:underline dark:text-slate-100">
        {item.title}
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <RoadmapStatusBadge status={item.status} />
        <PriorityBadge priority={item.priority} />
      </div>
      <div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(0, Math.min(item.progress, 100))}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
          <span>{item.progress}%</span>
          {item.linkedTaskIds.length > 0 && (
            <span>
              {linkedDone}/{item.linkedTaskIds.length} tâche(s) terminée(s)
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex -space-x-1.5">
          {owners.length === 0 ? (
            <span className="text-xs text-slate-400">Non attribué</span>
          ) : (
            owners.map((m) => <Avatar key={m.id} name={m.name} color={m.color} initials={m.initials} size={20} />)
          )}
        </div>
        {item.budgetEstimate != null && (
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.budgetEstimate.toLocaleString('fr-FR')} €</span>
        )}
      </div>
    </Card>
  );
}

/** Vue Liste triable : toutes les initiatives filtrées, un tableau plat dont on peut trier chaque colonne en cliquant sur son en-tête. */
function RoadmapListView({
  items,
  members,
  sortKey,
  sortDir,
  setSort,
  onEdit,
  onDelete,
}: {
  items: RoadmapItem[];
  members: TeamMember[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  setSort: (key: SortKey) => void;
  onEdit: (r: RoadmapItem) => void;
  onDelete: (r: RoadmapItem) => void;
}) {
  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      switch (sortKey) {
        case 'title':
          return a.title.localeCompare(b.title) * dir;
        case 'domain':
          return a.domain.localeCompare(b.domain) * dir;
        case 'quarter':
          return (QUARTER_ORDER[a.quarter] - QUARTER_ORDER[b.quarter] || a.title.localeCompare(b.title)) * dir;
        case 'status':
          return statusLabelMap[a.status].localeCompare(statusLabelMap[b.status]) * dir;
        case 'priority':
          return a.priority.localeCompare(b.priority) * dir;
        case 'progress':
          return (a.progress - b.progress) * dir;
        case 'budget':
          return ((a.budgetEstimate ?? -1) - (b.budgetEstimate ?? -1)) * dir;
        default:
          return 0;
      }
    });
  }, [items, sortKey, sortDir]);

  const columns: { key: SortKey; label: string }[] = [
    { key: 'title', label: 'Titre' },
    { key: 'domain', label: 'Domaine' },
    { key: 'quarter', label: 'Période' },
    { key: 'status', label: 'Statut' },
    { key: 'priority', label: 'Priorité' },
    { key: 'progress', label: 'Avancement' },
    { key: 'budget', label: 'Budget' },
  ];

  return (
    <Card className="overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[900px] text-sm print:min-w-0">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-400 dark:border-slate-800">
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 font-medium">
                <button onClick={() => setSort(c.key)} className="inline-flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-200">
                  {c.label}
                  {sortKey === c.key && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </button>
              </th>
            ))}
            <th className="px-3 py-2 font-medium">Porteur(s)</th>
            <th className="px-3 py-2 print:hidden" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const owners = r.ownerIds.map((id) => members.find((m) => m.id === id)).filter((m): m is TeamMember => Boolean(m));
            const quarterLabel = QUARTERS.find((q) => q.id === r.quarter)?.short ?? r.quarter;
            return (
              <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 dark:border-slate-800/60 dark:hover:bg-slate-800/30">
                <td className="px-3 py-2">
                  <button onClick={() => onEdit(r)} className="text-left font-medium text-slate-800 hover:underline dark:text-slate-100">
                    {r.title}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <RoadmapDomainBadge domain={r.domain} />
                </td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{quarterLabel}</td>
                <td className="px-3 py-2">
                  <RoadmapStatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2">
                  <PriorityBadge priority={r.priority} />
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">{r.progress}%</td>
                <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">
                  {r.budgetEstimate != null ? `${r.budgetEstimate.toLocaleString('fr-FR')} €` : '—'}
                </td>
                <td className="px-3 py-2">
                  {owners.length === 0 ? (
                    <span className="text-xs text-slate-400">Non attribué</span>
                  ) : (
                    <div className="flex -space-x-1.5">
                      {owners.map((m) => (
                        <Avatar key={m.id} name={m.name} color={m.color} initials={m.initials} size={20} />
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right print:hidden">
                  <button
                    onClick={() => onEdit(r)}
                    className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    Modifier
                  </button>
                  <button
                    onClick={() => onDelete(r)}
                    className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                  >
                    Suppr.
                  </button>
                </td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-400">
                Aucune initiative ne correspond aux filtres actuels.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

/** Vue Timeline annuelle : une ligne par initiative, positionnée sur l'axe T1→T4 (les initiatives "Toute l'année" couvrent les 4 colonnes). */
function RoadmapTimeline({ items, members, onEdit }: { items: RoadmapItem[]; members: TeamMember[]; onEdit: (r: RoadmapItem) => void }) {
  const sorted = useMemo(
    () => [...items].sort((a, b) => QUARTER_ORDER[a.quarter] - QUARTER_ORDER[b.quarter] || a.title.localeCompare(b.title)),
    [items]
  );

  if (sorted.length === 0) {
    return <Card className="p-6 text-center text-sm text-slate-400">Aucune initiative ne correspond aux filtres actuels.</Card>;
  }

  return (
    <Card className="overflow-x-auto p-3 print:overflow-visible">
      <div className="grid min-w-[800px] grid-cols-[200px_repeat(4,1fr)] items-center gap-y-1.5 print:min-w-0">
        <div />
        {QUARTERS.slice(0, 4).map((q) => (
          <div key={q.id} className="px-1 pb-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-400" title={q.label}>
            {q.short}
          </div>
        ))}

        {sorted.map((r) => {
          const owners = r.ownerIds.map((id) => members.find((m) => m.id === id)).filter((m): m is TeamMember => Boolean(m));
          const quarterIndex = r.quarter === 'annee' ? 0 : QUARTER_ORDER[r.quarter] - 1;
          const span = r.quarter === 'annee' ? 4 : 1;
          return (
            <div key={r.id} className="contents">
              <div
                style={{ gridColumn: '1' }}
                className="flex min-w-0 items-center gap-1.5 truncate py-1 pr-2 text-xs text-slate-600 dark:text-slate-300"
              >
                {owners.slice(0, 2).map((m) => (
                  <Avatar key={m.id} name={m.name} color={m.color} initials={m.initials} size={16} />
                ))}
                <span className="truncate">{r.title}</span>
              </div>
              <button
                onClick={() => onEdit(r)}
                style={{ gridColumn: `${2 + quarterIndex} / span ${span}` }}
                title={`${r.title} — ${statusLabelMap[r.status]} · ${r.progress}%`}
                className={`mx-0.5 flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-left text-[11px] font-medium text-white hover:opacity-90 ${statusRagBg[r.status]}`}
              >
                <span className="truncate">
                  {r.title} · {r.progress}%
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 print:hidden">
        {STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${statusRagBg[s]}`} /> {statusLabelMap[s]}
          </span>
        ))}
      </div>
    </Card>
  );
}

function SimpleSelect<T extends string>({
  value,
  onChange,
  options,
  labels,
}: {
  value: T;
  onChange: (v: T) => void;
  options: T[];
  labels?: Record<string, string>;
}) {
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

function RoadmapForm({
  members,
  tasks,
  year,
  initial,
  confirm,
  onCancel,
  onCreate,
  onUpdate,
}: {
  members: TeamMember[];
  tasks: ProjectTask[];
  year: number;
  initial: RoadmapItem | null;
  confirm: ConfirmFn;
  onCancel: () => void;
  onCreate: (payload: Omit<RoadmapItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdate: (id: string, patch: Partial<RoadmapItem>) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [domain, setDomain] = useState<RoadmapDomain>(initial?.domain ?? 'Infrastructure');
  const [itemYear, setItemYear] = useState(initial?.year ?? year);
  const [quarter, setQuarter] = useState<RoadmapQuarter>(initial?.quarter ?? 'T1');
  const [status, setStatus] = useState<RoadmapStatus>(initial?.status ?? 'idee');
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'normale');
  const [ownerIds, setOwnerIds] = useState<string[]>(initial?.ownerIds ?? []);
  const [progress, setProgress] = useState(String(initial?.progress ?? 0));
  const [budget, setBudget] = useState(initial?.budgetEstimate != null ? String(initial.budgetEstimate) : '');
  const [linkedTaskIds, setLinkedTaskIds] = useState<string[]>(initial?.linkedTaskIds ?? []);

  const toggleOwner = (id: string) => setOwnerIds((prev) => (prev.includes(id) ? prev.filter((o) => o !== id) : [...prev, id]));
  const toggleLinked = (id: string) => setLinkedTaskIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const projectTasks = tasks.filter((t) => t.type === 'Projet');

  const submit = async () => {
    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      domain,
      year: itemYear,
      quarter,
      status,
      priority,
      ownerIds,
      progress: Math.max(0, Math.min(100, parseInt(progress, 10) || 0)),
      budgetEstimate: budget.trim() ? parseFloat(budget) : undefined,
      linkedTaskIds,
    };
    if (initial) {
      if (await confirm({ title: 'Confirmer la modification', message: `Enregistrer les modifications de "${initial.title}" ?` })) {
        onUpdate(initial.id, payload);
      }
    } else {
      onCreate(payload);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{initial ? "Modifier l'initiative" : 'Nouvelle initiative'}</h3>
          {initial?.updatedBy && (
            <p className="mt-0.5 text-xs text-slate-400">
              Dernière modification par {initial.updatedBy}, le {new Date(initial.updatedAt).toLocaleString('fr-FR')}
            </p>
          )}
        </div>
        <div className="space-y-2.5">
          <Field label="Titre">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Ex : Migration vers Windows Server 2025" />
          </Field>
          <Field label="Description (optionnel)">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Domaine">
              <select value={domain} onChange={(e) => setDomain(e.target.value as RoadmapDomain)} className="input">
                {DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
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
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Année">
              <input type="number" value={itemYear} onChange={(e) => setItemYear(parseInt(e.target.value, 10) || year)} className="input" />
            </Field>
            <Field label="Période">
              <select value={quarter} onChange={(e) => setQuarter(e.target.value as RoadmapQuarter)} className="input">
                {QUARTERS.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Statut">
            <select value={status} onChange={(e) => setStatus(e.target.value as RoadmapStatus)} className="input">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabelMap[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Porteur(s) — optionnel">
            <div className="flex max-h-28 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-700">
              {members.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input type="checkbox" checked={ownerIds.includes(m.id)} onChange={() => toggleOwner(m.id)} />
                  <Avatar name={m.name} color={m.color} initials={m.initials} size={18} />
                  <span className="truncate text-slate-700 dark:text-slate-200">{m.name}</span>
                </label>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Avancement (%)">
              <input type="number" min={0} max={100} value={progress} onChange={(e) => setProgress(e.target.value)} className="input" />
            </Field>
            <Field label="Budget prévisionnel (€, optionnel)">
              <input type="number" min={0} step="100" value={budget} onChange={(e) => setBudget(e.target.value)} className="input" placeholder="Ex : 15000" />
            </Field>
          </div>
          {projectTasks.length > 0 && (
            <Field label="Tâches liées de l'onglet Tâches (optionnel)">
              <div className="flex max-h-28 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-700">
                {projectTasks.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={linkedTaskIds.includes(t.id)} onChange={() => toggleLinked(t.id)} />
                    <span className="truncate text-slate-700 dark:text-slate-200">
                      {t.title}
                      {t.project ? ` — ${t.project}` : ''}
                    </span>
                  </label>
                ))}
              </div>
              <span className="mt-1 block text-xs text-slate-400">Sert uniquement de lien de traçabilité ; l'avancement ci-dessus reste saisi à la main.</span>
            </Field>
          )}
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
