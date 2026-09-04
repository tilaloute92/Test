import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { addDays, formatDateLong, formatWeekRange, getWorkingDaysOfWeek, isToday, startOfWeek } from '../lib/date';
import { buildMarkdownReport, computeWeeklyReport, weatherMeta, type WeeklyReport } from '../lib/weeklyReport';
import { exportWeeklyReportPptx } from '../lib/weeklyReportPptx';
import { Avatar, Card, ModeSwitcher, RoadmapDomainBadge, WorkloadBar, WorkloadPill } from './ui';
import { useViewMode } from '../hooks/useViewMode';
import { workloadColors, type WorkloadLevel } from '../lib/workload';
import type { ProjectTask, TeamMember } from '../types';

const TEAM_LABEL = 'Équipe Infrastructure & Réseau';

const REPORT_VIEW_MODES = ['detaille', 'resume', 'presentation'] as const;
type ReportViewMode = (typeof REPORT_VIEW_MODES)[number];

const roadmapStatusLabels: Record<string, string> = {
  idee: 'Idée',
  planifie: 'Planifié',
  en_cours: 'En cours',
  termine: 'Terminé',
  reporte: 'Reporté',
  abandonne: 'Abandonné',
};

function assigneeNames(task: ProjectTask, members: TeamMember[]): string {
  const names = task.assigneeIds.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(', ') : 'Non assigné';
}

