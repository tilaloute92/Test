import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { useConfirm } from './ConfirmProvider';
import { useViewMode } from '../hooks/useViewMode';
import { toISODate } from '../lib/date';
import {
  agendaDuration,
  buildCopilMarkdown,
  computeCopilStats,
  COPIL_ACTION_STATUS_LABELS,
  COPIL_STATUS_LABELS,
  daysUntil,
  formatCopilDate,
  isActionOpen,
  memberNamesOf,
  nextCopil,
  allActions,
} from '../lib/copil';
import { exportCopilPptx } from '../lib/copilPptx';
import { Avatar, Card, ModeSwitcher, PrintButton, PrintHeader, RoadmapDomainBadge, StatusBadge } from './ui';
import type { Copil, CopilAction, CopilStatus, RoadmapItem, TaskStatus, TeamMember } from '../types';

const COPIL_VIEW_MODES = ['seances', 'actions', 'calendrier'] as const;
type CopilViewMode = (typeof COPIL_VIEW_MODES)[number];

type ConfirmFn = ReturnType<typeof useConfirm>;

const statusStyles: Record<CopilStatus, string> = {
  planifie: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  tenu: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  // Ardoise plutôt que rouge : une séance annulée est un état clos et neutre, pas une alerte
  // à traiter — même convention que "Abandonné" côté FDR (voir la note de couleurs dans ui.tsx).
  annule: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
};

