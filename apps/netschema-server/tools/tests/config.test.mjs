import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { after, describe, it } from 'node:test'

/**
 * Tests de la configuration et des cookies.
 *
 * Ils portent sur les deux endroits où une donnée abîmée — un fichier de secret tronqué, un
 * cookie mal encodé — pourrait soit ouvrir la porte, soit la condamner.
 */

const { loadConfig } = await import('../../dist/config.js')
const { cookies } = await import('../../dist/auth/sessions.js')

const dossiers = []
function dossierJetable() {
  const dir = mkdtempSync(resolve(tmpdir(), 'netschema-conf-'))
  dossiers.push(dir)
  return dir
}

after(() => {
  for (const dir of dossiers) rmSync(dir, { recursive: true, force: true })
})

/** Exécute une fonction avec un environnement maîtrisé, puis rend l'ancien. */
function avecEnv(variables, action) {
  const avant = {}
  for (const [cle, valeur] of Object.entries(variables)) {
    avant[cle] = process.env[cle]
    if (valeur === undefined) delete process.env[cle]
    else process.env[cle] = valeur
  }
  try {
    return action()
  } finally {
    for (const [cle, valeur] of Object.entries(avant)) {
      if (valeur === undefined) delete process.env[cle]
      else process.env[cle] = valeur
    }
  }
}

describe('secret de session', () => {
  it('en génère un, assez long, à la première mise en route', () => {
    const dir = dossierJetable()
    const config = avecEnv({ NETSCHEMA_DATA_DIR: dir, NETSCHEMA_SESSION_SECRET: undefined }, loadConfig)
    assert.ok(config.sessionSecret.length >= 32, `secret de ${config.sessionSecret.length} caractères`)
    const fichier = resolve(dir, 'session-secret.key')
    assert.ok(existsSync(fichier))
    assert.equal(readFileSync(fichier, 'utf8').trim(), config.sessionSecret)
  })

  it('reprend le secret déjà enregistré au redémarrage', () => {
    const dir = dossierJetable()
    const premier = avecEnv({ NETSCHEMA_DATA_DIR: dir, NETSCHEMA_SESSION_SECRET: undefined }, loadConfig)
    const second = avecEnv({ NETSCHEMA_DATA_DIR: dir, NETSCHEMA_SESSION_SECRET: undefined }, loadConfig)
    assert.equal(second.sessionSecret, premier.sessionSecret)
  })

  it('refuse de démarrer sur un fichier de secret vide ou tronqué', () => {
    // Disque plein, copie interrompue, restauration partielle : signer les sessions avec
    // une clé vide les rendrait toutes forgeables. Mieux vaut ne pas démarrer.
    for (const contenu of ['', '   ', 'court']) {
      const dir = dossierJetable()
      writeFileSync(resolve(dir, 'session-secret.key'), contenu, 'utf8')
      assert.throws(
        () => avecEnv({ NETSCHEMA_DATA_DIR: dir, NETSCHEMA_SESSION_SECRET: undefined }, loadConfig),
        /vide ou tronqué/,
        `contenu « ${contenu} »`,
      )
    }
  })

  it('refuse un secret d’environnement trop court', () => {
    const dir = dossierJetable()
    assert.throws(
      () => avecEnv({ NETSCHEMA_DATA_DIR: dir, NETSCHEMA_SESSION_SECRET: 'trop-court' }, loadConfig),
      /32 caractères/,
    )
  })
})

describe('origines de catalogue autorisées', () => {
  const lire = (valeur) => {
    const dir = dossierJetable()
    return avecEnv(
      { NETSCHEMA_DATA_DIR: dir, NETSCHEMA_SESSION_SECRET: 'x'.repeat(48), NETSCHEMA_CATALOG_ORIGINS: valeur },
      loadConfig,
    ).catalogOrigins
  }

  it('n’autorise rien par défaut', () => {
    assert.deepEqual(lire(undefined), [])
  })

  it('accepte plusieurs origines et retire les doublons', () => {
    assert.deepEqual(lire('https://depot.interne:8443, http://autre.lan'), [
      'https://depot.interne:8443',
      'http://autre.lan',
    ])
    assert.deepEqual(lire('https://a.lan https://a.lan'), ['https://a.lan'])
  })

  it('refuse un chemin, un joker ou une adresse invalide', () => {
    // Une directive connect-src trop large ne protège plus de rien : mieux vaut refuser
    // de démarrer que d’ouvrir en silence.
    assert.throws(() => lire('https://depot.interne/catalogue'), /origine seule/)
    assert.throws(() => lire('*'), /adresse valide/)
    assert.throws(() => lire('depot.interne'), /adresse valide/)
    assert.throws(() => lire('ftp://depot.interne'), /http:\/\/ ou https:\/\//)
  })
})

describe('lecture des cookies', () => {
  const lire = (entete) => cookies({ headers: { cookie: entete } })

  it('décode les valeurs encodées', () => {
    assert.deepEqual(lire('a=un%20deux'), { a: 'un deux' })
  })

  it('garde la valeur brute quand le décodage est impossible', () => {
    // Sans cette tolérance, decodeURIComponent levait une exception sur chaque requête et
    // le navigateur porteur du cookie recevait 500 partout, sans moyen de l’effacer.
    assert.deepEqual(lire('netschema_sid=%'), { netschema_sid: '%' })
    assert.deepEqual(lire('a=100%; b=ok'), { a: '100%', b: 'ok' })
  })

  it('ignore une en-tête absente ou sans signe égal', () => {
    assert.deepEqual(cookies({ headers: {} }), {})
    assert.deepEqual(lire('abc'), {})
  })
})
