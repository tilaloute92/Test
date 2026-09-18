import { deviceMeta, LINKS } from './catalog'
import type { Severity } from './ha'
import type {
  Diagram,
  LinkKind,
  NetLink,
  NetNode,
  OsiLayer,
  OsiView,
  PortMode,
  StpRole,
  VlanDef,
} from '../types'

/**
 * Couches OSI portées par défaut par chaque type de liaison. Un câble cuivre documente le
 * physique et la liaison ; un tunnel VPN ne documente que le réseau ; un overlay VXLAN
 * transporte du niveau 2 au-dessus du niveau 3.
 */
export const LINK_LAYERS: Record<LinkKind, OsiLayer[]> = {
  ethernet: ['l1', 'l2'],
  fiber: ['l1', 'l2'],
  trunk: ['l1', 'l2'],
  stack: ['l1', 'l2'],
  wireless: ['l1', 'l2'],
  wan: ['l1', 'l2', 'l3'],
  vpn: ['l3'],
  overlay: ['l2', 'l3'],
  heartbeat: ['l1', 'l2'],
  replication: ['l3'],
  oob: ['l1', 'l2'],
  power: ['l1'],
}

export const LAYER_LABELS_OSI: Record<OsiLayer, string> = {
  l1: 'Couche 1 — physique',
  l2: 'Couche 2 — liaison',
  l3: 'Couche 3 — réseau',
}

/** Équipements qui commutent : ils existent au niveau 2. */
const SWITCHING_KINDS = new Set([
  'core-switch',
  'switch',
  'access-switch',
  'spine',
  'leaf',
  'wifi',
  'wifi7',
  'network-tap',
  'industrial-switch',
  'san-switch',
  'wifi-bridge',
  'dect',
])

/** Équipements qui routent ou terminent un réseau IP. */
const ROUTING_KINDS = new Set([
  'router',
  'sdwan',
  'router-5g',
  'firewall',
  'ngfw',
  'loadbalancer',
  'waf',
  'ztna',
  'swg',
  'api-gateway',
  'core-switch',
  'spine',
  'wan',
  'internet',
  'cloud',
  'cloud-region',
  'vpc',
  'cloud-interconnect',
  'sase-pop',
  'cdn',
  'ot-gateway',
  'wlan-controller',
  'vpn-concentrator',
  'modem',
])

/**
 * Équipements sans pile réseau : l'énergie, l'environnement et le brassage passif. Ils
 * existent au niveau physique — un panneau de brassage se voit et se câble — mais ils ne
 * commutent ni ne routent : ils disparaissent des vues 2 et 3.
 */
const NON_NETWORK_KINDS = new Set([
  'ups',
  'pdu',
  'generator',
  'cooling',
  'patch-panel',
  'media-converter',
])

/** Extérieurs dont on ne documente pas l'adressage : on ne numérote pas Internet. */
const OPAQUE_KINDS = new Set(['internet', 'cloud', 'cdn', 'sase-pop', 'satellite', 'cloud-region'])

export function linkLayers(link: NetLink): OsiLayer[] {
  return link.layers && link.layers.length > 0 ? link.layers : (LINK_LAYERS[link.kind] ?? ['l1', 'l2'])
}

/** Une liaison concerne-t-elle la vue demandée ? */
export function linkInView(link: NetLink, view: OsiView): boolean {
  if (view === 'all') return true
  return linkLayers(link).includes(view)
}

/**
 * Un équipement concerne-t-il la vue demandée ?
 *
 * — couche 1 : tout, y compris l'énergie ;
 * — couche 2 : ce qui commute et ce qui se raccorde (hors énergie) ;
 * — couche 3 : ce qui route ou porte une adresse IP.
 */
