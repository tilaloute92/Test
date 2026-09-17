import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import compression from 'compression'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import type { Config } from './config.ts'
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  clearSessionCookies,
  cookies,
  createSessionCookie,
  newCsrfToken,
  readSessionCookie,
  sameToken,
  setSessionCookies,
} from './auth/sessions.ts'
import { ROLES, UserStore, publicUser, type Role, type User } from './auth/users.ts'
import { AuditLog } from './store/audit.ts'
import { DiagramStore, checkDiagram } from './store/diagrams.ts'

/**
 * Application web et API.
 *
 * Un seul processus sert l'application compilée et son API : c'est ce qui rend l'installation
 * sur un serveur Windows tenable — un service, un port, un dossier de données. La sécurité
 * est posée en couches successives dès l'entrée : en-têtes stricts, limite de taille, limite
 * de cadence, session signée, jeton anti-CSRF, puis seulement les routes.
 */

declare module 'express-serve-static-core' {
  interface Request {
    /** Compte authentifié, posé par le contrôle de session. */
    user?: User
  }
}

const RANKS: Record<Role, number> = { lecteur: 1, editeur: 2, admin: 3 }

export interface Services {
  config: Config
  users: UserStore
  diagrams: DiagramStore
  audit: AuditLog
}

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'inconnue'
}

