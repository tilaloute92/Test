import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../store/useStore';
import { fetchSnapshot } from '../lib/serverSync';
import { isSyncActive, onSyncActiveChange, onResyncRequest, setLinkState } from '../lib/syncState';

/** Intervalle de sondage. Un compromis : assez court pour que le travail d'un collègue
 *  apparaisse dans la minute, assez long pour ne pas solliciter le serveur inutilement.
 *  Avec le sondage par version (voir plus bas), une requête sans changement ne transfère
 *  qu'une poignée d'octets. */
const POLL_INTERVAL_MS = 8000;

function subscribe(callback: () => void) {
  return onSyncActiveChange(() => callback());
}

export interface ServerSyncState {
  /** Une première réponse du serveur a été reçue et appliquée — avant cela, l'application
   *  ne doit rien afficher, puisqu'elle ne détient encore aucune donnée légitime. */
  hydrated: boolean;
  /** Le serveur a-t-il été mis en service ? `null` tant qu'on l'ignore. */
  initialized: boolean | null;
  /** Le serveur ne contient aucune donnée métier. */
  isEmpty: boolean;
  /** Relecture immédiate, hors du cycle de sondage. */
  refresh: () => void;
}

/**
 * Maintient l'affichage aligné sur le serveur, en mode client/serveur.
 *
 * Deux choix importants :
 *
 * 1. **Sondage par version.** On envoie au serveur la version qu'on détient ; s'il n'a pas
 *    changé, il répond « rien de neuf » et on ne touche à rien. La version précédente
 *    réappliquait tout l'état toutes les 8 secondes, ce qui réécrivait l'affichage en
 *    permanence — y compris pendant qu'une personne était en train de saisir.
 *
 * 2. **Échec = indisponible, pas « tant pis ».** Si le serveur ne répond pas, on le déclare
 *    indisponible : l'application passe en lecture seule (voir src/App.tsx) au lieu de
 *    laisser chacun accumuler des modifications que personne ne reverra.
 */
export function useServerSync(): ServerSyncState {
  const active = useSyncExternalStore(subscribe, isSyncActive, () => false);
  const applyServerSnapshot = useStore((s) => s.applyServerSnapshot);

  const versionRef = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const [hydrated, setHydrated] = useState(false);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [isEmpty, setIsEmpty] = useState(false);
  // Un compteur qu'on incrémente pour déclencher une relecture forcée depuis l'extérieur.
  const [forceTick, setForceTick] = useState(0);

  const refresh = useCallback(() => setForceTick((n) => n + 1), []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    /**
     * `force` ignore la version détenue et redemande tout. Indispensable après une écriture
     * refusée : le refus n'a rien changé côté serveur, donc sa version est inchangée, et un
     * sondage normal répondrait « rien de neuf » — laissant à l'écran la modification que le
     * serveur a justement rejetée.
     */
    const pull = async (force: boolean) => {
      try {
        const since = force ? undefined : (versionRef.current ?? undefined);
        const res = await fetchSnapshot(since);
        if (cancelled) return;
        failuresRef.current = 0;
        setLinkState('connecte');
        versionRef.current = res.version;
        setInitialized(res.initialized);
        setIsEmpty(res.isEmpty);
        if (!res.unchanged) {
          applyServerSnapshot({
            members: res.members,
            tasks: res.tasks,
            planningSlots: res.planningSlots,
            timeEntries: res.timeEntries,
            absences: res.absences,
            roadmapItems: res.roadmapItems,
            copils: res.copils,
          });
        }
        setHydrated(true);
      } catch {
        if (cancelled) return;
        failuresRef.current += 1;
        // Un échec isolé (micro-coupure réseau, redémarrage du pool IIS) ne doit pas sortir
        // l'utilisateur de son écran : on attend une seconde tentative infructueuse avant de
        // déclarer le serveur indisponible. Passé ce seuil, on ne laisse plus travailler —
        // voir l'écran correspondant dans src/App.tsx.
        //
        // Pas de message d'erreur ici : le sondage échoue en boucle tant que le serveur est
        // absent, et l'état de liaison suffit à l'annoncer une seule fois, clairement.
        // `versionRef` encore nul = on n'a jamais rien reçu : inutile d'attendre une seconde
        // tentative, il n'y a de toute façon rien à afficher.
        if (failuresRef.current >= 2 || versionRef.current === null) setLinkState('indisponible');
      }
    };

    pull(true);
    const unsubscribe = onResyncRequest(() => pull(true));
    const interval = setInterval(() => pull(false), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(interval);
    };
  }, [active, applyServerSnapshot, forceTick]);

  return { hydrated, initialized, isEmpty, refresh };
}
