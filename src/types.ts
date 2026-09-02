export type TaskType = 'MCO' | 'Incident' | 'Projet';

export type TaskStatus = 'a_faire' | 'en_cours' | 'en_attente' | 'termine';

export type Priority = 'basse' | 'normale' | 'haute' | 'critique';

export type Period = 'matin' | 'apres_midi';

export type AbsenceType = 'conge' | 'formation' | 'teletravail' | 'astreinte' | 'autre';

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  skills: string[];
  weeklyHours: number;
  color: string;
  initials: string;
}

export interface ProjectTask {
  id: string;
  title: string;
  type: TaskType;
  project?: string;
  assigneeId: string | null;
  status: TaskStatus;
  priority: Priority;
  estimatedHours: number;
  dueDate?: string;
  createdAt: string;
  completedAt?: string;
  description?: string;
}

export interface TimeEntry {
  id: string;
  taskId: string;
  memberId: string;
  date: string;
  period: Period;
  hours: number;
  note?: string;
}

export interface PlanningSlot {
  id: string;
  memberId: string;
  date: string;
  period: Period;
  taskId: string | null;
}

export interface Absence {
  id: string;
  memberId: string;
  date: string;
  period: Period | 'jour';
  type: AbsenceType;
  label?: string;
}

export type ApiAuthType = 'none' | 'bearer' | 'apiKey' | 'basic';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface KeyValue {
  key: string;
  value: string;
}

export interface ApiConnection {
  id: string;
  name: string;
  baseUrl: string;
  authType: ApiAuthType;
  apiKeyHeader?: string;
  username?: string;
  rememberSecret: boolean;
  secret?: string;
  headers: KeyValue[];
}

export interface ApiRequestLog {
  id: string;
  timestamp: string;
  connectionId: string | null;
  method: HttpMethod;
  url: string;
  requestHeaders: KeyValue[];
  requestBody?: string;
  status: number | null;
  statusText: string;
  durationMs: number;
  responseBody: string;
  error?: string;
}

/**
 * Entra ID (Azure AD) single sign-on settings for the "public client" OAuth2/OIDC
 * flow (Authorization Code + PKCE) used by @azure/msal-browser.
 *
 * Only public, non-secret identifiers are stored here — tenantId and clientId are
 * meant to be visible in a browser (they identify the app registration, they don't
 * grant access on their own). A SPA public client never holds a client secret.
 */
export interface AuthSettings {
  enabled: boolean;
  requireLogin: boolean;
  tenantId: string;
  clientId: string;
  redirectUri: string;
}
