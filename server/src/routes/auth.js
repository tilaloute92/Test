import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyLocalLogin, listLocalUsers, upsertLocalUser, removeLocalUser } from '../auth/localAuth.js';
import { verifyLdapLogin, getLdapConfig, setLdapConfig } from '../auth/ldapAuth.js';
import { verifySsoToken } from '../auth/ssoAuth.js';
import { issueSession, clearSession, requireAuth, currentUser } from '../auth/session.js';

export const authRouter = Router();

// Limite les tentatives de connexion par mot de passe pour freiner le brute-force :
// 10 essais par tranche de 15 minutes, par adresse IP. Le SSO n'est pas concerné
// (Microsoft applique déjà ses propres protections sur ses pages de connexion).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.' },
});

authRouter.post('/local', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  const user = await verifyLocalLogin(username, password);
  if (!user) return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
  issueSession(res, { ...user, method: 'local' });
  res.json({ username: user.username, name: user.name });
});

authRouter.post('/ldap', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  try {
    const user = await verifyLdapLogin(username, password);
    if (!user) return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    issueSession(res, { ...user, method: 'ldap' });
    res.json({ username: user.username, name: user.name });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

authRouter.post('/sso', async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'Jeton manquant.' });
  try {
    const user = await verifySsoToken(idToken);
    issueSession(res, { ...user, method: 'sso' });
    res.json({ username: user.username, name: user.name });
  } catch (err) {
    res.status(401).json({ error: `Jeton SSO invalide : ${err.message}` });
  }
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié.' });
  res.json({ username: user.sub, name: user.name, method: user.method });
});

// --- Gestion des comptes locaux (protégée : il faut déjà être connecté) ---
authRouter.get('/local-users', requireAuth, (_req, res) => {
  res.json(listLocalUsers());
});

authRouter.post('/local-users', requireAuth, async (req, res) => {
  const { username, password, name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });
  await upsertLocalUser(username, password, name);
  res.json({ ok: true });
});

authRouter.delete('/local-users/:username', requireAuth, (req, res) => {
  removeLocalUser(req.params.username);
  res.json({ ok: true });
});

// --- Configuration LDAP (protégée) ---
authRouter.get('/ldap-config', requireAuth, (_req, res) => {
  res.json(getLdapConfig());
});

authRouter.put('/ldap-config', requireAuth, (req, res) => {
  const { enabled, url, userDnPattern } = req.body || {};
  const next = setLdapConfig({ enabled: Boolean(enabled), url: url || '', userDnPattern: userDnPattern || '' });
  res.json(next);
});