function CopilStatusBadge({ status }: { status: CopilStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[status]}`}>{COPIL_STATUS_LABELS[status]}</span>;
}

let localIdCounter = 1;
const localId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${localIdCounter++}`;

export function CopilView() {
  const { members, roadmapItems, copils, addCopil, updateCopil, removeCopil } = useStore();
  const confirm = useConfirm();
  const [mode, setMode] = useViewMode<CopilViewMode>('copils', COPIL_VIEW_MODES, 'seances');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Copil | null>(null);
  const [copied, setCopied] = useState(false);
  const [pptxBusy, setPptxBusy] = useState(false);
  const [pptxError, setPptxError] = useState<string | null>(null);

  const sorted = useMemo(() => [...copils].sort((a, b) => b.date.localeCompare(a.date)), [copils]);
  const stats = useMemo(() => computeCopilStats(copils), [copils]);
  // Par défaut on ouvre la prochaine séance à venir (celle qu'on prépare), pas la plus
  // lointaine dans le futur ni la plus ancienne : c'est celle sur laquelle on travaille.
  const selected = sorted.find((c) => c.id === selectedId) ?? nextCopil(copils) ?? sorted[0];

  const doRemove = async (c: Copil) => {
    if (
      await confirm({
        title: 'Supprimer la séance',
        message: `Supprimer définitivement "${c.title}" ? Son ordre du jour, ses décisions et son relevé d'actions seront perdus. Les initiatives FDR liées ne sont pas touchées.`,
        confirmLabel: 'Supprimer',
        danger: true,
      })
    ) {
      removeCopil(c.id);
      if (selectedId === c.id) setSelectedId(null);
    }
  };

  const copyMarkdown = async (c: Copil) => {
    try {
      await navigator.clipboard.writeText(buildCopilMarkdown(c, members, roadmapItems));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé par le navigateur (contexte non sécurisé, permission) : on
      // n'affiche simplement pas la confirmation plutôt que de faire planter la page.
    }
  };

  const exportPptx = async (c: Copil) => {
    setPptxError(null);
    setPptxBusy(true);
    try {
      await exportCopilPptx({ copil: c, members, roadmapItems });
    } catch (err) {
      setPptxError(err instanceof Error ? err.message : String(err));
    } finally {
      setPptxBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PrintHeader title="COPIL — comités de pilotage" subtitle={`${copils.length} séance(s)`} />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">COPIL — comités de pilotage</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Les séances de gouvernance avec les parties prenantes : ordre du jour, décisions actées et relevé d'actions suivi d'une séance à
            l'autre — à distinguer de la FDR (le quoi sur l'année) et du planning (le qui fait quoi sur la semaine).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModeSwitcher
            value={mode}
            onChange={setMode}
            options={[
              { value: 'seances', label: 'Séances', title: 'Liste des séances et détail complet de celle sélectionnée' },
              { value: 'actions', label: 'Actions', title: 'Toutes les actions de toutes les séances, pour le suivi transverse' },
              { value: 'calendrier', label: 'Calendrier', title: 'Les séances dans l’ordre chronologique, passé et à venir' },
            ]}
          />
          <PrintButton />
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            + Nouvelle séance
          </button>
        </div>
      </div>

      <Card className="flex flex-wrap items-center gap-x-4 gap-y-1.5 p-3 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {stats.total} séance{stats.total > 1 ? 's' : ''}
        </span>
        {(['planifie', 'tenu', 'annule'] as CopilStatus[])
          .filter((s) => stats.byStatus[s] > 0)
          .map((s) => (
            <span key={s} className="text-xs text-slate-500 dark:text-slate-400">
              {COPIL_STATUS_LABELS[s]} : <strong className="text-slate-700 dark:text-slate-200">{stats.byStatus[s]}</strong>
            </span>
          ))}
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Actions ouvertes : <strong className="text-slate-700 dark:text-slate-200">{stats.openActions}</strong>
        </span>
        {stats.overdueActions > 0 && (
          <span className="text-xs font-medium text-red-600 dark:text-red-400">{stats.overdueActions} action(s) en retard</span>
        )}
        {stats.next && (
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            Prochaine séance : <strong className="text-slate-700 dark:text-slate-200">{formatCopilDate(stats.next.date)}</strong>{' '}
            (dans {daysUntil(stats.next.date)} jour{daysUntil(stats.next.date) > 1 ? 's' : ''})
          </span>
        )}
      </Card>

      {pptxError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 print:hidden dark:bg-red-500/10 dark:text-red-300">
          Échec de la génération du PowerPoint : {pptxError}
        </p>
      )}

      {copils.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-400">
          Aucune séance enregistrée. Créez la première avec « + Nouvelle séance ».
        </Card>
      ) : (
        <>
          {mode === 'seances' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
              <Card className="max-h-[70vh] overflow-y-auto p-2 print:hidden">
                {sorted.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`mb-1 flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      selected?.id === c.id
                        ? 'bg-violet-50 dark:bg-violet-500/10'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <span className="line-clamp-2 text-sm font-medium text-slate-800 dark:text-slate-100">{c.title}</span>
                    <span className="flex items-center gap-2 text-xs text-slate-400">
                      {c.date}
                      <CopilStatusBadge status={c.status} />
                    </span>
                    {c.actions.filter(isActionOpen).length > 0 && (
                      <span className="text-[11px] text-slate-400">{c.actions.filter(isActionOpen).length} action(s) ouverte(s)</span>
                    )}
                  </button>
                ))}
              </Card>

              {selected && (
                <CopilDetail
                  copil={selected}
                  members={members}
                  roadmapItems={roadmapItems}
                  confirm={confirm}
                  updateCopil={updateCopil}
                  onEdit={() => setEditing(selected)}
                  onDelete={() => doRemove(selected)}
                  onCopy={() => copyMarkdown(selected)}
                  onExportPptx={() => exportPptx(selected)}
                  copied={copied}
                  pptxBusy={pptxBusy}
                />
              )}
            </div>
          )}

          {mode === 'actions' && (
            <ActionsTracker copils={sorted} members={members} confirm={confirm} updateCopil={updateCopil} onOpenCopil={(id) => { setSelectedId(id); setMode('seances'); }} />
          )}

          {mode === 'calendrier' && <CopilCalendar copils={copils} members={members} onOpenCopil={(id) => { setSelectedId(id); setMode('seances'); }} />}
        </>
      )}

      {(showForm || editing) && (
        <CopilForm
          members={members}
          roadmapItems={roadmapItems}
          initial={editing}
          confirm={confirm}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onCreate={(payload) => {
            const id = addCopil(payload);
            setSelectedId(id);
            setShowForm(false);
          }}
          onUpdate={(id, patch) => {
            updateCopil(id, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Détail d'une séance : ordre du jour, FDR passée en revue, décisions, actions, notes.
// Tout est modifiable ici (ajout/suppression d'un point, d'une décision, d'une action) —
// chaque modification d'un élément existant passe par une confirmation, comme partout
// ailleurs dans l'application ; les ajouts, eux, sont explicites et n'en demandent pas.
// ---------------------------------------------------------------------------------------
function CopilDetail({
  copil,
  members,
  roadmapItems,
  confirm,
  updateCopil,
  onEdit,
  onDelete,
  onCopy,
  onExportPptx,
  copied,
  pptxBusy,
}: {
  copil: Copil;
  members: TeamMember[];
  roadmapItems: RoadmapItem[];
  confirm: ConfirmFn;
  updateCopil: (id: string, patch: Partial<Copil>) => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onExportPptx: () => void;
  copied: boolean;
  pptxBusy: boolean;
}) {
  const [newAgenda, setNewAgenda] = useState('');
  const [newDecision, setNewDecision] = useState('');
  const [newAction, setNewAction] = useState('');
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  const participants = copil.participantIds.map((id) => members.find((m) => m.id === id)).filter((m): m is TeamMember => Boolean(m));
  const reviewed = copil.roadmapItemIds.map((id) => roadmapItems.find((r) => r.id === id)).filter((r): r is RoadmapItem => Boolean(r));
  const totalDuration = agendaDuration(copil);

  const addAgendaItem = () => {
    const label = newAgenda.trim();
    if (!label) return;
    updateCopil(copil.id, { agenda: [...copil.agenda, { id: localId('cpa'), label }] });
    setNewAgenda('');
  };

  const removeAgendaItem = async (itemId: string, label: string) => {
    if (await confirm({ title: 'Supprimer le point', message: `Retirer "${label}" de l'ordre du jour ?`, confirmLabel: 'Supprimer', danger: true })) {
      updateCopil(copil.id, { agenda: copil.agenda.filter((a) => a.id !== itemId) });
    }
  };

  const addDecision = () => {
    const label = newDecision.trim();
    if (!label) return;
    updateCopil(copil.id, { decisions: [...copil.decisions, { id: localId('cpd'), label }] });
    setNewDecision('');
  };

  const removeDecision = async (itemId: string, label: string) => {
    if (await confirm({ title: 'Supprimer la décision', message: `Supprimer "${label}" du relevé de décisions ?`, confirmLabel: 'Supprimer', danger: true })) {
      updateCopil(copil.id, { decisions: copil.decisions.filter((d) => d.id !== itemId) });
    }
  };

  const addAction = () => {
    const label = newAction.trim();
    if (!label) return;
    updateCopil(copil.id, { actions: [...copil.actions, { id: localId('cpac'), label, ownerIds: [], status: 'a_faire' }] });
    setNewAction('');
  };

  const patchAction = async (action: CopilAction, patch: Partial<CopilAction>, message: string) => {
    if (await confirm({ title: 'Confirmer la modification', message })) {
      updateCopil(copil.id, { actions: copil.actions.map((a) => (a.id === action.id ? { ...a, ...patch } : a)) });
    }
  };

  const removeAction = async (action: CopilAction) => {
    if (await confirm({ title: "Supprimer l'action", message: `Supprimer définitivement "${action.label}" ?`, confirmLabel: 'Supprimer', danger: true })) {
      updateCopil(copil.id, { actions: copil.actions.filter((a) => a.id !== action.id) });
    }
  };

  const saveNotes = async () => {
    if (notesDraft === null) return;
    const hadNotes = Boolean(copil.notes);
    if (!hadNotes || (await confirm({ title: 'Confirmer la modification', message: 'Enregistrer les notes de séance modifiées ?' }))) {
      updateCopil(copil.id, { notes: notesDraft.trim() || undefined });
      setNotesDraft(null);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">{copil.title}</h2>
              <CopilStatusBadge status={copil.status} />
            </div>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {formatCopilDate(copil.date)}
              {copil.time ? ` à ${copil.time}` : ''}
              {copil.location ? ` · ${copil.location}` : ''}
            </p>
            {copil.updatedBy && (
              <p className="mt-0.5 text-xs text-slate-400">
                Dernière modification par {copil.updatedBy}, le {new Date(copil.updatedAt).toLocaleString('fr-FR')}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button onClick={onCopy} className="btn-ghost">
              {copied ? 'Copié ✓' : 'Copier le compte-rendu'}
            </button>
            <button onClick={onExportPptx} disabled={pptxBusy} className="btn-ghost disabled:opacity-40">
              {pptxBusy ? 'Génération…' : 'Exporter PowerPoint'}
            </button>
            <button onClick={onEdit} className="btn-ghost">
              Modifier
            </button>
            <button
              onClick={onDelete}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
            >
              Supprimer
            </button>
          </div>
        </div>

        {(participants.length > 0 || copil.externalParticipants.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Participants</span>
            {participants.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2 text-xs dark:bg-slate-800">
                <Avatar name={m.name} color={m.color} initials={m.initials} size={18} />
                <span className="text-slate-700 dark:text-slate-200">{m.name}</span>
              </span>
            ))}
            {copil.externalParticipants.map((name) => (
              <span
                key={name}
                title="Participant extérieur à l'équipe"
                className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Ordre du jour</h3>
          {totalDuration !== undefined && <span className="text-xs text-slate-400">{totalDuration} min au total</span>}
        </div>
        {copil.agenda.length === 0 ? (
          <p className="text-xs text-slate-400">
            Ordre du jour vide — une séance sans ordre du jour préparé est le meilleur moyen de la perdre.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {copil.agenda.map((point, i) => (
              <li key={point.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-5 shrink-0 text-xs text-slate-400">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-100">{point.label}</span>
                {point.presenterId && (
                  <span className="text-xs text-slate-400">{members.find((m) => m.id === point.presenterId)?.name}</span>
                )}
                {point.durationMin && <span className="text-xs text-slate-400">{point.durationMin} min</span>}
                <button
                  onClick={() => removeAgendaItem(point.id, point.label)}
                  className="rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-red-50 hover:text-red-600 print:hidden dark:hover:bg-red-500/10"
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}
        <InlineAdd
          value={newAgenda}
          onChange={setNewAgenda}
          onSubmit={addAgendaItem}
          placeholder="Ajouter un point à l'ordre du jour…"
        />
      </Card>

      {reviewed.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Feuille de route passée en revue</h3>
          <ul className="space-y-1.5">
            {reviewed.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <RoadmapDomainBadge domain={r.domain} />
                <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-100">{r.title}</span>
                <span className="text-xs text-slate-400">
                  {r.quarter} {r.year}
                </span>
                <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(0, Math.min(r.progress, 100))}%` }} />
                </div>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{r.progress}%</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Décisions</h3>
        {copil.decisions.length === 0 ? (
          <p className="text-xs text-slate-400">Aucune décision actée pour cette séance.</p>
        ) : (
          <ul className="space-y-1.5">
            {copil.decisions.map((d) => (
              <li key={d.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-slate-800 dark:text-slate-100">{d.label}</div>
                  {d.detail && <div className="text-xs text-slate-400">{d.detail}</div>}
                </div>
                <button
                  onClick={() => removeDecision(d.id, d.label)}
                  className="rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-red-50 hover:text-red-600 print:hidden dark:hover:bg-red-500/10"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <InlineAdd value={newDecision} onChange={setNewDecision} onSubmit={addDecision} placeholder="Acter une décision…" />
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Relevé de décisions — actions</h3>
        {copil.actions.length === 0 ? (
          <p className="text-xs text-slate-400">Aucune action enregistrée pour cette séance.</p>
        ) : (
          <div className="space-y-2">
            {copil.actions.map((a) => (
              <ActionRow key={a.id} action={a} members={members} onPatch={patchAction} onRemove={() => removeAction(a)} />
            ))}
          </div>
        )}
        <InlineAdd value={newAction} onChange={setNewAction} onSubmit={addAction} placeholder="Ajouter une action…" />
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Notes de séance</h3>
        {notesDraft === null ? (
          <>
            {copil.notes ? (
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{copil.notes}</p>
            ) : (
              <p className="text-xs text-slate-400">Aucune note.</p>
            )}
            <button onClick={() => setNotesDraft(copil.notes ?? '')} className="btn-ghost mt-2 print:hidden">
              {copil.notes ? 'Modifier les notes' : 'Ajouter des notes'}
            </button>
          </>
        ) : (
          <div className="print:hidden">
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={4}
              className="input w-full"
              placeholder="Ce qui s'est dit, les points de vigilance, les demandes des parties prenantes…"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => setNotesDraft(null)} className="btn-ghost">
                Annuler
              </button>
              <button onClick={saveNotes} className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
                Enregistrer
              </button>
            </div>
          </div>
        )}
        {copil.nextDate && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Prochaine séance prévue : <strong className="text-slate-700 dark:text-slate-200">{formatCopilDate(copil.nextDate)}</strong>
          </p>
        )}
      </Card>
    </div>
  );
}

function ActionRow({
  action,
  members,
  onPatch,
  onRemove,
  copilTitle,
  onOpenCopil,
}: {
  action: CopilAction;
  members: TeamMember[];
  onPatch: (action: CopilAction, patch: Partial<CopilAction>, message: string) => void;
  onRemove: () => void;
  copilTitle?: string;
  onOpenCopil?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const owners = action.ownerIds.map((id) => members.find((m) => m.id === id)).filter((m): m is TeamMember => Boolean(m));
  const overdue = action.dueDate && isActionOpen(action) && action.dueDate < toISODate(new Date());

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm ${
        overdue ? 'border-red-200 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/10' : 'border-slate-100 dark:border-slate-800'
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-100">{action.label}</span>

      {copilTitle && onOpenCopil && (
        <button onClick={onOpenCopil} className="truncate text-xs text-violet-600 hover:underline dark:text-violet-400 print:hidden">
          {copilTitle}
        </button>
      )}

      <div className="relative print:hidden">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-md border border-transparent px-1 py-1 hover:border-slate-200 dark:hover:border-slate-700"
        >
          {owners.length === 0 ? (
            <span className="text-xs text-slate-400">Non attribuée</span>
          ) : (
            <div className="flex -space-x-1.5">
              {owners.slice(0, 3).map((m) => (
                <Avatar key={m.id} name={m.name} color={m.color} initials={m.initials} size={20} />
              ))}
            </div>
          )}
          <span className="text-xs text-slate-400">▾</span>
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {members.map((m) => {
                const has = action.ownerIds.includes(m.id);
                return (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                    <input
                      type="checkbox"
                      checked={has}
                      onChange={() =>
                        onPatch(
                          action,
                          { ownerIds: has ? action.ownerIds.filter((o) => o !== m.id) : [...action.ownerIds, m.id] },
                          has ? `Retirer ${m.name} de l'action "${action.label}" ?` : `Ajouter ${m.name} à l'action "${action.label}" ?`
                        )
                      }
                    />
                    <Avatar name={m.name} color={m.color} initials={m.initials} size={18} />
                    <span className="truncate text-slate-700 dark:text-slate-200">{m.name}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Version imprimable des responsables (le menu déroulant est masqué à l'impression) */}
      <span className="hidden text-xs text-slate-500 print:inline">{memberNamesOf(action.ownerIds, members)}</span>

      <input
        type="date"
        value={action.dueDate ?? ''}
        onChange={(e) => onPatch(action, { dueDate: e.target.value || undefined }, `Changer l'échéance de "${action.label}" ?`)}
        className={`rounded-md border border-transparent bg-transparent px-1 py-1 text-xs hover:border-slate-200 dark:hover:border-slate-700 print:hidden ${
          overdue ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'
        }`}
      />
      <span className="hidden text-xs text-slate-500 print:inline">{action.dueDate ?? '—'}</span>

      <select
        value={action.status}
        onChange={(e) => onPatch(action, { status: e.target.value as TaskStatus }, `Changer le statut de "${action.label}" ?`)}
        className="rounded-md border border-transparent bg-transparent px-1 py-1 text-xs hover:border-slate-200 dark:hover:border-slate-700 print:hidden"
      >
        {(Object.keys(COPIL_ACTION_STATUS_LABELS) as TaskStatus[]).map((s) => (
          <option key={s} value={s}>
            {COPIL_ACTION_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <span className="hidden print:inline">
        <StatusBadge status={action.status} />
      </span>

      <button
        onClick={onRemove}
        className="rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-red-50 hover:text-red-600 print:hidden dark:hover:bg-red-500/10"
      >
        ✕
      </button>
    </div>
  );
}

function InlineAdd({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  return (
    <div className="mt-2 flex gap-2 print:hidden">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
        placeholder={placeholder}
        className="input flex-1"
      />
      <button
        onClick={onSubmit}
        disabled={!value.trim()}
        className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        Ajouter
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Mode "Actions" : toutes les actions de toutes les séances au même endroit. C'est la vue
// qui répond à "qu'est-ce qu'on s'était engagé à faire, et où en est-on ?" — sans avoir à
// rouvrir chaque compte-rendu un par un.
// ---------------------------------------------------------------------------------------
function ActionsTracker({
  copils,
  members,
  confirm,
  updateCopil,
  onOpenCopil,
}: {
  copils: Copil[];
  members: TeamMember[];
  confirm: ConfirmFn;
  updateCopil: (id: string, patch: Partial<Copil>) => void;
  onOpenCopil: (id: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'ouvertes' | 'Toutes'>('ouvertes');
  const [ownerFilter, setOwnerFilter] = useState('Tous');

  const refs = useMemo(() => {
    const todayIso = toISODate(new Date());
    return allActions(copils)
      .filter(({ action }) => {
        if (statusFilter === 'Toutes') return true;
        if (statusFilter === 'ouvertes') return isActionOpen(action);
        return action.status === statusFilter;
      })
      .filter(({ action }) => ownerFilter === 'Tous' || action.ownerIds.includes(ownerFilter))
      .sort((a, b) => {
        // Les actions en retard remontent en tête, puis les échéances les plus proches ;
        // celles sans échéance ferment la marche.
        const aOver = a.action.dueDate && isActionOpen(a.action) && a.action.dueDate < todayIso ? 0 : 1;
        const bOver = b.action.dueDate && isActionOpen(b.action) && b.action.dueDate < todayIso ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        return (a.action.dueDate ?? '9999').localeCompare(b.action.dueDate ?? '9999');
      });
  }, [copils, statusFilter, ownerFilter]);

  const patchAction = async (copilId: string, action: CopilAction, patch: Partial<CopilAction>, message: string) => {
    if (await confirm({ title: 'Confirmer la modification', message })) {
      const copil = copils.find((c) => c.id === copilId);
      if (!copil) return;
      updateCopil(copilId, { actions: copil.actions.map((a) => (a.id === action.id ? { ...a, ...patch } : a)) });
    }
  };

  const removeAction = async (copilId: string, action: CopilAction) => {
    if (await confirm({ title: "Supprimer l'action", message: `Supprimer définitivement "${action.label}" ?`, confirmLabel: 'Supprimer', danger: true })) {
      const copil = copils.find((c) => c.id === copilId);
      if (!copil) return;
      updateCopil(copilId, { actions: copil.actions.filter((a) => a.id !== action.id) });
    }
  };

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap gap-2 p-3 print:hidden">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TaskStatus | 'ouvertes' | 'Toutes')}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        >
          <option value="ouvertes">Actions ouvertes</option>
          <option value="Toutes">Toutes les actions</option>
          {(Object.keys(COPIL_ACTION_STATUS_LABELS) as TaskStatus[]).map((s) => (
            <option key={s} value={s}>
              {COPIL_ACTION_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        >
          <option value="Tous">Tous les responsables</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="ml-auto self-center text-xs text-slate-400">{refs.length} action(s)</span>
      </Card>

      {refs.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-400">Aucune action ne correspond à ces filtres.</Card>
      ) : (
        <Card className="space-y-2 p-3">
          {refs.map(({ copil, action }) => (
            <ActionRow
              key={`${copil.id}-${action.id}`}
              action={action}
              members={members}
              copilTitle={copil.title}
              onOpenCopil={() => onOpenCopil(copil.id)}
              onPatch={(a, patch, message) => patchAction(copil.id, a, patch, message)}
              onRemove={() => removeAction(copil.id, action)}
            />
          ))}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Mode "Calendrier" : les séances dans l'ordre chronologique, séparées entre à venir et
// passées — la lecture "où en est le cycle de gouvernance ?" plutôt que "que contient telle
// séance ?".
// ---------------------------------------------------------------------------------------
function CopilCalendar({ copils, members, onOpenCopil }: { copils: Copil[]; members: TeamMember[]; onOpenCopil: (id: string) => void }) {
  const todayIso = toISODate(new Date());
  const upcoming = copils.filter((c) => c.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date));
  const past = copils.filter((c) => c.date < todayIso).sort((a, b) => b.date.localeCompare(a.date));

  const section = (title: string, items: Copil[], emptyLabel: string) => (
    <Card className="p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-slate-300 dark:text-slate-600">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {items.map((c) => {
            const openCount = c.actions.filter(isActionOpen).length;
            const days = daysUntil(c.date);
            return (
              <button
                key={c.id}
                onClick={() => onOpenCopil(c.id)}
                className="flex w-full flex-wrap items-center gap-2.5 rounded-lg border border-slate-100 p-2.5 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
              >
                <span className="w-28 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{c.date}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.title}</span>
                <CopilStatusBadge status={c.status} />
                {c.status === 'planifie' && days >= 0 && (
                  <span className="text-xs text-slate-400">dans {days} jour{days > 1 ? 's' : ''}</span>
                )}
                {c.agenda.length === 0 && c.status === 'planifie' && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                    ordre du jour à préparer
                  </span>
                )}
                {openCount > 0 && <span className="text-xs text-slate-400">{openCount} action(s) ouverte(s)</span>}
                <div className="flex -space-x-1.5">
                  {c.participantIds
                    .map((id) => members.find((m) => m.id === id))
                    .filter((m): m is TeamMember => Boolean(m))
                    .slice(0, 4)
                    .map((m) => (
                      <Avatar key={m.id} name={m.name} color={m.color} initials={m.initials} size={18} />
                    ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-3">
      {section('À venir', upcoming, 'Aucune séance planifiée — pensez à fixer la prochaine.')}
      {section('Séances passées', past, 'Aucune séance passée.')}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Formulaire de création / modification d'une séance.
// ---------------------------------------------------------------------------------------
type CopilFormPayload = Omit<Copil, 'id' | 'createdAt' | 'updatedAt'>;

function CopilForm({
  members,
  roadmapItems,
  initial,
  confirm,
  onCancel,
  onCreate,
  onUpdate,
}: {
  members: TeamMember[];
  roadmapItems: RoadmapItem[];
  initial: Copil | null;
  confirm: ConfirmFn;
  onCancel: () => void;
  onCreate: (payload: CopilFormPayload) => void;
  onUpdate: (id: string, patch: Partial<Copil>) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? 'COPIL Infrastructure & Réseau');
  const [date, setDate] = useState(initial?.date ?? toISODate(new Date()));
  const [time, setTime] = useState(initial?.time ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [status, setStatus] = useState<CopilStatus>(initial?.status ?? 'planifie');
  const [participantIds, setParticipantIds] = useState<string[]>(initial?.participantIds ?? []);
  const [externals, setExternals] = useState(initial?.externalParticipants.join(', ') ?? '');
  const [roadmapItemIds, setRoadmapItemIds] = useState<string[]>(initial?.roadmapItemIds ?? []);
  const [nextDate, setNextDate] = useState(initial?.nextDate ?? '');

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const submit = async () => {
    const payload: CopilFormPayload = {
      title: title.trim(),
      date,
      time: time.trim() || undefined,
      location: location.trim() || undefined,
      status,
      participantIds,
      externalParticipants: externals
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      agenda: initial?.agenda ?? [],
      decisions: initial?.decisions ?? [],
      actions: initial?.actions ?? [],
      roadmapItemIds,
      notes: initial?.notes,
      nextDate: nextDate || undefined,
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
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{initial ? 'Modifier la séance' : 'Nouvelle séance de COPIL'}</h3>
          {initial?.updatedBy && (
            <p className="mt-0.5 text-xs text-slate-400">
              Dernière modification par {initial.updatedBy}, le {new Date(initial.updatedAt).toLocaleString('fr-FR')}
            </p>
          )}
        </div>
        <div className="space-y-2.5">
          <Field label="Intitulé">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Ex : COPIL Infrastructure & Réseau — T3" />
          </Field>
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
            </Field>
            <Field label="Heure">
              <input value={time} onChange={(e) => setTime(e.target.value)} className="input" placeholder="14:00" />
            </Field>
            <Field label="Statut">
              <select value={status} onChange={(e) => setStatus(e.target.value as CopilStatus)} className="input">
                {(Object.keys(COPIL_STATUS_LABELS) as CopilStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {COPIL_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Lieu / visio (optionnel)">
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="input" placeholder="Ex : Salle Mercure + Teams" />
          </Field>
          <Field label="Participants de l'équipe">
            <div className="flex max-h-28 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-700">
              {members.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input type="checkbox" checked={participantIds.includes(m.id)} onChange={() => setParticipantIds((p) => toggle(p, m.id))} />
                  <Avatar name={m.name} color={m.color} initials={m.initials} size={18} />
                  <span className="truncate text-slate-700 dark:text-slate-200">{m.name}</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Participants extérieurs (séparés par des virgules)">
            <input
              value={externals}
              onChange={(e) => setExternals(e.target.value)}
              className="input"
              placeholder="Ex : Direction des systèmes d'information, Responsable métier"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Ces personnes n'ont pas de fiche dans l'onglet Équipe : elles ne sont pas comptées dans la charge de l'équipe.
            </span>
          </Field>
          {roadmapItems.length > 0 && (
            <Field label="Initiatives FDR passées en revue (optionnel)">
              <div className="flex max-h-28 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-700">
                {roadmapItems.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={roadmapItemIds.includes(r.id)} onChange={() => setRoadmapItemIds((p) => toggle(p, r.id))} />
                    <span className="truncate text-slate-700 dark:text-slate-200">
                      {r.title} — {r.quarter} {r.year}
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          )}
          <Field label="Date de la prochaine séance (optionnel)">
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="input" />
          </Field>
          {!initial && (
            <p className="text-xs text-slate-400">
              L'ordre du jour, les décisions et les actions se remplissent ensuite directement dans la fiche de la séance.
            </p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
            Annuler
          </button>
          <button
            disabled={!title.trim() || !date}
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
