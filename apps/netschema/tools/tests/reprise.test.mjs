import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

/**
 * Repartir des équipements déjà enregistrés dans l'inventaire.
 *
 * Ce qu'on reprend doit arriver entier — la fiche, les liaisons déjà tracées, la baie, le
 * plan d'adressage — et rien ne doit arriver deux fois : ni un équipement déjà sur la page,
 * ni une liaison tracée sur deux pages du même document.
 */

const { cleNom, inventaireDuDocument, preparerReprise } = await import('../../src/lib/reprise.ts')

let compteur = 0
const noeud = (name, kind, extra = {}) => ({ id: `n${(compteur += 1)}`, kind, name, x: 0, y: 0, ...extra })
const lien = (a, b, extra = {}) => ({ id: `l${(compteur += 1)}`, from: a.id, to: b.id, kind: 'ethernet', ...extra })
const page = (pageName, nodes, links = [], extra = {}) => ({ title: 'Parc', pageName, nodes, links, ...extra })
const vide = () => page('Nouvelle', [])
const noms = (liste) => liste.map((n) => n.name).sort()

/** Un document à deux pages : la vue d'ensemble, et le détail du site de Lyon. */
function parc() {
  const coeur1 = noeud('SW-CORE-01', 'core-switch', { x: 100, y: 200, model: 'C9500', serial: 'FOC1', ip: '10.0.0.1', rack: 'r1', rackUnit: 40, site: 'Siège', cluster: 'CORE' })
  const coeur2 = noeud('SW-CORE-02', 'core-switch', { x: 400, y: 200, model: 'C9500', rack: 'r1', rackUnit: 38, site: 'Siège', cluster: 'CORE' })
  const parefeu = noeud('FW-01', 'firewall', { x: 250, y: 50, ip: '10.0.0.254', site: 'Siège' })
  const acces = noeud('SW-ACC-01', 'access-switch', { x: 100, y: 400, vlan: 'VLAN 20', site: 'Siège' })
  const ensemble = page(
    'Vue d’ensemble',
    [coeur1, coeur2, parefeu, acces],
    [
      lien(coeur1, coeur2, { kind: 'stack', lag: 'Po1', waypoints: [{ x: 250, y: 180 }] }),
      lien(coeur1, coeur2, { kind: 'stack', lag: 'Po1' }),
      lien(parefeu, coeur1, { speed: '10 Gb/s' }),
      lien(acces, coeur1, { mode: 'trunk', vlans: '10,20' }),
    ],
    {
      racks: [{ id: 'r1', name: 'Baie A1', units: 42, site: 'Siège' }],
      vlans: [{ id: '10', name: 'Serveurs', subnet: '10.0.10.0/24' }, { id: '20', name: 'Bureaux' }, { id: '99', name: 'Inutilisé' }],
      clusterColors: { CORE: '#0e7490' },
    },
  )
  // Sur la seconde page, le même cœur est moins renseigné, et la même liaison est retracée.
  const coeurBis = noeud('SW-CORE-01', 'core-switch', { x: 900, y: 900 })
  const routeur = noeud('RTR-LYON', 'router', { x: 900, y: 700, site: 'Lyon', ip: '10.9.0.1' })
  const serveur = noeud('SRV-LYON', 'server', { x: 1100, y: 900, site: 'Lyon' })
  const lyon = page('Lyon', [coeurBis, routeur, serveur], [lien(routeur, coeurBis), lien(serveur, routeur)])
  return [ensemble, lyon]
}

beforeEach(() => {
  compteur = 0
})

describe('l’inventaire du document', () => {
  it('propose chaque équipement une fois, toutes pages confondues', () => {
    const inventaire = inventaireDuDocument(parc())
    assert.deepEqual(
      inventaire.map((item) => item.node.name),
      ['FW-01', 'RTR-LYON', 'SRV-LYON', 'SW-ACC-01', 'SW-CORE-01', 'SW-CORE-02'],
    )
  })

  it('retient la fiche la mieux renseignée, et dit où l’équipement figure', () => {
    const coeur = inventaireDuDocument(parc()).find((item) => item.cle === 'sw-core-01')
    assert.equal(coeur.node.serial, 'FOC1')
    assert.deepEqual(coeur.pages, ['Vue d’ensemble', 'Lyon'])
  })

  it('le nom se compare sans la casse ni les espaces de bord', () => {
    assert.equal(cleNom('  SW-Core-01 '), 'sw-core-01')
    const pages = [page('A', [noeud('fw-01', 'firewall')]), page('B', [noeud('FW-01 ', 'firewall', { ip: '1.1.1.1' })])]
    assert.equal(inventaireDuDocument(pages).length, 1)
  })
})

