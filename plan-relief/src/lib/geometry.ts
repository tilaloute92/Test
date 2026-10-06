/** Outils de géométrie 2D partagés par la lecture des plans et la construction 3D. */

// Matrice affine [a,b,c,d,e,f] : x' = a x + c y + e ; y' = b x + d y + f
export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: ArrayLike<number>): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function arcPoints(cx: number, cy: number, r: number, a0: number, sweep: number): number[] {
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
  const pts: number[] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + sweep * k / n;
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return pts;
}

export function bulgePoints(x1: number, y1: number, x2: number, y2: number, b: number): number[] {
  const dx = x2 - x1, dy = y2 - y1, c = Math.hypot(dx, dy);
  if (Math.abs(b) < 1e-9 || c < 1e-12) return [x1, y1, x2, y2];
  const theta = 4 * Math.atan(b);
  const r = c / (2 * Math.sin(theta / 2));
  const h = r * Math.cos(theta / 2);
  const cx = (x1 + x2) / 2 - h * dy / c, cy = (y1 + y2) / 2 + h * dx / c;
  return arcPoints(cx, cy, Math.abs(r), Math.atan2(y1 - cy, x1 - cx), theta);
}

export function polygonArea(p: number[]): number {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return a / 2;
}

export function pointInPolygon(x: number, y: number, p: number[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function segBounds(lists: ArrayLike<number>[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of lists) {
    for (let i = 0; i < s.length; i += 2) {
      const x = s[i], y = s[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/** Longueur cumulée des traits parallèles voisins, en nombre de fois la longueur du trait. */
const STACK_DENSITY = 2.5;

export interface WallBox { x: number; y: number; ux: number; uy: number; len: number; thick: number }
export interface Leftover { len: number; x: number; y: number; ux: number; uy: number }

/**
 * Associe les faces parallèles d'un mur dessiné en double trait et renvoie les blocs pleins
 * entre elles, plus les morceaux de traits restés seuls.
 */
export function pairWalls(s: Float64Array, minT: number, maxT: number): { boxes: WallBox[]; leftovers: Leftover[] } {
  const n = s.length / 4;
  const X = new Float64Array(n), Y = new Float64Array(n), UX = new Float64Array(n), UY = new Float64Array(n), L = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x1 = s[i * 4], y1 = s[i * 4 + 1], dx = s[i * 4 + 2] - x1, dy = s[i * 4 + 3] - y1, l = Math.hypot(dx, dy);
    X[i] = x1; Y[i] = y1; L[i] = l; UX[i] = l ? dx / l : 1; UY[i] = l ? dy / l : 0;
  }
  // Grille spatiale : on ne compare que des segments voisins.
  const cell = Math.max(maxT * 2, 0.5);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (L[i] < 0.02) continue;
    const x2 = X[i] + UX[i] * L[i], y2 = Y[i] + UY[i] * L[i];
    const gx0 = Math.floor((Math.min(X[i], x2) - maxT) / cell), gx1 = Math.floor((Math.max(X[i], x2) + maxT) / cell);
    const gy0 = Math.floor((Math.min(Y[i], y2) - maxT) / cell), gy1 = Math.floor((Math.max(Y[i], y2) + maxT) / cell);
    if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > 4000) continue;
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
      const key = (gx * 73856093) ^ (gy * 19349663);
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(i);
    }
  }
  const seen = new Set<number>();
  const dens = new Float64Array(n);
  const cands: { i: number; j: number; d: number; lo: number; hi: number }[] = [];
  for (const list of grid.values()) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      let i = list[a], j = list[b];
      if (i > j) [i, j] = [j, i];
      const key = i * n + j;
      if (seen.has(key)) continue;
      seen.add(key);
      if (Math.abs(UX[i] * UY[j] - UY[i] * UX[j]) > 0.035) continue; // ~2°
      const mx = X[j] + UX[j] * L[j] / 2, my = Y[j] + UY[j] * L[j] / 2;
      const d = (mx - X[i]) * -UY[i] + (my - Y[i]) * UX[i];
      const ad = Math.abs(d);
      if (ad < minT || ad > maxT) continue;
      const t1 = (X[j] - X[i]) * UX[i] + (Y[j] - Y[i]) * UY[i];
      const t2 = t1 + L[j] * (UX[j] * UX[i] + UY[j] * UY[i]);
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(L[i], Math.max(t1, t2));
      if (hi - lo < 0.02) continue;
      cands.push({ i, j, d, lo, hi });
      // Part de chaque trait longée par l'autre (sur le trait j, la longueur commune est la même).
      dens[i] += (hi - lo) / L[i];
      dens[j] += (hi - lo) / L[j];
    }
  }
  // Un mur a une face en vis-à-vis (2 pour un mur à doublage). Un trait longé par 3 traits
  // parallèles ou plus appartient à une famille de traits serrés : hachures, marches
  // d'escalier, détail de baies informatiques ou de mobilier. Ce n'est pas un mur : ces
  // traits ne forment ni bloc ni reste extrudé.
  const stack = Array.from(dens, (v) => v >= STACK_DENSITY);
  cands.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));

  const covered: [number, number][][] = Array.from({ length: n }, () => []);
  const coveredFrac = (k: number, lo: number, hi: number) => {
    let c = 0;
    for (const [a, b] of covered[k]) c += Math.max(0, Math.min(b, hi) - Math.max(a, lo));
    return c / (hi - lo);
  };
  const boxes: WallBox[] = [];
  for (const { i, j, d, lo, hi } of cands) {
    if (stack[i] || stack[j]) continue;
    const ax = X[i] + UX[i] * lo, ay = Y[i] + UY[i] * lo, bx = X[i] + UX[i] * hi, by = Y[i] + UY[i] * hi;
    const pa = (ax - X[j]) * UX[j] + (ay - Y[j]) * UY[j], pb = (bx - X[j]) * UX[j] + (by - Y[j]) * UY[j];
    const jlo = Math.max(0, Math.min(pa, pb)), jhi = Math.min(L[j], Math.max(pa, pb));
    if (jhi - jlo < 0.02) continue;
    if (coveredFrac(i, lo, hi) > 0.5 || coveredFrac(j, jlo, jhi) > 0.5) continue;
    covered[i].push([lo, hi]);
    covered[j].push([jlo, jhi]);
    const mid = (lo + hi) / 2;
    boxes.push({ x: X[i] + UX[i] * mid - UY[i] * d / 2, y: Y[i] + UY[i] * mid + UX[i] * d / 2, ux: UX[i], uy: UY[i], len: hi - lo, thick: Math.abs(d) });
  }
  const leftovers: Leftover[] = [];
  for (let k = 0; k < n; k++) {
    if (L[k] < 0.02 || stack[k]) continue;
    const iv = covered[k].sort((a, b) => a[0] - b[0]);
    let t = 0;
    const gaps: [number, number][] = [];
    for (const [a, b] of iv) { if (a > t) gaps.push([t, a]); t = Math.max(t, b); }
    if (t < L[k]) gaps.push([t, L[k]]);
    for (const [a, b] of gaps) leftovers.push({ len: b - a, x: X[k] + UX[k] * (a + b) / 2, y: Y[k] + UY[k] * (a + b) / 2, ux: UX[k], uy: UY[k] });
  }
  return { boxes, leftovers };
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

