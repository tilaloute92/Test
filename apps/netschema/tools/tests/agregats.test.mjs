import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Détection des agrégats de liens.
 *
 * C'est le cœur de ce que produit le collecteur SNMP, et ce qui se lit le plus mal sur un
 * schéma fait à la main : quatre brins entre deux switchs, est-ce un port-channel ou quatre
 * câbles indépendants ? Une erreur ici fait croire à une redondance qui n'existe pas, ou
 * masque un lien unique sur lequel repose tout un bâtiment.
 */

const { agregats, nomAgregat, formaterDebit, libelleAgregat } = await import('../../src/lib/aggregates.ts')

/** Construit un schéma minimal : des équipements nommés, des liaisons décrites. */
function schema(nodes, links) {
  return {
    nodes: nodes.map((n) => (typeof n === 'string' ? { id: n, kind: 'switch', name: n, x: 0, y: 0 } : { kind: 'switch', x: 0, y: 0, ...n })),
    links: links.map((l, i) => ({ id: `l${i}`, kind: 'ethernet', ...l })),
  }
}

describe('nom du bundle vu d’un bout', () => {
  it('préfère le nom propre à ce bout au nom commun', () => {
    const lien = { from: 'A', to: 'B', lag: 'Po1', lagA: 'Po10', lagB: 'Po20' }
    assert.equal(nomAgregat(lien, 'A'), 'Po10')
    assert.equal(nomAgregat(lien, 'B'), 'Po20')
  })

  it('retombe sur le nom commun quand le bout n’en a pas', () => {
    const lien = { from: 'A', to: 'B', lag: 'Po1' }
    assert.equal(nomAgregat(lien, 'A'), 'Po1')
    assert.equal(nomAgregat(lien, 'B'), 'Po1')
  })

  it('ne rend rien pour un équipement étranger à la liaison, ni pour un nom vide', () => {
    assert.equal(nomAgregat({ from: 'A', to: 'B', lag: 'Po1' }, 'C'), undefined)
    assert.equal(nomAgregat({ from: 'A', to: 'B', lag: '   ' }, 'A'), undefined)
    assert.equal(nomAgregat({ from: 'A', to: 'B' }, 'A'), undefined)
  })
})

describe('formatage des débits', () => {
  it('bascule en gigabits au-delà du millier', () => {
    assert.equal(formaterDebit(100), '100 Mb/s')
    assert.equal(formaterDebit(1000), '1 Gb/s')
    assert.equal(formaterDebit(20000), '20 Gb/s')
  })

  it('garde une décimale quand le compte n’est pas rond', () => {
    assert.equal(formaterDebit(2500), '2.5 Gb/s')
  })
})

describe('regroupement des brins', () => {
  it('réunit deux brins portant le même nom entre les mêmes équipements', () => {
    const trouves = agregats(schema(['A', 'B'], [
      { from: 'A', to: 'B', lag: 'Po1', portA: 'Eth1/1', portB: 'Eth1/1', speed: '10 Gb/s' },
      { from: 'A', to: 'B', lag: 'Po1', portA: 'Eth1/2', portB: 'Eth1/2', speed: '10 Gb/s' },
    ]))
    // Un agrégat par extrémité : le faisceau se voit des deux côtés.
    assert.ok(trouves.length >= 1, 'aucun agrégat détecté')
    const po1 = trouves.find((a) => a.nom === 'Po1')
    assert.ok(po1, 'Po1 absent')
    assert.equal(po1.membres.length, 2)
    assert.equal(po1.debitBrin, '10 Gb/s')
    assert.equal(po1.debitTotal, 20000, 'deux brins de 10 Gb/s font 20 Gb/s cumulés')
  })

  it('n’encercle pas un bundle à un seul brin', () => {
    // Il existe en configuration, mais il n'y a rien à dessiner autour d'un câble unique.
    const trouves = agregats(schema(['A', 'B'], [{ from: 'A', to: 'B', lag: 'Po9' }]))
    assert.deepEqual(trouves.filter((a) => a.nom === 'Po9'), [])
  })

  it('ne confond pas deux bundles de noms différents', () => {
    const trouves = agregats(schema(['A', 'B'], [
      { from: 'A', to: 'B', lag: 'Po1' }, { from: 'A', to: 'B', lag: 'Po1' },
      { from: 'A', to: 'B', lag: 'Po2' }, { from: 'A', to: 'B', lag: 'Po2' },
    ]))
    const noms = [...new Set(trouves.map((a) => a.nom))].sort()
    assert.deepEqual(noms, ['Po1', 'Po2'])
  })

  it('ignore la casse du nom de bundle', () => {
    // « po1 » et « Po1 » sortent du même équipement selon qui a tapé la configuration.
    const trouves = agregats(schema(['A', 'B'], [
      { from: 'A', to: 'B', lag: 'Po1' }, { from: 'A', to: 'B', lag: 'po1' },
    ]))
    const po = trouves.find((a) => a.nom.toLowerCase() === 'po1')
    assert.ok(po, 'les deux brins devraient se rejoindre')
    assert.equal(po.membres.length, 2)
  })

  it('ne rend aucun agrégat sur un schéma sans bundle', () => {
    assert.deepEqual(agregats(schema(['A', 'B'], [{ from: 'A', to: 'B' }])), [])
    assert.deepEqual(agregats(schema([], [])), [])
  })

  it('ignore une liaison dont une extrémité n’existe pas', () => {
    // Un fichier abîmé ou un import partiel ne doit pas faire tomber le dessin.
    const trouves = agregats(schema(['A'], [
      { from: 'A', to: 'FANTOME', lag: 'Po1' }, { from: 'A', to: 'FANTOME', lag: 'Po1' },
    ]))
    assert.ok(Array.isArray(trouves), 'rend une liste plutôt que de lever')
  })
})

describe('étiquette de l’ovale', () => {
  const agregat = (extra) => ({ nom: 'Po23', membres: [{}, {}], debitBrin: null, debitTotal: null, ...extra })

  it('dit le compte et le débit d’un brin quand ils sont identiques', () => {
    assert.equal(libelleAgregat(agregat({ debitBrin: '10 Gb/s' })), 'Po23 · 2 × 10 Gb/s')
  })

  it('retombe sur le débit cumulé, puis sur le nombre de brins', () => {
    assert.equal(libelleAgregat(agregat({ debitTotal: 20000 })), 'Po23 · 20 Gb/s')
    assert.equal(libelleAgregat(agregat()), 'Po23 · 2 brins')
  })

  it('se réduit au nom quand le plan est chargé', () => {
    assert.equal(libelleAgregat(agregat({ debitBrin: '10 Gb/s' }), false), 'Po23')
  })
})
