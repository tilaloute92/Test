import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

/**
 * La commande vocale, de bout en bout.
 *
 * Chaque essai dit une phrase comme on la dirait vraiment — pas comme elle est écrite dans
 * l'aide — puis regarde ce que le schéma est devenu. Vérifier seulement que la phrase a été
 * « comprise » ne prouve rien : « ajoute deux switchs cœur » était comprise, et créait une
 * borne Wi-Fi nommée « switchs cœur ». C'est l'état du schéma qui fait foi.
 *
 * Le magasin tourne ici sans navigateur ; la reconnaissance vocale elle-même n'est pas en
 * cause, seulement ce que l'application fait d'une phrase une fois transcrite.
 */

const { useDiagram } = await import('../../src/store/useDiagram.ts')
const magasin = () => useDiagram.getState()
const dire = (phrase) => magasin().runVoiceCommand(phrase)
const schema = () => magasin().diagram
const noeud = (nom) => schema().nodes.find((n) => n.name === nom)
const duType = (kind) => schema().nodes.filter((n) => n.kind === kind)
const nomDe = (id) => schema().nodes.find((n) => n.id === id)?.name
const liens = (a, b) =>
  schema().links.filter((l) => {
    const [x, y] = [nomDe(l.from), nomDe(l.to)]
    return (x === a && y === b) || (x === b && y === a)
  })
const lien = (a, b) => liens(a, b)[0]

/** Dit une phrase et exige qu'elle soit acceptée. */
function ok(phrase) {
  const r = dire(phrase)
  assert.ok(r.ok, `« ${phrase} » refusée : ${r.message}`)
  return r
}

/** Petit réseau de départ, posé sans passer par la voix : il ne dépend pas de ce qu'on teste. */
function reseau() {
  magasin().newDiagram()
  const poser = (kind, name, x, y) => magasin().addNode(kind, x, y, { name })
  poser('router', 'RTR-01', 400, 0)
  poser('firewall', 'FW-01', 400, 150)
  poser('core-switch', 'SW-CORE-01', 250, 300)
  poser('core-switch', 'SW-CORE-02', 550, 300)
  poser('access-switch', 'SW-ACC-01', 250, 450)
  poser('access-switch', 'SW-ACC-02', 550, 450)
  magasin().clearSelection()
}

beforeEach(() => magasin().newDiagram())

