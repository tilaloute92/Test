import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Absence, ApiConnection, ApiRequestLog, AuthSettings, Copil, PlanningSlot, ProjectTask, RoadmapItem, TeamMember, TimeEntry } from '../types';
import {
  absences as seedAbsences,
  apiConnections as seedApiConnections,
  copils as seedCopils,
  members as seedMembers,
  planningSlots as seedPlanningSlots,
  roadmapItems as seedRoadmapItems,
  tasks as seedTasks,
  timeEntries as seedTimeEntries,
} from '../data/seed';
import { addDays, toISODate } from '../lib/date';
import { makeId } from '../lib/ids';
import { repairDuplicateIds } from '../lib/repairIds';
import { isSyncActive, reportSyncError } from '../lib/syncState';
import {
  syncAddAbsence,
  syncAddAbsencesBulk,
  syncAddCopil,
  syncAddMember,
  syncAddRoadmapItem,
  syncAddTask,
  syncAddTimeEntry,
  syncRemoveAbsence,
  syncRemoveCopil,
  syncRemoveMember,
  syncRemoveRoadmapItem,
  syncRemoveTask,
  syncRemoveTimeEntry,
  syncSetPlanningSlot,
  syncUpdateCopil,
  syncUpdateMember,
  syncUpdateRoadmapItem,
  syncUpdateTask,
} from '../lib/serverSync';

const MAX_REQUEST_HISTORY = 30;

const defaultAuthSettings: AuthSettings = {
  enabled: false,
  requireLogin: false,
  tenantId: '',
  clientId: '',
  redirectUri: typeof window !== 'undefined' ? window.location.origin : '',
};

// Type des 7 collections partagées en mode multi-utilisateur (voir src/lib/serverSync.ts et
// server/src/businessData.js) — tout le reste (connexions API, historique de requêtes,
// paramètres de connexion) reste volontairement local à chaque navigateur.
export interface SharedSnapshot {
  members: TeamMember[];
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  timeEntries: TimeEntry[];
  absences: Absence[];
  roadmapItems: RoadmapItem[];
  copils: Copil[];
}

export interface StoreState extends SharedSnapshot {
  apiConnections: ApiConnection[];
  requestHistory: ApiRequestLog[];
  authSettings: AuthSettings;

  addMember: (member: Omit<TeamMember, 'id'>) => void;
  updateMember: (id: string, patch: Partial<TeamMember>) => void;
  removeMember: (id: string) => void;

  addTask: (task: Omit<ProjectTask, 'id' | 'createdAt'>) => string;
  updateTask: (id: string, patch: Partial<ProjectTask>) => void;
  removeTask: (id: string) => void;

  setPlanningSlot: (memberId: string, date: string, period: 'matin' | 'apres_midi', taskId: string | null) => void;

  addTimeEntry: (entry: Omit<TimeEntry, 'id'>) => void;
  removeTimeEntry: (id: string) => void;

  addAbsence: (absence: Omit<Absence, 'id'>) => void;
  addAbsenceRange: (absence: Omit<Absence, 'id' | 'date'> & { startDate: string; endDate: string }) => void;
  removeAbsence: (id: string) => void;

  addApiConnection: (connection: Omit<ApiConnection, 'id'>) => void;
  updateApiConnection: (id: string, patch: Partial<ApiConnection>) => void;
  removeApiConnection: (id: string) => void;

  addRequestLog: (log: Omit<ApiRequestLog, 'id'>) => void;
  clearRequestHistory: () => void;

  updateAuthSettings: (patch: Partial<AuthSettings>) => void;

