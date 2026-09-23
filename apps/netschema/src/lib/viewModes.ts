import type { OsiView, ViewMode } from '../types'

/**
 * Modes de visualisation.
 *
 * Un même schéma se regarde de trois façons, sans jamais toucher au modèle : on travaille
 * en *Architecture*, on documente en *Technique*, on projette en *Présentation*. Chaque mode
 * réunit un réglage d'affichage (ce qu'on montre) et un habillage (comment on le dessine) :
 * c'est ce qui évite d'avoir à recocher six cases pour passer d'une lecture à l'autre.
 */

export interface ModeStyle {
  /** Taille du nom d'équipement. */
  nameSize: number
  /** Lignes de détail sous le nom (IP, VLAN, modèle, zone). */
  details: boolean
  /** Adresse et modèle affichés même si le détail est coupé (mode technique). */
  dense: boolean
  /** Facteur appliqué à l'épaisseur des liaisons. */
  linkWidth: number
  /** Taille des étiquettes de liaison. */
  labelSize: number
  /** Étiquette de liaison affichée même sans information de couche (débit, libellé). */
  labelAlways: boolean
  /** Arrondi des boîtes. */
  radius: number
  /** Épaisseur du contour des boîtes. */
  stroke: number
  /** Étiquettes de bout (ports, adresses des deux côtés) : la documentation, pas la lecture. */
  endLabels: boolean
  /** Étiquettes de liaison, tout court. La vue de présentation n'en porte aucune. */
  linkLabels: boolean
  /** Force des cadres de groupes : marqués pour l'architecture, discrets pour la technique. */
  groupStrength: number
  /** Remplissage des boîtes : teinté par type, ou blanc pour laisser lire les textes. */
  fill: 'teinte' | 'blanc'
  /** Ombre portée sous les boîtes (présentation). */
  shadow: boolean
  /**
   * Annotations techniques portées par les cadres : adresse virtuelle d'une grappe, par
   * exemple. Une vue de présentation s'en passe, les deux autres en vivent.
   */
  annotations: boolean
}

export interface ModeDefinition {
  id: ViewMode
  label: string
  hint: string
  /** Réglages d'affichage appliqués au choix du mode. */
  display: {
    showDetails: boolean
    showGrid: boolean
    showLayerLabels: boolean
    showZones: boolean
    showSites: boolean
    showClusters: boolean
    /** Ovales des agrégats : hors de la vue de présentation, où ils alourdiraient le plan. */
    showLags: boolean
  }
  style: ModeStyle
  /** Couche OSI imposée par le mode, quand il en suppose une (vue logique). */
  osi?: OsiView
  /** Masquer — plutôt qu'estomper — ce qui n'appartient pas à cette couche. */
  strictOsi?: boolean
}

export const VIEW_MODES: ModeDefinition[] = [
  {
    id: 'architecture',
    label: 'Architecture',
    hint: 'Lecture d’ensemble : qui parle à qui. Boîtes colorées par type, groupes marqués, liaisons épaisses annotées du débit — ni adressage, ni ports.',
    display: {
      showDetails: true,
      showGrid: false,
      showLayerLabels: true,
      showZones: true,
      showSites: true,
      showClusters: true,
      showLags: true,
    },
    style: {
      nameSize: 13.5,
      details: false,
      dense: false,
      linkWidth: 1.4,
      labelSize: 10,
      labelAlways: true,
      radius: 12,
      stroke: 1.8,
      endLabels: false,
      linkLabels: true,
      groupStrength: 1.8,
      fill: 'teinte',
      shadow: false,
      annotations: true,
    },
  },
  {
    id: 'technique',
    label: 'Technique',
    hint: 'Documentation d’exploitation : adressage, modèle, numéro de série sur chaque boîte, ports et VLAN aux deux bouts de chaque liaison, grille de repérage.',
    display: {
      showDetails: true,
      showGrid: true,
      showLayerLabels: true,
      showZones: true,
      showSites: true,
      showClusters: true,
      showLags: true,
    },
    style: {
      nameSize: 11,
      details: true,
      dense: true,
      linkWidth: 0.85,
      labelSize: 8.6,
      labelAlways: true,
      radius: 4,
      stroke: 1.1,
      endLabels: true,
      linkLabels: true,
      groupStrength: 0.55,
      fill: 'blanc',
      shadow: false,
      annotations: true,
    },
  },
  {
    id: 'logique',
    label: 'Logique',
    hint: 'Trois lectures du même document : le routage (couche 3), le plan VLAN rail par rail, ou les domaines de diffusion. Ce sont des projections : on les regarde, on n’y dessine pas.',
    display: {
      showDetails: true,
      showGrid: false,
      showLayerLabels: true,
      showZones: true,
      showSites: true,
      showClusters: true,
      showLags: true,
    },
    // La vue logique n'est pas qu'un habillage : elle écarte du schéma tout ce qui ne
    // participe pas au niveau 3 — câblage, alimentation, administration hors bande.
    osi: 'l3',
    strictOsi: true,
    style: {
      nameSize: 12.5,
      details: true,
      dense: false,
      linkWidth: 1.2,
      labelSize: 9.4,
      labelAlways: true,
      radius: 10,
      stroke: 1.5,
      endLabels: true,
      linkLabels: true,
      groupStrength: 1.4,
      fill: 'teinte',
      shadow: false,
      annotations: true,
    },
  },
  {
    id: 'presentation',
    label: 'Présentation',
    hint: 'Pour projeter ou coller dans un document : noms seuls, très lisibles, traits épais, aucune étiquette technique.',
    display: {
      showDetails: false,
      showGrid: false,
      showLayerLabels: false,
      showZones: true,
      showSites: true,
      showClusters: true,
      showLags: false,
    },
    style: {
      nameSize: 15,
      details: false,
      dense: false,
      linkWidth: 2.2,
      labelSize: 11,
      labelAlways: false,
      radius: 16,
      stroke: 2.4,
      endLabels: false,
      linkLabels: false,
      groupStrength: 1.2,
      fill: 'teinte',
      shadow: true,
      annotations: false,
    },
  },
]

export function modeStyle(mode: ViewMode): ModeStyle {
  return (VIEW_MODES.find((item) => item.id === mode) ?? VIEW_MODES[0]).style
}

export function modeDefinition(mode: ViewMode): ModeDefinition {
  return VIEW_MODES.find((item) => item.id === mode) ?? VIEW_MODES[0]
}
