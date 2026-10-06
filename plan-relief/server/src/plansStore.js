import fs from 'node:fs';
import crypto from 'node:crypto';
import { dataPath, readJsonStrict, writeFileAtomic, bumpDataVersion } from './dataStore.js';

/**
 * Bibliothèque de plans.
 *
 *   data/plans/<id>/plan.json     métadonnées, réglages 3D et équipements
 *   data/plans/<id>/source.<ext>  fichier d'origine (DXF ou PDF), jamais modifié
 *   data/corbeille/<id>_<date>/   plans supprimés depuis l'application (récupérables)
 *
 * L'identifiant est généré par le serveur (UUID) : aucun nom de fichier fourni par
 * l'utilisateur n'entre dans un chemin sur le disque.
 *
 * Toute la bibliothèque est chargée en mémoire au démarrage, en lecture stricte : un
 * plan.json illisible empêche le service de démarrer (voir dataStore.js). Les fichiers
 * d'origine, eux, ne sont lus qu'à la demande.
 */

export const FORMATS = ['dxf', 'pdf'];
export const KINDS = ['bloc', 'texte', 'manuel'];
const ROLES = ['mur', 'fenetre', 'porte', 'plan', 'ignore'];
const UNITS = ['mm', 'cm', 'm', 'in', 'ft'];

const plans = new Map();

const ID_RE = /^[0-9a-f-]{36}$/;
export const isPlanId = (id) => typeof id === 'string' && ID_RE.test(id);

export function loadPlans() {
  plans.clear();
  const root = dataPath('plans');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isPlanId(entry.name)) continue;
    const file = dataPath('plans', entry.name, 'plan.json');
    // Dossier sans plan.json : import interrompu avant la fin (le fichier d'origine est
    // écrit en premier). Il ne contient rien d'exploitable, on l'ignore sans bloquer.
    if (!fs.existsSync(file)) continue;
    const plan = readJsonStrict(file);
    plans.set(plan.id, plan);
  }
  return plans.size;
}

// ---------------------------------------------------------------------------------------
// Nettoyage des données reçues du navigateur : on ne fait jamais confiance à leur forme.
// ---------------------------------------------------------------------------------------
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, d, min = -Infinity, max = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

export function cleanMeta(input, previous = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const pick = (key, max) => (key in src ? str(src[key], max) : previous[key] ?? '');
  return {
    name: pick('name', 120),
    site: pick('site', 120),
    building: pick('building', 120),
    floor: pick('floor', 60),
    notes: pick('notes', 2000),
  };
}

export function cleanSettings(input) {
  const s = input && typeof input === 'object' ? input : {};
  const roles = {};
  if (s.roles && typeof s.roles === 'object') {
    for (const [k, v] of Object.entries(s.roles).slice(0, 5000)) {
      if (ROLES.includes(v)) roles[String(k).slice(0, 200)] = v;
    }
  }
  return {
    unit: UNITS.includes(s.unit) ? s.unit : 'm',
    pdfScale: num(s.pdfScale, 100, 1, 100000),
    pdfPage: Math.round(num(s.pdfPage, 1, 1, 10000)),
    hWall: num(s.hWall, 2.5, 0.1, 100),
    tWall: num(s.tWall, 0.2, 0.01, 5),
    tMax: num(s.tMax, 0.6, 0.05, 5),
    sill: num(s.sill, 0.9, 0, 50),
    hWin: num(s.hWin, 1.25, 0.05, 50),
    slab: s.slab !== false,
    roles,
  };
}