describe('reprendre des équipements', () => {
  it('la fiche arrive entière, sous un identifiant neuf', () => {
    const sources = parc()
    const { nodes } = preparerReprise(sources, ['SW-CORE-01'], vide())
    assert.equal(nodes.length, 1)
    const [coeur] = nodes
    assert.equal(coeur.model, 'C9500')
    assert.equal(coeur.serial, 'FOC1')
    assert.equal(coeur.ip, '10.0.0.1')
    assert.ok(!sources.flatMap((p) => p.nodes).some((n) => n.id === coeur.id), 'identifiant neuf')
  })

  it('les liaisons tracées entre eux suivent, avec tous leurs brins', () => {
    const { nodes, links } = preparerReprise(parc(), ['SW-CORE-01', 'SW-CORE-02', 'FW-01'], vide())
    assert.equal(links.length, 3, 'deux brins entre les cœurs, un vers le pare-feu')
    const ids = new Set(nodes.map((n) => n.id))
    assert.ok(links.every((l) => ids.has(l.from) && ids.has(l.to)), 'aucune liaison ne pend dans le vide')
    assert.equal(links.filter((l) => l.lag === 'Po1').length, 2)
    assert.equal(links.find((l) => l.speed)?.speed, '10 Gb/s')
  })

  it('pas celles qui mènent à un équipement non repris', () => {
    const { links } = preparerReprise(parc(), ['SW-CORE-01', 'SW-CORE-02'], vide())
    assert.equal(links.length, 2)
  })

  it('une liaison tracée sur deux pages n’arrive qu’une fois', () => {
    const sources = parc()
    // La liaison RTR-LYON ↔ SW-CORE-01 existe aussi, retracée, sur la vue d'ensemble.
    const routeurBis = noeud('RTR-LYON', 'router')
    sources[0].nodes.push(routeurBis)
    sources[0].links.push(lien(routeurBis, sources[0].nodes[0]))
    const { links } = preparerReprise(sources, ['RTR-LYON', 'SW-CORE-01'], vide())
    assert.equal(links.length, 1)
  })

  it('on peut ne pas reprendre les liaisons', () => {
    const { nodes, links } = preparerReprise(parc(), ['SW-CORE-01', 'SW-CORE-02'], vide(), { liaisons: false })
    assert.equal(nodes.length, 2)
    assert.equal(links.length, 0)
  })

  it('un équipement déjà sur la page n’est pas repris une seconde fois', () => {
    const cible = page('Cible', [noeud('sw-core-01', 'core-switch')])
    const reprise = preparerReprise(parc(), ['SW-CORE-01', 'FW-01'], cible)
    assert.deepEqual(noms(reprise.nodes), ['FW-01'])
    assert.deepEqual(reprise.dejaLa, ['SW-CORE-01'])
    assert.equal(reprise.links.length, 1, 'le pare-feu repris est raccordé au cœur déjà en place')
    assert.equal(reprise.links[0].to, cible.nodes[0].id)
  })

  it('les liaisons vers ce que la page porte déjà suivent aussi', () => {
    // La page a déjà le cœur ; on y reprend le pare-feu et le switch d'accès, qui y étaient reliés.
    const cible = page('Cible', [noeud('SW-CORE-01', 'core-switch')])
    const reprise = preparerReprise(parc(), ['FW-01', 'SW-ACC-01'], cible)
    assert.equal(reprise.links.length, 2)
    const coeur = cible.nodes[0].id
    assert.ok(reprise.links.every((l) => l.from === coeur || l.to === coeur), 'raccordés au cœur déjà en place')
    assert.equal(reprise.links.find((l) => l.speed)?.speed, '10 Gb/s')
  })

  it('mais pas entre deux équipements déjà reliés sur la page', () => {
    const coeur = noeud('SW-CORE-01', 'core-switch')
    const parefeu = noeud('FW-01', 'firewall')
    const cible = page('Cible', [coeur, parefeu], [lien(parefeu, coeur)])
    const reprise = preparerReprise(parc(), ['SW-CORE-02'], cible)
    assert.equal(reprise.links.length, 2, 'les deux brins vers SW-CORE-01, et rien d’autre')
  })

  it('ni entre deux équipements déjà sur la page, même non reliés', () => {
    const cible = page('Cible', [noeud('SW-CORE-01', 'core-switch'), noeud('FW-01', 'firewall')])
    const reprise = preparerReprise(parc(), ['SW-ACC-01'], cible)
    assert.equal(reprise.links.length, 1, 'seule la liaison de l’équipement repris arrive')
  })

  it('un nom inconnu est signalé', () => {
    const reprise = preparerReprise(parc(), ['FW-01', 'INCONNU'], vide())
    assert.deepEqual(noms(reprise.nodes), ['FW-01'])
    assert.deepEqual(reprise.introuvables, ['inconnu'])
  })

  it('demandé deux fois, repris une fois', () => {
    assert.equal(preparerReprise(parc(), ['FW-01', 'fw-01', ' FW-01 '], vide()).nodes.length, 1)
  })

  it('ne modifie ni les sources ni la cible', () => {
    const sources = parc()
    const cible = vide()
    const avant = JSON.stringify([sources, cible])
    preparerReprise(sources, ['SW-CORE-01', 'SW-CORE-02', 'SW-ACC-01', 'RTR-LYON'], cible)
    assert.equal(JSON.stringify([sources, cible]), avant)
  })
})

