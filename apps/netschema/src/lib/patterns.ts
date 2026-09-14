import { uid } from './ids'
import type { DeviceKind, HaRole, LinkKind, NetLink, NetNode } from '../types'

interface PatternNode {
  key: string
  kind: DeviceKind
  name: string
  dx: number
  dy: number
  cluster?: string
  role?: HaRole
  vip?: string
  zone?: string
  site?: string
  ip?: string
  dualPower?: boolean
}

interface PatternLink {
  from: string
  to: string
  kind: LinkKind
  label?: string
  speed?: string
  redundant?: boolean
}

export interface HaPattern {
  id: string
  title: string
  summary: string
  nodes: PatternNode[]
  links: PatternLink[]
}

/**
 * Bibliothèque de modèles repris des architectures haute disponibilité classiques :
 * grappe actif/passif, cœur MLAG, ferme derrière répartiteurs actif/actif, cluster
 * d'hyperviseurs avec témoin, double adduction opérateur, second site pour le PRA,
 * double chaîne électrique.
 */
export const HA_PATTERNS: HaPattern[] = [
  {
    id: 'fw-ha',
    title: 'Pare-feu actif / passif',
    summary: 'Deux pare-feu en grappe, lien de battement de cœur et adresse virtuelle partagée.',
    nodes: [
      { key: 'fw1', kind: 'firewall', name: 'FW-01', dx: -110, dy: 0, cluster: 'FW-HA', role: 'active', vip: '10.0.0.254', zone: 'DMZ', ip: '10.0.0.2', dualPower: true },
      { key: 'fw2', kind: 'firewall', name: 'FW-02', dx: 110, dy: 0, cluster: 'FW-HA', role: 'passive', vip: '10.0.0.254', zone: 'DMZ', ip: '10.0.0.3', dualPower: true },
    ],
    links: [{ from: 'fw1', to: 'fw2', kind: 'heartbeat', label: 'Synchro HA' }],
  },
  {
    id: 'core-mlag',
    title: 'Cœur redondé MLAG',
    summary: 'Deux switches cœur en MLAG et un switch de distribution en double attachement.',
    nodes: [
      { key: 'core1', kind: 'core-switch', name: 'SW-CORE-01', dx: -110, dy: 0, cluster: 'CORE-MLAG', role: 'active-active', vip: '10.10.0.10', dualPower: true },
      { key: 'core2', kind: 'core-switch', name: 'SW-CORE-02', dx: 110, dy: 0, cluster: 'CORE-MLAG', role: 'active-active', vip: '10.10.0.10', dualPower: true },
      { key: 'dist', kind: 'switch', name: 'SW-DIST-01', dx: 0, dy: 170 },
    ],
    links: [
      { from: 'core1', to: 'core2', kind: 'stack', label: 'MLAG' },
      { from: 'core1', to: 'dist', kind: 'fiber', speed: '10 Gb/s' },
      { from: 'core2', to: 'dist', kind: 'fiber', speed: '10 Gb/s', redundant: true },
    ],
  },
  {
    id: 'lb-farm',
    title: 'Ferme derrière répartiteurs actif / actif',
    summary: 'Deux répartiteurs de charge en actif/actif devant trois serveurs applicatifs.',
    nodes: [
      { key: 'lb1', kind: 'loadbalancer', name: 'LB-01', dx: -110, dy: 0, cluster: 'LB-HA', role: 'active-active', vip: '10.20.0.10' },
      { key: 'lb2', kind: 'loadbalancer', name: 'LB-02', dx: 110, dy: 0, cluster: 'LB-HA', role: 'active-active', vip: '10.20.0.10' },
      { key: 'srv1', kind: 'server', name: 'APP-01', dx: -200, dy: 170 },
      { key: 'srv2', kind: 'server', name: 'APP-02', dx: 0, dy: 170 },
      { key: 'srv3', kind: 'server', name: 'APP-03', dx: 200, dy: 170 },
    ],
    links: [
      { from: 'lb1', to: 'lb2', kind: 'heartbeat', label: 'Synchro sessions' },
      { from: 'lb1', to: 'srv1', kind: 'ethernet' },
      { from: 'lb1', to: 'srv2', kind: 'ethernet' },
      { from: 'lb1', to: 'srv3', kind: 'ethernet' },
      { from: 'lb2', to: 'srv1', kind: 'ethernet', redundant: true },
      { from: 'lb2', to: 'srv2', kind: 'ethernet', redundant: true },
      { from: 'lb2', to: 'srv3', kind: 'ethernet', redundant: true },
    ],
  },
  {
    id: 'hv-cluster',
    title: 'Cluster d’hyperviseurs + témoin',
    summary: 'Trois nœuds en cluster, stockage partagé et témoin de quorum contre le split-brain.',
    nodes: [
      { key: 'hv1', kind: 'hypervisor', name: 'ESXi-01', dx: -200, dy: 0, cluster: 'CLUSTER-VM', role: 'active-active', dualPower: true },
      { key: 'hv2', kind: 'hypervisor', name: 'ESXi-02', dx: 0, dy: 0, cluster: 'CLUSTER-VM', role: 'active-active', dualPower: true },
      { key: 'hv3', kind: 'hypervisor', name: 'ESXi-03', dx: 200, dy: 0, cluster: 'CLUSTER-VM', role: 'active-active', dualPower: true },
      { key: 'san', kind: 'storage', name: 'Baie SAN', dx: -110, dy: 170, dualPower: true },
      { key: 'wit', kind: 'witness', name: 'Témoin quorum', dx: 150, dy: 170, cluster: 'CLUSTER-VM', role: 'witness' },
    ],
    links: [
      { from: 'hv1', to: 'hv2', kind: 'heartbeat' },
      { from: 'hv2', to: 'hv3', kind: 'heartbeat' },
      { from: 'hv1', to: 'san', kind: 'fiber', speed: '16 Gb FC' },
      { from: 'hv2', to: 'san', kind: 'fiber', speed: '16 Gb FC' },
      { from: 'hv3', to: 'san', kind: 'fiber', speed: '16 Gb FC' },
      { from: 'wit', to: 'hv1', kind: 'oob', label: 'Quorum' },
      { from: 'wit', to: 'hv3', kind: 'oob', label: 'Quorum' },
    ],
  },
  {
    id: 'dual-isp',
    title: 'Double adduction opérateur',
    summary: 'Deux opérateurs, deux routeurs de périmètre en VRRP, liens croisés de secours.',
    nodes: [
      { key: 'isp1', kind: 'wan', name: 'Opérateur A', dx: -140, dy: 0 },
      { key: 'isp2', kind: 'wan', name: 'Opérateur B', dx: 140, dy: 0 },
      { key: 'rtr1', kind: 'router', name: 'RTR-EDGE-01', dx: -110, dy: 170, cluster: 'EDGE-VRRP', role: 'active', vip: '192.168.0.254' },
      { key: 'rtr2', kind: 'router', name: 'RTR-EDGE-02', dx: 110, dy: 170, cluster: 'EDGE-VRRP', role: 'passive', vip: '192.168.0.254' },
    ],
    links: [
      { from: 'isp1', to: 'rtr1', kind: 'wan', speed: '1 Gb/s' },
      { from: 'isp2', to: 'rtr2', kind: 'wan', speed: '1 Gb/s' },
      { from: 'isp1', to: 'rtr2', kind: 'wan', redundant: true },
      { from: 'isp2', to: 'rtr1', kind: 'wan', redundant: true },
      { from: 'rtr1', to: 'rtr2', kind: 'heartbeat', label: 'VRRP' },
    ],
  },
  {
    id: 'dr-site',
    title: 'Second site (plan de reprise)',
    summary: 'Deux sites interconnectés, réplication du stockage et témoin sur un site tiers.',
    nodes: [
      { key: 'coreA', kind: 'core-switch', name: 'CORE-SITE-A', dx: -180, dy: 0, site: 'Site principal', dualPower: true },
      { key: 'coreB', kind: 'core-switch', name: 'CORE-SITE-B', dx: 180, dy: 0, site: 'Site de secours', dualPower: true },
      { key: 'sanA', kind: 'storage', name: 'SAN Site A', dx: -180, dy: 170, site: 'Site principal' },
      { key: 'sanB', kind: 'storage', name: 'SAN Site B', dx: 180, dy: 170, site: 'Site de secours' },
      { key: 'wit', kind: 'witness', name: 'Témoin site tiers', dx: 0, dy: 170, site: 'Site tiers', role: 'witness' },
    ],
    links: [
      { from: 'coreA', to: 'coreB', kind: 'fiber', label: 'Interconnexion inter-sites', speed: '10 Gb/s' },
      { from: 'sanA', to: 'coreA', kind: 'fiber' },
      { from: 'sanB', to: 'coreB', kind: 'fiber' },
      { from: 'sanA', to: 'sanB', kind: 'replication', label: 'Réplication' },
      { from: 'wit', to: 'coreA', kind: 'oob', label: 'Quorum' },
      { from: 'wit', to: 'coreB', kind: 'oob', label: 'Quorum' },
    ],
  },
  {
    id: 'power-ab',
    title: 'Double chaîne électrique A/B',
    summary: 'Deux onduleurs et deux bandeaux PDU, pour alimenter les équipements par deux voies.',
    nodes: [
      { key: 'upsA', kind: 'ups', name: 'Onduleur A', dx: -110, dy: 0 },
      { key: 'upsB', kind: 'ups', name: 'Onduleur B', dx: 110, dy: 0 },
      { key: 'pduA', kind: 'pdu', name: 'PDU A', dx: -110, dy: 150 },
      { key: 'pduB', kind: 'pdu', name: 'PDU B', dx: 110, dy: 150 },
    ],
    links: [
      { from: 'upsA', to: 'pduA', kind: 'power', label: 'Chaîne A' },
      { from: 'upsB', to: 'pduB', kind: 'power', label: 'Chaîne B' },
    ],
  },
]