describe('créer', () => {
  it('un équipement', () => {
    ok('ajoute un routeur')
    assert.equal(duType('router').length, 1)
  })

  it('avec les verbes qu’on emploie vraiment', () => {
    for (const phrase of ['mets un serveur', 'place un serveur', 'pose un serveur', 'insère un serveur', 'nouveau serveur']) {
      magasin().newDiagram()
      ok(phrase)
      assert.equal(duType('server').length, 1, `« ${phrase} »`)
    }
  })

  it('plusieurs d’un coup, du bon type', () => {
    // Créait une borne Wi-Fi 7 nommée « switchs cœur ».
    ok('ajoute deux switchs cœur')
    assert.equal(duType('core-switch').length, 2)
    assert.equal(schema().nodes.length, 2, 'rien d’autre n’est créé')
    assert.deepEqual(duType('core-switch').map((n) => n.name).sort(), ['SW-CORE-01', 'SW-CORE-02'])
  })

  it('un nombre écrit en chiffres', () => {
    // Créait un routeur 5G nommé « serveurs ».
    ok('ajoute 4 serveurs')
    assert.equal(duType('server').length, 4)
    assert.equal(schema().nodes.length, 4)
  })

  it('une énumération', () => {
    ok('ajoute un routeur, un pare-feu et deux switchs cœur')
    assert.equal(duType('router').length, 1)
    assert.equal(duType('firewall').length, 1)
    assert.equal(duType('core-switch').length, 2)
    assert.equal(schema().nodes.length, 4)
  })

  it('deux équipements réunis par « et »', () => {
    ok('ajoute un routeur et un pare-feu')
    assert.equal(duType('router').length, 1)
    assert.equal(duType('firewall').length, 1)
  })

  it('raccorde les ajouts multiples à la couche du dessus, et le dit', () => {
    reseau()
    const r = ok('ajoute trois switchs d’accès')
    assert.equal(duType('access-switch').length, 5)
    for (const nom of ['SW-ACC-03', 'SW-ACC-04', 'SW-ACC-05']) {
      assert.equal(liens(nom, 'SW-CORE-01').length, 1, `${nom} relié à SW-CORE-01`)
      assert.equal(liens(nom, 'SW-CORE-02').length, 1, `${nom} relié à SW-CORE-02`)
    }
    assert.match(r.message, /reli/i, 'la réponse annonce le raccordement')
  })

  it('ne raccorde rien quand on le demande', () => {
    reseau()
    ok('ajoute trois switchs d’accès sans les relier')
    assert.equal(duType('access-switch').length, 5)
    assert.equal(schema().links.length, 0)
  })

  it('poursuit la numérotation existante', () => {
    reseau()
    ok('ajoute un pare-feu')
    assert.ok(noeud('FW-02'), `noms présents : ${schema().nodes.map((n) => n.name).join(', ')}`)
  })

  it('à côté d’un équipement désigné', () => {
    reseau()
    ok('ajoute un switch d’accès SW-ACC-03 sous SW-CORE-01')
    const [neuf, repere] = [noeud('SW-ACC-03'), noeud('SW-CORE-01')]
    assert.ok(neuf, 'le nom ne doit pas avaler « sous SW-CORE-01 »')
    assert.ok(neuf.y > repere.y, 'posé en dessous')
    assert.ok(Math.abs(neuf.x - repere.x) < 200, 'et à peu près à l’aplomb')
  })

  it('à droite d’un équipement désigné', () => {
    reseau()
    ok('ajoute un serveur SRV-01 à droite de SW-ACC-02')
    assert.ok(noeud('SRV-01').x > noeud('SW-ACC-02').x)
  })

  it('refuse un nom déjà pris au lieu de créer un homonyme', () => {
    reseau()
    const r = dire('ajoute un switch cœur SW-CORE-01')
    assert.equal(r.ok, false)
    assert.equal(schema().nodes.filter((n) => n.name === 'SW-CORE-01').length, 1)
    assert.match(r.message, /existe déjà/i)
  })

  it('met en forme un nom épelé', () => {
    ok('ajoute un switch cœur s w core zéro un')
    assert.ok(noeud('SW-CORE-01'), `noms : ${schema().nodes.map((n) => n.name).join(', ')}`)
  })

  it('un modèle entier en une phrase', () => {
    ok('crée un cœur redondé')
    assert.equal(duType('core-switch').length, 2)
    assert.ok(schema().links.length >= 1, 'les deux cœurs sont reliés entre eux')
  })

  it('une paire de pare-feu', () => {
    ok('ajoute une paire de pare-feu')
    assert.equal(duType('firewall').length, 2)
  })

  it('une grappe d’hyperviseurs', () => {
    ok('ajoute un cluster de trois ESXi')
    assert.equal(duType('hypervisor').length, 3)
  })
})

