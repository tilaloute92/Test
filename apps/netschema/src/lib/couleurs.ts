/**
 * Couleurs posées à la main sur un groupement du plan.
 *
 * Une grappe de haute disponibilité est rose par défaut, et c'est très bien tant qu'il n'y en
 * a qu'une ou deux. Sur un schéma qui en compte six — pare-feu, cœur, hyperviseurs, stockage,
 * répartiteurs, sauvegarde —, toutes au même rose, on ne distingue plus laquelle encadre quoi
 * et l'on suit les pointillés du regard pour s'y retrouver. Pouvoir teinter chacune règle le
 * problème là où il se pose, sans rien imposer à ceux qui n'en ont pas besoin.
 *
 * Le choix appartient au document, pas au poste : il part avec le fichier, se retrouve à
 * l'export et vaut pour quiconque l'ouvre. C'est une décision de lecture que l'auteur du
 * schéma prend pour ses lecteurs.
 */

export interface CouleurGroupe {
  id: string
  label: string
}

/** Rose : la couleur historique des grappes, conservée comme défaut. */
export const COULEUR_GRAPPE_DEFAUT = '#db2777'

/**
 * Huit teintes bien séparées, assez soutenues pour tenir en liseré pointillé de 1,2 px et
 * assez claires en fond à 4 % d'opacité pour ne pas assombrir les boîtes qu'elles encadrent.
 */
export const COULEURS_GRAPPE: CouleurGroupe[] = [
  { id: COULEUR_GRAPPE_DEFAUT, label: 'Rose (défaut)' },
  { id: '#dc2626', label: 'Rouge' },
  { id: '#ea580c', label: 'Orange' },
  { id: '#ca8a04', label: 'Or' },
  { id: '#16a34a', label: 'Vert' },
  { id: '#0891b2', label: 'Cyan' },
  { id: '#2563eb', label: 'Bleu' },
  { id: '#7c3aed', label: 'Violet' },
]

/** Couleur retenue pour une grappe : celle que le document porte, ou le rose par défaut. */
export function couleurGrappe(nom: string, couleurs?: Record<string, string>): string {
  const choisie = couleurs?.[nom]?.trim()
  return choisie && /^#[0-9a-f]{6}$/i.test(choisie) ? choisie : COULEUR_GRAPPE_DEFAUT
}
