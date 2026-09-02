import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const COOKIE_NAME = 'sitracker_session';

/**
 * Sessions signées (JWT) portées par un cookie httpOnly — inaccessible au
 * JavaScript de la page (donc pas volable par une éventuelle faille XSS côté
 * front), envoyé automatiquement par le navigateur à chaque appel à l'API.
 * C'est la même session quel que soit le moyen de connexion (local, LDAP,
 * SSO) : une fois émise, l'API ne sait plus par quelle méthode elle est
 * arrivée, seulement qui est l'utilisateur et jusqu'à quand la session est
 * valide.
 */

export function issueSession(res, user) {
  const token = jwt.sign(
    { sub: user.username, name: user.name, method: user.method },
    config.jwtSecret,
    { expiresIn: `${config.sessionHours}h` }
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: config.sessionHours * 3600 * 1000,
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME);
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Session invalide ou expirée.' });
  }
}

export function currentUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}
