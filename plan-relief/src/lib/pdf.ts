import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { IDENTITY, apply, filterWallFills, maxOf, minAreaRect, mul, pointInPolygon, wallScore, polygonArea, type Mat } from './geometry';
import { isUsefulLabel } from './dxf';
import type { Drawing, Equipment, Group } from './types';

// Worker servi par ce site (CSP : worker-src 'self'), jamais par un CDN.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const OPS = pdfjsLib.OPS as unknown as Record<string, number>;
const fmt = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hexColor = (c: ArrayLike<number>) => ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255);
const parseHex = (s: string) => { const v = parseInt(s.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const luminance = (c: number) => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

export async function openPdf(buf: ArrayBuffer) {
  // isEvalSupported : la CSP interdit eval, et rien ici n'en a besoin (pas de rendu de polices).
  // Copie : pdf.js transfère les données à son worker, ce qui viderait le tampon de
  // l'appelant (encore utilisé pour l'OCR, le changement de page et « Télécharger l'original »).
  return pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
}

interface Sub { pts: number[]; closed: boolean }

/** Tracés vectoriels d'une page, regroupés par épaisseur et couleur (un PDF n'a pas de calques). */
async function pageGroups(page: pdfjsLib.PDFPageProxy): Promise<Group[]> {
  const ol = await page.getOperatorList();
  const map = new Map<string, Group>();
  const stack: { ctm: Mat; lw: number; stroke: number[]; fill: number[] }[] = [];
  let ctm: Mat = IDENTITY, lw = 1, stroke = [0, 0, 0], fill = [0, 0, 0];
  let subpaths: Sub[] = [];
  let cur: Sub | null = null;
  let lastStart: [number, number] | null = null;

  const get = (id: string, name: string, color: number, kind: 'line' | 'fill') => {
    let g = map.get(id);
    if (!g) { g = { id, name, color, kind, segs: [], fills: [], guess: 'plan' }; map.set(id, g); }
    return g;
  };
  const push = (g: Group, pts: number[], closed: boolean) => {
    for (let i = 2; i < pts.length; i += 2) g.segs.push(pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
    const n = pts.length;
    if (closed && n >= 6 && (pts[0] !== pts[n - 2] || pts[1] !== pts[n - 1])) g.segs.push(pts[n - 2], pts[n - 1], pts[0], pts[1]);
  };
  const startSub = (x: number, y: number) => { cur = { pts: [x, y], closed: false }; subpaths.push(cur); };
  // Après une fermeture (h), un nouveau trait repart du début du sous-chemin précédent.
  const ensure = () => { if (!cur && lastStart) startSub(lastStart[0], lastStart[1]); return cur as Sub | null; };
  const bezier = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    const c = ensure();
    if (!c) return;
    const n = c.pts.length, x0 = c.pts[n - 2], y0 = c.pts[n - 1];
    for (let k = 1; k <= 8; k++) {
      const t = k / 8, u = 1 - t, a = u * u * u, b = 3 * u * u * t, cc = 3 * u * t * t, d = t * t * t;
      c.pts.push(a * x0 + b * x1 + cc * x2 + d * x3, a * y0 + b * y1 + cc * y2 + d * y3);
    }
  };
  const emitStroke = (close: boolean) => {
    if (close && cur) (cur as Sub).closed = true;
    const w = Math.round(lw * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) * 100) / 100;
    const color = hexColor(stroke);
    const g = get(`s:${w}:${color}`, `Trait ${fmt(w)} pt`, color, 'line');
    g.width = w;
    for (const sp of subpaths) push(g, sp.pts, sp.closed);
  };
  const emitFill = () => {
    const color = hexColor(fill);
    const g = get(`f:${color}`, 'Aplat', color, 'fill');
    const polys = subpaths.filter((sp) => sp.pts.length >= 6)
      .map((sp) => ({ pts: sp.pts, area: Math.abs(polygonArea(sp.pts)), depth: 0, parent: null as null | { shape?: { outer: number[]; holes: number[][] } }, shape: undefined as undefined | { outer: number[]; holes: number[][] } }))
      .filter((p) => p.area > 1e-6).sort((a, b) => b.area - a.area);
    // Imbrication : un contour contenu dans un autre devient un trou (profondeur impaire).
    for (let i = 0; i < polys.length; i++) {
      const p = polys[i];
      for (let j = i - 1; j >= 0; j--) {
        if (pointInPolygon(p.pts[0], p.pts[1], polys[j].pts)) { p.parent = polys[j]; p.depth = polys[j].depth + 1; break; }
      }
      if (p.depth % 2 === 0) { p.shape = { outer: p.pts, holes: [] }; g.fills.push(p.shape); }
      else p.parent?.shape?.holes.push(p.pts);
      push(g, p.pts, true);
    }
  };
  const endPath = () => { subpaths = []; cur = null; lastStart = null; };

  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i];
    const args = ol.argsArray[i];
    switch (fn) {
      case OPS.save: stack.push({ ctm, lw, stroke, fill }); break;
      case OPS.restore: { const s = stack.pop(); if (s) ({ ctm, lw, stroke, fill } = s); break; }
      case OPS.transform: ctm = mul(ctm, args); break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ctm, lw, stroke, fill });
        if (args[0]) ctm = mul(ctm, args[0]);
        break;
      case OPS.paintFormXObjectEnd: { const s = stack.pop(); if (s) ({ ctm, lw, stroke, fill } = s); break; }
      case OPS.setLineWidth: lw = args[0]; break;
      case OPS.setStrokeRGBColor: stroke = typeof args === 'string' ? parseHex(args) : [args[0], args[1], args[2]]; break;
      case OPS.setFillRGBColor: fill = typeof args === 'string' ? parseHex(args) : [args[0], args[1], args[2]]; break;
      case OPS.constructPath: {
        const [ops, coords] = args as [number[], number[]];
        let k = 0;
        const P = (x: number, y: number) => apply(ctm, x, y);
        for (const op of ops) {
          if (op === OPS.moveTo) { const [x, y] = P(coords[k], coords[k + 1]); k += 2; startSub(x, y); }
          else if (op === OPS.lineTo) { const [x, y] = P(coords[k], coords[k + 1]); k += 2; const c = ensure(); if (c) c.pts.push(x, y); else startSub(x, y); }
          else if (op === OPS.curveTo) {
            const [a, b] = P(coords[k], coords[k + 1]), [c, d] = P(coords[k + 2], coords[k + 3]), [e, f] = P(coords[k + 4], coords[k + 5]);
            k += 6; bezier(a, b, c, d, e, f);
          } else if (op === OPS.curveTo2) {
            const [c, d] = P(coords[k], coords[k + 1]), [e, f] = P(coords[k + 2], coords[k + 3]);
            k += 4;
            const s = ensure();
            if (s) bezier(s.pts[s.pts.length - 2], s.pts[s.pts.length - 1], c, d, e, f);
          } else if (op === OPS.curveTo3) {
            const [a, b] = P(coords[k], coords[k + 1]), [e, f] = P(coords[k + 2], coords[k + 3]);
            k += 4; bezier(a, b, e, f, e, f);
          } else if (op === OPS.closePath) {
            const c = cur as Sub | null;
            if (c) { c.closed = true; lastStart = [c.pts[0], c.pts[1]]; cur = null; }
          } else if (op === OPS.rectangle) {
            const x = coords[k], y = coords[k + 1], w = coords[k + 2], h = coords[k + 3]; k += 4;
            subpaths.push({ pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)].flat(), closed: true });
            cur = null;
          }
        }
        break;
      }
      case OPS.stroke: emitStroke(false); endPath(); break;
      case OPS.closeStroke: emitStroke(true); endPath(); break;
      case OPS.fill: case OPS.eoFill: emitFill(); endPath(); break;
      case OPS.fillStroke: case OPS.eoFillStroke: emitFill(); emitStroke(false); endPath(); break;
      case OPS.closeFillStroke: case OPS.closeEOFillStroke: emitFill(); emitStroke(true); endPath(); break;
      case OPS.endPath: endPath(); break;
      default: break;
    }
  }
  const groups = [...map.values()].filter((g) => g.segs.length > 0);
  guessPdfRoles(groups);
  return groups.sort((a, b) => (a.kind === b.kind ? (b.width ?? 0) - (a.width ?? 0) || b.segs.length - a.segs.length : a.kind === 'fill' ? -1 : 1));
}

