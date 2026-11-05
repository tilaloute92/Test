import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Réconciliation d'une collecte avec un schéma existant.
 *
 * Une collecte unique ne sert à rien : on en refait une le mois suivant, et celle-là doit
 * se poser sur le schéma qu'on a passé une heure à ranger. Tout ce qui est vérifié ici se
 * ramène à deux règles : la collecte ne commande que ce que SNMP lui a dit, et rien ne
 * disparaît en silence.
 */

const { apparier, fusionner, resumerFusion, sansEcart } =
  await import('../collector/reconciliation.mjs')

const noeud = (id, nom, extra = {}) => ({ id, kind: 'switch', name: nom, x: 0, y: 0, ...extra })
const lien = (id, from, to, extra = {}) => ({ id, from, to, kind: 'ethernet', ...extra })

describe('rapprochement des équipements', () => {
  it('rapproche par le nom, sans se soucier de la casse', () => {
    const { paires, nouveaux, absents } = apparier(
      [noeud('n1', 'SW-CORE-01')],
      [noeud('c1', 'sw-core-01')],
    )
    assert.equal(paires.length, 1)
    assert.equal(paires[0].existant.id, 'n1')
    assert.deepEqual(nouveaux, [])
    assert.deepEqual(absents, [])
  })

  it('rapproche par l’adresse quand l’équipement a été renommé', () => {
    // Un switch renommé reste le même switch : le rapprochement par adresse évite qu'il
    // apparaisse en double à chaque collecte après un renommage.
    const { paires } = apparier(
      [noeud('n1', 'ANCIEN-NOM', { ip: '10.0.0.1' })],
      [noeud('c1', 'SW-CORE-01', { ip: '10.0.0.1' })],
    )
    assert.equal(paires.length, 1)
    assert.equal(paires[0].existant.id, 'n1')
  })

  it('rapproche par le numéro de série en dernier recours', () => {
    const { paires } = apparier(
      [noeud('n1', 'A', { serial: 'FDO1234' })],
      [noeud('c1', 'B', { ip: '10.0.0.9', serial: 'FDO1234' })],
    )
    assert.equal(paires.length, 1)
  })

  it('signale ce qui n’a pas répondu plutôt que de le passer sous silence', () => {
    const { absents } = apparier([noeud('n1', 'A'), noeud('n2', 'B')], [noeud('c1', 'A')])
    assert.deepEqual(absents.map((n) => n.name), ['B'])
  })

  it('ne rapproche pas deux collectés sur le même existant', () => {
    // Deux équipements qui annoncent le même nom : on ne devine pas lequel est le bon.
    const { paires, nouveaux } = apparier(
      [noeud('n1', 'A', { ip: '10.0.0.1' })],
      [noeud('c1', 'A'), noeud('c2', 'autre', { ip: '10.0.0.1' })],
    )
    assert.equal(paires.length, 1)
    assert.equal(nouveaux.length, 1)
    assert.ok(nouveaux[0]._ambigu, 'l’ambiguïté est signalée')
  })
})

describe('ce que la fusion préserve', () => {
  const range = {
    title: 'Siège', nodes: [
      noeud('n1', 'SW-CORE-01', { x: 400, y: 120, site: 'Siège', zone: 'Cœur', notes: 'Baie B12, port console 3' }),
    ],
    links: [], vlans: [{ id: '10', name: 'Bureautique' }], racks: [{ id: 'r1', name: 'B12' }],
    annotations: [{ id: 'a1', kind: 'note', text: 'Migration prévue en mars', x: 0, y: 0, w: 1, h: 1 }],
    titleBlock: { show: true, author: 'R. Nelson' },
  }

  it('ne touche jamais à la position', () => {
    // C'est le travail manuel le plus long et le plus facile à détruire.
    const { document } = fusionner(range, { nodes: [noeud('c1', 'SW-CORE-01', { x: 0, y: 0 })], links: [] })
    assert.equal(document.nodes[0].x, 400)
    assert.equal(document.nodes[0].y, 120)
  })

  it('ne touche pas au site, à la zone ni aux notes', () => {
    // SNMP n'en sait rien : il n'a donc rien à en dire.
    const { document } = fusionner(range, { nodes: [noeud('c1', 'SW-CORE-01')], links: [] })
    assert.equal(document.nodes[0].site, 'Siège')
    assert.equal(document.nodes[0].zone, 'Cœur')
    assert.match(document.nodes[0].notes, /Baie B12/)
  })

  it('garde VLAN, baies, annotations et cartouche', () => {
    const { document } = fusionner(range, { nodes: [noeud('c1', 'SW-CORE-01')], links: [] })
    assert.equal(document.vlans.length, 1)
    assert.equal(document.racks.length, 1)
    assert.equal(document.annotations.length, 1)
    assert.equal(document.titleBlock.author, 'R. Nelson')
    assert.equal(document.title, 'Siège')
  })

  it('ne reclasse pas un type d’équipement déjà choisi', () => {
    // La collecte devine le type d'après une description ; l'exploitant, lui, le sait.
    // Une boîte reclassée « serveur » à chaque passage ferait abandonner la collecte.
    const { document } = fusionner(
      { nodes: [noeud('n1', 'FW-01', { kind: 'ngfw' })], links: [] },
      { nodes: [noeud('c1', 'FW-01', { kind: 'server' })], links: [] },
    )
    assert.equal(document.nodes[0].kind, 'ngfw')
  })
})

