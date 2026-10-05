import { useState } from 'react';
import { useStore } from '../store/useStore';
import { addDays, formatDateLong, isToday, toISODate } from '../lib/date';
import { absencesToday, getTaskById, hoursLoggedToday } from '../lib/selectors';
import { useViewMode } from '../hooks/useViewMode';
import { Avatar, Card, ModeSwitcher, PriorityBadge, PrintButton, PrintHeader, TaskTypeBadge } from './ui';
import { useConfirm } from './ConfirmProvider';
import { DailyMailModal } from './DailyMailModal';
import type { Absence, Period, PlanningSlot, ProjectTask, TaskStatus, TeamMember, TimeEntry } from '../types';
import { useModalDismiss } from './Modal';
import { placeEntries } from '../lib/dayAllocation';
import { PERIOD_RANGES } from '../lib/hours';

const PERIOD_LABEL: Record<Period, string> = { matin: 'Matin — MCO & incidents', apres_midi: 'Après-midi — Projets' };
const PERIOD_SHORT: Record<Period, string> = { matin: 'Matin', apres_midi: 'Après-midi' };
const eligibleTypes: Record<Period, ('MCO' | 'Incident' | 'Projet')[]> = {
  matin: ['MCO', 'Incident'],
  apres_midi: ['Projet'],
};

/** Profondeur de l'historique "Dernières saisies" : les 10 derniers temps saisis PAR PERSONNE
 *  et par créneau, affichés sous le bouton de saisie du créneau concerné. Chacun voit donc ses
 *  propres saisies, là où il vient de les enregistrer. */
const RECENT_ENTRIES_DEPTH = 10;

const DAILY_VIEW_MODES = ['personne', 'creneau', 'tableau'] as const;
type DailyViewMode = (typeof DAILY_VIEW_MODES)[number];

type ConfirmFn = ReturnType<typeof useConfirm>;
/** `taskId` vide = la tâche reste à choisir dans la fenêtre (bouton « … » de la grille).
 *  `hour` renseignée = la saisie sera ancrée sur cette tranche. */
type LoggingTarget = { memberId: string; period: Period; taskId: string; hour?: number };

/** Les créneaux saisis heure par heure. Seul l'après-midi pour l'instant : le matin garde
 *  la saisie à la demi-journée, faute d'avoir été demandé. */
const HOURLY_PERIODS: Period[] = ['apres_midi'];
/** Entrée de menu qui ouvre la saisie complète. Un identifiant de tâche ne peut pas la
 *  heurter : les identifiants sont préfixés par une lettre (voir src/lib/ids.ts). */
const AUTRE = '__autre__';
const hourLabel = (n: number) => `${String(n).padStart(2, '0')}:00`;

