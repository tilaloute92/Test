import { pointInPolygon } from './geometry';
import type { Footprint } from './footprints';

/**
 * Calcul d'un tracé (passage de câble, cheminement) entre deux points d'un bâtiment.
 *
 * Sur un étage : le plan est découpé en grille ; les murs, allèges et vitrages bloquent, les
 * ouvertures (portes) laissent passer. Le chemin le plus court est cherché (Dijkstra, 8
 * directions, sans couper les angles de murs), puis lissé en segments droits.
 * L'extérieur du bâtiment reste franchissable mais coûte cher : un tracé ne sort que s'il
 * n'a pas d'autre choix.
 *
 * Entre étages : on ne change d'étage que par un « passage » (gaine technique, colonne
 * montante, escalier…). Deux passages de même nom sur deux étages sont reliés, pour une
 * longueur égale à la différence de hauteur. Le meilleur enchaînement est choisi sur un
 * petit graphe : départ → passage → … → arrivée.
 */

export interface FloorInput {
  planId: string;
  name: string;
  /** Altitude du sol de l'étage, en mètres. */
  elevation: number;
  footprint: Footprint;
  /** Passages verticaux de l'étage, en mètres dans le repère de l'étage. */
  passages: { key: string; label: string; x: number; y: number }[];
  /** Emprise du dessin en mètres, pour dimensionner la grille. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /**
   * Tous les traits du plan (x1, y1, x2, y2 en mètres), murs ou non : là où rien n'est
   * dessiné sur une grande surface fermée (patio, cour intérieure, trémie), on ne passe pas.
   */
  ink?: Float32Array;
}

export interface Endpoint { planId: string; x: number; y: number }

export interface RouteOptions {
  /** Autoriser la traversée des murs (carottage), avec une forte pénalité. */
  allowWalls: boolean;
}

export interface Leg {
  planId: string;
  /** Points du tracé, en mètres dans le repère de l'étage. */
  points: [number, number][];
  length: number;
  wallCrossings: number;
  outside: boolean;
  /** Passe par une zone vide (patio, cour) faute d'autre chemin. */
  throughVoid: boolean;
  from: string;
  to: string;
}
export interface Rise { key: string; label: string; fromPlan: string; toPlan: string; length: number }
export type Step = { type: 'leg'; leg: Leg } | { type: 'rise'; rise: Rise };

export interface RouteResult {
  steps: Step[];
  horizontal: number;
  vertical: number;
  total: number;
  wallsForced: boolean;
  warnings: string[];
}

export class RouteError extends Error {}

/* ---------------------------------------------------------------------------------------
 * Grille d'un étage
 * ------------------------------------------------------------------------------------- */
const MAX_CELLS = 400_000;
const MIN_CELL = 0.15;
const MARGIN = 3;
const OUTSIDE_COST = 8;
const WALL_COST = 40;
/** Zone vide (patio, cour) : évitée sauf s'il n'y a vraiment pas d'autre chemin. */
const VOID_COST = 30;
const VOID_TILE = 1.5;
const VOID_MIN_AREA = 40;
/** Une ouverture plus étroite que ceci (porte, fenêtre) arrête l'extension d'une zone vide. */
const GAP_MAX = 3;

const FREE = 0, WALL = 1;

export class FloorGrid {
  readonly x0: number; readonly y0: number; readonly cell: number; readonly w: number; readonly h: number;
  /** 0 libre, 1 mur. */
  readonly kind: Uint8Array;
  /** 1 = hors du bâtiment (atteint depuis le bord sans franchir de mur). */
  readonly outside: Uint8Array;
  /** 1 = zone vide fermée (patio, cour intérieure) : rien n'y est dessiné. */
  readonly voids: Uint8Array;