function guessPdfRoles(groups: Group[]) {
  for (const g of groups) g.guess = g.kind === 'fill' && luminance(g.color) > 0.92 ? 'ignore' : 'plan';
  // Les murs sont cherchés par leur forme, dans les traits (murs en double trait) comme dans
  // les aplats (murs pochés), tous notés sur la même échelle : longueur de mur reconnue.
  // L'épaisseur du trait n'est pas un bon indice : sur un plan technique, ce sont souvent
  // les baies, les chemins de câbles ou les équipements qui sont dessinés en gras.
  const scored = groups
    .filter((g) => (g.kind === 'line' ? g.segs.length >= 16 && g.segs.length <= MAX_SCORED_SEGS * 4 : g.guess !== 'ignore'))
    .map((g) => ({ g, score: groupWallScore(g) }));
  const best = Math.max(0, maxOf(scored.map((x) => x.score)));
  if (best > 0) {
    for (const { g, score } of scored) if (score >= best * 0.6) g.guess = 'mur';
    return;
  }
  // Plan en simple trait : à défaut de mieux, le trait le plus épais.
  const strokes = groups.filter((g) => g.kind === 'line' && g.segs.length >= 16);
  if (strokes.length <= 1) return;
  const maxW = maxOf(strokes.map((g) => g.width ?? 0));
  for (const g of strokes) if (g.width === maxW && maxW > 0) g.guess = 'mur';
}

