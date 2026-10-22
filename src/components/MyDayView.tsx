import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { MeteoVoteCard } from './MeteoVoteCard';
import { GlpiTicketsCard } from './GlpiTicketsCard';
import { BandeauReferentDuJour } from './ReferentJourCard';
import { Avatar, Card, PriorityBadge, TaskTypeBadge } from './ui';
import { formatDateLong, toISODate } from '../lib/date';
import { absencesToday, hoursLoggedToday } from '../lib/selectors';
import { formatDuree, heuresRecurrentes } from '../lib/recurrences';
import { useRecurrences } from '../hooks/useRecurrences';
import { entriesFor, placeEntries } from '../lib/dayAllocation';
import { PERIOD_RANGES, formatHour } from '../lib/hours';
import { resolveMember, setStoredMemberId } from '../lib/identity';
import { cibleDuJour, libelleTempsOccupe } from '../lib/workload';
import { joursIncomplets } from '../lib/saisieEnRetard';
import type { Period, ProjectTask, TeamMember } from '../types';
import type { Tab } from '../App';

/**
 * « Ma journée » — l'écran d'accueil de la personne connectée.
 *
 * Tout le monde arrivait jusqu'ici sur le tableau de bord de l'équipe. Pour quatre
 * personnes sur cinq, ce n'est pas la bonne question : un technicien qui ouvre
 * l'application vient saisir son temps ou voir ce qu'il a à faire, et devait d'abord se
 * retrouver dans une liste de collègues. Le tableau de bord d'équipe reste à un clic, pour
 * qui pilote.
 *
 * L'écran ne montre que ce sur quoi on peut agir aujourd'hui : ce qui presse, ce qui
 * manque, ce qui vient. Tout le reste est à un clic, et n'a pas sa place ici.
 */

const PERIODES: Period[] = ['matin', 'apres_midi'];
const PERIODE_LABEL: Record<Period, string> = { matin: 'Matin', apres_midi: 'Après-midi' };

export function MyDayView({ onNavigate, onOuvrirJour }: { onNavigate: (t: Tab) => void; onOuvrirJour: (d: Date) => void }) {
  const { members, tasks, planningSlots, timeEntries, absences, copils } = useStore();
  const session = useSessionLike();
  // `choix` compte les fois où la personne s'est désignée. Il doit entrer dans les
  // dépendances du calcul : le choix est écrit dans localStorage, que React ne surveille
  // pas — sans lui, resolveMember rendait son résultat précédent et l'écran restait sur la
  // question « Qui êtes-vous ? » alors qu'on venait d'y répondre.
  const [choix, forcer] = useState(0);
  // `choix` est une dépendance que la règle juge inutile : elle ne voit pas que
  // resolveMember lit localStorage, que React ne surveille pas. Sans elle, l'écran reste
  // sur « Qui êtes-vous ? » après qu'on y a répondu.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { member, source } = useMemo(() => resolveMember(members, session), [members, session, choix]);

  if (members.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
        Aucun membre dans l'équipe pour l'instant.
        <button onClick={() => onNavigate('team')} className="ml-1 font-medium text-violet-600 hover:underline dark:text-violet-400">
          Ajouter l'équipe →
        </button>
      </Card>
    );
  }

  if (!member) {
    return (
      <QuiEtesVous
        members={members}
        onChoisir={(id) => {
          setStoredMemberId(id);
          forcer((n) => n + 1);
        }}
      />
    );
  }

  return (
    <MaJournee
      member={member}
      source={source}
      onChangerDePersonne={() => {
        setStoredMemberId(null);
        forcer((n) => n + 1);
      }}
      onNavigate={onNavigate}
      onOuvrirJour={onOuvrirJour}
      data={{ tasks, planningSlots, timeEntries, absences, copils, members }}
    />
  );
}

