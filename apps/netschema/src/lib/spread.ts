import { NODE_H, NODE_W } from '../types'
import type { Point, Side } from './routing'

/**
 * Répartition des liaisons sur les arêtes des équipements.
 *
 * Sans elle, toutes les liaisons qui quittent un switch par le bas partent exactement du
 * même point : elles se superposent sur plusieurs dizaines de pixels avant de diverger, et
 * le schéma ment — on ne voit qu'un trait là où il y en a quatre. Les répartir le long de
 * l'arête, dans l'ordre de leurs destinations, suffit à les séparer sans croiser.
 *
 * Ce que l'utilisateur a posé à la main (point d'accroche libre, point de passage) n'est
 * jamais déplacé : la répartition n'agit que sur les accroches automatiques.
 */

/** Écart maximal entre deux accroches voisines sur une même arête. */
const MAX_STEP = 20

/** Marge conservée aux coins de la boîte. */
const MARGIN = 16

export interface SpreadEnd {
  /** Équipement sur lequel cette extrémité est branchée. */
  nodeId: string
  side: Side
  /** Point visé au-delà de l'équipement : sert à ordonner les accroches sans les croiser. */
  toward: Point
  /** Accroche posée à la main : elle ne bouge pas. */
  fixed: boolean
}

export interface SpreadInput {
  id: string
  a: SpreadEnd
  b: SpreadEnd
}

export interface SpreadResult {
  offsetA: number
  offsetB: number
}

const isVertical = (side: Side) => side === 'top' || side === 'bottom'

/** Coordonnée du point visé le long de l'arête : c'est elle qui donne l'ordre des accroches. */
function along(end: SpreadEnd): number {
  return isVertical(end.side) ? end.toward.x : end.toward.y
}

/** Segment de couloir d'une liaison : l'axe qu'elle emprunte entre ses deux équipements. */
export interface CorridorEntry {
  id: string
  orientation: 'h' | 'v'
  /** Coordonnée de l'axe : ordonnée d'un couloir horizontal, abscisse d'un vertical. */
  coord: number
  start: number
  end: number
  /** Tracé posé à la main : il garde son couloir, les autres s'écartent autour. */
  fixed: boolean
}

/** Tolérance en deçà de laquelle deux couloirs sont considérés comme confondus. */
const LANE_TOLERANCE = 6

/**
 * Attribue un couloir à chaque liaison.
 *
 * Deux liaisons qui empruntent le même axe sur une portion commune sont confondues : on les
 * range dans des couloirs voisins, comme des câbles dans un chemin de câbles. C'est un
 * coloriage de graphe d'intervalles : en balayant les couloirs de gauche à droite, chaque
 * liaison prend le premier couloir encore libre à cet endroit — celles qui ne se gênent pas
 * gardent le couloir central.
 */
export function assignLanes(entries: CorridorEntry[], step = 12): Map<string, number> {
  const groups = new Map<string, CorridorEntry[]>()
  for (const entry of entries) {
    const key = `${entry.orientation}|${Math.round(entry.coord / LANE_TOLERANCE)}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(entry)
    else groups.set(key, [entry])
  }

  const lanes = new Map<string, number>()
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue
    // Les tracés manuels d'abord : ils gardent le couloir central, les autres s'écartent.
    const sorted = [...bucket].sort(
      (a, b) => Number(b.fixed) - Number(a.fixed) || a.start - b.start || a.id.localeCompare(b.id),
    )
    /** Fin de la dernière liaison placée dans chaque couloir. */
    const ends: number[] = []
    for (const entry of sorted) {
      let index = ends.findIndex((end) => end <= entry.start + 1)
      if (entry.fixed) index = 0
      if (index === -1) index = ends.length
      ends[index] = Math.max(ends[index] ?? -Infinity, entry.end)
      if (index > 0) {
        // 1 → +1 couloir, 2 → −1, 3 → +2… : le premier ne bouge pas, les suivants
        // s'écartent de part et d'autre.
        const rank = Math.ceil(index / 2)
        lanes.set(entry.id, (index % 2 === 1 ? rank : -rank) * step)
      }
    }
  }
  return lanes
}

/** Couloir emprunté par un tracé : son plus long segment intermédiaire. */
export function corridorOf(
  id: string,
  points: Point[],
  fixed: boolean,
): CorridorEntry | null {
  if (points.length < 4) return null
  let best: CorridorEntry | null = null
  for (let i = 1; i < points.length - 2; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const horizontal = Math.abs(a.y - b.y) < 0.5
    const vertical = Math.abs(a.x - b.x) < 0.5
    if (!horizontal && !vertical) continue
    const length = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y)
    if (length < 24) continue
    const entry: CorridorEntry = horizontal
      ? { id, orientation: 'h', coord: a.y, start: Math.min(a.x, b.x), end: Math.max(a.x, b.x), fixed }
      : { id, orientation: 'v', coord: a.x, start: Math.min(a.y, b.y), end: Math.max(a.y, b.y), fixed }
    if (!best || entry.end - entry.start > best.end - best.start) best = entry
  }
  return best
}

export function spreadAnchors(links: SpreadInput[]): Map<string, SpreadResult> {
  const groups = new Map<string, { id: string; end: 'a' | 'b'; along: number }[]>()

  for (const link of links) {
    for (const end of ['a', 'b'] as const) {
      const side = link[end]
      if (side.fixed) continue
      const key = `${side.nodeId}|${side.side}`
      const entry = { id: link.id, end, along: along(side) }
      const bucket = groups.get(key)
      if (bucket) bucket.push(entry)
      else groups.set(key, [entry])
    }
  }

  const offsets = new Map<string, SpreadResult>()
  const put = (id: string, end: 'a' | 'b', value: number) => {
    const current = offsets.get(id) ?? { offsetA: 0, offsetB: 0 }
    offsets.set(id, end === 'a' ? { ...current, offsetA: value } : { ...current, offsetB: value })
  }

  for (const [key, entries] of groups) {
    if (entries.length < 2) continue
    const vertical = key.endsWith('|top') || key.endsWith('|bottom')
    const usable = (vertical ? NODE_W : NODE_H) / 2 - MARGIN
    // Rangées dans l'ordre de leurs destinations, les accroches ne se croisent pas entre
    // elles : la liaison qui part le plus à gauche sort le plus à gauche.
    const sorted = [...entries].sort((x, y) => x.along - y.along || x.id.localeCompare(y.id))
    const step = Math.min(MAX_STEP, (usable * 2) / (sorted.length - 1))
    sorted.forEach((entry, index) => {
      put(entry.id, entry.end, (index - (sorted.length - 1) / 2) * step)
    })
  }

  return offsets
}
