import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Tests de l'API.
 *
 * Ils démarrent le vrai serveur sur un dossier de données jetable et parlent HTTP : ce qui
 * est vérifié ici est exactement ce qu'un navigateur — ou un attaquant — obtiendrait.
 */

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const dataDir = mkdtempSync(resolve(tmpdir(), 'netschema-test-'))
const PASSWORD = 'Motdepasse-2026!'

let server
let base

/** Petit client HTTP qui garde les cookies, comme le ferait un navigateur. */
function makeClient() {
  const jar = new Map()
  const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')

  return {
    get csrf() {
      return jar.get('netschema_csrf') ?? ''
    },
    async call(path, options = {}) {
      const headers = { ...(options.headers ?? {}) }
      if (options.body) headers['Content-Type'] = 'application/json'
      if (jar.size > 0) headers.Cookie = cookieHeader()
      if (options.method && !['GET', 'HEAD'].includes(options.method) && options.csrf !== false) {
        headers['X-CSRF-Token'] = options.csrf ?? jar.get('netschema_csrf') ?? ''
      }
      const response = await fetch(`${base}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      })
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';')
        const index = pair.indexOf('=')
        const name = pair.slice(0, index)
        const value = pair.slice(index + 1)
        if (value === '') jar.delete(name)
        else jar.set(name, value)
      }
      const text = await response.text()
      return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null }
    },
  }
}

before(async () => {
  execFileSync(process.execPath, ['tools/netschema-user.mjs', 'add', 'chef', '--role', 'admin', '--password', PASSWORD], {
    cwd: packageRoot,
    env: { ...process.env, NETSCHEMA_DATA_DIR: dataDir },
  })
  execFileSync(process.execPath, ['tools/netschema-user.mjs', 'add', 'invite', '--role', 'lecteur', '--password', PASSWORD], {
    cwd: packageRoot,
    env: { ...process.env, NETSCHEMA_DATA_DIR: dataDir },
  })

  const { spawn } = await import('node:child_process')
  server = spawn(process.execPath, ['dist/index.js'], {
    cwd: packageRoot,
    env: {
      ...process.env,
      NETSCHEMA_DATA_DIR: dataDir,
      NETSCHEMA_HOST: '127.0.0.1',
      NETSCHEMA_PORT: '8123',
      NETSCHEMA_WEB_DIR: resolve(dataDir, 'aucune-interface'),
    },
    stdio: 'ignore',
  })
  base = 'http://127.0.0.1:8123'
  // Attente active courte : le serveur démarre en quelques dizaines de millisecondes.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return
    } catch {
      /* pas encore prêt */
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error('Le serveur de test n’a pas démarré.')
})

after(() => {
  server?.kill()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('authentification', () => {
  it('refuse l’accès aux schémas sans session', async () => {
    const client = makeClient()
    const response = await client.call('/api/diagrams')
    assert.equal(response.status, 401)
  })

  it('refuse une écriture sans jeton anti-CSRF', async () => {
    const client = makeClient()
    await client.call('/api/session')
    const response = await client.call('/api/login', {
      method: 'POST',
      body: { username: 'chef', password: PASSWORD },
      csrf: false,
    })
    assert.equal(response.status, 403)
  })

  it('ne distingue pas un compte inconnu d’un mot de passe faux', async () => {
    const client = makeClient()
    await client.call('/api/session')
    const inconnu = await client.call('/api/login', { method: 'POST', body: { username: 'fantome', password: PASSWORD } })
    const faux = await client.call('/api/login', { method: 'POST', body: { username: 'chef', password: 'incorrect' } })
    assert.equal(inconnu.status, 401)
    assert.equal(faux.status, 401)
    assert.equal(inconnu.body.error, faux.body.error)
  })

  it('ouvre une session valide et la referme', async () => {
    const client = makeClient()
    await client.call('/api/session')
    const login = await client.call('/api/login', { method: 'POST', body: { username: 'chef', password: PASSWORD } })
    assert.equal(login.status, 200)
    assert.equal(login.body.user.role, 'admin')

    const session = await client.call('/api/session')
    assert.equal(session.body.authenticated, true)

    await client.call('/api/logout', { method: 'POST' })
    const after = await client.call('/api/session')
    assert.equal(after.body.authenticated, false)
  })
})

describe('schémas', () => {
  async function signIn(username) {
    const client = makeClient()
    await client.call('/api/session')
    const login = await client.call('/api/login', { method: 'POST', body: { username, password: PASSWORD } })
    assert.equal(login.status, 200)
    return client
  }

  it('crée, relit et enregistre un schéma', async () => {
    const client = await signIn('chef')
    const created = await client.call('/api/diagrams', {
      method: 'POST',
      body: { title: 'Siège', diagram: { title: 'Siège', nodes: [], links: [] } },
    })
    assert.equal(created.status, 201)

    const read = await client.call(`/api/diagrams/${created.body.id}`)
    assert.equal(read.status, 200)
    assert.equal(read.body.title, 'Siège')

    const saved = await client.call(`/api/diagrams/${created.body.id}`, {
      method: 'PUT',
      body: { version: read.body.version, diagram: { title: 'Siège', nodes: [{ id: 'n1', kind: 'firewall', name: 'FW', x: 0, y: 0 }], links: [] } },
    })
    assert.equal(saved.status, 200)
    assert.notEqual(saved.body.version, read.body.version)
  })

  it('refuse d’écraser une modification concurrente', async () => {
    const client = await signIn('chef')
    const created = await client.call('/api/diagrams', {
      method: 'POST',
      body: { title: 'Concurrence', diagram: { title: 'Concurrence', nodes: [], links: [] } },
    })
    const first = await client.call(`/api/diagrams/${created.body.id}`, {
      method: 'PUT',
      body: { version: created.body.version, diagram: { title: 'Concurrence', nodes: [], links: [], vlans: [] } },
    })
    assert.equal(first.status, 200)

    const stale = await client.call(`/api/diagrams/${created.body.id}`, {
      method: 'PUT',
      body: { version: created.body.version, diagram: { title: 'Concurrence', nodes: [], links: [] } },
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.version, first.body.version)
  })

  it('interdit l’écriture à un lecteur', async () => {
    const lecteur = await signIn('invite')
    const list = await lecteur.call('/api/diagrams')
    assert.equal(list.status, 200)

    const refus = await lecteur.call('/api/diagrams', {
      method: 'POST',
      body: { title: 'Interdit', diagram: { title: 'Interdit', nodes: [], links: [] } },
    })
    assert.equal(refus.status, 403)

    const suppression = await lecteur.call(`/api/diagrams/${list.body.diagrams[0].id}`, { method: 'DELETE' })
    assert.equal(suppression.status, 403)
  })

  it('rejette un identifiant qui tente de sortir du dossier', async () => {
    const client = await signIn('chef')
    const response = await client.call('/api/diagrams/..%2f..%2fusers')
    assert.ok(response.status === 404 || response.status === 400)
  })

  it('rejette un contenu qui n’est pas un schéma', async () => {
    const client = await signIn('chef')
    const response = await client.call('/api/diagrams', { method: 'POST', body: { title: 'X', diagram: { nodes: 'non' } } })
    assert.equal(response.status, 400)
  })

  it('neutralise les clés dangereuses du JSON reçu', async () => {
    const client = await signIn('chef')
    const created = await client.call('/api/diagrams', {
      method: 'POST',
      body: {
        title: 'Pollution',
        diagram: JSON.parse('{"title":"Pollution","nodes":[],"links":[],"__proto__":{"pollue":true}}'),
      },
    })
    assert.equal(created.status, 201)
    const read = await client.call(`/api/diagrams/${created.body.id}`)
    assert.equal(JSON.stringify(read.body.diagram).includes('pollue'), false)
    assert.equal({}.pollue, undefined)
  })
})

describe('en-têtes de sécurité', () => {
  it('interdit le cadrage et restreint les sources', async () => {
    const client = makeClient()
    const response = await client.call('/api/health')
    const csp = response.headers.get('content-security-policy') ?? ''
    assert.match(csp, /frame-ancestors 'none'/)
    assert.match(csp, /default-src 'self'/)
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('x-powered-by'), null)
  })
})
