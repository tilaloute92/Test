import type { Point } from './routing'

/**
 * Croisements de liaisons.
 *
 * Sur un schéma dense, deux traits qui se coupent sans rien indiquer se lisent comme un
 * raccordement : on croit voir une patte là où il n'y a qu'un croisement. La convention des
 * schémas électriques règle la question depuis toujours — celui du dessus enjambe l'autre
 * par un petit pont. Reste à trouver où sont ces croisements.
 */

export interface Crossing {
  /** Index du segment de la ligne brisée sur lequel tombe le croisement. */
  segment: number
  /** Position sur ce segment, de 0 (début) à 1 (fin). */
  t: number
  x: number
  y: number
}

/** Distance en deçà de laquelle un croisement est en fait un raccordement sur l'équipement. */
const ENDPOINT_MARGIN = 14

function intersection(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): { t: number; u: number; x: number; y: number } | null {
  const ax = a2.x - a1.x
  const ay = a2.y - a1.y
  const bx = b2.x - b1.x
  const by = b2.y - b1.y
  const denominator = ax * by - ay * bx
  // Segments parallèles (ou confondus) : pas de croisement franc à signaler.
  if (Math.abs(denominator) < 1e-6) return null

  const t = ((b1.x - a1.x) * by - (b1.y - a1.y) * bx) / denominator
  const u = ((b1.x - a1.x) * ay - (b1.y - a1.y) * ax) / denominator
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null
  return { t, u, x: a1.x + ax * t, y: a1.y + ay * t }
}

function nearEnds(points: Point[], x: number, y: number): boolean {
  const first = points[0]
  const last = points[points.length - 1]
  return (
    Math.hypot(x - first.x, y - first.y) < ENDPOINT_MARGIN ||
    Math.hypot(x - last.x, y - last.y) < ENDPOINT_MARGIN
  )
}

export interface CrossingInput {
  id: string
  points: Point[]
  /** Liaisons partageant un équipement : leurs abords se touchent sans se croiser. */
  ends: [string, string]
  /** Faux pour une forme courbe, dont la ligne brisée ne décrit pas le tracé réel. */
  hoppable: boolean
}

/**
 * Croisements à enjamber, liaison par liaison.
 *
 * Le pont revient toujours à la liaison dessinée en dernier — celle qui passe visuellement
 * au-dessus — pour que le dessin dise la même chose que l'ordre d'empilement.
 */
export function linkCrossings(links: CrossingInput[]): Map<string, Crossing[]> {
  const result = new Map<string, Crossing[]>()

  for (let j = 1; j < links.length; j += 1) {
    const over = links[j]
    if (!over.hoppable) continue

    for (let i = 0; i < j; i += 1) {
      const under = links[i]
      // Deux liaisons branchées sur le même équipement se rejoignent : ce n'est pas un
      // croisement, et une amorce commune en produirait un faux à chaque fois.
      const shared = over.ends.some((end) => under.ends.includes(end))

      for (let s = 0; s < over.points.length - 1; s += 1) {
        for (let k = 0; k < under.points.length - 1; k += 1) {
          const hit = intersection(over.points[s], over.points[s + 1], under.points[k], under.points[k + 1])
          if (!hit) continue
          if (shared && (nearEnds(over.points, hit.x, hit.y) || nearEnds(under.points, hit.x, hit.y))) continue
          const list = result.get(over.id)
          const crossing: Crossing = { segment: s, t: hit.t, x: hit.x, y: hit.y }
          if (list) list.push(crossing)
          else result.set(over.id, [crossing])
        }
      }
    }
  }

  // Les ponts sont posés en parcourant le tracé : ils doivent être dans l'ordre.
  for (const list of result.values()) {
    list.sort((a, b) => a.segment - b.segment || a.t - b.t)
  }
  return result
}

/**
 * Superpositions : deux liaisons qui partagent un bout de trajet, alignées et confondues.
 *
 * C'est le défaut de lisibilité le plus trompeur — là où le croisement se voit, la
 * superposition se cache : deux câbles n'en montrent qu'un. Les compter donne une mesure
 * objective de ce que la répartition des accroches a corrigé.
 */
const OVERLAP_TOLERANCE = 2.5
const OVERLAP_MIN_LENGTH = 14

function overlapLength(a1: Point, a2: Point, b1: Point, b2: Point): number {
  const horizontalA = Math.abs(a1.y - a2.y) < 0.5
  const verticalA = Math.abs(a1.x - a2.x) < 0.5
  const horizontalB = Math.abs(b1.y - b2.y) < 0.5
  const verticalB = Math.abs(b1.x - b2.x) < 0.5

  if (horizontalA && horizontalB && Math.abs(a1.y - b1.y) < OVERLAP_TOLERANCE) {
    const start = Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x))
    const end = Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x))
    return end - start
  }
  if (verticalA && verticalB && Math.abs(a1.x - b1.x) < OVERLAP_TOLERANCE) {
    const start = Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y))
    const end = Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y))
    return end - start
  }
  return 0
}

/** Couples de liaisons dont les tracés se confondent sur une longueur visible. */
export function overlappingPairs(links: { id: string; points: Point[] }[]): [string, string][] {
  const pairs: [string, string][] = []
  for (let i = 0; i < links.length; i += 1) {
    for (let j = i + 1; j < links.length; j += 1) {
      let found = false
      for (let s = 0; s < links[i].points.length - 1 && !found; s += 1) {
        for (let k = 0; k < links[j].points.length - 1 && !found; k += 1) {
          const length = overlapLength(
            links[i].points[s],
            links[i].points[s + 1],
            links[j].points[k],
            links[j].points[k + 1],
          )
          if (length > OVERLAP_MIN_LENGTH) found = true
        }
      }
      if (found) pairs.push([links[i].id, links[j].id])
    }
  }
  return pairs
}

/** Nombre total de croisements du schéma. */
export function crossingCount(crossings: Map<string, Crossing[]>): number {
  let total = 0
  for (const list of crossings.values()) total += list.length
  return total
}
