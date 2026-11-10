import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

/**
 * Faciliter la création : partir d'une architecture, et voir ses ajouts se ranger seuls.
 *
 * Les architectures de départ ne sont que des phrases confiées à l'assistant de conception.
 * Ce qu'on vérifie ici, c'est qu'elles tiennent leur promesse — tout est compris, tout est
 * raccordé, rien n'est empilé — et qu'un ajout dans un schéma existant va là où on
 * l'aurait posé soi-même, sans déplacer ce qui était déjà en place.
 */

const { useDiagram } = await import('../../src/store/useDiagram.ts')
const { ARCHITECTURES, trouverArchitecture } = await import('../../src/lib/architectures.ts')
const { analyserDescription } = await import('../../src/lib/assistant.ts')
const { NODE_W, NODE_H } = await import('../../src/lib/layout.ts')

const magasin = () => useDiagram.getState()
const dire = (phrase) => magasin().runVoiceCommand(phrase)
const schema = () => magasin().diagram
const noeud = (nom) => schema().nodes.find((n) => n.name === nom)
const duType = (kind) => schema().nodes.filter((n) => n.kind === kind)

function ok(phrase) {
  const r = dire(phrase)
  assert.ok(r.ok, `« ${phrase} » refusée : ${r.message}`)
  return r
}

/** Deux équipements se recouvrent-ils ? */
const empiles = (nodes) => {
  const paires = []
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const [a, b] = [nodes[i], nodes[j]]
      if (Math.abs(a.x - b.x) < NODE_W * 0.8 && Math.abs(a.y - b.y) < NODE_H * 0.8) paires.push(`${a.name}/${b.name}`)
    }
  }
  return paires
}

/** Tous les équipements se rejoignent-ils par des liaisons ? */
const dUnSeulTenant = (diagram) => {
  if (diagram.nodes.length === 0) return true
  const voisins = new Map(diagram.nodes.map((n) => [n.id, []]))
  for (const l of diagram.links) {
    voisins.get(l.from)?.push(l.to)
    voisins.get(l.to)?.push(l.from)
  }
  const vus = new Set([diagram.nodes[0].id])
  const file = [diagram.nodes[0].id]
  while (file.length > 0) {
    for (const voisin of voisins.get(file.pop())) {
      if (vus.has(voisin)) continue
      vus.add(voisin)
      file.push(voisin)
    }
  }
  return vus.size === diagram.nodes.length
}

beforeEach(() => magasin().newDiagram())

describe('architectures de départ', () => {
  for (const architecture of ARCHITECTURES) {
    it(`« ${architecture.titre} » : tout est compris, raccordé, rangé`, () => {
      const plan = analyserDescription(architecture.description, schema())
      assert.deepEqual(plan.ignores, [], 'aucun morceau de la description n’est ignoré')
      magasin().appliquerPlan(plan.etapes.flatMap((etape) => etape.operations))
      assert.equal(schema().nodes.length, plan.noeuds)
      assert.ok(schema().nodes.length >= 6, `${schema().nodes.length} équipements`)
      // Les onduleurs alimentent, ils ne transportent rien : on les met de côté pour juger
      // de la continuité du réseau.
      const sansEnergie = {
        nodes: schema().nodes.filter((n) => n.kind !== 'ups'),
        links: schema().links.filter((l) => l.kind !== 'power'),
      }
      assert.ok(dUnSeulTenant(sansEnergie), 'le réseau est d’un seul tenant')
      assert.deepEqual(empiles(schema().nodes), [], 'aucun équipement posé sur un autre')
    })
  }

  it('chaque désignation retrouve son architecture', () => {
    for (const architecture of ARCHITECTURES) {
      for (const mot of architecture.mots) {
        assert.equal(trouverArchitecture(mot)?.id, architecture.id, `« ${mot} »`)
      }
    }
  })

  it('la désignation la plus longue l’emporte', () => {
    assert.equal(trouverArchitecture('un campus trois niveaux')?.id, 'trois-tiers')
    assert.equal(trouverArchitecture('une architecture deux niveaux')?.id, 'deux-niveaux')
  })

  it('se demandent à la voix', () => {
    const r = ok('monte une architecture trois tiers')
    assert.equal(duType('core-switch').length, 2)
    assert.equal(duType('access-switch').length, 4)
    assert.equal(duType('switch').length, 2)
    assert.match(r.message, /Campus trois niveaux/)
  })

  it('avec les mots qu’on emploie', () => {
    for (const [phrase, type, combien] of [
      ['construis une agence', 'wifi', 2],
      ['crée un datacenter spine leaf', 'leaf', 4],
      ['dessine un réseau wifi', 'wifi', 6],
      ['génère un petit site', 'printer', 1],
    ]) {
      magasin().newDiagram()
      ok(phrase)
      assert.equal(duType(type).length, combien, `« ${phrase} »`)
    }
  })

  it('une borne Wi-Fi reste une borne', () => {
    ok('ajoute une borne wifi')
    assert.equal(schema().nodes.length, 1)
    ok('ajoute un wifi')
    assert.equal(duType('wifi').length, 2)
  })

  it('se construit puis se complète avec les mêmes mots', () => {
    ok('construis une agence')
    ok('ajoute deux switchs d’accès')
    assert.equal(duType('access-switch').length, 4)
    ok('annule')
    assert.equal(duType('access-switch').length, 2, 'le complément s’annule d’un coup')
    ok('annule')
    assert.equal(schema().nodes.length, 0, 'l’architecture aussi')
  })
})

