import { Router } from 'express';
import { requireAuth } from '../auth/session.js';
import { requirePlateforme } from '../auth/admin.js';
import { listLocalUsers } from '../auth/localAuth.js';
import { oublierEspace } from '../businessData.js';
import { creerEquipe, listerEquipes, renommerEquipe, retirerEquipe } from '../equipes.js';
import {
  affecter,
  desaffecter,
  definirCorrespondances,
  listerAppartenances,
  listerCorrespondances,
} from '../auth/appartenance.js';

/**
 * Administration des équipes — RÉSERVÉE À L'ADMINISTRATEUR DE PLATEFORME.
 *
 * Créer une équipe, y rattacher des gens et déclarer la correspondance avec les groupes
 * de l'annuaire : trois gestes qui décident qui voit quoi. Ils ne sont pas du ressort
 * d'un référent, qui ne règle que l'intérieur de son équipe.
 */

export const equipesRouter = Router();

equipesRouter.use(requireAuth, requirePlateforme);

equipesRouter.get('/', (_req, res) => {
  const equipes = listerEquipes();
  const appartenances = listerAppartenances();
  const affectes = new Set(appartenances.map((a) => a.username));
  // Les comptes locaux sans équipe : dès qu'il existe deux équipes, ils n'entrent plus
  // nulle part. L'écran d'administration doit le montrer AVANT qu'ils ne s'en aperçoivent
  // en se connectant.
  const sansEquipe = listLocalUsers()
    .map((u) => u.username)
    .filter((u) => !affectes.has(u.toLowerCase()));
  res.json({ equipes, appartenances, correspondances: listerCorrespondances(), sansEquipe });
});

const repondre = (res, action) => {
  try {
    res.json(action());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

equipesRouter.post('/', (req, res) => repondre(res, () => creerEquipe({ id: req.body?.id, nom: req.body?.nom })));

equipesRouter.patch('/:id', (req, res) => repondre(res, () => renommerEquipe(req.params.id, req.body?.nom)));

/** Retire l'INSCRIPTION de l'équipe, pas ses données — voir equipes.js. */
equipesRouter.delete('/:id', (req, res) =>
  repondre(res, () => {
    retirerEquipe(req.params.id);
    // L'espace mémoire part avec l'inscription : une équipe recréée sous le même
    // identifiant doit repartir de son dossier, pas d'un cache resté là.
    oublierEspace(req.params.id);
    return { ok: true };
  })
);

equipesRouter.put('/appartenances/:username', (req, res) =>
  repondre(res, () => affecter(req.params.username, req.body?.equipe, 'manuel'))
);

equipesRouter.delete('/appartenances/:username', (req, res) =>
  repondre(res, () => {
    desaffecter(req.params.username);
    return { ok: true };
  })
);

equipesRouter.put('/correspondances', (req, res) =>
  repondre(res, () => ({ correspondances: definirCorrespondances(req.body?.correspondances) }))
);
