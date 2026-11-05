import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Lecture et écriture des listes de VLAN.
 *
 * C'est la donnée la plus recopiée à la main de toute l'application : elle arrive d'un
 * « show interface trunk », d'un export Prime, d'une dictée vocale. Chaque forme a ses
 * habitudes de ponctuation, et une liste mal lue se traduit par un VLAN absent du schéma
 * que personne ne remarque avant la coupure.
 */

const { parseVlanList, resumerVlans, vlanLabel, vlanColor } = await import('../../src/lib/osi.ts')

describe('lecture d’une liste de VLAN', () => {
  it('lit les formes courantes', () => {
    assert.deepEqual(parseVlanList('10'), ['10'])
    assert.deepEqual(parseVlanList('10,20,30'), ['10', '20', '30'])
    assert.deepEqual(parseVlanList('10, 20 , 30'), ['10', '20', '30'], 'espaces autour des virgules')
    assert.deepEqual(parseVlanList('10;20'), ['10', '20'], 'le point-virgule est accepté')
  })

  it('développe les intervalles', () => {
    assert.deepEqual(parseVlanList('20-22'), ['20', '21', '22'])
    assert.deepEqual(parseVlanList('10,20-22,30'), ['10', '20', '21', '22', '30'])
    assert.deepEqual(parseVlanList('20 - 22'), ['20', '21', '22'], 'espaces autour du tiret')
  })

  it('ne rend jamais deux fois le même VLAN', () => {
    assert.deepEqual(parseVlanList('10,10,20'), ['10', '20'])
    assert.deepEqual(parseVlanList('10-12,11'), ['10', '11', '12'])
  })

  it('refuse un intervalle déraisonnable au lieu de produire des milliers d’entrées', () => {
    // « 1-4094 » se tape vite et ferait exploser tout ce qui consomme cette liste.
    // La garde porte sur l'écart entre les bornes, pas sur le nombre de valeurs : un
    // intervalle de plus de 400 de large est abandonné, celui de 400 pile passe.
    assert.deepEqual(parseVlanList('1-4094'), [])
    assert.deepEqual(parseVlanList('1-402'), [], 'écart de 401 : abandonné')
    assert.equal(parseVlanList('1-401').length, 401, 'écart de 400 : accepté, bornes comprises')
    assert.deepEqual(parseVlanList('10,1-4094,20'), ['10', '20'],
      'l’intervalle démesuré saute, le reste de la liste survit')
  })

  it('rend une liste vide sur une entrée vide', () => {
    for (const vide of [undefined, '', '   ', ',', ',,']) {
      assert.deepEqual(parseVlanList(vide), [], `entrée « ${vide} »`)
    }
  })
})

describe('résumé pour une étiquette', () => {
  it('compresse les suites en intervalles', () => {
    assert.equal(resumerVlans('5,6,7,9'), '5-7,9')
    assert.equal(resumerVlans('10,11,12'), '10-12')
    assert.equal(resumerVlans('10,20,30'), '10,20,30', 'rien à compresser')
  })

  it('remet dans l’ordre', () => {
    assert.equal(resumerVlans('30,10,20'), '10,20,30')
  })

  it('s’arrête après quelques groupes et annonce le reste', () => {
    // Un trunk de cœur porte couramment soixante-dix VLAN : recopiés tels quels, ils
    // donnent une étiquette qui traverse le plan.
    const long = resumerVlans('10,20,30,40,50,60,70,80,90,100', 3)
    assert.ok(long.length < 40, `étiquette trop longue : « ${long} »`)
    assert.match(long, /\+/, 'le reste est annoncé')
  })

  it('rend la valeur telle quelle si elle n’est pas numérique', () => {
    assert.equal(resumerVlans('all'), 'all')
    assert.equal(resumerVlans('  natif  '), 'natif')
    assert.equal(resumerVlans(undefined), '')
  })
})

describe('libellé et couleur d’un VLAN', () => {
  const vlans = [{ id: '10', name: 'Bureautique', color: '#2563eb' }, { id: '20', name: 'Voix' }]

  it('nomme le VLAN quand le document le déclare', () => {
    assert.match(vlanLabel('10', vlans), /Bureautique/)
    assert.match(vlanLabel('10', vlans), /10/, 'le numéro reste visible')
  })

  it('se contente du numéro pour un VLAN non déclaré', () => {
    assert.match(vlanLabel('99', vlans), /99/)
  })

  it('donne une couleur stable au même VLAN', () => {
    assert.equal(vlanColor('99', vlans), vlanColor('99', vlans), 'même entrée, même couleur')
    assert.equal(vlanColor('10', vlans), '#2563eb', 'la couleur déclarée est respectée')
    assert.match(vlanColor('99', vlans), /^#[0-9a-f]{3,8}$/i, 'une couleur valide même sans déclaration')
  })
})
