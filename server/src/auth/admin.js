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

/**
 * TROIS RÔLES depuis le passage au multi-équipe :
 *
 * - ADMINISTRATEUR DE PLATEFORME : crée les équipes, affecte les gens, règle le relais
 *   SMTP et l'annuaire. Il est seul à pouvoir basculer d'une équipe à l'autre. C'est
 *   l'ancien « admin », dont le périmètre ne change pas — il s'élargit aux équipes.
 * - RÉFÉRENT D'ÉQUIPE : règle ce qui appartient à SON équipe — seuil de présence, météo,
 *   créneaux récurrents, destinataires du rapport. Il ne voit rien des autres.
 * - MEMBRE : saisit, comme avant.
 *
 * Les référents sont déclarés dans config.json, clé `referents` : { "<equipe>": ["qui"] }.
 */

/** Les référents déclarés pour une équipe. */
export function listerReferents(equipe) {
  const tout = readJson(CONFIG_FILE, {})?.referents;
  const liste = tout && typeof tout === 'object' ? tout[equipe] : null;
  return Array.isArray(liste) ? liste.filter((v) => typeof v === 'string' && v.trim()).map((n) => n.trim().toLowerCase()) : [];
}

export function estReferent(username, equipe) {
  if (!username || !equipe) return false;
  if (isAdminUsername(username)) return true;
  return listerReferents(equipe).includes(String(username).toLowerCase());
}

/**
 * Middleware : exige d'être référent de l'équipe courante, ou administrateur de
 * plateforme. À placer APRÈS requireAuth et le middleware d'équipe.
 */
export function requireReferent(req, res, next) {
  if (!estReferent(req.user?.sub, req.equipe)) {
    return res.status(403).json({
      error: "Réservé au référent de l'équipe et à l'administrateur de la plateforme.",
    });
  }
  next();
}

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
      error:
        "Réservé à l'administrateur de la plateforme. Seul « admin » peut modifier la configuration de l'application et gérer les équipes.",
    });
  }
  next();
}

/** Nom explicite du même garde, là où c'est bien de la plateforme qu'il s'agit. */
export { requireAdmin as requirePlateforme };
