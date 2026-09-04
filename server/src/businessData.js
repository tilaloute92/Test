import { readJson, writeJson } from './dataStore.js';

/**
 * Données métier partagées entre les utilisateurs connectés (mode multi-utilisateur) :
 * membres, tâches, planning, temps saisi, absences, feuille de route, COPIL. Stockage identique
 * en esprit à celui des comptes locaux (fichiers JSON dans server/data/, voir dataStore.js)
 * — adapté à une équipe de quelques personnes, pas pensé pour une forte concurrence.
 *
 * Ce module ne gère PAS les connexions API (`ApiConnection`) ni l'historique de requêtes :
 * ce sont des identifiants/secrets de test personnels à chaque utilisateur, pas une donnée
 * d'équipe à partager automatiquement. Il ne gère pas non plus `authSettings` (paramètres de
 * connexion SSO), déjà gérés séparément par ce même serveur (voir routes/auth.js) — ni
 * l'historique de versions/sauvegarde de src/lib/backup.ts, qui reste un filet de sécurité
 * local au navigateur de chacun.
 *
 * Un seul processus Node sert toute l'équipe : le cache mémoire ci-dessous est donc
 * toujours à jour sans coordination inter-processus. Voir DEPLOYMENT.md si un jour
 * plusieurs instances doivent tourner derrière un répartiteur de charge — ce n'est pas le
 * cas prévu ici.
 */

const COLLECTIONS = ['members', 'tasks', 'planningSlots', 'timeEntries', 'absences', 'roadmapItems', 'copils'];

const cache = {};
for (const name of COLLECTIONS) {
  cache[name] = readJson(`business-${name}.json`, []);
}

let idSeed = Date.now();
function nextId(prefix) {
  idSeed += 1;
  return `${prefix}${idSeed.toString(36)}`;
}

function persist(name) {
  writeJson(`business-${name}.json`, cache[name]);
}

export function getSnapshot() {
  return {
    members: cache.members,
    tasks: cache.tasks,
    planningSlots: cache.planningSlots,
    timeEntries: cache.timeEntries,
    absences: cache.absences,
    roadmapItems: cache.roadmapItems,
    copils: cache.copils,
  };
}

/** true si le serveur n'a encore aucune donnée métier — sert à proposer une première publication. */
export function isEmpty() {
  return COLLECTIONS.every((name) => cache[name].length === 0);
}

/** Remplace intégralement les collections partagées — utilisé une seule fois, pour la
 *  publication initiale des données locales de la personne qui active le mode multi-utilisateur. */
export function replaceAll(payload) {
  for (const name of COLLECTIONS) {
    if (Array.isArray(payload?.[name])) {
      cache[name] = payload[name];
      persist(name);
    }
  }
  return getSnapshot();
}

// Pour chaque création, le navigateur qui l'initie a déjà généré un identifiant local (pour
// mettre à jour son propre affichage tout de suite, sans attendre la réponse du serveur) —
// on le réutilise tel quel plutôt que d'en fabriquer un autre ici, sinon le client se
// retrouverait avec deux versions du même enregistrement (l'une locale, l'autre "officielle")
// à réconcilier. Un identifiant n'est généré côté serveur que si vraiment aucun n'est fourni.
function idOrNext(payload, prefix) {
  return payload.id || nextId(prefix);
}

// --- Membres ---
export function addMember(payload) {
  const item = { ...payload, id: idOrNext(payload, 'm') };
  cache.members.push(item);
  persist('members');
  return item;
}
export function updateMember(id, patch) {
  const idx = cache.members.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  cache.members[idx] = { ...cache.members[idx], ...patch, id };
  persist('members');
  return cache.members[idx];
}
export function removeMember(id) {
  cache.members = cache.members.filter((m) => m.id !== id);
  cache.tasks = cache.tasks.map((t) =>
    Array.isArray(t.assigneeIds) && t.assigneeIds.includes(id) ? { ...t, assigneeIds: t.assigneeIds.filter((a) => a !== id) } : t
  );
  cache.planningSlots = cache.planningSlots.filter((p) => p.memberId !== id);
  cache.roadmapItems = cache.roadmapItems.map((r) =>
    Array.isArray(r.ownerIds) && r.ownerIds.includes(id) ? { ...r, ownerIds: r.ownerIds.filter((o) => o !== id) } : r
  );
  // Un membre supprimé disparaît aussi des séances de COPIL : participants, porteurs
  // d'actions et présentateurs de points — même logique de nettoyage en cascade que
  // côté client (voir removeMember dans src/store/useStore.ts).
  cache.copils = cache.copils.map((c) => ({
    ...c,
    participantIds: Array.isArray(c.participantIds) ? c.participantIds.filter((p) => p !== id) : [],
    actions: Array.isArray(c.actions)
      ? c.actions.map((a) => ({ ...a, ownerIds: Array.isArray(a.ownerIds) ? a.ownerIds.filter((o) => o !== id) : [] }))
      : [],
    agenda: Array.isArray(c.agenda)
      ? c.agenda.map((point) => (point.presenterId === id ? { ...point, presenterId: undefined } : point))
      : [],
  }));
  persist('members');
  persist('tasks');
  persist('planningSlots');
  persist('roadmapItems');
  persist('copils');
}