describe('ce que la fusion met à jour', () => {
  it('reprend l’adresse, le modèle et le numéro de série', () => {
    const { document, rapport } = fusionner(
      { nodes: [noeud('n1', 'SW-01')], links: [] },
      { nodes: [noeud('c1', 'SW-01', { ip: '10.0.0.1', model: 'C9300-48P', serial: 'FDO999' })], links: [] },
    )
    assert.equal(document.nodes[0].ip, '10.0.0.1')
    assert.equal(document.nodes[0].model, 'C9300-48P')
    assert.equal(rapport.equipementsMisAJour.length, 1)
    assert.equal(rapport.equipementsMisAJour[0].changements.length, 3)
  })

  it('reprend les ports, le débit et l’agrégat d’une liaison connue', () => {
    const avant = {
      nodes: [noeud('n1', 'A'), noeud('n2', 'B')],
      links: [lien('l1', 'n1', 'n2', { portA: 'Eth1/1', portB: 'Eth1/1', speed: '1 Gb/s' })],
    }
    const apres = {
      nodes: [noeud('c1', 'A'), noeud('c2', 'B')],
      links: [lien('x1', 'c1', 'c2', { portA: 'Eth1/1', portB: 'Eth1/1', speed: '10 Gb/s', lag: 'Po1' })],
    }
    const { document, rapport } = fusionner(avant, apres)
    assert.equal(document.links.length, 1, 'la liaison est reconnue, pas dupliquée')
    assert.equal(document.links[0].speed, '10 Gb/s')
    assert.equal(document.links[0].lag, 'Po1')
    assert.equal(rapport.liaisonsMisesAJour.length, 1)
  })

  it('ajoute une liaison nouvelle entre deux équipements connus', () => {
    const avant = { nodes: [noeud('n1', 'A'), noeud('n2', 'B')], links: [] }
    const apres = {
      nodes: [noeud('c1', 'A'), noeud('c2', 'B')],
      links: [lien('x1', 'c1', 'c2', { portA: 'Eth1/5', portB: 'Eth1/5' })],
    }
    const { document, rapport } = fusionner(avant, apres)
    assert.equal(document.links.length, 1)
    assert.equal(document.links[0].from, 'n1', 'la liaison pointe sur les identifiants du schéma')
    assert.equal(document.links[0].to, 'n2')
    assert.equal(rapport.liaisonsAjoutees.length, 1)
  })

  it('distingue deux brins d’un même faisceau par leurs ports', () => {
    // Sans cela, le second brin d'un port-channel serait pris pour un doublon du premier
    // et le faisceau n'aurait jamais qu'un seul membre.
    const avant = { nodes: [noeud('n1', 'A'), noeud('n2', 'B')], links: [] }
    const apres = {
      nodes: [noeud('c1', 'A'), noeud('c2', 'B')],
      links: [
        lien('x1', 'c1', 'c2', { portA: 'Eth1/1', portB: 'Eth1/1', lag: 'Po1' }),
        lien('x2', 'c1', 'c2', { portA: 'Eth1/2', portB: 'Eth1/2', lag: 'Po1' }),
      ],
    }
    const { document } = fusionner(avant, apres)
    assert.equal(document.links.length, 2)
  })

  it('ajoute un équipement inconnu, à plat, pour le placement automatique', () => {
    const { document, rapport } = fusionner(
      { nodes: [noeud('n1', 'A')], links: [] },
      { nodes: [noeud('c1', 'A'), noeud('c2', 'NOUVEAU', { x: 999, y: 999 })], links: [] },
    )
    assert.equal(document.nodes.length, 2)
    const neuf = document.nodes.find((n) => n.name === 'NOUVEAU')
    assert.equal(neuf.x, 0, 'la collecte ne sait pas où poser une boîte')
    assert.equal(rapport.equipementsAjoutes.length, 1)
  })
})

