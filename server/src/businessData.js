import { readJson, writeJson } from './dataStore.js';

/**
 * Données métier de l'équipe : membres, tâches, planning, temps saisi, absences, feuille de
 * route, COPIL.
 *
 * En mode client/serveur, ce module est la SOURCE DE VÉRITÉ de l'application. Les
 * navigateurs n'en détiennent qu'un affichage : ils lisent ici au démarrage, écrivent ici à
 * chaque modification, et se resynchronisent ici quand une écriture échoue. Rien
 * d'important ne survit dans un navigateur.
 *
 * Ce module ne gère PAS les connexions API (`ApiConnection`) ni l'historique de requêtes :
 * ce sont des identifiants/secrets de test personnels à chaque utilisateur, pas une donnée
 * d'équipe à partager. Il ne gère pas non plus `authSettings` (paramètres de connexion SSO,
 * voir routes/auth.js), ni l'historique de sauvegarde de src/lib/backup.ts, qui reste un
 * filet de sécurité local au navigateur de chacun.
 *
 * Un seul processus Node sert toute l'équipe : le cache mémoire ci-dessous est donc toujours
 * cohérent sans coordination inter-processus, et les mutations ci-dessous étant toutes
 * synchrones, aucune ne peut s'intercaler dans une autre. Voir DEPLOYMENT.md si plusieurs
 * instances devaient un jour tourner derrière un répartiteur de charge — ce n'est pas le cas
 * prévu ici, et le compteur de version ci-dessous suppose explicitement un seul processus.
 */

const COLLECTIONS = ['members', 'tasks', 'planningSlots', 'timeEntries', 'absences', 'roadmapItems', 'copils'];

const cache = {};
for (const name of COLLECTIONS) {
  cache[name] = readJson(`business-${name}.json`, []);
}

/**
 * `version` : compteur incrémenté à CHAQUE modification, quelle qu'elle soit. Il permet aux
 * navigateurs de demander « as-tu changé depuis la version N ? » et de ne recevoir les
 * données que si la réponse est oui — au lieu de retélécharger et de réappliquer tout l'état
 * toutes les 8 secondes, ce qui écrasait sans cesse l'affichage en cours.
 *
 * `initialized` : le serveur a-t-il été mis en service ? Un serveur vide et un serveur vidé
 * volontairement se ressemblent ; ce drapeau les distingue, pour ne proposer l'écran de
 * première utilisation qu'une seule fois et ne jamais reproposer d'écraser des données que
 * l'équipe aurait délibérément supprimées.
 */
const META_FILE = 'business-meta.json';
let meta = readJson(META_FILE, { version: 0, initialized: false, initializedAt: null, initializedBy: null });

function persist(...names) {
  for (const name of names) writeJson(`business-${name}.json`, cache[name]);
  meta = { ...meta, version: meta.version + 1 };
  writeJson(META_FILE, meta);
}

export function getVersion() {
  return meta.version;
}

/** true si le serveur n'a aucune donnée métier — distinct de `initialized` (voir plus haut). */
export function isEmpty() {
  return COLLECTIONS.every((name) => cache[name].length === 0);
}

export function getStatus() {
  return { version: meta.version, initialized: Boolean(meta.initialized), isEmpty: isEmpty() };
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
    ...getStatus(),
  };
}

/**
 * Marque le serveur comme mis en service, avec ou sans données de départ.
 *
 * - `payload` fourni : reprise des données du navigateur de la personne qui met en service
 *   (migration depuis un poste où l'application tournait déjà en autonome).
 * - `payload` absent : mise en service à vide, l'équipe se saisit depuis l'onglet Équipe.
 *
 * Refusé si le serveur a déjà été mis en service : c'est la protection contre l'écrasement
 * du travail de toute l'équipe par le navigateur d'une seule personne.
 */
export function initialize(payload, actor) {
  if (meta.initialized) return { status: 'already' };
  const touched = [];
  for (const name of COLLECTIONS) {
    if (Array.isArray(payload?.[name])) {
      cache[name] = payload[name];
      touched.push(name);
    }
  }
  meta = { ...meta, initialized: true, initializedAt: new Date().toISOString(), initializedBy: actor };
  // `persist` incrémente la version et réécrit meta, y compris quand aucune collection n'est
  // touchée (mise en service à vide) : les autres navigateurs doivent voir le changement.
  persist(...touched);
  return { status: 'ok', snapshot: getSnapshot() };
}

let idSeed = Date.now();
function nextId(prefix) {
  idSeed += 1;
  return `${prefix}${idSeed.toString(36)}`;
}

