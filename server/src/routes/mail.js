import { Router } from 'express';
import { requireAuth } from '../auth/session.js';
import { requireAdmin } from '../auth/admin.js';
import { getPublicMailConfig, setMailConfig } from '../mail/mailConfig.js';
import { sendMail, verifyMail } from '../mail/transport.js';
import { sendDailyProgrammes } from '../mail/send.js';
import { getMailState } from '../mail/scheduler.js';
import { buildProgramme, renderSubject, renderText, toISODate } from '../mail/dailyProgramme.js';
import { getSnapshot } from '../businessData.js';

export const mailRouter = Router();

// L'envoi de mail agit au nom de l'équipe : il exige une session, comme les données métier.
mailRouter.use(requireAuth);

mailRouter.get('/status', (_req, res) => {
  const state = getMailState();
  const cfg = getPublicMailConfig();
  res.json({
    configured: cfg.configured,
    from: cfg.from || null,
    host: cfg.host || null,
    dailyMailAt: cfg.dailyMailAt || null,
    lastSentDate: state.lastSentDate,
    lastRunAt: state.lastRunAt,
    lastResults: state.lastResults,
  });
});

/**
 * Configuration du relais. Réservée à l'administrateur : le mot de passe du relais y
 * figure, et rediriger les messages de l'équipe vers un autre serveur n'est pas un
 * réglage d'affichage. Le mot de passe ne sort jamais du serveur (voir mailConfig.js).
 */
mailRouter.get('/config', requireAdmin, (_req, res) => {
  res.json(getPublicMailConfig());
});

mailRouter.put('/config', requireAdmin, (req, res) => {
  const b = req.body || {};
  const heure = String(b.dailyMailAt || '').trim();
  if (heure && !/^([01]\d|2[0-3]):[0-5]\d$/.test(heure)) {
    return res.status(400).json({ error: "Heure d'envoi attendue au format HH:MM (par exemple 07:45)." });
  }
  res.json(
    setMailConfig({
      host: String(b.host || '').trim(),
      port: Number(b.port) > 0 ? Number(b.port) : 25,
      secure: Boolean(b.secure),
      user: String(b.user || '').trim(),
      // Absent ou vide = mot de passe inchangé ; le navigateur ne l'a jamais reçu.
      pass: b.pass,
      from: String(b.from || '').trim(),
      dailyMailAt: heure,
      tlsRejectUnauthorized: b.tlsRejectUnauthorized !== false,
    })
  );
});

/**
 * Message de test vers une adresse choisie. Distinct de /verify : un relais peut accepter
 * la connexion et refuser ensuite le message — expéditeur non autorisé, relayage interdit
 * pour cette IP. Seul un envoi réel le montre, et c'est précisément ce qui fait perdre le
 * plus de temps en configuration.
 */
mailRouter.post('/test', requireAdmin, async (req, res) => {
  const to = String(req.body?.to || '').trim();
  if (!to) return res.status(400).json({ error: 'Indiquez une adresse de destination pour le test.' });
  try {
    const info = await sendMail({
      to,
      subject: 'Suivi Infra & Réseau — message de test',
      text:
        "Ce message confirme que l'application sait remettre du courrier à votre relais SMTP.\n\n" +
        "Si vous le recevez, l'envoi du programme du jour fonctionnera.",
    });
    res.json({ ok: true, accepted: info.accepted, rejected: info.rejected, response: info.response });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
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