const MAX_SCORED_SEGS = 400_000;
// L'échelle du PDF n'est pas encore connue : on couvre les échelles courantes (1:50 à 1:200),
// soit des murs de 10 à 60 cm entre 1,4 et 34 points, et des pans d'au moins 1 m au 1:200.
const MIN_T = 1.4, MAX_T = 34, MIN_LEN = 14;

const saturation = (c: number) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, mx = Math.max(r, g, b);
  return mx ? (mx - Math.min(r, g, b)) / mx : 0;
};

function groupWallScore(g: Group): number {
  if (g.kind === 'line') {
    // Une couleur vive désigne d'ordinaire un réseau (chemin de câbles, gaine, tuyauterie),
    // dessiné lui aussi en double trait : il ne passe devant le fond d'architecte (gris ou
    // noir) que s'il est nettement plus long.
    return wallScore(g.segs, MIN_T, MAX_T, MIN_LEN) * (saturation(g.color) > 0.35 ? 0.3 : 1);
  }
  // Aplats : murs pochés gris ou noirs uniquement. Les aplats de couleur sont des symboles,
  // des zones ou des repères, jamais des murs.
  if (luminance(g.color) >= 0.6 || saturation(g.color) > 0.35) return 0;
  let score = 0;
  for (const f of filterWallFills(g.fills, MIN_LEN * 4, MIN_T)) {
    const L = minAreaRect(f.outer)?.L ?? 0;
    if (L >= MIN_LEN) score += L;
  }
  return score;
}

interface Run { text: string; x: number; y: number; endX: number; h: number }

/**
 * Textes de la page. Les fragments d'une même ligne sont fusionnés (« SW », « -B- », « 01 »),
 * puis les lignes d'un même bloc d'indication (alignées à gauche, à interligne normal) sont
 * réunies : « Baie de brassage » / « B-12 » / « 42U » donne une seule indication.
 */
