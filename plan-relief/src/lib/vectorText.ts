/**
 * Textes dessinés en vectoriel (AutoCAD exporte souvent ses textes en contours de lettres,
 * sans texte PDF) : regroupement des contours en lignes, puis rendu de chaque ligne seule,
 * droite et agrandie, sur fond blanc, pour une lecture OCR sans les murs, symboles et
 * hachures qui la gênent sur l'image de la page. Les textes verticaux sont redressés.
 *
 * Indépendant du navigateur sauf `renderLines` (canvas) : testable seul.
 */

/** Petite forme du dessin : un morceau de lettre, en coordonnées de page PDF (y vers le haut). */
export interface Piece { x0: number; y0: number; x1: number; y1: number; subpaths: number[][]; stroke: boolean; lineWidth: number }

/** Ligne de texte : morceaux alignés, horizontale (h) ou verticale (v, lue de bas en haut). */
export interface TextLine { pieces: Piece[]; dir: 'h' | 'v'; x0: number; y0: number; x1: number; y1: number; height: number }

const MAX_PIECE = 12; // points : au-delà, ce n'est pas une lettre (titres exceptés, rares)

type Mat = [number, number, number, number, number, number];
const mul = (m: Mat, n: number[]): Mat => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** Petites formes pleines ou tracées d'une liste d'opérations pdf.js (page entière). */
export function collectPieces(fnArray: number[], argsArray: unknown[][], OPS: Record<string, number>): Piece[] {
  const out: Piece[] = [];
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  let lw = 1;
  const stack: { ctm: Mat; lw: number }[] = [];
  let subs: number[][] = [];
  const P = (x: number, y: number) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  const scale = () => Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;
  const emit = (stroke: boolean) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of subs) for (let i = 0; i < s.length; i += 2) {
      x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); y0 = Math.min(y0, s[i + 1]); y1 = Math.max(y1, s[i + 1]);
    }
    if (x0 === Infinity || x1 - x0 > MAX_PIECE || y1 - y0 > MAX_PIECE) return;
    out.push({ x0, y0, x1, y1, subpaths: subs, stroke, lineWidth: lw * scale() });
  };
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i] as never[];
    switch (fn) {
      case OPS.save: stack.push({ ctm, lw }); break;
      case OPS.restore: { const s = stack.pop(); if (s) ({ ctm, lw } = s); break; }
      case OPS.transform: ctm = mul(ctm, args as unknown as number[]); break;
      case OPS.paintFormXObjectBegin: stack.push({ ctm, lw }); if (args[0]) ctm = mul(ctm, args[0] as unknown as number[]); break;
      case OPS.paintFormXObjectEnd: { const s = stack.pop(); if (s) ({ ctm, lw } = s); break; }
      case OPS.setLineWidth: lw = args[0] as unknown as number; break;
      case OPS.constructPath: {
        const [ops, coords] = args as unknown as [number[], number[]];
        let k = 0, cur: number[] | null = null;
        for (const op of ops) {
          if (op === OPS.moveTo) { cur = P(coords[k], coords[k + 1]); subs.push(cur); k += 2; }
          else if (op === OPS.lineTo) { const p = P(coords[k], coords[k + 1]); k += 2; if (!cur) { cur = p; subs.push(cur); } else cur.push(...p); }
          else if (op === OPS.curveTo) { const p = P(coords[k + 4], coords[k + 5]); const c1 = P(coords[k], coords[k + 1]), c2 = P(coords[k + 2], coords[k + 3]); k += 6; if (cur) bez(cur, c1, c2, p); }
          else if (op === OPS.curveTo2) { const c2 = P(coords[k], coords[k + 1]), p = P(coords[k + 2], coords[k + 3]); k += 4; if (cur) bez(cur, [cur[cur.length - 2], cur[cur.length - 1]], c2, p); }
          else if (op === OPS.curveTo3) { const c1 = P(coords[k], coords[k + 1]), p = P(coords[k + 2], coords[k + 3]); k += 4; if (cur) bez(cur, c1, p, p); }
          else if (op === OPS.closePath) { if (cur) cur.push(cur[0], cur[1]); cur = null; }
          else if (op === OPS.rectangle) { const x = coords[k], y = coords[k + 1], w = coords[k + 2], h = coords[k + 3]; k += 4; subs.push([...P(x, y), ...P(x + w, y), ...P(x + w, y + h), ...P(x, y + h), ...P(x, y)]); cur = null; }
        }
        break;
      }
      case OPS.fill: case OPS.eoFill: case OPS.fillStroke: case OPS.eoFillStroke: case OPS.closeFillStroke: case OPS.closeEOFillStroke:
        emit(false); subs = []; break;
      case OPS.stroke: case OPS.closeStroke: emit(true); subs = []; break;
      case OPS.endPath: subs = []; break;
      default: break;
    }
  }
  return out;
}

