import crypto from 'node:crypto';
import { readJson, writeJson, bumpDataVersion } from './dataStore.js';

/**
 * Tracés enregistrés (data/routes.json), partagés par toute l'équipe.
 *
 * Le tracé lui-même n'est pas stocké : seulement ses extrémités, ses options et le résultat
 * obtenu (longueurs, étages), avec la version de chaque plan utilisé. Si un plan a changé
 * depuis, l'application le signale et propose de recalculer.
 */
const FILE = 'routes.json';
const MAX_ROUTES = 5000;
const MAX_TARGETS = 50;
const HEIGHTS = ['plafond', 'sol'];
const KINDS = ['manuel', 'gaine', 'escalier', 'ascenseur'];

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : d);
const ID_RE = /^[0-9a-f-]{36}$/;

function cleanEnd(e) {
  if (!e || typeof e !== 'object' || !ID_RE.test(e.planId)) return null;
  const eqId = str(e.eqId, 40);
  if (!eqId) return null;
  return { planId: e.planId, eqId, label: str(e.label, 200), floor: str(e.floor, 20) };
}

export function cleanRoute(input, previous) {
  const src = input && typeof input === 'object' ? input : {};
  const from = cleanEnd(src.from);
  const targets = (Array.isArray(src.targets) ? src.targets : []).slice(0, MAX_TARGETS).map((t) => {
    const end = cleanEnd(t);
    return end && { ...end, length: num(t.length), horizontal: num(t.horizontal), vertical: num(t.vertical), descents: num(t.descents) };
  }).filter(Boolean);
  if (!from || !targets.length) return null;
  const o = src.options && typeof src.options === 'object' ? src.options : {};
  const planVersions = {};
  if (src.planVersions && typeof src.planVersions === 'object') {
    for (const [k, v] of Object.entries(src.planVersions).slice(0, 200)) if (ID_RE.test(k) && Number.isInteger(v)) planVersions[k] = v;
  }
  return {
    name: str(src.name, 160) || previous?.name || `${from.label} → ${targets[0].label}`,
    ref: str(src.ref, 80),
    from,
    targets,
    options: {
      height: HEIGHTS.includes(o.height) ? o.height : 'plafond',
      margin: Math.min(100, Math.max(0, num(o.margin, 15))),
      orthogonal: o.orthogonal !== false,
      allowWalls: o.allowWalls === true,
      kinds: (Array.isArray(o.kinds) ? o.kinds : ['ascenseur']).filter((k) => KINDS.includes(k)),
    },
    floors: (Array.isArray(src.floors) ? src.floors : []).slice(0, 60).map((f) => str(String(f), 20)).filter(Boolean),
    total: num(src.total),
    planVersions,
  };
}

const load = () => {
  const list = readJson(FILE, []);
  return Array.isArray(list) ? list : [];
};

export const listRoutes = () => load().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
export const getRoute = (id) => load().find((r) => r.id === id) || null;

export function createRoute(input, user, ownerId) {
  const clean = cleanRoute(input);
  if (!clean) return null;
  const list = load();
  if (list.length >= MAX_ROUTES) list.sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || '')).shift();
  const now = new Date().toISOString();
  const route = { id: crypto.randomUUID(), ...clean, ownerId: String(ownerId || ''), createdAt: now, createdBy: user, updatedAt: now, updatedBy: user };
  list.push(route);
  writeJson(FILE, list);
  bumpDataVersion();
  return route;
}

export function updateRoute(id, input, user) {
  const list = load();
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const clean = cleanRoute({ ...list[i], ...input }, list[i]);
  if (!clean) return undefined;
  list[i] = { ...list[i], ...clean, updatedAt: new Date().toISOString(), updatedBy: user };
  writeJson(FILE, list);
  bumpDataVersion();
  return list[i];
}

export function deleteRoute(id) {
  const list = load();
  const next = list.filter((r) => r.id !== id);
  if (next.length === list.length) return false;
  writeJson(FILE, next);
  bumpDataVersion();
  return true;
}
