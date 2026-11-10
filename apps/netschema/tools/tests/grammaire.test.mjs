import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * La langue parlée, avant la commande : nettoyage, pronoms, découpage.
 *
 * Trois fonctions pures, donc trois séries d'essais qui n'ont besoin ni de micro ni de
 * schéma. Les cas négatifs comptent autant que les autres : une coupure de trop transforme
 * « relie A et B » en deux ordres dont le second n'a aucun sens.
 */

const { nettoyerPhrase, resoudrePronoms, decouperCommandes, REPERE_PRONOM, REPERE_LIAISON } =
  await import('../../src/lib/voiceGrammar.ts')

describe('nettoyage', () => {
  it('retire les hésitations, même empilées', () => {
    assert.equal(nettoyerPhrase('euh ajoute un routeur'), 'ajoute un routeur')
    assert.equal(nettoyerPhrase('alors, euh, bon, ajoute un routeur'), 'ajoute un routeur')
    assert.equal(nettoyerPhrase('et puis ajoute un routeur'), 'ajoute un routeur')
    assert.equal(nettoyerPhrase('OK ajoute un routeur'), 'ajoute un routeur')
  })

  it('retire la politesse, devant et derrière', () => {
    assert.equal(nettoyerPhrase('tu peux ajouter un routeur'), 'ajoute un routeur')
    assert.equal(nettoyerPhrase('je voudrais ajouter un routeur s’il te plaît'), 'ajoute un routeur')
    assert.equal(nettoyerPhrase('ajoute un routeur merci'), 'ajoute un routeur')
    assert.equal(nettoyerPhrase('est-ce que tu peux relier A à B'), 'relie A à B')
  })

  it('ramène le verbe à l’impératif', () => {
    assert.equal(nettoyerPhrase('ajouter un routeur'), 'ajoute un routeur')
    assert.equal(nettoyerPhrase('relier A à B'), 'relie A à B')
    assert.equal(nettoyerPhrase('supprimer SW-01'), 'supprime SW-01')
    assert.equal(nettoyerPhrase('mettre SW-01 dans la zone DMZ'), 'mets SW-01 dans la zone DMZ')
  })

  it('rattrape les homophones du verbe', () => {
    // « relie », « relis », « relit », « relié » : un seul son, quatre graphies.
    for (const forme of ['relit', 'relis', 'relié', 'relier']) {
      assert.equal(nettoyerPhrase(`${forme} A à B`), 'relie A à B', forme)
    }
    assert.equal(nettoyerPhrase('ajouté un routeur'), 'ajoute un routeur')
    assert.equal(nettoyerPhrase('mais un serveur'), 'mets un serveur')
  })

  it('garde le pronom accroché au verbe corrigé', () => {
    assert.equal(nettoyerPhrase('relier-le à B'), 'relie-le à B')
    assert.equal(nettoyerPhrase('relit-le à B'), 'relie-le à B')
  })

  it('corrige « Suisse » en « switch », mais pas un nom de site', () => {
    assert.equal(nettoyerPhrase('ajoute un Suisse cœur'), 'ajoute un switch cœur')
    assert.equal(nettoyerPhrase('ajoute deux suisses d’accès'), 'ajoute deux switch d’accès')
    assert.equal(nettoyerPhrase('mets SW-01 sur le site Suisse'), 'mets SW-01 sur le site Suisse')
  })

  it('recolle les sigles et les mots composés', () => {
    assert.equal(nettoyerPhrase('montre le v lan 20'), 'montre le VLAN 20')
    assert.equal(nettoyerPhrase('ajoute un fire wall'), 'ajoute un pare-feu')
    assert.equal(nettoyerPhrase('ajoute un pare feu'), 'ajoute un pare-feu')
  })

  it('ne touche pas à un mot qui n’est pas un verbe de commande', () => {
    assert.equal(nettoyerPhrase('SW-CORE-01 est actif'), 'SW-CORE-01 est actif')
    assert.equal(nettoyerPhrase('combien d’équipements'), 'combien d’équipements')
  })

  it('rend une chaîne vide sur du bruit pur', () => {
    assert.equal(nettoyerPhrase('euh'), '')
    assert.equal(nettoyerPhrase('  '), '')
    assert.equal(nettoyerPhrase('alors bon'), '')
  })
})