  constructor(floor: FloorInput) {
    const b = floor.bounds;
    const width = b.maxX - b.minX + 2 * MARGIN, height = b.maxY - b.minY + 2 * MARGIN;
    this.cell = Math.max(MIN_CELL, Math.sqrt((width * height) / MAX_CELLS));
    this.x0 = b.minX - MARGIN;
    this.y0 = b.minY - MARGIN;
    this.w = Math.max(2, Math.ceil(width / this.cell));
    this.h = Math.max(2, Math.ceil(height / this.cell));
    this.kind = new Uint8Array(this.w * this.h);
    this.rasterize(floor.footprint);
    this.outside = this.findOutside();
    this.voids = floor.ink ? this.findVoids(floor.ink) : new Uint8Array(this.w * this.h);
  }

  /**
   * Zones vides : grandes surfaces (40 m² au moins) où le plan ne dessine rien, à l'intérieur
   * du bâtiment. Leurs cœurs sont trouvés sur des carreaux de 1,5 m sans aucun trait, puis
   * étendus jusqu'aux murs qui les bordent, sans franchir les ouvertures étroites (portes,
   * fenêtres de façade) : les pièces voisines ne sont pas touchées.
   */
  private findVoids(ink: Float32Array): Uint8Array {
    const { w, h, cell } = this;
    const out = new Uint8Array(w * h);
    const tw = Math.ceil((w * cell) / VOID_TILE), th = Math.ceil((h * cell) / VOID_TILE);
    const inked = new Uint8Array(tw * th);
    const mark = (x: number, y: number) => {
      const ti = Math.floor((x - this.x0) / VOID_TILE), tj = Math.floor((y - this.y0) / VOID_TILE);
      if (ti >= 0 && tj >= 0 && ti < tw && tj < th) inked[tj * tw + ti] = 1;
    };
    for (let i = 0; i < ink.length; i += 4) {
      const x1 = ink[i], y1 = ink[i + 1], x2 = ink[i + 2], y2 = ink[i + 3];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (VOID_TILE / 2)));
      for (let k = 0; k <= n; k++) mark(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n);
    }
    // Cœurs : carreaux vides voisins. L'extérieur est vide lui aussi, mais il s'étend jusqu'au
    // bord du dessin (cadre de la feuille compris) ; un patio est enclos par le bâtiment.
    // (Le calcul d'« extérieur » de la grille n'est pas utilisé ici : sur un plan dont les
    // façades ont de larges ouvertures, il déborde dans le bâtiment et jusque dans les patios.)
    const edge = Math.ceil((MARGIN + VOID_TILE) / VOID_TILE);
    const tileOutside = (t: number) => {
      const ti = t % tw, tj = (t - ti) / tw;
      return ti < edge || tj < edge || ti >= tw - edge || tj >= th - edge;
    };
    const seen = new Uint8Array(tw * th);
    const core = new Uint8Array(tw * th);
    const seeds: number[] = [];
    for (let t0 = 0; t0 < tw * th; t0++) {
      if (seen[t0] || inked[t0] || tileOutside(t0)) continue;
      const comp = [t0];
      seen[t0] = 1;
      for (let q = 0; q < comp.length; q++) {
        const t = comp[q], ti = t % tw, tj = (t - ti) / tw;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ti + di, nj = tj + dj;
          if (ni < 0 || nj < 0 || ni >= tw || nj >= th) continue;
          const nt = nj * tw + ni;
          if (!seen[nt] && !inked[nt] && !tileOutside(nt)) { seen[nt] = 1; comp.push(nt); }
        }
      }
      if (comp.length * VOID_TILE * VOID_TILE < VOID_MIN_AREA) continue;
      // Touche le bord du dessin : c'est l'extérieur.
      if (comp.some((t) => { const ti = t % tw, tj = (t - ti) / tw; return ti <= edge || tj <= edge || ti >= tw - edge - 1 || tj >= th - edge - 1; })) continue;
      for (const t of comp) {
        const ti = t % tw, tj = (t - ti) / tw;
        core[t] = 1;
        seeds.push(this.idx(this.x0 + (ti + 0.5) * VOID_TILE, this.y0 + (tj + 0.5) * VOID_TILE));
      }
    }
    if (!seeds.length) return out;
    // Ouvertures étroites : murs à moins de GAP_MAX de part et d'autre, en ligne ou en colonne.
    const lim = Math.ceil(GAP_MAX / cell);
    const narrow = new Uint8Array(w * h);
    const runs = (len: number, at: (n: number) => number) => {
      const before = new Int32Array(len), after = new Int32Array(len);
      let last = -lim * 2;
      for (let n = 0; n < len; n++) { if (this.kind[at(n)] === WALL) last = n; before[n] = n - last; }
      last = len + lim * 2;
      for (let n = len - 1; n >= 0; n--) { if (this.kind[at(n)] === WALL) last = n; after[n] = last - n; }
      for (let n = 0; n < len; n++) if (before[n] + after[n] - 1 <= lim) narrow[at(n)] = 1;
    };
    for (let j = 0; j < h; j++) runs(w, (n) => j * w + n);
    for (let i = 0; i < w; i++) runs(h, (n) => n * w + i);
    // L'extension ne dépasse pas d'un carreau le cœur vide : elle rejoint les murs qui le
    // bordent sans s'engager dans un couloir voisin par une large ouverture.
    const near = (k: number) => {
      const ti = Math.floor(((k % w) * cell) / VOID_TILE), tj = Math.floor((Math.floor(k / w) * cell) / VOID_TILE);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ni = ti + di, nj = tj + dj;
        if (ni >= 0 && nj >= 0 && ni < tw && nj < th && core[nj * tw + ni]) return true;
      }
      return false;
    };
    const queue: number[] = [];
    const push = (k: number) => {
      if (out[k] || this.kind[k] === WALL || narrow[k] || !near(k)) return;
      out[k] = 1;
      queue.push(k);
    };
    for (const k of seeds) push(k);
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q], i = k % w;
      if (i > 0) push(k - 1);
      if (i < w - 1) push(k + 1);
      if (k >= w) push(k - w);
      if (k < w * (h - 1)) push(k + w);
    }
    return out;
  }

  idx(x: number, y: number) {
    const i = Math.min(this.w - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
    const j = Math.min(this.h - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)));
    return j * this.w + i;
  }
  center(k: number): [number, number] {
    return [this.x0 + ((k % this.w) + 0.5) * this.cell, this.y0 + (Math.floor(k / this.w) + 0.5) * this.cell];
  }

  private rasterize(fp: Footprint) {
    const c = this.cell;
    // Un mur plus fin qu'une case est élargi à une case : sinon le tracé passerait au travers.
    const minHalf = c * 0.75;
    for (const b of [...fp.walls, ...fp.glass]) {
      if (b.y0 > 0.5) continue; // linteau : en hauteur, ne bloque pas le passage
      const hu = b.len / 2 + c * 0.25, hv = Math.max(b.thick / 2, minHalf);
      const ex = Math.abs(b.ux) * hu + Math.abs(b.uy) * hv, ey = Math.abs(b.uy) * hu + Math.abs(b.ux) * hv;
      this.scan(b.cx - ex, b.cy - ey, b.cx + ex, b.cy + ey, (x, y) => {
        const dx = x - b.cx, dy = y - b.cy;
        return Math.abs(dx * b.ux + dy * b.uy) <= hu && Math.abs(-dx * b.uy + dy * b.ux) <= hv;
      });
    }
    for (const f of fp.fills) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < f.outer.length; i += 2) {
        minX = Math.min(minX, f.outer[i]); maxX = Math.max(maxX, f.outer[i]);
        minY = Math.min(minY, f.outer[i + 1]); maxY = Math.max(maxY, f.outer[i + 1]);
      }
      this.scan(minX, minY, maxX, maxY, (x, y) => pointInPolygon(x, y, f.outer) && !f.holes.some((h) => pointInPolygon(x, y, h)));
    }
  }

  private scan(minX: number, minY: number, maxX: number, maxY: number, inside: (x: number, y: number) => boolean) {
    const i0 = Math.max(0, Math.floor((minX - this.x0) / this.cell)), i1 = Math.min(this.w - 1, Math.floor((maxX - this.x0) / this.cell));
    const j0 = Math.max(0, Math.floor((minY - this.y0) / this.cell)), j1 = Math.min(this.h - 1, Math.floor((maxY - this.y0) / this.cell));
    for (let j = j0; j <= j1; j++) {
      const y = this.y0 + (j + 0.5) * this.cell;
      for (let i = i0; i <= i1; i++) {
        if (inside(this.x0 + (i + 0.5) * this.cell, y)) this.kind[j * this.w + i] = WALL;
      }
    }
  }

  /**
   * Extérieur : ce qu'on atteint depuis le bord de la grille sans traverser de mur, une fois
   * les ouvertures de moins de 1,2 m refermées (sinon la porte d'entrée ferait passer
   * l'intérieur pour l'extérieur).
   */
  private findOutside() {
    const { w, h } = this;
    const r = Math.max(1, Math.round(0.6 / this.cell));
    // Dilatation séparable des murs (carré de côté 2r+1).
    const tmp = new Uint8Array(w * h), closed = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      let last = -Infinity;
      for (let i = 0; i < w; i++) { if (this.kind[j * w + i] === WALL) last = i; if (i - last <= r) tmp[j * w + i] = 1; }
      last = Infinity;
      for (let i = w - 1; i >= 0; i--) { if (this.kind[j * w + i] === WALL) last = i; if (last - i <= r) tmp[j * w + i] = 1; }
    }
    for (let i = 0; i < w; i++) {
      let last = -Infinity;
      for (let j = 0; j < h; j++) { if (tmp[j * w + i]) last = j; if (j - last <= r) closed[j * w + i] = 1; }
      last = Infinity;
      for (let j = h - 1; j >= 0; j--) { if (tmp[j * w + i]) last = j; if (last - j <= r) closed[j * w + i] = 1; }
    }
    const out = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    const push = (k: number) => { if (!out[k] && !closed[k]) { out[k] = 1; queue[tail++] = k; } };
    for (let i = 0; i < w; i++) { push(i); push((h - 1) * w + i); }
    for (let j = 0; j < h; j++) { push(j * w); push(j * w + w - 1); }
    while (head < tail) {
      const k = queue[head++], i = k % w, j = (k - i) / w;
      if (i > 0) push(k - 1);
      if (i < w - 1) push(k + 1);
      if (j > 0) push(k - w);
      if (j < h - 1) push(k + w);
    }
    // Rattrape la bande dilatée le long des façades extérieures.
    for (let pass = 0; pass < r; pass++) {
      const add: number[] = [];
      for (let k = 0; k < w * h; k++) {
        if (out[k] || this.kind[k] === WALL) continue;
        const i = k % w;
        if ((i > 0 && out[k - 1]) || (i < w - 1 && out[k + 1]) || (k >= w && out[k - w]) || (k < w * (h - 1) && out[k + w])) add.push(k);
      }
      for (const k of add) out[k] = 1;
    }
    return out;
  }

  /** Case libre la plus proche (un équipement est souvent dessiné contre ou dans un mur). */
  snap(k: number): number {
    if (this.kind[k] === FREE) return k;
    const { w, h } = this;
    const maxR = Math.ceil(3 / this.cell);
    const i0 = k % w, j0 = (k - i0) / w;
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const kk = j * w + i;
        if (this.kind[kk] === FREE && di * di + dj * dj < bestD) { best = kk; bestD = di * di + dj * dj; }
      }
      if (best >= 0) return best;
    }
    return k;
  }
}

