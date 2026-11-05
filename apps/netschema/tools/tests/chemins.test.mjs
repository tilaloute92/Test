import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Débits et chemins.
 *
 * Deux questions qu'on pose à un schéma le jour d'une panne : par où ça passe, et où est le
 * maillon lent. Les réponses servent d'argument en réunion — elles doivent être justes.
 */

const { debitEnMbps, cheminsEntre } = await import('../../src/lib/paths.ts')

const schema = (nodes, links) => ({
  title: 'Essai',
  nodes: nodes.map((n) => (typeof n === 'string' ? { id: n, kind: 'switch', name: n, x: 0, y: 0 } : { kind: 'switch', x: 0, y: 0, ...n })),
  links: links.map((l, i) => ({ id: `l${i}`, kind: 'ethernet', ...l })),
  vlans: [], racks: [],
})

describe('lecture d’un débit', () => {
  it('lit les notations qu’on rencontre vraiment', () => {
    assert.equal(debitEnMbps('10 Gb/s'), 10000)
    assert.equal(debitEnMbps('1 Gbps'), 1000)
    assert.equal(debitEnMbps('100M'), 100)
    assert.equal(debitEnMbps('100 Mb/s'), 100)
    assert.equal(debitEnMbps('40G'), 40000)
  })

  it('accepte la virgule décimale française', () => {
    assert.equal(debitEnMbps('2,5 Gb/s'), 2500)
  })

  it('suppose les mégabits quand l’unité manque', () => {
    assert.equal(debitEnMbps('1000'), 1000)
  })

  it('ne rend rien sur une valeur illisible', () => {
    for (const illisible of [undefined, '', 'rapide', 'auto']) {
      assert.equal(debitEnMbps(illisible), null, `« ${illisible} »`)
    }
  })
})

describe('recherche de chemins', () => {
  // A ─ B ─ D   et   A ─ C ─ D : deux trajets entièrement distincts.
  const redonde = schema(['A', 'B', 'C', 'D'], [
    { from: 'A', to: 'B' }, { from: 'B', to: 'D' },
    { from: 'A', to: 'C' }, { from: 'C', to: 'D' },
  ])

  it('trouve le chemin le plus court', () => {
    const rapport = cheminsEntre(redonde, 'A', 'D', 1)
    assert.equal(rapport.chemins.length, 1)
    assert.equal(rapport.chemins[0].sauts, 2, 'A → ? → D')
  })

  it('trouve un secours qui ne partage aucun équipement intermédiaire', () => {
    const rapport = cheminsEntre(redonde, 'A', 'D', 3)
    assert.equal(rapport.chemins.length, 2, 'deux trajets réellement distincts')
    const intermediaires = rapport.chemins.map((c) => c.etapes.slice(1, -1).map((e) => e.node.name).join(','))
    assert.notEqual(intermediaires[0], intermediaires[1])
  })

  it('ne compte pas pour deux un trajet qui repasse par le même switch', () => {
    // A ─ B ─ D, plus un second câble A ─ B : c'est un seul chemin, pas deux.
    // Annoncer deux chemins ici ferait croire à une redondance qui n'existe pas.
    const faux = schema(['A', 'B', 'D'], [
      { from: 'A', to: 'B' }, { from: 'A', to: 'B' }, { from: 'B', to: 'D' },
    ])
    const rapport = cheminsEntre(faux, 'A', 'D', 3)
    assert.equal(rapport.chemins.length, 1, 'un seul chemin : B est commun')
  })

  it('ne rend aucun chemin entre deux îlots', () => {
    const coupe = schema(['A', 'B', 'X', 'Y'], [{ from: 'A', to: 'B' }, { from: 'X', to: 'Y' }])
    assert.deepEqual(cheminsEntre(coupe, 'A', 'Y', 3).chemins, [])
  })

  it('refuse les cas dégénérés sans lever', () => {
    assert.deepEqual(cheminsEntre(redonde, 'A', 'A', 3).chemins, [], 'même départ et arrivée')
    assert.deepEqual(cheminsEntre(redonde, 'A', 'INCONNU', 3).chemins, [])
    assert.deepEqual(cheminsEntre(redonde, 'INCONNU', 'D', 3).chemins, [])
  })

  it('désigne le maillon le plus lent du trajet', () => {
    const inegal = schema(['A', 'B', 'D'], [
      { from: 'A', to: 'B', speed: '10 Gb/s' },
      { from: 'B', to: 'D', speed: '1 Gb/s' },
    ])
    const chemin = cheminsEntre(inegal, 'A', 'D', 1).chemins[0]
    assert.ok(chemin.goulot, 'aucun goulot désigné')
    assert.equal(chemin.goulot.debit, '1 Gb/s', 'c’est le brin le plus lent qui commande')
  })

  it('ne désigne pas de goulot quand tout le trajet va à la même vitesse', () => {
    // Sinon la ligne « maillon le plus lent » s'affiche toujours, donc plus personne ne
    // la lit, et le jour où elle dit 1 Gb/s au milieu de 10 Gb/s elle passe inaperçue.
    const egal = schema(['A', 'B', 'D'], [
      { from: 'A', to: 'B', speed: '10 Gb/s' }, { from: 'B', to: 'D', speed: '10 Gb/s' },
    ])
    assert.equal(cheminsEntre(egal, 'A', 'D', 1).chemins[0].goulot, undefined)
  })

  it('ne désigne pas de goulot quand un seul brin annonce son débit', () => {
    // Le plus lent *connu* n'est pas le plus lent : les autres ne sont pas renseignés.
    const partiel = schema(['A', 'B', 'D'], [
      { from: 'A', to: 'B', speed: '1 Gb/s' }, { from: 'B', to: 'D' },
    ])
    assert.equal(cheminsEntre(partiel, 'A', 'D', 1).chemins[0].goulot, undefined)
  })
})