function bez(cur: number[], c1: number[], c2: number[], p: number[]) {
  const x0 = cur[cur.length - 2], y0 = cur[cur.length - 1];
  for (let t = 1; t <= 4; t++) {
    const u = t / 4, a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
    cur.push(a * x0 + b * c1[0] + c * c2[0] + d * p[0], a * y0 + b * c1[1] + c * c2[1] + d * p[1]);
  }
}

/**
 * Regroupe les morceaux en lignes : morceaux qui se recouvrent en hauteur et se suivent à
 * moins d'une hauteur de lettre. Les deux sens sont cherchés sur tous les morceaux ; quand
 * un morceau appartient à une ligne horizontale et à une verticale, la plus longue gagne
 * (des repères verticaux côte à côte forment aussi de courtes « lignes » horizontales).
 */
export function groupLines(pieces: Piece[]): TextLine[] {
  const candidates = [...pass(pieces, 'h'), ...pass(pieces, 'v')].sort((a, b) => b.pieces.length - a.pieces.length);
  const claimed = new Set<Piece>();
  const lines: TextLine[] = [];
  for (const l of candidates) {
    const free = l.pieces.filter((p) => !claimed.has(p));
    if (free.length < 0.7 * l.pieces.length || free.length < 2) continue;
    // La ligne garde tous ses morceaux, même ceux déjà pris par une ligne plus longue : une
    // lettre à la croisée d'un texte horizontal et d'un texte vertical sert aux deux.
    for (const p of free) claimed.add(p);
    lines.push(l);
  }
  return lines;
}

function makeLine(all: Piece[], dir: 'h' | 'v'): TextLine | null {
  // Un arc de porte ou un symbole accolé au texte fausserait la hauteur de la ligne (texte
  // rendu minuscule) : les morceaux bien plus hauts que la plupart des lettres sont écartés.
  const hs = all.map((p) => (dir === 'h' ? p.y1 - p.y0 : p.x1 - p.x0)).sort((a, b) => a - b);
  const tall = hs[Math.floor(hs.length * 0.75)] || 0;
  const g = all.length >= 4 ? all.filter((p) => (dir === 'h' ? p.y1 - p.y0 : p.x1 - p.x0) <= tall * 1.6 + 0.05) : all;
  const x0 = Math.min(...g.map((p) => p.x0)), x1 = Math.max(...g.map((p) => p.x1));
  const y0 = Math.min(...g.map((p) => p.y0)), y1 = Math.max(...g.map((p) => p.y1));
  const len = dir === 'h' ? x1 - x0 : y1 - y0, height = dir === 'h' ? y1 - y0 : x1 - x0;
  return g.length >= 2 && len >= 1.2 * height && height > 0.5 ? { pieces: g, dir, x0, y0, x1, y1, height } : null;
}

