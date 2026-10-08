import { createContext, useContext } from 'react';
import type { User } from '../api';

/**
 * Utilisateur connecté, pour adapter l'interface à son profil. Les droits sont de toute façon
 * vérifiés par le service : masquer un bouton ne fait qu'éviter une action qui serait refusée.
 */
export const UserContext = createContext<User | null>(null);
export const useIsAdmin = () => useContext(UserContext)?.role === 'admin';
