import * as api from '../api';
import { drawingFactor, readDrawing, roleOf } from './drawing';
import { floorFootprint, type Footprint } from './footprints';
import { segBounds } from './geometry';
import type { FloorInput, PassageKind } from './route';
import { DEFAULT_SETTINGS, type Drawing, type Equipment, type PlanRecord, type PlanSummary } from './types';

export const DEFAULT_FLOOR_HEIGHT = 3;

const norm = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Clé d'un passage vertical : « GT-3 », « gt 3 » et « Gt3 » désignent la même gaine. */
export const passageKey = (s: string) => norm(s).toUpperCase();

/**
 * Niveau déduit du libellé d'étage : RDC → 0, R+1 / 1er / Étage 1 → 1, SS1 / R-1 / Sous-sol → -1.
 * null si rien de reconnaissable (combles, mezzanine…) : le niveau se saisit alors sur la fiche.
 */
export function guessLevel(floor: string): number | null {
  const f = (floor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!f) return null;
  if (/^(rdc|rez|r ?\+? ?0|niveau 0|n0)\b/.test(f) || f.includes('rez-de') || f.includes('rez de')) return 0;
  let m = f.match(/(?:ss|sous-sol|sous sol|r ?- ?|niveau ?-|n ?-)\s*(\d+)?/);
  if (m) return -(Number(m[1]) || 1);
  m = f.match(/r ?\+ ?(\d+)/) || f.match(/(\d+)\s*(?:er|ere|e|eme)\b/) || f.match(/(?:etage|niveau|n)\s*(\d+)/);
  if (m) return Number(m[1]);
  if (/^-?\d+$/.test(f)) return Number(f);
  return null;
}

/**
 * Nom de passage proposé pour un équipement : un repère de gaine ou de colonne (GT-3, CM2,
 * CFO-1…) dans son nom ou ses indications, sinon son nom s'il désigne une gaine, une colonne,
 * un escalier ou un ascenseur. Chaîne vide si rien ne ressemble à un passage.
 */
