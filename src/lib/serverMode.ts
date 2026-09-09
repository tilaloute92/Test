/**
 * Mode de fonctionnement de l'application : client/serveur, ou autonome.
 *
 * Pourquoi ce n'est pas une simple détection à chaud
 * --------------------------------------------------
 * La première version se contentait de regarder si le serveur répondait : s'il répondait,
 * les données étaient partagées ; sinon, l'application continuait en autonome sur les
 * données du navigateur. Ce comportement est le pire possible sur une installation
 * client/serveur : le jour où le service Windows s'arrête, chacun continue de travailler
 * sur sa propre copie, personne ne s'en aperçoit, et les modifications des uns et des
 * autres sont perdues au redémarrage.
 *
 * Le mode est donc MÉMORISÉ. Dès qu'un navigateur a vu une fois qu'il parlait à une
 * installation client/serveur, il s'en souvient : si le serveur devient injoignable, il
 * l'annonce et passe en lecture seule au lieu de laisser diverger les données. Ce n'est
 * qu'à la demande explicite de l'utilisateur (bouton, avec confirmation) qu'il peut
 * repasser en autonome.
 *
 * Le mode autonome, lui, reste pleinement supporté : c'est le scénario A du déploiement
 * (site publié par IIS, sans service Node) — voir packaging/INSTALL.md.
 */

const MODE_KEY = 'infra-team-tracker:mode';

export type AppMode = 'serveur' | 'local';

/** État de la liaison au serveur, en mode client/serveur uniquement. */
export type LinkState =
  /** Premier contact en cours : on ne sait pas encore, on n'affiche donc aucune donnée. */
  | 'demarrage'
  /** Serveur joignable et session valide : lecture et écriture normales. */
  | 'connecte'
  /** Serveur injoignable ou en erreur : lecture seule, écritures bloquées. */
  | 'indisponible';

function readStored(): AppMode | null {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return value === 'serveur' || value === 'local' ? value : null;
  } catch {
    return null;
  }
}

function writeStored(mode: AppMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Stockage indisponible (navigation privée, stratégie d'entreprise) : le mode sera
    // simplement redétecté au prochain chargement. Rien à signaler à l'utilisateur.
  }
}

/**
 * Mode connu de ce navigateur. `null` tant qu'aucune détection n'a eu lieu : l'application
 * ne doit alors afficher aucune donnée métier, puisqu'elle ignore encore d'où elles viennent.
 */
let mode: AppMode | null = readStored();

/**
 * Consulté hors de React — notamment par le store (src/store/useStore.ts) avant chaque
 * écriture et à chaque enregistrement dans le stockage local.
 */
export function isServerMode(): boolean {
  return mode === 'serveur';
}

export function getMode(): AppMode | null {
  return mode;
}

type ModeListener = (mode: AppMode | null) => void;
const listeners = new Set<ModeListener>();

function setMode(next: AppMode | null): void {
  if (next === mode) return;
  mode = next;
  if (next) writeStored(next);
  listeners.forEach((l) => l(mode));
}

export function onModeChange(listener: ModeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Enregistre le résultat du premier contact avec /api/health.
 *
 * - Serveur joignable → mode client/serveur, mémorisé.
 * - Serveur injoignable alors qu'on le connaissait → le mode reste « serveur » : c'est une
 *   panne, pas un changement d'architecture. L'appelant affichera l'écran d'indisponibilité.
 * - Serveur injoignable et jamais vu → installation autonome.
 */
export function recordProbe(reachable: boolean): AppMode {
  if (reachable) {
    setMode('serveur');
    return 'serveur';
  }
  if (mode === 'serveur') return 'serveur';
  setMode('local');
  return 'local';
}

/**
 * Bascule volontaire vers le mode autonome, à n'appeler qu'après confirmation explicite de
 * l'utilisateur : les données affichées deviennent celles de ce navigateur, et ce qui sera
 * saisi ensuite ne rejoindra plus le serveur tant que le mode n'aura pas été redétecté.
 */
export function switchToLocalMode(): void {
  setMode('local');
}

/** Utilisé par la réinitialisation complète (onglet Paramètres) et par les tests. */
export function forgetMode(): void {
  try {
    localStorage.removeItem(MODE_KEY);
  } catch {
    // Voir writeStored : rien à faire si le stockage est indisponible.
  }
  setMode(null);
}
