import { deviceMeta, LINKS, rankOf } from './catalog'
import { NODE_H, NODE_W, type DetailLevel, type Diagram, type LayoutDirection, type NetLink, type NetNode } from '../types'

export type GroupType = 'site' | 'zone' | 'cluster'

export interface CollapsibleGroup {
  /** Clé stable « type:valeur », utilisée pour mémoriser l'état replié. */
  key: string
  type: GroupType
  label: string
  count: number
}

export interface GroupBadge {
  key: string
  type: GroupType
  label: string
  count: number
  /** Types d'équipements contenus, du plus fréquent au moins fréquent. */
  kinds: string[]
}

export interface DisplayNode extends NetNode {
  /** Renseigné quand le nœud représente un groupe replié. */
  group?: GroupBadge
}

export interface DerivedDiagram {
  nodes: DisplayNode[]
  links: NetLink[]
  hiddenNodes: number
  hiddenLinks: number
}

const groupValue = (node: NetNode, type: GroupType): string =>
  (type === 'site' ? node.site : type === 'zone' ? node.zone : node.cluster)?.trim() ?? ''

export function groupKey(type: GroupType, label: string): string {
  return `${type}:${label}`
}

/** Groupes que l'on peut replier : tout site, zone ou grappe comptant au moins deux équipements. */
export function collapsibleGroups(diagram: Diagram): CollapsibleGroup[] {
  const groups: CollapsibleGroup[] = []
  for (const type of ['site', 'zone', 'cluster'] as GroupType[]) {
    const counts = new Map<string, number>()
    for (const node of diagram.nodes) {
      const value = groupValue(node, type)
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    for (const [label, count] of counts) {
      if (count >= 2) groups.push({ key: groupKey(type, label), type, label, count })
    }
  }
  return groups.sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label))
}

function keepForDetail(node: NetNode, detail: DetailLevel): boolean {
  const rank = rankOf(node.kind, node.rank)
  if (detail === 'full') return true
  if (detail === 'no-endpoints') return rank < 7
  return rank <= 4
}

/**
 * Transforme le schéma pour l'affichage, sans jamais modifier le modèle :
 *
 * - le niveau de détail masque les couches basses (postes, énergie) ;
 * - un groupe replié (site, zone ou grappe) devient un bloc unique ; les liaisons
 *   internes disparaissent et les liaisons externes sont reportées sur le bloc,
 *   dédoublonnées.
 *
 * C'est le principal levier de lisibilité sur une architecture complexe : on montre le
 * bâtiment, pas ses trente prises, et on l'ouvre d'un double-clic quand il faut le détail.
 */