async function pageTexts(page: pdfjsLib.PDFPageProxy): Promise<Equipment[]> {
  const content = await page.getTextContent();
  const runs: Run[] = [];
  for (const it of content.items as { str?: string; transform?: number[]; width?: number }[]) {
    if (!it.str || !it.transform) continue;
    const [a, b, , , x, y] = it.transform;
    const h = Math.hypot(a, b) || 1;
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.y - y) < h * 0.5 && x - last.endX < h * 0.6 && x >= last.x) {
      last.text += (x - last.endX > h * 0.15 ? ' ' : '') + it.str;
      last.endX = Math.max(last.endX, x + (it.width ?? 0));
    } else {
      runs.push({ text: it.str, x, y, endX: x + (it.width ?? 0), h });
    }
  }
  const lines = runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, ' ').trim() })).filter((r) => r.text);
  const blocks: { lines: Run[] }[] = [];
  for (const l of lines) {
    const prev = blocks[blocks.length - 1];
    const p = prev?.lines[prev.lines.length - 1];
    if (p && Math.abs(p.x - l.x) < p.h * 0.6 && p.y - l.y > p.h * 0.6 && p.y - l.y < p.h * 1.9 && Math.abs(p.h - l.h) < p.h * 0.35 && prev.lines.length < 6) {
      prev.lines.push(l);
    } else {
      blocks.push({ lines: [l] });
    }
  }
  const out: Equipment[] = [];
  for (const b of blocks) {
    const label = b.lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!isUsefulLabel(label)) continue;
    const first = b.lines[0], last = b.lines[b.lines.length - 1];
    const x = (Math.min(...b.lines.map((l) => l.x)) + Math.max(...b.lines.map((l) => l.endX))) / 2;
    out.push({ id: `t${out.length}`, kind: 'texte', label: label.slice(0, 200), type: '', layer: '', x, y: (first.y + first.h + last.y) / 2 });
  }
  return out;
}

const ANNOT_LABELS: Record<string, string> = {
  FreeText: 'Commentaire PDF', Text: 'Note PDF', Square: 'Annotation PDF', Circle: 'Annotation PDF', Polygon: 'Annotation PDF',
  PolyLine: 'Annotation PDF', Line: 'Annotation PDF', Ink: 'Annotation PDF', Stamp: 'Tampon PDF', Highlight: 'Surlignage PDF',
  Underline: 'Annotation PDF', Caret: 'Annotation PDF',
};

/** Commentaires ajoutés au PDF (Acrobat, Bluebeam, Foxit…) : texte, auteur, position. */
async function pageAnnotations(page: pdfjsLib.PDFPageProxy): Promise<Equipment[]> {
  const annots = (await page.getAnnotations({ intent: 'display' })) as {
    subtype?: string; rect?: number[]; contentsObj?: { str?: string }; contents?: string; titleObj?: { str?: string }; subjectObj?: { str?: string };
  }[];
  const out: Equipment[] = [];
  for (const a of annots) {
    const type = a.subtype && ANNOT_LABELS[a.subtype];
    if (!type || !a.rect) continue;
    const text = cleanAnnot(a.contentsObj?.str ?? a.contents ?? '');
    const subject = cleanAnnot(a.subjectObj?.str ?? '');
    const label = text || subject;
    if (!isUsefulLabel(label)) continue;
    const attributes: Record<string, string> = {};
    const author = cleanAnnot(a.titleObj?.str ?? '');
    if (author) attributes.Auteur = author;
    if (subject && subject !== label) attributes.Objet = subject;
    out.push({
      id: `a${out.length}`, kind: 'texte', label: label.slice(0, 200), type, layer: '',
      x: (a.rect[0] + a.rect[2]) / 2, y: (a.rect[1] + a.rect[3]) / 2,
      ...(Object.keys(attributes).length ? { attributes } : {}),
      ...(label.length > 200 ? { notes: label.slice(0, 2000) } : {}),
    });
  }
  return out;
}
const cleanAnnot = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function readPdf(buf: ArrayBuffer, pageNum: number): Promise<Drawing> {
  const doc = await openPdf(buf);
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNum), doc.numPages));
    const [groups, texts, annots] = await Promise.all([pageGroups(page), pageTexts(page), pageAnnotations(page)]);
    return { format: 'pdf', groups, equipment: [...texts, ...annots], pageCount: doc.numPages };
  } finally {
    doc.destroy();
  }
}
