/**
 * Version de l'application.
 *
 * Elle est injectée au build depuis `package.json` (voir `vite.config.ts`) : une seule
 * source de vérité, la même que celle qui nomme le paquet d'installation. Un schéma qui
 * circule porte la version qui l'a produit — c'est ce qui permet, six mois plus tard, de
 * savoir avec quoi il a été fait quand quelque chose ne se relit pas comme prévu.
 */
declare const __APP_VERSION__: string | undefined

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0-dev'

/** « NetSchema 1.1.0 » — ce qui s'écrit dans un pied de page ou un cartouche. */
export const APP_SIGNATURE = `NetSchema ${APP_VERSION}`