export function deriveDiagram(
  diagram: Diagram,
  options: { collapsed: string[]; detail: DetailLevel; direction?: LayoutDirection },
): DerivedDiagram {
  const visible = diagram.nodes.filter((node) => keepForDetail(node, options.detail))
  const hiddenNodes = diagram.nodes.length - visible.length
  const collapsed = new Set(options.collapsed)

  // Un équipement n'appartient qu'à un seul bloc replié : le plus fin l'emporte
  // (grappe avant zone avant site), pour ne jamais masquer plus que demandé.
  const representative = new Map<string, string>()
  const members = new Map<string, NetNode[]>()
  for (const node of visible) {
    let key = ''
    for (const type of ['cluster', 'zone', 'site'] as GroupType[]) {
      const value = groupValue(node, type)
      if (value && collapsed.has(groupKey(type, value))) {
        key = groupKey(type, value)
        break
      }
    }
    if (!key) continue
    representative.set(node.id, key)
    const bucket = members.get(key)
    if (bucket) bucket.push(node)
    else members.set(key, [node])
  }

  const nodes: DisplayNode[] = []
  for (const node of visible) {
    if (!representative.has(node.id)) nodes.push(node)
  }

  for (const [key, group] of members) {
    const [type, ...rest] = key.split(':')
    const label = rest.join(':')
    const counts = new Map<string, number>()
    for (const member of group) counts.set(member.kind, (counts.get(member.kind) ?? 0) + 1)
    const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([kind]) => kind)
    // Le bloc se place sur la couche la plus haute qu'il contient, et au milieu des
    // équipements de cette couche : il reste ainsi dans le flux du schéma au lieu de
    // flotter au barycentre de tout le groupe.
    const topRank = Math.min(...group.map((n) => rankOf(n.kind, n.rank)))
    const anchors = group.filter((n) => rankOf(n.kind, n.rank) === topRank)
    nodes.push({
      id: `grp:${key}`,
      kind: kinds[0] ?? 'server',
      name: label,
      x: Math.round(anchors.reduce((acc, n) => acc + n.x, 0) / anchors.length),
      y: Math.round(anchors.reduce((acc, n) => acc + n.y, 0) / anchors.length),
      rank: topRank,
      zone: type === 'zone' ? undefined : group[0].zone,
      site: type === 'site' ? undefined : group[0].site,
      cluster: type === 'cluster' ? undefined : group[0].cluster,
      group: { key, type: type as GroupType, label, count: group.length, kinds },
    })
  }

  const present = new Set(nodes.map((node) => node.id))
  const target = (id: string): string | undefined => {
    const key = representative.get(id)
    if (key) return `grp:${key}`
    return present.has(id) ? id : undefined
  }

  const links: NetLink[] = []
  const seen = new Map<string, NetLink>()
  let hiddenLinks = 0
  for (const link of diagram.links) {
    const from = target(link.from)
    const to = target(link.to)
    if (!from || !to || from === to) {
      hiddenLinks += 1
      continue
    }
    if (from === link.from && to === link.to) {
      links.push(link)
      continue
    }
    // Liaison reportée sur un bloc : on n'en garde qu'une par couple et par type,
    // en privilégiant une liaison de transport sur une liaison de service.
    const key = [from, to].sort().join('~')
    const existing = seen.get(key)
    const isTransport = !LINKS[link.kind]?.service
    if (existing && (!isTransport || !LINKS[existing.kind]?.service)) {
      hiddenLinks += 1
      continue
    }
    const merged: NetLink = { ...link, id: `${link.id}@${key}`, from, to, label: undefined, speed: undefined }
    if (existing) {
      const index = links.indexOf(existing)
      if (index >= 0) links.splice(index, 1, merged)
      hiddenLinks += 1
    } else {
      links.push(merged)
    }
    seen.set(key, merged)
  }

  // Replier un groupe vide une rangée entière : on referme le trou laissé, sinon la vue
  // simplifiée reste aussi haute que le schéma complet.
  const compacted =
    options.collapsed.length > 0 || options.detail !== 'full'
      ? compactRows(nodes, (options.direction ?? 'TB') === 'TB')
      : nodes

  return { nodes: compacted, links, hiddenNodes, hiddenLinks }
}

/** Resserre les rangées trop espacées, sans jamais toucher au modèle. */
function compactRows(nodes: DisplayNode[], vertical: boolean): DisplayNode[] {
  if (nodes.length < 2) return nodes
  const size = vertical ? NODE_H : NODE_W
  const standard = size + 96
  const main = (node: DisplayNode) => (vertical ? node.y : node.x)

  const sorted = [...nodes].sort((a, b) => main(a) - main(b))
  const rows: DisplayNode[][] = []
  for (const node of sorted) {
    const row = rows[rows.length - 1]
    if (row && main(node) - main(row[0]) <= size * 1.2) row.push(node)
    else rows.push([node])
  }

  const shifts = new Map<DisplayNode, number>()
  let shift = 0
  for (let i = 1; i < rows.length; i += 1) {
    const gap = main(rows[i][0]) - main(rows[i - 1][0])
    if (gap > standard * 1.5) shift -= gap - standard
    for (const node of rows[i]) shifts.set(node, shift)
  }
  if (shift === 0) return nodes

  return nodes.map((node) => {
    const delta = shifts.get(node) ?? 0
    if (delta === 0) return node
    return vertical ? { ...node, y: node.y + delta } : { ...node, x: node.x + delta }
  })
}

/** Équipements réels contenus dans un bloc replié. */
export function groupMembers(diagram: Diagram, key: string): NetNode[] {
  const [type, ...rest] = key.split(':')
  const label = rest.join(':')
  return diagram.nodes.filter((node) => groupValue(node, type as GroupType) === label)
}

/** Libellé court d'un bloc replié, affiché sous son nom. */
export function groupSummary(group: GroupBadge): string {
  const label = group.type === 'site' ? 'site' : group.type === 'zone' ? 'zone' : 'grappe'
  const kinds = group.kinds
    .slice(0, 2)
    .map((kind) => deviceMeta(kind).label)
    .join(', ')
  return `${group.count} équipements · ${label}${kinds ? ` · ${kinds}` : ''}`
}
