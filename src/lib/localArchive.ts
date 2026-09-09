/**
 * Archive des données qu'un navigateur détenait AVANT de découvrir qu'il parlait à une
 * installation client/serveur.
 *
 * Le cas concret : un poste où l'application tournait en autonome (scénario A du
 * déploiement), sur lequel on active ensuite le service partagé. En mode client/serveur, le
 * store cesse d'enregistrer les données d'équipe dans le navigateur et ignore ce qui y était
 * enregistré — sinon des données périmées réapparaîtraient à chaque rechargement. Sans
 * précaution, le travail fait sur ce poste disparaîtrait donc silencieusement.
 *
 * On le met de côté ici, une seule fois, sous une clé distincte. Il sert à deux choses :
 * proposer ces données comme point de départ lors de la mise en service du serveur, et
 * rester récupérable ensuite (export depuis l'onglet Paramètres) si quelqu'un s'aperçoit
 * plus tard qu'il manque quelque chose.
 */

import type { Absence, Copil, PlanningSlot, ProjectTask, RoadmapItem, TeamMember, TimeEntry } from '../types';

const ARCHIVE_KEY = 'infra-team-tracker:donnees-locales-archivees';

export interface ArchivedCollections {
  members: TeamMember[];
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  timeEntries: TimeEntry[];
  absences: Absence[];
  roadmapItems: RoadmapItem[];
  copils: Copil[];
}

export interface LocalArchive {
  archivedAt: string;
  data: ArchivedCollections;
}

const KEYS = ['members', 'tasks', 'planningSlots', 'timeEntries', 'absences', 'roadmapItems', 'copils'] as const;

function looksLikeCollections(value: unknown): value is ArchivedCollections {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return KEYS.some((key) => Array.isArray(record[key]) && (record[key] as unknown[]).length > 0);
}

/**
 * Met de côté les collections trouvées dans l'état persisté, si elles contiennent quelque
 * chose et qu'aucune archive n'existe déjà. Ne remplace jamais une archive existante : la
 * première est la seule qui contienne l'état d'avant la bascule.
 */
export function archiveLocalCollections(persisted: Record<string, unknown>): void {
  if (!looksLikeCollections(persisted)) return;
  try {
    if (localStorage.getItem(ARCHIVE_KEY)) return;
    const data = {} as Record<string, unknown>;
    for (const key of KEYS) data[key] = Array.isArray(persisted[key]) ? persisted[key] : [];
    const archive: LocalArchive = { archivedAt: new Date().toISOString(), data: data as unknown as ArchivedCollections };
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
  } catch {
    // Stockage indisponible ou saturé : on ne peut pas archiver. Ne pas faire échouer le
    // démarrage pour autant — l'utilisateur garde son export manuel (onglet Paramètres).
  }
}

/**
 * Archive ce que le navigateur avait RÉELLEMENT enregistré, en relisant directement le
 * stockage de persistance plutôt que l'état courant du store.
 *
 * La distinction est essentielle : au démarrage, un navigateur qui n'a jamais servi contient
 * quand même des collections — le jeu d'exemple. Les archiver ferait proposer, sur une
 * installation neuve, de « reprendre 40 enregistrements » qui sont des données de
 * démonstration. Seul ce qui a été écrit dans le stockage local traduit un usage réel.
 */
export function archivePersistedCollections(): void {
  try {
    const raw = localStorage.getItem('infra-team-tracker');
    if (!raw) return;
    const state = (JSON.parse(raw) as { state?: Record<string, unknown> })?.state;
    if (state) archiveLocalCollections(state);
  } catch {
    // Stockage illisible : rien à archiver, et surtout rien qui doive empêcher le démarrage.
  }
}

export function readLocalArchive(): LocalArchive | null {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalArchive;
    return looksLikeCollections(parsed?.data) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearLocalArchive(): void {
  try {
    localStorage.removeItem(ARCHIVE_KEY);
  } catch {
    // Voir archiveLocalCollections.
  }
}

/** Nombre d'enregistrements archivés, pour l'annoncer sans avoir à tout détailler. */
export function countArchived(archive: LocalArchive): number {
  return KEYS.reduce((total, key) => total + (archive.data[key]?.length ?? 0), 0);
}
