/**
 * Enregistre le résolveur auprès de Node.
 *
 *   node --import ./tools/tests/charger.mjs --test tools/tests/*.test.mjs
 *
 * Deux fichiers plutôt qu'un : `register` doit tourner dans le fil principal, le résolveur
 * dans le fil des modules. Les mélanger ne marche pas, et l'erreur qu'on obtient alors ne
 * le dit pas.
 */
import { register } from 'node:module'
register('./resolveur.mjs', import.meta.url)
