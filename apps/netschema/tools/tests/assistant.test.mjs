import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Assistant de conception : une description, un schéma.
 *
 * Ce qui est vérifié ici tient en une phrase : rien de ce qu'on demande ne doit disparaître
 * sans être signalé. La phrase d'exemple en tête du module perdait quatre équipements sur
 * douze — les hyperviseurs et leur témoin — et la liste des fragments non compris restait
 * vide. Un outil qui oublie en silence est pire qu'un outil qui refuse.
 */

const { analyserDescription, EXEMPLE_ASSISTANT } = await import('../../src/lib/assistant.ts')

const vide = { title: 't', nodes: [], links: [], vlans: [], racks: [] }
const n = (id, kind, name) => ({ id, kind, name, x: 0, y: 0 })
const reseau = {
  ...vide,
  nodes: [
    n('r1', 'router', 'RTR-01'), n('f1', 'firewall', 'FW-01'),
    n('c1', 'core-switch', 'SW-CORE-01'), n('c2', 'core-switch', 'SW-CORE-02'),
    n('a1', 'access-switch', 'SW-ACC-01'), n('a2', 'access-switch', 'SW-ACC-02'),
  ],
}

/** Compte des équipements créés, par type. */
function crees(texte, base = vide, options) {
  const plan = analyserDescription(texte, base, options)
  const parType = {}
  for (const op of plan.etapes.flatMap((etape) => etape.operations)) {
    if (op.type === 'noeud') parType[op.kind] = (parType[op.kind] ?? 0) + 1
  }
  return { parType, plan }
}
const liaisons = (plan) =>
  plan.etapes.flatMap((etape) => etape.operations).filter((op) => op.type === 'liaison')

describe('ne rien perdre de ce qui est demandé', () => {
  it('la phrase d’exemple du module donne ses douze équipements', () => {
    const { parType, plan } = crees(
      'deux pare-feu Fortinet en grappe, deux switches cœur en MLAG, quatre switches d’accès et trois hyperviseurs avec témoin',
    )
    assert.deepEqual(parType, { firewall: 2, 'core-switch': 2, 'access-switch': 4, hypervisor: 3, witness: 1 })
    assert.equal(plan.noeuds, 12)
  })

  it('« et » sépare deux groupes', () => {
    assert.deepEqual(crees('un routeur et un pare-feu').parType, { router: 1, firewall: 1 })
    assert.deepEqual(crees('quatre switches d’accès et trois hyperviseurs').parType, {
      'access-switch': 4, hypervisor: 3,
    })
  })

  it('une énumération complète', () => {
    assert.deepEqual(crees('un routeur, un pare-feu et deux switchs cœur').parType, {
      router: 1, firewall: 1, 'core-switch': 2,
    })
  })

  it('« ainsi que » aussi', () => {
    assert.deepEqual(crees('deux switchs cœur ainsi que quatre serveurs').parType, {
      'core-switch': 2, server: 4,
    })
  })

  it('ne coupe pas un « et » qui n’ouvre pas un groupe', () => {
    // « actif et passif » qualifie la grappe : ce n'est pas une énumération.
    const { parType } = crees('deux pare-feu en grappe actif et passif')
    assert.deepEqual(parType, { firewall: 2 })
  })

  it('signale ce qu’il ne comprend pas', () => {
    const { plan } = crees('deux switchs cœur, trois bidules quantiques')
    assert.equal(plan.ignores.length, 1)
    assert.match(plan.ignores[0], /bidules/)
  })

  it('l’exemple du panneau reste intact', () => {
    assert.equal(crees(EXEMPLE_ASSISTANT).plan.noeuds, 19)
  })
})

describe('quantités dites autrement', () => {
  it('« redondé » vaut deux', () => {
    const { parType, plan } = crees('un cœur redondé')
    assert.deepEqual(parType, { 'core-switch': 2 })
    assert.equal(liaisons(plan).length, 1, 'les deux cœurs sont reliés entre eux')
  })

  it('une paire est une grappe', () => {
    const { parType, plan } = crees('une paire de pare-feu')
    assert.deepEqual(parType, { firewall: 2 })
    assert.equal(liaisons(plan).length, 1, 'avec son lien de synchronisation')
  })

  it('un témoin suppose une grappe, même non dite', () => {
    const { parType } = crees('trois hyperviseurs avec témoin')
    assert.deepEqual(parType, { hypervisor: 3, witness: 1 })
  })
})

describe('nommage', () => {
  const noms = (texte, base = vide) =>
    analyserDescription(texte, base).etapes.flatMap((e) => e.operations)
      .filter((op) => op.type === 'noeud').map((op) => op.nom)

  it('numérote une série', () => {
    assert.deepEqual(noms('deux switchs cœur'), ['SW-CORE-01', 'SW-CORE-02'])
  })

  it('poursuit la série existante', () => {
    assert.deepEqual(noms('trois switchs d’accès', reseau), ['SW-ACC-03', 'SW-ACC-04', 'SW-ACC-05'])
  })

  it('numérote un équipement seul quand une série existe déjà', () => {
    // Donnait « FW » à côté de « FW-01 » : cela se lit comme un autre type d'équipement.
    assert.deepEqual(noms('un pare-feu', reseau), ['FW-02'])
    assert.deepEqual(noms('un routeur', reseau), ['RTR-02'])
  })

  it('ne numérote pas un équipement vraiment seul', () => {
    assert.deepEqual(noms('un routeur'), ['RTR'])
  })
})

describe('raccordement', () => {
  it('accroche les ajouts à la couche qui les porte', () => {
    const { plan } = crees('trois switchs d’accès', reseau)
    const vers = liaisons(plan).map((l) => `${l.de}→${l.vers}`)
    assert.equal(vers.length, 6, 'chacun doublement attaché aux deux cœurs')
    assert.ok(vers.includes('SW-CORE-01→SW-ACC-03'))
    assert.ok(vers.includes('SW-CORE-02→SW-ACC-03'))
  })

  it('ne branche pas des postes sur des serveurs', () => {
    // La couche ne suffit pas : un serveur précède les postes sans pouvoir les raccorder.
    const { plan } = crees('trois serveurs et quatre postes de travail', reseau)
    const fautifs = liaisons(plan).filter((l) => /^SRV/.test(l.de) && /^PC/.test(l.vers))
    assert.deepEqual(fautifs, [])
  })

  it('ne branche pas des serveurs sur des bornes Wi-Fi', () => {
    const { plan } = crees('deux bornes wifi et quatre serveurs', reseau)
    const fautifs = liaisons(plan).filter((l) => /^AP/.test(l.de) || /^AP/.test(l.vers)).filter((l) => /SRV/.test(l.de + l.vers))
    assert.deepEqual(fautifs, [])
    const serveursRelies = liaisons(plan).filter((l) => /^SRV/.test(l.vers)).length
    assert.ok(serveursRelies > 0, 'les serveurs ne restent pas en l’air pour autant')
  })

  it('ne raccorde rien entre couches quand on le lui interdit', () => {
    const { plan } = crees('trois switchs d’accès', reseau, { raccorder: false })
    assert.equal(liaisons(plan).length, 0)
    assert.equal(plan.noeuds, 3)
  })

  it('garde le lien de synchronisation d’une grappe même sans raccordement', () => {
    const { plan } = crees('deux pare-feu en grappe', vide, { raccorder: false })
    assert.equal(liaisons(plan).length, 1, 'ce lien fait partie de la grappe')
  })
})
