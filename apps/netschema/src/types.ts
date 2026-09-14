/** Modèle de données d'un schéma d'infrastructure réseau. */

/**
 * Identifiant de type d'équipement (« firewall », « k8s-cluster », un type maison…).
 * Volontairement une chaîne libre et non une énumération figée : le catalogue est
 * extensible par fichier de données, sans recompiler l'application.
 */
export type DeviceKind = string

export type LinkKind =
  | 'ethernet'
  | 'fiber'
  | 'trunk'
  | 'wan'
  | 'vpn'
  | 'wireless'
  | 'overlay'
  | 'heartbeat'
  | 'stack'
  | 'replication'
  | 'oob'
  | 'power'

/**
 * Rôle d'un équipement au sein d'une grappe haute disponibilité.
 * `witness` désigne le témoin / quorum qui départage une grappe à deux nœuds.
 */
export type HaRole = 'standalone' | 'active' | 'passive' | 'active-active' | 'witness'

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
  /** Site physique (siège, site de secours, datacenter opérateur…). */
  site?: string
  /** Nom de la grappe HA à laquelle l'équipement appartient (FW-CLUSTER, CORE-MLAG…). */
  cluster?: string
  /** Rôle dans la grappe : actif, passif, actif/actif, témoin de quorum. */
  role?: HaRole
  /** Adresse virtuelle portée par la grappe (VRRP / HSRP / VIP de répartiteur). */
  vip?: string
  /** Double alimentation électrique (deux chaînes A/B). */
  dualPower?: boolean
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
  /** Regroupe d'abord par site physique (siège, site de secours…). */
  groupBySite: boolean
}

export type LinkStyle = 'orthogonal' | 'straight'

/** Niveau de détail d'affichage, pour dégrossir un schéma complexe. */
export type DetailLevel = 'full' | 'no-endpoints' | 'summary'

export const NODE_W = 148
export const NODE_H = 64
