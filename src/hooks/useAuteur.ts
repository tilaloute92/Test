import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { auteurCourant } from '../lib/identity';

/**
 * Le nom à faire figurer sur ce qu'on écrit — note de journal, entrée automatique,
 * signature d'un rapport.
 *
 * Sous forme de hook pour éviter de faire traverser l'auteur en propriété à travers trois
 * composants : chaque écran qui modifie une tâche en a besoin, et un seul qui l'oublierait
 * produirait des entrées de journal anonymes, qu'on ne saurait plus attribuer ensuite.
 */
export function useAuteur(): string {
  const members = useStore((s) => s.members);
  return useMemo(() => auteurCourant(members), [members]);
}
