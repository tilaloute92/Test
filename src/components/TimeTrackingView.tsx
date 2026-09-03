import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { addDays, formatDateLong, formatWeekRange, getWorkingDaysOfWeek, isWeekend, startOfWeek, toISODate } from '../lib/date';
import { getTaskById } from '../lib/selectors';
import { Avatar, Card } from './ui';
import { useConfirm } from './ConfirmProvider';

export function TimeTrackingView() {
  const { members, tasks, timeEntries, absences, removeTimeEntry } = useStore();
  const confirm = useConfirm();
  const [weekOffset, setWeekOffset] = useState(0);
  const [memberFilter, setMemberFilter] = useState('Tous');

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Suivi du temps</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Semaine du {formatWeekRange(days)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset((w) => w - 1)} className="btn-ghost">◀ Semaine préc.</button>
          <button onClick={() => setWeekOffset(0)} className="btn-ghost">Semaine en cours</button>
          <button onClick={() => setWeekOffset((w) => w + 1)} className="btn-ghost">Semaine suiv. ▶</button>
          <button onClick={exportCsv} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
            Exporter CSV
          </button>
        </div>
      </div>

      <Card className="overflow-x-auto p-3">
        <table className="w-full min-w-[700px] text-sm">
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

      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Détail des saisies</h2>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
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
                  className="text-xs text-slate-300 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function csvEscape(v: string) {
  if (v.includes(';') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