describe('la disposition', () => {
  it('venus d’une même page, ils gardent leur place et leur tracé', () => {
    const reprise = preparerReprise(parc(), ['SW-CORE-01', 'SW-CORE-02', 'FW-01'], vide())
    assert.equal(reprise.dispositionOrigine, true)
    const coeur = reprise.nodes.find((n) => n.name === 'SW-CORE-01')
    assert.deepEqual([coeur.x, coeur.y], [100, 200])
    assert.ok(reprise.links.some((l) => l.waypoints?.length === 1), 'le point de passage posé à la main est gardé')
  })

  it('la place vient de la page commune, la fiche de la mieux renseignée', () => {
    // SW-CORE-01 figure sur les deux pages ; avec RTR-LYON, seule la page Lyon les porte tous.
    const reprise = preparerReprise(parc(), ['SW-CORE-01', 'RTR-LYON'], vide())
    assert.equal(reprise.dispositionOrigine, true)
    const coeur = reprise.nodes.find((n) => n.name === 'SW-CORE-01')
    assert.deepEqual([coeur.x, coeur.y], [900, 900], 'placé comme sur la page Lyon')
    assert.equal(coeur.serial, 'FOC1', 'avec la fiche complète de la vue d’ensemble')
  })

  it('venus de pages différentes, le tracé à la main est abandonné', () => {
    const reprise = preparerReprise(parc(), ['SW-CORE-01', 'SW-CORE-02', 'SRV-LYON'], vide())
    assert.equal(reprise.dispositionOrigine, false)
    assert.ok(reprise.links.every((l) => !l.waypoints), 'un point de passage hors de sa page ne mène nulle part')
    assert.equal(reprise.links.length, 2, 'les liaisons elles-mêmes sont gardées')
  })
})

