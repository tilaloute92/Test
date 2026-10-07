import * as api from '../api';
import { drawingFactor, readDrawing, roleOf } from './drawing';
import { floorFootprint, type Footprint } from './footprints';
import { segBounds } from './geometry';
import type { FloorInput } from './route';
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
    const passages = plan.equipment.filter((e) => e.passage).map((e) => ({ key: passageKey(e.passage!), label: e.passage!, ...toM(e, factor) }));
    const floor: LoadedFloor = {
      planId: plan.id, name: [plan.floor || plan.name, plan.floor ? plan.name : ''].filter(Boolean).join(' — '),
      elevation, footprint, passages, bounds, ink, plan, drawing, factor, level, floorHeight, offset: [0, 0],
    };
    floors.push(floor);
    prev = floor;
  }
  alignFloors(floors);
  return floors;
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
    placed.push(f);
  }
}
