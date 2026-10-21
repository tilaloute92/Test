/**
 * L'équipe que le navigateur demande au serveur.
 *
 * En temps normal : AUCUNE. Le serveur sait à quelle équipe appartient la personne
 * connectée et sert celle-là — c'est tout l'intérêt de poser le cloisonnement côté
 * serveur plutôt que de le confier au navigateur.
 *
 * L'exception est l'administrateur de plateforme, qui peut regarder une autre équipe
 * pour dépanner. Son choix voyage dans l'en-tête `X-Equipe` de chaque appel. Le serveur
 * vérifie le droit À CHAQUE REQUÊTE : un membre ordinaire qui forgerait cet en-tête
 * n'obtiendrait rien de plus que son équipe. Ce module ne protège donc rien, il ne fait
 * que transporter une intention.
 *
 * Le choix survit au rechargement de la page — on dépanne rarement en un seul écran —
 * mais pas à la déconnexion.
 */

const CLE = 'suivi-infra:equipe-regardee';

let equipeRegardee: string | null = lireStockage();

function lireStockage(): string | null {
  try {
    return localStorage.getItem(CLE);
  } catch {
    return null;
  }
}

export function getEquipeRegardee(): string | null {
  return equipeRegardee;
}

export function setEquipeRegardee(equipe: string | null): void {
  equipeRegardee = equipe;
  try {
    if (equipe) localStorage.setItem(CLE, equipe);
    else localStorage.removeItem(CLE);
  } catch {
    // Stockage refusé : la bascule vaut pour la session en cours, elle ne survivra
    // simplement pas au rechargement.
  }
}

/** L'en-tête à joindre aux appels. Vide tant qu'on regarde sa propre équipe. */
export function enTeteEquipe(): Record<string, string> {
  return equipeRegardee ? { 'X-Equipe': equipeRegardee } : {};
}
