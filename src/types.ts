/**
 * Nature d'une tâche.
 *
 * « Demande » est à part des trois autres : c'est le travail qui vient de QUELQU'UN —
 * un service, un collègue — et qui attend une réponse. Elle tombe quand elle tombe, donc
 * elle est acceptée le matin comme l'après-midi (voir NATURES_PAR_PERIODE dans hours.ts),
 * et elle porte le nom du demandeur, sans quoi « qui attend depuis quand » reste dans la
 * tête de celui qui a pris l'appel.
 */
export type TaskType = 'MCO' | 'Incident' | 'Projet' | 'Demande';

export type TaskStatus = 'a_faire' | 'en_cours' | 'en_attente' | 'termine';

export type Priority = 'basse' | 'normale' | 'haute' | 'critique';

export type Period = 'matin' | 'apres_midi';

export type AbsenceType = 'conge' | 'formation' | 'teletravail' | 'astreinte' | 'autre';

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  /** Adresse professionnelle, pour l'envoi du programme du jour (voir server/src/mail/).
   *  Absente = la personne ne reçoit pas de message ; ce n'est pas une erreur. */
  email?: string;
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
  /**
   * Avancement déclaré, de 0 à 100 — une appréciation humaine, pas un calcul.
   *
   * Absent sur l'immense majorité des tâches, et c'est voulu : une tâche vaut alors 0 ou
   * 100 selon son statut, exactement comme avant. Il sert surtout aux tâches de projet
   * assez grosses pour qu'« en cours » ne dise rien d'utile.
   */
  avancement?: number;
  /** Qui a formulé la demande (service, personne) — pour les tâches de nature Demande.
   *  Texte libre : l'annuaire n'est pas dans l'application, et un demandeur peut être
   *  « la direction » ou « le standard » autant qu'une personne nommée. */
  demandeur?: string;
  /**
   * Créneaux horaires posés sur la tâche : ils alimentent Activité du jour à la date et à
   * l'heure dites (voir src/lib/creneaux.ts). Prévisionnels — ils se valident d'un clic,
   * ils ne comptent jamais tout seuls comme du temps passé.
   */
  creneaux?: TaskCreneau[];
  /** Identifiant de la tâche Microsoft Planner d'origine, si la tâche a été importée depuis
   *  Teams (voir src/lib/msPlanner.ts). Sert à ne pas ré-importer deux fois la même tâche. */
  plannerTaskId?: string;
  /** Récurrence Planner en clair ("Toutes les semaines"...), informative — l'appli ne recrée
   *  pas les occurrences elle-même, c'est Planner qui le fait. */
  recurrence?: string;
  /** Renseignés uniquement en mode client/serveur (voir server/src/businessData.js) —
   *  absents si la donnée n'a jamais transité par le serveur partagé. */
  updatedAt?: string;
  updatedBy?: string;
}

/** Un rendez-vous pris sur une tâche : telle personne, tel jour, de telle heure à telle heure. */
export interface TaskCreneau {
  id: string;
  /** Qui intervient. Un créneau ne vaut que pour une personne : une demande traitée à deux
   *  se pose en deux créneaux, ce qui dit aussi qui fait quoi. */
  memberId: string;
  /** AAAA-MM-JJ */
  date: string;
  /** Heure de début en décimal : 9,5 pour 09:30. */
  debut: number;
  /** Durée en heures : 1,5 pour une heure et demie. */
  duree: number;
}

export interface TimeEntry {
  id: string;
  taskId: string;
  memberId: string;
  date: string;
  period: Period;
  hours: number;
  note?: string;
  /**
   * Heure de début réellement occupée (14 pour 14:00–15:00), quand la saisie a été validée
   * sur une tranche précise — voir la grille horaire d'Activité du jour.
   *
   * Facultatif, et il doit le rester : les saisies antérieures n'en ont pas, et celles
   * faites par le formulaire « Saisir le temps passé » portent une durée sans dire à quel
   * moment. Les unes et les autres continuent de se ranger bout à bout depuis le début du
   * créneau (voir src/lib/dayAllocation.ts). Renseigné, il fait foi : valider 16:00 avant
   * 14:00 doit afficher l'activité à 16:00, pas à la première heure libre.
   */
  hour?: number;
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
  /** Renseigné uniquement en mode client/serveur (voir server/src/businessData.js). */
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
  /** Renseigné uniquement en mode client/serveur (voir server/src/businessData.js). */
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

/**
 * Nature d'une entrée de journal.
 *
 * « note » est ce que quelqu'un a écrit ; les autres sont des changements enregistrés tout
 * seuls. Les deux vivent dans le MÊME fil, dans le même ordre chronologique : séparer les
 * deux obligerait à lire deux listes en parallèle pour reconstituer une histoire, alors que
 * c'est précisément l'enchaînement « on a constaté ça, donc on est passé en critique » qui
 * a de la valeur six mois plus tard.
 */
export type JournalNature = 'note' | 'statut' | 'priorite' | 'echeance' | 'assignation' | 'avancement' | 'creation';

/**
 * Entrée du journal d'une tâche, d'un incident ou d'un projet.
 *
 * `auteur` est un NOM AFFICHÉ figé au moment de l'écriture, pas une référence vers une
 * fiche d'équipe : une personne qui quitte l'équipe voit sa fiche supprimée, et son nom
 * doit rester lisible dans l'historique — sans quoi le journal deviendrait une suite de
 * « — » le jour où quelqu'un part.
 */
export interface JournalEntry {
  id: string;
  taskId: string;
  nature: JournalNature;
  auteur: string;
  createdAt: string;
  /** Texte libre. Renseigné pour une note, absent pour un changement. */
  texte?: string;
  /** Valeur avant / après, déjà en clair (« À faire » et non « a_faire »). */
  de?: string;
  vers?: string;
  /** Dernière retouche d'une note par son auteur. Un changement n'est jamais modifiable. */
  editedAt?: string;
}