/**
 * Crée les équipements et liaisons d'un modèle, centrés sur un point du plan.
 * Les noms de grappes déjà utilisés dans le schéma sont suffixés, pour ne pas fusionner
 * par accident deux grappes distinctes portant le même nom.
 */
export function instantiatePattern(
  pattern: HaPattern,
  center: { x: number; y: number },
  takenClusters: Set<string> = new Set(),
): { nodes: NetNode[]; links: NetLink[] } {
  const clusterNames = new Map<string, string>()
  const uniqueCluster = (name: string) => {
    const existing = clusterNames.get(name)
    if (existing) return existing
    let candidate = name
    let index = 2
    while (takenClusters.has(candidate)) {
      candidate = `${name}-${index}`
      index += 1
    }
    clusterNames.set(name, candidate)
    return candidate
  }

  const ids = new Map<string, string>()
  const nodes = pattern.nodes.map((item) => {
    const id = uid('n')
    ids.set(item.key, id)
    const { key, dx, dy, cluster, ...rest } = item
    void key
    return {
      id,
      ...rest,
      cluster: cluster ? uniqueCluster(cluster) : undefined,
      x: Math.round(center.x + dx),
      y: Math.round(center.y + dy),
    } satisfies NetNode
  })
  const links = pattern.links.map((item) => ({
    id: uid('l'),
    ...item,
    from: ids.get(item.from)!,
    to: ids.get(item.to)!,
  }))
  return { nodes, links }
}