export function nodeInView(node: NetNode, view: OsiView): boolean {
  if (view === 'all' || view === 'l1') return true
  const kind = node.kind
  if (NON_NETWORK_KINDS.has(kind)) return false
  if (view === 'l2') return true
  return (
    ROUTING_KINDS.has(kind) ||
    !!node.ip?.trim() ||
    !!node.vip?.trim() ||
    (!SWITCHING_KINDS.has(kind) && deviceMeta(kind).rank >= 6)
  )
}

/** Développe « 10,20,30-33 » en ['10','20','30','31','32','33']. */
export function parseVlanList(value?: string): string[] {
  if (!value) return []
  const out: string[] = []
  for (const part of value.split(/[,;]/)) {
    const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (end - start > 400) continue
      for (let id = start; id <= end; id += 1) out.push(String(id))
      continue
    }
    const single = part.trim()
    if (single) out.push(single)
  }
  return [...new Set(out)]
}

const VLAN_COLORS = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#db2777',
  '#7c3aed',
  '#0891b2',
  '#dc2626',
  '#65a30d',
  '#c026d3',
  '#0d9488',
]

/** Couleur d'un VLAN : celle qui est déclarée, sinon une couleur stable déduite du numéro. */
export function vlanColor(id: string, vlans: VlanDef[] = []): string {
  const declared = vlans.find((vlan) => vlan.id === id)
  if (declared?.color) return declared.color
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return VLAN_COLORS[hash % VLAN_COLORS.length]
}

export function vlanLabel(id: string, vlans: VlanDef[] = []): string {
  const declared = vlans.find((vlan) => vlan.id === id)
  return declared?.name ? `${id} — ${declared.name}` : id
}

/** Libellé d'une liaison, adapté à la couche regardée. */
/** Configuration d'une extrémité de liaison, valeurs communes déjà appliquées. */
export interface LinkEndConfig {
  port?: string
  mode?: PortMode
  vlans?: string
  nativeVlan?: string
  stp?: StpRole
  lag?: string
  ip?: string
}

const trimmed = (value?: string) => value?.trim() || undefined

/**
 * Configuration d'un côté de la liaison.
 *
 * Les champs propres à l'extrémité l'emportent ; à défaut, la valeur commune s'applique.
 * C'est ce qui permet de documenter « trunk 10,20 des deux côtés » en une fois, tout en
 * décrivant un rôle spanning-tree ou un port-channel différent sur chaque équipement.
 */
export function linkEnd(link: NetLink, end: 'a' | 'b'): LinkEndConfig {
  const pick = <T,>(a: T | undefined, b: T | undefined, common: T | undefined) =>
    (end === 'a' ? a : b) ?? common
  return {
    port: trimmed(end === 'a' ? link.portA : link.portB),
    mode: pick(link.modeA, link.modeB, link.mode),
    vlans: trimmed(pick(link.vlansA, link.vlansB, link.vlans)),
    nativeVlan: trimmed(pick(link.nativeVlanA, link.nativeVlanB, link.nativeVlan)),
    stp: pick(link.stpA, link.stpB, link.stp),
    lag: trimmed(pick(link.lagA, link.lagB, link.lag)),
    ip: trimmed(end === 'a' ? link.ipA : link.ipB),
  }
}

/** Rôles spanning-tree abrégés : sur un schéma, « STP desig. » suffit et tient en place. */
const STP_SHORT: Record<StpRole, string> = {
  root: 'racine',
  designated: 'desig.',
  alternate: 'altern.',
  blocking: 'bloqué',
  edge: 'edge',
}

/** Résumé de couche 2 d'une extrémité : mode et VLAN, VLAN natif, agrégat, rôle STP. */
function l2Summary(config: LinkEndConfig): string {
  const parts: string[] = []
  if (config.mode === 'trunk') parts.push(config.vlans ? `T ${config.vlans}` : 'trunk')
  else if (config.mode === 'access') parts.push(config.vlans ? `A ${config.vlans}` : 'accès')
  else if (config.vlans) parts.push(`VLAN ${config.vlans}`)
  if (config.nativeVlan) parts.push(`natif ${config.nativeVlan}`)
  if (config.lag) parts.push(config.lag)
  if (config.stp) parts.push(`STP ${STP_SHORT[config.stp]}`)
  return parts.join(' · ')
}

