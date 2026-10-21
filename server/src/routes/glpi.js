import { Router } from 'express';
import { requireAuth } from '../auth/session.js';
import { requireReferent } from '../auth/admin.js';
import { equipeCourante } from '../auth/equipeCourante.js';
import { getConfig, pourAffichage, setConfig, verifierCriteres } from '../glpi/config.js';
import { BUCKETS, detecterChamps, etat, historique, oublierCache, tester } from '../glpi/compteur.js';
import { criteresDepuisUrl } from '../glpi/rechercheUrl.js';

/**
 * Le compteur de tickets GLPI affiché dans « Ma journée ».
 *
 * Lecture : tout membre de l'équipe. Réglage : le référent de l'équipe (ou
 * l'administrateur de la plateforme) — c'est la file de SON équipe, personne d'autre
 * n'a à la désigner.
 */

export const glpiRouter = Router();

glpiRouter.use(requireAuth);
glpiRouter.use(equipeCourante);

/** Le relevé. Ne renvoie jamais d'erreur HTTP pour une panne de GLPI : l'état en dit
 *  assez, et une erreur 500 ferait clignoter l'écran d'accueil pour une tuile. */
glpiRouter.get('/tickets', async (req, res, next) => {
  try {
    res.json({ ...(await etat(req.equipe, req.user?.sub)), buckets: BUCKETS.map(({ cle, libelle }) => ({ cle, libelle })) });
  } catch (erreur) {
    next(erreur);
  }
});

/** L'historique quotidien, archivé depuis la mise en service. Rien ne l'affiche encore —
 *  voir le commentaire de `noterHistorique`. */
glpiRouter.get('/historique', requireReferent, (req, res) => {
  const jours = Number(req.query.jours);
  res.json({ lignes: historique(req.equipe, Number.isInteger(jours) && jours > 0 && jours <= 400 ? jours : 14) });
});

glpiRouter.get('/config', requireReferent, (req, res) => res.json(pourAffichage(getConfig(req.equipe))));

glpiRouter.put('/config', requireReferent, (req, res) => {
  try {
    const cfg = setConfig(req.equipe, req.body ?? {});
    // La configuration a changé : le relevé en mémoire porte sur l'ancienne file.
    oublierCache(req.equipe);
    res.json(pourAffichage(cfg));
  } catch (erreur) {
    res.status(400).json({ error: erreur.message });
  }
});

/**
 * Essai de raccordement. Les valeurs saisies à l'écran sont essayées TELLES QUELLES,
 * sans être enregistrées : on ne range pas dans la configuration de l'équipe un jeton
 * dont on ne sait pas encore s'il fonctionne.
 */
/**
 * La configuration à ESSAYER : les valeurs saisies à l'écran, complétées par celles déjà
 * enregistrées, et jamais écrites sur disque — on ne range pas dans la configuration de
 * l'équipe un jeton dont on ne sait pas encore s'il fonctionne. Un jeton laissé vide à
 * l'écran est celui déjà en place : la page ne les affiche pas, elle ne peut donc pas les
 * renvoyer.
 */
function configDEssai(req) {
  const enregistre = getConfig(req.equipe);
  const corps = req.body ?? {};
  const criteres = corps.criteres === undefined ? enregistre.criteres : verifierCriteres(corps.criteres);
  const texte = (valeur, defaut) => (typeof valeur === 'string' && valeur.trim() ? valeur.trim() : defaut);
  return {
    ...enregistre,
    url: texte(corps.url, enregistre.url),
    appToken: texte(corps.appToken, enregistre.appToken),
    userToken: texte(corps.userToken, enregistre.userToken),
    champStatut: Number(corps.champStatut) || enregistre.champStatut,
    champTechnicien: Number(corps.champTechnicien) || enregistre.champTechnicien,
    criteres,
  };
}

const RACCORDEMENT_INCOMPLET = "L'adresse de GLPI et les deux jetons sont nécessaires pour interroger l'instance.";

glpiRouter.post('/test', requireReferent, async (req, res) => {
  let cfg;
  try {
    cfg = configDEssai(req);
  } catch (erreur) {
    return res.status(400).json({ ok: false, error: erreur.message });
  }
  if (!cfg.url || !cfg.appToken || !cfg.userToken) return res.status(400).json({ ok: false, error: RACCORDEMENT_INCOMPLET });
  try {
    res.json(await tester(req.equipe, cfg, req.user?.sub));
  } catch (erreur) {
    // Un essai qui échoue est un résultat d'essai, pas une panne du serveur : 200 avec le
    // motif, que la page affiche tel quel.
    res.json({ ok: false, error: erreur.message });
  }
});

/**
 * Les numéros de champ, lus sur l'instance. Recopier ceux d'une documentation est le
 * moyen le plus sûr d'obtenir un compteur faux et plausible : les numéros dépendent de
 * la version et des plugins, et aucun message d'erreur ne signale une erreur de numéro.
 */
glpiRouter.post('/champs', requireReferent, async (req, res) => {
  let cfg;
  try {
    cfg = configDEssai(req);
  } catch (erreur) {
    return res.status(400).json({ ok: false, error: erreur.message });
  }
  if (!cfg.url || !cfg.appToken || !cfg.userToken) return res.status(400).json({ ok: false, error: RACCORDEMENT_INCOMPLET });
  try {
    res.json(await detecterChamps(cfg));
  } catch (erreur) {
    res.json({ ok: false, error: erreur.message });
  }
});

/**
 * Traduction d'une URL de recherche GLPI en critères. C'est le chemin le plus court pour
 * un réglage juste : on construit la recherche dans GLPI, où l'on voit les résultats, on
 * copie l'adresse, et le compteur compte exactement la même chose.
 */
glpiRouter.post('/criteres-depuis-url', requireReferent, (req, res) => {
  try {
    res.json({ criteres: verifierCriteres(criteresDepuisUrl(String(req.body?.url ?? ''))) });
  } catch (erreur) {
    res.status(400).json({ error: erreur.message });
  }
});
