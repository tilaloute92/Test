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

import { enTeteEquipe } from './equipeCourante';
import type { Absence, Copil, JournalEntry, Period, PlanningSlot, ProjectTask, ReferentJour, RoadmapItem, TeamMember, TimeEntry } from '../types';
import type { AgregatMeteo } from './meteoVote';
import type { Recurrence } from './recurrences';
import type { WeatherLevel } from './weeklyReport';

/** Les 8 collections partagées. */
export interface SharedCollections {
  members: TeamMember[];
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  timeEntries: TimeEntry[];
  absences: Absence[];
  roadmapItems: RoadmapItem[];
  copils: Copil[];
  journalEntries: JournalEntry[];
  referents: ReferentJour[];
}

/** État du serveur, sans les données — renvoyé aussi par les réponses complètes. */
export interface ServerStatus {
  /** Compteur incrémenté à chaque modification, quelle qu'elle soit. */
  version: number;
  /** Le serveur a-t-il été mis en service (écran de première utilisation déjà passé) ? */
  initialized: boolean;
  /** Le serveur ne contient aucune donnée métier. */
  isEmpty: boolean;
  /** L'équipe RÉELLEMENT servie — celle de la session, ou celle que l'administrateur de
   *  plateforme regarde. C'est elle que l'écran doit nommer : le nom porté par la session
   *  désigne l'équipe de la personne, pas celle qu'elle a sous les yeux. */
  equipe?: string;
  equipeNom?: string;
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
    // `enTeteEquipe()` est vide sauf quand l'administrateur de plateforme regarde une
    // autre équipe (voir equipeCourante.ts). Le droit est revérifié côté serveur.
    headers: { 'Content-Type': 'application/json', ...enTeteEquipe(), ...(init?.headers ?? {}) },
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

/**
 * Un champ VIDÉ doit traverser le réseau, et `undefined` ne le fait pas.
 *
 * `JSON.stringify({ project: undefined })` produit `{}` : la modification part amputée,
 * le serveur ne voit rien à changer et renvoie l'ancienne valeur, que le sondage suivant
 * réaffiche. Effacer l'échéance, le projet ou le demandeur d'une tâche semblait alors
 * marcher… jusqu'au rechargement. On convertit donc en `null`, qui franchit JSON et que
 * le serveur interprète comme « retire ce champ » (voir `appliquerPatch` dans
 * server/src/businessData.js).
 */
function avecEffacements<T extends object>(patch: T): Record<string, unknown> {
  const sortie: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(patch)) sortie[cle] = valeur === undefined ? null : valeur;
  return sortie;
}

export const syncUpdateMember = (id: string, patch: Partial<TeamMember>) =>
  request<TeamMember>(`/members/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(avecEffacements(patch)) });
export const syncRemoveMember = (id: string) => request<{ ok: boolean }>(`/members/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncAddTask = (task: ProjectTask) => request<ProjectTask>('/tasks', { method: 'POST', body: JSON.stringify(task) });
export const syncUpdateTask = (id: string, patch: Partial<ProjectTask>, baseUpdatedAt?: string) =>
  request<ProjectTask>(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(avecEffacements(patch)), headers: baseHeader(baseUpdatedAt) });
export const syncRemoveTask = (id: string) => request<{ ok: boolean }>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncSetPlanningSlot = (memberId: string, date: string, period: Period, taskId: string | null) =>
  request<PlanningSlot>('/planning-slots', { method: 'PUT', body: JSON.stringify({ memberId, date, period, taskId }) });

export const syncAddTimeEntry = (entry: TimeEntry) => request<TimeEntry>('/time-entries', { method: 'POST', body: JSON.stringify(entry) });
export const syncRemoveTimeEntry = (id: string) => request<{ ok: boolean }>(`/time-entries/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncAddAbsence = (absence: Absence) => request<Absence>('/absences', { method: 'POST', body: JSON.stringify(absence) });
export const syncAddAbsencesBulk = (items: Absence[]) => request<Absence[]>('/absences/bulk', { method: 'POST', body: JSON.stringify({ items }) });
export const syncRemoveAbsence = (id: string) => request<{ ok: boolean }>(`/absences/${encodeURIComponent(id)}`, { method: 'DELETE' });

// Référent du jour : la DATE est la clé, pas un identifiant — un jour n'a qu'un référent.
export const syncSetReferent = (date: string, memberId: string) =>
  request<ReferentJour>(`/referents/${encodeURIComponent(date)}`, { method: 'PUT', body: JSON.stringify({ memberId }) });
export const syncClearReferent = (date: string) =>
  request<{ ok: boolean }>(`/referents/${encodeURIComponent(date)}`, { method: 'DELETE' });

export const syncAddRoadmapItem = (item: RoadmapItem) => request<RoadmapItem>('/roadmap-items', { method: 'POST', body: JSON.stringify(item) });
export const syncUpdateRoadmapItem = (id: string, patch: Partial<RoadmapItem>, baseUpdatedAt?: string) =>
  request<RoadmapItem>(`/roadmap-items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(avecEffacements(patch)),
    headers: baseHeader(baseUpdatedAt),
  });
