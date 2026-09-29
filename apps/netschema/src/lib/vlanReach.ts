import { linkEnd, parseVlanList } from './osi'
import type { Diagram, NetLink, NetNode } from '../types'

/**
 * Portée réelle d'un VLAN.
 *
 * Un VLAN ne vit pas là où on l'écrit : il vit là où il est **étendu**. On le déclare sur le
 * cœur de réseau, et il atteint tout ce que les trunks desservent — c'est le principe même
 * d'un réseau commuté. Un schéma qui ne montre le VLAN 20 que sur le switch où on l'a saisi
 * ment sur son domaine de diffusion, et c'est précisément ce domaine qu'on cherche à voir en
 * vue logique, en analyse de flux ou avant une migration.
 *
 * Ce module propage donc les VLAN de proche en proche, sur les seules liaisons qui les
 * transportent vraiment, et garde trace de la raison : déclaré ici, ou reçu par un trunk.
 */

/** Pourquoi un équipement ou une liaison appartient au domaine. */
export type OrigineVlan = 'declare' | 'trunk'

export interface PorteeVlan {
  nodes: Map<string, OrigineVlan>
  links: Map<string, OrigineVlan>
}

/** Équipements qui relaient un VLAN d'un port à l'autre. Un serveur ne relaie rien. */
const RELAIS = new Set([
  'core-switch',
  'switch',
  'access-switch',
  'spine',
  'leaf',
  'industrial-switch',
  'din-switch',
  'network-tap',
  'wifi-bridge',
  'wlan-controller',
])

/** Types de liaison qui sont des trunks par nature. */
const TRUNKS = new Set<NetLink['kind']>(['trunk', 'stack', 'overlay'])

/**
 * La liaison est-elle un trunk ? Soit par son type, soit parce qu'un de ses ports est
 * déclaré en mode trunk. Un port d'accès ne porte qu'un VLAN et n'étend rien.
 */
export function estTrunk(link: NetLink): boolean {
  if (TRUNKS.has(link.kind)) return true
  return link.mode === 'trunk' || link.modeA === 'trunk' || link.modeB === 'trunk'
}

/**
 * VLAN autorisés sur une extrémité. Une liste vide veut dire « tous » : c'est le
 * comportement d'un trunk qu'on n'a pas restreint, et c'est aussi le plus fréquent sur un
 * schéma, où l'on ne recopie pas la liste des VLAN autorisés port par port.
 */
function autorises(link: NetLink, bout: 'a' | 'b'): Set<string> | null {
  const config = linkEnd(link, bout)
  const liste = parseVlanList(config.vlans)
  if (config.nativeVlan?.trim()) liste.push(config.nativeVlan.trim())
  return liste.length > 0 ? new Set(liste) : null
}

/** Le VLAN passe-t-il par cette liaison, dans le sens indiqué ? */
function transporte(link: NetLink, vlan: string, depuis: string): boolean {
  if (!estTrunk(link)) return false
  const bout = link.from === depuis ? 'a' : 'b'
  const sortie = autorises(link, bout)
  const entree = autorises(link, bout === 'a' ? 'b' : 'a')
  // Une liste restreinte des deux côtés doit contenir le VLAN de part et d'autre.
  if (sortie && !sortie.has(vlan)) return false
  if (entree && !entree.has(vlan)) return false
  return true
}

/** VLAN déclarés sur un équipement : « 20 », « VLAN 20 », « 10,20,30-33 ». */
export function vlansDeclares(node: NetNode): string[] {
  return parseVlanList(node.vlan?.replace(/vlan/gi, ''))
}

/**
 * Portée de chaque VLAN du schéma.
 *
 * Les amorces sont ce qui est écrit : un VLAN posé sur un équipement, ou porté par une
 * liaison. La propagation part ensuite des équipements qui commutent et suit les trunks,
 * jusqu'à ce que plus rien ne bouge. Un VLAN retiré de la liste autorisée d'un trunk
 * s'arrête là — c'est bien le but de cette liste.
 */
export function porteeVlans(diagram: Diagram, propager = true): Map<string, PorteeVlan> {
  const portees = new Map<string, PorteeVlan>()
  const parId = new Map(diagram.nodes.map((node) => [node.id, node]))
  const incidentes = new Map<string, NetLink[]>()
  for (const link of diagram.links) {
    for (const bout of [link.from, link.to]) {
      const liste = incidentes.get(bout)
      if (liste) liste.push(link)
      else incidentes.set(bout, [link])
    }
  }

  const portee = (id: string): PorteeVlan => {
    const existante = portees.get(id)
    if (existante) return existante
    const fraiche: PorteeVlan = { nodes: new Map(), links: new Map() }
    portees.set(id, fraiche)
    return fraiche
  }

  // ── Amorces : tout ce qui est écrit noir sur blanc ──────────────────────────
  const files = new Map<string, string[]>()
  const enfiler = (vlan: string, nodeId: string) => {
    const file = files.get(vlan)
    if (file) file.push(nodeId)
    else files.set(vlan, [nodeId])
  }

  for (const node of diagram.nodes) {
    for (const vlan of vlansDeclares(node)) {
      portee(vlan).nodes.set(node.id, 'declare')
      enfiler(vlan, node.id)
    }
  }
  for (const link of diagram.links) {
    const cites = new Set([
      ...parseVlanList(link.vlans),
      ...parseVlanList(link.vlansA),
      ...parseVlanList(link.vlansB),
      ...[link.nativeVlan, link.nativeVlanA, link.nativeVlanB]
        .map((valeur) => valeur?.trim())
        .filter((valeur): valeur is string => !!valeur),
    ])
    for (const vlan of cites) {
      const cible = portee(vlan)
      cible.links.set(link.id, 'declare')
      for (const bout of [link.from, link.to]) {
        if (!parId.has(bout)) continue
        if (!cible.nodes.has(bout)) cible.nodes.set(bout, 'declare')
        enfiler(vlan, bout)
      }
    }
  }

  if (!propager) return portees

  // ── Propagation : de commutateur en commutateur, le long des trunks ─────────
  for (const [vlan, file] of files) {
    const cible = portee(vlan)
    const vus = new Set(file)
    while (file.length > 0) {
      const courant = file.shift() as string
      const node = parId.get(courant)
      // Seul un équipement qui commute étend un VLAN à ses autres ports.
      if (!node || !RELAIS.has(node.kind)) continue
      for (const link of incidentes.get(courant) ?? []) {
        if (!transporte(link, vlan, courant)) continue
        if (!cible.links.has(link.id)) cible.links.set(link.id, 'trunk')
        const voisin = link.from === courant ? link.to : link.from
        if (!parId.has(voisin)) continue
        if (!cible.nodes.has(voisin)) cible.nodes.set(voisin, 'trunk')
        if (!vus.has(voisin)) {
          vus.add(voisin)
          file.push(voisin)
        }
      }
    }
  }

  return portees
}

/** Combien d'équipements et de liaisons un VLAN atteint, et par quel chemin. */
export function resumePortee(portee: PorteeVlan | undefined): {
  equipements: number
  liaisons: number
  parTrunk: number
} {
  if (!portee) return { equipements: 0, liaisons: 0, parTrunk: 0 }
  let parTrunk = 0
  for (const origine of portee.nodes.values()) if (origine === 'trunk') parTrunk += 1
  return { equipements: portee.nodes.size, liaisons: portee.links.size, parTrunk }
}
