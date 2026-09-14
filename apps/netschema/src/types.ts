/** Modèle de données d'un schéma d'infrastructure réseau. */

export type DeviceKind =
  | 'internet'
  | 'cloud'
  | 'wan'
  | 'router'
  | 'firewall'
  | 'loadbalancer'
  | 'core-switch'
  | 'switch'
  | 'access-switch'
  | 'wifi'
  | 'server'
  | 'storage'
  | 'workstation'
  | 'printer'
  | 'phone'

export type LinkKind = 'ethernet' | 'fiber' | 'trunk' | 'wan' | 'vpn' | 'wireless'

/**
 * Un équipement. `x`/`y` désignent le CENTRE de la boîte, en coordonnées « diagramme »
 * (indépendantes du zoom et du déplacement de la vue).
 */
export interface NetNode {
  id: string
  kind: DeviceKind
  name: string
  model?: string
  ip?: string
  vlan?: string
  /** Zone logique (DMZ, LAN siège, agence…) : sert au regroupement et au cadre en pointillés. */
  zone?: string
  notes?: string
  x: number
  y: number
  /** Un équipement épinglé n'est jamais déplacé par le placement automatique. */
  pinned?: boolean
  /** Couche forcée ; sinon la couche par défaut du type d'équipement est utilisée. */
  rank?: number | null
}

export interface NetLink {
  id: string
  from: string
  to: string
  kind: LinkKind
  label?: string
  speed?: string
  /** Liaison redondante / secours : tracée en pointillés. */
  redundant?: boolean
}

export interface Diagram {
  title: string
  nodes: NetNode[]
  links: NetLink[]
}

export type LayoutDirection = 'TB' | 'LR'

export interface LayoutOptions {
  /** TB = couches empilées de haut en bas, LR = de gauche à droite. */
  direction: LayoutDirection
  /** Espacement entre deux équipements d'une même couche. */
  nodeGap: number
  /** Espacement entre deux couches. */
  layerGap: number
  /** Regroupe les équipements d'une même zone côte à côte dans leur couche. */
  groupByZone: boolean
}

export type LinkStyle = 'orthogonal' | 'straight'

export const NODE_W = 148
export const NODE_H = 64
