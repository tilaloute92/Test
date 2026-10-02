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
 * Seize teintes, posées dans les intervalles libres les uns des autres.
 *
 * Elles sont choisies pour l'écart de teinte, pas pour la variété : doubler une couleur en
 * version claire et foncée aurait donné seize cases dont la moitié se confondent deux à deux,
 * surtout sur un liseré de 1,2 px en pointillé. L'écart minimal est ici de dix-neuf degrés
 * entre couleurs saturées — à une exception près, l'ardoise, volontairement désaturée : elle
 * se lit comme un gris et non comme un bleu, et sert aux grappes qu'on veut faire discrètes.
 *
 * Au-delà d'une dizaine, la couleur cesse de toute façon d'être une clé qu'on retient : c'est
 * le libellé du cadre qui nomme la grappe, la couleur qui la regroupe. Seize suffit largement
 * à distinguer toutes les grappes d'un même schéma ; le champ libre est là pour les
 * conventions maison qui imposent une teinte précise.
 */
export const COULEURS_GRAPPE: CouleurGroupe[] = [
  { id: COULEUR_GRAPPE_DEFAUT, label: 'Rose (défaut)' },
  { id: '#dc2626', label: 'Rouge' },
  { id: '#ea580c', label: 'Orange' },
  { id: '#ca8a04', label: 'Or' },
  { id: '#939711', label: 'Moutarde' },
  { id: '#498811', label: 'Olive' },
  { id: '#218321', label: 'Jade' },
  { id: '#16a34a', label: 'Vert' },
  { id: '#0c9780', label: 'Turquoise' },
  { id: '#0891b2', label: 'Cyan' },
  { id: '#2563eb', label: 'Bleu' },
  { id: '#2f2fc6', label: 'Indigo' },
  { id: '#7c3aed', label: 'Violet' },
  { id: '#8e25b1', label: 'Pourpre' },
  { id: '#b62098', label: 'Magenta' },
  { id: '#50627c', label: 'Ardoise' },
]

/** Couleur retenue pour une grappe : celle que le document porte, ou le rose par défaut. */
export function couleurGrappe(nom: string, couleurs?: Record<string, string>): string {
  const choisie = couleurs?.[nom]?.trim()
  return choisie && /^#[0-9a-f]{6}$/i.test(choisie) ? choisie : COULEUR_GRAPPE_DEFAUT
}
