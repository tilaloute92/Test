import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Relecture d'un fichier de schéma.
 *
 * C'est la porte d'entrée la plus exposée : le fichier vient d'un autre poste, d'un export
 * d'il y a deux ans, d'un collègue, parfois d'un outil tiers. Il ne doit jamais faire
 * tomber l'application, et jamais introduire ce qu'il n'a pas le droit d'introduire.
 */

const { parseDiagram, parseClasseur, emptyDiagram } = await import('../../src/lib/storage.ts')

describe('robustesse de la relecture', () => {
  it('refuse ce qui n’est pas un objet', () => {
    for (const mauvais of [null, 42, 'texte', true]) {
      assert.throws(() => parseDiagram(mauvais), /pas un schéma/i, `valeur ${JSON.stringify(mauvais)}`)
    }
  })

  it('accepte un schéma vide sans broncher', () => {
    const lu = parseDiagram({ nodes: [], links: [] })
    assert.deepEqual(lu.nodes, [])
    assert.deepEqual(lu.links, [])
    assert.equal(typeof lu.title, 'string')
  })

  it('survit à des tableaux remplis de n’importe quoi', () => {
    const lu = parseDiagram({ nodes: [null, 42, 'texte', {}, []], links: [null, 'x', {}] })
    assert.deepEqual(lu.nodes, [], 'rien d’exploitable n’est retenu')
    assert.deepEqual(lu.links, [])
  })

  it('ignore un champ de type inattendu plutôt que de le recopier', () => {
    const lu = parseDiagram({
      nodes: [{ id: 'n1', kind: 'switch', name: 'SW', x: 'beaucoup', y: null, heightU: 'deux' }],
      links: [],
    })
    assert.equal(lu.nodes[0].x, 0, 'une abscisse illisible retombe à zéro')
    assert.equal(lu.nodes[0].y, 0)
    assert.equal(lu.nodes[0].heightU, undefined)
  })
})

describe('intégrité du schéma relu', () => {
  it('supprime une liaison dont une extrémité n’existe pas', () => {
    // Un lien orphelin dessinerait un trait vers le néant, ou ferait tomber le rendu.
    const lu = parseDiagram({
      nodes: [{ id: 'n1', kind: 'switch', name: 'SW-1' }],
      links: [{ from: 'n1', to: 'fantome' }, { from: 'absent', to: 'n1' }],
    })
    assert.deepEqual(lu.links, [])
  })

  it('supprime une liaison qui boucle sur elle-même', () => {
    const lu = parseDiagram({
      nodes: [{ id: 'n1', kind: 'switch', name: 'SW-1' }],
      links: [{ from: 'n1', to: 'n1' }],
    })
    assert.deepEqual(lu.links, [])
  })

  it('départage deux équipements qui portent le même identifiant', () => {
    // Deux fichiers fusionnés à la main produisent exactement cela ; garder les deux fois
    // le même identifiant ferait pointer toutes les liaisons sur le même équipement.
    const lu = parseDiagram({
      nodes: [{ id: 'n1', kind: 'switch', name: 'A' }, { id: 'n1', kind: 'switch', name: 'B' }],
      links: [],
    })
    assert.equal(lu.nodes.length, 2)
    assert.notEqual(lu.nodes[0].id, lu.nodes[1].id, 'le doublon reçoit un nouvel identifiant')
  })

  it('conserve un type d’équipement absent du catalogue local', () => {
    // Le schéma doit rester ouvrable sur un poste où le lot correspondant n'est pas installé.
    const lu = parseDiagram({ nodes: [{ id: 'n1', kind: 'machine-exotique', name: 'X' }], links: [] })
    assert.equal(lu.nodes.length, 1)
    assert.equal(lu.nodes[0].kind, 'machine-exotique')
  })
})