describe('désigner sans répéter', () => {
  beforeEach(reseau)

  it('« le » reprend l’équipement qu’on vient d’ajouter', () => {
    ok('ajoute un switch d’accès SW-ACC-03')
    ok('relie-le à SW-CORE-01')
    assert.equal(liens('SW-ACC-03', 'SW-CORE-01').length, 1)
  })

  it('et le garde d’une commande à l’autre', () => {
    // Le double attachement dit comme on le pense : « relie-le au premier, puis au second ».
    ok('ajoute un switch d’accès SW-ACC-03')
    ok('relie-le à SW-CORE-01')
    ok('relie-le à SW-CORE-02')
    assert.equal(liens('SW-ACC-03', 'SW-CORE-02').length, 1)
  })

  it('renommer', () => {
    ok('sélectionne SW-ACC-01')
    ok('renomme-le en SW-DIST-01')
    assert.ok(noeud('SW-DIST-01'))
    assert.equal(noeud('SW-ACC-01'), undefined)
  })

  it('« appelle-le »', () => {
    ok('ajoute un pare-feu')
    ok('appelle-le FW-EDGE')
    assert.ok(noeud('FW-EDGE'))
  })

  it('renseigner', () => {
    ok('sélectionne SW-CORE-01')
    ok('mets-le dans la zone DMZ')
    assert.equal(noeud('SW-CORE-01').zone, 'DMZ')
    ok('son adresse est 10.0.0.1')
    assert.equal(noeud('SW-CORE-01').ip, '10.0.0.1')
  })

  it('déplacer', () => {
    ok('sélectionne SW-CORE-01')
    const avant = noeud('SW-CORE-01').y
    ok('monte-le')
    assert.ok(noeud('SW-CORE-01').y < avant)
  })

  it('supprimer', () => {
    ok('sélectionne SW-ACC-02')
    ok('supprime-le')
    assert.equal(noeud('SW-ACC-02'), undefined)
    assert.equal(schema().nodes.length, 5)
  })

  it('« les » reprend plusieurs équipements', () => {
    ok('sélectionne tous les switchs d’accès')
    ok('relie-les à SW-CORE-01')
    assert.equal(liens('SW-ACC-01', 'SW-CORE-01').length, 1)
    assert.equal(liens('SW-ACC-02', 'SW-CORE-01').length, 1)
  })

  it('par son type quand il est seul de son espèce', () => {
    ok('relie le routeur au pare-feu')
    assert.equal(liens('RTR-01', 'FW-01').length, 1)
  })

  it('refuse un type ambigu en nommant les candidats', () => {
    const r = dire('relie le routeur au switch cœur')
    assert.equal(r.ok, false)
    assert.match(r.message, /SW-CORE-01/)
    assert.match(r.message, /SW-CORE-02/)
    assert.equal(schema().links.length, 0)
  })

  it('dit quoi faire quand « le » ne désigne rien', () => {
    const r = dire('relie-le à SW-CORE-01')
    assert.equal(r.ok, false)
    assert.match(r.message, /sélection/i)
  })
})

describe('relier', () => {
  beforeEach(reseau)

  it('avec les verbes qu’on emploie vraiment', () => {
    for (const phrase of [
      'relie SW-ACC-01 à SW-CORE-01', 'connecte SW-ACC-01 à SW-CORE-01', 'branche SW-ACC-01 sur SW-CORE-01',
      'raccorde SW-ACC-01 à SW-CORE-01', 'tire un lien entre SW-ACC-01 et SW-CORE-01', 'câble SW-ACC-01 sur SW-CORE-01',
    ]) {
      reseau()
      ok(phrase)
      assert.equal(liens('SW-ACC-01', 'SW-CORE-01').length, 1, `« ${phrase} »`)
    }
  })

  it('vers deux équipements', () => {
    ok('relie SW-ACC-01 à SW-CORE-01 et SW-CORE-02')
    assert.equal(liens('SW-ACC-01', 'SW-CORE-01').length, 1)
    assert.equal(liens('SW-ACC-01', 'SW-CORE-02').length, 1)
  })

  it('« aux deux cœurs »', () => {
    ok('relie SW-ACC-01 aux deux cœurs')
    assert.equal(liens('SW-ACC-01', 'SW-CORE-01').length, 1)
    assert.equal(liens('SW-ACC-01', 'SW-CORE-02').length, 1)
  })

  it('tous ceux d’un type', () => {
    ok('relie tous les switchs d’accès à SW-CORE-01')
    assert.equal(liens('SW-ACC-01', 'SW-CORE-01').length, 1)
    assert.equal(liens('SW-ACC-02', 'SW-CORE-01').length, 1)
  })

  it('tous ceux d’un type vers tous ceux d’un autre', () => {
    ok('relie tous les switchs d’accès aux deux cœurs')
    assert.equal(schema().links.length, 4)
  })

  it('avec sa nature et son débit dans la phrase', () => {
    ok('relie SW-CORE-01 à SW-CORE-02 en fibre 40 giga')
    assert.equal(lien('SW-CORE-01', 'SW-CORE-02').kind, 'fiber')
    assert.equal(lien('SW-CORE-01', 'SW-CORE-02').speed, '40 Gb/s')
  })

  it('un second brin', () => {
    ok('relie SW-CORE-01 à SW-CORE-02')
    ok('double le lien entre SW-CORE-01 et SW-CORE-02')
    assert.equal(liens('SW-CORE-01', 'SW-CORE-02').length, 2)
  })

  it('un second brin, dit autrement', () => {
    ok('relie SW-CORE-01 à SW-CORE-02')
    ok('ajoute un deuxième lien entre SW-CORE-01 et SW-CORE-02')
    assert.equal(liens('SW-CORE-01', 'SW-CORE-02').length, 2)
  })

  it('supprimer une liaison sans toucher aux équipements', () => {
    ok('relie SW-CORE-01 à FW-01')
    ok('supprime le lien entre SW-CORE-01 et FW-01')
    assert.equal(liens('SW-CORE-01', 'FW-01').length, 0)
    assert.equal(schema().nodes.length, 6)
  })
})

