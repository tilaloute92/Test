import { Router } from 'express';
import { requireAuth } from '../auth/session.js';
import { requireAdmin, requireReferent } from '../auth/admin.js';
import { equipeCourante } from '../auth/equipeCourante.js';
import * as store from '../businessData.js';
import { getServiceConfig, setServiceConfig } from '../serviceConfig.js';
import { agregat as meteoAgregat, deposer as meteoDeposer, estLundiIso, modifier as meteoModifier } from '../meteoVotes.js';

export const dataRouter = Router();

// Toutes les routes de ce fichier exigent une session valide : les données d'équipe ne sont
// accessibles qu'à des utilisateurs authentifiés (compte local, LDAP ou SSO vérifié côté
// serveur) — voir README.md, section « Mode client/serveur ».
dataRouter.use(requireAuth);
// Puis l'équipe : posée une fois ici, lue partout ensuite via `req.equipe`. Voir
// auth/equipeCourante.js — c'est le point unique du cloisonnement.
dataRouter.use(equipeCourante);

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
  if (Number.isFinite(since) && since === store.getVersion(req.equipe)) {
    return res.json({ unchanged: true, equipe: req.equipe, equipeNom: req.equipeNom, ...store.getStatus(req.equipe) });
  }
  res.json({ unchanged: false, equipe: req.equipe, equipeNom: req.equipeNom, ...store.getSnapshot(req.equipe) });
});

/** État seul (version, mise en service, vacuité) — sans transférer les données. */
dataRouter.get('/status', (req, res) => res.json(store.getStatus(req.equipe)));

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
  const result = store.initialize(req.equipe, req.body?.snapshot, actorOf(req));
  if (result.status === 'already') {
    return res.status(409).json({ error: 'Le serveur a déjà été mis en service — opération refusée pour ne rien écraser.' });
  }
  res.json(result.snapshot);
});

