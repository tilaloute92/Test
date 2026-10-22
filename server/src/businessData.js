import { readJsonEquipe, writeJsonEquipe } from './dataStore.js';

/**
 * Données métier, CLOISONNÉES PAR ÉQUIPE : membres, tâches, planning, temps saisi,
 * absences, feuille de route, COPIL, journal d'avancement.
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
 * CLOISONNEMENT. Chaque équipe a ses propres fichiers (voir dataStore.js) et son propre
 * espace en mémoire. Toutes les fonctions ci-dessous prennent l'identifiant d'équipe en
 * PREMIER ARGUMENT, sans valeur par défaut : un oubli d'appel lève une erreur au premier
 * accès au lieu de servir en silence les données d'une autre équipe. C'est la seule raison
 * pour laquelle ce portage est sûr — un filtre oublié, lui, ne dit rien.
 *
 * L'identifiant vient TOUJOURS de la session (voir le middleware d'équipe), jamais du
 * corps d'une requête ni d'un paramètre d'URL.
 *
 * Un seul processus Node sert toutes les équipes : chaque espace est donc toujours cohérent
 * sans coordination inter-processus, et les mutations ci-dessous étant toutes synchrones,
 * aucune ne peut s'intercaler dans une autre. Voir DEPLOYMENT.md si plusieurs instances
 * devaient un jour tourner derrière un répartiteur de charge — ce n'est pas le cas prévu
 * ici, et les compteurs de version ci-dessous supposent explicitement un seul processus.
 */

const COLLECTIONS = ['members', 'tasks', 'planningSlots', 'timeEntries', 'absences', 'roadmapItems', 'copils', 'journalEntries', 'referents'];
const META_FILE = 'business-meta.json';

/**
 * Combien d'espaces d'équipe restent chargés en mémoire.
 *
 * Les huit collections d'une équipe étaient chargées à l'import, ce qui ne tenait que
 * parce qu'il n'y en avait qu'une. À quinze équipes, tout porter en permanence n'a plus
 * de sens : on charge à la demande et on relâche les espaces les moins récemment servis.
 * Relâcher est sans risque — toute écriture est déjà sur le disque avant de rendre la
 * main, il n'y a jamais rien en attente dans un espace.
 */
const ESPACES_EN_MEMOIRE = 8;

/** Un espace = les données d'UNE équipe : ses collections, sa méta, sa version. */
const espaces = new Map();

function espace(equipe) {
  if (!equipe || typeof equipe !== 'string') {
    throw new Error(
      "businessData : identifiant d'équipe manquant. Toutes les lectures et écritures de " +
        "données métier doivent passer l'équipe de la session — voir le middleware d'équipe."
    );
  }
  let esp = espaces.get(equipe);
  if (!esp) {
    esp = { equipe, cache: {}, meta: null };
    for (const name of COLLECTIONS) esp.cache[name] = readJsonEquipe(equipe, `business-${name}.json`, []);
    esp.meta = readJsonEquipe(equipe, META_FILE, { version: 0, initialized: false, initializedAt: null, initializedBy: null });
    espaces.set(equipe, esp);
    // Map conserve l'ordre d'insertion : la première clé est la plus anciennement chargée.
    while (espaces.size > ESPACES_EN_MEMOIRE) espaces.delete(espaces.keys().next().value);
  } else {
    // Remis en fin de file : un espace servi reste au chaud.
    espaces.delete(equipe);
    espaces.set(equipe, esp);
  }
  return esp;
}

/**
 * Relâche l'espace d'une équipe.
 *
 * À appeler quand une équipe est retirée du registre : sans cela, l'espace resterait en
 * mémoire et une équipe recréée sous le même identifiant retrouverait les données de la
 * précédente — surprise désagréable, et fuite entre deux équipes qui n'ont en commun
 * qu'un nom réutilisé.
 */
export function oublierEspace(equipe) {
  espaces.delete(equipe);
}

