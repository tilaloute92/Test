/**
 * Client pour les données métier partagées (mode multi-utilisateur) — voir
 * server/src/routes/data.js. Même principe que src/auth/backendAuth.ts : cookie de session
 * httpOnly envoyé automatiquement (`credentials: 'include'`), délai maximal pour ne jamais
 * bloquer l'interface si le serveur ne répond pas.
 */

import type { Absence, Period, PlanningSlot, ProjectTask, RoadmapItem, TeamMember, TimeEntry } from '../types';

export interface ServerSnapshot {
  members: TeamMember[];
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  timeEntries: TimeEntry[];
  absences: Absence[];
  roadmapItems: RoadmapItem[];
  isEmpty: boolean;
}

export class SyncError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 6000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/data${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SyncError(data.error || `Erreur ${res.status}`, res.status);
  return data as T;
}

export const fetchSnapshot = () => request<ServerSnapshot>('');

export const publishSnapshot = (payload: Omit<ServerSnapshot, 'isEmpty'>) =>
  request<ServerSnapshot>('/publish', { method: 'POST', body: JSON.stringify(payload) });

export const syncAddMember = (member: TeamMember) => request<TeamMember>('/members', { method: 'POST', body: JSON.stringify(member) });
export const syncUpdateMember = (id: string, patch: Partial<TeamMember>) =>
  request<TeamMember>(`/members/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const syncRemoveMember = (id: string) => request<{ ok: boolean }>(`/members/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncAddTask = (task: ProjectTask) => request<ProjectTask>('/tasks', { method: 'POST', body: JSON.stringify(task) });
export const syncUpdateTask = (id: string, patch: Partial<ProjectTask>) =>
  request<ProjectTask>(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const syncRemoveTask = (id: string) => request<{ ok: boolean }>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncSetPlanningSlot = (memberId: string, date: string, period: Period, taskId: string | null) =>
  request<PlanningSlot>('/planning-slots', { method: 'PUT', body: JSON.stringify({ memberId, date, period, taskId }) });

export const syncAddTimeEntry = (entry: TimeEntry) => request<TimeEntry>('/time-entries', { method: 'POST', body: JSON.stringify(entry) });
export const syncRemoveTimeEntry = (id: string) => request<{ ok: boolean }>(`/time-entries/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncAddAbsence = (absence: Absence) => request<Absence>('/absences', { method: 'POST', body: JSON.stringify(absence) });
export const syncAddAbsencesBulk = (items: Absence[]) => request<Absence[]>('/absences/bulk', { method: 'POST', body: JSON.stringify({ items }) });
export const syncRemoveAbsence = (id: string) => request<{ ok: boolean }>(`/absences/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncAddRoadmapItem = (item: RoadmapItem) => request<RoadmapItem>('/roadmap-items', { method: 'POST', body: JSON.stringify(item) });
export const syncUpdateRoadmapItem = (id: string, patch: Partial<RoadmapItem>) =>
  request<RoadmapItem>(`/roadmap-items/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const syncRemoveRoadmapItem = (id: string) => request<{ ok: boolean }>(`/roadmap-items/${encodeURIComponent(id)}`, { method: 'DELETE' });
