import { useEffect, useState } from 'react';
import { fetchServiceConfig } from '../lib/serverSync';
import { isServerMode } from '../lib/serverMode';
import { SEUIL_PRESENCE_DEFAUT } from '../lib/presence';

/**
 * Le seuil de présence en vigueur.
 *
 * Il vient du serveur, qui le détient pour toute l'équipe. En mode autonome — ou si la
 * lecture échoue — on retombe sur la valeur d'origine plutôt que de ne rien signaler :
 * une alerte absente par défaut de configuration serait le pire des deux mondes.
 */
export function useSeuilPresence(): number {
  const [seuil, setSeuil] = useState(SEUIL_PRESENCE_DEFAUT);
  useEffect(() => {
    if (!isServerMode()) return;
    let vivant = true;
    fetchServiceConfig()
      .then((c) => vivant && setSeuil(c.seuilPresence))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, []);
  return seuil;
}
