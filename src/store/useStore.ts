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
import { archiveLocalCollections, archivePersistedCollections } from '../lib/localArchive';
import { repairDuplicateIds } from '../lib/repairIds';
import { isServerMode, onModeChange } from '../lib/serverMode';
import { isSyncActive, reportSyncError, requestResync } from '../lib/syncState';
import {
  SyncError,
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

// Type des 7 collections partagées en mode client/serveur (voir src/lib/serverSync.ts et
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
// d'une session à l'autre (et d'un navigateur à l'autre en mode client/serveur).
const nextId = (prefix: string) => makeId(prefix);

/** Les 7 collections partagées, dans l'ordre de SharedSnapshot — utilisé par la persistance. */
const SHARED_KEYS = ['members', 'tasks', 'planningSlots', 'timeEntries', 'absences', 'roadmapItems', 'copils'] as const;

const emptyCollections = (): SharedSnapshot => ({
  members: [],
  tasks: [],
  planningSlots: [],
  timeEntries: [],
  absences: [],
  roadmapItems: [],
  copils: [],
});

const seedCollections = (): SharedSnapshot => ({
  members: seedMembers,
  tasks: seedTasks,
  planningSlots: seedPlanningSlots,
  timeEntries: seedTimeEntries,
  absences: seedAbsences,
  roadmapItems: seedRoadmapItems,
  copils: seedCopils,
});

/**
 * État de départ des collections partagées.
 *
 * En mode client/serveur, elles démarrent VIDES : les données appartiennent au serveur, et
 * afficher un jeu d'exemple en attendant sa réponse ferait croire à une équipe qui n'existe
 * pas. L'interface n'affiche d'ailleurs rien tant que la première réponse n'est pas arrivée
 * (voir l'écran de démarrage dans src/App.tsx).
 *
 * En mode autonome, elles démarrent sur le jeu d'exemple, comme avant : c'est la seule
 * source de données disponible, et une application vide au premier lancement serait
 * inutilisable pour découvrir l'outil.
 */
const initialCollections = (): SharedSnapshot => (isServerMode() ? emptyCollections() : seedCollections());

/**
 * Écriture en mode client/serveur.
 *
 * Le serveur n'est pas un miroir : il EST l'enregistrement. La modification est appliquée
 * localement d'abord (pour que l'interface réponde immédiatement), mais si le serveur la
 * refuse, elle n'a pas eu lieu — on redemande donc l'état réel du serveur et on le dit
 * franchement à l'utilisateur.
 *
 * C'est le point qui a changé par rapport à la première version, qui affichait « la
 * modification reste enregistrée dans ce navigateur » : c'était faux, puisque le sondage
 * suivant (8 secondes plus tard) réécrasait l'affichage avec l'état du serveur. La personne
 * croyait son travail sauvé et le voyait disparaître sans explication.
 */
function syncWrite(action: string, promise: Promise<unknown>) {
  if (!isSyncActive()) return;
  promise.catch((err) => {
    const conflict = err instanceof SyncError && err.conflict;
    reportSyncError(
      conflict
        ? `${err.message} Rouvrez l'élément : il affiche maintenant la version du serveur.`
        : `${action} : la modification n'a PAS été enregistrée sur le serveur (${err instanceof Error ? err.message : String(err)}). L'affichage vient d'être resynchronisé.`
    );
    requestResync();
  });
}

/**
 * Comme `syncWrite`, mais réapplique l'enregistrement renvoyé par le serveur en cas de
 * succès. Les horodatages (`updatedAt`) et l'auteur (`updatedBy`) sont décidés côté serveur :
 * les reprendre tout de suite évite que l'affichage porte une valeur inventée localement —
 * et surtout que la modification suivante s'appuie sur cet horodatage inventé, ce que le
 * serveur prendrait à tort pour un conflit.
 */
function syncWriteRecord<K extends 'tasks' | 'roadmapItems' | 'copils'>(
  action: string,
  key: K,
  promise: Promise<StoreState[K][number]>,
  set: (fn: (s: StoreState) => Partial<StoreState>) => void
) {
  if (!isSyncActive()) return;
  promise.then(
    (item) => {
      set((s) => ({ [key]: s[key].map((x) => (x.id === item.id ? item : x)) }) as Partial<StoreState>);
    },
    (err) => {
      const conflict = err instanceof SyncError && err.conflict;
      reportSyncError(
        conflict
          ? `${err.message} Rouvrez l'élément : il affiche maintenant la version du serveur.`
          : `${action} : la modification n'a PAS été enregistrée sur le serveur (${err instanceof Error ? err.message : String(err)}). L'affichage vient d'être resynchronisé.`
      );
      requestResync();
    }
  );
}

function sanitizeConnection<T extends Partial<ApiConnection>>(connection: T): T {
  if (connection.rememberSecret) return connection;
  return { ...connection, secret: undefined };
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      ...initialCollections(),
      apiConnections: seedApiConnections,
      requestHistory: [],
      authSettings: defaultAuthSettings,

      addMember: (member) => {
        const item: TeamMember = { ...member, id: nextId('m') };
        set((s) => ({ members: [...s.members, item] }));
        syncWrite('ajout membre', syncAddMember(item));
      },
      updateMember: (id, patch) => {
        set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
        syncWrite('modification membre', syncUpdateMember(id, patch));
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
        syncWrite('suppression membre', syncRemoveMember(id));
      },

      addTask: (task) => {
        const id = nextId('t');
        const item: ProjectTask = { ...task, id, createdAt: new Date().toISOString() };
        set((s) => ({ tasks: [...s.tasks, item] }));
        syncWrite('ajout tâche', syncAddTask(item));
        return id;
      },
      updateTask: (id, patch) => {
        // Relevé AVANT la modification locale : c'est la version sur laquelle l'utilisateur
        // s'est basé, celle que le serveur compare pour détecter qu'un collègue est passé
        // entre-temps (voir `conflicts()` dans server/src/businessData.js).
        const base = get().tasks.find((t) => t.id === id)?.updatedAt;
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
        syncWriteRecord('modification tâche', 'tasks', syncUpdateTask(id, patch, base), set);
      },
      removeTask: (id) => {
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          planningSlots: s.planningSlots.map((p) => (p.taskId === id ? { ...p, taskId: null } : p)),
          roadmapItems: s.roadmapItems.map((r) =>
            r.linkedTaskIds.includes(id) ? { ...r, linkedTaskIds: r.linkedTaskIds.filter((t) => t !== id) } : r
          ),
        }));
        syncWrite('suppression tâche', syncRemoveTask(id));
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
        syncWrite('planning', syncSetPlanningSlot(memberId, date, period, taskId));
      },

      addTimeEntry: (entry) => {
        const item: TimeEntry = { ...entry, id: nextId('te') };
        set((s) => ({ timeEntries: [...s.timeEntries, item] }));
        syncWrite('ajout temps', syncAddTimeEntry(item));
      },
      removeTimeEntry: (id) => {
        set((s) => ({ timeEntries: s.timeEntries.filter((e) => e.id !== id) }));
        syncWrite('suppression temps', syncRemoveTimeEntry(id));
      },

      addAbsence: (absence) => {
        const item: Absence = { ...absence, id: nextId('a') };
        set((s) => ({ absences: [...s.absences, item] }));
        syncWrite('ajout absence', syncAddAbsence(item));
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
        syncWrite('ajout absences', syncAddAbsencesBulk(created));
      },
      removeAbsence: (id) => {
        set((s) => ({ absences: s.absences.filter((a) => a.id !== id) }));
        syncWrite('suppression absence', syncRemoveAbsence(id));
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
        syncWrite('ajout FDR', syncAddRoadmapItem(full));
        return id;
      },
      updateRoadmapItem: (id, patch) => {
        const base = get().roadmapItems.find((r) => r.id === id)?.updatedAt;
        set((s) => ({
          roadmapItems: s.roadmapItems.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r)),
        }));
        syncWriteRecord('modification FDR', 'roadmapItems', syncUpdateRoadmapItem(id, patch, base), set);
      },
      removeRoadmapItem: (id) => {
        set((s) => ({
          roadmapItems: s.roadmapItems.filter((r) => r.id !== id),
          copils: s.copils.map((c) =>
            c.roadmapItemIds.includes(id) ? { ...c, roadmapItemIds: c.roadmapItemIds.filter((r) => r !== id) } : c
          ),
        }));
        syncWrite('suppression FDR', syncRemoveRoadmapItem(id));
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
        syncWrite('ajout COPIL', syncAddCopil(full));
        return id;
      },
      updateCopil: (id, patch) => {
        const base = get().copils.find((c) => c.id === id)?.updatedAt;
        set((s) => ({
          copils: s.copils.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c)),
        }));
        syncWriteRecord('modification COPIL', 'copils', syncUpdateCopil(id, patch, base), set);
      },
      removeCopil: (id) => {
        set((s) => ({ copils: s.copils.filter((c) => c.id !== id) }));
        syncWrite('suppression COPIL', syncRemoveCopil(id));
      },

      applyServerSnapshot: (snapshot) => set(snapshot),

      // Réinitialisation au jeu d'exemple : réservée au mode autonome. En mode
      // client/serveur, elle n'aurait aucun sens — les données appartiennent au serveur, et
      // les remplacer ici serait annulé au sondage suivant tout en donnant l'illusion d'avoir
      // agi. L'interface ne propose donc pas cette action dans ce mode (voir SettingsView).
      resetToSeed: () => {
        if (isServerMode()) return;
        set({
          ...seedCollections(),
          apiConnections: seedApiConnections,
          requestHistory: [],
          authSettings: defaultAuthSettings,
        });
      },
    }),
    {
      name: 'infra-team-tracker',
      /**
       * Ce qui est enregistré dans le navigateur.
       *
       * En mode client/serveur, les 7 collections partagées en sont EXCLUES. Les y laisser
       * créerait une deuxième source de vérité : au rechargement, le navigateur réafficherait
       * sa copie — y compris des enregistrements que l'équipe a supprimés entre-temps — avant
       * que le serveur ait répondu. Restent enregistrés localement les seuls réglages
       * réellement personnels : connexions API, historique de requêtes, paramètres de
       * connexion.
       */
      partialize: (state) => {
        const local = {
          apiConnections: state.apiConnections,
          requestHistory: state.requestHistory,
          authSettings: state.authSettings,
        };
        if (isServerMode()) return local as unknown as StoreState;
        return {
          ...local,
          members: state.members,
          tasks: state.tasks,
          planningSlots: state.planningSlots,
          timeEntries: state.timeEntries,
          absences: state.absences,
          roadmapItems: state.roadmapItems,
          copils: state.copils,
        } as unknown as StoreState;
      },
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
        const saved = { ...(persisted as Partial<StoreState>) };
        // Un navigateur qui a d'abord servi en autonome garde d'anciennes collections dans
        // son stockage local. En mode client/serveur, on les ignore explicitement plutôt que
        // de les fusionner : elles feraient réapparaître, le temps d'une réponse serveur, des
        // données périmées — dont des enregistrements supprimés par l'équipe.
        if (isServerMode()) {
          // Avant de les ignorer, on les met de côté : sur un poste qui utilisait
          // l'application en autonome, ce sont de vraies données, et elles doivent rester
          // récupérables (voir src/lib/localArchive.ts).
          archiveLocalCollections(saved as Record<string, unknown>);
          for (const key of SHARED_KEYS) delete saved[key];
        }
        const merged = { ...current, ...saved } as StoreState;
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

/**
 * Bascule d'un poste autonome vers une installation client/serveur.
 *
 * Le mode n'est connu qu'APRÈS la première réponse du serveur, donc après que le store a
 * déjà réhydraté les données locales : le filtrage fait dans `merge` arrive trop tard pour
 * ce chargement-là. On traite donc la bascule ici, au moment exact où elle est détectée —
 * on met les données du poste de côté (elles restent proposables et exportables, voir
 * src/lib/localArchive.ts), puis on vide les collections partagées pour que rien de local ne
 * soit pris pour la référence de l'équipe. Le serveur les remplira au premier sondage.
 */
onModeChange((mode) => {
  if (mode !== 'serveur') return;
  archivePersistedCollections();
  useStore.setState(emptyCollections());
});