export function createApp(services: Services) {
  const { config, users, diagrams, audit } = services
  const app = express()

  // Derrière IIS/ARR, l'adresse réelle du client est dans X-Forwarded-For : sans cette
  // option, la limitation de cadence compterait tout le monde comme une seule adresse.
  app.set('trust proxy', config.trustProxy ? 1 : false)
  app.disable('x-powered-by')

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Les composants du schéma portent des attributs `style` : c'est ce que couvre
          // styleSrcAttr. Les feuilles, elles, restent limitées aux fichiers du serveur.
          styleSrc: ["'self'"],
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          // Cette directive n'a de sens qu'en HTTPS : posée sur une installation en clair
          // sur le réseau interne, elle ferait basculer les requêtes vers un https absent.
          ...(config.secureCookies ? {} : { upgradeInsecureRequests: null }),
        },
      },
      frameguard: { action: 'deny' },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'same-origin' },
      hsts: config.secureCookies ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  )
  /**
   * Permissions-Policy : l'application dicte des commandes, elle a donc besoin du microphone.
   * Tout le reste — caméra, position, capteurs, paiement — lui est refusé, y compris à un
   * script qui aurait trouvé le moyen de s'y exécuter.
   */
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'microphone=(self), camera=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()',
    )
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
    next()
  })

  app.use(compression())
  app.use(express.json({ limit: config.maxBodyBytes }))

  /**
   * Un corps annoncé en JSON mais illisible est une requête forgée, pas une panne : on répond
   * proprement plutôt que de laisser remonter une pile d'exception.
   */
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error && typeof error === 'object' && 'type' in error) {
      const type = (error as { type?: string }).type
      if (type === 'entity.too.large') {
        res.status(413).json({ error: 'Contenu trop volumineux.' })
        return
      }
      if (type === 'entity.parse.failed') {
        res.status(400).json({ error: 'JSON invalide.' })
        return
      }
    }
    next(error)
  })

  // ── Session ────────────────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    const payload = readSessionCookie(cookies(req)[SESSION_COOKIE], config.sessionSecret)
    if (payload) {
      const user = users.findById(payload.sub)
      // Le cookie ne vaut que pour la génération de session en cours : un mot de passe changé
      // ou un compte désactivé invalident aussitôt ce qui a été émis avant.
      const generation = user?.sessionGeneration ?? 0
      if (user && !user.disabled && (payload.gen ?? 0) === generation) req.user = user
    }
    next()
  })

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentification requise.' })
      return
    }
    next()
  }

  const requireRole = (role: Role) => (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || RANKS[req.user.role] < RANKS[role]) {
      res.status(403).json({ error: 'Droits insuffisants.' })
      return
    }
    next()
  }

  /**
   * Anti-CSRF sur toute écriture : le jeton du cookie doit être répété dans l'en-tête, ce
   * qu'une page tierce ne peut pas faire. Les lectures n'en ont pas besoin.
   */
  const requireCsrf = (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next()
      return
    }
    const header = req.get(CSRF_HEADER) ?? undefined
    if (!sameToken(header, cookies(req)[CSRF_COOKIE])) {
      res.status(403).json({ error: 'Jeton de sécurité absent ou invalide. Rechargez la page.' })
      return
    }
    next()
  }

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.loginAttempts,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' },
  })

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Trop de requêtes.' },
  })

  const api = express.Router()
  api.use(apiLimiter)
  api.use(requireCsrf)

  // ── Séance ─────────────────────────────────────────────────────────────────
  api.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'netschema', time: new Date().toISOString() })
  })

  api.get('/session', (req, res) => {
    const csrf = cookies(req)[CSRF_COOKIE] ?? newCsrfToken()
    if (!cookies(req)[CSRF_COOKIE]) {
      res.append(
        'Set-Cookie',
        `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Strict; Max-Age=${config.sessionMinutes * 60}${
          config.secureCookies ? '; Secure' : ''
        }`,
      )
    }
    res.json({
      mode: 'server',
      authenticated: Boolean(req.user),
      user: req.user ? publicUser(req.user) : null,
      // Première mise en route : tant qu'aucun compte n'existe, la page de connexion
      // explique quoi taper sur le serveur plutôt que de laisser un compte par défaut.
      setupRequired: users.count() === 0,
      csrfToken: csrf,
    })
  })

  api.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown }
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      res.status(400).json({ error: 'Identifiant et mot de passe attendus.' })
      return
    }

    const result = await users.authenticate(username, password, {
      lockAfterFailures: config.lockAfterFailures,
      lockMinutes: config.lockMinutes,
    })
    if (!result.ok) {
      audit.write('login-refuse', { username, ip: clientIp(req), reason: result.reason })
      const message =
        result.reason === 'locked'
          ? `Compte bloqué temporairement (${config.lockMinutes} minutes) après trop d'échecs.`
          : result.reason === 'disabled'
            ? 'Compte désactivé.'
            : 'Identifiant ou mot de passe incorrect.'
      res.status(401).json({ error: message })
      return
    }

    const csrf = newCsrfToken()
    setSessionCookies(
      res,
      createSessionCookie(
        result.user.id,
        config.sessionSecret,
        config.sessionMinutes,
        result.user.sessionGeneration ?? 0,
      ),
      csrf,
      { secure: config.secureCookies, minutes: config.sessionMinutes },
    )
    audit.write('login', { username: result.user.username, ip: clientIp(req) })
    res.json({ user: publicUser(result.user), csrfToken: csrf })
  })

  api.post('/logout', (req, res) => {
    if (req.user) audit.write('logout', { username: req.user.username, ip: clientIp(req) })
    clearSessionCookies(res, config.secureCookies)
    res.json({ ok: true })
  })

  api.post('/password', requireAuth, async (req, res) => {
    const { current, next } = (req.body ?? {}) as { current?: unknown; next?: unknown }
    if (typeof current !== 'string' || typeof next !== 'string') {
      res.status(400).json({ error: 'Mot de passe actuel et nouveau mot de passe attendus.' })
      return
    }
    const check = await users.authenticate(req.user!.username, current, {
      lockAfterFailures: config.lockAfterFailures,
      lockMinutes: config.lockMinutes,
    })
    if (!check.ok) {
      res.status(401).json({ error: 'Mot de passe actuel incorrect.' })
      return
    }
    try {
      await users.setPassword(req.user!.username, next)
      audit.write('compte-modifie', { username: req.user!.username, ip: clientIp(req), action: 'mot-de-passe' })
      res.json({ ok: true })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Mot de passe refusé.' })
    }
  })

  // ── Schémas ────────────────────────────────────────────────────────────────
  api.get('/diagrams', requireAuth, (_req, res) => {
    res.json({ diagrams: diagrams.list() })
  })

  api.post('/diagrams', requireAuth, requireRole('editeur'), (req, res) => {
    const { title, diagram } = (req.body ?? {}) as { title?: unknown; diagram?: unknown }
    const checked = checkDiagram(diagram ?? { title: 'Nouveau schéma réseau', nodes: [], links: [] })
    if (!checked.ok) {
      res.status(400).json({ error: checked.error })
      return
    }
    const name = typeof title === 'string' && title.trim() ? title.trim() : 'Nouveau schéma réseau'
    const created = diagrams.create(name, checked.diagram, req.user!.username)
    audit.write('schema-cree', { id: created.record.id, title: name, username: req.user!.username })
    res.status(201).json({ id: created.record.id, version: created.version, record: created.record })
  })

  api.get('/diagrams/:id', requireAuth, (req, res) => {
    const id = String(req.params.id ?? '')
    const found = diagrams.get(id)
    if (!found) {
      res.status(404).json({ error: 'Schéma introuvable.' })
      return
    }
    res.json({ ...found.record, version: found.version })
  })

  api.put('/diagrams/:id', requireAuth, requireRole('editeur'), (req, res) => {
    const { diagram, version: expected, title } = (req.body ?? {}) as {
      diagram?: unknown
      version?: unknown
      title?: unknown
    }
    const checked = checkDiagram(diagram)
    if (!checked.ok) {
      res.status(400).json({ error: checked.error })
      return
    }
    const id = String(req.params.id ?? '')
    const result = diagrams.update(
      id,
      checked.diagram,
      req.user!.username,
      typeof expected === 'string' ? expected : undefined,
      typeof title === 'string' ? title : undefined,
    )
    if (!result) {
      res.status(404).json({ error: 'Schéma introuvable.' })
      return
    }
    if (!result.ok) {
      res.status(409).json({
        error: 'Le schéma a été modifié entre-temps par quelqu’un d’autre. Rechargez-le avant d’enregistrer.',
        version: result.version,
      })
      return
    }
    audit.write('schema-modifie', {
      id,
      title: result.record.title,
      username: req.user!.username,
    })
    res.json({ version: result.version, updatedAt: result.record.updatedAt, updatedBy: result.record.updatedBy })
  })

  api.delete('/diagrams/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = String(req.params.id ?? '')
    const removed = diagrams.remove(id)
    if (!removed) {
      res.status(404).json({ error: 'Schéma introuvable.' })
      return
    }
    audit.write('schema-supprime', { id, username: req.user!.username })
    res.json({ ok: true })
  })

  // ── Comptes (administration) ───────────────────────────────────────────────
  api.get('/users', requireAuth, requireRole('admin'), (_req, res) => {
    res.json({
      users: users.list().map((user) => ({
        ...publicUser(user),
        disabled: user.disabled === true,
        lastLoginAt: user.lastLoginAt ?? null,
        lockedUntil: user.lockedUntil ?? null,
      })),
    })
  })

  api.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
    const { username, password, displayName, role } = (req.body ?? {}) as Record<string, unknown>
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Identifiant et mot de passe attendus.' })
      return
    }
    try {
      const created = await users.create({
        username,
        password,
        displayName: typeof displayName === 'string' ? displayName : undefined,
        role: ROLES.includes(role as Role) ? (role as Role) : 'editeur',
      })
      audit.write('compte-modifie', {
        username: created.username,
        by: req.user!.username,
        action: 'creation',
      })
      res.status(201).json({ user: publicUser(created) })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Création refusée.' })
    }
  })

  /**
   * Modification d'un compte : rôle, activation, mot de passe.
   *
   * Un administrateur ne peut ni se retirer son propre rôle ni se désactiver : c'est la façon
   * la plus courante de se fermer la porte d'un serveur, et elle se répare mal.
   */
  api.patch('/users/:username', requireAuth, requireRole('admin'), async (req, res) => {
    const cible = String(req.params.username ?? '')
    const { role, disabled, password } = (req.body ?? {}) as Record<string, unknown>
    const soiMeme = cible.toLowerCase() === req.user!.username.toLowerCase()
    try {
      if (typeof role === 'string') {
        if (!ROLES.includes(role as Role)) {
          res.status(400).json({ error: 'Rôle inconnu.' })
          return
        }
        if (soiMeme && role !== 'admin') {
          res.status(400).json({ error: 'Un administrateur ne peut pas se retirer son propre rôle.' })
          return
        }
        users.setRole(cible, role as Role)
      }
      if (typeof disabled === 'boolean') {
        if (soiMeme && disabled) {
          res.status(400).json({ error: 'Un administrateur ne peut pas désactiver son propre compte.' })
          return
        }
        users.setDisabled(cible, disabled)
      }
      if (typeof password === 'string') await users.setPassword(cible, password)

      audit.write('compte-modifie', {
        username: cible,
        by: req.user!.username,
        ip: clientIp(req),
        action: [
          typeof role === 'string' ? `role:${role}` : null,
          typeof disabled === 'boolean' ? (disabled ? 'desactivation' : 'activation') : null,
          typeof password === 'string' ? 'mot-de-passe' : null,
        ]
          .filter(Boolean)
          .join(' '),
      })
      res.json({ ok: true })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Modification refusée.' })
    }
  })

  api.delete('/users/:username', requireAuth, requireRole('admin'), (req, res) => {
    const cible = String(req.params.username ?? '')
    if (cible.toLowerCase() === req.user!.username.toLowerCase()) {
      res.status(400).json({ error: 'Un administrateur ne peut pas supprimer son propre compte.' })
      return
    }
    try {
      users.remove(cible)
      audit.write('compte-modifie', {
        username: cible,
        by: req.user!.username,
        ip: clientIp(req),
        action: 'suppression',
      })
      res.json({ ok: true })
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Suppression refusée.' })
    }
  })

  api.use((_req, res) => {
    res.status(404).json({ error: 'Route inconnue.' })
  })

  app.use('/api', api)

  // ── Application web ────────────────────────────────────────────────────────
  if (existsSync(config.webDir)) {
    // Les fichiers produits par le build portent une empreinte dans leur nom : ils peuvent
    // être gardés en cache un an. `index.html`, lui, ne doit jamais l'être, sinon une mise à
    // jour du serveur reste invisible pour les navigateurs déjà venus.
    app.use(
      express.static(config.webDir, {
        index: false,
        etag: true,
        maxAge: '1y',
        setHeaders: (res, path) => {
          if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
        },
      }),
    )
    app.get(/.*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(resolve(config.webDir, 'index.html'))
    })
  } else {
    app.get(/.*/, (_req, res) => {
      res
        .status(503)
        .type('text/plain; charset=utf-8')
        .send(
          `Application web introuvable dans ${config.webDir}.\n` +
            'Compilez-la (npm run build dans apps/netschema) ou réglez NETSCHEMA_WEB_DIR.',
        )
    })
  }

  // Dernier filet : une erreur inattendue ne doit jamais renvoyer de pile au client.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[netschema] erreur non gérée :', error)
    if (res.headersSent) return
    res.status(500).json({ error: 'Erreur interne du serveur.' })
  })

  return app
}
