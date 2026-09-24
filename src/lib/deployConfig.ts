/**
 * Configuration de déploiement, posée par l'installateur dans app-config.js et lue avant
 * tout le reste (voir index.html).
 *
 * Elle répond à une seule question : cette installation comporte-t-elle le service ? La
 * réponse ne peut pas venir d'une détection à chaud, puisque c'est justement quand le
 * service ne répond plus qu'il faut savoir s'il aurait dû répondre.
 */

declare global {
  interface Window {
    __SUIVI_INFRA__?: { requireServer?: boolean };
  }
}

/**
 * Vrai quand l'installation a été faite avec le service. L'application refuse alors de
 * fonctionner en autonome : plutôt que de s'ouvrir sans authentification sur les données du
 * navigateur, elle annonce que le serveur est indisponible.
 */
export function requiresServer(): boolean {
  return typeof window !== 'undefined' && window.__SUIVI_INFRA__?.requireServer === true;
}