/* ---------------------------------------------------------------------------------------
 * Plus court chemin sur la grille
 * ------------------------------------------------------------------------------------- */
class Heap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() { return this.items.length; }
  push(item: number, p: number) {
    const a = this.items, q = this.prio;
    let n = a.length;
    a.push(item); q.push(p);
    while (n > 0) {
      const parent = (n - 1) >> 1;
      if (q[parent] <= p) break;
      a[n] = a[parent]; q[n] = q[parent]; n = parent;
    }
    a[n] = item; q[n] = p;
  }
  pop(): [number, number] {
    const a = this.items, q = this.prio;
    const top: [number, number] = [a[0], q[0]];
    const item = a.pop()!, p = q.pop()!;
    if (a.length) {
      let n = 0;
      const len = a.length;
      for (;;) {
        let c = 2 * n + 1;
        if (c >= len) break;
        if (c + 1 < len && q[c + 1] < q[c]) c++;
        if (q[c] >= p) break;
        a[n] = a[c]; q[n] = q[c]; n = c;
      }
      a[n] = item; q[n] = p;
    }
    return top;
  }
}

interface Search { dist: Float64Array; prev: Int32Array }

/** Dijkstra depuis une case ; s'arrête quand toutes les cibles sont atteintes. */
function dijkstra(g: FloorGrid, start: number, targets: number[], allowWalls: boolean): Search {
  const n = g.w * g.h, w = g.w;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const pending = new Set(targets);
  const heap = new Heap();
  dist[start] = 0;
  heap.push(start, 0);
  const cost = (k: number) => (g.kind[k] === WALL ? (allowWalls ? WALL_COST : Infinity) : g.voids[k] ? VOID_COST : g.outside[k] ? OUTSIDE_COST : 1);
  const D = Math.SQRT2;
  while (heap.size) {
    const [k, d] = heap.pop();
    if (done[k]) continue;
    done[k] = 1;
    pending.delete(k);
    if (!pending.size && targets.length) break;
    const i = k % w, j = (k - i) / w;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= g.h) continue;
      const nk = nj * w + ni;
      if (done[nk]) continue;
      const c = cost(nk);
      if (c === Infinity) continue;
      // Diagonale : pas de coin de mur coupé.
      if (di && dj && (g.kind[j * w + ni] === WALL || g.kind[nj * w + i] === WALL)) continue;
      const nd = d + c * (di && dj ? D : 1) * g.cell;
      if (nd < dist[nk]) { dist[nk] = nd; prev[nk] = k; heap.push(nk, nd); }
    }
  }
  return { dist, prev };
}