describe('caractériser une liaison', () => {
  beforeEach(() => {
    reseau()
    ok('relie SW-CORE-01 à SW-CORE-02')
    ok('relie SW-CORE-01 à SW-ACC-01')
  })

  it('son débit', () => {
    ok('le lien entre SW-CORE-01 et SW-CORE-02 est en 40 giga')
    assert.equal(lien('SW-CORE-01', 'SW-CORE-02').speed, '40 Gb/s')
    ok('mets le lien entre SW-CORE-01 et SW-ACC-01 en 10 gigabits')
    assert.equal(lien('SW-CORE-01', 'SW-ACC-01').speed, '10 Gb/s')
  })

  it('sa nature', () => {
    // Était comprise comme « change le type de l’équipement ».
    ok('passe la liaison entre SW-CORE-01 et SW-CORE-02 en fibre')
    assert.equal(lien('SW-CORE-01', 'SW-CORE-02').kind, 'fiber')
    assert.equal(noeud('SW-CORE-01').kind, 'core-switch', 'l’équipement n’a pas changé de type')
  })

  it('un trunk et ses VLAN', () => {
    ok('autorise les VLAN 10 et 20 entre SW-CORE-01 et SW-ACC-01')
    const l = lien('SW-CORE-01', 'SW-ACC-01')
    assert.equal(l.mode, 'trunk')
    assert.match(l.vlans, /10/)
    assert.match(l.vlans, /20/)
  })

  it('un agrégat', () => {
    ok('double le lien entre SW-CORE-01 et SW-CORE-02')
    ok('agrège les liens entre SW-CORE-01 et SW-CORE-02 en Po1')
    const brins = liens('SW-CORE-01', 'SW-CORE-02')
    assert.equal(brins.length, 2)
    assert.ok(brins.every((l) => l.lag === 'Po1'), `agrégats : ${brins.map((l) => l.lag).join(', ')}`)
  })

  it('un agrégat, dit autrement', () => {
    ok('double le lien entre SW-CORE-01 et SW-CORE-02')
    ok('mets les liens entre SW-CORE-01 et SW-CORE-02 dans le port-channel 1')
    assert.ok(liens('SW-CORE-01', 'SW-CORE-02').every((l) => l.lag === 'Po1'))
  })

  it('un port, du bon côté', () => {
    ok('le port de SW-CORE-01 vers SW-ACC-01 est Ethernet 1/1')
    const l = lien('SW-CORE-01', 'SW-ACC-01')
    const cote = nomDe(l.from) === 'SW-CORE-01' ? l.portA : l.portB
    assert.equal(cote, 'Ethernet1/1')
  })

  it('son étiquette', () => {
    ok('étiquette du lien entre SW-CORE-01 et SW-ACC-01 : transit')
    assert.equal(lien('SW-CORE-01', 'SW-ACC-01').label, 'Transit')
  })

  it('« ce lien », après en avoir parlé', () => {
    ok('le lien entre SW-CORE-01 et SW-CORE-02 est en 40 giga')
    ok('passe-le en fibre')
    assert.equal(lien('SW-CORE-01', 'SW-CORE-02').kind, 'fiber')
  })
})

