import type { Absence, PlanningSlot, ProjectTask, TeamMember, TimeEntry } from '../types';
import { currentPeriod, toISODate } from './date';

export function getTaskById(tasks: ProjectTask[], id: string | null | undefined): ProjectTask | undefined {
  if (!id) return undefined;
  return tasks.find((t) => t.id === id);
}

export function getCurrentSlot(planningSlots: PlanningSlot[], memberId: string, date = new Date()) {
  const iso = toISODate(date);
  const period = currentPeriod();
  return planningSlots.find((s) => s.memberId === memberId && s.date === iso && s.period === period);
}

export function getCurrentTask(planningSlots: PlanningSlot[], tasks: ProjectTask[], memberId: string): ProjectTask | undefined {
  const slot = getCurrentSlot(planningSlots, memberId);
  if (slot?.taskId) return getTaskById(tasks, slot.taskId);
  return tasks.find((t) => t.assigneeIds.includes(memberId) && t.status === 'en_cours');
}

export function hoursLoggedToday(timeEntries: TimeEntry[], memberId: string, date = new Date()): number {
  const iso = toISODate(date);
  return timeEntries
    .filter((e) => e.memberId === memberId && e.date === iso)
    .reduce((sum, e) => sum + e.hours, 0);
}

export function hoursLoggedThisWeek(timeEntries: TimeEntry[], memberId: string, weekDays: Date[]): number {
  const isoDays = new Set(weekDays.map(toISODate));
  return timeEntries
    .filter((e) => e.memberId === memberId && isoDays.has(e.date))
    .reduce((sum, e) => sum + e.hours, 0);
}

export function openTasksForMember(tasks: ProjectTask[], memberId: string): ProjectTask[] {
  return tasks.filter((t) => t.assigneeIds.includes(memberId) && t.status !== 'termine');
}

export function absencesToday(absences: Absence[], memberId: string, date = new Date()): Absence | undefined {
  const iso = toISODate(date);
  return absences.find((a) => a.memberId === memberId && a.date === iso);
}

export function membersOrderedByLoad(members: TeamMember[], loadByMember: Record<string, number>): TeamMember[] {
  return [...members].sort((a, b) => (loadByMember[b.id] ?? 0) - (loadByMember[a.id] ?? 0));
}