/**
 * Repère les écritures parmi de petits dessins : les caractères d'un mot ou d'un repère
 * (« 3/100/101 ») ont des tailles voisines et sont séparés de moins de la moitié de leur
 * taille ; à partir de 3 caractères ainsi enchaînés, c'est une écriture. Des poteaux ou des
 * trumeaux entre deux portes sont bien plus espacés au regard de leur taille.
 */
export function textRuns(boxes: BBox[]): Set<number> {
  const n = boxes.length;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const size = boxes.map((b) => Math.max(b.maxX - b.minX, b.maxY - b.minY));
  const maxSize = Math.max(0, ...size);
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].minX - boxes[b].minX);
  for (let a = 0; a < n; a++) {
    const i = order[a], A = boxes[i];
    for (let c = a + 1; c < n; c++) {
      const j = order[c], B = boxes[j];
      if (B.minX - A.maxX > 0.5 * maxSize) break;
      const big = Math.max(size[i], size[j]), little = Math.min(size[i], size[j]);
      if (!big || little < 0.4 * big) continue;
      const gap = Math.hypot(Math.max(0, B.minX - A.maxX, A.minX - B.maxX), Math.max(0, B.minY - A.maxY, A.minY - B.maxY));
      if (gap <= 0.5 * big) parent[find(i)] = find(j);
    }
  }
  const count = new Map<number, number>();
  for (let i = 0; i < n; i++) count.set(find(i), (count.get(find(i)) ?? 0) + 1);
  const out = new Set<number>();
  for (let i = 0; i < n; i++) if ((count.get(find(i)) ?? 0) >= 3) out.add(i);
  return out;
}

