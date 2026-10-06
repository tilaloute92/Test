import { allPlans } from './plansStore.js';

/**
 * Recherche d'équipements dans toute la bibliothèque.
 *
 * Insensible à la casse et aux accents ; tous les mots saisis doivent apparaître, dans
 * n'importe quel champ (repère, type de bloc, calque, attributs, notes) ou dans la fiche
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

const cache = new Map(); // planId -> { version, planHay, items: [{ e, hay, label }] }

function indexFor(plan) {
  const hit = cache.get(plan.id);
  if (hit && hit.version === plan.version) return hit;
  const items = plan.equipment.map((e) => {
    const attrs = e.attributes ? Object.entries(e.attributes).flat().join(' ') : '';
    return { e, label: normalize(e.label), hay: normalize([e.label, e.type, e.layer, attrs, e.notes].join(' ')) };
  });
  const entry = { version: plan.version, planHay: normalize([plan.name, plan.site, plan.building, plan.floor].join(' ')), items };
  cache.set(plan.id, entry);
  return entry;
}

export function search({ q, site, kind, planId, limit = 200 }) {
  const terms = normalize(q).split(' ').filter(Boolean);
  if (!terms.length) return { total: 0, results: [] };
  const siteN = normalize(site);
  const results = [];
  let total = 0;
  for (const plan of allPlans()) {
    if (planId && plan.id !== planId) continue;
    if (siteN && normalize(plan.site) !== siteN) continue;
    const idx = indexFor(plan);
    for (const it of idx.items) {
      if (kind && it.e.kind !== kind) continue;
      // Un mot peut se trouver soit dans l'équipement, soit dans la fiche du plan, mais au
      // moins un mot doit viser l'équipement : sinon tous les textes d'un plan sortiraient
      // dès qu'on tape son nom.
      let inItem = false, ok = true;
      for (const t of terms) {
        if (it.hay.includes(t)) inItem = true;
        else if (!idx.planHay.includes(t)) { ok = false; break; }
      }
      if (!ok || !inItem) continue;
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
