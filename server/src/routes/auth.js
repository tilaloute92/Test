import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyLocalLogin, listLocalUsers, upsertLocalUser, removeLocalUser, usesDefaultPassword } from '../auth/localAuth.js';
import { verifyLdapLogin, getLdapConfig, setLdapConfig } from '../auth/ldapAuth.js';
import { verifySsoToken } from '../auth/ssoAuth.js';
import { issueSession, clearSession, requireAuth, currentUser } from '../auth/session.js';
import { isAdminUsername, requireAdmin } from '../auth/admin.js';

export const authRouter = Router();

/** Réponse commune aux trois voies de connexion et à /me : même forme, mêmes drapeaux. */
async function sessionPayload(username, name, method) {
  return {
    username,
    name,
    method,
    // Le navigateur ne DÉDUIT pas qui est administrateur à partir de l'identifiant : la
    // liste peut être étendue dans data/config.json, et deux définitions divergentes
    // afficheraient des boutons que le serveur refuserait ensuite.
    isAdmin: isAdminUsername(username),
    defaultPassword: await usesDefaultPassword(),
  };
}

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
  res.json(await sessionPayload(user.username, user.name, 'local'));
});

authRouter.post('/ldap', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  try {
    const user = await verifyLdapLogin(username, password);
    if (!user) return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    issueSession(res, { ...user, method: 'ldap' });
    res.json(await sessionPayload(user.username, user.name, 'ldap'));
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
    res.json(await sessionPayload(user.username, user.name, 'sso'));
  } catch (err) {
    res.status(401).json({ error: `Jeton SSO invalide : ${err.message}` });
  }
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non authentifié.' });
  // defaultPassword : le compte « admin » tourne encore avec le mot de passe public livré
  // par l'installateur. L'application l'affiche en bandeau tant que c'est le cas.
  res.json(await sessionPayload(user.sub, user.name, user.method));
});

// --- Gestion des comptes locaux (réservée à l'administrateur : voir auth/admin.js) ---
authRouter.get('/local-users', requireAuth, requireAdmin, (_req, res) => {
  res.json(listLocalUsers());
});

authRouter.post('/local-users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères.' });
  await upsertLocalUser(username, password, name);
  res.json({ ok: true });
});

authRouter.delete('/local-users/:username', requireAuth, requireAdmin, (req, res) => {
  const cible = req.params.username;
  // Depuis que la configuration est réservée aux administrateurs, supprimer le dernier
  // compte local administrateur n'enlève pas un compte : cela rend l'application
  // définitivement inconfigurable depuis elle-même. Il faudrait alors repasser par une
  // console serveur élevée (Repair-SuiviInfraLogin.ps1) pour s'en sortir. On refuse.
  if (isAdminUsername(cible)) {
    const restants = listLocalUsers().filter(
      (u) => isAdminUsername(u.username) && u.username.toLowerCase() !== String(cible).toLowerCase()
    );
    if (restants.length === 0) {
      return res.status(409).json({
        error:
          "Impossible de supprimer le dernier compte administrateur : plus personne ne pourrait configurer l'application. Créez d'abord un autre administrateur.",
      });
    }
  }
  removeLocalUser(cible);
  res.json({ ok: true });
});

// --- Configuration LDAP (réservée à l'administrateur) ---
authRouter.get('/ldap-config', requireAuth, requireAdmin, (_req, res) => {
  res.json(getLdapConfig());
});

authRouter.put('/ldap-config', requireAuth, requireAdmin, (req, res) => {
  const { enabled, url, userDnPattern } = req.body || {};
  const next = setLdapConfig({ enabled: Boolean(enabled), url: url || '', userDnPattern: userDnPattern || '' });
  res.json(next);
});
