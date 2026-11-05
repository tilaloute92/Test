import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Décodage des relevés SNMP.
 *
 * C'est de là que sort le schéma généré automatiquement. Une table mal lue et le schéma
 * annonce des ports qui n'existent pas, des agrégats qui n'en sont pas, ou rate le
 * peer-link d'une paire vPC — autant d'erreurs qu'on ne découvre qu'en salle.
 *
 * Les relevés sont pris avec `snmpwalk -On` : les OID restent numériques, car les noms
 * symboliques dépendent des MIB installées sur le poste qui interroge.
 */

const {
  lireWalk, lireInterfaces, debitLisible, lireAgregats, lireVoisins, lireVpc,
  nomAgregatCourt, agregatDuPort,
} = await import('../collector/snmp-topologie.mjs')

describe('lecture brute d’un relevé', () => {
  it('lit une ligne ordinaire', () => {
    const lignes = lireWalk('.1.3.6.1.2.1.31.1.1.1.1.1 = STRING: Ethernet1/1')
    assert.equal(lignes.length, 1)
    assert.equal(lignes[0].valeur, 'Ethernet1/1')
  })

  it('écarte les réponses « objet absent » au lieu de les prendre pour des valeurs', () => {
    // Le piège : « No Such Object » commence par un mot que l'on peut prendre pour le type.
    const texte = [
      '.1.3.6.1.2.1.31.1.1.1.1.1 = STRING: Ethernet1/1',
      '.1.3.6.1.2.1.31.1.1.1.1.2 = No Such Object available on this agent at this OID',
      '.1.3.6.1.2.1.31.1.1.1.1.3 = No Such Instance currently exists at this OID',
      '.1.3.6.1.2.1.31.1.1.1.1.4 = End of MIB',
    ].join('\n')
    const lignes = lireWalk(texte)
    assert.equal(lignes.length, 1, `${lignes.length} ligne(s) retenue(s) au lieu d’une`)
    assert.equal(lignes[0].valeur, 'Ethernet1/1')
  })

  it('ne retient rien d’un relevé vide ou de lignes sans égal', () => {
    assert.deepEqual(lireWalk(''), [])
    assert.deepEqual(lireWalk('bonjour\n\n   '), [])
  })

  it('retire les guillemets que certains agents ajoutent', () => {
    const lignes = lireWalk('.1.3.6.1.2.1.31.1.1.1.18.1 = STRING: "Vers SW-CORE-01"')
    assert.equal(lignes[0].valeur, 'Vers SW-CORE-01')
  })
})

describe('table des interfaces', () => {
  const texte = [
    '.1.3.6.1.2.1.31.1.1.1.1.1 = STRING: Ethernet1/1',
    '.1.3.6.1.2.1.31.1.1.1.1.2 = STRING: Ethernet1/2',
    '.1.3.6.1.2.1.31.1.1.1.1.99 = STRING: port-channel23',
    '.1.3.6.1.2.1.31.1.1.1.15.1 = Gauge32: 10000',
    '.1.3.6.1.2.1.31.1.1.1.15.2 = Gauge32: 10000',
    '.1.3.6.1.2.1.31.1.1.1.15.99 = Gauge32: 20000',
    '.1.3.6.1.2.1.31.1.1.1.18.1 = STRING: Vers SW-CORE-01',
  ].join('\n')

  it('associe nom, débit et description à chaque index', () => {
    const interfaces = lireInterfaces(texte)
    assert.equal(interfaces.get('1').nom, 'Ethernet1/1')
    assert.equal(interfaces.get('1').debitMbps, 10000)
    assert.equal(interfaces.get('1').description, 'Vers SW-CORE-01')
    assert.equal(interfaces.get('99').nom, 'port-channel23')
  })

  it('ne confond pas les index à plusieurs chiffres', () => {
    const interfaces = lireInterfaces(texte)
    assert.equal(interfaces.get('99').debitMbps, 20000, 'l’index 99 ne doit pas être lu « 9 » puis « 9 »')
  })
})

describe('débits lisibles', () => {
  it('traduit les valeurs de ifHighSpeed', () => {
    assert.equal(debitLisible(10000), '10 Gb/s')
    assert.equal(debitLisible(1000), '1 Gb/s')
    assert.equal(debitLisible(100), '100 Mb/s')
    assert.equal(debitLisible(40000), '40 Gb/s')
  })

  it('ne rend rien sur une valeur absente ou nulle', () => {
    assert.equal(debitLisible(0), undefined)
    assert.equal(debitLisible(undefined), undefined)
  })
})