// --- Membres ---
dataRouter.post('/members', (req, res) => res.json(store.addMember(req.equipe, req.body)));
dataRouter.patch('/members/:id', (req, res) => {
  const updated = store.updateMember(req.equipe, req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Membre introuvable.' });
  res.json(updated);
});
dataRouter.delete('/members/:id', (req, res) => {
  store.removeMember(req.equipe, req.params.id);
  res.json({ ok: true });
});

// --- Tâches ---
dataRouter.post('/tasks', (req, res) => res.json(store.addTask(req.equipe, req.body, actorOf(req))));
dataRouter.patch('/tasks/:id', (req, res) =>
  respondToUpdate(res, store.updateTask(req.equipe, req.params.id, req.body, actorOf(req), baseUpdatedAtOf(req)), 'Tâche introuvable.')
);
dataRouter.delete('/tasks/:id', (req, res) => {
  store.removeTask(req.equipe, req.params.id);
  res.json({ ok: true });
});

// --- Planning ---
dataRouter.put('/planning-slots', (req, res) => {
  const { memberId, date, period, taskId } = req.body || {};
  if (!memberId || !date || !period) return res.status(400).json({ error: 'memberId, date et period sont requis.' });
  res.json(store.setPlanningSlot(req.equipe, memberId, date, period, taskId ?? null));
});

// --- Temps saisi ---
dataRouter.post('/time-entries', (req, res) => res.json(store.addTimeEntry(req.equipe, req.body)));
dataRouter.delete('/time-entries/:id', (req, res) => {
  store.removeTimeEntry(req.equipe, req.params.id);
  res.json({ ok: true });
});

// --- Absences ---
dataRouter.post('/absences', (req, res) => res.json(store.addAbsence(req.equipe, req.body)));
dataRouter.post('/absences/bulk', (req, res) => res.json(store.addAbsencesBulk(req.equipe, req.body?.items)));
dataRouter.delete('/absences/:id', (req, res) => {
  store.removeAbsence(req.equipe, req.params.id);
  res.json({ ok: true });
});

// --- Feuille de route (FDR) ---
dataRouter.post('/roadmap-items', (req, res) => res.json(store.addRoadmapItem(req.equipe, req.body, actorOf(req))));
dataRouter.patch('/roadmap-items/:id', (req, res) =>
  respondToUpdate(res, store.updateRoadmapItem(req.equipe, req.params.id, req.body, actorOf(req), baseUpdatedAtOf(req)), 'Initiative introuvable.')
);
dataRouter.delete('/roadmap-items/:id', (req, res) => {
  store.removeRoadmapItem(req.equipe, req.params.id);
  res.json({ ok: true });
});

// --- COPIL (comités de pilotage) ---
dataRouter.post('/copils', (req, res) => res.json(store.addCopil(req.equipe, req.body, actorOf(req))));
dataRouter.patch('/copils/:id', (req, res) =>
  respondToUpdate(res, store.updateCopil(req.equipe, req.params.id, req.body, actorOf(req), baseUpdatedAtOf(req)), 'COPIL introuvable.')
);
dataRouter.delete('/copils/:id', (req, res) => {
  store.removeCopil(req.equipe, req.params.id);
  res.json({ ok: true });
});

// --- Journal d'avancement ---
//
// Pas de contrôle de concurrence ici : une entrée de journal est ajoutée, jamais réécrite
// par quelqu'un d'autre. Deux personnes qui commentent en même temps produisent deux
// entrées, et c'est exactement ce qu'on veut — contrairement à une tâche, où la seconde
// écriture écraserait la première.
dataRouter.post('/journal-entries', (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items attendu.' });
  if (items.length > 50) return res.status(400).json({ error: 'Cinquante entrées au maximum par envoi.' });
  res.json(store.addJournalEntries(req.equipe, items));
});

dataRouter.patch('/journal-entries/:id', (req, res) => {
  const result = store.updateJournalNote(req.equipe, req.params.id, req.body?.texte);
  if (!result) return res.status(404).json({ error: 'Entrée introuvable.' });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

dataRouter.delete('/journal-entries/:id', (req, res) => {
  store.removeJournalEntry(req.equipe, req.params.id);
  res.json({ ok: true });
});

// --- Règles de service (seuil de présence) ---
//
// Lecture ouverte à toute session : l'alerte doit s'afficher pour tout le monde. Écriture
// réservée à l'administrateur, comme le reste de la configuration — abaisser le seuil
// ferait taire une alerte pour toute l'équipe.
dataRouter.get('/service-config', (req, res) => res.json(getServiceConfig(req.equipe)));

dataRouter.put('/service-config', requireReferent, (req, res) => {
  try {
    res.json(
      setServiceConfig(req.equipe, {
        seuilPresence: req.body?.seuilPresence,
        meteoCloture: req.body?.meteoCloture,
        recurrences: req.body?.recurrences,
      })
    );
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Météo de la semaine votée par l'équipe — voir server/src/meteoVotes.js, qui explique
 * pourquoi ces voix ne sont PAS une collection partagée de plus : l'instantané `GET /`
 * est renvoyé à tout le monde, et une voix ne doit jamais voyager avec son contexte.
 *
 * L'identité ne vient jamais du corps de la requête mais de la session (`req.user.sub`) :
 * sinon n'importe qui voterait au nom de n'importe qui, et l'anonymat servirait surtout à
 * masquer le bourrage d'urne.
 */
function semaineDe(req, res) {
  const semaine = req.params.semaine;
  if (!estLundiIso(semaine)) {
    res.status(400).json({ error: 'La semaine doit être une date de lundi au format AAAA-MM-JJ.' });
    return null;
  }
  return semaine;
}

function repondreVote(res, action) {
  try {
    res.json(action());
  } catch (error) {
    res.status(error.statut ?? 400).json({ error: error.message });
  }
}

dataRouter.get('/meteo/:semaine', (req, res) => {
  const semaine = semaineDe(req, res);
  if (semaine) res.json(meteoAgregat(req.equipe, semaine, req.user.sub));
});

dataRouter.post('/meteo/:semaine', (req, res) => {
  const semaine = semaineDe(req, res);
  if (semaine) {
    repondreVote(res, () =>
      meteoDeposer({ equipe: req.equipe, semaine, username: req.user.sub, niveau: req.body?.niveau, mot: req.body?.mot })
    );
  }
});

dataRouter.patch('/meteo/:semaine', (req, res) => {
  const semaine = semaineDe(req, res);
  if (semaine) {
    repondreVote(res, () =>
      meteoModifier({ equipe: req.equipe, semaine, username: req.user.sub, id: req.body?.id, niveau: req.body?.niveau, mot: req.body?.mot })
    );
  }
});
