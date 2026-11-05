import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Analyse d'impact.
 *
 * « Si je coupe ce switch, qui tombe ? » — la question qu'on pose avant une intervention de
 * nuit, et dont la réponse engage. Une erreur par excès fait annuler une maintenance pour
 * rien ; une erreur par défaut coupe un bâtiment qu'on croyait redondé.
 */

const { analyseImpact, parseVlans, vlansDuLien, estBloqueParStp } = await import('../../src/lib/impact.ts')

const schema = (nodes, links) => ({
  title: 'Essai',
  nodes: nodes.map((n) => (typeof n === 'string' ? { id: n, kind: 'switch', name: n, x: 0, y: 0 } : { kind: 'switch', x: 0, y: 0, ...n })),
  links: links.map((l, i) => ({ id: l.id ?? `l${i}`, kind: 'ethernet', ...l })),
  vlans: [], racks: [],
})

describe('lecture des VLAN d’un lien', () => {
  it('développe les listes et les intervalles', () => {
    assert.deepEqual([...parseVlans('10,20')].sort((a, b) => a - b), [10, 20])
    assert.deepEqual([...parseVlans('10-12')].sort((a, b) => a - b), [10, 11, 12])
    assert.deepEqual([...parseVlans('vlan 30')], [30])
  })

  it('remet un intervalle à l’endroit', () => {
    assert.deepEqual([...parseVlans('12-10')].sort((a, b) => a - b), [10, 11, 12])
  })

  it('rend un ensemble vide sur une entrée vide ou illisible', () => {
    for (const vide of [undefined, '', 'all', 'tous']) {
      assert.equal(parseVlans(vide).size, 0, `« ${vide} »`)
    }
  })

  it('suppose une liaison transparente quand rien n’est documenté', () => {
    // Crier au loup sur un schéma incomplet userait l'attention : le silence vaut
    // « je ne sais pas », pas « rien ne passe ».
    assert.equal(vlansDuLien({ from: 'a', to: 'b' }), null)
  })

  it('ne retient que les VLAN autorisés aux deux bouts', () => {
    // Une liste d'autorisation qui diverge est l'erreur la plus banale et la plus pénible
    // à trouver le jour de la panne.
    const vlans = vlansDuLien({ from: 'a', to: 'b', mode: 'trunk', vlansA: '10,20,30', vlansB: '20,30,40' })
    assert.deepEqual([...vlans].sort((a, b) => a - b), [20, 30])
  })
})

describe('liaison écartée par le spanning tree', () => {
  it('repère un rôle bloquant d’un côté ou de l’autre', () => {
    assert.equal(estBloqueParStp({ stpA: 'blocking' }), true)
    assert.equal(estBloqueParStp({ stpB: 'alternate' }), true)
    assert.equal(estBloqueParStp({ stp: 'blocking' }), true)
  })

  it('laisse passer les rôles actifs', () => {
    assert.equal(estBloqueParStp({ stpA: 'root', stpB: 'designated' }), false)
    assert.equal(estBloqueParStp({}), false)
  })
})

