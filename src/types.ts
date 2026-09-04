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
  /** Renseignés uniquement en mode multi-utilisateur (voir server/src/businessData.js) —
   *  absents si la donnée n'a jamais transité par le serveur partagé. */
  updatedAt?: string;
  updatedBy?: string;
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
  /** Renseigné uniquement en mode multi-utilisateur (voir server/src/businessData.js). */
  updatedBy?: string;
}

export type CopilStatus = 'planifie' | 'tenu' | 'annule';

/** Point de l'ordre du jour d'un COPIL. */
export interface CopilAgendaItem {
  id: string;
  label: string;
  /** Qui présente ce point — optionnel (un point peut être porté par l'équipe entière). */
  presenterId?: string;
  /** Durée prévue en minutes — optionnel, sert à vérifier que l'ordre du jour tient dans la séance. */
  durationMin?: number;
}

/** Décision actée en séance : ce qui a été tranché, pas ce qui reste à faire (voir CopilAction). */
export interface CopilDecision {
  id: string;
  label: string;
  /** Contexte/justification de la décision — optionnel. */
  detail?: string;
}

/**
 * Action décidée en COPIL (relevé de décisions). Volontairement distincte d'une tâche de
 * l'onglet Tâches : une action de COPIL est un engagement pris devant les parties prenantes,
 * suivi d'une séance à l'autre, alors qu'une tâche est une unité de travail planifiable sur
 * un créneau. Les deux vies sont différentes — les mélanger rendrait le relevé de décisions
 * illisible et polluerait le planning.
 */
export interface CopilAction {
  id: string;
  label: string;
  /** Responsable(s) de l'action — plusieurs personnes possibles, comme pour une tâche. */
  ownerIds: string[];
  dueDate?: string;
  status: TaskStatus;
}

/**
 * COPIL (comité de pilotage) : séance de gouvernance avec les parties prenantes (direction,
 * métiers, prestataires) où l'on passe en revue l'avancement, où l'on acte des décisions et
 * où l'on prend des engagements. À distinguer de la FDR (le *quoi* à l'échelle de l'année)
 * et du planning (le *qui fait quoi* à l'échelle de la semaine) : le COPIL est l'instance qui
 * arbitre entre les deux, et son historique doit rester consultable séance après séance.
 */
export interface Copil {
  id: string;
  title: string;
  /** Date de la séance (AAAA-MM-JJ). */
  date: string;
  /** Heure de début, format libre court (ex. "14:00") — optionnel. */
  time?: string;
  /** Lieu ou lien de visio — optionnel. */
  location?: string;
  status: CopilStatus;
  /** Participants membres de l'équipe. */
  participantIds: string[];
  /** Participants extérieurs à l'équipe (direction, métiers, prestataires) : texte libre,
   *  ces personnes n'ont pas de fiche dans l'onglet Équipe. */
  externalParticipants: string[];
  agenda: CopilAgendaItem[];
  decisions: CopilDecision[];
  actions: CopilAction[];
  /** Initiatives FDR passées en revue pendant la séance — lien de traçabilité vers l'onglet FDR. */
  roadmapItemIds: string[];
  /** Compte-rendu / notes de séance. */
  notes?: string;
  /** Date de la séance suivante, si elle est déjà fixée. */
  nextDate?: string;
  createdAt: string;
  updatedAt: string;
  /** Renseigné uniquement en mode multi-utilisateur (voir server/src/businessData.js). */
  updatedBy?: string;
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