/**
 * Ce qui s'écrit à chaque extrémité d'une liaison, du côté de l'équipement concerné.
 *
 * Un port et sa configuration n'appartiennent pas à la liaison mais à l'équipement où elle
 * est branchée : au milieu du trait, « Gi1/0/1 ↔ Gi0/1 » oblige à deviner lequel est de quel
 * côté, et il n'y a pas de place pour dire que le trunk est racine ici et bloquant là. Écrit
 * à la sortie de chaque boîte, chaque bout se lit sans ambiguïté — c'est ainsi que se lisent
 * les plans de brassage. Même logique en couche 3 avec les adresses d'interface.
 */
/**
 * Ce qui s'écrit à chaque bout d'une liaison.
 *
 * En vue « toutes couches », on n'écrit rien par défaut : le schéma serait illisible. Le mode
 * technique, lui, demande justement tout — d'où `complet`, qui réunit alors port, résumé de
 * niveau 2 et adresse.
 */
export function linkEndLabels(
  link: NetLink,
  view: OsiView,
  complet = false,
): { a?: string[]; b?: string[] } {
  if (view === 'l1') {
    return { a: [link.portA?.trim()].filter(Boolean) as string[], b: [link.portB?.trim()].filter(Boolean) as string[] }
  }
  if (view === 'l2') {
    const lines = (end: 'a' | 'b') => {
      const config = linkEnd(link, end)
      return [config.port, l2Summary(config)].filter(Boolean) as string[]
    }
    return { a: lines('a'), b: lines('b') }
  }
  if (view === 'l3') {
    return {
      a: [linkEnd(link, 'a').ip].filter(Boolean) as string[],
      b: [linkEnd(link, 'b').ip].filter(Boolean) as string[],
    }
  }
  if (complet) {
    const lignes = (end: 'a' | 'b') => {
      const config = linkEnd(link, end)
      return [config.port, l2Summary(config), config.ip].filter(Boolean) as string[]
    }
    return { a: lignes('a'), b: lignes('b') }
  }
  return {}
}

/** Vrai si la liaison porte au moins une information à afficher à ses extrémités. */
export function hasEndLabels(link: NetLink, view: OsiView): boolean {
  const labels = linkEndLabels(link, view)
  return (labels.a?.length ?? 0) > 0 || (labels.b?.length ?? 0) > 0
}

export function linkLabelFor(link: NetLink, view: OsiView): string {
  const parts: string[] = []
  if (view === 'l1') {
    if (link.speed) parts.push(link.speed)
    if (parts.length === 0 && link.label) parts.push(link.label)
    return parts.join(' · ')
  }
  if (view === 'l2') {
    // Mode, VLAN, agrégat et rôle STP sont écrits côté équipement : au milieu ne reste que
    // ce qui vaut pour tout le câble.
    if (link.mtu) parts.push(`MTU ${link.mtu}`)
    if (!hasEndLabels(link, 'l2')) {
      const vlans = link.vlans?.trim()
      if (link.mode === 'trunk') parts.unshift(vlans ? `T ${vlans}` : 'trunk')
      else if (link.mode === 'access') parts.unshift(vlans ? `A ${vlans}` : 'accès')
      else if (vlans) parts.unshift(`VLAN ${vlans}`)
      if (parts.length === 0 && link.label) parts.push(link.label)
    }
    return parts.join(' · ')
  }
  if (view === 'l3') {
    if (link.subnet) parts.push(link.subnet)
    if (link.vrf) parts.push(`VRF ${link.vrf}`)
    if (link.routing) parts.push(link.routing.toUpperCase())
    if (parts.length === 0 && link.label) parts.push(link.label)
    return parts.join(' · ')
  }
  return [link.label, link.speed].filter(Boolean).join(' · ')
}

