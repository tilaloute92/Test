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
  /** Plusieurs personnes peuvent travailler ensemble sur un même incident/MCO/projet. */
  assigneeIds: string[];
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

export type RoadmapDomain = 'Infrastructure' | 'Réseau' | 'Sécurité' | 'Cloud' | 'Poste de travail' | 'Autre';

export type RoadmapStatus = 'idee' | 'planifie' | 'en_cours' | 'termine' | 'reporte' | 'abandonne';

/** "annee" = initiative qui court sur toute l'année plutôt que rattachée à un trimestre précis. */
export type RoadmapQuarter = 'T1' | 'T2' | 'T3' | 'T4' | 'annee';

/**
 * Feuille de route (FDR) : initiatives stratégiques à l'échelle de l'année (et des années
 * suivantes), à distinguer des tâches opérationnelles de l'onglet Tâches (horizon de
 * quelques semaines). Une initiative peut optionnellement s'appuyer sur des tâches
 * existantes (`linkedTaskIds`) pour suivre son avancement réel sans dupliquer les données.
 */
export interface RoadmapItem {
  id: string;
  title: string;
  description?: string;
  domain: RoadmapDomain;
  year: number;
  quarter: RoadmapQuarter;
  status: RoadmapStatus;
  priority: Priority;
  /** Personne(s) porteuse(s) de l'initiative — optionnel, une FDR peut avoir des lignes non encore attribuées. */
  ownerIds: string[];
  /** Avancement saisi à la main (0-100) : une FDR reflète une estimation du pilote, pas un calcul automatique. */
  progress: number;
  /** Budget prévisionnel en euros — optionnel, à ne renseigner que si un chiffrage existe réellement. */
  budgetEstimate?: number;
  /** Tâches opérationnelles liées (onglet Tâches), pour un lien de traçabilité vers le détail. */
  linkedTaskIds: string[];
  createdAt: string;
  updatedAt: string;
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
