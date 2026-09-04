import { Router } from 'express';
import { requireAuth } from '../auth/session.js';
import * as store from '../businessData.js';

export const dataRouter = Router();

// Toutes les routes de ce fichier exigent une session valide : les données d'équipe ne sont
// synchronisées qu'avec des utilisateurs authentifiés (local, LDAP ou SSO vérifié côté
// serveur) — voir README.md, section "Mode multi-utilisateur".
dataRouter.use(requireAuth);

function actorOf(req) {
  return req.user?.name || req.user?.sub || 'inconnu';
}

dataRouter.get('/', (_req, res) => {
  res.json({ ...store.getSnapshot(), isEmpty: store.isEmpty() });
});

// Publication initiale : envoie les données locales du navigateur vers le serveur, la
// première fois que quelqu'un active le mode multi-utilisateur. Refusée si le serveur a
// déjà des données, pour ne jamais écraser silencieusement le travail de toute l'équipe —
// voir la confirmation côté interface avant cet appel.
dataRouter.post('/publish', (req, res) => {
  if (!store.isEmpty()) {
    return res.status(409).json({ error: 'Le serveur contient déjà des données partagées — publication refusée pour ne rien écraser.' });
  }
  res.json(store.replaceAll(req.body || {}));
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
dataRouter.patch('/tasks/:id', (req, res) => {
  const updated = store.updateTask(req.params.id, req.body, actorOf(req));
  if (!updated) return res.status(404).json({ error: 'Tâche introuvable.' });
  res.json(updated);
});
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
dataRouter.patch('/roadmap-items/:id', (req, res) => {
  const updated = store.updateRoadmapItem(req.params.id, req.body, actorOf(req));
  if (!updated) return res.status(404).json({ error: 'Initiative introuvable.' });
  res.json(updated);
});
dataRouter.delete('/roadmap-items/:id', (req, res) => {
  store.removeRoadmapItem(req.params.id);
  res.json({ ok: true });
});