/** Couleur de tracé d'une liaison dans la vue niveau 2 : celle de son VLAN s'il est unique. */
export function linkColorFor(link: NetLink, view: OsiView, vlans: VlanDef[] = []): string | undefined {
  if (view !== 'l2') return undefined
  const list = parseVlanList(link.vlans)
  if (list.length !== 1) return undefined
  return vlanColor(list[0], vlans)
}

// ─── Arithmétique d'adressage ────────────────────────────────────────────────

function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const byte = Number(part)
    if (byte > 255) return null
    value = value * 256 + byte
  }
  return value
}

export interface Subnet {
  network: number
  bits: number
}

export function parseSubnet(cidr: string): Subnet | null {
  const match = cidr.trim().match(/^([\d.]+)\s*\/\s*(\d{1,2})$/)
  if (!match) return null
  const base = ipToInt(match[1])
  const bits = Number(match[2])
  if (base === null || bits < 0 || bits > 32) return null
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return { network: (base & mask) >>> 0, bits }
}

export function ipInSubnet(ip: string, cidr: string): boolean | null {
  const subnet = parseSubnet(cidr)
  const value = ipToInt(ip)
  if (!subnet || value === null) return null
  const mask = subnet.bits === 0 ? 0 : (0xffffffff << (32 - subnet.bits)) >>> 0
  return ((value & mask) >>> 0) === subnet.network
}

export function subnetKey(cidr: string): string | null {
  const subnet = parseSubnet(cidr)
  return subnet ? `${subnet.network}/${subnet.bits}` : null
}

// ─── Plan d'adressage ────────────────────────────────────────────────────────

/** VLAN réellement utilisés dans le schéma (sur les équipements et sur les liaisons). */
export function usedVlans(diagram: Diagram): Map<string, { nodes: string[]; links: string[] }> {
  const used = new Map<string, { nodes: string[]; links: string[] }>()
  const touch = (id: string) => {
    const entry = used.get(id)
    if (entry) return entry
    const fresh = { nodes: [] as string[], links: [] as string[] }
    used.set(id, fresh)
    return fresh
  }
  for (const node of diagram.nodes) {
    for (const id of parseVlanList(node.vlan?.replace(/vlan/gi, ''))) touch(id).nodes.push(node.id)
  }
  for (const link of diagram.links) {
    for (const id of parseVlanList(link.vlans)) touch(id).links.push(link.id)
    if (link.nativeVlan) touch(link.nativeVlan.trim()).links.push(link.id)
  }
  return used
}

/**
 * Complète la table des VLAN à partir de ce qui est déjà dessiné : tout VLAN cité sur un
 * équipement ou une liaison entre dans la table, et hérite d'un sous-réseau quand une
 * liaison de niveau 3 le porte déjà.
 */
export function deduceVlans(diagram: Diagram): VlanDef[] {
  const existing = new Map((diagram.vlans ?? []).map((vlan) => [vlan.id, vlan]))
  for (const id of usedVlans(diagram).keys()) {
    if (!existing.has(id)) existing.set(id, { id })
  }
  return [...existing.values()].sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id))
}

export interface OsiFinding {
  id: string
  severity: Severity
  title: string
  detail: string
  nodeIds: string[]
  linkIds: string[]
}

/**
 * Contrôles de cohérence des niveaux 2 et 3 : VLAN non déclarés, adressage incohérent,
 * trunks sans VLAN, sous-réseaux en double, agrégats à MTU divergent, boucle de niveau 2
 * sans spanning-tree documenté.
 */
