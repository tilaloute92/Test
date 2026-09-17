import {
  NODE_H,
  NODE_W,
  type AnchorSide,
  type Attach,
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

/** Rayon du petit pont dessiné là où une liaison en enjambe une autre. */
const HOP = 6

/**
 * Croisement à enjamber, tel que le tracé le reçoit : la position absolue et le segment de
 * la ligne brisée concerné. (`lib/crossings.ts` les calcule pour tout le schéma.)
 */
export interface PathHop {
  segment: number
  x: number
  y: number
}

/**
 * Portion droite d'un tracé, ponts compris.
 *
 * Chaque croisement remplace un bout de segment par un demi-cercle : le trait du dessus
 * passe par-dessus celui du dessous au lieu de le couper, et le croisement se voit.
 */
function lineWithHops(start: Point, end: Point, segment: number, hops: PathHop[]): string {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 0.01) return ` L ${end.x} ${end.y}`

  const ux = dx / length
  const uy = dy / length
  const at = (distance: number) => ({ x: start.x + ux * distance, y: start.y + uy * distance })

  const positions = hops
    .filter((hop) => hop.segment === segment)
    .map((hop) => (hop.x - start.x) * ux + (hop.y - start.y) * uy)
    // Un pont a besoin de place de part et d'autre : trop près d'un coude, il le mange.
    .filter((distance) => distance > HOP + 1 && distance < length - HOP - 1)
    .sort((a, b) => a - b)

  // Tous les ponts bombent du même côté — vers le haut pour un trait horizontal, vers la
  // gauche pour un vertical — quel que soit le sens de parcours de la liaison. Deux traits
  // superposés qui enjambent la même ligne forment alors deux bosses parallèles, et non un
  // anneau.
  const sweep = (Math.abs(ux) > Math.abs(uy) ? ux < 0 : uy > 0) ? 1 : 0

  let d = ''
  let cursor = 0
  for (const distance of positions) {
    if (distance - HOP < cursor) continue
    const before = at(distance - HOP)
    const after = at(distance + HOP)
    d += ` L ${before.x} ${before.y} A ${HOP} ${HOP} 0 0 ${sweep} ${after.x} ${after.y}`
    cursor = distance + HOP
  }
  return `${d} L ${end.x} ${end.y}`
}

/** Transforme une ligne brisée en chemin SVG à angles arrondis. */
function roundedPath(points: Point[], radius = CORNER, hops: PathHop[] = []): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  let cursor = points[0]
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]
    const curr = points[i]
    const next = points[i + 1]
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y)
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    if (r < 1) {
      d += lineWithHops(cursor, curr, i - 1, hops)
      cursor = curr
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
    d += `${lineWithHops(cursor, from, i - 1, hops)} Q ${curr.x} ${curr.y} ${to.x} ${to.y}`
    cursor = to
  }
  const last = points[points.length - 1]
  return d + lineWithHops(cursor, last, points.length - 2, hops)
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

export type Side = 'top' | 'bottom' | 'left' | 'right'

/**
 * Côté par lequel une liaison quitte un équipement : celui imposé, celui du point d'accroche
 * libre, ou à défaut celui qui fait face au point suivant. Exporté parce que le plan de
 * travail a besoin de connaître les côtés *avant* de tracer, pour répartir les liaisons qui
 * se présentent sur la même arête.
 */
export function resolveSide(
  node: NetNode,
  target: Point,
  options: { forced?: AnchorSide; attach?: Attach },
): Side {
  if (options.attach) return attachSide(options.attach)
  return sideToward(node, target, options.forced)
}

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

/** Longueur de l'amorce perpendiculaire à la boîte, sur un côté choisi à la main. */
const STUB = 24

function stub(point: Point, side: Side): Point {
  if (side === 'top') return { x: point.x, y: point.y - STUB }
  if (side === 'bottom') return { x: point.x, y: point.y + STUB }
  if (side === 'left') return { x: point.x - STUB, y: point.y }
  return { x: point.x + STUB, y: point.y }
}

/** Position, en coordonnées du schéma, d'un point d'accroche libre. */
export function attachToPoint(node: Point, attach: Attach): Point {
  return { x: node.x + attach.dx * NODE_W, y: node.y + attach.dy * NODE_H }
}

/**
 * Point d'accroche libre correspondant à un endroit désigné à la souris.
 *
 * Le point est ramené sur le pourtour de la boîte : une liaison doit toucher l'équipement,
 * pas finir en son milieu.
 */
export function pointToAttach(node: Point, point: Point): Attach {
  let dx = Math.max(-0.5, Math.min(0.5, (point.x - node.x) / NODE_W))
  let dy = Math.max(-0.5, Math.min(0.5, (point.y - node.y) / NODE_H))

  // L'arête la plus proche l'emporte : c'est elle que le pointeur désigne.
  if (Math.abs(dx) >= Math.abs(dy)) dx = dx >= 0 ? 0.5 : -0.5
  else dy = dy >= 0 ? 0.5 : -0.5

  return { dx: Math.round(dx * 1000) / 1000, dy: Math.round(dy * 1000) / 1000 }
}