describe('renseigner', () => {
  beforeEach(reseau)

  it('en parlant de l’équipement à la troisième personne', () => {
    ok('SW-CORE-01 est dans la zone cœur')
    assert.match(noeud('SW-CORE-01').zone, /c[oœ]ur/i)
    ok('l’adresse de SW-CORE-02 est 10.0.0.2')
    assert.equal(noeud('SW-CORE-02').ip, '10.0.0.2')
  })

  it('plusieurs équipements nommés', () => {
    ok('mets SW-CORE-01 et SW-CORE-02 dans la grappe cœur')
    assert.ok(noeud('SW-CORE-01').cluster)
    assert.equal(noeud('SW-CORE-01').cluster, noeud('SW-CORE-02').cluster)
  })

  it('son modèle', () => {
    ok('le modèle de SW-CORE-01 est C9300-48P')
    assert.match(noeud('SW-CORE-01').model ?? '', /9300/)
  })

  it('dupliquer n fois', () => {
    ok('duplique SW-ACC-01 trois fois')
    assert.equal(duType('access-switch').length, 5)
  })
})

describe('dicter du texte', () => {
  beforeEach(reseau)

  it('une note posée sur le plan', () => {
    ok('note : migration prévue en mars')
    const notes = schema().annotations ?? []
    assert.equal(notes.length, 1)
    assert.equal(notes[0].text, 'Migration prévue en mars')
  })

  it('une note sur un équipement', () => {
    // Était comprise comme « ouvre la vue … ».
    ok('note sur SW-CORE-01 : baie B12 port console 3')
    assert.equal(noeud('SW-CORE-01').notes, 'Baie B12 port console 3')
  })

  it('sans deux-points', () => {
    ok('commentaire sur SW-CORE-01 contrat de maintenance jusqu’en 2027')
    assert.match(noeud('SW-CORE-01').notes, /contrat de maintenance/i)
  })

  it('une note qui s’ajoute à la précédente au lieu de l’écraser', () => {
    ok('note sur SW-CORE-01 : baie B12')
    ok('ajoute à la note de SW-CORE-01 : port console 3')
    assert.match(noeud('SW-CORE-01').notes, /B12/)
    assert.match(noeud('SW-CORE-01').notes, /console 3/)
  })

  it('le titre', () => {
    for (const phrase of ['le titre est réseau du siège', 'intitule le schéma réseau du siège', 'titre : réseau du siège']) {
      reseau()
      ok(phrase)
      assert.equal(schema().title, 'Réseau du siège', `« ${phrase} »`)
    }
  })

  it('une dictée continue, jusqu’à ce qu’on la ferme', () => {
    ok('dictée sur SW-CORE-01')
    ok('baie B12 au fond de la salle')
    ok('relie le port console au serveur de terminaux')
    assert.equal(schema().links.length, 0, 'en dictée, « relie » est du texte, pas une commande')
    ok('fin de dictée')
    assert.match(noeud('SW-CORE-01').notes, /baie B12/i)
    assert.match(noeud('SW-CORE-01').notes, /port console/i)
    ok('relie SW-CORE-01 à SW-CORE-02')
    assert.equal(schema().links.length, 1, 'la dictée fermée, les commandes reprennent')
  })
})