/**
 * Retire les petits dessins isolés qui ne sont pas des murs : écritures tracées en traits
 * (police SHX d'AutoCAD exportée en PDF, textes « éclatés »), tirets, petits symboles.
 * Les traits sont regroupés par contact (extrémité à moins de tol d'un autre trait) ; un
 * groupe plus petit que small n'est gardé que s'il forme lui-même un mur en double trait
 * (poteau, petit trumeau) : ses traits sont alors appariés presque en totalité, ce qui
 * n'arrive pas aux lettres et aux chiffres.
 */
export function dropSmallMarks(s: Float64Array, tol: number, small: number, minT: number, maxT: number): Float64Array {
  const n = s.length / 4;
  if (!n) return s;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const cell = Math.max(small / 2, tol * 4);
  const grid = new Map<number, number[]>();
  const key = (gx: number, gy: number) => (gx * 73856093) ^ (gy * 19349663);
  for (let i = 0; i < n; i++) {
    const x1 = s[i * 4], y1 = s[i * 4 + 1], x2 = s[i * 4 + 2], y2 = s[i * 4 + 3];
    const gx0 = Math.floor((Math.min(x1, x2) - tol) / cell), gx1 = Math.floor((Math.max(x1, x2) + tol) / cell);
    const gy0 = Math.floor((Math.min(y1, y2) - tol) / cell), gy1 = Math.floor((Math.max(y1, y2) + tol) / cell);
    if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > 4000) continue; // trait démesuré : forcément gardé
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
      const k = key(gx, gy);
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(i);
    }
  }
  const distToSeg = (px: number, py: number, j: number) => {
    const ax = s[j * 4], ay = s[j * 4 + 1], dx = s[j * 4 + 2] - ax, dy = s[j * 4 + 3] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  for (let i = 0; i < n; i++) {
    for (const e of [0, 2]) {
      const px = s[i * 4 + e], py = s[i * 4 + e + 1];
      const gx0 = Math.floor((px - tol) / cell), gx1 = Math.floor((px + tol) / cell);
      const gy0 = Math.floor((py - tol) / cell), gy1 = Math.floor((py + tol) / cell);
      for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) {
        for (const j of grid.get(key(gx, gy)) || []) {
          if (j !== i && find(i) !== find(j) && distToSeg(px, py, j) <= tol) parent[find(i)] = find(j);
        }
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(i);
  }
  const keep = new Uint8Array(n);
  const smallOnes: { members: number[]; box: BBox; total: number }[] = [];
  for (const members of groups.values()) {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    let total = 0;
    for (const i of members) {
      const x1 = s[i * 4], y1 = s[i * 4 + 1], x2 = s[i * 4 + 2], y2 = s[i * 4 + 3];
      box.minX = Math.min(box.minX, x1, x2); box.maxX = Math.max(box.maxX, x1, x2);
      box.minY = Math.min(box.minY, y1, y2); box.maxY = Math.max(box.maxY, y1, y2);
      total += Math.hypot(x2 - x1, y2 - y1);
    }
    if (Math.max(box.maxX - box.minX, box.maxY - box.minY) >= small) { for (const i of members) keep[i] = 1; }
    else smallOnes.push({ members, box, total });
  }
  const text = textRuns(smallOnes.map((c) => c.box));
  smallOnes.forEach(({ members, box, total }, k) => {
    if (text.has(k) || !total || Math.max(box.maxX - box.minX, box.maxY - box.minY) < 3 * minT) return;
    const segs: number[] = [];
    for (const i of members) segs.push(s[i * 4], s[i * 4 + 1], s[i * 4 + 2], s[i * 4 + 3]);
    let paired = 0;
    for (const b of pairWalls(Float64Array.from(segs), minT, maxT).boxes) paired += 2 * b.len;
    if (paired >= 0.75 * total) for (const i of members) keep[i] = 1;
  });
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(s[i * 4], s[i * 4 + 1], s[i * 4 + 2], s[i * 4 + 3]);
  return Float64Array.from(out);
}

/**
 * Aplats retenus comme murs (murs pochés, poteaux pleins). Les petits aplats qui forment
 * une écriture (police pleine) sont écartés, ainsi que les petits symboles qui ne sont pas
 * des rectangles pleins d'au moins minW d'épaisseur (flèches, puces, pictogrammes).
 */
export function filterWallFills<T extends { outer: number[]; holes: number[][] }>(fills: T[], small: number, minW: number): T[] {
  const info = fills.map((f) => {
    const r = minAreaRect(f.outer);
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let i = 0; i < f.outer.length; i += 2) {
      box.minX = Math.min(box.minX, f.outer[i]); box.maxX = Math.max(box.maxX, f.outer[i]);
      box.minY = Math.min(box.minY, f.outer[i + 1]); box.maxY = Math.max(box.maxY, f.outer[i + 1]);
    }
    return { r, box };
  });
  const smallIdx = info.map((_, i) => i).filter((i) => info[i].r && info[i].r!.L < small);
  const text = textRuns(smallIdx.map((i) => info[i].box));
  const textSet = new Set([...text].map((k) => smallIdx[k]));
  return fills.filter((f, i) => {
    const r = info[i].r;
    if (!r) return false;
    if (r.L >= small) return true;
    if (textSet.has(i)) return false;
    const area = Math.abs(polygonArea(f.outer)) - f.holes.reduce((a, h) => a + Math.abs(polygonArea(h)), 0);
    return r.W >= minW && area >= 0.6 * r.L * r.W;
  });
}

