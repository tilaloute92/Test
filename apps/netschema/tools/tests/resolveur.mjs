/**
 * Résolveur de modules pour les tests.
 *
 * Le code source importe sans extension (`./catalog`, `../types`), parce que c'est Vite
 * qui résout à la compilation. Node, lui, exige le chemin exact. Plutôt que de réécrire
 * des centaines d'imports pour faire plaisir au lanceur de tests — ce qui changerait le
 * code de production pour les besoins du test, mauvaise affaire — on apprend à Node la
 * même convention : un chemin relatif sans extension désigne un `.ts`, ou un `.tsx`.
 *
 * Node exécute les .ts nativement depuis la 22.6 (types effacés, pas compilés).
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    for (const extension of EXTENSIONS) {
      try {
        const candidat = new URL(specifier + extension, context.parentURL)
        if (existsSync(fileURLToPath(candidat))) {
          return { url: candidat.href, shortCircuit: true, format: 'module-typescript' }
        }
      } catch {
        /* spécificateur non résoluble ici : on laisse Node décider */
      }
    }
  }
  return nextResolve(specifier, context)
}
