import { readJson } from '../dataStore.js';

/**
 * Qui a le droit de modifier la CONFIGURATION de l'application — comptes locaux, annuaire
 * LDAP, paramètres de connexion. Les données d'équipe (tâches, planning, temps, absences)
 * ne sont pas concernées : tout le monde continue de les saisir.
 *
 * Cette distinction est appliquée ICI, côté serveur, et pas seulement en masquant des
 * boutons dans le navigateur. Masquer un bouton ne protège rien : la route reste appelable
 * à la main, et un utilisateur ordinaire pourrait se créer un compte ou rediriger
 * l'authentification vers un annuaire qu'il contrôle. Le navigateur masque pour la clarté,
 * le serveur refuse pour la sécurité.
 *
 * Le compte « admin » est administrateur par construction : c'est celui que l'installateur
 * crée, et le retirer laisserait une installation sans personne pour la configurer.
 * D'autres peuvent être ajoutés dans data/config.json sous la clé `admins`, ce qui permet
 * de donner ce droit à un compte LDAP nominatif sans toucher au code.
 */

const BUILT_IN_ADMIN = 'admin';
const CONFIG_FILE = 'config.json';

export function listAdmins() {
  const extra = readJson(CONFIG_FILE, {})?.admins;
  const noms = Array.isArray(extra) ? extra.filter((v) => typeof v === 'string' && v.trim()) : [];
  return [BUILT_IN_ADMIN, ...noms.map((n) => n.trim().toLowerCase())];
}

export function isAdminUsername(username) {
  if (!username) return false;
  return listAdmins().includes(String(username).toLowerCase());
}

/**
 * Middleware : exige une session ET que cette session soit administrateur. À placer APRÈS
 * requireAuth, qui renseigne req.user.
 *
 * Le droit est recalculé à chaque appel plutôt que lu dans le jeton de session : retirer
 * quelqu'un de la liste doit prendre effet tout de suite, et non à l'expiration de sa
 * session — qui dure dix heures par défaut.
 */
export function requireAdmin(req, res, next) {
  if (!isAdminUsername(req.user?.sub)) {
    return res.status(403).json({
      error: "Réservé au compte administrateur. Seul « admin » peut modifier la configuration de l'application.",
    });
  }
  next();
}
