import { clusterSegments, minAreaRect, pairWalls } from './geometry';
import { roleOf } from './drawing';
import type { Fill, Group, PlanSettings } from './types';

/** Pavé orienté, en mètres : centre, direction, longueur, épaisseur, hauteurs bas et haut. */
export interface Box2 { cx: number; cy: number; ux: number; uy: number; len: number; thick: number; y0: number; y1: number }

export interface Footprint {
  /** Murs, allèges et linteaux : ce qui est maçonné. */
  walls: Box2[];
  /** Vitrages des fenêtres. */
  glass: Box2[];
  /** Murs pleins (aplats PDF, SOLID DXF), en mètres, trous compris. */
  fills: Fill[];
  wallCount: number;
  windowCount: number;
}

export function toMeters(segs: ArrayLike<number>, f: number, cx: number, cy: number) {
  const out = new Float64Array(segs.length);
  for (let i = 0; i < segs.length; i += 2) { out[i] = (segs[i] - cx) * f; out[i + 1] = (segs[i + 1] - cy) * f; }
  return out;
}
const fillToMeters = (fill: Fill, f: number, cx: number, cy: number): Fill => ({
  outer: Array.from(toMeters(fill.outer, f, cx, cy)),
  holes: fill.holes.map((h) => Array.from(toMeters(h, f, cx, cy))),
});

/**
 * Emprise des murs et fenêtres d'un étage, en mètres. Source unique pour la maquette 3D
 * (viewer.ts) et pour le calcul des tracés (route.ts) : un tracé contourne exactement les
 * murs que l'on voit.
 */
export function floorFootprint(groups: Group[], P: PlanSettings, f: number, center: [number, number]): Footprint {
  const [cx, cy] = center;
  const walls: Box2[] = [], glass: Box2[] = [], fills: Fill[] = [];
  let wallCount = 0, windowCount = 0;

  const wallLines: number[] = [];
  for (const g of groups) {
    if (roleOf(g, P) !== 'mur') continue;
    if (g.kind === 'fill') for (const fill of g.fills) { fills.push(fillToMeters(fill, f, cx, cy)); wallCount++; }
    else for (const v of g.segs) wallLines.push(v);
  }
  if (wallLines.length) {
    const { boxes, leftovers } = pairWalls(toMeters(wallLines, f, cx, cy), 0.03, P.tMax);
    for (const b of boxes) walls.push({ cx: b.x, cy: b.y, ux: b.ux, uy: b.uy, len: b.len, thick: b.thick, y0: 0, y1: P.hWall });
    // Dans un plan en double trait, les petits restes (retours, angles) sont déjà couverts par les murs voisins.
    const minLeft = boxes.length ? P.tMax : 0.02;
    for (const l of leftovers) {
      if (l.len <= minLeft) continue;
      walls.push({ cx: l.x, cy: l.y, ux: l.ux, uy: l.uy, len: l.len + (boxes.length ? 0 : P.tWall), thick: P.tWall, y0: 0, y1: P.hWall });
      wallCount++;
    }
    wallCount += boxes.length;
  }

  for (const g of groups) {
    if (roleOf(g, P) !== 'fenetre') continue;
    for (const cl of clusterSegments(toMeters(g.segs, f, cx, cy), 0.08)) {
      const r = minAreaRect(cl);
      if (!r || r.L < 0.25) continue;
      const W = r.W < 0.04 ? P.tWall : r.W;
      const top = Math.min(P.sill + P.hWin, P.hWall);
      const base = { cx: r.cx, cy: r.cy, ux: r.ux, uy: r.uy, len: r.L, thick: W };
      if (P.sill > 0) walls.push({ ...base, y0: 0, y1: Math.min(P.sill, P.hWall) });
      if (P.hWall > top) walls.push({ ...base, y0: top, y1: P.hWall });
      if (top > P.sill) glass.push({ ...base, thick: Math.min(0.03, W), y0: P.sill, y1: top });
      windowCount++;
    }
  }
  return { walls, glass, fills, wallCount, windowCount };
}
