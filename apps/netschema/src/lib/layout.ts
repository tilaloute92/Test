import { LAYER_LABELS, rankOf } from './catalog'
import { NODE_H, NODE_W, type Diagram, type LayoutOptions, type NetNode } from '../types'

const ORIGIN_MAIN = 130
const ORIGIN_CROSS_TB = 660
const ORIGIN_CROSS_LR = 420

/** Coordonnée « transversale » (dans une couche) d'un équipement. */
function cross(node: NetNode, direction: LayoutOptions['direction']): number {
  return direction === 'TB' ? node.x : node.y
}

function buildAdjacency(diagram: Diagram): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const node of diagram.nodes) adj.set(node.id, [])
  for (const link of diagram.links) {
    adj.get(link.from)?.push(link.to)
    adj.get(link.to)?.push(link.from)
  }
  return adj
}

const trimmed = (value?: string) => value?.trim() ?? ''

/** Index alphabétique d'une valeur de regroupement ; les équipements sans valeur passent en dernier. */
function groupIndexer(nodes: NetNode[], pick: (node: NetNode) => string) {
  const values = [...new Set(nodes.map(pick).filter(Boolean))].sort()
  return (node: NetNode) => {
    const value = pick(node)
    return value ? values.indexOf(value) : values.length
  }
}

/**
 * Placement automatique par couches.
 *
 * 1. chaque équipement reçoit une couche (celle de son type, ou celle forcée à la main) ;
 * 2. les couches vides sont supprimées pour éviter les trous ;
 * 3. l'ordre à l'intérieur d'une couche est affiné par barycentres successifs — chaque
 *    équipement glisse en face de ses voisins, ce qui réduit fortement les croisements ;
 * 4. les regroupements (site, zone, grappe HA) reprennent la main sur cet ordre, pour que
 *    les membres d'une même grappe restent côte à côte ;
 * 5. les positions sont réparties avec un espacement variable — serré dans une grappe,
 *    large entre deux zones — puis chaque couche est centrée.
 *
 * Les équipements épinglés (`pinned`) gardent leur position : c'est le côté « semi »
 * de l'automatisation — on laisse l'algorithme faire le gros du travail, puis on fige
 * à la main ce qui doit l'être.
 */
export function autoLayout(diagram: Diagram, options: LayoutOptions): NetNode[] {
  if (diagram.nodes.length === 0) return diagram.nodes

  const { direction, nodeGap, layerGap, groupByZone, groupBySite } = options
  const adj = buildAdjacency(diagram)

  const buckets = new Map<number, NetNode[]>()
  for (const node of diagram.nodes) {
    const rank = rankOf(node.kind, node.rank)
    const bucket = buckets.get(rank)
    if (bucket) bucket.push(node)
    else buckets.set(rank, [node])
  }

  const ranks = [...buckets.keys()].sort((a, b) => a - b)
  const layers = ranks.map((rank) =>
    [...buckets.get(rank)!].sort(
      (a, b) => cross(a, direction) - cross(b, direction) || a.name.localeCompare(b.name),
    ),
  )

  const indexOf = new Map<string, number>()
  const layerOf = new Map<string, number>()
  const reindex = () => {
    layers.forEach((layer, li) => {
      layer.forEach((node, i) => {
        indexOf.set(node.id, i)
        layerOf.set(node.id, li)
      })
    })
  }
  reindex()

  // Tri par barycentre : quatre allers-retours suffisent à stabiliser le résultat.
  const sweep = (reference: 'previous' | 'next') => {
    const order = reference === 'previous' ? layers.map((_, i) => i) : layers.map((_, i) => layers.length - 1 - i)
    for (const li of order) {
      const refIndex = reference === 'previous' ? li - 1 : li + 1
      if (refIndex < 0 || refIndex >= layers.length) continue
      const scores = new Map<string, number>()
      layers[li].forEach((node, i) => {
        const neighbours = (adj.get(node.id) ?? []).filter((id) => layerOf.get(id) === refIndex)
        if (neighbours.length === 0) {
          scores.set(node.id, i)
          return
        }
        const sum = neighbours.reduce((acc, id) => acc + (indexOf.get(id) ?? 0), 0)
        scores.set(node.id, sum / neighbours.length)
      })
      layers[li].sort((a, b) => (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0))
      reindex()
    }
  }

  for (let pass = 0; pass < 4; pass += 1) {
    sweep('previous')
    sweep('next')
  }

  // Regroupements : site (le plus large), puis zone, puis grappe HA (le plus serré).
  const siteIndex = groupIndexer(diagram.nodes, (n) => trimmed(n.site))
  const zoneIndex = groupIndexer(diagram.nodes, (n) => trimmed(n.zone))
  const clusterIndex = groupIndexer(diagram.nodes, (n) => trimmed(n.cluster))
  for (const layer of layers) {
    const current = new Map(layer.map((node, i) => [node.id, i]))
    layer.sort(
      (a, b) =>
        (groupBySite ? siteIndex(a) - siteIndex(b) : 0) ||
        (groupByZone ? zoneIndex(a) - zoneIndex(b) : 0) ||
        clusterIndex(a) - clusterIndex(b) ||
        (current.get(a.id) ?? 0) - (current.get(b.id) ?? 0),
    )
  }
  reindex()

  const crossCenter = direction === 'TB' ? ORIGIN_CROSS_TB : ORIGIN_CROSS_LR
  const size = direction === 'TB' ? NODE_W : NODE_H
  const thickness = direction === 'TB' ? NODE_H : NODE_W

  /** Espacement entre deux voisins d'une couche, resserré dans une grappe, élargi entre groupes. */
  const gapBetween = (a: NetNode, b: NetNode): number => {
    if (trimmed(a.cluster) && trimmed(a.cluster) === trimmed(b.cluster)) return Math.max(14, nodeGap * 0.3)
    if (groupBySite && trimmed(a.site) !== trimmed(b.site)) return nodeGap * 2.2
    if (groupByZone && trimmed(a.zone) !== trimmed(b.zone)) return nodeGap * 1.5
    return nodeGap
  }

  const positions = new Map<string, { x: number; y: number }>()
  layers.forEach((layer, li) => {
    const gaps = layer.map((node, i) => (i === 0 ? 0 : gapBetween(layer[i - 1], node)))
    const span = layer.length * size + gaps.reduce((acc, g) => acc + g, 0)
    let offset = crossCenter - span / 2
    const main = ORIGIN_MAIN + li * (thickness + layerGap) + thickness / 2
    layer.forEach((node, i) => {
      offset += gaps[i]
      const c = offset + size / 2
      offset += size
      positions.set(node.id, direction === 'TB' ? { x: c, y: main } : { x: main, y: c })
    })
  })

  return diagram.nodes.map((node) => {
    const next = positions.get(node.id)
    if (!next || node.pinned) return node
    return { ...node, x: Math.round(next.x), y: Math.round(next.y) }
  })
}

