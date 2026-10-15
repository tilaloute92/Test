import { useCallback, useEffect, useState } from 'react';
import { fetchMeteo, patchMeteoVote, postMeteoVote } from '../lib/serverSync';
import { isServerMode } from '../lib/serverMode';
import { setVoixLocale, voixLocale, type AgregatMeteo, type VoixLocale } from '../lib/meteoVote';
import type { WeatherLevel } from '../lib/weeklyReport';

/**
 * Le vote de la météo d'une semaine, vu par ce navigateur.
 *
 * Deux états bien distincts, qu'il ne faut pas confondre dans l'interface :
 * - `aVote` vient du serveur et dit si la personne connectée a déposé une voix, où qu'elle
 *   l'ait fait ;
 * - `idLocal` ne vit que sur ce poste et dit si CE navigateur peut encore modifier cette
 *   voix. On peut très bien avoir voté sans pouvoir modifier — depuis un autre poste, par
 *   exemple. C'est la contrepartie assumée de l'anonymat : le serveur ne sait pas quelle
 *   voix est la nôtre, donc seul le navigateur qui l'a déposée peut y revenir.
 */
export interface VoteMeteo {
  agregat: AgregatMeteo | null;
  chargement: boolean;
  erreur: string | null;
  /** Faux en mode autonome : sans serveur, aucune voix ne peut être recueillie anonymement. */
  disponible: boolean;
  /** Notre voix, telle que ce navigateur l'a déposée — pour la réafficher et la modifier. */
  voix: VoixLocale | null;
  envoyer: (niveau: WeatherLevel, mot: string) => Promise<void>;
  recharger: () => void;
}

export function useMeteoVote(semaine: string): VoteMeteo {
  const disponible = isServerMode();
  const [agregat, setAgregat] = useState<AgregatMeteo | null>(null);
  const [chargement, setChargement] = useState(disponible);
  const [erreur, setErreur] = useState<string | null>(null);
  const [voix, setVoix] = useState<VoixLocale | null>(() => voixLocale(semaine));
  const [tic, setTic] = useState(0);

  useEffect(() => {
    setVoix(voixLocale(semaine));
  }, [semaine]);

  useEffect(() => {
    if (!disponible) {
      setChargement(false);
      return;
    }
    let vivant = true;
    setChargement(true);
    fetchMeteo(semaine)
      .then((a) => {
        if (!vivant) return;
        setAgregat(a);
        setErreur(null);
      })
      .catch((e) => vivant && setErreur(e instanceof Error ? e.message : String(e)))
      .finally(() => vivant && setChargement(false));
    return () => {
      vivant = false;
    };
  }, [semaine, disponible, tic]);

  const envoyer = useCallback(
    async (niveau: WeatherLevel, mot: string) => {
      setErreur(null);
      const deja = voixLocale(semaine);
      try {
        const reponse = deja
          ? await patchMeteoVote(semaine, deja.id, niveau, mot)
          : await postMeteoVote(semaine, niveau, mot);
        setVoixLocale(semaine, { id: reponse.id, niveau, mot });
        setVoix({ id: reponse.id, niveau, mot });
        setAgregat(reponse);
      } catch (e) {
        setErreur(e instanceof Error ? e.message : String(e));
        // Le serveur a peut-être refusé parce que la voix locale n'existe plus de son côté
        // (semaine élaguée, fichier restauré) : on relit plutôt que de rester sur un
        // affichage qui ne correspond à rien.
        setTic((t) => t + 1);
        throw e;
      }
    },
    [semaine]
  );

  return { agregat, chargement, erreur, disponible, voix, envoyer, recharger: () => setTic((t) => t + 1) };
}
