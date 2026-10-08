import type { Equipment, Group, PlanSettings } from './types';

/**
 * Repérage automatique des escaliers et des ascenseurs, pour s'en servir comme points de
 * départ des tracés et les faire ressortir sur la maquette.
 *
 * - Escaliers : par leur dessin. Une volée est une suite d'au moins 6 marches, traits
 *   parallèles de même longueur (0,6 à 3,5 m), régulièrement espacés de 20 à 36 cm. Les
 *   volées voisines (escalier à deux volées, palier) forment un seul escalier.
 * - Ascenseurs : par ce qui est écrit dans la cabine (« ASC », « Ascenseur », « MC » pour
 *   monte-charge, « MM » pour monte-malade…), texte du fichier ou lu par OCR. Leur dessin
 *   varie trop d'un cabinet d'architecte à l'autre pour être reconnu seul.
 *
 * Les éléments repérés sont des équipements ordinaires (recherche, tracés, fiche), marqués
 * par l'attribut « Détection » : un nouveau repérage les remplace sans toucher au reste.
 */

const DETECTION = 'Détection';
export const isDetectedLandmark = (e: Equipment) => !!e.attributes?.[DETECTION] && (e.category === 'escalier' || e.category === 'ascenseur' || e.category === 'gaine');

interface Flight { cx: number; cy: number; ux: number; uy: number; len: number; run: number; steps: number; minX: number; minY: number; maxX: number; maxY: number }

/** Volées d'escalier, en mètres (repère du dessin multiplié par f). */
export function findStairFlights(groups: Group[], settings: PlanSettings, f: number): Flight[] {
  const BUCKET = (3 * Math.PI) / 180;
  const buckets = new Map<number, { v: number; u0: number; u1: number; len: number }[]>();
  const nb = Math.round(Math.PI / BUCKET);
  for (const g of groups) {
    if ((settings.roles[g.id] ?? g.guess) === 'ignore') continue;
    const s = g.segs;
    for (let i = 0; i < s.length; i += 4) {
      const x1 = s[i] * f, y1 = s[i + 1] * f, x2 = s[i + 2] * f, y2 = s[i + 3] * f;
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 0.6 || len > 3.5) continue;
      let th = Math.atan2(y2 - y1, x2 - x1);
      if (th < 0) th += Math.PI;
      const b = Math.round(th / BUCKET) % nb;
      const t = b * BUCKET, ux = Math.cos(t), uy = Math.sin(t);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const p1 = x1 * ux + y1 * uy, p2 = x2 * ux + y2 * uy;
      let list = buckets.get(b);
      if (!list) buckets.set(b, (list = []));
      list.push({ v: -mx * uy + my * ux, u0: Math.min(p1, p2), u1: Math.max(p1, p2), len });
    }
  }
  const flights: Flight[] = [];
  for (const [b, list] of buckets) {
    if (list.length < 6) continue;
    const t = b * BUCKET, ux = Math.cos(t), uy = Math.sin(t);
    list.sort((a, c) => a.v - c.v);
    const used = new Uint8Array(list.length);
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      const chain = [i];
      let last = i, step = 0;
      for (;;) {
        const L = list[last];
        let pick = -1;
        for (let j = last + 1; j < list.length && list[j].v - L.v <= 0.36; j++) {
          const C = list[j], dv = C.v - L.v;
          if (used[j] || dv < 0.2) continue;
          if (step && Math.abs(dv - step) > step * 0.2) continue;
          const overlap = Math.min(L.u1, C.u1) - Math.max(L.u0, C.u0);
          if (overlap < 0.7 * Math.min(L.len, C.len) || Math.min(L.len, C.len) < 0.75 * Math.max(L.len, C.len)) continue;
          pick = j;
          break;
        }
        if (pick < 0) break;
        if (!step) step = list[pick].v - L.v;
        chain.push(pick);
        last = pick;
      }
      // 6 marches au moins ; au-delà de 25 marches régulières, c'est un motif (hachure, carrelage).
      if (chain.length < 6 || chain.length > 25) continue;
      const segs = chain.map((k) => list[k]);
      // Marches de même longueur : des hachures dans un cadre ont des longueurs qui varient.
      const lens = segs.map((x) => x.len);
      if (Math.min(...lens) < 0.8 * Math.max(...lens)) continue;
      for (const k of chain) used[k] = 1;
      const u0 = Math.max(...segs.map((x) => x.u0)), u1 = Math.min(...segs.map((x) => x.u1));
      const v0 = segs[0].v, v1 = segs[segs.length - 1].v;
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      const cx = um * ux - vm * uy, cy = um * uy + vm * ux;
      const corners = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]].map(([u, v]) => [u * ux - v * uy, u * uy + v * ux]);
      flights.push({
        cx, cy, ux, uy, len: u1 - u0, run: v1 - v0, steps: chain.length,
        minX: Math.min(...corners.map((c) => c[0])), maxX: Math.max(...corners.map((c) => c[0])),
        minY: Math.min(...corners.map((c) => c[1])), maxY: Math.max(...corners.map((c) => c[1])),
      });
    }
  }
  // Un quadrillage (dallage, caillebotis, tableau) a aussi des traits parallèles réguliers,
  // mais coupés par autant de traits perpendiculaires ; un escalier n'en a que quelques-uns
  // (limon central, flèche de montée).
  // Les escaliers suivent l'orientation des murs du bâtiment ; des hachures à 45° (cartouche,
  // zones colorées) non. Orientation dominante des murs, à 90° près, pondérée par la longueur.
  const wallAxis = dominantAxis(groups, settings);
  return flights.filter((fl) => {
    if (wallAxis !== null) {
      const a = Math.atan2(fl.uy, fl.ux);
      const diff = Math.abs(((a - wallAxis) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2));
      if (Math.min(diff, Math.PI / 2 - diff) > (10 * Math.PI) / 180) return false;
    }
    return crossings(groups, settings, f, fl) <= Math.max(3, fl.steps * 0.4);
  });
}

