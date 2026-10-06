import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { requireAuth } from '../auth/session.js';
import {
  listPlans, getPlan, createPlan, updatePlan, trashPlan, sourcePath, summary, isPlanId, VersionConflict,
} from '../plansStore.js';
import { search } from '../search.js';

export const plansRouter = Router();
plansRouter.use(requireAuth);

// Le fichier est gardé en mémoire le temps de le vérifier, puis écrit de façon atomique
// (voir dataStore.js) : jamais de fichier temporaire au nom choisi par l'utilisateur.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 4, fieldSize: 64 * 1024 * 1024 },
});

const who = (req) => req.user?.name || req.user?.sub || 'inconnu';

plansRouter.get('/', (_req, res) => {
  res.json(listPlans());
});

plansRouter.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig
          ? `Fichier trop volumineux (maximum ${Math.round(config.maxUploadBytes / 1048576)} Mo).`
          : `Envoi refusé : ${err.message}`,
      });
    }
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    let data = {};
    try {
      data = req.body?.data ? JSON.parse(req.body.data) : {};
    } catch {
      return res.status(400).json({ error: 'Description du plan illisible.' });
    }
    try {
      const { plan, duplicateOf } = createPlan({
        buffer: req.file.buffer,
        fileName: req.file.originalname || 'plan',
        meta: data,
        settings: data.settings,
        equipment: data.equipment,
        user: who(req),
      });
      res.status(201).json({ plan: summary(plan), duplicateOf });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  });
});

plansRouter.get('/:id', (req, res) => {
  const plan = isPlanId(req.params.id) && getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plan introuvable.' });
  res.json(plan);
});

plansRouter.get('/:id/file', (req, res) => {
  const plan = isPlanId(req.params.id) && getPlan(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plan introuvable.' });
  const p = sourcePath(plan);
  if (!fs.existsSync(p)) return res.status(410).json({ error: "Le fichier d'origine de ce plan est absent du serveur. Restaurez-le depuis la sauvegarde." });
  const ascii = plan.file.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', plan.file.format === 'pdf' ? 'application/pdf' : 'application/dxf');
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(plan.file.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(p).pipe(res);
});

plansRouter.patch('/:id', (req, res) => {
  if (!isPlanId(req.params.id)) return res.status(404).json({ error: 'Plan introuvable.' });
  try {
    const plan = updatePlan(req.params.id, req.body || {}, who(req));
    if (!plan) return res.status(404).json({ error: 'Plan introuvable.' });
    res.json(plan);
  } catch (e) {
    if (e instanceof VersionConflict) return res.status(409).json({ error: e.message, current: e.plan });
    throw e;
  }
});

plansRouter.delete('/:id', (req, res) => {
  if (!isPlanId(req.params.id) || !trashPlan(req.params.id)) return res.status(404).json({ error: 'Plan introuvable.' });
  res.json({ ok: true });
});

export const searchRouter = Router();
searchRouter.use(requireAuth);
searchRouter.get('/', (req, res) => {
  const { q = '', site = '', kind = '', plan = '' } = req.query;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  res.json(search({ q: String(q).slice(0, 200), site: String(site), kind: String(kind), planId: String(plan), limit }));
});