export function DailyView() {
  const { members, tasks, planningSlots, timeEntries, absences, setPlanningSlot, updateTask, addTimeEntry, removeTimeEntry } = useStore();
  const confirm = useConfirm();
  const [date, setDate] = useState(new Date());
  const [mode, setMode] = useViewMode<DailyViewMode>('activite-jour', DAILY_VIEW_MODES, 'personne');
  const [logging, setLogging] = useState<LoggingTarget | null>(null);
  const [hours, setHours] = useState('3.5');
  const [note, setNote] = useState('');
  /** Tâche choisie dans la fenêtre quand elle a été ouverte sans en viser une (bouton « … »). */
  const [loggingTaskId, setLoggingTaskId] = useState('');
  const dismiss = useModalDismiss(() => setLogging(null), 'cette saisie de temps');
  const [showMail, setShowMail] = useState(false);


  const iso = toISODate(date);

  // `timeEntries` est une liste d'ajouts : la dernière saisie est donc la dernière du tableau.
  // On la relit à l'envers pour montrer ce qui vient d'être saisi en premier. La profondeur
  // s'applique à chaque couple personne/créneau, si bien qu'une personne qui saisit beaucoup ne
  // masque jamais les saisies de ses collègues.
  const recentEntriesFor = (memberId: string, period: Period) =>
    timeEntries
      .filter((e) => e.date === iso && e.memberId === memberId && e.period === period)
      .slice(-RECENT_ENTRIES_DEPTH)
      .reverse();

  const openLogging = (target: LoggingTarget) => {
    setLogging(target);
    // Une heure précise appelle une durée d'une heure ; sans heure, on reprend la valeur la
    // plus courante d'une saisie faite après coup.
    setHours('1');
    setNote('');
    setLoggingTaskId('');
  };

  /** Validation directe d'une tranche : une heure sur la tâche choisie, ancrée sur cette
   *  tranche. Pas de confirmation — c'est une création, annulable d'un clic sur la croix,
   *  et demander confirmation à chaque pastille retirerait tout l'intérêt du clic unique. */
  const validateHour = (memberId: string, period: Period, taskId: string, hour: number) => {
    addTimeEntry({ taskId, memberId, date: iso, period, hours: 1, hour });
  };

  /** Tout ce dont un créneau a besoin pour être affiché *et* modifié, quel que soit le mode. */
  const slotContext = {
    iso,
    date,
    tasks,
    planningSlots,
    confirm,
    setPlanningSlot,
    updateTask,
    onLogTime: openLogging,
    onValidateHour: validateHour,
    recentEntriesFor,
    onRemoveEntry: removeTimeEntry,
  };

  return (
    <div className="space-y-4">
      <PrintHeader title="Activité du jour" subtitle={formatDateLong(date)} />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Activité du jour</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{formatDateLong(date)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModeSwitcher
            value={mode}
            onChange={setMode}
            options={[
              { value: 'personne', label: 'Par personne', title: 'Une fiche par personne, matin et après-midi (vue par défaut)' },
              { value: 'creneau', label: 'Par créneau', title: "Toute l'équipe côte à côte : le matin d'un côté, l'après-midi de l'autre" },
              { value: 'tableau', label: 'Tableau', title: 'Tableau dense : une ligne par personne, une colonne par créneau' },
            ]}
          />
          <NavButton onClick={() => setDate((d) => addDays(d, -1))}>◀</NavButton>
          <button
            onClick={() => setDate(new Date())}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Aujourd'hui
          </button>
          <NavButton onClick={() => setDate((d) => addDays(d, 1))}>▶</NavButton>
          <button
            onClick={() => setShowMail(true)}
            title="Envoyer à chacun son programme du jour par mail"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            ✉ Programme par mail
          </button>
          <PrintButton />
        </div>
      </div>

      {mode === 'personne' && (
        <div className="space-y-3">
          {members.map((m) => {
            const absence = absencesToday(absences, m.id, date);
            const loggedToday = hoursLoggedToday(timeEntries, m.id, date);

            return (
              <Card key={m.id} className="p-4">
                <div className="mb-3 flex items-center gap-3">
                  <Avatar name={m.name} color={m.color} initials={m.initials} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{m.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{m.role}</div>
                  </div>
                  <div className="ml-auto text-right text-xs text-slate-500 dark:text-slate-400">
                    <div>Temps saisi aujourd'hui</div>
                    <div className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{loggedToday}h / 7h</div>
                  </div>
                </div>

                {absence?.period === 'jour' ? (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                    Absent(e) toute la journée — {absence.label ?? absence.type}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(['matin', 'apres_midi'] as Period[]).map((period) => (
                      <div key={period} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{PERIOD_LABEL[period]}</span>
                          {isToday(date) && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              aujourd'hui
                            </span>
                          )}
                        </div>
                        <SlotEditor member={m} period={period} absence={absence} {...slotContext} />
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {mode === 'creneau' && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(['matin', 'apres_midi'] as Period[]).map((period) => (
            <Card key={period} className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{PERIOD_LABEL[period]}</h2>
              <div className="space-y-3">
                {members.map((m) => {
                  const absence = absencesToday(absences, m.id, date);
                  return (
                    <div key={m.id} className="rounded-lg border border-slate-100 p-2.5 dark:border-slate-800">
                      <div className="mb-1.5 flex items-center gap-2">
                        <Avatar name={m.name} color={m.color} initials={m.initials} size={22} />
                        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{m.name}</span>
                      </div>
                      <SlotEditor member={m} period={period} absence={absence} {...slotContext} />
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {mode === 'tableau' && (
        <Card className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[860px] text-sm print:min-w-0">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400 dark:border-slate-800">
                <th className="px-3 py-2 font-medium">Personne</th>
                <th className="px-3 py-2 font-medium">{PERIOD_SHORT.matin}</th>
                <th className="px-3 py-2 font-medium">{PERIOD_SHORT.apres_midi}</th>
                <th className="px-3 py-2 font-medium">Temps saisi</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const absence = absencesToday(absences, m.id, date);
                const loggedToday = hoursLoggedToday(timeEntries, m.id, date);
                return (
                  <tr key={m.id} className="border-b border-slate-50 align-top last:border-0 dark:border-slate-800/60">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Avatar name={m.name} color={m.color} initials={m.initials} size={22} />
                        <span className="truncate font-medium text-slate-800 dark:text-slate-100">{m.name}</span>
                      </div>
                    </td>
                    {(['matin', 'apres_midi'] as Period[]).map((period) => (
                      <td key={period} className="px-3 py-2">
                        <SlotEditor member={m} period={period} absence={absence} compact {...slotContext} />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-xs tabular-nums text-slate-500 dark:text-slate-400">{loggedToday}h / 7h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {showMail && <DailyMailModal date={iso} onClose={() => setShowMail(false)} />}

      {logging && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" {...dismiss.backdrop}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" {...dismiss.content}>
            <h3 className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">Saisir le temps passé</h3>
            {logging.hour !== undefined && (
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                À partir de {hourLabel(logging.hour)} — la saisie occupera cette tranche, et les suivantes si elle dure plus d'une heure.
              </p>
            )}
            {/* Ouverte par « … », la fenêtre ne sait pas encore sur quelle tâche : c'est
                justement ce que ce bouton sert à choisir, les pastilles couvrant déjà les
                tâches assignées. */}
            {logging.taskId === '' && (
              <>
                <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Tâche</label>
                <select
                  value={loggingTaskId}
                  onChange={(e) => setLoggingTaskId(e.target.value)}
                  className="mb-3 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">— Choisir une tâche —</option>
                  {tasks
                    .filter((t) => t.status !== 'termine')
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </>
            )}
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Heures</label>
            <input
              type="number"
              min="0"
              max="7"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="mb-3 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Note (optionnel)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex : diagnostic terminé, ticket clôturé..."
              className="mb-4 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setLogging(null)} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
                Annuler
              </button>
              <button
                disabled={!(logging.taskId || loggingTaskId)}
                onClick={() => {
                  addTimeEntry({
                    taskId: logging.taskId || loggingTaskId,
                    memberId: logging.memberId,
                    date: iso,
                    period: logging.period,
                    hours: parseFloat(hours) || 0,
                    note: note || undefined,
                    hour: logging.hour,
                  });
                  setLogging(null);
                }}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
      <StatusHint />
    </div>
  );
}

/**
 * Un créneau (matin ou après-midi) d'une personne : choix de la tâche, statut, saisie du
 * temps. Partagé par les trois modes d'affichage — ils changent la mise en page, jamais ce
 * qu'on peut faire : aucun mode n'est une vue "morte" en lecture seule.
 */
function SlotEditor({
  member,
  period,
  absence,
  iso,
  tasks,
  planningSlots,
  confirm,
  setPlanningSlot,
  updateTask,
  onLogTime,
  onValidateHour,
  recentEntriesFor,
  onRemoveEntry,
  compact = false,
}: {
  member: TeamMember;
  period: Period;
  absence: Absence | undefined;
  iso: string;
  date: Date;
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  confirm: ConfirmFn;
  setPlanningSlot: (memberId: string, date: string, period: Period, taskId: string | null) => void;
  updateTask: (id: string, patch: Partial<ProjectTask>) => void;
  onLogTime: (target: LoggingTarget) => void;
  onValidateHour: (memberId: string, period: Period, taskId: string, hour: number) => void;
  recentEntriesFor: (memberId: string, period: Period) => TimeEntry[];
  onRemoveEntry: (id: string) => void;
  compact?: boolean;
}) {
  const isAbsentPeriod = absence && (absence.period === 'jour' || absence.period === period);
  const slot = planningSlots.find((s) => s.memberId === member.id && s.date === iso && s.period === period);
  const task = getTaskById(tasks, slot?.taskId);
  const memberTasks = tasks.filter(
    (t) => t.assigneeIds.includes(member.id) && eligibleTypes[period].includes(t.type) && t.status !== 'termine'
  );
  const entries = recentEntriesFor(member.id, period);

  // Saisie heure par heure : seulement là où elle est prévue, et seulement en affichage
  // large. Le mode Tableau est une grille dense d'une ligne par personne ; y empiler
  // quatre rangées de pastilles le rendrait illisible, il garde donc la saisie globale.
  const parHeure = HOURLY_PERIODS.includes(period) && !compact;
  const occupants = parHeure ? placeEntries(period, entries) : null;
  // Les saisies qu'aucune tranche ne montre — créneau déjà plein, ou saisie antérieure à
  // la grille. Elles restent listées : rien de ce qui a été saisi ne doit disparaître de
  // l'écran sous prétexte que la grille ne sait pas où le mettre.
  const horsGrille = occupants ? entries.filter((e) => ![...occupants.values()].includes(e)) : entries;

  const history = (
    <SlotEntries
      entries={horsGrille}
      tasks={tasks}
      memberName={member.name}
      confirm={confirm}
      onRemove={onRemoveEntry}
      titre={parHeure ? 'Autres saisies' : 'Dernières saisies'}
    />
  );

  // Une absence déclarée après coup n'efface pas le temps déjà saisi : on continue de le montrer.
  if (isAbsentPeriod) {
    return (
      <>
        <div className="text-sm text-slate-400">Absent(e) — {absence?.label ?? absence?.type}</div>
        {history}
      </>
    );
  }

  return (
    <>
      <select
        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        value={task?.id ?? ''}
        onChange={async (e) => {
          const value = e.target.value;
          const label = value ? memberTasks.find((t) => t.id === value)?.title : 'aucune tâche';
          if (await confirm({ title: 'Confirmer la modification', message: `Affecter "${label}" à ${member.name} sur ce créneau ?` })) {
            setPlanningSlot(member.id, iso, period, value || null);
          }
        }}
      >
        <option value="">— Non planifié —</option>
        {memberTasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>

      {task && (
        <div className="mt-2 space-y-2">
          {!compact && (
            <div className="flex flex-wrap items-center gap-2">
              <TaskTypeBadge type={task.type} />
              <PriorityBadge priority={task.priority} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <select
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              value={task.status}
              onChange={async (e) => {
                const value = e.target.value as TaskStatus;
                if (await confirm({ title: 'Confirmer la modification', message: `Changer le statut de "${task.title}" ?` })) {
                  updateTask(task.id, { status: value });
                }
              }}
            >
              <option value="a_faire">À faire</option>
              <option value="en_cours">En cours</option>
              <option value="en_attente">En attente</option>
              <option value="termine">Terminé</option>
            </select>
            {!parHeure && (
              <button
                className="ml-auto rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700 print:hidden"
                onClick={() => onLogTime({ memberId: member.id, period, taskId: task.id })}
              >
                + Saisir temps
              </button>
            )}
          </div>
        </div>
      )}

      {parHeure && (
        <HourGrid
          period={period}
          memberTasks={memberTasks}
          plannedTask={task}
          occupants={occupants!}
          tasks={tasks}
          memberName={member.name}
          confirm={confirm}
          onValidate={(taskId, hour) => onValidateHour(member.id, period, taskId, hour)}
          onOther={(hour) => onLogTime({ memberId: member.id, period, taskId: '', hour })}
          onRemoveEntry={onRemoveEntry}
        />
      )}

      {history}
    </>
  );
}

/**
 * Grille horaire d'un créneau : une ligne par tranche d'une heure, chacune avec un menu
 * déroulant et un bouton Valider.
 *
 * Les tâches étaient d'abord affichées en pastilles, une par tâche et par heure : un seul
 * clic suffisait, mais quatre tranches multipliées par les tâches de la personne prenaient
 * trop de hauteur et repoussaient le reste de la fiche hors de l'écran. Un menu déroulant
 * tient sur une ligne quel que soit le nombre de tâches, et c'est ce que coûte le second
 * clic.
 *
 * Le menu propose la tâche prévue EN PREMIER et la présélectionne : le cas courant — une
 * heure de plus sur ce qui était prévu — redevient alors un clic unique sur Valider, sans
 * rien déplier.
 *
 * Une tranche déjà occupée affiche l'activité en vert plutôt que le menu : on ne propose
 * pas de remplir ce qui l'est. La croix défait la saisie, et dit sa durée réelle — retirer
 * une tranche d'une saisie de trois heures les retire toutes les trois, et l'annoncer évite
 * de le découvrir après coup.
 */
function HourGrid({
  period,
  memberTasks,
  plannedTask,
  occupants,
  tasks,
  memberName,
  confirm,
  onValidate,
  onOther,
  onRemoveEntry,
}: {
  period: Period;
  memberTasks: ProjectTask[];
  plannedTask: ProjectTask | undefined;
  occupants: Map<number, TimeEntry>;
  tasks: ProjectTask[];
  memberName: string;
  confirm: ConfirmFn;
  onValidate: (taskId: string, hour: number) => void;
  onOther: (hour: number) => void;
  onRemoveEntry: (id: string) => void;
}) {
  const { start, end } = PERIOD_RANGES[period];
  const heures = Array.from({ length: end - start }, (_, i) => start + i);
  // La tâche prévue d'abord : c'est celle qu'on valide le plus souvent, et la chercher au
  // milieu des autres à chaque heure serait une friction inutile.
  const choix = plannedTask ? [plannedTask, ...memberTasks.filter((t) => t.id !== plannedTask.id)] : memberTasks;
  const valides = heures.filter((h) => occupants.has(h)).length;

  // Ce que chaque menu affiche tant que l'heure n'est pas validée. Non renseigné, le menu
  // retombe sur la tâche prévue : valider une heure de plus sur ce qui était prévu ne
  // demande alors qu'un clic.
  const [selection, setSelection] = useState<Record<number, string>>({});
  const valeur = (h: number) => selection[h] ?? plannedTask?.id ?? '';

  return (
    <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Heure par heure</span>
        <span className="text-[10px] tabular-nums text-slate-400">
          {valides}h validée(s) sur {heures.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {heures.map((h) => {
          const occupant = occupants.get(h);
          const tache = occupant ? getTaskById(tasks, occupant.taskId) : undefined;
          return (
            <div key={h} className="flex items-start gap-2">
              <span className="w-[5.5rem] shrink-0 pt-1 text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400">
                {hourLabel(h)} – {hourLabel(h + 1)}
              </span>

              {occupant ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <span className="shrink-0 text-emerald-600 dark:text-emerald-400">✓</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                    {tache?.title ?? 'Tâche supprimée'}
                    {occupant.note && <span className="text-slate-400 dark:text-slate-500"> — « {occupant.note} »</span>}
                  </span>
                  <span className="shrink-0 text-[10px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {occupant.hours}h
                  </span>
                  <button
                    onClick={async () => {
                      const message =
                        occupant.hours > 1
                          ? `Cette saisie couvre ${occupant.hours}h : l'annuler retirera toutes ses heures, pas seulement ${hourLabel(h)}. Continuer ?`
                          : `Annuler l'heure de ${hourLabel(h)} sur "${tache?.title ?? 'cette tâche'}" pour ${memberName} ?`;
                      if (await confirm({ title: 'Annuler cette saisie', message, confirmLabel: 'Annuler la saisie', danger: true })) {
                        onRemoveEntry(occupant.id);
                      }
                    }}
                    title={occupant.hours > 1 ? `Annuler cette saisie de ${occupant.hours}h` : 'Annuler cette heure'}
                    className="shrink-0 rounded px-1 text-slate-300 hover:bg-red-50 hover:text-red-600 dark:text-slate-600 dark:hover:bg-red-500/10 print:hidden"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-1.5 print:hidden">
                  <select
                    value={valeur(h)}
                    onChange={(e) => {
                      // L'entrée « autre » n'est pas une tâche : elle ouvre la saisie
                      // complète plutôt que de se retrouver sélectionnée dans le menu.
                      if (e.target.value === AUTRE) return onOther(h);
                      setSelection((s) => ({ ...s, [h]: e.target.value }));
                    }}
                    className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="">— Non planifié —</option>
                    {choix.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                    <option value={AUTRE}>… Autre tâche, autre durée, note</option>
                  </select>
                  <button
                    disabled={!valeur(h)}
                    onClick={() => onValidate(valeur(h), h)}
                    title={`Valider ${hourLabel(h)} – ${hourLabel(h + 1)}`}
                    className="shrink-0 rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-30"
                  >
                    Valider
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {choix.length === 0 && (
        <p className="mt-1.5 text-[11px] text-slate-400">
          Aucune tâche de type Projet ouverte pour {memberName} : choisissez «&nbsp;Autre tâche&nbsp;» dans le menu pour saisir malgré
          tout, ou assignez-lui une tâche depuis l'onglet Tâches.
        </p>
      )}
    </div>
  );
}

/**
 * Les dernières saisies de temps du créneau, juste sous le bouton "+ Saisir temps" qui vient de
 * les créer — le plus récent en haut, supprimable d'un clic en cas d'erreur. Limité à
 * RECENT_ENTRIES_DEPTH par personne et par créneau ; rien n'est affiché tant qu'aucun temps n'a
 * été saisi, pour ne pas alourdir un créneau vide.
 */
function SlotEntries({
  entries,
  tasks,
  memberName,
  confirm,
  onRemove,
  titre = 'Dernières saisies',
}: {
  entries: TimeEntry[];
  tasks: ProjectTask[];
  memberName: string;
  confirm: ConfirmFn;
  onRemove: (id: string) => void;
  /** « Autres saisies » quand une grille horaire montre déjà le reste, pour ne pas laisser
   *  croire que cette liste est tout ce qui a été saisi. */
  titre?: string;
}) {
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, e) => sum + e.hours, 0);

  return (
    <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{titre}</span>
        <span className="text-[10px] tabular-nums text-slate-400">
          {entries.length} · {total}h
        </span>
      </div>
      <ul className="space-y-0.5">
        {entries.map((e) => {
          const task = getTaskById(tasks, e.taskId);
          return (
            <li key={e.id} className="flex items-baseline gap-1.5 text-xs">
              <span className="shrink-0 font-semibold tabular-nums text-slate-700 dark:text-slate-200">{e.hours}h</span>
              <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">
                {task?.title ?? 'Tâche supprimée'}
                {e.note && <span className="text-slate-400 dark:text-slate-500"> — « {e.note} »</span>}
              </span>
              <button
                onClick={async () => {
                  if (
                    await confirm({
                      title: 'Supprimer la saisie',
                      message: `Supprimer les ${e.hours}h saisies par ${memberName} sur "${task?.title ?? 'cette tâche'}" ?`,
                    })
                  ) {
                    onRemove(e.id);
                  }
                }}
                title="Supprimer cette saisie"
                className="shrink-0 rounded px-1 text-slate-300 hover:bg-red-50 hover:text-red-600 dark:text-slate-600 dark:hover:bg-red-500/10 print:hidden"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NavButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  );
}

function StatusHint() {
  return (
    <p className="text-xs text-slate-400 dark:text-slate-500">
      Le matin est réservé au MCO et aux incidents, l'après-midi aux projets. Choisissez la tâche en cours pour chaque créneau et
      saisissez le temps passé au fil de l'eau. L'après-midi se valide <strong>heure par heure</strong> : choisissez l'activité et
      cliquez sur Valider. La tâche prévue étant déjà proposée, une heure de plus sur ce qui était prévu ne demande qu'un clic.
    </p>
  );
}