export function suggestPassage(e: Pick<Equipment, 'label' | 'type' | 'indications'>): string {
  const texts = [e.label, e.type, ...(e.indications ?? [])].filter(Boolean);
  for (const t of texts) {
    const m = t.match(/\b(GT|CM|CFO|CFA|CF|GTL|TR|SH)\s*-?\s*(\d+[A-Z]?)\b/i);
    if (m) return `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
  }
  for (const t of texts) {
    if (/gaine|colonne|escalier|ascenseur|monte[- ]?charge|tr[ée]mie|shunt|chemin[ée]e/i.test(t)) return t.slice(0, 60);
  }
  return '';
}

export const levelOf = (p: Pick<PlanSummary, 'level' | 'floor'>) => p.level ?? guessLevel(p.floor) ?? 0;

/** Numéro d'étage court : RDC, R+3, R-1. */
export const levelName = (level: number) => (level === 0 ? 'RDC' : level > 0 ? `R+${level}` : `R${level}`);

export interface CrossedFloor {
  level: number;
  /** Plan de cet étage, s'il est dans l'application (sinon l'étage est seulement traversé). */
  planId?: string;
  name?: string;
  /** Altitude estimée (mètres), pour placer l'étiquette dans la vue 3D. */
  elevation: number;
}

/**
 * Étages parcourus par un tracé, dans l'ordre du départ vers l'arrivée : l'étage du départ,
 * chaque étage traversé par une montée ou une descente (y compris ceux sans plan), puis
 * l'étage d'arrivée.
 */
export function floorsCrossed(
  steps: ({ type: 'leg'; leg: { planId: string } } | { type: 'rise'; rise: { fromPlan: string; toPlan: string } })[],
  floors: Pick<LoadedFloor, 'planId' | 'name' | 'level' | 'elevation' | 'floorHeight'>[],
): CrossedFloor[] {
  const byId = new Map(floors.map((f) => [f.planId, f]));
  const byLevel = new Map(floors.map((f) => [f.level, f]));
  const out: CrossedFloor[] = [];
  const push = (level: number, elevation: number) => {
    if (out.length && out[out.length - 1].level === level) return;
    const f = byLevel.get(level);
    out.push({ level, planId: f?.planId, name: f?.name, elevation: f ? f.elevation : elevation });
  };
  for (const s of steps) {
    if (s.type === 'leg') {
      const f = byId.get(s.leg.planId);
      if (f) push(f.level, f.elevation);
      continue;
    }
    const a = byId.get(s.rise.fromPlan), b = byId.get(s.rise.toPlan);
    if (!a || !b) continue;
    push(a.level, a.elevation);
    const dir = Math.sign(b.level - a.level);
    // Étages intermédiaires sans plan : altitude interpolée entre les deux étages reliés.
    for (let l = a.level + dir; dir !== 0 && l !== b.level; l += dir) {
      push(l, a.elevation + ((b.elevation - a.elevation) * (l - a.level)) / (b.level - a.level));
    }
    push(b.level, b.elevation);
  }
  return out;
}

/** Plans formant le même bâtiment que `plan` (même site et même bâtiment sur la fiche). */
export function buildingMembers(plan: Pick<PlanSummary, 'id' | 'site' | 'building'>, all: PlanSummary[]): PlanSummary[] {
  if (!norm(plan.building)) return all.filter((p) => p.id === plan.id);
  return all.filter((p) => norm(p.site) === norm(plan.site) && norm(p.building) === norm(plan.building));
}

export interface LoadedFloor extends FloorInput {
  plan: PlanRecord;
  drawing: Drawing;
  factor: number;
  level: number;
  floorHeight: number;
  /** Décalage appliqué pour superposer cet étage aux autres (mètres), d'après les passages communs. */
  offset: [number, number];
  /** Escaliers, ascenseurs et gaines de l'étage, candidats à une liaison automatique. */
  autos: AutoCandidate[];
  footprint: Footprint;
}

const cache = new Map<string, { version: number; drawing: Drawing }>();

async function loadDrawing(plan: PlanRecord): Promise<Drawing> {
  const hit = cache.get(plan.id);
  if (hit && hit.version === plan.version) return hit.drawing;
  const buf = await api.fetchPlanFile(plan.id);
  const drawing = await readDrawing(buf, plan.file.format, plan.settings.pdfPage);
  cache.set(plan.id, { version: plan.version, drawing });
  return drawing;
}

const toM = (e: Equipment, f: number) => ({ x: e.x * f, y: e.y * f });

/** Charge et prépare tous les étages d'un bâtiment, du plus bas au plus haut. */
export async function loadBuilding(members: PlanSummary[], onProgress: (t: string) => void): Promise<LoadedFloor[]> {
  const sorted = [...members].sort((a, b) => levelOf(a) - levelOf(b) || a.name.localeCompare(b.name, 'fr'));
  const floors: LoadedFloor[] = [];
  let elevation = 0, prev: LoadedFloor | null = null;
  for (const s of sorted) {
    onProgress(`Chargement — ${s.name}`);
    const plan = await api.getPlan(s.id);
    const drawing = await loadDrawing(plan);
    const settings = { ...DEFAULT_SETTINGS, ...plan.settings };
    const factor = drawingFactor(plan.file.format, settings);
    const level = levelOf(plan);
    const floorHeight = plan.floorHeight ?? DEFAULT_FLOOR_HEIGHT;
    if (prev) elevation += prev.floorHeight * Math.max(0, level - prev.level);
    const footprint = floorFootprint(drawing.groups, settings, factor, [0, 0]);
    const b = segBounds(drawing.groups.map((g) => g.segs)) ?? { minX: 0, minY: 0, maxX: 10 / factor, maxY: 10 / factor };
    const eqB = plan.equipment.length ? segBounds([plan.equipment.flatMap((e) => [e.x, e.y])])! : b;
    const bounds = {
      minX: Math.min(b.minX, eqB.minX) * factor, minY: Math.min(b.minY, eqB.minY) * factor,
      maxX: Math.max(b.maxX, eqB.maxX) * factor, maxY: Math.max(b.maxY, eqB.maxY) * factor,
    };
    // Tous les traits visibles du plan, pour reconnaître les zones où rien n'est dessiné.
    const inkList: number[] = [];
    for (const g of drawing.groups) {
      if (roleOf(g, settings) === 'ignore') continue;
      for (const v of g.segs) inkList.push(v * factor);
    }
    const ink = Float32Array.from(inkList);
    // Passages nommés à la main ; escaliers, ascenseurs et gaines (repérés ou ajoutés) sans nom
    // de passage deviennent candidats à une liaison automatique (voir linkAutoPassages).
    const passages: FloorInput['passages'] = plan.equipment.filter((e) => e.passage).map((e) => ({ key: passageKey(e.passage!), label: e.passage!, kind: 'manuel' as PassageKind, ...toM(e, factor) }));
    const autos: AutoCandidate[] = plan.equipment
      .filter((e) => !e.passage && (e.category === 'escalier' || e.category === 'ascenseur' || e.category === 'gaine'))
      .map((e) => ({ kind: e.category as AutoCandidate['kind'], label: e.label, ...toM(e, factor) }));
    const floor: LoadedFloor = {
      planId: plan.id, name: [plan.floor || plan.name, plan.floor ? plan.name : ''].filter(Boolean).join(' — '),
      elevation, footprint, passages, bounds, ink, plan, drawing, factor, level, floorHeight, offset: [0, 0], autos,
    };
    floors.push(floor);
    prev = floor;
  }
  alignFloors(floors);
  linkAutoPassages(floors);
  return floors;
}

interface AutoCandidate { kind: 'escalier' | 'ascenseur' | 'gaine'; label: string; x: number; y: number }

/** Distance maximale entre deux éléments superposés d'étages voisins pour les relier. */
const LINK_DIST = 4;

/**
 * Relie automatiquement les escaliers, ascenseurs et gaines superposés d'un étage à l'autre :
 * un élément est relié à celui de même type de l'étage voisin le plus proche (à moins de
 * 4 m, une fois les étages superposés). Une chaîne d'éléments ainsi reliés devient un
 * passage vertical, nommé d'après l'élément de l'étage le plus bas (« Escalier 3 »).
 */
function linkAutoPassages(floors: LoadedFloor[]) {
  const nodes: { f: LoadedFloor; c: AutoCandidate }[] = floors.flatMap((f) => f.autos.map((c) => ({ f, c })));
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const index = new Map(nodes.map((n, i) => [n, i]));
  for (let k = 0; k + 1 < floors.length; k++) {
    const A = floors[k], B = floors[k + 1];
    const used = new Set<AutoCandidate>();
    // Paires les plus proches d'abord, chaque élément relié au plus une fois par étage voisin.
    const pairs: { a: AutoCandidate; b: AutoCandidate; d: number }[] = [];
    for (const b of B.autos) for (const a of A.autos) {
      if (a.kind !== b.kind) continue;
      const d = Math.hypot(a.x + A.offset[0] - b.x - B.offset[0], a.y + A.offset[1] - b.y - B.offset[1]);
      if (d <= LINK_DIST) pairs.push({ a, b, d });
    }
    pairs.sort((p, q) => p.d - q.d);
    for (const { a, b } of pairs) {
      if (used.has(a) || used.has(b)) continue;
      used.add(a); used.add(b);
      const ia = index.get(nodes.find((n) => n.c === a)!)!, ib = index.get(nodes.find((n) => n.c === b)!)!;
      parent[find(ia)] = find(ib);
    }
  }
  const comps = new Map<number, { f: LoadedFloor; c: AutoCandidate }[]>();
  nodes.forEach((n, i) => { const r = find(i); comps.set(r, [...(comps.get(r) ?? []), n]); });
  let k = 0;
  for (const members of comps.values()) {
    if (new Set(members.map((m) => m.f.planId)).size < 2) continue;
    const lowest = members.reduce((a, b) => (a.f.level <= b.f.level ? a : b));
    const key = `AUTO-${++k}`;
    const label = lowest.c.label;
    for (const m of members) m.f.passages.push({ key, label, x: m.c.x, y: m.c.y, kind: m.c.kind });
  }
}

/**
 * Superpose les étages : chaque étage est décalé pour que ses passages coïncident avec ceux
 * de même nom des étages déjà placés (moyenne des écarts). Sans passage commun, les dessins
 * sont supposés partager la même origine, comme c'est l'usage en DAO.
 */
function alignFloors(floors: LoadedFloor[]) {
  const placed: LoadedFloor[] = [];
  for (const f of floors) {
    let sx = 0, sy = 0, n = 0;
    for (const p of f.passages) {
      for (const q of placed) {
        const other = q.passages.find((x) => x.key === p.key);
        if (other) { sx += other.x + q.offset[0] - p.x; sy += other.y + q.offset[1] - p.y; n++; }
      }
    }
    if (n) f.offset = [sx / n, sy / n];
    else if (placed.length) f.offset = alignByLandmarks(f, placed[placed.length - 1]);
    placed.push(f);
  }
}

/**
 * Sans passage nommé commun : recalage d'après les escaliers, ascenseurs et gaines. Parmi
 * les décalages qui superposent un élément de l'étage sur un élément de même type de
 * l'étage précédent, on retient celui qui en superpose le plus (à 1,5 m près). Sans
 * accord net (moins de 2 éléments), les dessins sont supposés de même origine.
 */
function alignByLandmarks(f: LoadedFloor, ref: LoadedFloor): [number, number] {
  const score = (dx: number, dy: number) => f.autos.filter((c) => ref.autos.some((r) => r.kind === c.kind && Math.hypot(r.x + ref.offset[0] - c.x - dx, r.y + ref.offset[1] - c.y - dy) <= 1.5)).length;
  let best: [number, number] = [0, 0], bestN = score(0, 0);
  for (const c of f.autos) for (const r of ref.autos) {
    if (r.kind !== c.kind) continue;
    const dx = r.x + ref.offset[0] - c.x, dy = r.y + ref.offset[1] - c.y;
    const n = score(dx, dy);
    if (n > bestN + (Math.hypot(dx, dy) > 0.5 ? 0 : -1)) { best = [dx, dy]; bestN = n; }
  }
  return bestN >= 2 ? best : [0, 0];
}
