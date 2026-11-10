import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Reconnaître un type d'équipement dans ce qu'on dit.
 *
 * C'est le point où la commande vocale et l'assistant peuvent inventer : un mot inconnu
 * rapproché de force d'un type qui lui ressemble donne un schéma faux, sans message.
 * « Caméra » créait une autorité de certification (synonyme « ca »), « automate » un SOAR
 * (« automatisation »), « serveur d'application » une borne Wi-Fi (« ap »).
 *
 * Deux listes donc : ce qui doit être reconnu, et ce qui ne doit surtout pas l'être.
 */

const { findDeviceScored } = await import('../../src/lib/catalog.ts')
const { analyserDescription } = await import('../../src/lib/assistant.ts')
const { interpret } = await import('../../src/lib/voice.ts')

const type = (mots) => findDeviceScored(mots)?.device.id

describe('mots de tous les jours', () => {
  const ATTENDUS = [
    ['serveur', 'server'], ['serveurs', 'server'], ['serveur web', 'server'], ['serveur de fichiers', 'server'],
    ['serveur d’application', 'server'], ['serveur de messagerie', 'server'], ['machine virtuelle', 'server'],
    ['serveur de sauvegarde', 'backup'], ['serveur de supervision', 'nms'], ['supervision', 'nms'],
    ['switch', 'switch'], ['commutateur', 'switch'], ['switch de distribution', 'switch'], ['switch industriel', 'switch'],
    ['switch cœur', 'core-switch'], ['switchs cœur', 'core-switch'], ['switches coeur', 'core-switch'], ['cœurs', 'core-switch'],
    ['switch d’accès', 'access-switch'], ['switchs d’accès', 'access-switch'], ['commutateur d’accès', 'access-switch'], ['switch PoE', 'access-switch'],
    ['routeur', 'router'], ['routeur de périmètre', 'router'], ['pare-feu', 'firewall'], ['pare feu', 'firewall'], ['firewall', 'firewall'],
    ['borne wifi', 'wifi'], ['borne', 'wifi'], ['point d’accès', 'wifi'], ['points d’accès wifi', 'wifi'], ['contrôleur wifi', 'wlan-controller'],
    ['poste', 'workstation'], ['postes de travail', 'workstation'], ['PC', 'workstation'], ['ordinateur portable', 'workstation'],
    ['téléphone', 'phone'], ['téléphone IP', 'phone'], ['caméra', 'camera'], ['caméra IP', 'camera'], ['imprimante', 'printer'],
    ['hyperviseur', 'hypervisor'], ['ESXi', 'hypervisor'], ['baie de stockage', 'storage'], ['NAS', 'storage'], ['baie SAN', 'storage'],
    ['onduleur', 'ups'], ['répartiteur de charge', 'loadbalancer'], ['load balancer', 'loadbalancer'], ['lien opérateur', 'wan'],
    ['opérateur', 'wan'], ['internet', 'internet'], ['spine', 'spine'], ['leaf', 'leaf'], ['témoin', 'witness'],
    ['contrôleur de domaine', 'idp'], ['Active Directory', 'idp'], ['sonde', 'ips'], ['bastion', 'bastion'], ['WAF', 'waf'],
  ]
  for (const [mots, attendu] of ATTENDUS) {
    it(`« ${mots} »`, () => assert.equal(type(mots), attendu))
  }
})

describe('ce qui ne doit pas être deviné', () => {
  // Aucun de ces mots n'est un type du catalogue de base : la bonne réponse est « inconnu ».
  for (const mots of ['automate', 'capteur', 'smartphone', 'tablette', 'application', 'antenne', 'écran', 'truc', 'ca va']) {
    it(`« ${mots} » n’est rapproché d’aucun type`, () => assert.equal(type(mots), undefined))
  }

  it('un mot écorché d’une lettre reste reconnu', () => {
    assert.equal(type('pare-fou'), 'firewall')
    assert.equal(type('rooteur'), 'router')
  })

  it('un synonyme court n’est pas un début de mot', () => {
    // « ap » est la borne Wi-Fi, « ca » l'autorité de certification : ni l'un ni l'autre
    // ne sont le début d'« application » ou de « caméra ».
    assert.equal(type('ap'), 'wifi')
    assert.notEqual(type('caméra'), 'pki')
    assert.notEqual(type('serveur d’application'), 'wifi')
  })
})

describe('la voix et l’assistant s’accordent', () => {
  const vide = { title: '', nodes: [], links: [] }
  const parAssistant = (mots) => {
    const plan = analyserDescription(`deux ${mots}`, vide)
    return [...new Set(plan.etapes.flatMap((e) => e.operations).filter((o) => o.type === 'noeud').map((o) => o.kind))]
  }

  // [au pluriel pour l'assistant, au singulier pour la voix, type attendu]
  const COMMUNS = [
    ['serveurs web', 'serveur web', 'server'],
    ['caméras', 'caméra', 'camera'],
    ['points d’accès', 'point d’accès', 'wifi'],
    ['commutateurs d’accès', 'commutateur d’accès', 'access-switch'],
  ]
  for (const [pluriel, singulier, attendu] of COMMUNS) {
    it(`« ${singulier} » donne le même type des deux côtés`, () => {
      assert.deepEqual(parAssistant(pluriel), [attendu])
      const intention = interpret(`ajoute un ${singulier}`)
      assert.equal(intention?.type, 'add')
      assert.equal(intention.kind, attendu)
    })
  }

  it('ce qui qualifie le type ne passe pas dans le nom', () => {
    assert.equal(interpret('ajoute un serveur de fichiers SRV-FIC-01').name, 'SRV-FIC-01')
    assert.equal(interpret('ajoute un switch d’accès SW-ACC-03').name, 'SW-ACC-03')
    // Un synonyme du type en tête du nom reste dans le nom.
    assert.equal(interpret('ajoute un serveur srv fic zéro un').name, 'SRV-FIC-01')
  })

  it('sans nom reconnaissable, la phrase tient lieu de nom', () => {
    const intention = interpret('ajoute un serveur web')
    assert.equal(intention.name, 'Serveur web')
    assert.equal(intention.descriptif, true)
  })

  it('l’assistant dit ce qu’il n’a pas compris au lieu de l’inventer', () => {
    const plan = analyserDescription('un pare-feu, quatre automates', vide)
    assert.equal(plan.noeuds, 1)
    assert.deepEqual(plan.ignores, ['quatre automates'])
  })

  it('la voix refuse un type inconnu', () => {
    assert.equal(interpret('ajoute un automate'), null)
  })
})