function pass(items: Piece[], dir: 'h' | 'v'): TextLine[] {
  // En vertical, on raisonne dans un repère tourné : u le long de la ligne, v en travers.
  const U0 = (p: Piece) => (dir === 'h' ? p.x0 : p.y0), U1 = (p: Piece) => (dir === 'h' ? p.x1 : p.y1);
  const V0 = (p: Piece) => (dir === 'h' ? p.y0 : -p.x1), V1 = (p: Piece) => (dir === 'h' ? p.y1 : -p.x0);
  const n = items.length;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const order = items.map((_, i) => i).sort((a, b) => U0(items[a]) - U0(items[b]));
  let maxH = 0;
  for (const p of items) maxH = Math.max(maxH, V1(p) - V0(p));
  for (let a = 0; a < n; a++) {
    const A = items[order[a]], ha = V1(A) - V0(A);
    for (let b = a + 1; b < n; b++) {
      const B = items[order[b]];
      if (U0(B) - U1(A) > Math.max(maxH, 1)) break;
      const hb = V1(B) - V0(B), h = Math.max(ha, hb);
      const gap = U0(B) - U1(A);
      if (gap > 0.9 * h) continue;
      const overlap = Math.min(V1(A), V1(B)) - Math.max(V0(A), V0(B));
      if (overlap < 0.5 * Math.min(ha, hb)) continue;
      // Centres à la même hauteur : un morceau à cheval sur deux lignes empilées (texte
      // vertical voisin, symbole) ne doit pas les souder en une seule.
      if (Math.abs((V0(A) + V1(A)) / 2 - (V0(B) + V1(B)) / 2) > 0.35 * h) continue;
      // Lettres de tailles très différentes (titre contre petit repère) : pas la même ligne.
      if (Math.min(ha, hb) > 0.8 && Math.max(ha, hb) > 2.5 * Math.min(ha, hb) && gap > 0.3 * h) continue;
      parent[find(order[a])] = find(order[b]);
    }
  }
  const groups = new Map<number, Piece[]>();
  items.forEach((p, i) => { const r = find(i); const g = groups.get(r); if (g) g.push(p); else groups.set(r, [p]); });
  const out: TextLine[] = [];
  for (const g of groups.values()) { const l = makeLine(g, dir); if (l) out.push(l); }
  return out;
}

/** Image d'un lot de lignes, empilées l'une sous l'autre, et la bande occupée par chacune. */
export interface Batch { canvas: HTMLCanvasElement; slots: { line: TextLine; top: number; bottom: number }[] }

const TEXT_PX = 40;
const PAD = 12;
const MAX_W = 3200;
const MAX_H = 1800;

/**
 * Dessine les lignes droites et agrandies (40 pixels de haut), en noir sur blanc. Une ligne
 * verticale est lue de bas en haut (sens d'AutoCAD), ou de haut en bas si `flip`.
 */
export function renderBatches(lines: TextLine[], flip = false): Batch[] {
  const batches: Batch[] = [];
  const toUV = (l: TextLine, x: number, y: number): [number, number] => (l.dir === 'h' ? [x, y] : flip ? [-y, x] : [y, -x]);
  const geom = lines.map((l) => {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of l.pieces) for (const s of p.subpaths) for (let i = 0; i < s.length; i += 2) {
      const [u, v] = toUV(l, s[i], s[i + 1]);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    let sc = TEXT_PX / Math.max(v1 - v0, 0.1);
    if ((u1 - u0) * sc + 2 * PAD > MAX_W) sc = (MAX_W - 2 * PAD) / (u1 - u0);
    return { l, u0, v1, sc, w: Math.ceil((u1 - u0) * sc + 2 * PAD), h: Math.ceil((v1 - v0) * sc + 2 * PAD) };
  });
  let cur: typeof geom = [], height = 0;
  const flush = () => {
    if (!cur.length) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(...cur.map((g) => g.w));
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    const slots: Batch['slots'] = [];
    let top = 0;
    for (const g of cur) {
      for (const p of g.l.pieces) {
        ctx.beginPath();
        for (const s of p.subpaths) {
          for (let i = 0; i < s.length; i += 2) {
            const [u, v] = toUV(g.l, s[i], s[i + 1]);
            const X = (u - g.u0) * g.sc + PAD, Y = top + (g.v1 - v) * g.sc + PAD;
            if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
          }
        }
        if (p.stroke) { ctx.lineWidth = Math.max(1.5, p.lineWidth * g.sc); ctx.stroke(); } else ctx.fill('evenodd');
      }
      slots.push({ line: g.l, top, bottom: top + g.h });
      top += g.h;
    }
    batches.push({ canvas, slots });
    cur = []; height = 0;
  };
  for (const g of geom) {
    if (height + g.h > MAX_H) flush();
    cur.push(g);
    height += g.h;
  }
  flush();
  return batches;
}
