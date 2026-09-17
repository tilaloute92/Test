import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'

/**
 * Sessions par cookie signé.
 *
 * Pas de session en mémoire : le cookie porte l'identifiant de compte et sa date
 * d'expiration, signés par le serveur. Redémarrer le service ne déconnecte personne, et deux
 * instances derrière un répartiteur partagent les sessions du moment qu'elles partagent le
 * secret — sans dépendre d'un magasin commun.
 *
 * Le jeton anti-CSRF suit le schéma « double soumission » : un cookie lisible par le script
 * et un en-tête que le navigateur ne pose jamais tout seul. Combiné à SameSite=Strict, une
 * page tierce ne peut ni forger la requête ni lire le jeton.
 */

export const SESSION_COOKIE = 'netschema_sid'
export const CSRF_COOKIE = 'netschema_csrf'
export const CSRF_HEADER = 'x-csrf-token'

export interface SessionPayload {
  /** Identifiant du compte. */
  sub: string
  /** Date d'expiration, en millisecondes epoch. */
  exp: number
  /**
   * Génération de session du compte. Changer le mot de passe ou désactiver un compte
   * l'incrémente : les cookies émis avant cessent aussitôt d'être acceptés, sans quoi un
   * mot de passe compromis resterait exploitable jusqu'à l'expiration.
   */
  gen?: number
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function createSessionCookie(
  userId: string,
  secret: string,
  minutes: number,
  generation = 0,
): string {
  const payload: SessionPayload = { sub: userId, exp: Date.now() + minutes * 60_000, gen: generation }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sign(body, secret)}`
}

export function readSessionCookie(raw: string | undefined, secret: string): SessionPayload | null {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null
  const body = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)

  const expected = Buffer.from(sign(body, secret))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function newCsrfToken(): string {
  return randomBytes(24).toString('base64url')
}

export function cookies(req: Request): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const jar: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name) jar[name] = decodeURIComponent(value)
  }
  return jar
}

interface CookieOptions {
  secure: boolean
  minutes: number
}

export function setSessionCookies(
  res: Response,
  session: string,
  csrf: string,
  { secure, minutes }: CookieOptions,
): void {
  const maxAge = minutes * 60
  const common = `Path=/; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
  res.append('Set-Cookie', `${SESSION_COOKIE}=${session}; HttpOnly; ${common}`)
  // Lisible par l'application : c'est ce jeton qu'elle renvoie en en-tête.
  res.append('Set-Cookie', `${CSRF_COOKIE}=${csrf}; ${common}`)
}

export function clearSessionCookies(res: Response, secure: boolean): void {
  const common = `Path=/; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
  res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; ${common}`)
  res.append('Set-Cookie', `${CSRF_COOKIE}=; ${common}`)
}

/** Comparaison à temps constant de deux jetons, tolérante aux longueurs différentes. */
export function sameToken(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
