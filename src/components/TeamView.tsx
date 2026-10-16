import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { addDays, isWeekend, toISODate, VOLUME_HEBDO_DEFAUT } from '../lib/date';

/** La valeur par défaut d'avant le passage à 8 h par jour. Sert uniquement à repérer les
 *  fiches jamais revues depuis, pour proposer de les mettre à jour. */
const ANCIEN_VOLUME = 35;
import { Avatar, Card, PrintButton, PrintHeader } from './ui';
import { useConfirm } from './ConfirmProvider';
import type { AbsenceType, TeamMember } from '../types';
import { useModalDismiss } from './Modal';

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
  const confirm = useConfirm();
  const [showMemberForm, setShowMemberForm] = useState(false);

  // Les fiches restées à l'ancienne valeur par défaut, et elle seule : qui a délibérément
  // saisi 28 h ou 21 h n'est pas concerné.
  const aRemettre = members.filter((m) => m.weeklyHours === ANCIEN_VOLUME);
  const passerA40 = async () => {
    if (
      await confirm({
        title: `Passer à ${VOLUME_HEBDO_DEFAUT} h par semaine`,
        message: `${aRemettre.map((m) => m.name).join(', ')} ${
          aRemettre.length === 1 ? 'passera' : 'passeront'
        } de ${ANCIEN_VOLUME} h à ${VOLUME_HEBDO_DEFAUT} h. Les capacités, les taux de charge et l'historique des mois passés seront recalculés sur cette base — les heures déjà saisies, elles, ne bougent pas.`,
        confirmLabel: 'Mettre à jour',
      })
    ) {
      for (const m of aRemettre) updateMember(m.id, { weeklyHours: VOLUME_HEBDO_DEFAUT });
    }
  };
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [showAbsenceForm, setShowAbsenceForm] = useState(false);

  const upcoming = [...absences].sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="space-y-6">
      <PrintHeader title="Équipe" subtitle={`${members.length} personnes · 40h/semaine (8h/jour), matin MCO/incidents, après-midi projets`} />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Équipe</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{members.length} personnes · 40h/semaine (8h/jour), matin MCO/incidents, après-midi projets</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton />
          <button onClick={() => setShowMemberForm(true)} className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700">
            + Ajouter un membre
          </button>
        </div>
      </div>

      {/* Le passage à 8 h par jour ne réécrit rien tout seul : le volume hebdomadaire est
          une donnée d'équipe, saisie personne par personne, et un temps partiel à 35 h
          n'est pas un reliquat de l'ancienne valeur par défaut. On signale, on propose,
          on n'applique que sur un clic. */}
      {aRemettre.length > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-amber-200 bg-amber-50 p-3 print:hidden dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-200">
            <strong>{aRemettre.length === 1 ? 'Une personne est' : `${aRemettre.length} personnes sont`}</strong> encore à{' '}
            {ANCIEN_VOLUME} h par semaine, alors que le service compte désormais 8 h par jour ({VOLUME_HEBDO_DEFAUT} h).
            Tant qu'elles y restent, leur capacité et leur charge se calculent sur {ANCIEN_VOLUME} h.
          </p>
          <button
            onClick={() => void passerA40()}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            Passer {aRemettre.length === 1 ? 'cette personne' : `ces ${aRemettre.length} personnes`} à {VOLUME_HEBDO_DEFAUT} h
          </button>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {members.map((m) => (
          <Card key={m.id} className="p-4">
            <div className="mb-2 flex items-center gap-3">
              <Avatar name={m.name} color={m.color} initials={m.initials} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{m.name}</div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">{m.role}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1 print:hidden">
                <button onClick={() => setEditingMember(m)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                  Modifier
                </button>
                <button
                  onClick={async () => {
                    if (await confirm({ title: 'Supprimer le membre', message: `Supprimer définitivement ${m.name} de l'équipe ?`, confirmLabel: 'Supprimer', danger: true })) {
                      removeMember(m.id);
                    }
                  }}
                  className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                >
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
            <div className="truncate text-xs text-slate-400" title={m.email || undefined}>
              {m.email ? `✉ ${m.email}` : <span className="text-slate-300 dark:text-slate-600">✉ pas d'adresse mail</span>}
            </div>
          </Card>
        ))}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Absences & indisponibilités</h2>
          <button
            onClick={() => setShowAbsenceForm(true)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 print:hidden"
          >
            + Déclarer une absence
          </button>
        </div>
        <Card className="divide-y divide-slate-50 p-1 dark:divide-slate-800/60">
          {upcoming.length === 0 && <p className="p-4 text-center text-xs text-slate-400">Aucune absence déclarée.</p>}
          {upcoming.map((a) => {
            const m = members.find((mm) => mm.id === a.memberId);
            if (!m) return null;
            return (
              /* Quatre colonnes fixes se suivaient : 22 + 144 + 96 + 80 px, plus la pastille
                 et le bouton de suppression — soit plus qu'un écran de téléphone. Le nom
                 devient élastique et la ligne se replie. */
              <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5 text-sm">
                <Avatar name={m.name} color={m.color} initials={m.initials} size={22} />
                <span className="min-w-0 flex-1 truncate text-slate-700 sm:w-36 sm:flex-none dark:text-slate-200">{m.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-400 sm:w-24">{a.date}</span>
                <span className="shrink-0 text-xs text-slate-400 sm:w-20">{a.period === 'jour' ? 'Journée' : a.period === 'matin' ? 'Matin' : 'Après-midi'}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {absenceLabels[a.type]}
                </span>
                {a.label && <span className="hidden truncate text-xs text-slate-400 sm:block">{a.label}</span>}
                <button
                  onClick={async () => {
                    if (await confirm({ title: "Supprimer l'absence", message: `Supprimer l'absence de ${m.name} le ${a.date} ?`, confirmLabel: 'Supprimer', danger: true })) {
                      removeAbsence(a.id);
                    }
                  }}
                  className="ml-auto text-xs text-slate-300 hover:text-red-500 print:hidden"
                >
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
          onSave={async (payload) => {
            if (await confirm({ title: 'Confirmer la modification', message: `Enregistrer les modifications apportées à ${editingMember.name} ?` })) {
              updateMember(editingMember.id, payload);
              setEditingMember(null);
            }
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
  email: string;
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
  const dismiss = useModalDismiss(onCancel, initial ? 'cette fiche' : 'ce nouveau membre');
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [skills, setSkills] = useState(initial?.skills.join(', ') ?? '');
  const [weeklyHours, setWeeklyHours] = useState(String(initial?.weeklyHours ?? VOLUME_HEBDO_DEFAUT));

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" {...dismiss.backdrop}>
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" {...dismiss.content}>
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{initial ? 'Modifier le membre' : 'Ajouter un membre'}</h3>
        <div className="space-y-2.5">
          <input placeholder="Nom complet" value={name} onChange={(e) => setName(e.target.value)} className="input" />
          <input placeholder="Rôle (ex : Administrateur systèmes)" value={role} onChange={(e) => setRole(e.target.value)} className="input" />
          <input
            type="email"
            placeholder="Adresse mail professionnelle (programme du jour)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
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
                email: email.trim(),
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
  onCreate: (p: {
    memberId: string;
    startDate: string;
    endDate: string;
    period: 'jour' | 'matin' | 'apres_midi';
    type: AbsenceType;
    label?: string;
    inclureWeekend: boolean;
  }) => void;
}) {
  const dismiss = useModalDismiss(onCancel, 'cette absence');
  const [memberId, setMemberId] = useState(members[0]?.id ?? '');
  const today = toISODate(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [period, setPeriod] = useState<'jour' | 'matin' | 'apres_midi'>('jour');
  const [type, setType] = useState<AbsenceType>('conge');
  const [label, setLabel] = useState('');
  const [inclureWeekend, setInclureWeekend] = useState(false);

  const rangeInvalid = endDate < startDate;

  // Le nombre de jours réellement créés, annoncé avant d'enregistrer : c'est la seule
  // façon de voir d'un coup d'œil que le week-end a bien été écarté — ou qu'il ne l'a pas
  // été, ce qui se découvrait jusqu'ici dans la grille de planning, une fois posé.
  const joursCrees = useMemo(() => {
    if (rangeInvalid) return 0;
    let n = 0;
    for (let d = new Date(startDate); d <= new Date(endDate); d = addDays(d, 1)) {
      if (!inclureWeekend && isWeekend(d)) continue;
      n += 1;
    }
    return n;
  }, [startDate, endDate, inclureWeekend, rangeInvalid]);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" {...dismiss.backdrop}>
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" {...dismiss.content}>
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
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={inclureWeekend}
              onChange={(e) => setInclureWeekend(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded"
            />
            <span>
              Inclure les samedis et dimanches
              <span className="block text-xs text-slate-400">
                À cocher pour une astreinte ou un télétravail de week-end. Des congés posés du lundi au dimanche créeraient sinon
                deux jours d'absence que personne n'aurait travaillés, qui gonflent le décompte du rapport.
              </span>
            </span>
          </label>
          <p className="text-xs text-slate-400">
            {rangeInvalid
              ? 'La date de fin précède la date de début.'
              : joursCrees === 0
                ? 'Aucun jour à créer : la période ne contient que des samedis et dimanches, et ils sont exclus.'
                : `${joursCrees} jour(s) seront créés${inclureWeekend ? '' : ', week-end exclu'}.`}
            {' '}Choisissez « Matin uniquement » ou « Après-midi uniquement » ci-dessus si l'absence ne couvre qu'une demi-journée
            par jour.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
            Annuler
          </button>
          <button
            disabled={!memberId || rangeInvalid || joursCrees === 0}
            onClick={() => onCreate({ memberId, startDate, endDate, period, type, label: label || undefined, inclureWeekend })}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