describe('pronoms', () => {
  const P = REPERE_PRONOM

  it('le pronom accroché au verbe', () => {
    assert.equal(resoudrePronoms('relie-le à FW-01'), `relie ${P} à FW-01`)
    assert.equal(resoudrePronoms('mets-les dans le VLAN 20'), `mets ${P} dans le VLAN 20`)
    assert.equal(resoudrePronoms('supprime-la'), `supprime ${P}`)
    assert.equal(resoudrePronoms('renomme-le en SW-DIST-01'), `renomme ${P} en SW-DIST-01`)
  })

  it('le pronom dont la reconnaissance a perdu le trait d’union', () => {
    assert.equal(resoudrePronoms('relie le à FW-01'), `relie ${P} à FW-01`)
    assert.equal(resoudrePronoms('supprime le'), `supprime ${P}`)
    assert.equal(resoudrePronoms('mets le dans la zone DMZ'), `mets ${P} dans la zone DMZ`)
  })

  it('ne prend pas un article pour un pronom', () => {
    // « le » suivi d'un nom est un article : la phrase ne doit pas bouger.
    assert.equal(resoudrePronoms('relie le routeur à FW-01'), 'relie le routeur à FW-01')
    assert.equal(resoudrePronoms('supprime le lien entre A et B'), 'supprime le lien entre A et B')
    assert.equal(resoudrePronoms('masque la grille'), 'masque la grille')
  })

  it('ne coupe pas un nom d’équipement qui contient « -le »', () => {
    assert.equal(resoudrePronoms('relie SW-LE-01 à FW-01'), 'relie SW-LE-01 à FW-01')
    assert.equal(resoudrePronoms('supprime PC-LA-3'), 'supprime PC-LA-3')
  })

  it('les possessifs', () => {
    assert.equal(resoudrePronoms('son adresse est 10.0.0.1'), `l'adresse de ${P} est 10.0.0.1`)
    assert.equal(resoudrePronoms('sa zone est DMZ'), `le zone de ${P} est DMZ`.replace('le zone', 'le zone'))
    assert.equal(resoudrePronoms('son IP est 10.0.0.1'), `l'IP de ${P} est 10.0.0.1`)
    assert.equal(resoudrePronoms('leur VLAN est 20'), `le VLAN de ${P} est 20`)
  })

  it('les démonstratifs', () => {
    assert.equal(resoudrePronoms('relie celui-ci à FW-01'), `relie ${P} à FW-01`)
    assert.equal(resoudrePronoms('supprime cet équipement'), `supprime ${P}`)
    assert.equal(resoudrePronoms('renomme ce dernier en X'), `renomme ${P} en X`)
  })

  it('la liaison dont on vient de parler', () => {
    assert.equal(resoudrePronoms('passe ce lien en fibre'), `passe ${REPERE_LIAISON} en fibre`)
    assert.equal(resoudrePronoms('supprime cette liaison'), `supprime ${REPERE_LIAISON}`)
  })
})

describe('découpage en commandes', () => {
  it('une phrase simple reste entière', () => {
    assert.deepEqual(decouperCommandes('ajoute un routeur'), ['ajoute un routeur'])
  })

  it('« puis » et « ensuite » coupent toujours', () => {
    assert.deepEqual(decouperCommandes('ajoute un switch SW-01 puis relie-le à SW-CORE-01'), [
      'ajoute un switch SW-01', 'relie-le à SW-CORE-01',
    ])
    assert.deepEqual(decouperCommandes('sélectionne SW-01, ensuite supprime-le'), ['sélectionne SW-01', 'supprime-le'])
    assert.deepEqual(decouperCommandes('zoome et ensuite ajuste'), ['zoome', 'ajuste'])
  })

  it('« et » coupe devant un verbe de commande', () => {
    assert.deepEqual(decouperCommandes('ajoute un serveur SRV-01 et relie-le à SW-ACC-01'), [
      'ajoute un serveur SRV-01', 'relie-le à SW-ACC-01',
    ])
    assert.deepEqual(decouperCommandes('sélectionne tous les serveurs et mets-les dans le VLAN 20'), [
      'sélectionne tous les serveurs', 'mets-les dans le VLAN 20',
    ])
  })

  it('« et » ne coupe pas entre deux noms', () => {
    assert.deepEqual(decouperCommandes('relie SW-CORE-01 et SW-CORE-02'), ['relie SW-CORE-01 et SW-CORE-02'])
    assert.deepEqual(decouperCommandes('mets SW-CORE-01 et SW-CORE-02 dans la grappe cœur'), [
      'mets SW-CORE-01 et SW-CORE-02 dans la grappe cœur',
    ])
    assert.deepEqual(decouperCommandes('autorise les VLAN 10 et 20 entre A et B'), [
      'autorise les VLAN 10 et 20 entre A et B',
    ])
  })

  it('une énumération reste une seule commande', () => {
    assert.deepEqual(decouperCommandes('ajoute un routeur, un pare-feu et deux switchs cœur'), [
      'ajoute un routeur, un pare-feu et deux switchs cœur',
    ])
  })

  it('la virgule coupe devant un verbe', () => {
    assert.deepEqual(decouperCommandes('ajoute un serveur SRV-01, relie-le à SW-ACC-01 puis mets-le dans la zone serveurs'), [
      'ajoute un serveur SRV-01', 'relie-le à SW-ACC-01', 'mets-le dans la zone serveurs',
    ])
  })

  it('un mot qui est aussi un nom ne coupe pas sans pronom', () => {
    // « centre », « place », « note », « double » sont des noms autant que des verbes.
    assert.deepEqual(decouperCommandes('mets SW-01 dans la zone nord et centre'), [
      'mets SW-01 dans la zone nord et centre',
    ])
    assert.deepEqual(decouperCommandes('ajoute un serveur et passe-le en VLAN 20'), [
      'ajoute un serveur', 'passe-le en VLAN 20',
    ])
  })

  it('ne découpe jamais du texte libre', () => {
    // Une note peut contenir « relie », « puis », « et supprime » : ce sont des mots, pas des ordres.
    const note = 'note sur SW-01 : relie le port console puis supprime l’ancien câble'
    assert.deepEqual(decouperCommandes(note), [note])
    const titre = 'titre : cœur de réseau et accès'
    assert.deepEqual(decouperCommandes(titre), [titre])
    const ajout = 'ajoute une note vérifier le câblage puis relancer'
    assert.deepEqual(decouperCommandes(ajout), [ajout])
  })

  it('nettoie chaque morceau', () => {
    assert.deepEqual(decouperCommandes('euh ajoute un serveur puis euh relier-le à SW-01 merci'), [
      'ajoute un serveur', 'relie-le à SW-01',
    ])
  })

  it('rend une liste vide sur du bruit', () => {
    assert.deepEqual(decouperCommandes('euh'), [])
    assert.deepEqual(decouperCommandes(''), [])
  })
})
