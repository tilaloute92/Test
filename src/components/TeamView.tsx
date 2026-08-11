import { useState } from 'react';
import { useStore } from '../store/useStore';
import { toISODate } from '../lib/date';
import { Avatar, Card } from './ui';
import type { AbsenceType, TeamMember } from '../types';

const COLORS = ['#7c3aed', '#0ea5e9', '#db2777', '#16a34a', '#ea580c', '#64748b', '#0891b2', '#ca8a04'];

const absenceLabels: Record<AbsenceType, string> = {
  conge: 'Congés',
  formation: 'Formation',
  teletravail: 'Télétravail',
  astreinte: 'Astreinte',
  autre: 'Autre',
};

export function TeamView() {
  const { members, absences, addMember, updateMember, removeMember, addAbsenceRange, removeAbsence } = useStore();
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [showAbsenceForm, setShowAbsenceForm] = useState(false);

  const upcoming = [...absences].sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Équipe</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{members.length} personnes · 35h/semaine, matin MCO/incidents, après-midi projets</p>
        </div>
        <button onClick={() => setShowMemberForm(true)} className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700">
          + Ajouter un membre
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {members.map((m) => (
          <Card key={m.id} className="p-4">
            <div className="mb-2 flex items-center gap-3">
              <Avatar name={m.name} color={m.color} initials={m.initials} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{m.name}</div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">{m.role}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => setEditingMember(m)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                  Modifier
                </button>
                <button onClick={() => removeMember(m.id)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                  Suppr.
                </button>
              </div>
            </div>
            <div className="mb-2 flex flex-wrap gap-1">
              {m.skills.map((s) => (
                <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {s}
                </span>
              ))}
            </div>
            <div className="text-xs text-slate-400">Volume hebdo : {m.weeklyHours}h</div>
          </Card>
        ))}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Absences & indisponibilités</h2>
          <button onClick={() => setShowAbsenceForm(true)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            + Déclarer une absence
          </button>
        </div>
        <Card className="divide-y divide-slate-50 p-1 dark:divide-slate-800/60">
          {upcoming.length === 0 && <p className="p-4 text-center text-xs text-slate-400">Aucune absence déclarée.</p>}
          {upcoming.map((a) => {
            const m = members.find((mm) => mm.id === a.memberId);
            if (!m) return null;
            return (
              <div key={a.id} className="flex items-center gap-3 p-2.5 text-sm">
                <Avatar name={m.name} color={m.color} initials={m.initials} size={22} />
                <span className="w-36 shrink-0 truncate text-slate-700 dark:text-slate-200">{m.name}</span>
                <span className="w-24 shrink-0 text-xs text-slate-400">{a.date}</span>
                <span className="w-20 shrink-0 text-xs text-slate-400">{a.period === 'jour' ? 'Journée' : a.period === 'matin' ? 'Matin' : 'Après-midi'}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {absenceLabels[a.type]}
                </span>
                {a.label && <span className="hidden truncate text-xs text-slate-400 sm:block">{a.label}</span>}
                <button onClick={() => removeAbsence(a.id)} className="ml-auto text-xs text-slate-300 hover:text-red-500">
                  ✕
                </button>
              </div>
            );
          })}
        </Card>
      </div>

      {showMemberForm && (
        <MemberForm
          onCancel={() => setShowMemberForm(false)}
          onSave={(payload) => {
            addMember(payload);
            setShowMemberForm(false);
          }}
        />
      )}

      {editingMember && (
        <MemberForm
          initial={editingMember}
          onCancel={() => setEditingMember(null)}
          onSave={(payload) => {
            updateMember(editingMember.id, payload);
            setEditingMember(null);
          }}
        />
      )}

      {showAbsenceForm && (
        <AbsenceForm
          members={members}
          onCancel={() => setShowAbsenceForm(false)}
          onCreate={(payload) => {
            addAbsenceRange(payload);
            setShowAbsenceForm(false);
          }}
        />
      )}
    </div>
  );
}

function initialsFrom(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

interface MemberFormPayload {
  name: string;
  role: string;
  skills: string[];
  weeklyHours: number;
  color: string;
  initials: string;
}

function MemberForm({
  initial,
  onCancel,
  onSave,
}: {
  initial?: TeamMember;
  onCancel: () => void;
  onSave: (p: MemberFormPayload) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [skills, setSkills] = useState(initial?.skills.join(', ') ?? '');
  const [weeklyHours, setWeeklyHours] = useState(String(initial?.weeklyHours ?? 35));

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{initial ? 'Modifier le membre' : 'Ajouter un membre'}</h3>
        <div className="space-y-2.5">
          <input placeholder="Nom complet" value={name} onChange={(e) => setName(e.target.value)} className="input" />
          <input placeholder="Rôle (ex : Administrateur systèmes)" value={role} onChange={(e) => setRole(e.target.value)} className="input" />
          <input placeholder="Compétences (séparées par des virgules)" value={skills} onChange={(e) => setSkills(e.target.value)} className="input" />
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Volume hebdomadaire (h)</span>
            <input type="number" value={weeklyHours} onChange={(e) => setWeeklyHours(e.target.value)} className="input" />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
            Annuler
          </button>
          <button
            disabled={!name.trim()}
            onClick={() =>
              onSave({
                name: name.trim(),
                role: role.trim() || 'Membre équipe',
                skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
                weeklyHours: parseFloat(weeklyHours) || 0,
                color: initial?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
                initials: initialsFrom(name.trim()),
              })
            }
            className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          >
            {initial ? 'Enregistrer' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AbsenceForm({
  members,
  onCancel,
  onCreate,
}: {
  members: { id: string; name: string }[];
  onCancel: () => void;
  onCreate: (p: { memberId: string; startDate: string; endDate: string; period: 'jour' | 'matin' | 'apres_midi'; type: AbsenceType; label?: string }) => void;
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? '');
  const today = toISODate(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [period, setPeriod] = useState<'jour' | 'matin' | 'apres_midi'>('jour');
  const [type, setType] = useState<AbsenceType>('conge');
  const [label, setLabel] = useState('');

  const rangeInvalid = endDate < startDate;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Déclarer une absence</h3>
        <div className="space-y-2.5">
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="input">
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Du</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
                className="input"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Au</span>
              <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
            </label>
          </div>
          <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="input">
            <option value="jour">Journée(s) complète(s)</option>
            <option value="matin">Matin uniquement</option>
            <option value="apres_midi">Après-midi uniquement</option>
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as AbsenceType)} className="input">
            {Object.entries(absenceLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input placeholder="Précision (optionnel)" value={label} onChange={(e) => setLabel(e.target.value)} className="input" />
          <p className="text-xs text-slate-400">Les week-ends de la période sont automatiquement exclus.</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
            Annuler
          </button>
          <button
            disabled={!memberId || rangeInvalid}
            onClick={() => onCreate({ memberId, startDate, endDate, period, type, label: label || undefined })}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
