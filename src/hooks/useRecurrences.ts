import { useEffect, useState } from 'react';
import { fetchServiceConfig } from '../lib/serverSync';
import { isServerMode } from '../lib/serverMode';
import { RECURRENCES_DEFAUT, type Recurrence } from '../lib/recurrences';

/**
 * Les créneaux récurrents en vigueur.
 *
 * Même principe que `useSeuilPresence` : c'est une règle de service, donc elle vient du
 * serveur. En mode autonome — ou si la lecture échoue — on retombe sur la réunion d'équipe
 * du vendredi plutôt que sur une liste vide : un planning qui oublie la réunion ferait
 * paraître tout le monde en retard de saisie tous les vendredis.
 */
export function useRecurrences(): Recurrence[] {
  const [liste, setListe] = useState<Recurrence[]>(RECURRENCES_DEFAUT);
  useEffect(() => {
    if (!isServerMode()) return;
    let vivant = true;
    fetchServiceConfig()
      .then((c) => vivant && setListe(c.recurrences ?? RECURRENCES_DEFAUT))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, []);
  return liste;
}