describe('valeurs bornées et filtrées', () => {
  it('n’accepte qu’une couleur de grappe au format attendu', () => {
    const lu = parseDiagram({
      nodes: [], links: [],
      clusterColors: { bon: '#ff0000', court: '#f00', vide: '', js: 'javascript:alert(1)', url: 'url(#x)' },
    })
    assert.deepEqual(Object.keys(lu.clusterColors ?? {}), ['bon'],
      'seule la notation à six chiffres passe')
  })

  it('borne les marges de couche au lieu de dessiner hors du plan', () => {
    const lu = parseDiagram({ nodes: [], links: [], layerPads: { 1: 99999, 2: -99999, 3: 40 } })
    assert.equal(lu.layerPads['1'], 160)
    assert.equal(lu.layerPads['2'], -20)
    assert.equal(lu.layerPads['3'], 40)
  })

  it('borne un point d’accroche à la boîte de l’équipement', () => {
    const lu = parseDiagram({
      nodes: [{ id: 'a', kind: 'switch', name: 'A' }, { id: 'b', kind: 'switch', name: 'B' }],
      links: [{ from: 'a', to: 'b', attachA: { dx: 50, dy: -50 } }],
    })
    assert.equal(lu.links[0].attachA.dx, 0.5)
    assert.equal(lu.links[0].attachA.dy, -0.5)
  })

  it('n’accepte que les couches OSI connues', () => {
    const lu = parseDiagram({
      nodes: [{ id: 'a', kind: 'switch', name: 'A' }, { id: 'b', kind: 'switch', name: 'B' }],
      links: [{ from: 'a', to: 'b', layers: ['l1', 'l9', 'tout', 'l3'] }],
    })
    assert.deepEqual(lu.links[0].layers, ['l1', 'l3'])
  })

  it('n’accepte qu’un mode de négociation de la norme', () => {
    const lien = (lacp) => parseDiagram({
      nodes: [{ id: 'a', kind: 'switch', name: 'A' }, { id: 'b', kind: 'switch', name: 'B' }],
      links: [{ from: 'a', to: 'b', lacp }],
    }).links[0].lacp
    assert.equal(lien('active'), 'active')
    assert.equal(lien('passive'), 'passive')
    assert.equal(lien('static'), 'static')
    assert.equal(lien('on'), undefined, '« on » n’est pas une valeur de la norme')
    assert.equal(lien(42), undefined)
  })
})

describe('documents à plusieurs pages', () => {
  it('lit un fichier d’avant les onglets comme un document d’une page', () => {
    const classeur = parseClasseur({ nodes: [{ id: 'n1', kind: 'switch', name: 'SW' }], links: [] })
    assert.equal(classeur.pages.length, 1)
    assert.equal(classeur.pages[0].nodes.length, 1)
    assert.equal(classeur.activePage, 0)
  })

  it('lit un document à plusieurs pages', () => {
    const classeur = parseClasseur({
      title: 'Siège',
      pages: [
        { pageName: 'Cœur', nodes: [{ id: 'a', kind: 'switch', name: 'A' }], links: [] },
        { pageName: 'Accès', nodes: [{ id: 'b', kind: 'switch', name: 'B' }], links: [] },
      ],
      activePage: 1,
    })
    assert.equal(classeur.pages.length, 2)
    assert.equal(classeur.title, 'Siège')
    assert.equal(classeur.activePage, 1)
    assert.deepEqual(classeur.pages.map((p) => p.pageName), ['Cœur', 'Accès'])
  })

  it('ramène une page active hors bornes dans les bornes', () => {
    const classeur = parseClasseur({
      pages: [{ nodes: [], links: [] }, { nodes: [], links: [] }],
      activePage: 99,
    })
    assert.equal(classeur.activePage, 1)
    assert.equal(parseClasseur({ pages: [{ nodes: [], links: [] }], activePage: -5 }).activePage, 0)
  })

  it('nomme les pages qui n’ont pas de nom', () => {
    const classeur = parseClasseur({ pages: [{ nodes: [], links: [] }, { nodes: [], links: [] }] })
    assert.ok(classeur.pages.every((p) => typeof p.pageName === 'string' && p.pageName.length > 0))
  })
})

describe('schéma vide', () => {
  it('se relit lui-même sans rien perdre', () => {
    const vide = emptyDiagram()
    const relu = parseDiagram(vide)
    assert.deepEqual(relu.nodes, [])
    assert.deepEqual(relu.links, [])
  })
})
