/**
 * État d'exécution de la liaison au serveur, hors de React — pour que le store
 * (src/store/useStore.ts) puisse le consulter avant chaque écriture sans dépendre de React.
 * Un simple pub-sub, alimenté par App.tsx et par le sondage périodique
 * (src/hooks/useServerSync.ts), et consulté par le store et les écrans.
 *
 * À ne pas confondre avec src/lib/serverMode.ts, qui répond à « cette installation est-elle
 * client/serveur ? » (question d'architecture, mémorisée). Ici on répond à « le serveur
 * est-il joignable en ce moment ? » (question d'exploitation, volatile).
 */

import type { LinkState } from './serverMode';

export interface SyncUser {
  username: string;
  name: string;
}

type ActiveListener = (active: boolean, user: SyncUser | null) => void;
type LinkListener = (state: LinkState) => void;
type ErrorListener = (message: string | null) => void;
type ResyncListener = () => void;

let active = false;
let currentUser: SyncUser | null = null;
let linkState: LinkState = 'demarrage';
const activeListeners = new Set<ActiveListener>();
const linkListeners = new Set<LinkListener>();
const errorListeners = new Set<ErrorListener>();
const resyncListeners = new Set<ResyncListener>();

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

/**
 * État de la liaison. `indisponible` met l'application en lecture seule en mode
 * client/serveur : mieux vaut empêcher la saisie que la perdre au retour du serveur.
 */
export function setLinkState(next: LinkState) {
  if (next === linkState) return;
  linkState = next;
  linkListeners.forEach((l) => l(linkState));
}

export function getLinkState(): LinkState {
  return linkState;
}

export function onLinkStateChange(listener: LinkListener): () => void {
  linkListeners.add(listener);
  return () => linkListeners.delete(listener);
}

/** Signale un problème de synchronisation — affiché par un bandeau global (voir App.tsx). */
export function reportSyncError(message: string) {
  errorListeners.forEach((l) => l(message));
}

export function onSyncError(listener: ErrorListener): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

/**
 * Demande une relecture immédiate de l'état serveur, sans attendre le prochain sondage.
 * Appelé après une écriture refusée : l'affichage doit revenir à ce que le serveur détient
 * réellement, sinon l'utilisateur croit sa modification enregistrée alors qu'elle n'existe
 * nulle part.
 */
export function requestResync() {
  resyncListeners.forEach((l) => l());
}

export function onResyncRequest(listener: ResyncListener): () => void {
  resyncListeners.add(listener);
  return () => resyncListeners.delete(listener);
}
