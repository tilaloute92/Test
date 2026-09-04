/**
 * État d'exécution du mode multi-utilisateur — en dehors de React (utilisable directement
 * depuis les actions du store, src/store/useStore.ts, sans lui faire dépendre de React) :
 * un simple pub-sub, mis à jour par App.tsx dès que la disponibilité du serveur et l'état
 * de connexion changent, et consulté par le store avant chaque écriture pour savoir s'il
 * doit aussi synchroniser vers le serveur (voir src/lib/serverSync.ts).
 */

export interface SyncUser {
  username: string;
  name: string;
}

type ActiveListener = (active: boolean, user: SyncUser | null) => void;
type ErrorListener = (message: string | null) => void;

let active = false;
let currentUser: SyncUser | null = null;
const activeListeners = new Set<ActiveListener>();
const errorListeners = new Set<ErrorListener>();

export function setSyncActive(next: boolean, user: SyncUser | null) {
  if (next === active && user?.username === currentUser?.username) return;
  active = next;
  currentUser = next ? user : null;
  activeListeners.forEach((l) => l(active, currentUser));
}

export function isSyncActive(): boolean {
  return active;
}

export function getSyncUser(): SyncUser | null {
  return currentUser;
}

export function onSyncActiveChange(listener: ActiveListener): () => void {
  activeListeners.add(listener);
  return () => activeListeners.delete(listener);
}

/** Signale un échec de synchronisation (écriture non parvenue au serveur) — affiché
 *  brièvement par un bandeau global (voir App.tsx) plutôt que d'interrompre la saisie. */
export function reportSyncError(message: string) {
  errorListeners.forEach((l) => l(message));
}

export function onSyncError(listener: ErrorListener): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}