/**
 * Points d'accroche remarquables, tout autour de la boîte.
 *
 * Seize repères — les quatre coins, le milieu et les quarts de chaque côté — qui donnent des
 * branchements alignés d'un équipement à l'autre sans avoir à viser au pixel. On peut toujours
 * se poser entre deux : c'est ce que fait la touche Alt.
 */
export const ANCHOR_RING: Attach[] = (() => {
  const points: Attach[] = []
  for (const dx of [-0.5, -0.25, 0, 0.25, 0.5]) {
    points.push({ dx, dy: -0.5 })
    points.push({ dx, dy: 0.5 })
  }
  for (const dy of [-0.25, 0, 0.25]) {
    points.push({ dx: -0.5, dy })
    points.push({ dx: 0.5, dy })
  }
  return points
})()

/** Distance, en pixels du schéma, en deçà de laquelle on s'aimante à un repère. */
const SNAP_RADIUS = 11

/**
 * Accroche choisie à la souris : projetée sur le bord, puis aimantée au repère le plus proche.
 *
 * L'aimant est ce qui rend l'accroche « fixable » : sans lui, deux liaisons voisines arrivent
 * à trois pixels l'une de l'autre et le schéma part de travers. `libre` (touche Alt) le
 * désactive pour les cas où l'on veut vraiment se poser entre deux repères.
 */
export function snapAttach(node: Point, point: Point, libre = false): Attach {
  const brut = pointToAttach(node, point)
  if (libre) return brut

  const cible = attachToPoint(node, brut)
  let meilleur: Attach | null = null
  let distance = SNAP_RADIUS
  for (const repere of ANCHOR_RING) {
    const candidat = attachToPoint(node, repere)
    const ecart = Math.hypot(candidat.x - cible.x, candidat.y - cible.y)
    if (ecart <= distance) {
      distance = ecart
      meilleur = repere
    }
  }
  return meilleur ?? brut
}

/** Côté de la boîte sur lequel se trouve un point d'accroche libre. */
export function attachSide(attach: Attach): Side {
  if (Math.abs(attach.dx) >= 0.499 && Math.abs(attach.dx) >= Math.abs(attach.dy)) {
    return attach.dx >= 0 ? 'right' : 'left'
  }
  if (Math.abs(attach.dy) >= 0.499) return attach.dy >= 0 ? 'bottom' : 'top'
  return Math.abs(attach.dx) >= Math.abs(attach.dy)
    ? attach.dx >= 0
      ? 'right'
      : 'left'
    : attach.dy >= 0
      ? 'bottom'
      : 'top'
}

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
  /** Forme réellement appliquée (la liaison peut imposer la sienne). */
  shape: LinkShape
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
  /** Points d'accroche libres, prioritaires sur les côtés. */
  attachA?: Attach
  attachB?: Attach
  /**
   * Écartement de l'ancre sur son arête, extrémité par extrémité. C'est ce qui évite que
   * toutes les liaisons d'un même équipement partent du même point et se superposent.
   */
  offsetA?: number
  offsetB?: number
  /** Décalage du couloir intermédiaire, pour que deux tracés parallèles ne se confondent pas. */
  lane?: number
}

/**
 * Trace une liaison entre deux équipements.
 *
 * Sans point de passage, le tracé reste automatique : sortie par le côté qui fait face au
 * voisin, coude à mi-chemin, liaisons parallèles étalées. Dès qu'un point de passage est
 * posé à la main, c'est lui qui commande — la liaison passe par où on lui dit, et les côtés
 * d'accroche peuvent être imposés de part et d'autre.
 */
/** Longueur totale d'une ligne brisée. */
export function pathLength(points: Point[]): number {
  return lengthsOf(points).total
}

