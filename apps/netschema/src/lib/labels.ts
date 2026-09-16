import type { Point } from './routing'

/**
 * Placement des étiquettes de liaison.
 *
 * Une étiquette qui en recouvre une autre ne dit plus rien : c'est le même défaut que deux
 * câbles superposés, en plus sournois, parce qu'on croit lire une valeur qui appartient à la
 * liaison d'à côté. Chaque étiquette est donc posée à un endroit libre — près de son point
 * d'ancrage, jamais sur une boîte ni sur une autre étiquette.
 *
 * Une étiquette déplacée à la main n'est jamais recalculée : elle est posée en premier, et
 * les autres s'arrangent autour.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface LabelCandidate {
  /** Identifiant stable : « <liaison>:mid », « <liaison>:a », « <liaison>:b ». */
  id: string
  /** Point du tracé auquel l'étiquette se rattache. */
  anchor: Point
  /** Direction du tracé à cet endroit : l'étiquette s'écarte perpendiculairement. */
  dir: { dx: number; dy: number }
  width: number
  height: number
  /** Décalage souhaité par défaut (celui du rendu automatique). */
  base: { dx: number; dy: number }
  /** Décalage imposé par l'utilisateur : l'étiquette ne bouge plus. */
  manual?: { dx: number; dy: number }
  /** Ordre de priorité : plus petit = placé en premier, donc au plus près de son ancre. */
  priority: number
}

export interface Placement {
  x: number
  y: number
  /** Vrai si l'étiquette a dû être écartée de sa position naturelle. */
  moved: boolean
}

const MARGIN = 2

function overlaps(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width + MARGIN * 2 &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height + MARGIN * 2
  )
}

/**
 * Décalages essayés successivement, en multiples du pas : d'abord de part et d'autre du
 * trait (perpendiculairement), puis en glissant le long du trait, ce qui garde l'étiquette
 * lisible comme appartenant à sa liaison. On s'éloigne par anneaux successifs, pour prendre
 * toujours la place libre la plus proche.
 */
const TRIES: { across: number; along: number }[] = [{ across: 0, along: 0 }]
for (let ring = 1; ring <= 6; ring += 1) {
  TRIES.push(
    { across: ring, along: 0 },
    { across: -ring, along: 0 },
    { across: 0, along: ring },
    { across: 0, along: -ring },
    { across: ring, along: ring },
    { across: -ring, along: -ring },
    { across: ring, along: -ring },
    { across: -ring, along: ring },
  )
}

/** Surface de recouvrement entre deux rectangles : sert à départager les cas sans place. */
function overlapArea(a: Rect, b: Rect): number {
  const dx = (a.width + b.width) / 2 - Math.abs(a.x - b.x)
  const dy = (a.height + b.height) / 2 - Math.abs(a.y - b.y)
  return dx > 0 && dy > 0 ? dx * dy : 0
}

export function placeLabels(
  candidates: LabelCandidate[],
  obstacles: Rect[],
  step = 15,
): Map<string, Placement> {
  const placed: Rect[] = [...obstacles]
  const result = new Map<string, Placement>()

  // Les étiquettes déplacées à la main occupent leur place avant toutes les autres.
  const ordered = [...candidates].sort(
    (a, b) =>
      Number(b.manual !== undefined) - Number(a.manual !== undefined) ||
      a.priority - b.priority ||
      a.anchor.y - b.anchor.y ||
      a.anchor.x - b.anchor.x ||
      a.id.localeCompare(b.id),
  )

  for (const candidate of ordered) {
    if (candidate.manual) {
      const x = candidate.anchor.x + candidate.manual.dx
      const y = candidate.anchor.y + candidate.manual.dy
      placed.push({ x, y, width: candidate.width, height: candidate.height })
      result.set(candidate.id, { x, y, moved: false })
      continue
    }

    // Repère local du trait : « le long » suit la liaison, « en travers » lui est perpendiculaire.
    const length = Math.hypot(candidate.dir.dx, candidate.dir.dy) || 1
    const ux = candidate.dir.dx / length
    const uy = candidate.dir.dy / length

    let chosen: Placement | null = null
    // À défaut de place entièrement libre, on retient le moindre mal : la position qui
    // recouvre le moins. Une étiquette un peu à l'étroit vaut mieux qu'une pile illisible.
    let best: { placement: Placement; score: number } | null = null
    for (const attempt of TRIES) {
      const x = candidate.anchor.x + candidate.base.dx + (-uy * attempt.across + ux * attempt.along) * step
      const y = candidate.anchor.y + candidate.base.dy + (ux * attempt.across + uy * attempt.along) * step
      const rect = { x, y, width: candidate.width, height: candidate.height }
      const moved = attempt.across !== 0 || attempt.along !== 0
      if (!placed.some((other) => overlaps(rect, other))) {
        chosen = { x, y, moved }
        break
      }
      // Un peu de préférence pour rester près de l'ancre, à recouvrement égal.
      const score =
        placed.reduce((total, other) => total + overlapArea(rect, other), 0) +
        (Math.abs(attempt.across) + Math.abs(attempt.along)) * 4
      if (!best || score < best.score) best = { placement: { x, y, moved }, score }
    }

    const spot = chosen ?? best?.placement ?? {
      x: candidate.anchor.x + candidate.base.dx,
      y: candidate.anchor.y + candidate.base.dy,
      moved: false,
    }
    placed.push({ x: spot.x, y: spot.y, width: candidate.width, height: candidate.height })
    result.set(candidate.id, spot)
  }

  return result
}

/** Taille d'une étiquette, pour le placement comme pour le rendu. */
export function labelSize(lines: string[], size: number): { width: number; height: number } {
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const lineHeight = size + 2.5
  return { width: longest * size * 0.62 + 10, height: lines.length * lineHeight + 4 }
}
