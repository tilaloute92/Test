import { equipeEffective } from './appartenance.js';
import { isAdminUsername } from './admin.js';
import { equipeExiste, nomEquipe } from '../equipes.js';

/**
 * Le middleware qui pose `req.equipe`.
 *
 * C'EST LE POINT UNIQUE DU CLOISONNEMENT. L'équipe vient de la SESSION, et d'elle seule :
 * aucune route ne la lit dans un corps de requête, un paramètre d'URL ou un en-tête. Tout
 * le reste du serveur en dépend — les fonctions de businessData refusent d'ailleurs de
 * travailler sans elle plutôt que de retomber sur une valeur par défaut.
 *
 * LA SEULE EXCEPTION, et elle est étroite : l'administrateur de plateforme peut demander
 * à regarder une autre équipe, par l'en-tête `X-Equipe`. C'est ce qui lui permet de
 * dépanner sans se faire créer un compte dans chaque équipe. Le droit est vérifié ici, à
 * chaque requête, et l'en-tête est purement et simplement ignoré pour tous les autres —
 * un membre qui le forge n'obtient rien.
 */
export function equipeCourante(req, res, next) {
  const demandee = req.get('X-Equipe');
  if (demandee && isAdminUsername(req.user?.sub)) {
    if (!equipeExiste(demandee)) return res.status(404).json({ error: 'Équipe inconnue.' });
    req.equipe = demandee;
    req.equipeNom = nomEquipe(demandee);
    req.equipeEmpruntee = true;
    return next();
  }

  const equipe = equipeEffective(req.user?.sub);
  if (!equipe) {
    // Refus explicite plutôt que repli silencieux : servir « une » équipe à quelqu'un qui
    // n'en a pas, c'est lui montrer le travail de gens qui ne sont pas ses collègues.
    return res.status(403).json({
      error:
        "Aucune équipe ne vous est affectée. Demandez à l'administrateur de la plateforme de vous rattacher à une équipe.",
      sansEquipe: true,
    });
  }
  req.equipe = equipe;
  req.equipeNom = nomEquipe(equipe);
  req.equipeEmpruntee = false;
  next();
}
