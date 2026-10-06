import type { Equipment } from './types';

/** Distance maximale entre une indication et l'équipement qu'elle désigne, en mètres réels. */
export const INDICATION_RADIUS_M = 1.5;
const MAX_PER_EQUIPMENT = 12;

const key = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Rattache chaque indication du plan (texte, étiquette à flèche, commentaire PDF, texte lu
 * par OCR) au bloc d'équipement le plus proche, dans un rayon donné (en unités du dessin).
 *
 * L'indication reste aussi une entrée à part entière ; le rattachement permet en plus de
 * trouver l'équipement lui-même en cherchant ce qui est écrit à côté de lui : « Cisco 9300 »
 * écrit près d'un bloc SWITCH sans attributs fait ressortir ce switch. Recalcule tout à
 * chaque appel (les anciens rattachements sont effacés).
 */
export function attachIndications(list: Equipment[], radius: number): Equipment[] {
  const blocks = list.filter((e) => e.kind === 'bloc' || e.kind === 'manuel');
  const found = new Map<string, string[]>();
  if (blocks.length && radius > 0) {
    // Grille spatiale : chaque indication ne regarde que les blocs des cases voisines.
    const grid = new Map<string, Equipment[]>();
    const cell = (x: number, y: number) => `${Math.floor(x / radius)}:${Math.floor(y / radius)}`;
    for (const b of blocks) {
      const k = cell(b.x, b.y);
      const g = grid.get(k);
      if (g) g.push(b); else grid.set(k, [b]);
    }
    for (const t of list) {
      if (t.kind !== 'texte') continue;
      const cx = Math.floor(t.x / radius), cy = Math.floor(t.y / radius);
      let best: Equipment | null = null, bestD = radius;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const b of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const d = Math.hypot(b.x - t.x, b.y - t.y);
          if (d <= bestD) { best = b; bestD = d; }
        }
      }
      if (!best) continue;
      // Inutile de répéter ce que l'équipement porte déjà comme repère.
      if (key(t.label) === key(best.label)) continue;
      const arr = found.get(best.id) ?? [];
      if (arr.length < MAX_PER_EQUIPMENT && !arr.some((a) => key(a) === key(t.label))) arr.push(t.label);
      found.set(best.id, arr);
    }
  }
  return list.map((e) => {
    if (e.kind === 'texte') return e;
    const { indications: _old, ...rest } = e;
    const ind = found.get(e.id);
    return ind?.length ? { ...rest, indications: ind } : rest;
  });
}

/**
 * Ajoute des indications lues par OCR en écartant celles qui doublonnent un texte déjà
 * présent au même endroit (PDF qui contient à la fois du texte et sa version dessinée).
 */
export function mergeOcr(list: Equipment[], ocr: Equipment[], tolerance: number): Equipment[] {
  const texts = list.filter((e) => e.kind === 'texte');
  const fresh = ocr.filter((o) => !texts.some((t) => key(t.label) === key(o.label) && Math.hypot(t.x - o.x, t.y - o.y) < tolerance));
  return [...list, ...fresh];
}
