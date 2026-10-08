import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyLocalLogin, listLocalUsers, upsertLocalUser, removeLocalUser, localAdminsExcept, localUserRole } from '../auth/localAuth.js';
import { verifyLdapLogin, getLdapConfig, setLdapConfig } from '../auth/ldapAuth.js';
import { verifySsoToken } from '../auth/ssoAuth.js';
import { issueSession, clearSession, requireAuth, requireAdmin, currentUser } from '../auth/session.js';
import { roleOf, getAdminList, setAdminList } from '../auth/roles.js';
import { config } from '../config.js';

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
  res.json({ username: user.username, name: user.name, method: 'local', role: roleOf({ sub: user.username, method: 'local' }) });
});

authRouter.post('/ldap', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  try {
    const user = await verifyLdapLogin(username, password);
    if (!user) return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    issueSession(res, { ...user, method: 'ldap' });
    res.json({ username: user.username, name: user.name, method: 'ldap', role: roleOf({ sub: user.username, method: 'ldap' }) });
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
    res.json({ username: user.username, name: user.name, method: 'sso', role: roleOf({ sub: user.username, method: 'sso' }) });
  } catch (err) {
    res.status(401).json({ error: `Jeton SSO invalide : ${err.message}` });
  }
});

/**
 * Moyens de connexion proposés sur l'écran de connexion, accessible sans session. Il ne
 * révèle que ce que l'écran affiche de toute façon : l'identifiant d'annuaire et
 * d'application Entra ID sont des valeurs publiques (elles figurent dans l'URL de la page
 * de connexion Microsoft), aucun secret n'est transmis.
 */
authRouter.get('/methods', (_req, res) => {
  const ldap = getLdapConfig();
  res.json({
    local: true,
    ldap: Boolean(ldap.enabled && ldap.url),
    sso: config.entraTenantId && config.entraClientId
      ? { tenantId: config.entraTenantId, clientId: config.entraClientId }
      : null,
  });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié.' });
  res.json({ username: user.sub, name: user.name, method: user.method, role: roleOf(user) });
});

// --- Gestion des comptes locaux (administrateurs uniquement) ---
authRouter.get('/local-users', requireAuth, requireAdmin, (_req, res) => {
  res.json(listLocalUsers());
});

authRouter.post('/local-users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, name, role = 'admin' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });
  if (!['admin', 'lecteur'].includes(role)) return res.status(400).json({ error: 'Profil inconnu.' });
  // Jamais sans administrateur local : c'est le recours si l'annuaire est indisponible.
  if (role === 'lecteur' && localUserRole(username) === 'admin' && localAdminsExcept(username) === 0) {
    return res.status(400).json({ error: 'Il doit rester au moins un administrateur parmi les comptes locaux.' });
  }
  await upsertLocalUser(username, password, name, role);
  res.json({ ok: true });
});

authRouter.delete('/local-users/:username', requireAuth, requireAdmin, (req, res) => {
  if (localUserRole(req.params.username) === 'admin' && localAdminsExcept(req.params.username) === 0) {
    return res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur local.' });
  }
  removeLocalUser(req.params.username);
  res.json({ ok: true });
});

// --- Administrateurs Active Directory / Microsoft ---
authRouter.get('/admins', requireAuth, requireAdmin, (_req, res) => {
  res.json({ admins: getAdminList() });
});

authRouter.put('/admins', requireAuth, requireAdmin, (req, res) => {
  res.json({ admins: setAdminList(req.body?.admins) });
});

// --- Configuration LDAP (administrateurs uniquement) ---
authRouter.get('/ldap-config', requireAuth, requireAdmin, (_req, res) => {
  res.json(getLdapConfig());
});

authRouter.put('/ldap-config', requireAuth, requireAdmin, (req, res) => {
  const { enabled, url, userDnPattern } = req.body || {};
  const next = setLdapConfig({ enabled: Boolean(enabled), url: url || '', userDnPattern: userDnPattern || '' });
  res.json(next);
});