/**
 * Ressemblance d'un ensemble de traits à des murs en double trait : longueur totale des pans
 * appariés d'au moins minLen. Les petits dessins (écritures, symboles) et les familles de
 * traits serrés (hachures, escaliers, tableaux du cartouche) sont écartés avant le calcul.
 * Une somme simple, et non des carrés : le double cadre de la feuille, très long mais seul,
 * ne doit pas l'emporter sur les centaines de mètres de murs d'un étage.
 */
export function wallScore(segs: ArrayLike<number>, minT: number, maxT: number, minLen: number): number {
  let score = 0;
  const kept = dropSmallMarks(Float64Array.from(segs), minT / 4, minLen * 2, minT, maxT);
  for (const b of pairWalls(kept, minT, maxT).boxes) if (b.len >= minLen) score += b.len;
  return score;
}

/** Regroupe les traits qui se touchent (symboles de fenêtre). */
export function clusterSegments(s: Float64Array, tol: number): number[][] {
  const n = s.length / 4;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const bb = [];
  for (let i = 0; i < n; i++) {
    const x1 = s[i * 4], y1 = s[i * 4 + 1], x2 = s[i * 4 + 2], y2 = s[i * 4 + 3];
    bb.push({ i, minX: Math.min(x1, x2), maxX: Math.max(x1, x2), minY: Math.min(y1, y2), maxY: Math.max(y1, y2) });
  }
  bb.sort((a, b) => a.minX - b.minX);
  for (let a = 0; a < n; a++) {
    const A = bb[a];
    for (let b = a + 1; b < n && bb[b].minX <= A.maxX + tol; b++) {
      const B = bb[b];
      if (B.minY <= A.maxY + tol && B.maxY >= A.minY - tol) parent[find(A.i)] = find(B.i);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(s[i * 4], s[i * 4 + 1], s[i * 4 + 2], s[i * 4 + 3]);
  }
  return [...groups.values()];
}

export interface Rect { cx: number; cy: number; ux: number; uy: number; L: number; W: number; area: number }

export function minAreaRect(pts: number[]): Rect | null {
  const P: [number, number][] = [];
  for (let i = 0; i < pts.length; i += 2) P.push([pts[i], pts[i + 1]]);
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of P) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 2) return null;
  let best: Rect | null = null;
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k], b = hull[(k + 1) % hull.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-9) continue;
    const ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of hull) {
      const u = p[0] * ux + p[1] * uy, v = -p[0] * uy + p[1] * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-12) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      best = { area, cx: um * ux - vm * uy, cy: um * uy + vm * ux, ux, uy, L: u1 - u0, W: v1 - v0 };
    }
  }
  if (best && best.W > best.L) best = { ...best, ux: -best.uy, uy: best.ux, L: best.W, W: best.L };
  return best;
}