export const syncRemoveRoadmapItem = (id: string) => request<{ ok: boolean }>(`/roadmap-items/${encodeURIComponent(id)}`, { method: 'DELETE' });

/**
 * Journal : les entrées sont envoyées par lot.
 *
 * Une modification de tâche peut en produire plusieurs d'un coup (passage en cours ET
 * réaffectation), et les envoyer une par une donnerait autant d'allers-retours, avec le
 * risque qu'une partie seulement arrive — un fil où le changement de statut est enregistré
 * mais pas la réaffectation raconterait une histoire fausse.
 */
export const syncAddJournalEntries = (items: JournalEntry[]) =>
  request<JournalEntry[]>('/journal-entries', { method: 'POST', body: JSON.stringify({ items }) });

export const syncUpdateJournalNote = (id: string, texte: string) =>
  request<JournalEntry>(`/journal-entries/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ texte }) });

export const syncRemoveJournalEntry = (id: string) =>
  request<{ ok: boolean }>(`/journal-entries/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const syncAddCopil = (item: Copil) => request<Copil>('/copils', { method: 'POST', body: JSON.stringify(item) });
export const syncUpdateCopil = (id: string, patch: Partial<Copil>, baseUpdatedAt?: string) =>
  request<Copil>(`/copils/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(avecEffacements(patch)), headers: baseHeader(baseUpdatedAt) });
export const syncRemoveCopil = (id: string) => request<{ ok: boolean }>(`/copils/${encodeURIComponent(id)}`, { method: 'DELETE' });

/**
 * Règles de service valables pour toute l'équipe (voir server/src/serviceConfig.js).
 * Lecture ouverte à toute session, écriture réservée à l'administrateur côté serveur.
 */
export interface ServiceConfig {
  /** 0 → 1. En dessous, l'application signale que le service n'est plus tenu. */
  seuilPresence: number;
  /** Heure pleine de clôture du vote de la météo, le vendredi. */
  meteoCloture: number;
  /** Créneaux récurrents du service (réunion d'équipe…) — voir src/lib/recurrences.ts. */
  recurrences: Recurrence[];
  /** Vrai tant que rien n'a été enregistré : la valeur affichée est celle d'origine. */
  parDefaut: boolean;
}

export const fetchServiceConfig = () => request<ServiceConfig>('/service-config');

export const saveServiceConfig = (patch: { seuilPresence?: number; meteoCloture?: number; recurrences?: Recurrence[] }) =>
  // Pas d'`avecEffacements` ici : ce n'est pas la modification d'un enregistrement mais un
  // réglage par champs nommés, et le serveur distingue « absent » (ne pas toucher) de
  // « null » (valeur invalide). Envoyer null ferait échouer l'enregistrement d'un seul
  // champ sur les autres.
  request<ServiceConfig>('/service-config', { method: 'PUT', body: JSON.stringify(patch) });

/**
 * Météo de la semaine votée par l'équipe (voir server/src/meteoVotes.js).
 *
 * Volontairement hors de l'instantané partagé : une voix ne doit pas voyager avec le reste
 * des données, où elle se retrouverait dans une sauvegarde, un export ou une console que
 * quelqu'un relit. On la demande semaine par semaine, et le serveur ne renvoie que des
 * nombres et des mots sans auteur.
 */
export const fetchMeteo = (semaine: string) => request<AgregatMeteo>(`/meteo/${semaine}`);

export const postMeteoVote = (semaine: string, niveau: WeatherLevel, mot: string) =>
  request<{ id: string } & AgregatMeteo>(`/meteo/${semaine}`, { method: 'POST', body: JSON.stringify({ niveau, mot }) });

export const patchMeteoVote = (semaine: string, id: string, niveau: WeatherLevel, mot: string) =>
  request<{ id: string } & AgregatMeteo>(`/meteo/${semaine}`, { method: 'PATCH', body: JSON.stringify({ id, niveau, mot }) });
