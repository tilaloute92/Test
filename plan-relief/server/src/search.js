import { allPlans } from './plansStore.js';
import { CATEGORIES } from './categories.js';

/**
 * Recherche d'équipements dans toute la bibliothèque.
 *
 * Insensible à la casse et aux accents ; tous les mots saisis doivent apparaître, dans
 * n'importe quel champ (repère, type de bloc, calque, attributs, notes, indications écrites
 * à côté de l'équipement) ou dans la fiche
 * du plan (nom, site, bâtiment, étage). Ainsi « switch bat B » trouve les switchs du
 * bâtiment B même si « bâtiment B » n'est écrit que sur la fiche du plan.
 *
 * L'index normalisé de chaque plan est gardé en cache et recalculé seulement quand le plan
 * change de version.
 */

export const normalize = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // « SW-B-01 », « sw b 01 » et « swb01 » doivent se trouver l'un l'autre ; « Wi-Fi » et « wifi » aussi.
    .replace(/[-_./\\#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Le bâtiment répond aussi à « bât » et « bâtiment » : « switch bât B » trouve les switchs
// d'un plan dont la fiche indique seulement « B » comme bâtiment.
const cache = new Map(); // planId -> { version, planHay, items: [{ e, hay, label }] }

function indexFor(plan) {
  const hit = cache.get(plan.id);
  if (hit && hit.version === plan.version) return hit;
  const items = plan.equipment.map((e) => {
    const attrs = e.attributes ? Object.entries(e.attributes).flat().join(' ') : '';
    // Les indications écrites à côté d'un équipement comptent comme les siennes.
    const ind = e.indications ? e.indications.join(' ') : '';
    const cat = e.category ? `${CATEGORIES[e.category]?.label ?? ''} ${CATEGORIES[e.category]?.words ?? ''}` : '';
    const hay = normalize([e.label, e.type, e.layer, attrs, e.notes, ind, e.passage ? `passage ${e.passage}` : '', cat].join(' '));
    // Version sans espaces ajoutée : l'OCR coupe parfois un repère (« CAM-0 7 ») et doit
    // quand même répondre à « CAM-07 ».
    return { e, label: normalize(e.label), hay: `${hay} ${hay.replace(/ /g, '')}` };
  });
  const entry = { version: plan.version, planHay: normalize([plan.name, plan.site, plan.building ? `bat batiment ${plan.building}` : '', plan.floor].join(' ')), items };
  cache.set(plan.id, entry);
  return entry;
}

export function search({ q, site, kind, category, planId, limit = 200 }) {
  const terms = normalize(q).split(' ').filter(Boolean);
  // Sans mots, une catégorie suffit : « toutes les bornes Wi-Fi du site ».
  if (!terms.length && !category) return { total: 0, results: [] };
  const siteN = normalize(site);
  const results = [];
  let total = 0;
  for (const plan of allPlans()) {
    if (planId && plan.id !== planId) continue;
    if (siteN && normalize(plan.site) !== siteN) continue;
    const idx = indexFor(plan);
    for (const it of idx.items) {
      if (kind && it.e.kind !== kind) continue;
      if (category && it.e.category !== category) continue;
      // Un mot peut se trouver soit dans l'équipement, soit dans la fiche du plan, mais au
      // moins un mot doit viser l'équipement : sinon tous les textes d'un plan sortiraient
      // dès qu'on tape son nom.
      let inItem = false, ok = true;
      for (const t of terms) {
        if (it.hay.includes(t)) inItem = true;
        else if (!idx.planHay.includes(t)) { ok = false; break; }
      }
      if (!ok || (terms.length && !inItem)) continue;
      total++;
      const q0 = terms.join(' ');
      const score = it.label === q0 ? 0 : it.label.startsWith(q0) ? 1 : it.label.includes(q0) ? 2 : 3;
      results.push({
        score,
        planId: plan.id,
        planName: plan.name,
        site: plan.site,
        building: plan.building,
        floor: plan.floor,
        equipment: it.e,
      });
    }
  }
  results.sort((a, b) => a.score - b.score || a.equipment.label.localeCompare(b.equipment.label, 'fr', { numeric: true }));
  return { total, results: results.slice(0, limit).map(({ score: _s, ...r }) => r) };
}