describe('appartenance aux agrégats', () => {
  // ifStackTable : l'index est « supérieur.inférieur ». Vendeur-neutre, contrairement aux
  // tables propriétaires de chaque constructeur.
  const pile = [
    '.1.3.6.1.2.1.31.1.2.1.3.99.1 = INTEGER: 1',
    '.1.3.6.1.2.1.31.1.2.1.3.99.2 = INTEGER: 1',
    '.1.3.6.1.2.1.31.1.2.1.3.0.99 = INTEGER: 1',
    '.1.3.6.1.2.1.31.1.2.1.3.1.0 = INTEGER: 1',
  ].join('\n')
  const interfaces = lireInterfaces([
    '.1.3.6.1.2.1.31.1.1.1.1.1 = STRING: Ethernet1/1',
    '.1.3.6.1.2.1.31.1.1.1.1.2 = STRING: Ethernet1/2',
    '.1.3.6.1.2.1.31.1.1.1.1.99 = STRING: port-channel23',
  ].join('\n'))

  it('rattache les ports physiques à leur port-channel', () => {
    const trouves = lireAgregats(pile, interfaces)
    const po = trouves.find((a) => a.nom === 'port-channel23')
    assert.ok(po, 'port-channel23 non détecté')
    assert.deepEqual(po.membres.sort(), ['Ethernet1/1', 'Ethernet1/2'])
  })

  it('ignore les lignes d’index zéro, qui ne désignent pas une interface', () => {
    const trouves = lireAgregats(pile, interfaces)
    assert.equal(trouves.length, 1, 'une seule agrégation attendue')
  })

  it('n’invente pas d’agrégat sur une interface de VLAN', () => {
    // Une SVI « Vlan10 » apparaît dans ifStackTable au-dessus de ses ports : ce n'est pas
    // un port-channel, et l'encercler sur le schéma n'aurait aucun sens.
    const svi = lireInterfaces([
      '.1.3.6.1.2.1.31.1.1.1.1.1 = STRING: Ethernet1/1',
      '.1.3.6.1.2.1.31.1.1.1.1.50 = STRING: Vlan10',
    ].join('\n'))
    const trouves = lireAgregats('.1.3.6.1.2.1.31.1.2.1.3.50.1 = INTEGER: 1', svi)
    assert.deepEqual(trouves, [])
  })

  it('abrège les noms longs pour l’étiquette du schéma', () => {
    assert.equal(nomAgregatCourt('port-channel23'), 'Po23')
    assert.equal(nomAgregatCourt('Port-channel1'), 'Po1')
    assert.equal(nomAgregatCourt('Po5'), 'Po5')
  })

  it('retrouve l’agrégat d’un port donné', () => {
    const trouves = lireAgregats(pile, interfaces)
    assert.equal(agregatDuPort(trouves, 'Ethernet1/1')?.nom, 'port-channel23')
    assert.equal(agregatDuPort(trouves, 'Ethernet9/9'), undefined)
  })
})

describe('voisinage LLDP', () => {
  const distant = [
    '.1.0.8802.1.1.2.1.4.1.1.7.0.1.1 = STRING: Ethernet1/5',
    '.1.0.8802.1.1.2.1.4.1.1.9.0.1.1 = STRING: SW-CORE-01',
    '.1.0.8802.1.1.2.1.4.1.1.10.0.1.1 = STRING: Cisco NX-OS',
  ].join('\n')
  const local = '.1.0.8802.1.1.2.1.3.7.1.3.1 = STRING: Ethernet1/1'

  it('relie le port local au voisin annoncé', () => {
    const { voisins } = lireVoisins(distant, local, lireInterfaces('.1.3.6.1.2.1.31.1.1.1.1.1 = STRING: Ethernet1/1'))
    assert.equal(voisins.length, 1)
    assert.equal(voisins[0].nomDistant, 'SW-CORE-01')
    assert.equal(voisins[0].portDistant, 'Ethernet1/5')
    assert.equal(voisins[0].portLocal, 'Ethernet1/1')
  })

  it('ne rend aucun voisin sur un relevé vide', () => {
    const { voisins } = lireVoisins('', '', new Map())
    assert.deepEqual(voisins, [])
  })
})

describe('paire vPC', () => {
  it('relève le numéro de domaine', () => {
    const vpc = lireVpc('.1.3.6.1.4.1.9.9.807.1.1.1.1.1.10 = INTEGER: 10', new Map())
    assert.equal(vpc.domaine, 10, 'le domaine est un nombre, pas une chaîne')
  })

  it('nomme le peer-link à partir de la table des interfaces', () => {
    // La MIB rend un ifIndex ; sans la table des interfaces, l'étiquette serait un numéro
    // que personne ne reconnaît sur un schéma.
    const interfaces = lireInterfaces('.1.3.6.1.2.1.31.1.1.1.1.99 = STRING: port-channel10')
    const vpc = lireVpc([
      '.1.3.6.1.4.1.9.9.807.1.1.1.1.1.10 = INTEGER: 10',
      '.1.3.6.1.4.1.9.9.807.1.1.1.1.3.10 = INTEGER: 99',
    ].join('\n'), interfaces)
    assert.equal(vpc.peerLink, 'port-channel10')
  })

  it('retombe sur l’ifIndex quand l’interface est inconnue', () => {
    const vpc = lireVpc([
      '.1.3.6.1.4.1.9.9.807.1.1.1.1.1.10 = INTEGER: 10',
      '.1.3.6.1.4.1.9.9.807.1.1.1.1.3.10 = INTEGER: 77',
    ].join('\n'), new Map())
    assert.match(vpc.peerLink, /77/, 'au moins l’index, plutôt que rien')
  })

  it('ne rend rien quand l’équipement n’est pas en vPC', () => {
    // La grande majorité du parc : un switch d'accès n'a pas de domaine vPC, et ce n'est
    // pas une anomalie à signaler.
    assert.equal(lireVpc('', new Map()), null)
    assert.equal(lireVpc('.1.3.6.1.2.1.31.1.1.1.1.1 = STRING: Ethernet1/1', new Map()), null)
  })
})
