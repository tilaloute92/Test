import {
  NODE_H,
  NODE_W,
  type AnchorSide,
  type LinkShape,
  type LinkStyle,
  type NetNode,
  type Waypoint,
} from '../types'

export interface Point {
  x: number
  y: number
}

const CORNER = 10

/** Transforme une ligne brisée en chemin SVG à angles arrondis. */
function roundedPath(points: Point[], radius = CORNER): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]
    const curr = points[i]
    const next = points[i + 1]
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y)
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    if (r < 1) {
      d += ` L ${curr.x} ${curr.y}`
      continue
    }
    const from = {
      x: curr.x + ((prev.x - curr.x) / inLen) * r,
      y: curr.y + ((prev.y - curr.y) / inLen) * r,
    }
    const to = {
      x: curr.x + ((next.x - curr.x) / outLen) * r,
      y: curr.y + ((next.y - curr.y) / outLen) * r,
    }
    d += ` L ${from.x} ${from.y} Q ${curr.x} ${curr.y} ${to.x} ${to.y}`
  }
  const last = points[points.length - 1]
  return `${d} L ${last.x} ${last.y}`
}

/** Courbe lissée passant par tous les points (Catmull-Rom converti en Bézier). */
function smoothPath(points: Point[]): string {
  if (points.length < 3) return `M ${points[0].x} ${points[0].y} L ${points[points.length - 1].x} ${points[points.length - 1].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${
      p2.y - (p3.y - p1.y) / 6
    }, ${p2.x} ${p2.y}`
  }
  return d
}

function lengthsOf(points: Point[]): { lengths: number[]; total: number } {
  const lengths: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    lengths.push(len)
    total += len
  }
  return { lengths, total }
}

function midpointOf(points: Point[]): Point {
  const { lengths, total } = lengthsOf(points)
  let remaining = total / 2
  for (let i = 0; i < lengths.length; i += 1) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const ratio = lengths[i] === 0 ? 0 : remaining / lengths[i]
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
      }
    }
    remaining -= lengths[i]
  }
  return points[0]
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value))
}

type Side = 'top' | 'bottom' | 'left' | 'right'

/** Côté d'accroche déduit de la direction vers le point suivant, à défaut d'un côté imposé. */
function sideToward(node: NetNode, target: Point, forced: AnchorSide | undefined): Side {
  if (forced && forced !== 'auto') return forced
  const dx = target.x - node.x
  const dy = target.y - node.y
  const vertical = Math.abs(dy) / NODE_H >= Math.abs(dx) / NODE_W
  if (vertical) return dy >= 0 ? 'bottom' : 'top'
  return dx >= 0 ? 'right' : 'left'
}

function anchorPoint(node: NetNode, side: Side, offset: number): Point {
  const vertical = side === 'top' || side === 'bottom'
  const shift = clamp(offset, (vertical ? NODE_W : NODE_H) / 2 - 14)
  if (side === 'top') return { x: node.x + shift, y: node.y - NODE_H / 2 }
  if (side === 'bottom') return { x: node.x + shift, y: node.y + NODE_H / 2 }
  if (side === 'left') return { x: node.x - NODE_W / 2, y: node.y + shift }
  return { x: node.x + NODE_W / 2, y: node.y + shift }
}

const isVertical = (side: Side) => side === 'top' || side === 'bottom'

/** Insère les coudes nécessaires pour relier deux points à angles droits. */
function elbow(from: Point, to: Point, verticalFirst: boolean): Point[] {
  if (Math.abs(from.x - to.x) < 1 || Math.abs(from.y - to.y) < 1) return []
  return verticalFirst ? [{ x: from.x, y: to.y }] : [{ x: to.x, y: from.y }]
}

function dedupe(points: Point[]): Point[] {
  return points.filter(
    (point, index) =>
      index === 0 || Math.abs(point.x - points[index - 1].x) > 0.5 || Math.abs(point.y - points[index - 1].y) > 0.5,
  )
}

export interface LinkGeometry {
  /** Chemin SVG complet. */
  d: string
  /** Milieu du tracé, pour l'étiquette. */
  mid: Point
  /** Ligne brisée complète (ancres, coudes et points manuels). */
  points: Point[]
  /** Points manipulables : ancre de départ, points manuels, ancre d'arrivée. */
  nodes: Point[]
  /** Points de passage manuels seuls, dans l'ordre. */
  waypoints: Point[]
}