describe('un ajout se range là où on l’aurait posé', () => {
  const poser = (kind, name, x, y) => magasin().addNode(kind, x, y, { name })
  beforeEach(() => {
    magasin().newDiagram()
    poser('firewall', 'FW-01', 400, 0)
    poser('core-switch', 'SW-CORE-01', 250, 200)
    poser('core-switch', 'SW-CORE-02', 550, 200)
    poser('access-switch', 'SW-ACC-01', 250, 600)
    poser('access-switch', 'SW-ACC-02', 550, 600)
    magasin().clearSelection()
  })

  it('au bout de la rangée de ses pairs', () => {
    ok('ajoute deux switchs d’accès')
    for (const nom of ['SW-ACC-03', 'SW-ACC-04']) {
      assert.equal(noeud(nom).y, 600, `${nom} sur la rangée des switchs d’accès`)
      assert.ok(noeud(nom).x > 550, `${nom} à la suite`)
    }
    assert.deepEqual(empiles(schema().nodes), [])
  })

  it('sans déplacer ce qui était en place', () => {
    const avant = schema().nodes.map((n) => [n.name, n.x, n.y])
    ok('ajoute deux switchs d’accès')
    for (const [nom, x, y] of avant) assert.deepEqual([noeud(nom).x, noeud(nom).y], [x, y], nom)
  })

  it('une couche nouvelle s’intercale entre ses voisines quand il y a la place', () => {
    // Entre les cœurs (200) et l'accès (600), une rangée de distribution tient.
    ok('ajoute deux switchs de distribution')
    const distribution = duType('switch')
    assert.equal(distribution.length, 2)
    for (const n of distribution) assert.ok(n.y > 200 && n.y < 600, `${n.name} à y=${n.y}`)
    assert.deepEqual(empiles(schema().nodes), [])
  })

  it('une couche nouvelle en bout de schéma se pose à la suite', () => {
    ok('ajoute trois serveurs')
    for (const n of duType('server')) assert.ok(n.y > 600, `${n.name} sous l’accès`)
    assert.deepEqual(empiles(schema().nodes), [])
  })

  it('un équipement ajouté seul aussi', () => {
    // Il atterrissait au centre de la vue : le plus souvent le milieu du schéma.
    ok('ajoute un switch d’accès')
    assert.equal(noeud('SW-ACC-03').y, 600)
    assert.ok(noeud('SW-ACC-03').x > 550)
    ok('ajoute un serveur SRV-01')
    assert.ok(noeud('SRV-01').y > 600, 'un serveur se pose sous l’accès')
    assert.deepEqual(empiles(schema().nodes), [])
  })

  it('un repère dicté passe avant la rangée', () => {
    ok('ajoute un switch d’accès SW-ACC-09 sous SW-CORE-02')
    assert.ok(Math.abs(noeud('SW-ACC-09').x - 550) < 200, 'à l’aplomb de son repère')
    assert.ok(noeud('SW-ACC-09').y > 200 && noeud('SW-ACC-09').y < 600)
  })

  it('une couche en amont se pose au-dessus', () => {
    ok('ajoute deux routeurs')
    for (const n of duType('router')) assert.ok(n.y < 0, `${n.name} au-dessus du pare-feu`)
  })
})