/**
 * `version` : compteur incrémenté à CHAQUE modification, quelle qu'elle soit. Il permet aux
 * navigateurs de demander « as-tu changé depuis la version N ? » et de ne recevoir les
 * données que si la réponse est oui — au lieu de retélécharger et de réappliquer tout l'état
 * toutes les 8 secondes, ce qui écrasait sans cesse l'affichage en cours.
 *
 * UN COMPTEUR PAR ÉQUIPE, et c'est essentiel : un compteur commun ferait retélécharger
 * l'instantané complet à tous les navigateurs de toutes les équipes dès qu'une seule
 * écrirait quoi que ce soit. À une équipe c'était invisible ; à quinze, c'est une charge
 * qu'on se crée soi-même.
 *
 * `initialized` : l'équipe a-t-elle été mise en service ? Un espace vide et un espace vidé
 * volontairement se ressemblent ; ce drapeau les distingue, pour ne proposer l'écran de
 * première utilisation qu'une seule fois et ne jamais reproposer d'écraser des données que
 * l'équipe aurait délibérément supprimées.
 */
function persist(esp, ...names) {
  for (const name of names) writeJsonEquipe(esp.equipe, `business-${name}.json`, esp.cache[name]);
  esp.meta = { ...esp.meta, version: esp.meta.version + 1 };
  writeJsonEquipe(esp.equipe, META_FILE, esp.meta);
}

export function getVersion(equipe) {
  const esp = espace(equipe);
  return esp.meta.version;
}

/** true si le serveur n'a aucune donnée métier — distinct de `initialized` (voir plus haut). */
export function isEmpty(equipe) {
  const esp = espace(equipe);
  return COLLECTIONS.every((name) => esp.cache[name].length === 0);
}

export function getStatus(equipe) {
  const esp = espace(equipe);
  return { version: esp.meta.version, initialized: Boolean(esp.meta.initialized), isEmpty: isEmpty(equipe) };
}