describe('ce qui suit l’équipement', () => {
  it('sa baie est créée sur la page, et il y garde son emplacement', () => {
    const reprise = preparerReprise(parc(), ['SW-CORE-01', 'SW-CORE-02'], vide())
    assert.equal(reprise.racks.length, 1, 'une seule baie pour les deux')
    assert.equal(reprise.racks[0].name, 'Baie A1')
    assert.notEqual(reprise.racks[0].id, 'r1', 'identifiant neuf')
    for (const n of reprise.nodes) assert.equal(n.rack, reprise.racks[0].id)
    assert.deepEqual(reprise.nodes.map((n) => n.rackUnit).sort(), [38, 40])
  })

  it('une baie du même nom déjà sur la page est réutilisée', () => {
    const cible = page('Cible', [], [], { racks: [{ id: 'rx', name: 'baie a1', units: 42 }] })
    const reprise = preparerReprise(parc(), ['SW-CORE-01'], cible)
    assert.equal(reprise.racks.length, 0)
    assert.equal(reprise.nodes[0].rack, 'rx')
  })

  it('un emplacement déjà pris n’est pas repris : l’équipement reste à placer', () => {
    const cible = page('Cible', [noeud('AUTRE', 'server', { rack: 'rx', rackUnit: 40, heightU: 1 })], [], {
      racks: [{ id: 'rx', name: 'Baie A1', units: 42 }],
    })
    const [coeur] = preparerReprise(parc(), ['SW-CORE-01'], cible).nodes
    assert.equal(coeur.rack, 'rx')
    assert.equal(coeur.rackUnit, undefined)
  })

  it('une baie trop petite ne reçoit pas un emplacement hors d’elle', () => {
    const cible = page('Cible', [], [], { racks: [{ id: 'rx', name: 'Baie A1', units: 24 }] })
    const [coeur] = preparerReprise(parc(), ['SW-CORE-01'], cible).nodes
    assert.equal(coeur.rackUnit, undefined)
  })

  it('le plan d’adressage suit pour les VLAN cités, pas pour les autres', () => {
    const reprise = preparerReprise(parc(), ['SW-ACC-01', 'SW-CORE-01'], vide())
    assert.deepEqual(reprise.vlans.map((v) => v.id).sort(), ['10', '20'])
    assert.equal(reprise.vlans.find((v) => v.id === '10').subnet, '10.0.10.0/24')
  })

  it('un VLAN déjà décrit sur la page n’est pas écrasé', () => {
    const cible = page('Cible', [], [], { vlans: [{ id: '20', name: 'Postes' }] })
    const reprise = preparerReprise(parc(), ['SW-ACC-01'], cible)
    assert.deepEqual(reprise.vlans, [])
  })

  it('la couleur de sa grappe suit', () => {
    assert.deepEqual(preparerReprise(parc(), ['SW-CORE-01'], vide()).clusterColors, { CORE: '#0e7490' })
  })
})

// ─── Dans l'application : le magasin et la voix ──────────────────────────────

const { useDiagram } = await import('../../src/store/useDiagram.ts')
const { NODE_W, NODE_H } = await import('../../src/types.ts')
assert.equal(typeof NODE_W, 'number')

const magasin = () => useDiagram.getState()
const schema = () => magasin().diagram
const surLaPage = (nom) => schema().nodes.find((n) => n.name === nom)
const dire = (phrase) => magasin().runVoiceCommand(phrase)
function ok(phrase) {
  const r = dire(phrase)
  assert.ok(r.ok, `« ${phrase} » refusée : ${r.message}`)
  return r
}
const empiles = (nodes) => {
  const paires = []
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (Math.abs(nodes[i].x - nodes[j].x) < NODE_W * 0.8 && Math.abs(nodes[i].y - nodes[j].y) < NODE_H * 0.8) {
        paires.push(`${nodes[i].name}/${nodes[j].name}`)
      }
    }
  }
  return paires
}

/** Charge le parc de démonstration comme document ouvert, sur sa première page. */
function ouvrirLeParc() {
  compteur = 0
  magasin().loadClasseur({ title: 'Parc', pages: parc(), activePage: 0 })
}

