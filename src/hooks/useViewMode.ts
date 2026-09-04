import { useState } from 'react';

/**
 * Préférence d'affichage par onglet (Tableau/Kanban/Échéancier, etc.) : un choix personnel
 * de présentation, pas une donnée métier — reste donc dans le stockage local du navigateur,
 * comme le thème clair/sombre, plutôt que dans le store partagé (jamais synchronisé entre
 * collègues : chacun garde le mode d'affichage qu'il préfère).
 */
export function useViewMode<T extends string>(key: string, modes: readonly T[], initial: T) {
  const storageKey = `view-mode:${key}`;
  const [mode, setModeState] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && (modes as readonly string[]).includes(saved)) return saved as T;
    } catch {
      /* stockage indisponible (navigation privée...) : on retombe sur le mode par défaut */
    }
    return initial;
  });

  const setMode = (next: T) => {
    setModeState(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* pas grave si ça ne persiste pas : le mode reste actif pour cette session */
    }
  };

  return [mode, setMode] as const;
}
