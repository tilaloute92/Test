import { NODE_H, NODE_W, type LinkStyle, type NetNode } from '../types'

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

function midpointOf(points: Point[]): Point {
  const lengths: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    lengths.push(len)
    total += len
  }
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

export interface LinkGeometry {
  d: string
  mid: Point
  points: Point[]
}

/**
 * Trace une liaison entre deux équipements. `offset` décale les liaisons parallèles
 * (plusieurs câbles entre les deux mêmes équipements) pour qu'elles ne se superposent pas.
 */
export function linkGeometry(a: NetNode, b: NetNode, style: LinkStyle, offset = 0): LinkGeometry {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const vertical = Math.abs(dy) / NODE_H >= Math.abs(dx) / NODE_W

  let points: Point[]
  if (vertical) {
    const shift = clamp(offset, NODE_W / 2 - 16)
    const dir = dy >= 0 ? 1 : -1
    const from: Point = { x: a.x + shift, y: a.y + (dir * NODE_H) / 2 }
    const to: Point = { x: b.x + shift, y: b.y - (dir * NODE_H) / 2 }
    if (style === 'straight' || Math.abs(from.x - to.x) < 1) {
      points = [from, to]
    } else {
      const mid = (from.y + to.y) / 2 + offset / 2
      points = [from, { x: from.x, y: mid }, { x: to.x, y: mid }, to]
    }
  } else {
    const shift = clamp(offset, NODE_H / 2 - 12)
    const dir = dx >= 0 ? 1 : -1
    const from: Point = { x: a.x + (dir * NODE_W) / 2, y: a.y + shift }
    const to: Point = { x: b.x - (dir * NODE_W) / 2, y: b.y + shift }
    if (style === 'straight' || Math.abs(from.y - to.y) < 1) {
      points = [from, to]
    } else {
      const mid = (from.x + to.x) / 2 + offset / 2
      points = [from, { x: mid, y: from.y }, { x: mid, y: to.y }, to]
    }
  }

  return {
    d: style === 'straight' ? `M ${points[0].x} ${points[0].y} L ${points[points.length - 1].x} ${points[points.length - 1].y}` : roundedPath(points),
    mid: midpointOf(points),
    points,
  }
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value))
}

/**
 * Décalage à appliquer à chaque liaison d'un même couple d'équipements, pour les étaler
 * symétriquement de part et d'autre de l'axe.
 */
export function parallelOffsets(count: number, spacing = 16): number[] {
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * spacing)
}