// Pour chaque création, le navigateur qui l'initie a déjà généré un identifiant (pour mettre
// à jour son propre affichage sans attendre la réponse) — on le réutilise tel quel plutôt
// que d'en fabriquer un autre ici, sinon le client se retrouverait avec deux versions du
// même enregistrement à réconcilier. Un identifiant n'est généré ici que si aucun n'est
// fourni (appel direct à l'API, hors application).
function idOrNext(payload, prefix) {
  return payload.id || nextId(prefix);
}

/**
 * Contrôle de concurrence pour les enregistrements à contenu rédigé (tâches, FDR, COPIL) :
 * le navigateur envoie la date de dernière modification sur laquelle il s'est basé. Si elle
 * ne correspond plus, quelqu'un d'autre a modifié l'enregistrement entre-temps et la
 * modification est REFUSÉE plutôt qu'appliquée par-dessus — sans quoi le travail du collègue
 * disparaîtrait sans que personne ne le sache.
 *
 * Les collections sans contenu rédigé (planning, temps, absences, membres) restent en
 * « dernière écriture gagne » : un créneau ou une saisie de temps est une valeur unique,
 * immédiatement visible à l'écran, dont l'écrasement ne détruit pas de travail rédigé.
 */
function conflicts(current, baseUpdatedAt) {
  return Boolean(baseUpdatedAt) && Boolean(current.updatedAt) && current.updatedAt !== baseUpdatedAt;
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
  persist('members', 'tasks', 'planningSlots', 'roadmapItems', 'copils');
}

// --- Tâches ---
export function addTask(payload, actor) {
  const now = new Date().toISOString();
  const item = { ...payload, id: idOrNext(payload, 't'), createdAt: payload.createdAt || now, updatedAt: now, updatedBy: actor };
  cache.tasks.push(item);
  persist('tasks');
  return item;
}
export function updateTask(id, patch, actor, baseUpdatedAt) {
  const idx = cache.tasks.findIndex((t) => t.id === id);
  if (idx === -1) return { status: 'notfound' };
  const current = cache.tasks[idx];
  if (conflicts(current, baseUpdatedAt)) return { status: 'conflict', item: current };
  const next = { ...current, ...patch, id };
  if (patch.status === 'termine' && current.status !== 'termine') next.completedAt = new Date().toISOString();
  else if (patch.status && patch.status !== 'termine') next.completedAt = undefined;
  next.updatedAt = new Date().toISOString();
  next.updatedBy = actor;
  cache.tasks[idx] = next;
  persist('tasks');
  return { status: 'ok', item: next };
}
export function removeTask(id) {
  cache.tasks = cache.tasks.filter((t) => t.id !== id);
  cache.planningSlots = cache.planningSlots.map((p) => (p.taskId === id ? { ...p, taskId: null } : p));
  cache.roadmapItems = cache.roadmapItems.map((r) =>
    Array.isArray(r.linkedTaskIds) && r.linkedTaskIds.includes(id) ? { ...r, linkedTaskIds: r.linkedTaskIds.filter((t) => t !== id) } : r
  );
  persist('tasks', 'planningSlots', 'roadmapItems');
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
export function updateRoadmapItem(id, patch, actor, baseUpdatedAt) {
  const idx = cache.roadmapItems.findIndex((r) => r.id === id);
  if (idx === -1) return { status: 'notfound' };
  const current = cache.roadmapItems[idx];
  if (conflicts(current, baseUpdatedAt)) return { status: 'conflict', item: current };
  const next = { ...current, ...patch, id, updatedAt: new Date().toISOString(), updatedBy: actor };
  cache.roadmapItems[idx] = next;
  persist('roadmapItems');
  return { status: 'ok', item: next };
}
export function removeRoadmapItem(id) {
  cache.roadmapItems = cache.roadmapItems.filter((r) => r.id !== id);
  cache.copils = cache.copils.map((c) =>
    Array.isArray(c.roadmapItemIds) && c.roadmapItemIds.includes(id)
      ? { ...c, roadmapItemIds: c.roadmapItemIds.filter((r) => r !== id) }
      : c
  );
  persist('roadmapItems', 'copils');
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
export function updateCopil(id, patch, actor, baseUpdatedAt) {
  const idx = cache.copils.findIndex((c) => c.id === id);
  if (idx === -1) return { status: 'notfound' };
  const current = cache.copils[idx];
  if (conflicts(current, baseUpdatedAt)) return { status: 'conflict', item: current };
  const next = { ...current, ...patch, id, updatedAt: new Date().toISOString(), updatedBy: actor };
  cache.copils[idx] = next;
  persist('copils');
  return { status: 'ok', item: next };
}
export function removeCopil(id) {
  cache.copils = cache.copils.filter((c) => c.id !== id);
  persist('copils');
}