describe('enchaîner', () => {
  beforeEach(reseau)

  it('« puis »', () => {
    ok('ajoute un switch d’accès SW-ACC-03 puis relie-le à SW-CORE-01')
    assert.ok(noeud('SW-ACC-03'), 'le nom ne doit pas avaler la suite de la phrase')
    assert.equal(liens('SW-ACC-03', 'SW-CORE-01').length, 1)
  })

  it('« et » suivi d’un verbe', () => {
    ok('ajoute un serveur SRV-01 et relie-le à SW-ACC-01')
    assert.ok(noeud('SRV-01'))
    assert.equal(liens('SRV-01', 'SW-ACC-01').length, 1)
  })

  it('ne coupe pas un « et » qui réunit deux noms', () => {
    ok('relie SW-CORE-01 et SW-CORE-02')
    assert.equal(liens('SW-CORE-01', 'SW-CORE-02').length, 1)
  })

  it('trois commandes d’un souffle', () => {
    ok('ajoute un serveur SRV-01, relie-le à SW-ACC-01 puis mets-le dans la zone serveurs')
    assert.equal(liens('SRV-01', 'SW-ACC-01').length, 1)
    assert.match(noeud('SRV-01').zone ?? '', /serveurs/i)
  })

  it('s’arrête à la première commande qui échoue, et dit laquelle', () => {
    const r = dire('ajoute un serveur SRV-01 puis relie-le à INCONNU puis supprime SW-CORE-01')
    assert.equal(r.ok, false)
    assert.ok(noeud('SRV-01'), 'ce qui précède l’échec est fait')
    assert.ok(noeud('SW-CORE-01'), 'ce qui le suit ne l’est pas')
    assert.match(r.message, /INCONNU/i)
  })

  it('une sélection puis une action sur elle', () => {
    ok('sélectionne tous les switchs d’accès et mets-les dans le VLAN 20')
    assert.match(noeud('SW-ACC-01').vlan ?? '', /20/)
    assert.match(noeud('SW-ACC-02').vlan ?? '', /20/)
  })
})

describe('corriger', () => {
  beforeEach(reseau)

  it('annuler, comme on le dit', () => {
    for (const phrase of ['annule', 'annule ça', 'non annule', 'reviens en arrière', 'oups', 'défais']) {
      reseau()
      ok('ajoute un serveur SRV-01')
      ok(phrase)
      assert.equal(noeud('SRV-01'), undefined, `« ${phrase} »`)
    }
  })

  it('rétablir', () => {
    // « rétablis » remettait à zéro la simulation de panne.
    for (const phrase of ['refais', 'rétablis', 'remets']) {
      reseau()
      ok('ajoute un serveur SRV-01')
      ok('annule')
      ok(phrase)
      assert.ok(noeud('SRV-01'), `« ${phrase} »`)
    }
  })

  it('une énumération s’annule d’un seul coup', () => {
    ok('ajoute trois switchs d’accès')
    ok('annule')
    assert.equal(duType('access-switch').length, 2)
    assert.equal(schema().links.length, 0)
  })
})

describe('garde-fous', () => {
  beforeEach(reseau)

  it('demande confirmation avant de tout supprimer', () => {
    // Supprimait en silence le seul équipement sélectionné.
    const r = dire('supprime tout')
    assert.equal(schema().nodes.length, 6, 'rien n’est supprimé avant confirmation')
    assert.match(r.message, /confirm|oui/i)
    ok('oui')
    assert.equal(schema().nodes.length, 0)
  })

  it('abandonne si on ne confirme pas', () => {
    dire('supprime tout')
    ok('non')
    assert.equal(schema().nodes.length, 6)
  })

  it('une autre commande vaut abandon', () => {
    dire('supprime tout')
    ok('ajoute un serveur SRV-01')
    assert.equal(schema().nodes.length, 7)
    const r = dire('oui')
    assert.equal(schema().nodes.length, 7, 'un « oui » tardif ne supprime plus rien')
    assert.equal(r.ok, false)
  })

  it('demande confirmation pour une suppression en nombre', () => {
    ok('ajoute 4 serveurs sans les relier')
    dire('supprime tous les serveurs')
    assert.equal(duType('server').length, 4)
    ok('confirme')
    assert.equal(duType('server').length, 0)
  })

  it('ne confond pas « montre tout » avec un niveau de détail', () => {
    const avant = magasin().detail
    ok('montre tout')
    assert.equal(magasin().detail, avant)
  })
})

