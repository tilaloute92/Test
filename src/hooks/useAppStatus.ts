import { useSyncExternalStore } from 'react';
import { getMode, onModeChange, type AppMode, type LinkState } from '../lib/serverMode';
import { getLinkState, onLinkStateChange } from '../lib/syncState';

/**
 * Passerelles React vers les deux états qui vivent hors de React :
 * - le MODE (client/serveur ou autonome), question d'architecture, mémorisée — serverMode.ts ;
 * - la LIAISON (le serveur répond-il en ce moment ?), question d'exploitation — syncState.ts.
 *
 * Ils sont volontairement séparés : une panne de liaison ne change pas le mode, et c'est
 * précisément ce qui empêche l'application de retomber en autonome à la première coupure.
 */

export function useAppMode(): AppMode | null {
  return useSyncExternalStore(onModeChange, getMode, () => null);
}

export function useLinkState(): LinkState {
  return useSyncExternalStore(onLinkStateChange, getLinkState, () => 'demarrage' as LinkState);
}