export function getSnapshot(equipe) {
  const esp = espace(equipe);
  return {
    members: esp.cache.members,
    tasks: esp.cache.tasks,
    planningSlots: esp.cache.planningSlots,
    timeEntries: esp.cache.timeEntries,
    absences: esp.cache.absences,
    roadmapItems: esp.cache.roadmapItems,
    copils: esp.cache.copils,
    journalEntries: esp.cache.journalEntries,
    referents: esp.cache.referents,
    ...getStatus(equipe),
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
export function initialize(equipe, payload, actor) {
  const esp = espace(equipe);
  if (esp.meta.initialized) return { status: 'already' };
  const touched = [];
  for (const name of COLLECTIONS) {
    if (Array.isArray(payload?.[name])) {
      esp.cache[name] = payload[name];
      touched.push(name);
    }
  }
  esp.meta = { ...esp.meta, initialized: true, initializedAt: new Date().toISOString(), initializedBy: actor };
  // `persist` incrémente la version et réécrit esp.meta, y compris quand aucune collection n'est
  // touchée (mise en service à vide) : les autres navigateurs doivent voir le changement.
  persist(esp, ...touched);
  return { status: 'ok', snapshot: getSnapshot(equipe) };
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
export function addMember(equipe, payload) {
  const esp = espace(equipe);
  const item = { ...payload, id: idOrNext(payload, 'm') };
  esp.cache.members.push(item);
  persist(esp, 'members');
  return item;
}
/**
 * Applique une modification partielle à un enregistrement, en traitant `null` comme un
 * EFFACEMENT.
 *
 * Le navigateur ne peut pas transmettre `undefined` : `JSON.stringify` supprime la clé, et
 * la modification arriverait amputée — vider le projet ou l'échéance d'une tâche semblerait
 * marcher à l'écran puis réapparaîtrait au rechargement, ce qui est la pire des deux issues.
 * Il envoie donc `null`, et c'est ici qu'on retire le champ.
 */
function appliquerPatch(current, patch, id) {
  const next = { ...current, ...patch, id };
  for (const [cle, valeur] of Object.entries(patch)) if (valeur === null) delete next[cle];
  return next;
}

export function updateMember(equipe, id, patch) {
  const esp = espace(equipe);
  const idx = esp.cache.members.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  esp.cache.members[idx] = appliquerPatch(esp.cache.members[idx], patch, id);
  persist(esp, 'members');
  return esp.cache.members[idx];
}
export function removeMember(equipe, id) {
  const esp = espace(equipe);
  esp.cache.members = esp.cache.members.filter((m) => m.id !== id);
  esp.cache.tasks = esp.cache.tasks.map((t) =>
    Array.isArray(t.assigneeIds) && t.assigneeIds.includes(id) ? { ...t, assigneeIds: t.assigneeIds.filter((a) => a !== id) } : t
  );
  esp.cache.planningSlots = esp.cache.planningSlots.filter((p) => p.memberId !== id);
  esp.cache.roadmapItems = esp.cache.roadmapItems.map((r) =>
    Array.isArray(r.ownerIds) && r.ownerIds.includes(id) ? { ...r, ownerIds: r.ownerIds.filter((o) => o !== id) } : r
  );
  // Un membre supprimé disparaît aussi des séances de COPIL : participants, porteurs
  // d'actions et présentateurs de points — même logique de nettoyage en cascade que
  // côté client (voir removeMember dans src/store/useStore.ts).
  esp.cache.copils = esp.cache.copils.map((c) => ({
    ...c,
    participantIds: Array.isArray(c.participantIds) ? c.participantIds.filter((p) => p !== id) : [],
    actions: Array.isArray(c.actions)
      ? c.actions.map((a) => ({ ...a, ownerIds: Array.isArray(a.ownerIds) ? a.ownerIds.filter((o) => o !== id) : [] }))
      : [],
    agenda: Array.isArray(c.agenda)
      ? c.agenda.map((point) => (point.presenterId === id ? { ...point, presenterId: undefined } : point))
      : [],
  }));
  persist(esp, 'members', 'tasks', 'planningSlots', 'roadmapItems', 'copils');
}

// --- Tâches ---
export function addTask(equipe, payload, actor) {
  const esp = espace(equipe);
  const now = new Date().toISOString();
  const item = { ...payload, id: idOrNext(payload, 't'), createdAt: payload.createdAt || now, updatedAt: now, updatedBy: actor };
  esp.cache.tasks.push(item);
  persist(esp, 'tasks');
  return item;
}
export function updateTask(equipe, id, patch, actor, baseUpdatedAt) {
  const esp = espace(equipe);
  const idx = esp.cache.tasks.findIndex((t) => t.id === id);
  if (idx === -1) return { status: 'notfound' };
  const current = esp.cache.tasks[idx];
  if (conflicts(current, baseUpdatedAt)) return { status: 'conflict', item: current };
  const next = appliquerPatch(current, patch, id);
  if (patch.status === 'termine' && current.status !== 'termine') next.completedAt = new Date().toISOString();
  else if (patch.status && patch.status !== 'termine') delete next.completedAt;
  next.updatedAt = new Date().toISOString();
  next.updatedBy = actor;
  esp.cache.tasks[idx] = next;
  persist(esp, 'tasks');
  return { status: 'ok', item: next };
}
export function removeTask(equipe, id) {
  const esp = espace(equipe);
  esp.cache.tasks = esp.cache.tasks.filter((t) => t.id !== id);
  esp.cache.planningSlots = esp.cache.planningSlots.map((p) => (p.taskId === id ? { ...p, taskId: null } : p));
  esp.cache.roadmapItems = esp.cache.roadmapItems.map((r) =>
    Array.isArray(r.linkedTaskIds) && r.linkedTaskIds.includes(id) ? { ...r, linkedTaskIds: r.linkedTaskIds.filter((t) => t !== id) } : r
  );
  // Le fil part avec sa tâche : des commentaires orphelins ne se rattachent plus à rien.
  esp.cache.journalEntries = esp.cache.journalEntries.filter((e) => e.taskId !== id);
  persist(esp, 'tasks', 'planningSlots', 'roadmapItems', 'journalEntries');
}

/**
 * Suppression en masse, pour la purge automatique (voir retention.js).
 *
 * En un seul `persist` : la purge d'une semaine de vacances d'équipe touche facilement
 * plusieurs dizaines d'enregistrements, et les supprimer un par un incrémenterait le
 * compteur de version autant de fois — chaque navigateur ouvert retéléchargerait alors
 * l'intégralité des données à chaque suppression. Une écriture, une version.
 */
export function purgeRecords(equipe, { taskIds = [], absenceIds = [], timeEntryIds = [] }) {
  const esp = espace(equipe);
  const tasks = new Set(taskIds);
  const absences = new Set(absenceIds);
  const entries = new Set(timeEntryIds);
  if (tasks.size === 0 && absences.size === 0 && entries.size === 0) return;

  if (tasks.size > 0) {
    esp.cache.tasks = esp.cache.tasks.filter((t) => !tasks.has(t.id));
    esp.cache.planningSlots = esp.cache.planningSlots.map((p) => (tasks.has(p.taskId) ? { ...p, taskId: null } : p));
    esp.cache.roadmapItems = esp.cache.roadmapItems.map((r) =>
      Array.isArray(r.linkedTaskIds) && r.linkedTaskIds.some((t) => tasks.has(t))
        ? { ...r, linkedTaskIds: r.linkedTaskIds.filter((t) => !tasks.has(t)) }
        : r
    );
    esp.cache.journalEntries = esp.cache.journalEntries.filter((e) => !tasks.has(e.taskId));
  }
  if (absences.size > 0) esp.cache.absences = esp.cache.absences.filter((a) => !absences.has(a.id));
  if (entries.size > 0) esp.cache.timeEntries = esp.cache.timeEntries.filter((e) => !entries.has(e.id));

  persist(esp, 'tasks', 'planningSlots', 'roadmapItems', 'absences', 'timeEntries', 'journalEntries');
}

// --- Journal d'avancement ---
//
// Le serveur enregistre ce qu'on lui donne, y compris les entrées écrites automatiquement
// par le navigateur à partir d'un changement de tâche. Les recalculer ici imposerait de
// dupliquer la logique de comparaison, et surtout l'entrée porterait un autre identifiant
// que celui que le navigateur affiche déjà — il faudrait alors réconcilier.

const NATURES_JOURNAL = ['note', 'statut', 'priorite', 'echeance', 'assignation', 'creation'];
const LONGUEUR_NOTE_MAX = 4000;

function assainitEntree(payload) {
  const nature = NATURES_JOURNAL.includes(payload?.nature) ? payload.nature : 'note';
  const texte = typeof payload?.texte === 'string' ? payload.texte.slice(0, LONGUEUR_NOTE_MAX) : undefined;
  return {
    id: idOrNext(payload ?? {}, 'j'),
    taskId: String(payload?.taskId ?? ''),
    nature,
    auteur: String(payload?.auteur ?? '').slice(0, 120),
    createdAt: payload?.createdAt || new Date().toISOString(),
    ...(texte ? { texte } : {}),
    ...(payload?.de !== undefined ? { de: String(payload.de).slice(0, 300) } : {}),
    ...(payload?.vers !== undefined ? { vers: String(payload.vers).slice(0, 300) } : {}),
  };
}

export function addJournalEntries(equipe, items) {
  const esp = espace(equipe);
  if (!Array.isArray(items) || items.length === 0) return [];
  // Une entrée rattachée à une tâche inconnue ne serait jamais lue : on la refuse plutôt
  // que de la garder pour rien.
  const retenues = items.map(assainitEntree).filter((e) => e.taskId && esp.cache.tasks.some((t) => t.id === e.taskId));
  if (retenues.length === 0) return [];
  esp.cache.journalEntries.push(...retenues);
  persist(esp, 'journalEntries');
  return retenues;
}

/** Seules les notes sont modifiables : une entrée automatique est un fait, pas un avis. */
export function updateJournalNote(equipe, id, texte) {
  const esp = espace(equipe);
  const e = esp.cache.journalEntries.find((x) => x.id === id);
  if (!e) return null;
  if (e.nature !== 'note') return { error: 'Une entrée automatique ne se modifie pas.' };
  e.texte = String(texte ?? '').slice(0, LONGUEUR_NOTE_MAX);
  e.editedAt = new Date().toISOString();
  persist(esp, 'journalEntries');
  return e;
}

export function removeJournalEntry(equipe, id) {
  const esp = espace(equipe);
  const avant = esp.cache.journalEntries.length;
  esp.cache.journalEntries = esp.cache.journalEntries.filter((e) => e.id !== id);
  if (esp.cache.journalEntries.length !== avant) persist(esp, 'journalEntries');
}

// --- Planning (upsert par memberId+date+period, comme setPlanningSlot côté client) ---
export function setPlanningSlot(equipe, memberId, date, period, taskId) {
  const esp = espace(equipe);
  const existing = esp.cache.planningSlots.find((p) => p.memberId === memberId && p.date === date && p.period === period);
  if (existing) {
    existing.taskId = taskId;
  } else {
    esp.cache.planningSlots.push({ id: nextId('s'), memberId, date, period, taskId });
  }
  persist(esp, 'planningSlots');
  return esp.cache.planningSlots.find((p) => p.memberId === memberId && p.date === date && p.period === period);
}

// --- Temps saisi ---
export function addTimeEntry(equipe, payload) {
  const esp = espace(equipe);
  const item = { ...payload, id: idOrNext(payload, 'te') };
  esp.cache.timeEntries.push(item);
  persist(esp, 'timeEntries');
  return item;
}
export function removeTimeEntry(equipe, id) {
  const esp = espace(equipe);
  esp.cache.timeEntries = esp.cache.timeEntries.filter((e) => e.id !== id);
  persist(esp, 'timeEntries');
}

// --- Absences ---
export function addAbsence(equipe, payload) {
  const esp = espace(equipe);
  const item = { ...payload, id: idOrNext(payload, 'a') };
  esp.cache.absences.push(item);
  persist(esp, 'absences');
  return item;
}
// Une plage d'absences (plusieurs jours) est déjà décomposée en enregistrements individuels
// côté client (voir addAbsenceRange dans useStore.ts) — le serveur les insère tels quels
// plutôt que de recalculer la plage lui-même, pour ne jamais produire un résultat différent
// de ce que la personne voit déjà à l'écran.
export function addAbsencesBulk(equipe, items) {
  const esp = espace(equipe);
  const created = (Array.isArray(items) ? items : []).map((item) => ({ ...item, id: idOrNext(item, 'a') }));
  esp.cache.absences.push(...created);
  persist(esp, 'absences');
  return created;
}
export function removeAbsence(equipe, id) {
  const esp = espace(equipe);
  esp.cache.absences = esp.cache.absences.filter((a) => a.id !== id);
  persist(esp, 'absences');
}

// --- Référent du jour ---
/**
 * UN SEUL par jour : la date est la clé. Désigner quelqu'un remplace la désignation
 * précédente plutôt que d'en ajouter une seconde — à deux référents, chacun suppose que
 * l'autre a pris.
 *
 * Le serveur ne vérifie PAS que la personne est disponible ce jour-là. Ce n'est pas un
 * oubli : l'absence peut être déclarée après coup, et refuser ici reviendrait à perdre la
 * désignation sans que personne ne le voie. Le jour est signalé comme non couvert là où
 * on le lit — l'écran du planning et le rapport de réunion (voir src/lib/referents.ts).
 */
export function setReferent(equipe, payload) {
  const esp = espace(equipe);
  const date = String(payload?.date ?? '');
  const memberId = String(payload?.memberId ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date de référent invalide.');
  if (!memberId) throw new Error('Référent sans personne désignée.');
  const item = { id: idOrNext(payload, 'rj'), date, memberId };
  esp.cache.referents = [...esp.cache.referents.filter((r) => r.date !== date), item];
  persist(esp, 'referents');
  return item;
}

export function clearReferent(equipe, date) {
  const esp = espace(equipe);
  esp.cache.referents = esp.cache.referents.filter((r) => r.date !== date);
  persist(esp, 'referents');
}

// --- Feuille de route (FDR) ---
export function addRoadmapItem(equipe, payload, actor) {
  const esp = espace(equipe);
  const now = new Date().toISOString();
  const item = { ...payload, id: idOrNext(payload, 'r'), createdAt: payload.createdAt || now, updatedAt: now, updatedBy: actor };
  esp.cache.roadmapItems.push(item);
  persist(esp, 'roadmapItems');
  return item;
}
export function updateRoadmapItem(equipe, id, patch, actor, baseUpdatedAt) {
  const esp = espace(equipe);
  const idx = esp.cache.roadmapItems.findIndex((r) => r.id === id);
  if (idx === -1) return { status: 'notfound' };
  const current = esp.cache.roadmapItems[idx];
  if (conflicts(current, baseUpdatedAt)) return { status: 'conflict', item: current };
  const next = { ...appliquerPatch(current, patch, id), updatedAt: new Date().toISOString(), updatedBy: actor };
  esp.cache.roadmapItems[idx] = next;
  persist(esp, 'roadmapItems');
  return { status: 'ok', item: next };
}
export function removeRoadmapItem(equipe, id) {
  const esp = espace(equipe);
  esp.cache.roadmapItems = esp.cache.roadmapItems.filter((r) => r.id !== id);
  esp.cache.copils = esp.cache.copils.map((c) =>
    Array.isArray(c.roadmapItemIds) && c.roadmapItemIds.includes(id)
      ? { ...c, roadmapItemIds: c.roadmapItemIds.filter((r) => r !== id) }
      : c
  );
  persist(esp, 'roadmapItems', 'copils');
}

// --- COPIL (comités de pilotage) ---
// L'ordre du jour, les décisions et les actions d'une séance sont stockés dans la séance
// elle-même (tableaux imbriqués) : les modifier revient à mettre à jour le COPIL avec le
// tableau complet, comme côté client (voir updateCopil dans src/store/useStore.ts).
export function addCopil(equipe, payload, actor) {
  const esp = espace(equipe);
  const now = new Date().toISOString();
  const item = { ...payload, id: idOrNext(payload, 'cp'), createdAt: payload.createdAt || now, updatedAt: now, updatedBy: actor };
  esp.cache.copils.push(item);
  persist(esp, 'copils');
  return item;
}
export function updateCopil(equipe, id, patch, actor, baseUpdatedAt) {
  const esp = espace(equipe);
  const idx = esp.cache.copils.findIndex((c) => c.id === id);
  if (idx === -1) return { status: 'notfound' };
  const current = esp.cache.copils[idx];
  if (conflicts(current, baseUpdatedAt)) return { status: 'conflict', item: current };
  const next = { ...appliquerPatch(current, patch, id), updatedAt: new Date().toISOString(), updatedBy: actor };
  esp.cache.copils[idx] = next;
  persist(esp, 'copils');
  return { status: 'ok', item: next };
}
export function removeCopil(equipe, id) {
  const esp = espace(equipe);
  esp.cache.copils = esp.cache.copils.filter((c) => c.id !== id);
  persist(esp, 'copils');
}