describe('ce que la fusion refuse de supprimer', () => {
  it('ne supprime pas un équipement muet, il le signale', () => {
    // Communauté SNMP changée, équipement en maintenance, pare-feu qui bloque le 161 :
    // supprimer serait détruire un travail sur une supposition.
    const { document, rapport } = fusionner(
      { nodes: [noeud('n1', 'A'), noeud('n2', 'MUET', { ip: '10.0.0.2' })], links: [] },
      { nodes: [noeud('c1', 'A')], links: [] },
    )
    assert.equal(document.nodes.length, 2, 'rien n’a disparu')
    assert.equal(rapport.equipementsAbsents.length, 1)
    assert.equal(rapport.equipementsAbsents[0].nom, 'MUET')
    assert.match(document.nodes[1].notes, /Non revu/)
  })

  it('n’écrase pas une note déjà écrite et ne la répète pas', () => {
    const base = { nodes: [noeud('n1', 'A'), noeud('n2', 'MUET', { notes: 'Prêté au site B' })], links: [] }
    const collecte = { nodes: [noeud('c1', 'A')], links: [] }
    const premier = fusionner(base, collecte).document
    assert.match(premier.nodes[1].notes, /Prêté au site B/)
    assert.match(premier.nodes[1].notes, /Non revu/)
    const second = fusionner(premier, collecte).document
    assert.equal(
      (second.nodes[1].notes.match(/Non revu/g) ?? []).length, 1,
      'la note ne s’empile pas à chaque collecte',
    )
  })

  it('ne signale une liaison absente que si ses deux bouts ont répondu', () => {
    /*
      C'est la garde la plus importante du module. Une collecte partielle — un seul
      équipement interrogé sur dix — ferait sinon disparaître tout le reste du schéma.
    */
    const avant = {
      nodes: [noeud('n1', 'A'), noeud('n2', 'B'), noeud('n3', 'C')],
      links: [lien('l1', 'n1', 'n2', { portA: 'e1', portB: 'e1' }), lien('l2', 'n2', 'n3', { portA: 'e2', portB: 'e2' })],
    }
    // Seuls A et B répondent : la liaison B↔C n'est pas jugée, C n'a rien dit.
    const partielle = { nodes: [noeud('c1', 'A'), noeud('c2', 'B')], links: [] }
    const { rapport } = fusionner(avant, partielle)
    assert.deepEqual(rapport.liaisonsAbsentes.map((l) => `${l.de}↔${l.vers}`), ['A↔B'])
  })

  it('ne retire une liaison que si on le demande explicitement', () => {
    const avant = {
      nodes: [noeud('n1', 'A'), noeud('n2', 'B')],
      links: [lien('l1', 'n1', 'n2', { portA: 'e1', portB: 'e1' })],
    }
    const collecte = { nodes: [noeud('c1', 'A'), noeud('c2', 'B')], links: [] }
    assert.equal(fusionner(avant, collecte).document.links.length, 1, 'gardée par défaut')
    assert.equal(
      fusionner(avant, collecte, { retirerLiensAbsents: true }).document.links.length, 0,
      'retirée seulement sur demande',
    )
  })
})

describe('compte rendu', () => {
  it('dit « aucun écart » quand il n’y en a pas', () => {
    const { rapport } = fusionner(
      { nodes: [noeud('n1', 'A')], links: [] },
      { nodes: [noeud('c1', 'A')], links: [] },
    )
    assert.ok(sansEcart(rapport))
    assert.match(resumerFusion(rapport), /Aucun écart/)
  })

  it('met les disparitions en tête, parce que ce sont elles qui doivent faire hésiter', () => {
    const { rapport } = fusionner(
      { nodes: [noeud('n1', 'A'), noeud('n2', 'DISPARU')], links: [] },
      { nodes: [noeud('c1', 'A'), noeud('c2', 'NOUVEAU')], links: [] },
    )
    const texte = resumerFusion(rapport)
    assert.ok(texte.indexOf('non revus') < texte.indexOf('ajoutés'),
      'les disparitions doivent se lire avant les ajouts')
    assert.ok(!sansEcart(rapport))
  })

  it('n’inonde pas la console sur une grosse collecte', () => {
    const beaucoup = { nodes: Array.from({ length: 60 }, (_, i) => noeud(`c${i}`, `SW-${i}`)), links: [] }
    const texte = resumerFusion(fusionner({ nodes: [], links: [] }, beaucoup).rapport)
    assert.match(texte, /et 40 de plus/)
    assert.ok(texte.split('\n').length < 30, 'le compte rendu reste lisible d’un coup d’œil')
  })
})
