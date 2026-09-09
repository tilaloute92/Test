import { Router } from 'express';
import { requireAuth } from '../auth/session.js';
import * as store from '../businessData.js';

export const dataRouter = Router();

// Toutes les routes de ce fichier exigent une session valide : les données d'équipe ne sont
// accessibles qu'à des utilisateurs authentifiés (compte local, LDAP ou SSO vérifié côté
// serveur) — voir README.md, section « Mode client/serveur ».
dataRouter.use(requireAuth);

function actorOf(req) {
  return req.user?.name || req.user?.sub || 'inconnu';
}

/**
 * Date de dernière modification sur laquelle le navigateur s'est basé, transmise en en-tête
 * pour ne pas polluer le corps de la modification elle-même. Voir `conflicts()` dans
 * businessData.js : elle sert à refuser une modification qui écraserait celle d'un collègue.
 */
function baseUpdatedAtOf(req) {
  return req.get('X-Base-Updated-At') || null;
}

/** Réponse commune aux modifications d'enregistrements à contenu rédigé (tâche, FDR, COPIL). */
function respondToUpdate(res, result, notFoundMessage) {
  if (result.status === 'notfound') return res.status(404).json({ error: notFoundMessage });
  if (result.status === 'conflict') {
    return res.status(409).json({
      conflict: true,
      error: `Modifié entre-temps par ${result.item.updatedBy || 'un autre utilisateur'} — votre modification n'a pas été enregistrée.`,
      item: result.item,
    });
  }
  return res.json(result.item);
}

/**
 * Lecture de l'état partagé. Avec `?since=N`, le serveur ne renvoie les données que s'il a
 * changé depuis la version N ; sinon il répond `unchanged`. C'est ce qui permet au sondage
 * périodique des navigateurs de ne PAS réécrire l'affichage toutes les 8 secondes.
 */
dataRouter.get('/', (req, res) => {
  const since = Number(req.query.since);
  if (Number.isFinite(since) && since === store.getVersion()) {
    return res.json({ unchanged: true, ...store.getStatus() });
  }
  res.json({ unchanged: false, ...store.getSnapshot() });
});

/** État seul (version, mise en service, vacuité) — sans transférer les données. */
dataRouter.get('/status', (_req, res) => res.json(store.getStatus()));

/**
 * Mise en service du serveur, une seule fois, par une seule personne :
 * - avec un corps contenant les collections : reprise des données d'un navigateur qui
 *   utilisait déjà l'application en autonome ;
 * - avec un corps vide : démarrage à vide, l'équipe se saisit depuis l'onglet Équipe.
 *
 * Refusée si le serveur a déjà été mis en service, pour ne jamais écraser le travail de
 * l'équipe par le contenu d'un seul navigateur.
 */
dataRouter.post('/initialize', (req, res) => {
  const result = store.initialize(req.body?.snapshot, actorOf(req));
  if (result.status === 'already') {
    return res.status(409).json({ error: 'Le serveur a déjà été mis en service — opération refusée pour ne rien écraser.' });
  }
  res.json(result.snapshot);
});

// --- Membres ---
dataRouter.post('/members', (req, res) => res.json(store.addMember(req.body)));
dataRouter.patch('/members/:id', (req, res) => {
  const updated = store.updateMember(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Membre introuvable.' });
  res.json(updated);
});
dataRouter.delete('/members/:id', (req, res) => {
  store.removeMember(req.params.id);
  res.json({ ok: true });
});

// --- Tâches ---
dataRouter.post('/tasks', (req, res) => res.json(store.addTask(req.body, actorOf(req))));
dataRouter.patch('/tasks/:id', (req, res) =>
  respondToUpdate(res, store.updateTask(req.params.id, req.body, actorOf(req), baseUpdatedAtOf(req)), 'Tâche introuvable.')
);
dataRouter.delete('/tasks/:id', (req, res) => {
  store.removeTask(req.params.id);
  res.json({ ok: true });
});

// --- Planning ---
dataRouter.put('/planning-slots', (req, res) => {
  const { memberId, date, period, taskId } = req.body || {};
  if (!memberId || !date || !period) return res.status(400).json({ error: 'memberId, date et period sont requis.' });
  res.json(store.setPlanningSlot(memberId, date, period, taskId ?? null));
});

// --- Temps saisi ---
dataRouter.post('/time-entries', (req, res) => res.json(store.addTimeEntry(req.body)));
dataRouter.delete('/time-entries/:id', (req, res) => {
  store.removeTimeEntry(req.params.id);
  res.json({ ok: true });
});

// --- Absences ---
dataRouter.post('/absences', (req, res) => res.json(store.addAbsence(req.body)));
dataRouter.post('/absences/bulk', (req, res) => res.json(store.addAbsencesBulk(req.body?.items)));
dataRouter.delete('/absences/:id', (req, res) => {
  store.removeAbsence(req.params.id);
  res.json({ ok: true });
});

// --- Feuille de route (FDR) ---
dataRouter.post('/roadmap-items', (req, res) => res.json(store.addRoadmapItem(req.body, actorOf(req))));
dataRouter.patch('/roadmap-items/:id', (req, res) =>
  respondToUpdate(res, store.updateRoadmapItem(req.params.id, req.body, actorOf(req), baseUpdatedAtOf(req)), 'Initiative introuvable.')
);
dataRouter.delete('/roadmap-items/:id', (req, res) => {
  store.removeRoadmapItem(req.params.id);
  res.json({ ok: true });
});

// --- COPIL (comités de pilotage) ---
dataRouter.post('/copils', (req, res) => res.json(store.addCopil(req.body, actorOf(req))));
dataRouter.patch('/copils/:id', (req, res) =>
  respondToUpdate(res, store.updateCopil(req.params.id, req.body, actorOf(req), baseUpdatedAtOf(req)), 'COPIL introuvable.')
);
dataRouter.delete('/copils/:id', (req, res) => {
  store.removeCopil(req.params.id);
  res.json({ ok: true });
});