export function linkGeometry(a: NetNode, b: NetNode, options: RouteOptions): LinkGeometry {
  const offset = options.offset ?? 0
  const waypoints = (options.waypoints ?? []).map((point) => ({ x: point.x, y: point.y }))
  const shape: LinkShape = options.shape && options.shape !== 'auto' ? options.shape : options.style

  // Un point d'accroche posé à la main commande tout : position exacte, et côté de sortie
  // déduit de l'arête sur laquelle il se trouve. Le décalage des liaisons parallèles ne
  // s'applique alors plus de ce côté — sinon le point ne serait plus là où on l'a mis.
  const sideA = options.attachA
    ? attachSide(options.attachA)
    : sideToward(a, waypoints[0] ?? { x: b.x, y: b.y }, options.anchorA)
  const sideB = options.attachB
    ? attachSide(options.attachB)
    : sideToward(b, waypoints[waypoints.length - 1] ?? { x: a.x, y: a.y }, options.anchorB)
  const from = options.attachA ? attachToPoint(a, options.attachA) : anchorPoint(a, sideA, options.offsetA ?? offset)
  const to = options.attachB ? attachToPoint(b, options.attachB) : anchorPoint(b, sideB, options.offsetB ?? offset)
  const lane = options.lane ?? 0
  const nodes = [from, ...waypoints, to]

  // Un côté choisi à la main mérite une amorce : la liaison sort perpendiculairement à la
  // boîte sur quelques pixels avant de repartir. Sans cela, une accroche prise à revers fait
  // traverser l'équipement au trait — il disparaît sous la boîte et semble arriver ailleurs.
  const forced =
    options.attachA !== undefined ||
    options.attachB !== undefined ||
    (options.anchorA !== undefined && options.anchorA !== 'auto') ||
    (options.anchorB !== undefined && options.anchorB !== 'auto')
  // Les deux extrémités reçoivent leur amorce dès qu'un côté est imposé : le trait quitte
  // chaque boîte perpendiculairement, et les décrochements se font tous à l'extérieur.
  const stubA = forced ? stub(from, sideA) : null
  const stubB = forced ? stub(to, sideB) : null
  const route = [from, ...(stubA ? [stubA] : []), ...waypoints, ...(stubB ? [stubB] : []), to]

  let points: Point[]
  if (shape === 'straight' || shape === 'curved') {
    points = shape === 'curved' ? route : nodes
  } else if (waypoints.length === 0 && !stubA && !stubB) {
    // Tracé automatique historique : un seul décrochement à mi-parcours, qui donne des
    // schémas lisibles quand les équipements sont rangés en couches.
    if (isVertical(sideA) && isVertical(sideB)) {
      const mid = (from.y + to.y) / 2 + offset / 2 + lane
      points = dedupe([from, { x: from.x, y: mid }, { x: to.x, y: mid }, to])
    } else if (!isVertical(sideA) && !isVertical(sideB)) {
      const mid = (from.x + to.x) / 2 + offset / 2 + lane
      points = dedupe([from, { x: mid, y: from.y }, { x: mid, y: to.y }, to])
    } else {
      points = dedupe([from, ...elbow(from, to, isVertical(sideA)), to])
    }
  } else {
    // Un coude par segment. Le sens du premier décrochement dépend de la façon dont on
    // quitte (ou rejoint) l'équipement : après une amorce, on repart perpendiculairement à
    // celle-ci pour contourner la boîte au lieu de la retraverser.
    const built: Point[] = [route[0]]
    for (let i = 0; i < route.length - 1; i += 1) {
      const start = route[i]
      const end = route[i + 1]
      // Segments remarquables : la sortie de l'équipement, le départ depuis l'amorce, et
      // l'arrivée (sur l'amorce d'en face, ou directement sur l'ancre).
      const leavingStubA = stubA !== null && i === 1
      const reachingStubB = stubB !== null && i === route.length - 3
      const reachingAnchorB = stubB === null && i === route.length - 2

      let verticalFirst: boolean
      if (i === 0) verticalFirst = isVertical(sideA)
      else if (leavingStubA) verticalFirst = !isVertical(sideA)
      else if (reachingStubB) verticalFirst = isVertical(sideB)
      else if (reachingAnchorB) verticalFirst = !isVertical(sideB)
      else verticalFirst = i % 2 === 0
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

  return { d, shape, mid: midpointOf(points), points, nodes, waypoints }
}

/**
 * Chemin SVG d'une ligne brisée déjà calculée, ponts de croisement compris.
 *
 * Les croisements sont connus du plan de travail, pas de la liaison : le tracé est donc
 * reconstruit ici quand il y a des ponts à poser.
 */
export function pathFrom(points: Point[], shape: LinkShape, hops: PathHop[] = []): string {
  if (points.length < 2) return ''
  if (shape === 'curved') return smoothPath(points)
  if (shape === 'straight') return roundedPath(points, 0, hops)
  return roundedPath(points, CORNER, hops)
}

/**
 * Point situé à une certaine distance d'une extrémité, en suivant le tracé, avec la
 * direction locale. Sert à poser une étiquette de port juste à la sortie de l'équipement.
 */
export function pointAlong(
  points: Point[],
  distance: number,
  fromEnd = false,
  /** Part maximale du tracé que l'on peut parcourir : 0,4 laisse la place aux deux bouts. */
  limit = 0.4,
): { x: number; y: number; dx: number; dy: number } {
  const path = fromEnd ? [...points].reverse() : points
  // Un tracé dégénéré (deux équipements au même endroit, le temps d'un placement) n'a pas
  // de direction : on renvoie son unique point plutôt que de lire au-delà du tableau.
  if (path.length === 0) return { x: 0, y: 0, dx: 1, dy: 0 }
  if (path.length === 1) return { x: path[0].x, y: path[0].y, dx: 1, dy: 0 }
  const { total } = lengthsOf(path)
  // Sur une liaison courte, les deux étiquettes se rejoindraient : on les rapproche.
  let remaining = Math.min(distance, Math.max(total * limit, 1))

  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]
    const b = path[i + 1]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length === 0) continue
    if (remaining <= length) {
      const ratio = remaining / length
      return {
        x: a.x + (b.x - a.x) * ratio,
        y: a.y + (b.y - a.y) * ratio,
        dx: (b.x - a.x) / length,
        dy: (b.y - a.y) / length,
      }
    }
    remaining -= length
  }

  const a = path[path.length - 2]
  const b = path[path.length - 1]
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: b.x, y: b.y, dx: (b.x - a.x) / length, dy: (b.y - a.y) / length }
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