  addRoadmapItem: (item: Omit<RoadmapItem, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateRoadmapItem: (id: string, patch: Partial<RoadmapItem>) => void;
  removeRoadmapItem: (id: string) => void;

  addCopil: (copil: Omit<Copil, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateCopil: (id: string, patch: Partial<Copil>) => void;
  removeCopil: (id: string) => void;

  /** Remplace les 7 collections partagées par ce que renvoie le serveur — ne déclenche
   *  jamais de synchronisation en retour (voir le hook de sondage périodique dans App.tsx). */
  applyServerSnapshot: (snapshot: SharedSnapshot) => void;

  resetToSeed: () => void;
}

// Voir src/lib/ids.ts : un compteur en mémoire produisait des identifiants en double
// d'une session à l'autre (et d'un navigateur à l'autre en mode multi-utilisateur).
const nextId = (prefix: string) => makeId(prefix);

/** Envoie une écriture vers le serveur si le mode multi-utilisateur est actif ; signale un
 *  échec sans jamais bloquer ni annuler la modification déjà appliquée localement. */
function fireSync(action: string, promise: Promise<unknown>) {
  if (!isSyncActive()) return;
  promise.catch((err) => {
    reportSyncError(`Échec de synchronisation (${action}) : ${err instanceof Error ? err.message : String(err)}`);
  });
}

function sanitizeConnection<T extends Partial<ApiConnection>>(connection: T): T {
  if (connection.rememberSecret) return connection;
  return { ...connection, secret: undefined };
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      members: seedMembers,
      tasks: seedTasks,
      planningSlots: seedPlanningSlots,
      timeEntries: seedTimeEntries,
      absences: seedAbsences,
      apiConnections: seedApiConnections,
      requestHistory: [],
      authSettings: defaultAuthSettings,
      roadmapItems: seedRoadmapItems,
      copils: seedCopils,

      addMember: (member) => {
        const item: TeamMember = { ...member, id: nextId('m') };
        set((s) => ({ members: [...s.members, item] }));
        fireSync('ajout membre', syncAddMember(item));
      },
      updateMember: (id, patch) => {
        set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
        fireSync('modification membre', syncUpdateMember(id, patch));
      },
      removeMember: (id) => {
        set((s) => ({
          members: s.members.filter((m) => m.id !== id),
          tasks: s.tasks.map((t) => (t.assigneeIds.includes(id) ? { ...t, assigneeIds: t.assigneeIds.filter((a) => a !== id) } : t)),
          planningSlots: s.planningSlots.filter((p) => p.memberId !== id),
          roadmapItems: s.roadmapItems.map((r) => (r.ownerIds.includes(id) ? { ...r, ownerIds: r.ownerIds.filter((o) => o !== id) } : r)),
          // Une personne supprimée disparaît aussi des séances de COPIL : participants,
          // porteurs d'actions et présentateurs de points d'ordre du jour.
          copils: s.copils.map((c) => ({
            ...c,
            participantIds: c.participantIds.filter((p) => p !== id),
            actions: c.actions.map((a) => ({ ...a, ownerIds: a.ownerIds.filter((o) => o !== id) })),
            agenda: c.agenda.map((point) => (point.presenterId === id ? { ...point, presenterId: undefined } : point)),
          })),
        }));
        fireSync('suppression membre', syncRemoveMember(id));
      },

      addTask: (task) => {
        const id = nextId('t');
        const item: ProjectTask = { ...task, id, createdAt: new Date().toISOString() };
        set((s) => ({ tasks: [...s.tasks, item] }));
        fireSync('ajout tâche', syncAddTask(item));
        return id;
      },
      updateTask: (id, patch) => {
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            const next = { ...t, ...patch };
            // Horodate automatiquement le passage à "Terminé" (et l'efface si la tâche est
            // rouverte) — c'est ce qui permet au rapport hebdomadaire de savoir ce qui a été
            // terminé pendant la semaine, sans champ à remplir à la main. Le serveur applique
            // exactement la même règle de son côté (voir server/src/businessData.js) à partir
            // du même `patch`, plutôt que de recevoir cette valeur déjà calculée.
            if (patch.status === 'termine' && t.status !== 'termine') next.completedAt = new Date().toISOString();
            else if (patch.status && patch.status !== 'termine') next.completedAt = undefined;
            return next;
          }),
        }));
        fireSync('modification tâche', syncUpdateTask(id, patch));
      },
      removeTask: (id) => {
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          planningSlots: s.planningSlots.map((p) => (p.taskId === id ? { ...p, taskId: null } : p)),
          roadmapItems: s.roadmapItems.map((r) =>
            r.linkedTaskIds.includes(id) ? { ...r, linkedTaskIds: r.linkedTaskIds.filter((t) => t !== id) } : r
          ),
        }));
        fireSync('suppression tâche', syncRemoveTask(id));
      },

      setPlanningSlot: (memberId, date, period, taskId) => {
        set((s) => {
          const existing = s.planningSlots.find(
            (p) => p.memberId === memberId && p.date === date && p.period === period
          );
          if (existing) {
            return {
              planningSlots: s.planningSlots.map((p) => (p.id === existing.id ? { ...p, taskId } : p)),
            };
          }
          return {
            planningSlots: [...s.planningSlots, { id: nextId('s'), memberId, date, period, taskId }],
          };
        });
        fireSync('planning', syncSetPlanningSlot(memberId, date, period, taskId));
      },

      addTimeEntry: (entry) => {
        const item: TimeEntry = { ...entry, id: nextId('te') };
        set((s) => ({ timeEntries: [...s.timeEntries, item] }));
        fireSync('ajout temps', syncAddTimeEntry(item));
      },
      removeTimeEntry: (id) => {
        set((s) => ({ timeEntries: s.timeEntries.filter((e) => e.id !== id) }));
        fireSync('suppression temps', syncRemoveTimeEntry(id));
      },

      addAbsence: (absence) => {
        const item: Absence = { ...absence, id: nextId('a') };
        set((s) => ({ absences: [...s.absences, item] }));
        fireSync('ajout absence', syncAddAbsence(item));
      },
      addAbsenceRange: ({ startDate, endDate, ...rest }) => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const created: Absence[] = [];
        // L'équipe travaillant aussi le week-end (horaires décalés), une absence sur une
        // plage de dates couvre désormais tous les jours de la plage, samedi/dimanche inclus.
        for (let d = start; d <= end; d = addDays(d, 1)) {
          created.push({ ...rest, date: toISODate(d), id: nextId('a') });
        }
        set((s) => ({ absences: [...s.absences, ...created] }));
        fireSync('ajout absences', syncAddAbsencesBulk(created));
      },
      removeAbsence: (id) => {
        set((s) => ({ absences: s.absences.filter((a) => a.id !== id) }));
        fireSync('suppression absence', syncRemoveAbsence(id));
      },

      addApiConnection: (connection) =>
        set((s) => ({
          apiConnections: [...s.apiConnections, { ...sanitizeConnection(connection), id: nextId('c') }],
        })),
      updateApiConnection: (id, patch) =>
        set((s) => ({
          apiConnections: s.apiConnections.map((c) => (c.id === id ? sanitizeConnection({ ...c, ...patch }) : c)),
        })),
      removeApiConnection: (id) => set((s) => ({ apiConnections: s.apiConnections.filter((c) => c.id !== id) })),

      addRequestLog: (log) =>
        set((s) => ({
          requestHistory: [{ ...log, id: nextId('req') }, ...s.requestHistory].slice(0, MAX_REQUEST_HISTORY),
        })),
      clearRequestHistory: () => set({ requestHistory: [] }),

      updateAuthSettings: (patch) => set((s) => ({ authSettings: { ...s.authSettings, ...patch } })),

      addRoadmapItem: (item) => {
        const id = nextId('r');
        const now = new Date().toISOString();
        const full: RoadmapItem = { ...item, id, createdAt: now, updatedAt: now };
        set((s) => ({ roadmapItems: [...s.roadmapItems, full] }));
        fireSync('ajout FDR', syncAddRoadmapItem(full));
        return id;
      },
      updateRoadmapItem: (id, patch) => {
        set((s) => ({
          roadmapItems: s.roadmapItems.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r)),
        }));
        fireSync('modification FDR', syncUpdateRoadmapItem(id, patch));
      },
      removeRoadmapItem: (id) => {
        set((s) => ({
          roadmapItems: s.roadmapItems.filter((r) => r.id !== id),
          copils: s.copils.map((c) =>
            c.roadmapItemIds.includes(id) ? { ...c, roadmapItemIds: c.roadmapItemIds.filter((r) => r !== id) } : c
          ),
        }));
        fireSync('suppression FDR', syncRemoveRoadmapItem(id));
      },

      // Les sous-éléments d'un COPIL (ordre du jour, décisions, actions) ne sont pas des
      // collections séparées : ils appartiennent à leur séance et n'ont pas de sens en dehors
      // d'elle. Les modifier passe donc par updateCopil avec le tableau complet — une seule
      // route serveur à sécuriser, et jamais d'action orpheline dont la séance aurait disparu.
      addCopil: (copil) => {
        const id = nextId('cp');
        const now = new Date().toISOString();
        const full: Copil = { ...copil, id, createdAt: now, updatedAt: now };
        set((s) => ({ copils: [...s.copils, full] }));
        fireSync('ajout COPIL', syncAddCopil(full));
        return id;
      },
      updateCopil: (id, patch) => {
        set((s) => ({
          copils: s.copils.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c)),
        }));
        fireSync('modification COPIL', syncUpdateCopil(id, patch));
      },
      removeCopil: (id) => {
        set((s) => ({ copils: s.copils.filter((c) => c.id !== id) }));
        fireSync('suppression COPIL', syncRemoveCopil(id));
      },

      applyServerSnapshot: (snapshot) => set(snapshot),

      resetToSeed: () =>
        set({
          members: seedMembers,
          tasks: seedTasks,
          planningSlots: seedPlanningSlots,
          timeEntries: seedTimeEntries,
          absences: seedAbsences,
          apiConnections: seedApiConnections,
          requestHistory: [],
          authSettings: defaultAuthSettings,
          roadmapItems: seedRoadmapItems,
          copils: seedCopils,
        }),
    }),
    {
      name: 'infra-team-tracker',
      // Réparation des données déjà enregistrées avec l'ancienne génération d'identifiants :
      // les doublons éventuels reçoivent un identifiant neuf au chargement, sans quoi
      // l'utilisateur continuerait de voir deux enregistrements se comporter comme un seul
      // (cocher l'un cochait l'autre). Sans doublon, rien n'est réécrit.
      //
      // C'est fait dans `merge` et non dans `onRehydrateStorage` : ce dernier s'exécute
      // pendant la création du store, donc avant que la constante `useStore` ne soit
      // initialisée — y appeler `useStore.setState` échoue silencieusement. `merge` reçoit
      // l'état persisté et renvoie l'état à appliquer, sans rien référencer d'extérieur.
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<StoreState>) } as StoreState;
        const repaired = repairDuplicateIds(merged as unknown as Record<string, unknown>);
        if (!repaired) return merged;
        console.warn(
          `[Suivi Infra] ${repaired.report.total} identifiant(s) en double corrigé(s) au chargement :`,
          repaired.report.byCollection,
          "— les affectations qui pointaient vers un identifiant dupliqué sont restées sur le premier enregistrement : vérifiez-les."
        );
        return repaired.state as unknown as StoreState;
      },
    }
  )
);
