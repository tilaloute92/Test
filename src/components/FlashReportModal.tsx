import { useState } from 'react';
import { Avatar, Card, PrintButton, PrintHeader, RagBadge } from './ui';
import { buildFlashReportMarkdown, computeFlashReport, ragLabels, type RagStatus } from '../lib/flashReport';
import { exportFlashReportPptx } from '../lib/flashReportPptx';
import { formatDateLong } from '../lib/date';
import type { ProjectTask, TeamMember, TimeEntry } from '../types';

const ragPanelStyles: Record<RagStatus, string> = {
  vert: 'bg-emerald-50 dark:bg-emerald-500/10',
  orange: 'bg-amber-50 dark:bg-amber-500/10',
  rouge: 'bg-red-50 dark:bg-red-500/10',
};

function assigneeNames(task: ProjectTask, members: TeamMember[]): string {
  const names = task.assigneeIds.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(', ') : 'non assigné';
}

export function FlashReportModal({
  project,
  tasks,
  timeEntries,
  members,
  onClose,
}: {
  project: string;
  tasks: ProjectTask[];
  timeEntries: TimeEntry[];
  members: TeamMember[];
  onClose: () => void;
}) {
  const report = computeFlashReport(project, tasks, timeEntries, members);
  const [copied, setCopied] = useState(false);
  const [pptxBusy, setPptxBusy] = useState(false);
  const [pptxError, setPptxError] = useState<string | null>(null);

  const copyMarkdown = async () => {
    const md = buildFlashReportMarkdown(report, members);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Le presse-papiers peut être refusé par le navigateur — on n'affiche simplement pas la confirmation.
    }
  };

  const exportPptx = async () => {
    setPptxError(null);
    setPptxBusy(true);
    try {
      await exportFlashReportPptx({ report, members });
    } catch (err) {
      setPptxError(err instanceof Error ? err.message : String(err));
    } finally {
      setPptxBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 print:static print:block print:bg-transparent print:p-0"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl print:max-h-none print:w-full print:max-w-none print:overflow-visible print:rounded-none print:shadow-none dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <PrintHeader title={`Flash report — ${project}`} subtitle={`Statut : ${ragLabels[report.rag]}`} />

        <div className="mb-4 flex items-start justify-between gap-3 print:hidden">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Flash report — {project}</h2>
            <p className="text-xs text-slate-400">Généré le {formatDateLong(new Date(report.generatedAt))}</p>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            ✕
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          <PrintButton />
          <button onClick={copyMarkdown} className="btn-ghost">
            {copied ? 'Copié ✓' : 'Copier en Markdown'}
          </button>
          <button onClick={exportPptx} disabled={pptxBusy} className="btn-ghost disabled:opacity-40">
            {pptxBusy ? 'Génération…' : 'Exporter PowerPoint'}
          </button>
        </div>
        {pptxError && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 print:hidden dark:bg-red-500/10 dark:text-red-300">
            Échec de la génération du PowerPoint : {pptxError}
          </p>
        )}

        <div className={`mb-4 flex items-start gap-3 rounded-lg p-3 ${ragPanelStyles[report.rag]}`}>
          <RagBadge rag={report.rag} />
          <ul className="space-y-0.5 text-sm text-slate-700 dark:text-slate-200">
            {report.ragReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Tâches terminées" value={`${report.completedTasks.length}/${report.totalTasks}`} />
          <Kpi label="Avancement" value={`${Math.round(report.completionRatio * 100)}%`} />
          <Kpi label="Charge (passé / estimé)" value={`${report.spentHours}h / ${report.estimatedHours}h`} />
          <Kpi label="En attente" value={String(report.waitingTasks.length)} />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Équipe :</span>
          {report.team.length === 0 ? (
            <span className="text-xs text-slate-400">Non attribuée</span>
          ) : (
            report.team.map((m) => <Avatar key={m.id} name={m.name} color={m.color} initials={m.initials} size={22} />)
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ListCard title="Réalisé récemment (14 derniers jours)" tasks={report.recentlyCompleted} members={members} empty="Rien de terminé récemment." />
          <ListCard
            title="Échéances à venir (14 prochains jours)"
            tasks={report.upcoming}
            members={members}
            empty="Aucune échéance dans les 14 prochains jours."
            showDue
          />
          <ListCard title="En retard" tasks={report.overdueTasks} members={members} empty="Aucune tâche en retard." showDue tone="danger" />
          <ListCard title="En attente / bloquées" tasks={report.waitingTasks} members={members} empty="Aucune tâche bloquée." tone="warning" />
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </Card>
  );
}

function ListCard({
  title,
  tasks,
  members,
  empty,
  showDue,
  tone,
}: {
  title: string;
  tasks: ProjectTask[];
  members: TeamMember[];
  empty: string;
  showDue?: boolean;
  tone?: 'danger' | 'warning';
}) {
  const toneClass = tone === 'danger' ? 'text-red-600 dark:text-red-400' : tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400';
  return (
    <Card className="p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {tasks.length === 0 ? (
        <p className="text-xs text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{t.title}</span>
              <span className={`shrink-0 text-xs ${showDue ? toneClass : 'text-slate-400'}`}>{showDue ? t.dueDate : assigneeNames(t, members)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
