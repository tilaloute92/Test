import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { addDays, formatDateLong, formatWeekRange, getWorkingDaysOfWeek, isWeekend, startOfWeek, toISODate } from '../lib/date';
import { getTaskById } from '../lib/selectors';
import { Avatar, Card, ModeSwitcher, PrintButton, PrintHeader } from './ui';
import { useConfirm } from './ConfirmProvider';
import { rollupByProject, rollupByType, totalPasse, type GroupRollup } from '../lib/timeRollup';
import type { TeamMember } from '../types';

const TIME_MODES = ['personne', 'projet', 'type'] as const;
type TimeMode = (typeof TIME_MODES)[number];

/** Fenêtres proposées pour les vues agrégées. Une semaine ne dit rien d'un projet qui
 *  court sur trois mois : c'est la raison pour laquelle ces vues ne reprennent pas la
 *  navigation hebdomadaire de la vue par personne. */
const FENETRES = [
  { cle: '4', label: '4 semaines', jours: 28 },
  { cle: '12', label: '3 mois', jours: 84 },
  { cle: '52', label: '12 mois', jours: 365 },
  { cle: 'tout', label: 'Tout', jours: 0 },
] as const;

export function TimeTrackingView() {
  const { members, tasks, timeEntries, absences, removeTimeEntry } = useStore();
  const confirm = useConfirm();
  const [weekOffset, setWeekOffset] = useState(0);
  const [memberFilter, setMemberFilter] = useState('Tous');
  const [mode, setMode] = useState<TimeMode>('personne');
  const [fenetre, setFenetre] = useState<(typeof FENETRES)[number]['cle']>('4');

  const weekStart = startOfWeek(addDays(new Date(), weekOffset * 7));
  const days = getWorkingDaysOfWeek(weekStart);
  const isoDays = days.map(toISODate);

  const perMember = useMemo(() => {
    return members.map((m) => {
      const entries = timeEntries.filter((e) => e.memberId === m.id && isoDays.includes(e.date));
      const perDay = isoDays.map((iso) => entries.filter((e) => e.date === iso).reduce((s, e) => s + e.hours, 0));
      const total = perDay.reduce((s, h) => s + h, 0);
      const absentHours = absences.filter((a) => a.memberId === m.id && isoDays.includes(a.date)).length * 3.5;
      const target = m.weeklyHours - absentHours;
      return { member: m, perDay, total, target };
    });
  }, [members, timeEntries, isoDays, absences]);

  const weekEntries = timeEntries
    .filter((e) => isoDays.includes(e.date))
    .filter((e) => memberFilter === 'Tous' || e.memberId === memberFilter)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  /** Saisies de la fenêtre choisie, pour les vues agrégées. */
  const saisiesFenetre = useMemo(() => {
    const def = FENETRES.find((f) => f.cle === fenetre) ?? FENETRES[0];
    if (def.jours === 0) return timeEntries;
    const depuis = toISODate(addDays(new Date(), -def.jours));
    return timeEntries.filter((e) => e.date >= depuis);
  }, [timeEntries, fenetre]);

  const groupes = useMemo(
    () => (mode === 'projet' ? rollupByProject(saisiesFenetre, tasks) : mode === 'type' ? rollupByType(saisiesFenetre, tasks) : []),
    [mode, saisiesFenetre, tasks]
  );

  const exportCsv = () => {
    const header = ['Date', 'Période', 'Membre', 'Tâche', 'Type', 'Heures', 'Note'];
    const rows = weekEntries.map((e) => {
      const m = members.find((mm) => mm.id === e.memberId);
      const t = getTaskById(tasks, e.taskId);
      return [e.date, e.period === 'matin' ? 'Matin' : 'Après-midi', m?.name ?? '', t?.title ?? '', t?.type ?? '', String(e.hours), e.note ?? ''];
    });
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `temps_semaine_${isoDays[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Le sous-titre suit le mode : il annonçait la semaine en cours alors que les vues
          agrégées couvrent quatre semaines ou plus, ce qui faisait lire les totaux pour
          ceux d'une seule semaine. */}
      <PrintHeader
        title="Suivi du temps"
        subtitle={mode === 'personne' ? `Semaine du ${formatWeekRange(days)}` : FENETRES.find((f) => f.cle === fenetre)?.label ?? ''}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Suivi du temps</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {mode === 'personne'
              ? `Semaine du ${formatWeekRange(days)}`
              : `${FENETRES.find((f) => f.cle === fenetre)?.label ?? ''} — toutes les saisies de la période`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModeSwitcher
            value={mode}
            onChange={setMode}
            options={[
              { value: 'personne', label: 'Par personne', title: 'Qui a saisi combien, jour par jour, sur une semaine' },
              { value: 'projet', label: 'Par projet', title: 'Temps passé par projet et par tâche, face à la charge estimée' },
              { value: 'type', label: 'Par type', title: 'Répartition entre MCO, incidents et projets' },
            ]}
          />
          {mode === 'personne' ? (
            <>
              <button onClick={() => setWeekOffset((w) => w - 1)} className="btn-ghost">◀ Semaine préc.</button>
              <button onClick={() => setWeekOffset(0)} className="btn-ghost">Semaine en cours</button>
              <button onClick={() => setWeekOffset((w) => w + 1)} className="btn-ghost">Semaine suiv. ▶</button>
            </>
          ) : (
            <select
              value={fenetre}
              onChange={(e) => setFenetre(e.target.value as typeof fenetre)}
              aria-label="Période couverte"
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              {FENETRES.map((f) => (
                <option key={f.cle} value={f.cle}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
          <PrintButton />
          <button onClick={exportCsv} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
            Exporter CSV
          </button>
        </div>
      </div>

      {mode !== 'personne' && (
        <GroupesCard groupes={groupes} members={members} mode={mode} fenetre={FENETRES.find((f) => f.cle === fenetre)?.label ?? ''} />
      )}

      {mode === 'personne' && (
      <Card className="overflow-x-auto p-3 print:overflow-visible">
        <table className="w-full min-w-[700px] text-sm print:min-w-0">
          <thead>
            <tr className="text-left text-xs text-slate-400">
              <th className="px-2 py-2 font-medium">Membre</th>
              {days.map((d) => (
                <th key={toISODate(d)} className={`px-2 py-2 text-center font-medium ${isWeekend(d) ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                  {formatDateLong(d).slice(0, 3)}
                </th>
              ))}
              <th className="px-2 py-2 text-center font-medium">Total</th>
              <th className="px-2 py-2 text-center font-medium">Cible</th>
              <th className="px-2 py-2 text-center font-medium">Écart</th>
            </tr>
          </thead>
          <tbody>
            {perMember.map(({ member, perDay, total, target }) => {
              const delta = total - target;
              return (
                <tr key={member.id} className="border-t border-slate-50 dark:border-slate-800/60">
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={member.name} color={member.color} initials={member.initials} size={24} />
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{member.name}</span>
                    </div>
                  </td>
                  {perDay.map((h, i) => (
                    <td
                      key={i}
                      className={`px-2 py-2 text-center tabular-nums text-slate-600 dark:text-slate-300 ${isWeekend(days[i]) ? 'bg-amber-50/50 dark:bg-amber-500/5' : ''}`}
                    >
                      {h > 0 ? `${h}h` : '—'}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center font-semibold tabular-nums text-slate-800 dark:text-slate-100">{total}h</td>
                  <td className="px-2 py-2 text-center tabular-nums text-slate-400">{target}h</td>
                  <td
                    className={`px-2 py-2 text-center tabular-nums font-medium ${
                      Math.abs(delta) < 0.01 ? 'text-slate-400' : delta < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-sky-600 dark:text-sky-400'
                    }`}
                  >
                    {delta > 0 ? '+' : ''}
                    {delta.toFixed(1)}h
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      )}

      {mode === 'personne' && (
      <Card className="p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Détail des saisies</h2>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white print:hidden"
          >
            <option value="Tous">Tous les membres</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
          {weekEntries.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Aucune saisie sur cette période.</p>}
          {weekEntries.map((e) => {
            const m = members.find((mm) => mm.id === e.memberId);
            const t = getTaskById(tasks, e.taskId);
            return (
              <div key={e.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-24 shrink-0 text-xs text-slate-400">{e.date}</span>
                <span className="w-20 shrink-0 text-xs text-slate-400">{e.period === 'matin' ? 'Matin' : 'Après-midi'}</span>
                {m && <Avatar name={m.name} color={m.color} initials={m.initials} size={20} />}
                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{t?.title ?? 'Tâche supprimée'}</span>
                {e.note && <span className="hidden max-w-xs truncate text-xs text-slate-400 sm:block">{e.note}</span>}
                <span className="w-12 shrink-0 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">{e.hours}h</span>
                <button
                  onClick={async () => {
                    if (await confirm({ title: 'Supprimer la saisie', message: `Supprimer cette saisie de ${e.hours}h ?`, confirmLabel: 'Supprimer', danger: true })) {
                      removeTimeEntry(e.id);
                    }
                  }}
                  className="text-xs text-slate-300 hover:text-red-500 print:hidden"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </Card>
      )}
    </div>
  );
}

/**
 * Le temps passé regroupé — par projet ou par type — avec le réalisé face à l'estimé.
 *
 * Le dépassement est la seule information qui mérite d'être criante : un nombre d'heures
 * seul ne dit rien, 31h sur une tâche est excellent ou catastrophique selon qu'on en avait
 * prévu 40 ou 12.
 */
function GroupesCard({
  groupes,
  members,
  mode,
  fenetre,
}: {
  groupes: GroupRollup[];
  members: TeamMember[];
  mode: 'projet' | 'type';
  fenetre: string;
}) {
  const [ouverts, setOuverts] = useState<string[]>([]);
  const total = totalPasse(groupes);

  if (groupes.length === 0) {
    return <Card className="p-6 text-center text-sm text-slate-400">Aucune saisie de temps sur « {fenetre} ».</Card>;
  }

  const bascule = (cle: string) => setOuverts((o) => (o.includes(cle) ? o.filter((x) => x !== cle) : [...o, cle]));

  return (
    <Card className="p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Temps passé par {mode === 'projet' ? 'projet' : 'type'} — {fenetre.toLowerCase()}
        </h2>
        <span className="text-xs tabular-nums text-slate-400">{total}h au total</span>
      </div>

      <div className="space-y-1.5">
        {groupes.map((g) => {
          const ouvert = ouverts.includes(g.cle);
          const depasse = g.estime > 0 && g.passe > g.estime;
          const part = total > 0 ? Math.round((g.passe / total) * 100) : 0;
          return (
            <div key={g.cle} className="rounded-lg border border-slate-100 dark:border-slate-800">
              <button
                onClick={() => bascule(g.cle)}
                aria-expanded={ouvert}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <span className="w-3 shrink-0 text-xs text-slate-400" aria-hidden="true">
                  {ouvert ? '▾' : '▸'}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {g.label}
                  <span className="ml-1.5 text-xs font-normal text-slate-400">
                    {g.taches.length} tâche(s){g.tachesSansTemps > 0 ? ` · ${g.tachesSansTemps} sans temps saisi` : ''}
                  </span>
                </span>
                <span className="hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:block dark:bg-slate-800">
                  <span
                    className={`block h-full rounded-full ${depasse ? 'bg-red-500' : 'bg-violet-500'}`}
                    style={{ width: `${g.estime > 0 ? Math.min(100, (g.passe / g.estime) * 100) : 100}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-400">{part}%</span>
                <span
                  className={`w-24 shrink-0 text-right text-sm tabular-nums ${
                    depasse ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'
                  }`}
                  title={depasse ? `Dépassement de ${Math.round((g.passe - g.estime) * 10) / 10}h` : undefined}
                >
                  {g.passe}h{g.estime > 0 ? ` / ${g.estime}h` : ''}
                </span>
              </button>

              {ouvert && (
                <div className="divide-y divide-slate-50 border-t border-slate-100 dark:divide-slate-800/60 dark:border-slate-800">
                  {g.taches.map((t) => {
                    const depasseT = t.estime > 0 && t.passe > t.estime;
                    return (
                      <div key={t.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 pl-9">
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-600 dark:text-slate-300">{t.titre}</span>
                        <span className="flex shrink-0 -space-x-1.5">
                          {t.memberIds.slice(0, 4).map((id) => {
                            const m = members.find((x) => x.id === id);
                            return m ? <Avatar key={id} name={m.name} color={m.color} initials={m.initials} size={18} /> : null;
                          })}
                        </span>
                        <span
                          className={`w-24 shrink-0 text-right text-xs tabular-nums ${
                            depasseT ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-400'
                          }`}
                        >
                          {t.passe}h{t.estime > 0 ? ` / ${t.estime}h` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-slate-400">
        En rouge, le réalisé qui dépasse la charge estimée. L'estimé d'un projet compte toutes ses tâches, y compris celles sur
        lesquelles rien n'a encore été saisi&nbsp;: c'est son budget, pas son avancement.
      </p>
    </Card>
  );
}

function csvEscape(v: string) {
  if (v.includes(';') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