/** Une case n'est traversée en ligne droite que si elle est libre et du même côté (dedans/dehors, hors zone vide). */
function lineFree(g: FloorGrid, a: number, b: number, outside: number, voids: number): boolean {
  const w = g.w;
  let x0 = a % w, y0 = (a - x0) / w;
  const x1 = b % w, y1 = (b - x1) / w;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    const k = y0 * w + x0;
    if (g.kind[k] === WALL || g.outside[k] !== outside || g.voids[k] !== voids) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    // Pas en diagonale : vérifie aussi les deux cases d'angle (pas de fuite entre deux murs).
    if (e2 > -dy && e2 < dx) {
      if (g.kind[y0 * w + x0 + sx] === WALL || g.kind[(y0 + sy) * w + x0] === WALL) return false;
    }
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

function extractLeg(g: FloorGrid, s: Search, from: number, to: number): { points: [number, number][]; length: number; wallCrossings: number; outside: boolean; throughVoid: boolean } {
  const cells: number[] = [];
  for (let k = to; k !== -1; k = s.prev[k]) { cells.push(k); if (k === from) break; }
  cells.reverse();
  let wallCrossings = 0, outside = false, throughVoid = false;
  for (let i = 0; i < cells.length; i++) {
    if (g.kind[cells[i]] === WALL && (i === 0 || g.kind[cells[i - 1]] !== WALL)) wallCrossings++;
    if (g.outside[cells[i]]) outside = true;
    if (g.voids[cells[i]]) throughVoid = true;
  }
  // Lissage : on saute directement au point le plus loin visible en ligne droite.
  const kept = [cells[0]];
  let i = 0;
  while (i < cells.length - 1) {
    let j = i + 1;
    const free = g.kind[cells[i]] !== WALL;
    while (j + 1 < cells.length && free && g.kind[cells[j + 1]] !== WALL && lineFree(g, cells[i], cells[j + 1], g.outside[cells[i]], g.voids[cells[i]])) j++;
    kept.push(cells[j]);
    i = j;
  }
  const points = kept.map((k) => g.center(k));
  let length = 0;
  for (let k = 1; k < points.length; k++) length += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
  return { points, length, wallCrossings, outside, throughVoid };
}

/* ---------------------------------------------------------------------------------------
 * Enchaînement des étages
 * ------------------------------------------------------------------------------------- */
interface Node { id: string; planId: string; cell: number; label: string; key?: string; x: number; y: number }

export async function computeRoute(
  floors: FloorInput[],
  from: Endpoint & { label: string },
  to: Endpoint & { label: string },
  options: RouteOptions,
  onProgress: (text: string) => void = () => {},
): Promise<RouteResult> {
  const byId = new Map(floors.map((f) => [f.planId, f]));
  const fFrom = byId.get(from.planId), fTo = byId.get(to.planId);
  if (!fFrom || !fTo) throw new RouteError("Le plan du départ ou de l'arrivée n'a pas pu être chargé.");

  // Seuls les étages entre départ et arrivée sont parcourus : pas de détour par la cave.
  const lo = Math.min(fFrom.elevation, fTo.elevation) - 0.01, hi = Math.max(fFrom.elevation, fTo.elevation) + 0.01;
  const used = floors.filter((f) => f.elevation >= lo && f.elevation <= hi);
  const keyFloors = new Map<string, Set<string>>();
  for (const f of used) for (const p of f.passages) {
    if (!keyFloors.has(p.key)) keyFloors.set(p.key, new Set());
    keyFloors.get(p.key)!.add(f.planId);
  }

  const grids = new Map<string, FloorGrid>();
  const gridOf = async (f: FloorInput) => {
    let g = grids.get(f.planId);
    if (!g) {
      onProgress(`Analyse des murs — ${f.name}`);
      await new Promise((r) => setTimeout(r, 0));
      g = new FloorGrid(f);
      grids.set(f.planId, g);
    }
    return g;
  };

  const nodesByFloor = new Map<string, Node[]>();
  const S: Node = { id: 'S', planId: from.planId, cell: 0, label: from.label, x: from.x, y: from.y };
  const T: Node = { id: 'T', planId: to.planId, cell: 0, label: to.label, x: to.x, y: to.y };
  for (const f of used) {
    const g = await gridOf(f);
    const list: Node[] = [];
    for (const p of f.passages) {
      if ((keyFloors.get(p.key)?.size ?? 0) < 2) continue;
      list.push({ id: `${f.planId}|${p.key}`, planId: f.planId, cell: g.snap(g.idx(p.x, p.y)), label: p.label, key: p.key, x: p.x, y: p.y });
    }
    nodesByFloor.set(f.planId, list);
  }
  S.cell = (await gridOf(fFrom)).snap((await gridOf(fFrom)).idx(S.x, S.y));
  T.cell = (await gridOf(fTo)).snap((await gridOf(fTo)).idx(T.x, T.y));

  const run = async (allowWalls: boolean) => {
    // Arêtes : distances sur la grille entre nœuds d'un même étage, montées entre étages.
    const edges = new Map<string, { to: string; cost: number }[]>();
    const add = (a: string, b: string, cost: number) => {
      if (!Number.isFinite(cost)) return;
      if (!edges.has(a)) edges.set(a, []);
      if (!edges.has(b)) edges.set(b, []);
      edges.get(a)!.push({ to: b, cost });
      edges.get(b)!.push({ to: a, cost });
    };
    const fromNodes = async (f: FloorInput, origin: Node, targets: Node[]) => {
      if (!targets.length) return;
      onProgress(`Recherche du chemin — ${f.name}`);
      await new Promise((r) => setTimeout(r, 0));
      const g = await gridOf(f);
      const s = dijkstra(g, origin.cell, targets.map((t) => t.cell), allowWalls);
      for (const t of targets) add(origin.id, t.id, s.dist[t.cell]);
    };
    const sameFloor = from.planId === to.planId;
    await fromNodes(fFrom, S, [...(sameFloor ? [T] : []), ...(nodesByFloor.get(fFrom.planId) ?? [])]);
    if (!sameFloor) await fromNodes(fTo, T, nodesByFloor.get(fTo.planId) ?? []);
    for (const f of used) {
      if (f.planId === from.planId || f.planId === to.planId) continue;
      const list = nodesByFloor.get(f.planId) ?? [];
      for (let i = 0; i < list.length; i++) await fromNodes(f, list[i], list.slice(i + 1));
    }
    const all = [...nodesByFloor.values()].flat();
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.key === b.key && a.planId !== b.planId) add(a.id, b.id, Math.abs(byId.get(a.planId)!.elevation - byId.get(b.planId)!.elevation) + 1e-6);
    }
    // Plus court enchaînement sur ce petit graphe.
    const dist = new Map<string, number>([['S', 0]]);
    const prev = new Map<string, string>();
    const open = new Set(['S']);
    while (open.size) {
      let cur = '', best = Infinity;
      for (const id of open) { const d = dist.get(id)!; if (d < best) { best = d; cur = id; } }
      open.delete(cur);
      if (cur === 'T') break;
      for (const e of edges.get(cur) ?? []) {
        const nd = best + e.cost;
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, cur); open.add(e.to); }
      }
    }
    if (!dist.has('T')) return null;
    const seq: string[] = ['T'];
    while (seq[0] !== 'S') seq.unshift(prev.get(seq[0])!);
    return seq;
  };

  let wallsForced = false;
  let seq = await run(options.allowWalls);
  if (!seq && !options.allowWalls) {
    seq = await run(true);
    wallsForced = !!seq;
  }
  if (!seq) {
    if (from.planId !== to.planId) {
      throw new RouteError("Aucun passage entre étages ne relie le départ à l'arrivée. Marquez les gaines techniques, colonnes montantes ou escaliers comme « passage entre étages », avec le même nom sur chaque plan.");
    }
    throw new RouteError("Aucun chemin trouvé entre ces deux points sur ce plan.");
  }

  // Reconstruction des tronçons.
  const nodeOf = (id: string): Node => (id === 'S' ? S : id === 'T' ? T : [...nodesByFloor.values()].flat().find((n) => n.id === id)!);
  const allowWalls = options.allowWalls || wallsForced;
  const steps: Step[] = [];
  let horizontal = 0, vertical = 0;
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = nodeOf(seq[i]), b = nodeOf(seq[i + 1]);
    if (a.planId === b.planId) {
      const f = byId.get(a.planId)!, g = await gridOf(f);
      onProgress(`Tracé — ${f.name}`);
      const s = dijkstra(g, a.cell, [b.cell], allowWalls);
      const leg = extractLeg(g, s, a.cell, b.cell);
      // Raccorde le tracé aux positions exactes des équipements (hors grille).
      leg.points[0] = [a.x, a.y];
      leg.points[leg.points.length - 1] = [b.x, b.y];
      leg.length = leg.points.reduce((n, p, k) => (k ? n + Math.hypot(p[0] - leg.points[k - 1][0], p[1] - leg.points[k - 1][1]) : 0), 0);
      horizontal += leg.length;
      steps.push({ type: 'leg', leg: { planId: a.planId, ...leg, from: a.label, to: b.label } });
    } else {
      const length = Math.abs(byId.get(a.planId)!.elevation - byId.get(b.planId)!.elevation);
      vertical += length;
      steps.push({ type: 'rise', rise: { key: a.key!, label: a.label, fromPlan: a.planId, toPlan: b.planId, length } });
    }
  }
  const warnings: string[] = [];
  if (wallsForced) warnings.push("Aucun chemin par les ouvertures : le tracé traverse des murs (carottage à prévoir). Vérifiez que les portes sont bien des ouvertures dans les murs du plan.");
  if (steps.some((s) => s.type === 'leg' && s.leg.outside)) warnings.push("Le tracé passe par l'extérieur du bâtiment sur une partie du parcours.");
  if (steps.some((s) => s.type === 'leg' && s.leg.throughVoid)) warnings.push("Aucun autre chemin : le tracé traverse une zone vide du plan (patio, cour intérieure, trémie). Vérifiez qu'elle est réellement praticable.");
  return { steps, horizontal, vertical, total: horizontal + vertical, wallsForced, warnings };
}
