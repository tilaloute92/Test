/**
 * Configuration posée par l'installateur, lue avant le démarrage de l'application.
 *
 * requireServer : l'installation comporte-t-elle le service (scénario B) ?
 *   true  -> l'application EXIGE le service. Si celui-ci ne répond pas, elle affiche
 *            « Serveur indisponible » au lieu de basculer en autonome. Sans cette garantie,
 *            une panne du relais /api ouvrirait l'application à tout le monde, sans
 *            authentification et sur les données du navigateur : exactement ce qu'une
 *            installation client/serveur cherche à empêcher.
 *   false -> installation autonome (scénario A), comportement historique.
 *
 * Ce fichier est réécrit par Install-SuiviInfra.ps1 à chaque installation ; ne le modifiez
 * pas à la main, il serait écrasé.
 */
window.__SUIVI_INFRA__ = { requireServer: false };