// --- Tâches ---
export function addTask(payload, actor) {
  const now = new Date().toISOString();
  const item = { ...payload, id: idOrNext(payload, 't'), createdAt: payload.createdAt || now, updatedAt: now, updatedBy: actor };
  cache.tasks.push(item);
  persist('tasks');
  return item;
}
export function updateTask(id, patch, actor) {
  const idx = cache.tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const current = cache.tasks[idx];
  const next = { ...current, ...patch, id };
  if (patch.status === 'termine' && current.status !== 'termine') next.completedAt = new Date().toISOString();
  else if (patch.status && patch.status !== 'termine') next.completedAt = undefined;
  next.updatedAt = new Date().toISOString();
  next.updatedBy = actor;
  cache.tasks[idx] = next;
  persist('tasks');
  return next;
}
export function removeTask(id) {
  cache.tasks = cache.tasks.filter((t) => t.id !== id);
  cache.planningSlots = cache.planningSlots.map((p) => (p.taskId === id ? { ...p, taskId: null } : p));
  cache.roadmapItems = cache.roadmapItems.map((r) =>
    Array.isArray(r.linkedTaskIds) && r.linkedTaskIds.includes(id) ? { ...r, linkedTaskIds: r.linkedTaskIds.filter((t) => t !== id) } : r
  );
  persist('tasks');
  persist('planningSlots');
  persist('roadmapItems');
}

// --- Planning (upsert par memberId+date+period, comme setPlanningSlot côté client) ---
export function setPlanningSlot(memberId, date, period, taskId) {
  const existing = cache.planningSlots.find((p) => p.memberId === memberId && p.date === date && p.period === period);
  if (existing) {
    existing.taskId = taskId;
  } else {
    cache.planningSlots.push({ id: nextId('s'), memberId, date, period, taskId });
  }
  persist('planningSlots');
  return cache.planningSlots.find((p) => p.memberId === memberId && p.date === date && p.period === period);
}

// --- Temps saisi ---
export function addTimeEntry(payload) {
  const item = { ...payload, id: idOrNext(payload, 'te') };
  cache.timeEntries.push(item);
  persist('timeEntries');
  return item;
}
export function removeTimeEntry(id) {
  cache.timeEntries = cache.timeEntries.filter((e) => e.id !== id);
  persist('timeEntries');
}

// --- Absences ---
export function addAbsence(payload) {
  const item = { ...payload, id: idOrNext(payload, 'a') };
  cache.absences.push(item);
  persist('absences');
  return item;
}
// Une plage d'absences (plusieurs jours) est déjà décomposée en enregistrements individuels
// côté client (voir addAbsenceRange dans useStore.ts) — le serveur les insère tels quels
// plutôt que de recalculer la plage lui-même, pour ne jamais produire un résultat différent
// de ce que la personne voit déjà à l'écran.
export function addAbsencesBulk(items) {
  const created = (Array.isArray(items) ? items : []).map((item) => ({ ...item, id: idOrNext(item, 'a') }));
  cache.absences.push(...created);
  persist('absences');
  return created;
}
export function removeAbsence(id) {
  cache.absences = cache.absences.filter((a) => a.id !== id);
  persist('absences');
}

// --- Feuille de route (FDR) ---
export function addRoadmapItem(payload, actor) {
  const now = new Date().toISOString();
  const item = { ...payload, id: idOrNext(payload, 'r'), createdAt: payload.createdAt || now, updatedAt: now, updatedBy: actor };
  cache.roadmapItems.push(item);
  persist('roadmapItems');
  return item;
}
export function updateRoadmapItem(id, patch, actor) {
  const idx = cache.roadmapItems.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const next = { ...cache.roadmapItems[idx], ...patch, id, updatedAt: new Date().toISOString(), updatedBy: actor };
  cache.roadmapItems[idx] = next;
  persist('roadmapItems');
  return next;
}
export function removeRoadmapItem(id) {
  cache.roadmapItems = cache.roadmapItems.filter((r) => r.id !== id);
  cache.copils = cache.copils.map((c) =>
    Array.isArray(c.roadmapItemIds) && c.roadmapItemIds.includes(id)
      ? { ...c, roadmapItemIds: c.roadmapItemIds.filter((r) => r !== id) }
      : c
  );
  persist('roadmapItems');
  persist('copils');
}

// --- COPIL (comités de pilotage) ---
// L'ordre du jour, les décisions et les actions d'une séance sont stockés dans la séance
// elle-même (tableaux imbriqués) : les modifier revient à mettre à jour le COPIL avec le
// tableau complet, comme côté client (voir updateCopil dans src/store/useStore.ts).
export function addCopil(payload, actor) {
  const now = new Date().toISOString();
  const item = { ...payload, id: idOrNext(payload, 'cp'), createdAt: payload.createdAt || now, updatedAt: now, updatedBy: actor };
  cache.copils.push(item);
  persist('copils');
  return item;
}
export function updateCopil(id, patch, actor) {
  const idx = cache.copils.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const next = { ...cache.copils[idx], ...patch, id, updatedAt: new Date().toISOString(), updatedBy: actor };
  cache.copils[idx] = next;
  persist('copils');
  return next;
}
export function removeCopil(id) {
  cache.copils = cache.copils.filter((c) => c.id !== id);
  persist('copils');
}