export interface RouteOptions {
  /** Tracé par défaut du schéma. */
  style: LinkStyle
  /** Tracé imposé pour cette liaison. */
  shape?: LinkShape
  /** Décalage des liaisons parallèles. */
  offset?: number
  waypoints?: Waypoint[]
  anchorA?: AnchorSide
  anchorB?: AnchorSide
}

/**
 * Trace une liaison entre deux équipements.
 *
 * Sans point de passage, le tracé reste automatique : sortie par le côté qui fait face au
 * voisin, coude à mi-chemin, liaisons parallèles étalées. Dès qu'un point de passage est
 * posé à la main, c'est lui qui commande — la liaison passe par où on lui dit, et les côtés
 * d'accroche peuvent être imposés de part et d'autre.
 */
export function linkGeometry(a: NetNode, b: NetNode, options: RouteOptions): LinkGeometry {
  const offset = options.offset ?? 0
  const waypoints = (options.waypoints ?? []).map((point) => ({ x: point.x, y: point.y }))
  const shape: LinkShape = options.shape && options.shape !== 'auto' ? options.shape : options.style

  const sideA = sideToward(a, waypoints[0] ?? { x: b.x, y: b.y }, options.anchorA)
  const sideB = sideToward(b, waypoints[waypoints.length - 1] ?? { x: a.x, y: a.y }, options.anchorB)
  const from = anchorPoint(a, sideA, offset)
  const to = anchorPoint(b, sideB, offset)
  const nodes = [from, ...waypoints, to]

  let points: Point[]
  if (shape === 'straight' || shape === 'curved') {
    points = nodes
  } else if (waypoints.length === 0) {
    // Tracé automatique historique : un seul décrochement à mi-parcours, qui donne des
    // schémas lisibles quand les équipements sont rangés en couches.
    if (isVertical(sideA) && isVertical(sideB)) {
      const mid = (from.y + to.y) / 2 + offset / 2
      points = dedupe([from, { x: from.x, y: mid }, { x: to.x, y: mid }, to])
    } else if (!isVertical(sideA) && !isVertical(sideB)) {
      const mid = (from.x + to.x) / 2 + offset / 2
      points = dedupe([from, { x: mid, y: from.y }, { x: mid, y: to.y }, to])
    } else {
      points = dedupe([from, ...elbow(from, to, isVertical(sideA)), to])
    }
  } else {
    // Avec des points de passage : un coude par segment, en sortant puis en arrivant
    // selon les côtés d'accroche.
    const built: Point[] = [nodes[0]]
    for (let i = 0; i < nodes.length - 1; i += 1) {
      const start = nodes[i]
      const end = nodes[i + 1]
      const first = i === 0
      const last = i === nodes.length - 2
      const verticalFirst = first ? isVertical(sideA) : last ? !isVertical(sideB) : i % 2 === 0
      built.push(...elbow(start, end, verticalFirst), end)
    }
    points = dedupe(built)
  }

  const d =
    shape === 'curved'
      ? smoothPath(points)
      : shape === 'straight'
        ? `M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')}`
        : roundedPath(points)

  return { d, mid: midpointOf(points), points, nodes, waypoints }
}

/**
 * Décalage à appliquer à chaque liaison d'un même couple d'équipements, pour les étaler
 * symétriquement de part et d'autre de l'axe.
 */
export function parallelOffsets(count: number, spacing = 16): number[] {
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * spacing)
}

/** Distance d'un point à un segment, et projection sur ce segment. */
function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y)
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

/**
 * Où insérer un nouveau point de passage quand on attrape la liaison à cet endroit :
 * l'index correspond au segment le plus proche parmi les points manipulables.
 */
export function insertIndexAt(geometry: LinkGeometry, point: Point): number {
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < geometry.nodes.length - 1; i += 1) {
    const distance = distanceToSegment(point, geometry.nodes[i], geometry.nodes[i + 1])
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

/** Milieux des segments manipulables : ce sont les poignées « ajouter un point ». */
export function segmentMidpoints(geometry: LinkGeometry): { index: number; point: Point }[] {
  const handles: { index: number; point: Point }[] = []
  for (let i = 0; i < geometry.nodes.length - 1; i += 1) {
    const a = geometry.nodes[i]
    const b = geometry.nodes[i + 1]
    if (Math.hypot(b.x - a.x, b.y - a.y) < 44) continue
    handles.push({ index: i, point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } })
  }
  return handles
}