describe('langue parlée', () => {
  beforeEach(reseau)

  it('ignore les hésitations', () => {
    for (const phrase of ['euh ajoute un serveur', 'alors ajoute un serveur', 'bon ajoute un serveur', 'ok ajoute un serveur', 'et puis ajoute un serveur', 'ensuite ajoute un serveur']) {
      reseau()
      ok(phrase)
      assert.equal(duType('server').length, 1, `« ${phrase} »`)
    }
  })

  it('accepte l’infinitif et la politesse', () => {
    for (const phrase of ['ajouter un serveur', 'ajoute un serveur s’il te plaît', 'tu peux ajouter un serveur', 'je voudrais ajouter un serveur']) {
      reseau()
      ok(phrase)
      assert.equal(duType('server').length, 1, `« ${phrase} »`)
    }
  })

  it('rattrape ce que la reconnaissance entend de travers', () => {
    ok('relit SW-ACC-01 à SW-CORE-01')
    assert.equal(liens('SW-ACC-01', 'SW-CORE-01').length, 1)
    ok('ajoute un suisse d’accès')
    assert.equal(duType('access-switch').length, 3)
  })

  it('retrouve un nom épelé', () => {
    ok('relie s w acc zéro un à s w core zéro deux')
    assert.equal(liens('SW-ACC-01', 'SW-CORE-02').length, 1)
  })

  it('zoomer d’un mot', () => {
    const avant = magasin().view.zoom
    ok('zoome')
    assert.ok(magasin().view.zoom > avant)
  })
})

describe('ce que la voix n’atteignait pas', () => {
  beforeEach(reseau)

  it('la matrice de flux', () => {
    ok('ajoute un flux de SW-ACC-01 vers FW-01 en HTTPS')
    const flux = schema().flows ?? []
    assert.equal(flux.length, 1)
    assert.match(flux[0].service ?? flux[0].protocol ?? '', /https/i)
  })

  it('un flux refusé', () => {
    ok('refuse le flux SSH de SW-ACC-01 vers FW-01')
    assert.equal((schema().flows ?? [])[0]?.action, 'refuse')
  })

  it('supprimer la dernière note', () => {
    ok('note : à vérifier')
    ok('supprime la dernière note')
    assert.equal((schema().annotations ?? []).length, 0)
  })

  it('les panneaux', () => {
    ok('ferme la palette')
    assert.equal(magasin().paletteOpen, false)
    ok('ouvre la palette')
    assert.equal(magasin().paletteOpen, true)
    ok('ferme l’inspecteur')
    assert.equal(magasin().inspectorOpen, false)
  })

  it('le chemin entre deux équipements', () => {
    ok('relie SW-ACC-01 à SW-CORE-01')
    ok('relie SW-CORE-01 à FW-01')
    ok('montre le chemin entre SW-ACC-01 et FW-01')
    assert.equal(magasin().projecteurLiens.length, 2)
    // Le projecteur s'éteint seul après un délai : on l'éteint ici, sinon sa minuterie
    // retient le processus de test une demi-minute.
    magasin().montrerLiens([])
  })

  it('la durée du clignotement', () => {
    ok('clignotement 45 secondes')
    assert.equal(magasin().dureeClignotement, 45)
  })

  it('l’assistant de conception, à la voix', () => {
    magasin().newDiagram()
    ok('construis deux pare-feu en grappe, deux switchs cœur et quatre switchs d’accès')
    assert.equal(duType('firewall').length, 2)
    assert.equal(duType('core-switch').length, 2)
    assert.equal(duType('access-switch').length, 4)
    assert.ok(schema().links.length >= 8, `${schema().links.length} liaisons`)
  })
})