describe('reprendre sur une nouvelle page', () => {
  beforeEach(ouvrirLeParc)

  it('la page est créée, ouverte, et porte les équipements avec leurs liaisons', () => {
    const fait = magasin().reprendreEquipements(magasin().pagesCompletes(), ['SW-CORE-01', 'SW-CORE-02', 'FW-01'], {
      nouvellePage: 'Cœur du siège',
    })
    assert.deepEqual([fait.equipements, fait.liaisons], [3, 3])
    assert.equal(magasin().pagesCompletes().length, 3)
    assert.equal(schema().pageName, 'Cœur du siège')
    assert.deepEqual(noms(schema().nodes), ['FW-01', 'SW-CORE-01', 'SW-CORE-02'])
    assert.equal(schema().links.length, 3)
    assert.equal(surLaPage('SW-CORE-01').serial, 'FOC1')
  })

  it('la page d’origine n’est pas touchée', () => {
    const avant = JSON.stringify(magasin().pagesCompletes()[0])
    magasin().reprendreEquipements(magasin().pagesCompletes(), ['SW-CORE-01', 'FW-01'], { nouvellePage: '' })
    assert.equal(JSON.stringify(magasin().pagesCompletes()[0]), avant)
  })

  it('les deux exemplaires sont indépendants', () => {
    magasin().reprendreEquipements(magasin().pagesCompletes(), ['FW-01'], { nouvellePage: 'Copie' })
    magasin().updateNode(surLaPage('FW-01').id, { ip: '192.0.2.1' })
    assert.equal(magasin().pagesCompletes()[0].nodes.find((n) => n.name === 'FW-01').ip, '10.0.0.254')
  })

  it('sans nom donné, la page reçoit un nom libre', () => {
    magasin().reprendreEquipements(magasin().pagesCompletes(), ['FW-01'], { nouvellePage: '' })
    const nomsDePages = magasin().pagesCompletes().map((p) => p.pageName)
    assert.equal(new Set(nomsDePages).size, nomsDePages.length, `noms de pages : ${nomsDePages.join(', ')}`)
  })

  it('rien à reprendre : aucune page n’est créée', () => {
    const fait = magasin().reprendreEquipements(magasin().pagesCompletes(), ['INCONNU'], { nouvellePage: 'Vide' })
    assert.equal(fait.equipements, 0)
    assert.equal(magasin().pagesCompletes().length, 2)
  })

  it('la baie et le plan d’adressage suivent', () => {
    magasin().reprendreEquipements(magasin().pagesCompletes(), ['SW-CORE-01', 'SW-ACC-01'], { nouvellePage: 'Détail' })
    assert.deepEqual(schema().racks.map((r) => r.name), ['Baie A1'])
    assert.equal(surLaPage('SW-CORE-01').rack, schema().racks[0].id)
    assert.deepEqual(schema().vlans.map((v) => v.id).sort(), ['10', '20'])
  })

  it('placement automatique sur demande', () => {
    magasin().reprendreEquipements(magasin().pagesCompletes(), ['SW-CORE-01', 'SW-CORE-02', 'FW-01'], {
      nouvellePage: 'Rangé',
      disposition: 'auto',
    })
    assert.notDeepEqual([surLaPage('SW-CORE-01').x, surLaPage('SW-CORE-01').y], [100, 200])
    assert.ok(surLaPage('FW-01').y < surLaPage('SW-CORE-01').y, 'le pare-feu au-dessus des cœurs')
    assert.ok(schema().links.every((l) => !l.waypoints))
    assert.deepEqual(empiles(schema().nodes), [])
  })
})

describe('reprendre sur la page ouverte', () => {
  beforeEach(() => {
    ouvrirLeParc()
    magasin().selectPage(1) // la page Lyon : RTR-LYON, SRV-LYON, SW-CORE-01
  })

  it('les équipements rejoignent la page, sans doublon ni empilement', () => {
    const fait = magasin().reprendreEquipements(magasin().pagesCompletes(), ['SW-CORE-01', 'SW-CORE-02', 'FW-01'])
    assert.deepEqual(noms(schema().nodes), ['FW-01', 'RTR-LYON', 'SRV-LYON', 'SW-CORE-01', 'SW-CORE-02'])
    assert.deepEqual(fait.dejaLa, ['SW-CORE-01'])
    assert.equal(schema().nodes.filter((n) => n.name === 'SW-CORE-01').length, 1)
    assert.deepEqual(empiles(schema().nodes), [])
  })

  it('ce qui était sur la page ne bouge pas', () => {
    const avant = schema().nodes.map((n) => [n.name, n.x, n.y])
    magasin().reprendreEquipements(magasin().pagesCompletes(), ['SW-CORE-02', 'FW-01'])
    for (const [nom, x, y] of avant) assert.deepEqual([surLaPage(nom).x, surLaPage(nom).y], [x, y], nom)
  })

  it('s’annule d’un seul coup', () => {
    magasin().reprendreEquipements(magasin().pagesCompletes(), ['SW-CORE-02', 'FW-01', 'SW-ACC-01'])
    assert.equal(schema().nodes.length, 6)
    magasin().undo()
    assert.equal(schema().nodes.length, 3)
    assert.equal(schema().links.length, 2)
  })

  it('une page verrouillée ne reçoit rien', () => {
    magasin().setLocked(true)
    const fait = magasin().reprendreEquipements(magasin().pagesCompletes(), ['FW-01'])
    assert.equal(fait.equipements, 0)
    assert.equal(schema().nodes.length, 3)
    magasin().setLocked(false)
  })
})

