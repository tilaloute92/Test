import type { Tab } from '../App';

/**
 * Structure de la navigation.
 *
 * Les onze onglets tenaient sur une seule rangée. Sur un portable ils occupaient toute la
 * largeur ; sur téléphone la rangée débordait, et les cinq derniers — Équipe, API,
 * Paramètres… — n'étaient atteignables qu'en faisant défiler latéralement une barre dont
 * rien n'indiquait qu'elle continuait. Les onglets rares sont donc regroupés dans des
 * menus, et seuls les deux consultés en permanence restent à portée immédiate.
 *
 * Ce fichier est la seule source : la barre large, la barre du téléphone et la recherche
 * globale lisent tous la même liste, pour qu'un onglet ajouté apparaisse partout sans
 * qu'on ait à y penser.
 */

export interface NavEntry {
  id: Tab;
  label: string;
  /** Libellé court pour la barre du téléphone, où la place manque. */
  short?: string;
  /** Repère visuel de la barre basse. Volontairement des caractères et non des images :
   *  aucune dépendance, et ils suivent la taille du texte. */
  icon?: string;
  description: string;
}

export interface NavGroup {
  label: string;
  entries: NavEntry[];
}

/** Toujours visibles : ce sont les deux écrans qu'on ouvre plusieurs fois par jour. */
export const PRIMARY_TABS: NavEntry[] = [
  { id: 'myday', label: 'Ma journée', short: 'Ma journée', icon: '◷', description: 'Mon programme, mes heures à valider, mes échéances' },
  { id: 'dashboard', label: "Vue d'ensemble", short: 'Résumé', icon: '◆', description: "Charge et activité de toute l'équipe" },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Quotidien',
    entries: [
      { id: 'daily', label: 'Activité du jour', short: 'Jour', icon: '☀', description: 'Saisir le temps et les créneaux du jour' },
      { id: 'planning', label: 'Planning', short: 'Planning', icon: '▦', description: 'Prévisionnel sur trois semaines' },
      { id: 'tasks', label: 'Tâches', short: 'Tâches', icon: '☑', description: 'Tâches, incidents et projets' },
      { id: 'time', label: 'Temps', short: 'Temps', icon: '◴', description: 'Temps passé par personne, par projet, par type' },
    ],
  },
  {
    label: 'Pilotage',
    entries: [
      { id: 'report', label: 'Rapport de réunion', short: 'Rapport', icon: '▤', description: 'Réunion d’équipe : météo, incidents, projets, deux semaines à venir' },
      { id: 'roadmap', label: 'Feuille de route', short: 'FDR', icon: '◈', description: 'Initiatives par trimestre' },
      { id: 'copils', label: 'COPIL', short: 'COPIL', icon: '◎', description: 'Séances, ordres du jour, actions' },
    ],
  },
  {
    label: 'Administration',
    entries: [
      { id: 'team', label: 'Équipe', short: 'Équipe', icon: '☗', description: 'Membres, compétences, absences' },
      { id: 'api', label: 'Console API', short: 'API', icon: '⌁', description: 'Essais de connexions HTTP' },
      { id: 'settings', label: 'Paramètres', short: 'Réglages', icon: '⚙', description: 'Authentification, annuaire, mail, sauvegarde' },
    ],
  },
];

/** Toutes les entrées, dans l'ordre d'affichage. */
export const ALL_TABS: NavEntry[] = [...PRIMARY_TABS, ...NAV_GROUPS.flatMap((g) => g.entries)];

/**
 * Les quatre entrées de la barre basse du téléphone, plus « Plus » qui ouvre le reste.
 * Quatre et pas cinq : au-delà, les libellés se chevauchent sous 360 px.
 */
export const MOBILE_TABS: Tab[] = ['myday', 'dashboard', 'daily', 'tasks'];

export function navEntry(id: Tab): NavEntry | undefined {
  return ALL_TABS.find((e) => e.id === id);
}

export function groupOf(id: Tab): string | null {
  return NAV_GROUPS.find((g) => g.entries.some((e) => e.id === id))?.label ?? null;
}