export function checkOsi(diagram: Diagram): OsiFinding[] {
  const findings: OsiFinding[] = []
  const vlans = diagram.vlans ?? []
  const declared = new Map(vlans.map((vlan) => [vlan.id, vlan]))
  const used = usedVlans(diagram)
  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]))

  for (const [id, usage] of used) {
    if (declared.has(id)) continue
    findings.push({
      id: `vlan-undeclared:${id}`,
      severity: 'info',
      title: `VLAN ${id} utilisé mais absent du plan d’adressage`,
      detail: 'Ajoutez-le à la table des VLAN pour documenter son nom, son sous-réseau et sa passerelle.',
      nodeIds: usage.nodes,
      linkIds: usage.links,
    })
  }

  const subnets = new Map<string, string[]>()
  for (const vlan of vlans) {
    if (!vlan.subnet?.trim()) {
      // Un VLAN commenté est un choix assumé (VLAN natif, lien de synchronisation…) :
      // inutile de le rappeler.
      if (vlan.notes?.trim()) continue
      findings.push({
        id: `vlan-nosubnet:${vlan.id}`,
        severity: 'info',
        title: `VLAN ${vlan.id} sans sous-réseau`,
        detail: 'Un VLAN non routé reste valable ; sinon renseignez son sous-réseau pour la vue de niveau 3.',
        nodeIds: [],
        linkIds: [],
      })
      continue
    }
    const key = subnetKey(vlan.subnet)
    if (!key) {
      findings.push({
        id: `vlan-badsubnet:${vlan.id}`,
        severity: 'avertissement',
        title: `Sous-réseau illisible sur le VLAN ${vlan.id}`,
        detail: `« ${vlan.subnet} » n’est pas une notation CIDR valide (exemple : 10.10.20.0/24).`,
        nodeIds: [],
        linkIds: [],
      })
      continue
    }
    const bucket = subnets.get(key)
    if (bucket) bucket.push(vlan.id)
    else subnets.set(key, [vlan.id])

    if (vlan.gateway?.trim() && ipInSubnet(vlan.gateway, vlan.subnet) === false) {
      findings.push({
        id: `vlan-gw:${vlan.id}`,
        severity: 'avertissement',
        title: `Passerelle hors sous-réseau sur le VLAN ${vlan.id}`,
        detail: `${vlan.gateway} n’appartient pas à ${vlan.subnet}.`,
        nodeIds: [],
        linkIds: [],
      })
    }
  }

  for (const [key, ids] of subnets) {
    if (ids.length > 1) {
      findings.push({
        id: `subnet-dup:${key}`,
        severity: 'avertissement',
        title: `Même sous-réseau sur les VLAN ${ids.join(', ')}`,
        detail: 'Deux VLAN ne peuvent pas partager un sous-réseau sans routage inter-VLAN ambigu.',
        nodeIds: [],
        linkIds: [],
      })
    }
  }

  // Adresse d'un équipement hors du sous-réseau de son VLAN
  for (const node of diagram.nodes) {
    const ip = node.ip?.trim()
    if (!ip) continue
    const ids = parseVlanList(node.vlan?.replace(/vlan/gi, ''))
    if (ids.length !== 1) continue
    const vlan = declared.get(ids[0])
    if (!vlan?.subnet) continue
    if (ipInSubnet(ip, vlan.subnet) === false) {
      findings.push({
        id: `ip-outside:${node.id}`,
        severity: 'avertissement',
        title: `${node.name} : adresse hors du VLAN ${vlan.id}`,
        detail: `${ip} n’appartient pas à ${vlan.subnet}.`,
        nodeIds: [node.id],
        linkIds: [],
      })
    }
  }

  // Liaisons : trunk sans VLAN, L3 sans sous-réseau, extrémités hors sous-réseau
  for (const link of diagram.links) {
    const layers = linkLayers(link)
    const label = `${nodeById.get(link.from)?.name ?? '?'} → ${nodeById.get(link.to)?.name ?? '?'}`

    if (link.mode === 'trunk' && !link.vlans?.trim()) {
      findings.push({
        id: `trunk-novlan:${link.id}`,
        severity: 'info',
        title: `Trunk sans VLAN déclarés (${label})`,
        detail: 'Précisez les VLAN transportés : c’est l’information principale d’un schéma de niveau 2.',
        nodeIds: [],
        linkIds: [link.id],
      })
    }

    const opaque = [link.from, link.to].some((id) => {
      const node = nodeById.get(id)
      return node ? OPAQUE_KINDS.has(node.kind) : false
    })
    if (!opaque && layers.includes('l3') && !link.subnet?.trim() && !link.ipA?.trim() && !link.ipB?.trim()) {
      findings.push({
        id: `l3-nosubnet:${link.id}`,
        severity: 'info',
        title: `Liaison de niveau 3 sans adressage (${label})`,
        detail: 'Renseignez le sous-réseau ou les adresses des deux extrémités pour la vue de niveau 3.',
        nodeIds: [],
        linkIds: [link.id],
      })
    }

    if (link.subnet?.trim()) {
      for (const [side, ip] of [
        ['départ', link.ipA],
        ['arrivée', link.ipB],
      ] as const) {
        if (ip?.trim() && ipInSubnet(ip, link.subnet) === false) {
          findings.push({
            id: `link-ip:${link.id}:${side}`,
            severity: 'avertissement',
            title: `Adresse d’extrémité hors sous-réseau (${label})`,
            detail: `Côté ${side}, ${ip} n’appartient pas à ${link.subnet}.`,
            nodeIds: [],
            linkIds: [link.id],
          })
        }
      }
    }
  }

  // Agrégat dont les membres n'ont pas le même MTU
  const lags = new Map<string, NetLink[]>()
  for (const link of diagram.links) {
    const lag = link.lag?.trim()
    if (!lag) continue
    const bucket = lags.get(lag)
    if (bucket) bucket.push(link)
    else lags.set(lag, [link])
  }
  for (const [lag, members] of lags) {
    const mtus = new Set(members.map((link) => link.mtu ?? 0))
    if (mtus.size > 1) {
      findings.push({
        id: `lag-mtu:${lag}`,
        severity: 'avertissement',
        title: `MTU divergents dans l’agrégat ${lag}`,
        detail: 'Tous les membres d’un port-channel doivent partager le même MTU.',
        nodeIds: [],
        linkIds: members.map((link) => link.id),
      })
    }
  }

  // Boucle de niveau 2 : un cycle entre équipements de commutation, hors liens de pile
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const up = parent.get(id)
    if (!up || up === id) return id
    const root = find(up)
    parent.set(id, root)
    return root
  }
  const seenLags = new Set<string>()
  let loop: NetLink | undefined
  for (const link of diagram.links) {
    if (!linkLayers(link).includes('l2') || link.kind === 'stack' || LINKS[link.kind]?.service) continue
    const from = nodeById.get(link.from)
    const to = nodeById.get(link.to)
    if (!from || !to || !SWITCHING_KINDS.has(from.kind) || !SWITCHING_KINDS.has(to.kind)) continue
    const lag = link.lag?.trim()
    if (lag) {
      if (seenLags.has(lag)) continue
      seenLags.add(lag)
    }
    if (!parent.has(from.id)) parent.set(from.id, from.id)
    if (!parent.has(to.id)) parent.set(to.id, to.id)
    const rootA = find(from.id)
    const rootB = find(to.id)
    if (rootA === rootB) {
      loop = link
      break
    }
    parent.set(rootA, rootB)
  }
  if (loop && !diagram.links.some((link) => link.stp)) {
    findings.push({
      id: 'l2-loop',
      severity: 'info',
      title: 'Boucle de niveau 2 possible',
      detail:
        'Le graphe des commutateurs contient un cycle et aucun rôle spanning-tree n’est documenté. Précisez les rôles STP (racine, bloquant…) ou l’agrégat qui referme la boucle.',
      nodeIds: [loop.from, loop.to],
      linkIds: [loop.id],
    })
  }

  const order: Record<Severity, number> = { critique: 0, avertissement: 1, info: 2 }
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title))
}