describe('à la voix', () => {
  beforeEach(() => {
    ouvrirLeParc()
    magasin().addPage('Nouvelle')
  })

  it('par leur nom', () => {
    const r = ok('reprends SW-CORE-01 et SW-CORE-02')
    assert.deepEqual(noms(schema().nodes), ['SW-CORE-01', 'SW-CORE-02'])
    assert.equal(schema().links.length, 2, 'les deux brins de l’agrégat suivent')
    assert.match(r.message, /2 liaison/)
  })

  it('« depuis l’inventaire », dit comme on le pense', () => {
    for (const phrase of ['ajoute FW-01 depuis l’inventaire', 'reprends FW-01 de l’inventaire', 'récupère FW-01', 'reprendre FW-01']) {
      ouvrirLeParc()
      magasin().addPage('Nouvelle')
      ok(phrase)
      assert.deepEqual(noms(schema().nodes), ['FW-01'], `« ${phrase} »`)
    }
  })

  it('par leur type', () => {
    ok('reprends tous les switchs cœur')
    assert.deepEqual(noms(schema().nodes), ['SW-CORE-01', 'SW-CORE-02'])
  })

  it('par leur site', () => {
    ok('reprends les équipements du site Lyon')
    assert.deepEqual(noms(schema().nodes), ['RTR-LYON', 'SRV-LYON'])
    assert.equal(schema().links.length, 1)
  })

  it('par leur page', () => {
    ok('reprends la page Lyon')
    assert.deepEqual(noms(schema().nodes), ['RTR-LYON', 'SRV-LYON', 'SW-CORE-01'])
  })

  it('tout l’inventaire', () => {
    ok('reprends tout l’inventaire')
    assert.equal(schema().nodes.length, 6)
  })

  it('puis on enchaîne sur ce qu’on vient de reprendre', () => {
    ok('reprends FW-01 puis mets-le dans la zone DMZ')
    assert.equal(surLaPage('FW-01').zone, 'DMZ')
    assert.equal(surLaPage('FW-01').ip, '10.0.0.254', 'la fiche d’origine est là')
  })

  it('refuse ce qui est déjà sur la page, en le disant', () => {
    ok('reprends FW-01')
    const r = dire('reprends FW-01')
    assert.equal(r.ok, false)
    assert.match(r.message, /déjà sur cette page/)
    assert.equal(schema().nodes.length, 1)
  })

  it('un nom inconnu n’est pas rapproché de force', () => {
    const r = dire('reprends ZZ-TOP-99')
    assert.equal(r.ok, false)
    assert.equal(schema().nodes.length, 0)
    assert.match(r.message, /inventaire/)
  })

  it('un type ambigu au singulier nomme les candidats', () => {
    const r = dire('reprends le switch cœur')
    assert.equal(r.ok, false)
    assert.match(r.message, /SW-CORE-01/)
    assert.match(r.message, /SW-CORE-02/)
  })

  it('sans rien désigner, le dialogue s’ouvre', () => {
    ok('reprends de l’inventaire')
    assert.equal(magasin().repriseOuverte, true)
    assert.equal(schema().nodes.length, 0)
    magasin().fermerReprise()
  })

  it('« ouvre l’inventaire » reste la navigation vers l’onglet', () => {
    ok('ouvre l’inventaire')
    assert.equal(magasin().appView, 'inventory')
    assert.equal(magasin().repriseOuverte, false)
    magasin().setAppView('diagram')
  })

  it('dit quoi faire quand le document n’a pas d’autre page', () => {
    magasin().loadClasseur({ title: 'Seul', pages: [parc()[0]], activePage: 0 })
    const r = dire('reprends FW-01')
    assert.equal(r.ok, false)
    assert.match(r.message, /sélection/i)
  })
})

describe('une page faite de la sélection', () => {
  beforeEach(ouvrirLeParc)

  it('à la voix', () => {
    ok('sélectionne tous les switchs cœur')
    const r = ok('crée une page Cœur avec la sélection')
    assert.equal(schema().pageName, 'Cœur')
    assert.deepEqual(noms(schema().nodes), ['SW-CORE-01', 'SW-CORE-02'])
    assert.equal(schema().links.length, 2)
    assert.match(r.message, /Vue d’ensemble/)
    assert.equal(magasin().pagesCompletes()[0].nodes.length, 4, 'la page d’origine garde tout')
  })

  it('garde la disposition de la page d’origine', () => {
    ok('sélectionne tous les switchs cœur')
    ok('nouvelle page avec la sélection')
    assert.deepEqual([surLaPage('SW-CORE-01').x, surLaPage('SW-CORE-02').x], [100, 400])
  })

  it('sans sélection, dit quoi faire', () => {
    const r = dire('crée une page avec la sélection')
    assert.equal(r.ok, false)
    assert.equal(magasin().pagesCompletes().length, 2)
  })
})