export interface LayerBand {
  rank: number
  label: string
  /** Centre de la couche sur l'axe principal (y si TB, x si LR). */
  main: number
}

/**
 * Bandes de couches déduites des positions réelles (et pas du dernier placement auto),
 * afin que les libellés restent justes même après un déplacement à la main.
 */
export function layerBands(
  nodes: NetNode[],
  direction: LayoutOptions['direction'],
  noms?: Record<string, string>,
): LayerBand[] {
  const buckets = new Map<number, number[]>()
  for (const node of nodes) {
    const rank = rankOf(node.kind, node.rank)
    const main = direction === 'TB' ? node.y : node.x
    const bucket = buckets.get(rank)
    if (bucket) bucket.push(main)
    else buckets.set(rank, [main])
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rank, values]) => ({
      rank,
      label: noms?.[String(rank)] ?? LAYER_LABELS[rank] ?? `Couche ${rank}`,
      main: values.reduce((acc, v) => acc + v, 0) / values.length,
    }))
}

export interface GroupBox {
  key: string
  /** Libellé affiché ; vide sur les rangées de continuation d'un même groupe. */
  label: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Cadres regroupant les équipements partageant une même valeur (site, zone ou grappe).
 *
 * Un groupe étalé sur plusieurs couches ne donne pas un grand rectangle — qui engloberait
 * des équipements voisins n'appartenant pas au groupe — mais un cadre par rangée, étiré
 * jusqu'à la rangée suivante quand elles se suivent : l'ensemble se lit comme une seule
 * forme sans déborder sur les autres groupes.
 */
export function groupBoxes(
  nodes: NetNode[],
  pick: (node: NetNode) => string | undefined,
  padding: number,
  topSpace = 14,
  direction: LayoutOptions['direction'] = 'TB',
): GroupBox[] {
  const buckets = new Map<string, NetNode[]>()
  for (const node of nodes) {
    const key = trimmed(pick(node))
    if (!key) continue
    const bucket = buckets.get(key)
    if (bucket) bucket.push(node)
    else buckets.set(key, [node])
  }

  const vertical = direction === 'TB'
  const thickness = vertical ? NODE_H : NODE_W
  const boxes: GroupBox[] = []

  for (const [key, members] of buckets) {
    const main = (node: NetNode) => (vertical ? node.y : node.x)
    const sorted = [...members].sort((a, b) => main(a) - main(b))

    // Découpage en rangées : deux équipements d'une même rangée sont à la même hauteur
    // (à une hauteur de boîte près).
    const rows: NetNode[][] = []
    for (const node of sorted) {
      const row = rows[rows.length - 1]
      if (row && main(node) - main(row[row.length - 1]) <= thickness * 1.2) row.push(node)
      else rows.push([node])
    }

    const rects = rows.map((row) => {
      const minX = Math.min(...row.map((n) => n.x - NODE_W / 2)) - padding
      const maxX = Math.max(...row.map((n) => n.x + NODE_W / 2)) + padding
      const minY = Math.min(...row.map((n) => n.y - NODE_H / 2)) - padding
      const maxY = Math.max(...row.map((n) => n.y + NODE_H / 2)) + padding
      return { minX, maxX, minY, maxY }
    })

    rects.forEach((rect, i) => {
      const next = rects[i + 1]
      if (!next) return
      // Rangées qui se suivent : on étire la précédente jusqu'à la suivante pour souder le cadre.
      if (vertical && next.minY - rect.maxY < 170) rect.maxY = next.minY
      if (!vertical && next.minX - rect.maxX < 170) rect.maxX = next.minX
    })

    rects.forEach((rect, i) => {
      const labelled = i === 0
      const top = labelled ? rect.minY - topSpace : rect.minY
      boxes.push({
        key: `${key}#${i}`,
        label: labelled ? key : '',
        x: rect.minX,
        y: top,
        width: rect.maxX - rect.minX,
        height: rect.maxY - top,
      })
    })
  }

  return boxes
}

export function diagramBounds(nodes: NetNode[]) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 1200, maxY: 800 }
  return {
    minX: Math.min(...nodes.map((n) => n.x - NODE_W / 2)),
    maxX: Math.max(...nodes.map((n) => n.x + NODE_W / 2)),
    minY: Math.min(...nodes.map((n) => n.y - NODE_H / 2)),
    maxY: Math.max(...nodes.map((n) => n.y + NODE_H / 2)),
  }
}