export function cleanEquipment(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list.slice(0, 200000)) {
    if (!raw || typeof raw !== 'object') continue;
    const x = Number(raw.x), y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    let id = str(raw.id, 40) || crypto.randomUUID();
    if (seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    const attributes = {};
    if (raw.attributes && typeof raw.attributes === 'object') {
      for (const [k, v] of Object.entries(raw.attributes).slice(0, 40)) {
        const key = String(k).slice(0, 60);
        const val = str(String(v ?? ''), 200);
        if (key && val) attributes[key] = val;
      }
    }
    const item = {
      id,
      kind: KINDS.includes(raw.kind) ? raw.kind : 'manuel',
      label: str(raw.label, 200),
      type: str(raw.type, 120),
      layer: str(raw.layer, 120),
      x,
      y,
    };
    if (Object.keys(attributes).length) item.attributes = attributes;
    const notes = str(raw.notes, 2000);
    if (notes) item.notes = notes;
    if (!item.label && !item.type) continue;
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------
export function summary(plan) {
  const counts = { bloc: 0, texte: 0, manuel: 0 };
  for (const e of plan.equipment) counts[e.kind] = (counts[e.kind] || 0) + 1;
  const { equipment: _e, settings: _s, ...rest } = plan;
  return { ...rest, equipmentCount: plan.equipment.length, counts };
}

export const listPlans = () => [...plans.values()].map(summary).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
export const getPlan = (id) => plans.get(id) || null;
export const allPlans = () => plans.values();

export function sourcePath(plan) {
  return dataPath('plans', plan.id, `source.${plan.file.format}`);
}

// ---------------------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------------------
function persist(plan) {
  writeFileAtomic(dataPath('plans', plan.id, 'plan.json'), JSON.stringify(plan));
  plans.set(plan.id, plan);
  bumpDataVersion();
}

export function detectFormat(buffer, fileName) {
  const head = buffer.subarray(0, 4096).toString('latin1');
  if (head.startsWith('%PDF-')) return { format: 'pdf' };
  if (/^AC10\d\d/.test(head)) {
    return { error: 'Les fichiers DWG ne peuvent pas être lus directement. Enregistrez-les au format DXF depuis AutoCAD, ou convertissez-les avec ODA File Converter.' };
  }
  if (head.startsWith('AutoCAD Binary DXF')) {
    return { error: 'Ce DXF est enregistré en binaire. Enregistrez-le en DXF ASCII (texte) depuis AutoCAD.' };
  }
  if (/\.dxf$/i.test(fileName) && /\bSECTION\b/.test(head) && !head.includes('\0')) return { format: 'dxf' };
  return { error: 'Format non reconnu. Importez un fichier DXF (ASCII) ou PDF.' };
}

export function createPlan({ buffer, fileName, meta, settings, equipment, user }) {
  const det = detectFormat(buffer, fileName);
  if (det.error) {
    const err = new Error(det.error);
    err.status = 415;
    throw err;
  }
  const id = crypto.randomUUID();
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const duplicateOf = [...plans.values()].find((p) => p.file.sha256 === sha256);
  const now = new Date().toISOString();
  const cleanName = cleanMeta(meta);
  const plan = {
    id,
    ...cleanName,
    name: cleanName.name || str(fileName.replace(/\.[^.]+$/, ''), 120) || 'Plan sans nom',
    file: { name: str(fileName, 200), format: det.format, size: buffer.length, sha256 },
    settings: cleanSettings(settings),
    equipment: cleanEquipment(equipment),
    createdAt: now,
    createdBy: user,
    updatedAt: now,
    updatedBy: user,
    version: 1,
  };
  // Le fichier d'origine d'abord : si le service s'arrête entre les deux écritures, il
  // reste un dossier sans plan.json, ignoré au démarrage, plutôt qu'un plan sans fichier.
  writeFileAtomic(sourcePath(plan), buffer);
  persist(plan);
  return { plan, duplicateOf: duplicateOf ? { id: duplicateOf.id, name: duplicateOf.name } : null };
}

export class VersionConflict extends Error {
  constructor(plan) {
    super(`Ce plan a été modifié entre-temps par ${plan.updatedBy || 'un autre utilisateur'}. Votre modification n'a pas été enregistrée : rechargez le plan et refaites-la.`);
    this.plan = plan;
  }
}

export function updatePlan(id, patch, user) {
  const plan = plans.get(id);
  if (!plan) return null;
  if (Number(patch.version) !== plan.version) throw new VersionConflict(plan);
  const next = {
    ...plan,
    ...cleanMeta(patch, plan),
    settings: 'settings' in patch ? cleanSettings(patch.settings) : plan.settings,
    equipment: 'equipment' in patch ? cleanEquipment(patch.equipment) : plan.equipment,
    updatedAt: new Date().toISOString(),
    updatedBy: user,
    version: plan.version + 1,
  };
  if (!next.name) next.name = plan.name;
  persist(next);
  return next;
}

/** Déplace le plan dans data/corbeille : récupérable par un administrateur, jamais effacé. */
export function trashPlan(id) {
  const plan = plans.get(id);
  if (!plan) return false;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trash = dataPath('corbeille');
  fs.mkdirSync(trash, { recursive: true });
  fs.renameSync(dataPath('plans', id), dataPath('corbeille', `${id}_${stamp}`));
  plans.delete(id);
  bumpDataVersion();
  return true;
}
