import { Router } from 'express';
import { requireAuth } from '../auth/session.js';
import { config } from '../config.js';
import { isMailConfigured, verifyMail } from '../mail/transport.js';
import { sendDailyProgrammes } from '../mail/send.js';
import { getMailState } from '../mail/scheduler.js';
import { buildProgramme, renderSubject, renderText, toISODate } from '../mail/dailyProgramme.js';
import { getSnapshot } from '../businessData.js';

export const mailRouter = Router();

// L'envoi de mail agit au nom de l'équipe : il exige une session, comme les données métier.
mailRouter.use(requireAuth);

mailRouter.get('/status', (_req, res) => {
  const state = getMailState();
  res.json({
    configured: isMailConfigured(),
    from: config.smtp.from || null,
    host: config.smtp.host || null,
    dailyMailAt: config.dailyMailAt || null,
    lastSentDate: state.lastSentDate,
    lastRunAt: state.lastRunAt,
    lastResults: state.lastResults,
  });
});

/** Vérifie que le relais SMTP répond, sans envoyer de message. */
mailRouter.post('/verify', async (_req, res) => {
  try {
    await verifyMail();
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Aperçu, sans rien envoyer : ce que recevrait chaque personne. Permet de contrôler le
 * contenu avant de déclencher un envoi réel.
 */
mailRouter.get('/preview', (req, res) => {
  const iso = req.query.date || toISODate(new Date());
  const { members } = getSnapshot();
  const previews = members.map((m) => {
    const programme = buildProgramme(m, iso);
    return {
      memberId: m.id,
      name: m.name,
      email: m.email || null,
      subject: programme ? renderSubject(programme) : null,
      text: programme ? renderText(programme) : null,
    };
  });
  res.json({ date: iso, previews });
});

mailRouter.post('/daily-programme', async (req, res) => {
  try {
    const { date, memberIds } = req.body || {};
    res.json(await sendDailyProgrammes({ date, memberIds }));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
