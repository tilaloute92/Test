import type { ViewMode } from '../types'

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
  }
  style: ModeStyle
}

export const VIEW_MODES: ModeDefinition[] = [
  {
    id: 'architecture',
    label: 'Architecture',
    hint: 'Lecture d’ensemble : équipements, groupes, liaisons et leurs informations utiles.',
    display: {
      showDetails: true,
      showGrid: true,
      showLayerLabels: true,
      showZones: true,
      showSites: true,
      showClusters: true,
    },
    style: {
      nameSize: 12.5,
      details: true,
      dense: false,
      linkWidth: 1,
      labelSize: 9.5,
      labelAlways: false,
      radius: 10,
      stroke: 1.6,
    },
  },
  {
    id: 'technique',
    label: 'Technique',
    hint: 'Documentation d’exploitation : adressage, modèles, ports, débits et VLAN sur chaque liaison.',
    display: {
      showDetails: true,
      showGrid: true,
      showLayerLabels: true,
      showZones: true,
      showSites: true,
      showClusters: true,
    },
    style: {
      nameSize: 11.5,
      details: true,
      dense: true,
      linkWidth: 0.85,
      labelSize: 8.8,
      labelAlways: true,
      radius: 6,
      stroke: 1.2,
    },
  },
  {
    id: 'presentation',
    label: 'Présentation',
    hint: 'Pour projeter ou coller dans un document : noms seuls, traits épais, aucun détail technique.',
    display: {
      showDetails: false,
      showGrid: false,
      showLayerLabels: false,
      showZones: true,
      showSites: true,
      showClusters: true,
    },
    style: {
      nameSize: 14.5,
      details: false,
      dense: false,
      linkWidth: 1.5,
      labelSize: 11,
      labelAlways: false,
      radius: 14,
      stroke: 2.2,
    },
  },
]

export function modeStyle(mode: ViewMode): ModeStyle {
  return (VIEW_MODES.find((item) => item.id === mode) ?? VIEW_MODES[0]).style
}

export function modeDefinition(mode: ViewMode): ModeDefinition {
  return VIEW_MODES.find((item) => item.id === mode) ?? VIEW_MODES[0]
}
