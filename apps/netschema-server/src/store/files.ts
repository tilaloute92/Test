import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * Persistance sur fichiers.
 *
 * Un serveur d'infrastructure doit pouvoir s'installer sur un Windows sans base de données à
 * administrer : les schémas sont des fichiers JSON, sauvegardés par une simple copie du
 * dossier de données et lisibles sans l'application. L'écriture passe toujours par un fichier
 * temporaire renommé ensuite, pour qu'une coupure ne laisse jamais un fichier à moitié écrit.
 */

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(dirname(file))
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, file)
}

/**
 * Identifiant de fichier sûr.
 *
 * Les identifiants viennent du client : ils ne doivent jamais pouvoir désigner autre chose
 * qu'un fichier du dossier prévu. On n'accepte donc qu'un jeu de caractères restreint, et on
 * vérifie en plus que le chemin résolu reste bien à l'intérieur.
 */
export function safeId(id: string): string | null {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

export function pathInside(root: string, name: string): string | null {
  const full = resolve(root, name)
  const prefix = resolve(root) + (resolve(root).endsWith('\\') || resolve(root).endsWith('/') ? '' : '/')
  return full === resolve(root) || full.startsWith(prefix) || full.startsWith(`${resolve(root)}\\`) ? full : null
}

/** Empreinte courte d'un contenu : sert de numéro de version pour détecter les conflits. */
export function version(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0, 16)
}
