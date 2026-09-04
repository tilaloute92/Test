import { useEffect, useSyncExternalStore } from 'react';
import { useStore } from '../store/useStore';
import { fetchSnapshot } from '../lib/serverSync';
import { isSyncActive, onSyncActiveChange, reportSyncError } from '../lib/syncState';

const POLL_INTERVAL_MS = 8000;

function subscribe(callback: () => void) {
  return onSyncActiveChange(() => callback());
}

/**
 * Tant que le mode multi-utilisateur est actif (activé par useAuthGate dans App.tsx dès
 * qu'une session serveur existe — voir src/lib/syncState.ts), récupère l'état partagé
 * toutes les ~8 secondes et l'applique au store local : c'est ce qui permet de voir les
 * modifications des collègues sans recharger la page. Une régression réseau ponctuelle ne
 * bloque rien ni n'efface les données déjà affichées — l'erreur est juste signalée, le
 * prochain sondage réessaiera normalement.
 */
export function useServerSync() {
  const active = useSyncExternalStore(subscribe, isSyncActive, () => false);
  const applyServerSnapshot = useStore((s) => s.applyServerSnapshot);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const pull = async () => {
      try {
        const snapshot = await fetchSnapshot();
        if (cancelled) return;
        // Un serveur vide ne doit jamais écraser des données locales existantes (ex. le
        // jeu de données initial avant la première publication) : on attend qu'il y ait
        // vraiment quelque chose à récupérer. Voir le flux « Publier » dans SettingsView.
        if (snapshot.isEmpty) return;
        applyServerSnapshot({
          members: snapshot.members,
          tasks: snapshot.tasks,
          planningSlots: snapshot.planningSlots,
          timeEntries: snapshot.timeEntries,
          absences: snapshot.absences,
          roadmapItems: snapshot.roadmapItems,
        });
      } catch (err) {
        if (!cancelled) reportSyncError(`Échec de synchronisation (actualisation) : ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    pull();
    const interval = setInterval(pull, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active, applyServerSnapshot]);
}
