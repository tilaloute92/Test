import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Absence, PlanningSlot, ProjectTask, TeamMember, TimeEntry } from '../types';
import { absences as seedAbsences, members as seedMembers, planningSlots as seedPlanningSlots, tasks as seedTasks, timeEntries as seedTimeEntries } from '../data/seed';

interface StoreState {
  members: TeamMember[];
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  timeEntries: TimeEntry[];
  absences: Absence[];

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
  removeAbsence: (id: string) => void;

  resetToSeed: () => void;
}

let idCounter = 1000;
const nextId = (prefix: string) => `${prefix}${idCounter++}`;

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      members: seedMembers,
      tasks: seedTasks,
      planningSlots: seedPlanningSlots,
      timeEntries: seedTimeEntries,
      absences: seedAbsences,

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
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
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
      removeAbsence: (id) => set((s) => ({ absences: s.absences.filter((a) => a.id !== id) })),

      resetToSeed: () =>
        set({
          members: seedMembers,
          tasks: seedTasks,
          planningSlots: seedPlanningSlots,
          timeEntries: seedTimeEntries,
          absences: seedAbsences,
        }),
    }),
    { name: 'infra-team-tracker' }
  )
);
