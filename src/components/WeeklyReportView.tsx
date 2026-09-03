import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { addDays, formatDateLong, formatWeekRange, getWorkingDaysOfWeek, isToday, startOfWeek } from '../lib/date';
import { buildMarkdownReport, computeWeeklyReport, weatherMeta } from '../lib/weeklyReport';
import { Avatar, Card, WorkloadBar, WorkloadPill } from './ui';
import type { ProjectTask, TeamMember } from '../types';

const TEAM_LABEL = 'Équipe Infrastructure & Réseau';

function assigneeNames(task: ProjectTask, members: TeamMember[]): string {
  const names = task.assigneeIds.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(', ') : 'Non assigné';
}

export function WeeklyReportView() {
  const { members, tasks, timeEntries, absences, planningSlots } = useStore();
  const [weekOffset, setWeekOffset] = useState(0);
  const [copied, setCopied] = useState(false);

  const weekStart = startOfWeek(addDays(new Date(), weekOffset * 7));
  const weekDays = getWorkingDaysOfWeek(weekStart);
  const nextWeekDays = getWorkingDaysOfWeek(addDays(weekStart, 7));

  const report = useMemo(
    () => computeWeeklyReport({ weekDays, nextWeekDays, members, tasks, timeEntries, absences, planningSlots }),
    [weekDays, nextWeekDays, members, tasks, timeEntries, absences, planningSlots]
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
          <button onClick={() => setWeekOffset((w) => w - 1)} className="btn-ghost">◀ Semaine préc.</button>
          <button onClick={() => setWeekOffset(0)} className="btn-ghost">Semaine en cours</button>
          <button onClick={() => setWeekOffset((w) => w + 1)} className="btn-ghost">Semaine suiv. ▶</button>
          <button onClick={copyMarkdown} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            {copied ? 'Copié ✓' : 'Copier en Markdown'}
          </button>
          <button onClick={() => window.print()} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
            Imprimer / Enregistrer en PDF
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-400 print:hidden">
        Pensé pour être généré le vendredi, en fin de semaine. L'application n'ayant pas de serveur, l'envoi n'est pas automatique :
        générez le rapport ici puis partagez-le via "Copier en Markdown" (e-mail, Teams...) ou "Imprimer / Enregistrer en PDF".
      </p>

      {/* En-tête imprimable, masqué à l'écran */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Rapport hebdomadaire — {TEAM_LABEL}</h1>
        <p className="text-sm text-slate-500">
          Semaine du {formatWeekRange(weekDays)} · généré le {formatDateLong(new Date())}
        </p>
      </div>

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