/**
 * La session serveur n'est pas dans le store : elle vit dans App.tsx. Plutôt que de la
 * faire descendre à travers trois composants, on relit ce que l'application a déjà
 * déposé — voir `publishSession` dans App.tsx. Un seul endroit décide qui est connecté.
 */
function useSessionLike(): { username?: string; name?: string } | null {
  const [s] = useState(() => {
    const w = window as unknown as { __suiviSession?: { username?: string; name?: string } | null };
    return w.__suiviSession ?? null;
  });
  return s;
}

function QuiEtesVous({ members, onChoisir }: { members: TeamMember[]; onChoisir: (id: string) => void }) {
  return (
    <Card className="mx-auto max-w-lg p-5">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Qui êtes-vous&nbsp;?</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Les comptes de connexion et les fiches de l'équipe sont deux choses distinctes&nbsp;: rien ne permet de les rapprocher
        automatiquement ici. Désignez-vous une fois, ce poste s'en souviendra.
      </p>
      <div className="mt-3 space-y-1.5">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => onChoisir(m.id)}
            className="flex w-full items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-violet-300 hover:bg-violet-50 dark:border-slate-700 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10"
          >
            <Avatar name={m.name} color={m.color} initials={m.initials} size={28} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{m.name}</span>
              <span className="block truncate text-xs text-slate-400">{m.role}</span>
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

interface Donnees {
  tasks: ReturnType<typeof useStore.getState>['tasks'];
  planningSlots: ReturnType<typeof useStore.getState>['planningSlots'];
  timeEntries: ReturnType<typeof useStore.getState>['timeEntries'];
  absences: ReturnType<typeof useStore.getState>['absences'];
  copils: ReturnType<typeof useStore.getState>['copils'];
  members: TeamMember[];
}

function MaJournee({
  member,
  source,
  onChangerDePersonne,
  onNavigate,
  onOuvrirJour,
  data,
}: {
  member: TeamMember;
  source: string;
  onChangerDePersonne: () => void;
  onNavigate: (t: Tab) => void;
  /** Ouvrir Activité du jour sur une date précise — le rattrapage d'un jour passé. */
  onOuvrirJour: (d: Date) => void;
  data: Donnees;
}) {
  const aujourdhui = new Date();
  const iso = toISODate(aujourdhui);
  const { tasks, planningSlots, timeEntries, absences, copils } = data;

  const recurrences = useRecurrences();
  const absence = absencesToday(absences, member.id, aujourdhui);
  const saisies = hoursLoggedToday(timeEntries, member.id, aujourdhui);
  // Les créneaux récurrents du jour s'ajoutent aux heures saisies : sans eux, tout le monde
  // paraîtrait en retard de saisie le vendredi après-midi, réunion comprise.
  const recurrentes = heuresRecurrentes({ recurrences, date: aujourdhui, memberId: member.id, absences, timeEntries });
  const occupe = Math.round((saisies + recurrentes) * 100) / 100;

  const mesTaches = useMemo(
    () => tasks.filter((t) => t.assigneeIds.includes(member.id) && t.status !== 'termine'),
    [tasks, member.id]
  );

  /** Ce qui presse : en retard d'abord, puis par priorité, puis par échéance la plus proche. */
  const parUrgence = useMemo(() => {
    const rang = { critique: 0, haute: 1, normale: 2, basse: 3 } as const;
    return [...mesTaches].sort((a, b) => {
      const retardA = a.dueDate && a.dueDate < iso ? 0 : 1;
      const retardB = b.dueDate && b.dueDate < iso ? 0 : 1;
      if (retardA !== retardB) return retardA - retardB;
      if (rang[a.priority] !== rang[b.priority]) return rang[a.priority] - rang[b.priority];
      return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
    });
  }, [mesTaches, iso]);

  const enRetard = mesTaches.filter((t) => t.dueDate && t.dueDate < iso);
  const prioritaire = parUrgence[0];

  /**
   * Les jours ouvrés passés où il reste des heures à saisir (voir saisieEnRetard.ts).
   * Sans ce rappel, la veille non saisie disparaissait de l'écran à minuit.
   */
  const joursACompleter = useMemo(
    // La date est reconstruite depuis `iso` plutôt que reprise de `aujourdhui` : un objet
    // Date recréé à chaque rendu relancerait le calcul en boucle. Midi, pour qu'un
    // changement d'heure ne fasse jamais basculer le jour.
    () => joursIncomplets({ member, timeEntries, absences, recurrences, aujourdhui: new Date(`${iso}T12:00:00`) }),
    [member, timeEntries, absences, recurrences, iso]
  );

  /** Les tranches d'une heure non renseignées, créneau par créneau. */
  const manquantes = useMemo(() => {
    const trous: { period: Period; heures: number[] }[] = [];
    for (const period of PERIODES) {
      if (absence && (absence.period === 'jour' || absence.period === period)) continue;
      const { parTranche: occupes } = placeEntries(period, entriesFor(timeEntries, member.id, iso, period));
      const { start, end } = PERIOD_RANGES[period];
      const heures: number[] = [];
      for (let h = start; h < end; h++) if (!occupes.has(h)) heures.push(h);
      if (heures.length > 0) trous.push({ period, heures });
    }
    return trous;
  }, [timeEntries, member.id, iso, absence]);

  /** Mon programme : ce qui est prévu, et ce qui a été saisi, tranche par tranche. */
  const programme = useMemo(
    () =>
      PERIODES.map((period) => {
        const slot = planningSlots.find((s) => s.memberId === member.id && s.date === iso && s.period === period);
        const prevue = tasks.find((t) => t.id === slot?.taskId);
        const { parTranche: occupes } = placeEntries(period, entriesFor(timeEntries, member.id, iso, period));
        const { start, end } = PERIOD_RANGES[period];
        const tranches = [];
        for (let h = start; h < end; h++) {
          const e = occupes.get(h);
          tranches.push({ hour: h, tache: e ? tasks.find((t) => t.id === e.taskId) : undefined, saisi: Boolean(e) });
        }
        return { period, prevue, tranches };
      }),
    [planningSlots, tasks, timeEntries, member.id, iso]
  );

  /** La prochaine séance de COPIL et ce qu'on m'y doit. */
  const prochainCopil = useMemo(() => {
    const avenir = copils.filter((c) => c.date >= iso).sort((a, b) => a.date.localeCompare(b.date));
    const c = avenir[0];
    if (!c) return null;
    const miennes = c.actions.filter((a) => a.ownerIds.includes(member.id) && a.status !== 'termine');
    const jours = Math.round((new Date(c.date).getTime() - new Date(iso).getTime()) / 86400000);
    return { copil: c, miennes, jours };
  }, [copils, iso, member.id]);

  const cible = cibleDuJour(member, absences, aujourdhui);

  return (
    <div className="space-y-4">
      {/* --- En-tête --- */}
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={member.name} color={member.color} initials={member.initials} size={40} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-slate-900 dark:text-white">Bonjour {member.name.split(' ').slice(-1)[0]}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {formatDateLong(aujourdhui)} · <span className="tabular-nums">{libelleTempsOccupe(occupe, cible, 'sur')}</span>
            {recurrentes > 0 && <span className="text-indigo-600 dark:text-indigo-300"> · dont {formatDuree(recurrentes)} récurrent</span>}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={onChangerDePersonne}
            title={source === 'choisi' ? 'Vous vous êtes désigné sur ce poste' : `Reconnu par : ${source}`}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Ce n'est pas moi
          </button>
          <button
            onClick={() => onNavigate('dashboard')}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Voir l'équipe →
          </button>
        </div>
      </div>

      {absence?.period === 'jour' && (
        <Card className="border-slate-200 p-3 dark:border-slate-700">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Vous êtes noté(e) absent(e) toute la journée — {absence.label ?? absence.type}. Rien n'est attendu de vous aujourd'hui.
          </p>
        </Card>
      )}

      <BandeauReferentDuJour memberId={member.id} onOuvrirPlanning={() => onNavigate('planning')} />

      {/* Le jeudi et le vendredi seulement : la tuile se montre d'elle-même pendant la
          fenêtre de vote, et ne rend rien le reste du temps. */}
      <MeteoVoteCard />

      {/* --- Les trois choses sur lesquelles agir --- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tuile
          ton={enRetard.length > 0 ? 'rouge' : prioritaire ? 'neutre' : 'vert'}
          titre={enRetard.length > 0 ? `${enRetard.length} tâche(s) en retard` : 'À traiter en priorité'}
        >
          {prioritaire ? (
            <>
              <button onClick={() => onNavigate('tasks')} className="block w-full text-left">
                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{prioritaire.title}</span>
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <TaskTypeBadge type={prioritaire.type} />
                <PriorityBadge priority={prioritaire.priority} />
                {prioritaire.dueDate && (
                  <span className={`text-xs ${prioritaire.dueDate < iso ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
                    {prioritaire.dueDate < iso ? 'En retard depuis le ' : 'Échéance '}
                    {prioritaire.dueDate}
                  </span>
                )}
              </div>
              {mesTaches.length > 1 && (
                <button onClick={() => onNavigate('tasks')} className="mt-1.5 text-xs text-violet-600 hover:underline dark:text-violet-400">
                  {mesTaches.length - 1} autre(s) tâche(s) ouverte(s) →
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Aucune tâche ouverte ne vous est assignée.</p>
          )}
        </Tuile>

        {/* Les jours passés rejoignent cette tuile plutôt que d'en occuper une quatrième,
            qui resterait seule sur une deuxième rangée. C'est le même sujet : ce qu'il
            reste à saisir. */}
        <Tuile ton={manquantes.length > 0 || joursACompleter.length > 0 ? 'ambre' : 'vert'} titre="Heures à valider">
          {manquantes.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {absence?.period === 'jour' ? 'Journée d’absence : rien à saisir.' : 'Tout est saisi pour aujourd’hui.'}
            </p>
          ) : (
            <>
              {manquantes.map((t) => (
                <p key={t.period} className="text-sm text-slate-700 dark:text-slate-200">
                  <span className="text-slate-400">{PERIODE_LABEL[t.period]} :</span>{' '}
                  {t.heures.map(formatHour).join(', ')}
                </p>
              ))}
              <button
                onClick={() => onNavigate('daily')}
                className="mt-1.5 text-xs font-medium text-amber-700 underline dark:text-amber-400"
              >
                Compléter dans Activité du jour →
              </button>
            </>
          )}

          {joursACompleter.length > 0 && (
            <div className="mt-2 border-t border-amber-200/70 pt-2 dark:border-amber-500/30">
              <div className="text-xs text-amber-700 dark:text-amber-400">Jours passés à compléter</div>
              {joursACompleter.map((j) => (
                <button
                  key={j.iso}
                  onClick={() => onOuvrirJour(j.date)}
                  className="mt-0.5 block w-full text-left text-sm text-slate-700 underline-offset-2 hover:underline dark:text-slate-200"
                >
                  {formatDateLong(j.date)}
                  <span className="text-slate-400"> — {j.saisi}h sur {j.cible}h</span>
                </button>
              ))}
            </div>
          )}
        </Tuile>

        <Tuile ton="neutre" titre="Prochaine échéance">
          {prochainCopil ? (
            <>
              <button onClick={() => onNavigate('copils')} className="block w-full text-left">
                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{prochainCopil.copil.title}</span>
              </button>
              <p className="mt-0.5 text-xs text-slate-400">
                {prochainCopil.jours === 0 ? "Aujourd'hui" : `Dans ${prochainCopil.jours} jour(s)`}
                {prochainCopil.copil.location ? ` · ${prochainCopil.copil.location}` : ''}
              </p>
              {prochainCopil.miennes.length > 0 && (
                <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  {prochainCopil.miennes.length} action(s) à vous&nbsp;: {prochainCopil.miennes[0].label}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Aucune séance de COPIL à venir.</p>
          )}
        </Tuile>
      </div>

      {/* --- Mon programme, et en face la file de tickets --- */}
      {/* Une rangée plutôt qu'une grille : quand GLPI n'est pas raccordé, la tuile ne
          rend rien et le programme reprend toute la largeur, sans colonne vide. */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        <Card className="min-w-0 flex-1 p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Mon programme</h2>
            <button onClick={() => onNavigate('daily')} className="text-xs text-violet-600 hover:underline dark:text-violet-400">
              Modifier →
            </button>
          </div>
          {absence?.period === 'jour' ? (
            <p className="text-sm text-slate-400">Absent(e) toute la journée.</p>
          ) : (
            <div className="space-y-3">
              {programme.map(({ period, prevue, tranches }) => (
                <div key={period}>
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{PERIODE_LABEL[period]}</span>
                    <span className="min-w-0 truncate text-xs text-slate-400">
                      {prevue ? `prévu : ${prevue.title}` : 'aucun créneau prévu'}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {tranches.map(({ hour, tache, saisi }) => (
                      <div key={hour} className="flex items-baseline gap-3 text-sm">
                        <span className="w-[5.5rem] shrink-0 text-xs tabular-nums text-slate-400">
                          {formatHour(hour)} – {formatHour(hour + 1)}
                        </span>
                        <span className={`min-w-0 flex-1 truncate ${saisi ? 'text-slate-700 dark:text-slate-200' : 'italic text-slate-400'}`}>
                          {saisi ? tache?.title ?? 'Tâche supprimée' : 'Non saisi'}
                        </span>
                        {saisi && (
                          <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400" aria-label="saisi">
                            ✓
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <GlpiTicketsCard className="xl:w-[330px] xl:shrink-0" />
      </div>

      {/* --- Mes tâches, au-delà de la plus urgente --- */}
      {mesTaches.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Mes tâches ouvertes</h2>
            <span className="text-xs text-slate-400">{mesTaches.length} au total</span>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
            {parUrgence.slice(0, 6).map((t) => (
              <LigneTache key={t.id} tache={t} iso={iso} onOuvrir={() => onNavigate('tasks')} />
            ))}
          </div>
          {mesTaches.length > 6 && (
            <button onClick={() => onNavigate('tasks')} className="mt-2 text-xs text-violet-600 hover:underline dark:text-violet-400">
              Voir les {mesTaches.length - 6} autres →
            </button>
          )}
        </Card>
      )}
    </div>
  );
}

function Tuile({ ton, titre, children }: { ton: 'rouge' | 'ambre' | 'vert' | 'neutre'; titre: string; children: React.ReactNode }) {
  const cadres = {
    rouge: 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10',
    ambre: 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10',
    vert: 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10',
    neutre: 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
  };
  const titres = {
    rouge: 'text-red-700 dark:text-red-300',
    ambre: 'text-amber-700 dark:text-amber-300',
    vert: 'text-emerald-700 dark:text-emerald-300',
    neutre: 'text-slate-500 dark:text-slate-400',
  };
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${cadres[ton]}`}>
      <div className={`mb-1 text-xs font-medium ${titres[ton]}`}>{titre}</div>
      {children}
    </div>
  );
}

function LigneTache({ tache, iso, onOuvrir }: { tache: ProjectTask; iso: string; onOuvrir: () => void }) {
  const retard = tache.dueDate && tache.dueDate < iso;
  return (
    <button onClick={onOuvrir} className="flex w-full flex-wrap items-center gap-2 py-1.5 text-left hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
      <TaskTypeBadge type={tache.type} />
      <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">{tache.title}</span>
      <PriorityBadge priority={tache.priority} />
      <span className={`shrink-0 text-xs ${retard ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
        {tache.dueDate ?? '—'}
      </span>
    </button>
  );
}