export function WeeklyReportView() {
  const { members, tasks, timeEntries, absences, planningSlots, roadmapItems } = useStore();
  const [weekOffset, setWeekOffset] = useState(0);
  const [mode, setMode] = useViewMode<ReportViewMode>('rapport', REPORT_VIEW_MODES, 'detaille');
  const [copied, setCopied] = useState(false);
  const [pptxBusy, setPptxBusy] = useState(false);
  const [pptxError, setPptxError] = useState<string | null>(null);

  const weekStart = startOfWeek(addDays(new Date(), weekOffset * 7));
  const weekDays = getWorkingDaysOfWeek(weekStart);
  const nextWeekDays = getWorkingDaysOfWeek(addDays(weekStart, 7));

  const report = useMemo(
    () => computeWeeklyReport({ weekDays, nextWeekDays, members, tasks, timeEntries, absences, planningSlots, roadmapItems }),
    [weekDays, nextWeekDays, members, tasks, timeEntries, absences, planningSlots, roadmapItems]
  );

  const weather = weatherMeta[report.weather];

  const copyMarkdown = async () => {
    const md = buildMarkdownReport(report, TEAM_LABEL, members);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Le presse-papiers peut être refusé par le navigateur (contexte non sécurisé, permission) —
      // dans ce cas on n'affiche simplement pas la confirmation, plutôt que de faire planter la page.
    }
  };

  const exportPptx = async () => {
    setPptxError(null);
    setPptxBusy(true);
    try {
      await exportWeeklyReportPptx({ report, members, teamLabel: TEAM_LABEL });
    } catch (err) {
      setPptxError(err instanceof Error ? err.message : String(err));
    } finally {
      setPptxBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Rapport hebdomadaire</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {TEAM_LABEL} · semaine du {formatWeekRange(weekDays)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModeSwitcher
            value={mode}
            onChange={setMode}
            options={[
              { value: 'detaille', label: 'Détaillé', title: 'Toutes les sections (vue par défaut)' },
              { value: 'resume', label: 'Résumé', title: "Condensé sur un écran : l'essentiel seulement" },
              { value: 'presentation', label: 'Présentation', title: 'Grand format, pensé pour être projeté en réunion' },
            ]}
          />
          <button onClick={() => setWeekOffset((w) => w - 1)} className="btn-ghost">◀ Semaine préc.</button>
          <button onClick={() => setWeekOffset(0)} className="btn-ghost">Semaine en cours</button>
          <button onClick={() => setWeekOffset((w) => w + 1)} className="btn-ghost">Semaine suiv. ▶</button>
          <button onClick={copyMarkdown} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            {copied ? 'Copié ✓' : 'Copier en Markdown'}
          </button>
          <button onClick={() => window.print()} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
            Imprimer / Enregistrer en PDF
          </button>
          <button
            onClick={exportPptx}
            disabled={pptxBusy}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {pptxBusy ? 'Génération…' : 'Exporter PowerPoint'}
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-400 print:hidden">
        Pensé pour être généré le vendredi, en fin de semaine. L'application n'ayant pas de serveur, l'envoi n'est pas automatique :
        générez le rapport ici puis partagez-le via "Copier en Markdown" (e-mail, Teams...), "Imprimer / Enregistrer en PDF" ou "Exporter
        PowerPoint" (fichier .pptx généré dans votre navigateur, sans macro ni image intégrée — voir la section Sécurité du README).
      </p>
      {pptxError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 print:hidden dark:bg-red-500/10 dark:text-red-300">
          Échec de la génération du PowerPoint : {pptxError}
        </p>
      )}

      {/* En-tête imprimable, masqué à l'écran */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Rapport hebdomadaire — {TEAM_LABEL}</h1>
        <p className="text-sm text-slate-500">
          Semaine du {formatWeekRange(weekDays)} · généré le {formatDateLong(new Date())}
        </p>
      </div>

      {mode === 'resume' && <ReportSummary report={report} members={members} />}
      {mode === 'presentation' && <ReportPresentation report={report} members={members} weekDays={weekDays} />}

      {mode === 'detaille' && (
      <>
      {/* Météo de la semaine */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <span className="text-5xl leading-none">{weather.emoji}</span>
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">Météo de la semaine : {weather.label}</div>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              {report.weatherFactors.map((f) => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Charge moyenne équipe" value={`${Math.round(report.avgWorkloadRatio * 100)}%`} accent="text-violet-600 dark:text-violet-400" />
        <Kpi label="Heures saisies" value={`${report.totalHoursLogged}h / ${report.totalHoursTarget}h`} accent="text-slate-700 dark:text-slate-200" />
        <Kpi label="Tâches terminées" value={report.tasksCompleted.length} accent="text-emerald-600 dark:text-emerald-400" />
        <Kpi label="Incidents critiques ouverts" value={report.openCriticalIncidents.length} accent="text-red-600 dark:text-red-400" />
        <Kpi label="Tâches en retard" value={report.overdueTasks.length} accent="text-amber-600 dark:text-amber-400" />
      </div>

      {/* Charge par personne */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Charge par personne</h2>
        <div className="space-y-3">
          {report.perMember.map((p) => (
            <div key={p.member.id} className="flex items-center gap-3">
              <Avatar name={p.member.name} color={p.member.color} initials={p.member.initials} size={26} />
              <span className="w-36 shrink-0 truncate text-sm text-slate-700 dark:text-slate-200">{p.member.name}</span>
              <div className="flex-1">
                <WorkloadBar ratio={p.workloadRatio} level={p.workloadLevel} />
              </div>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{Math.round(p.workloadRatio * 100)}%</span>
              <div className="w-24 shrink-0 text-right">
                <WorkloadPill level={p.workloadLevel} />
              </div>
              <span className="w-28 shrink-0 text-right text-xs text-slate-400">{p.tasksCompleted.length} terminée(s)</span>
            </div>
          ))}
        </div>
      </Card>

      {/* État de la feuille de route (FDR) */}
      {report.roadmap.total > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Feuille de route (FDR) — {report.roadmap.year}</h2>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              {(['idee', 'planifie', 'en_cours', 'termine', 'reporte', 'abandonne'] as const)
                .filter((s) => report.roadmap.byStatus[s] > 0)
                .map((s) => (
                  <span key={s}>
                    {roadmapStatusLabels[s]} : <strong className="text-slate-700 dark:text-slate-200">{report.roadmap.byStatus[s]}</strong>
                  </span>
                ))}
            </div>
          </div>

          {report.roadmap.inProgress.length === 0 ? (
            <p className="text-xs text-slate-400">Aucune initiative "En cours" pour {report.roadmap.year}.</p>
          ) : (
            <div className="space-y-2">
              {report.roadmap.inProgress.map((r) => (
                <div key={r.id} className="flex items-center gap-3">
                  <RoadmapDomainBadge domain={r.domain} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{r.title}</span>
                  <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(0, Math.min(r.progress, 100))}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{r.progress}%</span>
                </div>
              ))}
            </div>
          )}

          {report.roadmap.notStartedButDue.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-500/10">
              <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                Pas encore démarrée(s) alors que le trimestre cible est atteint :
              </p>
              <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
                {report.roadmap.notStartedButDue.map((r) => (
                  <li key={r.id}>
                    {r.title} ({r.domain}, {r.quarter})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Faits marquants */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Incidents critiques/hauts encore ouverts</h2>
          {report.openCriticalIncidents.length === 0 ? (
            <p className="text-xs text-slate-400">Aucun — rien de bloquant en attente.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {report.openCriticalIncidents.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200">
                  <span className="truncate">{t.title}</span>
                  <span className="shrink-0 text-xs text-slate-400">{assigneeNames(t, members)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Terminé cette semaine ({report.tasksCompleted.length})</h2>
          {report.tasksCompleted.length === 0 ? (
            <p className="text-xs text-slate-400">Aucune tâche clôturée cette semaine.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {report.tasksCompleted.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200">
                  <span className="truncate">{t.title}</span>
                  <span className="shrink-0 text-xs text-slate-400">{assigneeNames(t, members)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Tâches en retard</h2>
          {report.overdueTasks.length === 0 ? (
            <p className="text-xs text-slate-400">Aucune — tout est dans les temps.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {report.overdueTasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200">
                  <span className="truncate">{t.title}</span>
                  <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">échéance {t.dueDate}</span>
                  <span className="shrink-0 text-xs text-slate-400">{assigneeNames(t, members)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Semaine prochaine</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Planning déjà rempli à <strong>{Math.round(report.nextWeekFillRatio * 100)}%</strong>
          </p>
          {report.nextWeekAbsences.length === 0 ? (
            <p className="mt-1 text-xs text-slate-400">Aucune absence prévue.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs text-slate-500 dark:text-slate-400">
              {report.nextWeekAbsences.map((a) => {
                const m = members.find((mm) => mm.id === a.memberId);
                return (
                  <li key={a.id}>
                    {m?.name ?? '—'} — {a.label ?? a.type} ({a.date})
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-center text-[11px] text-slate-300 dark:text-slate-600">
        Rapport généré par Suivi Infra & Réseau · {isToday(new Date()) ? "aujourd'hui" : ''} {formatDateLong(new Date())}
      </p>
      </>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <Card className="p-4">
      <div className={`text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </Card>
  );
}

/** Ligne "N autres" quand une liste condensée est tronquée — jamais un simple "..." muet sur le nombre restant. */
function Overflow({ count }: { count: number }) {
  if (count <= 0) return null;
  return <li className="text-slate-400">+ {count} autre{count > 1 ? 's' : ''}</li>;
}

/**
 * Vue Résumé : pensée pour être lue en moins d'une minute — météo, indicateurs clés et
 * seulement les 3 points les plus urgents de chaque catégorie (le détail complet reste
 * dans la vue Détaillé, à un clic).
 */
function ReportSummary({ report, members }: { report: WeeklyReport; members: TeamMember[] }) {
  const weather = weatherMeta[report.weather];
  const workloadCounts = report.perMember.reduce(
    (acc, p) => {
      acc[p.workloadLevel] = (acc[p.workloadLevel] ?? 0) + 1;
      return acc;
    },
    {} as Record<WorkloadLevel, number>
  );

  return (
    <div className="space-y-3">
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Rapport hebdomadaire (résumé) — {TEAM_LABEL}</h1>
      </div>

      <Card className="flex flex-wrap items-center gap-4 p-4">
        <span className="text-4xl leading-none">{weather.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-slate-900 dark:text-white">{weather.label}</div>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{report.weatherFactors[0] ?? 'Rien à signaler de particulier.'}</p>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Charge moyenne" value={`${Math.round(report.avgWorkloadRatio * 100)}%`} accent="text-violet-600 dark:text-violet-400" />
        <Kpi label="Incidents critiques" value={report.openCriticalIncidents.length} accent="text-red-600 dark:text-red-400" />
        <Kpi label="Tâches en retard" value={report.overdueTasks.length} accent="text-amber-600 dark:text-amber-400" />
        <Kpi label="Terminées" value={report.tasksCompleted.length} accent="text-emerald-600 dark:text-emerald-400" />
      </div>

      <Card className="p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Charge d'équipe</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
          {(Object.entries(workloadCounts) as [WorkloadLevel, number][]).map(([level, count]) => (
            <span key={level}>
              <strong className="text-slate-900 dark:text-white">{count}</strong> {workloadColors[level].label.toLowerCase()}
              {count > 1 ? 's' : ''}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">À traiter en priorité</h2>
          {report.openCriticalIncidents.length === 0 ? (
            <p className="text-xs text-slate-400">Aucun incident critique ouvert.</p>
          ) : (
            <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
              {report.openCriticalIncidents.slice(0, 3).map((t) => (
                <li key={t.id} className="truncate">
                  {t.title} — <span className="text-xs text-slate-400">{assigneeNames(t, members)}</span>
                </li>
              ))}
              <Overflow count={report.openCriticalIncidents.length - 3} />
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Échéances dépassées</h2>
          {report.overdueTasks.length === 0 ? (
            <p className="text-xs text-slate-400">Aucune — tout est dans les temps.</p>
          ) : (
            <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
              {report.overdueTasks.slice(0, 3).map((t) => (
                <li key={t.id} className="truncate">
                  {t.title} — <span className="text-xs text-amber-600 dark:text-amber-400">échéance {t.dueDate}</span>
                </li>
              ))}
              <Overflow count={report.overdueTasks.length - 3} />
            </ul>
          )}
        </Card>
      </div>

      {report.roadmap.notStartedButDue.length > 0 && (
        <Card className="border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <h2 className="mb-1 text-sm font-semibold text-amber-800 dark:text-amber-200">FDR — trimestre atteint sans démarrage</h2>
          <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
            {report.roadmap.notStartedButDue.slice(0, 3).map((r) => (
              <li key={r.id}>{r.title}</li>
            ))}
            <Overflow count={report.roadmap.notStartedButDue.length - 3} />
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * Vue Présentation : mêmes données que le rapport détaillé, mais en grand format — pensée
 * pour être projetée en réunion (typographie large, sections aérées, moins de texte dense).
 */
function ReportPresentation({ report, members, weekDays }: { report: WeeklyReport; members: TeamMember[]; weekDays: Date[] }) {
  const weather = weatherMeta[report.weather];

  return (
    <div className="space-y-5">
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Rapport hebdomadaire (présentation) — {TEAM_LABEL}</h1>
        <p className="text-sm text-slate-500">Semaine du {formatWeekRange(weekDays)}</p>
      </div>

      <Card className="p-8 text-center">
        <div className="text-7xl leading-none">{weather.emoji}</div>
        <div className="mt-3 text-3xl font-bold text-slate-900 dark:text-white">{weather.label}</div>
        <ul className="mt-3 space-y-1 text-base text-slate-500 dark:text-slate-400">
          {report.weatherFactors.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BigKpi label="Charge moyenne" value={`${Math.round(report.avgWorkloadRatio * 100)}%`} accent="text-violet-600 dark:text-violet-400" />
        <BigKpi label="Incidents critiques ouverts" value={report.openCriticalIncidents.length} accent="text-red-600 dark:text-red-400" />
        <BigKpi label="Tâches en retard" value={report.overdueTasks.length} accent="text-amber-600 dark:text-amber-400" />
        <BigKpi label="Terminées cette semaine" value={report.tasksCompleted.length} accent="text-emerald-600 dark:text-emerald-400" />
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Charge par personne</h2>
        <div className="space-y-4">
          {report.perMember.map((p) => (
            <div key={p.member.id} className="flex items-center gap-4">
              <Avatar name={p.member.name} color={p.member.color} initials={p.member.initials} size={36} />
              <span className="w-40 shrink-0 truncate text-base font-medium text-slate-700 dark:text-slate-200">{p.member.name}</span>
              <div className="flex-1">
                <WorkloadBar ratio={p.workloadRatio} level={p.workloadLevel} />
              </div>
              <div className="w-28 shrink-0 text-right">
                <WorkloadPill level={p.workloadLevel} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {report.openCriticalIncidents.length > 0 && (
        <Card className="p-6">
          <h2 className="mb-3 text-lg font-semibold text-red-700 dark:text-red-300">Incidents critiques/hauts ouverts</h2>
          <ul className="space-y-2 text-base text-slate-700 dark:text-slate-200">
            {report.openCriticalIncidents.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3">
                <span className="truncate">{t.title}</span>
                <span className="shrink-0 text-sm text-slate-400">{assigneeNames(t, members)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {report.roadmap.total > 0 && report.roadmap.inProgress.length > 0 && (
        <Card className="p-6">
          <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Feuille de route en cours</h2>
          <div className="space-y-3">
            {report.roadmap.inProgress.map((r) => (
              <div key={r.id} className="flex items-center gap-3">
                <RoadmapDomainBadge domain={r.domain} />
                <span className="min-w-0 flex-1 truncate text-base text-slate-700 dark:text-slate-200">{r.title}</span>
                <div className="h-2 w-32 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(0, Math.min(r.progress, 100))}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right text-sm tabular-nums text-slate-500 dark:text-slate-400">{r.progress}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function BigKpi({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <Card className="p-6 text-center">
      <div className={`text-4xl font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{label}</div>
    </Card>
  );
}