describe('verdict sur une panne', () => {
  /*
    Cœur redondé, avec une vraie hiérarchie d'équipements.

    Le type compte : l'analyse part des points de référence — accès opérateur, périmètre —
    et regarde qui reste joignable depuis eux. Un schéma où tout est du même type n'a pas
    de point de départ, tout devient racine, et plus rien ne peut jamais être isolé.
  */
  const redonde = schema([
    { id: 'NET', kind: 'internet', name: 'Internet' },
    { id: 'CORE1', kind: 'core-switch', name: 'SW-CORE-01' },
    { id: 'CORE2', kind: 'core-switch', name: 'SW-CORE-02' },
    { id: 'DIST', kind: 'switch', name: 'SW-DIST' },
    { id: 'SRV', kind: 'server', name: 'SRV-01' },
  ], [
    { from: 'NET', to: 'CORE1' },
    { from: 'NET', to: 'CORE2' },
    { from: 'CORE1', to: 'CORE2' },
    { from: 'CORE1', to: 'DIST' },
    { from: 'CORE2', to: 'DIST' },
    { from: 'DIST', to: 'SRV' },
  ])

  it('ne déclare personne isolé quand la redondance tient', () => {
    const rapport = analyseImpact(redonde, { nodes: ['CORE1'], links: [] })
    assert.equal(rapport.compte.isole, 0, 'CORE2 prend le relais')
    assert.notEqual(rapport.etats.get('SRV'), 'isole', 'le serveur reste joignable')
  })

  it('distingue le simple du double rattachement, même sans panne', () => {
    /*
      « Fragile » est un verdict structurel, pas une conséquence de la panne en cours : il
      dit « une seule coupure suffirait à le couper », et c'est précisément ce qu'on veut
      savoir avant de programmer une intervention. Un serveur à un seul câble est donc
      fragile en permanence ; le même serveur à deux câbles vers deux cœurs ne l'est pas.
    */
    assert.equal(analyseImpact(redonde, { nodes: [], links: [] }).etats.get('SRV'), 'fragile',
      'SRV ne pend qu’à DIST')

    const doubleAttache = schema([
      { id: 'NET', kind: 'internet', name: 'Internet' },
      { id: 'CORE1', kind: 'core-switch', name: 'SW-CORE-01' },
      { id: 'CORE2', kind: 'core-switch', name: 'SW-CORE-02' },
      { id: 'SRV', kind: 'server', name: 'SRV-01' },
    ], [
      { from: 'NET', to: 'CORE1' }, { from: 'NET', to: 'CORE2' },
      { from: 'CORE1', to: 'CORE2' },
      { from: 'CORE1', to: 'SRV' }, { from: 'CORE2', to: 'SRV' },
    ])
    assert.equal(analyseImpact(doubleAttache, { nodes: [], links: [] }).etats.get('SRV'), 'intact',
      'deux câbles vers deux cœurs : plus de point de passage unique')
  })

  it('isole ce qui perd son dernier chemin', () => {
    const rapport = analyseImpact(redonde, { nodes: ['DIST'], links: [] })
    assert.equal(rapport.etats.get('SRV'), 'isole', 'le serveur ne pend qu’à DIST')
    assert.ok(rapport.isoles.some((item) => item.id === 'SRV'))
  })

  it('compte l’équipement en panne comme en panne, pas comme isolé', () => {
    const rapport = analyseImpact(redonde, { nodes: ['DIST'], links: [] })
    assert.equal(rapport.etats.get('DIST'), 'panne')
    assert.equal(rapport.compte.panne, 1)
  })

  it('coupe aussi les liaisons portées par l’équipement arrêté', () => {
    const rapport = analyseImpact(redonde, { nodes: ['DIST'], links: [] })
    // Les trois liaisons qui touchent DIST tombent avec lui : CORE1, CORE2 et SRV.
    assert.equal(rapport.liensCoupes.size, 3)
  })

  it('traite une coupure de câble sans arrêter d’équipement', () => {
    const rapport = analyseImpact(redonde, { nodes: [], links: ['l5'] })
    assert.equal(rapport.etats.get('SRV'), 'isole', 'le seul câble du serveur est coupé')
    assert.equal(rapport.compte.panne, 0, 'aucun équipement arrêté')
  })

  it('rend tout intact quand il n’y a aucune panne', () => {
    const rapport = analyseImpact(redonde, { nodes: [], links: [] })
    assert.equal(rapport.compte.isole, 0)
    assert.equal(rapport.compte.panne, 0)
    assert.equal(rapport.disponibilite, 100)
  })

  it('désigne le point de passage unique dont dépend un équipement fragile', () => {
    // Chaîne sans redondance : Internet ─ CORE ─ DIST ─ SRV. DIST est un passage obligé.
    const chaine = schema([
      { id: 'NET', kind: 'internet', name: 'Internet' },
      { id: 'CORE', kind: 'core-switch', name: 'SW-CORE' },
      { id: 'DIST', kind: 'switch', name: 'SW-DIST' },
      { id: 'SRV', kind: 'server', name: 'SRV-01' },
    ], [
      { from: 'NET', to: 'CORE' }, { from: 'CORE', to: 'DIST' }, { from: 'DIST', to: 'SRV' },
    ])
    const rapport = analyseImpact(chaine, { nodes: [], links: [] })
    assert.ok(rapport.fragiles.length > 0, 'aucun équipement fragile repéré sur une chaîne')
    assert.ok(rapport.fragiles.some((item) => item.id === 'SRV'), 'le serveur dépend de DIST')
  })

  it('ne tombe pas sur un schéma vide ni sur des pannes fantômes', () => {
    assert.equal(analyseImpact(schema([], []), { nodes: [], links: [] }).compte.panne, 0)
    const fantome = analyseImpact(redonde, { nodes: ['NEXISTE_PAS'], links: ['l99'] })
    assert.equal(fantome.compte.isole, 0, 'une panne sur un équipement absent ne casse rien')
  })

  it('rend une disponibilité qui baisse quand la panne s’étend', () => {
    const peu = analyseImpact(redonde, { nodes: ['CORE1'], links: [] }).disponibilite
    const beaucoup = analyseImpact(redonde, { nodes: ['CORE1', 'DIST'], links: [] }).disponibilite
    assert.ok(beaucoup < peu, `${beaucoup} % devrait être sous ${peu} %`)
    assert.ok(peu <= 100 && beaucoup >= 0, 'la disponibilité reste un pourcentage')
  })
})
