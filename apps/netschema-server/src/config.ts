import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Configuration du serveur, lue une fois au démarrage.
 *
 * Tout se règle par variables d'environnement (fichier `.env` chargé au lancement sous
 * Windows par le script de service) : rien de sensible n'est écrit dans le code, et une
 * installation se déplace d'un serveur à l'autre en copiant un seul fichier.
 */

const here = dirname(fileURLToPath(import.meta.url))
/** Racine du paquet serveur, que l'on soit lancé depuis `src/` ou depuis `dist/`. */
const packageRoot = resolve(here, '..')

function env(name: string): string | undefined {
  const value = process.env[name]
  return value !== undefined && value.trim() !== '' ? value.trim() : undefined
}

function envNumber(name: string, fallback: number): number {
  const raw = env(name)
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} doit être un nombre positif (valeur lue : « ${raw} »).`)
  }
  return value
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = env(name)?.toLowerCase()
  if (!raw) return fallback
  return raw === '1' || raw === 'true' || raw === 'oui' || raw === 'yes'
}

function absolute(value: string): string {
  return isAbsolute(value) ? value : resolve(packageRoot, value)
}

/**
 * Secret de signature des sessions.
 *
 * Fourni par l'environnement en production. À défaut, il est tiré au hasard puis conservé
 * dans le dossier de données : redémarrer le service ne déconnecte pas tout le monde, et
 * personne n'a à inventer un secret à la main pour une première mise en route.
 */
function resolveSecret(dataDir: string): string {
  const provided = env('NETSCHEMA_SESSION_SECRET')
  if (provided) {
    if (provided.length < 32) {
      throw new Error('NETSCHEMA_SESSION_SECRET doit faire au moins 32 caractères.')
    }
    return provided
  }
  const file = resolve(dataDir, 'session-secret.key')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const secret = randomBytes(48).toString('base64url')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(file, secret, { encoding: 'utf8', mode: 0o600 })
  return secret
}

export interface Config {
  host: string
  port: number
  /** Dossier des données : comptes, schémas, journal d'audit. */
  dataDir: string
  /** Dossier de l'application web compilée (dist de `apps/netschema`). */
  webDir: string
  sessionSecret: string
  /** Durée de vie d'une session, en minutes. */
  sessionMinutes: number
  /** Certificat TLS : le serveur écoute en HTTPS dès que les deux fichiers sont fournis. */
  tlsCert?: string
  tlsKey?: string
  /**
   * Certificat au format PFX/PKCS#12 — celui qu'exporte le magasin Windows.
   * Il évite la conversion en PEM, qui demande OpenSSL sur un serveur qui n'en a pas.
   */
  tlsPfx?: string
  tlsPassphrase?: string
  /** Vrai dès qu'un certificat, sous une forme ou l'autre, est configuré. */
  https: boolean
  /** Derrière IIS/ARR ou un autre reverse proxy : on fait confiance à X-Forwarded-For. */
  trustProxy: boolean
  /** Cookies marqués Secure : automatique en HTTPS, forçable derrière un proxy TLS. */
  secureCookies: boolean
  /** Taille maximale d'un schéma envoyé, en octets. */
  maxBodyBytes: number
  /** Tentatives de connexion autorisées par fenêtre de 15 minutes et par adresse. */
  loginAttempts: number
  /** Nombre d'échecs consécutifs avant blocage temporaire d'un compte. */
  lockAfterFailures: number
  /** Durée du blocage d'un compte, en minutes. */
  lockMinutes: number
}

export function loadConfig(): Config {
  const dataDir = absolute(env('NETSCHEMA_DATA_DIR') ?? 'data')
  const webDir = absolute(env('NETSCHEMA_WEB_DIR') ?? '../netschema/dist')
  const tlsCert = env('NETSCHEMA_TLS_CERT')
  const tlsKey = env('NETSCHEMA_TLS_KEY')
  const tlsPfx = env('NETSCHEMA_TLS_PFX')
  const https = Boolean((tlsCert && tlsKey) || tlsPfx)

  return {
    host: env('NETSCHEMA_HOST') ?? '0.0.0.0',
    port: envNumber('NETSCHEMA_PORT', https ? 8443 : 8080),
    dataDir,
    webDir,
    sessionSecret: resolveSecret(dataDir),
    sessionMinutes: envNumber('NETSCHEMA_SESSION_MINUTES', 12 * 60),
    tlsCert,
    tlsKey,
    tlsPfx,
    tlsPassphrase: env('NETSCHEMA_TLS_PASSPHRASE'),
    https,
    trustProxy: envBool('NETSCHEMA_TRUST_PROXY', false),
    secureCookies: envBool('NETSCHEMA_SECURE_COOKIES', https),
    maxBodyBytes: envNumber('NETSCHEMA_MAX_BODY_BYTES', 8 * 1024 * 1024),
    loginAttempts: envNumber('NETSCHEMA_LOGIN_ATTEMPTS', 10),
    lockAfterFailures: envNumber('NETSCHEMA_LOCK_AFTER_FAILURES', 10),
    lockMinutes: envNumber('NETSCHEMA_LOCK_MINUTES', 15),
  }
}
