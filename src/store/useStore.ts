import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Absence, ApiConnection, ApiRequestLog, AuthSettings, PlanningSlot, ProjectTask, TeamMember, TimeEntry } from '../types';
import {
  absences as seedAbsences,
  apiConnections as seedApiConnections,
  members as seedMembers,
  planningSlots as seedPlanningSlots,
  tasks as seedTasks,
  timeEntries as seedTimeEntries,
} from '../data/seed';
import { addDays, isWeekend, toISODate } from '../lib/date';

const MAX_REQUEST_HISTORY = 30;

const defaultAuthSettings: AuthSettings = {
  enabled: false,
  requireLogin: false,
  tenantId: '',
  clientId: '',
  redirectUri: typeof window !== 'undefined' ? window.location.origin : '',
};

interface StoreState {
  members: TeamMember[];
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  timeEntries: TimeEntry[];
  absences: Absence[];
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

  resetToSeed: () => void;
}

let idCounter = 1000;
const nextId = (prefix: string) => `${prefix}${idCounter++}`;

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

      addMember: (member) =>
        set((s) => ({ members: [...s.members, { ...member, id: nextId('m') }] })),
      updateMember: (id, patch) =>
        set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      removeMember: (id) =>
        set((s) => ({
          members: s.members.filter((m) => m.id !== id),
          tasks: s.tasks.map((t) => (t.assigneeId === id ? { ...t, assigneeId: null } : t)),
          planningSlots: s.planningSlots.filter((p) => p.memberId !== id),
        })),

      addTask: (task) => {
        const id = nextId('t');
        set((s) => ({ tasks: [...s.tasks, { ...task, id, createdAt: new Date().toISOString() }] }));
        return id;
      },
      updateTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            const next = { ...t, ...patch };
            // Horodate automatiquement le passage à "Terminé" (et l'efface si la tâche est
            // rouverte) — c'est ce qui permet au rapport hebdomadaire de savoir ce qui a été
            // terminé pendant la semaine, sans champ à remplir à la main.
            if (patch.status === 'termine' && t.status !== 'termine') next.completedAt = new Date().toISOString();
            else if (patch.status && patch.status !== 'termine') next.completedAt = undefined;
            return next;
          }),
        })),
      removeTask: (id) =>
        set((s) => ({
          tasks: s.tasks.filter((t) => t.id !== id),
          planningSlots: s.planningSlots.map((p) => (p.taskId === id ? { ...p, taskId: null } : p)),
        })),

      setPlanningSlot: (memberId, date, period, taskId) =>
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
        }),

      addTimeEntry: (entry) => set((s) => ({ timeEntries: [...s.timeEntries, { ...entry, id: nextId('te') }] })),
      removeTimeEntry: (id) => set((s) => ({ timeEntries: s.timeEntries.filter((e) => e.id !== id) })),

      addAbsence: (absence) => set((s) => ({ absences: [...s.absences, { ...absence, id: nextId('a') }] })),
      addAbsenceRange: ({ startDate, endDate, ...rest }) =>
        set((s) => {
          const start = new Date(startDate);
          const end = new Date(endDate);
          const created: Absence[] = [];
          for (let d = start; d <= end; d = addDays(d, 1)) {
            if (isWeekend(d)) continue;
            created.push({ ...rest, date: toISODate(d), id: nextId('a') });
          }
          return { absences: [...s.absences, ...created] };
        }),
      removeAbsence: (id) => set((s) => ({ absences: s.absences.filter((a) => a.id !== id) })),

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
        }),
    }),
    { name: 'infra-team-tracker' }
  )
);
