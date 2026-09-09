/**
 * Client des données d'équipe en mode client/serveur — voir server/src/routes/data.js.
 * Même principe que src/auth/backendAuth.ts : cookie de session httpOnly envoyé
 * automatiquement (`credentials: 'include'`), délai maximal pour ne jamais bloquer
 * l'interface si le serveur ne répond pas.
 *
 * En mode client/serveur, ces appels ne sont pas un « miroir » de ce que le navigateur
 * détient : ils SONT l'enregistrement. Une modification qui échoue ici n'a pas eu lieu, et
 * l'appelant doit resynchroniser plutôt que de conserver un état que le serveur ignore
 * (voir `syncWrite` dans src/store/useStore.ts).
 */

import type { Absence, Copil, Period, PlanningSlot, ProjectTask, RoadmapItem, TeamMember, TimeEntry } from '../types';

/** Les 7 collections partagées. */
export interface SharedCollections {
  members: TeamMember[];
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  timeEntries: TimeEntry[];
  absences: Absence[];
  roadmapItems: RoadmapItem[];
  copils: Copil[];
}

/** État du serveur, sans les données — renvoyé aussi par les réponses complètes. */
export interface ServerStatus {
  /** Compteur incrémenté à chaque modification, quelle qu'elle soit. */
  version: number;
  /** Le serveur a-t-il été mis en service (écran de première utilisation déjà passé) ? */
  initialized: boolean;
  /** Le serveur ne contient aucune donnée métier. */
  isEmpty: boolean;
}

export type SnapshotResponse =
  | ({ unchanged: true } & ServerStatus)
  | ({ unchanged: false } & ServerStatus & SharedCollections);

export class SyncError extends Error {
  status: number;
  /** true quand le serveur a refusé la modification parce qu'un collègue a modifié
   *  l'enregistrement entre-temps (HTTP 409) — voir `conflicts()` côté serveur. */
  conflict: boolean;
  constructor(message: string, status: number, conflict = false) {
    super(message);
    this.status = status;
    this.conflict = conflict;
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
  if (!res.ok) throw new SyncError(data.error || `Erreur ${res.status}`, res.status, res.status === 409 && Boolean(data.conflict));
  return data as T;
}

/**
 * En-tête de contrôle de concurrence : la date de dernière modification sur laquelle
 * l'utilisateur s'est basé. Le serveur refuse la modification si elle a bougé depuis.
 * Absente pour les enregistrements qui n'en portent pas — le serveur applique alors la
 * modification sans contrôle, ce qui est le comportement voulu pour un créneau de planning
 * ou une saisie de temps (valeur unique, visible à l'écran).
 */
function baseHeader(baseUpdatedAt?: string): Record<string, string> {
  return baseUpdatedAt ? { 'X-Base-Updated-At': baseUpdatedAt } : {};
}

/**
 * Récupère l'état partagé. Avec `since`, le serveur répond `unchanged: true` s'il n'a pas
 * changé depuis cette version — l'appelant n'a alors rien à réappliquer, ce qui évite de
 * réécrire l'affichage toutes les 8 secondes pendant que quelqu'un saisit.
 */
export const fetchSnapshot = (since?: number) =>
  request<SnapshotResponse>(since === undefined ? '' : `?since=${encodeURIComponent(since)}`);

export const fetchStatus = () => request<ServerStatus>('/status');

/** Mise en service du serveur : avec les données de ce navigateur, ou à vide. */
export const initializeServer = (snapshot?: SharedCollections) =>
  request<ServerStatus & SharedCollections>('/initialize', { method: 'POST', body: JSON.stringify(snapshot ? { snapshot } : {}) });

export const syncAddMember = (member: TeamMember) => request<TeamMember>('/members', { method: 'POST', body: JSON.stringify(member) });
export const syncUpdateMember = (id: string, patch: Partial<TeamMember>) =>
  request<TeamMember>(`/members/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const syncRemoveMember = (id: string) => request<{ ok: boolean }>(`/members/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncAddTask = (task: ProjectTask) => request<ProjectTask>('/tasks', { method: 'POST', body: JSON.stringify(task) });
export const syncUpdateTask = (id: string, patch: Partial<ProjectTask>, baseUpdatedAt?: string) =>
  request<ProjectTask>(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch), headers: baseHeader(baseUpdatedAt) });
export const syncRemoveTask = (id: string) => request<{ ok: boolean }>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncSetPlanningSlot = (memberId: string, date: string, period: Period, taskId: string | null) =>
  request<PlanningSlot>('/planning-slots', { method: 'PUT', body: JSON.stringify({ memberId, date, period, taskId }) });

export const syncAddTimeEntry = (entry: TimeEntry) => request<TimeEntry>('/time-entries', { method: 'POST', body: JSON.stringify(entry) });
export const syncRemoveTimeEntry = (id: string) => request<{ ok: boolean }>(`/time-entries/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncAddAbsence = (absence: Absence) => request<Absence>('/absences', { method: 'POST', body: JSON.stringify(absence) });
export const syncAddAbsencesBulk = (items: Absence[]) => request<Absence[]>('/absences/bulk', { method: 'POST', body: JSON.stringify({ items }) });
export const syncRemoveAbsence = (id: string) => request<{ ok: boolean }>(`/absences/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncAddRoadmapItem = (item: RoadmapItem) => request<RoadmapItem>('/roadmap-items', { method: 'POST', body: JSON.stringify(item) });
export const syncUpdateRoadmapItem = (id: string, patch: Partial<RoadmapItem>, baseUpdatedAt?: string) =>
  request<RoadmapItem>(`/roadmap-items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    headers: baseHeader(baseUpdatedAt),
  });
export const syncRemoveRoadmapItem = (id: string) => request<{ ok: boolean }>(`/roadmap-items/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncAddCopil = (item: Copil) => request<Copil>('/copils', { method: 'POST', body: JSON.stringify(item) });
export const syncUpdateCopil = (id: string, patch: Partial<Copil>, baseUpdatedAt?: string) =>
  request<Copil>(`/copils/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch), headers: baseHeader(baseUpdatedAt) });
export const syncRemoveCopil = (id: string) => request<{ ok: boolean }>(`/copils/${encodeURIComponent(id)}`, { method: 'DELETE' });
