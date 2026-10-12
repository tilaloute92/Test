import fs from 'node:fs';
import crypto from 'node:crypto';
import { dataPath, readJsonStrict, writeFileAtomic } from './dataStore.js';

/**
 * Journal des modifications d'un plan : data/plans/<id>/journal.json.
 *
 * Une entrée par enregistrement : équipements ajoutés, modifiés, supprimés, fiche ou réglages
 * modifiés, réanalyse. Les équipements supprimés sont conservés dans l'entrée (50 au plus)
 * pour pouvoir être restaurés. Le journal est borné aux 500 dernières entrées ; il suit le
 * plan dans la corbeille.
 */
const MAX_ENTRIES = 500;
const MAX_KEPT = 50;
/** Au-delà, la modification est une relecture du plan, résumée en une ligne. */
const BULK = 25;
const FIELDS = ['label', 'type', 'category', 'notes', 'passage', 'x', 'y'];

const file = (planId) => dataPath('plans', planId, 'journal.json');

export function readJournal(planId) {
  const p = file(planId);
  if (!fs.existsSync(p)) return [];
  const j = readJsonStrict(p);
  return Array.isArray(j) ? j : [];
}

function append(planId, entry) {
  const list = readJournal(planId);
  list.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry });
  writeFileAtomic(file(planId), JSON.stringify(list.slice(0, MAX_ENTRIES)));
}

const name = (e) => e.label || e.type || 'équipement';

/** Compare deux versions d'un plan et inscrit ce qui a changé. */
export function logChanges(before, after, user) {
  const entry = { user, changes: [] };
  if (!before) {
    entry.action = 'création';
    entry.summary = `Plan ajouté (${after.equipment.length.toLocaleString('fr-FR')} éléments)`;
    append(after.id, entry);
    return;
  }
  const meta = ['name', 'site', 'building', 'floor', 'notes', 'level', 'floorHeight'].filter((k) => (before[k] ?? '') !== (after[k] ?? ''));
  const settings = JSON.stringify(before.settings) !== JSON.stringify(after.settings);
  const old = new Map(before.equipment.map((e) => [e.id, e]));
  const now = new Map(after.equipment.map((e) => [e.id, e]));
  const added = after.equipment.filter((e) => !old.has(e.id));
  const removed = before.equipment.filter((e) => !now.has(e.id));
  const modified = after.equipment.filter((e) => {
    const o = old.get(e.id);
    return o && FIELDS.some((f) => JSON.stringify(o[f] ?? null) !== JSON.stringify(e[f] ?? null));
  });
  if (!meta.length && !settings && !added.length && !removed.length && !modified.length) return;

  if (added.length + removed.length + modified.length > BULK) {
    entry.action = 'relecture';
    entry.summary = `Plan relu : ${after.equipment.length.toLocaleString('fr-FR')} éléments (${added.length} nouveaux, ${removed.length} retirés)`;
  } else {
    for (const e of added) entry.changes.push({ type: 'ajout', id: e.id, label: name(e) });
    for (const e of modified) {
      const o = old.get(e.id);
      const fields = FIELDS.filter((f) => JSON.stringify(o[f] ?? null) !== JSON.stringify(e[f] ?? null));
      const what = fields.includes('x') || fields.includes('y') ? [...fields.filter((f) => f !== 'x' && f !== 'y'), 'position'] : fields;
      entry.changes.push({ type: 'modification', id: e.id, label: name(e), fields: [...new Set(what)] });
    }
    for (const e of removed) entry.changes.push({ type: 'suppression', id: e.id, label: name(e) });
    entry.removed = removed.slice(0, MAX_KEPT);
  }
  if (meta.length) entry.meta = meta;
  if (settings) entry.settings = true;
  append(after.id, entry);
}

/** Équipement supprimé conservé dans une entrée du journal. */
export function removedItem(planId, entryId, itemId) {
  const entry = readJournal(planId).find((e) => e.id === entryId);
  return entry?.removed?.find((e) => e.id === itemId) ?? null;
}