function dominantAxis(groups: Group[], settings: PlanSettings): number | null {
  const bins = new Float64Array(90);
  let total = 0;
  for (const g of groups) {
    if ((settings.roles[g.id] ?? g.guess) !== 'mur') continue;
    const s = g.segs;
    for (let i = 0; i < s.length; i += 4) {
      const dx = s[i + 2] - s[i], dy = s[i + 3] - s[i + 1], len = Math.hypot(dx, dy);
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      deg = ((deg % 90) + 90) % 90;
      bins[Math.floor(deg) % 90] += len;
      total += len;
    }
  }
  if (!total) return null;
  let best = 0;
  for (let i = 1; i < 90; i++) if (bins[i] > bins[best]) best = i;
  return ((best + 0.5) * Math.PI) / 180;
}

function crossings(groups: Group[], settings: PlanSettings, f: number, fl: Flight): number {
  // Rectangle de la volée resserré de 15 % : les murs qui la bordent ne comptent pas.
  const hu = fl.len * 0.35, hv = fl.run * 0.35;
  let n = 0;
  for (const g of groups) {
    if ((settings.roles[g.id] ?? g.guess) === 'ignore') continue;
    const s = g.segs;
    for (let i = 0; i < s.length; i += 4) {
      const mx = (s[i] + s[i + 2]) / 2 * f, my = (s[i + 1] + s[i + 3]) / 2 * f;
      if (mx < fl.minX || mx > fl.maxX || my < fl.minY || my > fl.maxY) continue;
      const du = (mx - fl.cx) * fl.ux + (my - fl.cy) * fl.uy, dv = -(mx - fl.cx) * fl.uy + (my - fl.cy) * fl.ux;
      if (Math.abs(du) > hu || Math.abs(dv) > hv) continue;
      const dx = s[i + 2] - s[i], dy = s[i + 3] - s[i + 1], len = Math.hypot(dx, dy);
      if (!len || len * f < 0.05) continue;
      // Perpendiculaire à la marche (à 10° près).
      if (Math.abs((dx * fl.ux + dy * fl.uy) / len) < 0.17) n++;
    }
  }
  return n;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const LIFT_WORDS: [RegExp, string][] = [
  [/^(ASC|ASCENSEURS?|ELEVATEUR|LIFT|ELEVATOR)( |$)/, 'Ascenseur'],
  [/^(MC|MONTE CHARGES?)( |$)/, 'Monte-charge'],
  [/^(MM|MONTE MALADES?|MONTE LITS?)( |$)/, 'Monte-malade'],
];
const STAIR_WORDS = /^(ESC|ESCALIERS?|STAIRS?|CAGE D ESCALIER)( |$)/;
/** Passages verticaux des câbles : « VTP CFA/SSI », « GT-3 », « Gaine technique », « Colonne C4 »… */
const RISER_WORDS = /^(VTP|GAINES? TECHNIQUES?|GAINE|GT ?\d+[A-Z]?|COLONNES? MONTANTES?|COLONNE ?[A-Z]?\d+|CM ?\d+|TREMIE|SHUNT)( |$)/;
/** « Gaine tête de lit » (GTL d'hôpital) : goulotte au chevet, pas un passage vertical. */
const NOT_RISER = /TETE DE LIT|^GTL\b/;

/**
 * Remplace les escaliers et ascenseurs repérés précédemment par un nouveau repérage.
 * `f` : mètres par unité du dessin.
 */
export function withLandmarks(list: Equipment[], groups: Group[], settings: PlanSettings, f: number): { list: Equipment[]; stairs: number; lifts: number; risers: number } {
  const kept = list.filter((e) => !isDetectedLandmark(e));
  const texts = kept.filter((e) => e.label.length <= 30);
  const out: Equipment[] = [];

  // Escaliers : volées regroupées (à moins de 2 m l'une de l'autre : les deux volées d'un
  // escalier tournant sont séparées par le jour central).
  const flights = findStairFlights(groups, settings, f);
  const parent = flights.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const M = 2;
  for (let i = 0; i < flights.length; i++) for (let j = i + 1; j < flights.length; j++) {
    const a = flights[i], b = flights[j];
    if (a.minX - M <= b.maxX && b.minX - M <= a.maxX && a.minY - M <= b.maxY && b.minY - M <= a.maxY) parent[find(i)] = find(j);
  }
  const stairs = new Map<number, Flight[]>();
  flights.forEach((fl, i) => { const r = find(i); stairs.set(r, [...(stairs.get(r) ?? []), fl]); });
  const stairList = [...stairs.values()].map((fls) => {
    const main = fls.reduce((a, b) => (a.steps * a.len >= b.steps * b.len ? a : b));
    // Emprise dans l'axe de la volée principale.
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const fl of fls) for (const [x, y] of [[fl.minX, fl.minY], [fl.maxX, fl.minY], [fl.minX, fl.maxY], [fl.maxX, fl.maxY]]) {
      const u = x * main.ux + y * main.uy, v = -x * main.uy + y * main.ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
    return { x: um * main.ux - vm * main.uy, y: um * main.uy + vm * main.ux, w: u1 - u0, d: v1 - v0, angle: Math.atan2(main.uy, main.ux), steps: fls.reduce((n, x) => n + x.steps, 0), flights: fls.length };
  }).sort((a, b) => b.y - a.y || a.x - b.x);
  stairList.forEach((s, i) => {
    // Un texte « Escalier B » posé dans la cage lui donne son nom.
    const named = texts.find((t) => STAIR_WORDS.test(norm(t.label)) && Math.hypot(t.x * f - s.x, t.y * f - s.y) < Math.max(s.w, s.d) / 2 + 1);
    out.push({
      id: `auto-esc-${i + 1}`, kind: 'bloc', category: 'escalier',
      label: named ? named.label : `Escalier ${i + 1}`, type: 'Escalier', layer: '',
      x: s.x / f, y: s.y / f, footprint: { w: s.w / f, d: s.d / f, angle: s.angle },
      attributes: { [DETECTION]: 'automatique (marches)', Marches: String(s.steps), ...(s.flights > 1 ? { Volées: String(s.flights) } : {}) },
    });
  });

  // Ascenseurs : textes de cabine, un seul repère par cabine.
  const lifts: { x: number; y: number; kind: string; text: string }[] = [];
  for (const t of texts) {
    const n = norm(t.label);
    const hit = LIFT_WORDS.find(([re]) => re.test(n));
    if (!hit) continue;
    const x = t.x * f, y = t.y * f;
    if (lifts.some((l) => Math.hypot(l.x - x, l.y - y) < 1)) continue;
    lifts.push({ x, y, kind: hit[1], text: t.label });
  }
  lifts.sort((a, b) => b.y - a.y || a.x - b.x);
  const count = new Map<string, number>();
  for (const l of lifts) {
    const n = (count.get(l.kind) ?? 0) + 1;
    count.set(l.kind, n);
    out.push({
      id: `auto-asc-${out.length + 1}`, kind: 'bloc', category: 'ascenseur',
      label: `${l.kind} ${n}`, type: l.kind, layer: '',
      x: l.x / f, y: l.y / f, footprint: { w: 1.8 / f, d: 1.8 / f, angle: 0 },
      attributes: { [DETECTION]: `automatique (texte « ${l.text} »)` },
    });
  }
  // Gaines et colonnes montantes : textes, un repère par gaine (textes voisins fusionnés).
  const risers: { x: number; y: number; text: string }[] = [];
  for (const t of texts) {
    if (!RISER_WORDS.test(norm(t.label)) || NOT_RISER.test(norm(t.label))) continue;
    const x = t.x * f, y = t.y * f;
    if (risers.some((r) => Math.hypot(r.x - x, r.y - y) < 1.5)) continue;
    risers.push({ x, y, text: t.label });
  }
  risers.sort((a, b) => b.y - a.y || a.x - b.x);
  risers.forEach((r, i) => {
    out.push({
      id: `auto-gt-${i + 1}`, kind: 'bloc', category: 'gaine',
      label: r.text.replace(/\s+/g, ' ').trim(), type: 'Gaine / colonne montante', layer: '',
      x: r.x / f, y: r.y / f, footprint: { w: 1.2 / f, d: 1.2 / f, angle: 0 },
      attributes: { [DETECTION]: `automatique (texte « ${r.text} »)` },
    });
  });
  return { list: [...kept, ...out], stairs: stairList.length, lifts: lifts.length, risers: risers.length };
}
