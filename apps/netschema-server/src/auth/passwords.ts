import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * Empreintes de mots de passe.
 *
 * scrypt est fourni par Node lui-même : aucune dépendance native à compiler, ce qui compte
 * sur un serveur Windows où l'on ne veut ni Visual Studio Build Tools ni surprise à la mise
 * à jour. Les paramètres suivent les recommandations courantes (N=16384, r=8, p=1) et sont
 * inscrits dans l'empreinte : on pourra les durcir plus tard sans invalider l'existant.
 */

/** scrypt en promesse, options comprises (`promisify` perd la surcharge à quatre arguments). */
function scryptAsync(password: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((done, fail) => {
    scrypt(password, salt, length, options, (error, key) => (error ? fail(error) : done(key)))
  })
}

const N = 16384
const r = 8
const p = 1
const KEY_LENGTH = 64

/** Longueur minimale imposée à la création d'un compte. */
export const MIN_PASSWORD_LENGTH = 12

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p })
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`
}

/**
 * Vérification à temps constant. Une empreinte illisible renvoie « faux » plutôt qu'une
 * erreur : un fichier de comptes abîmé ne doit pas ouvrir la porte.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts
  const cost = Number(rawN)
  const block = Number(rawR)
  const parallel = Number(rawP)
  if (!Number.isFinite(cost) || !Number.isFinite(block) || !Number.isFinite(parallel)) return false

  const salt = Buffer.from(rawSalt ?? '', 'base64')
  const expected = Buffer.from(rawKey ?? '', 'base64')
  if (salt.length === 0 || expected.length === 0) return false

  try {
    const key = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N: cost,
      r: block,
      p: parallel,
      // scrypt refuse les coûts élevés sans cette marge mémoire.
      maxmem: 256 * 1024 * 1024,
    })
    return key.length === expected.length && timingSafeEqual(key, expected)
  } catch {
    return false
  }
}

/** Contrôle de robustesse minimal, appliqué à la création comme au changement. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`
  }
  if (password.length > 200) return 'Mot de passe trop long (200 caractères au plus).'
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length
  if (classes < 3) {
    return 'Le mot de passe doit mêler au moins trois catégories : minuscules, majuscules, chiffres, symboles.'
  }
  return null
}
