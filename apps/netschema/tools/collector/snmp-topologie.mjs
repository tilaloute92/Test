/**
 * Lecture des tables SNMP qui décrivent la topologie.
 *
 * Un outil de supervision connaît les équipements et leurs interfaces : c'est ce qu'il
 * interroge pour en tracer le débit. Il ne lit en revanche ni l'empilement des interfaces,
 * ni la MIB vPC, parce qu'il n'en a aucun usage. Or ce sont précisément ces tables qui
 * disent ce qu'un schéma doit montrer : quel port va où, quels brins forment un agrégat, et
 * quelle paire de châssis se présente comme un seul équipement.
 *
 * Ce module ne lit donc que ce qui manque ailleurs. Trois sous-arbres, en lecture seule :
 *
 *   1.3.6.1.2.1.31.1.1.1    ifXTable — nom, description et débit de chaque interface
 *   1.0.8802.1.1.2.1        LLDP-MIB — voisins, avec le port des deux côtés
 *   1.3.6.1.2.1.31.1.2.1.3  ifStackStatus — quelles interfaces sont empilées sous une autre
 *
 * La troisième est la plus utile et la moins connue : elle est **normalisée**, là où les MIB
 * d'agrégation diffèrent d'un constructeur à l'autre. Un port-channel y apparaît comme une
 * interface sous laquelle d'autres sont rangées — c'est exactement la composition du
 * faisceau, sans avoir à connaître le vocabulaire du constructeur.
 *
 * Tout passe par des fonctions pures qui prennent le texte d'un `snmpwalk`. L'intérêt n'est
 * pas théorique : on peut rejouer une capture prise sur le réseau, donc diagnostiquer et
 * corriger un décodage sans retourner interroger les équipements — et le décodage se teste
 * sans réseau du tout.
 */

/**
 * Une ligne de `snmpwalk -On` : « .1.3.6.1.2.1.31.1.1.1.1.436207616 = STRING: Eth1/1 ».
 *
 * La forme numérique est exigée (-On) : les noms symboliques dépendent des MIB installées sur
 * le poste, et une MIB absente fait écrire l'OID brut au milieu de noms traduits — on ne peut
 * alors plus rien analyser de façon fiable.
 */
export function lireWalk(texte) {
  const entrees = []
  for (const ligne of String(texte).split(/\r?\n/)) {
    if (/=\s*(No Such (Object|Instance)|End of MIB)/i.test(ligne)) continue
    const m = ligne.match(/^\s*\.?([\d.]+)\s*=\s*([A-Za-z0-9-]+)?\s*:?\s*(.*)$/)
    if (!m) continue
    const [, oid, type, brut] = m
    entrees.push({ oid, type: type ?? '', valeur: nettoyer(brut, type) })
  }
  return entrees
}

function nettoyer(valeur, type) {
  const texte = String(valeur).trim().replace(/^"(.*)"$/s, '$1')
  if (type === 'INTEGER' || type === 'Gauge32' || type === 'Counter32') {
    // « up(1) » aussi bien que « 1 » : on garde le nombre.
    const n = texte.match(/(-?\d+)/)
    return n ? Number(n[1]) : texte
  }
  return texte
}

/** Les entrées d'un sous-arbre, avec le reste de l'OID comme index. */
function sous(entrees, prefixe) {
  const p = prefixe.endsWith('.') ? prefixe : prefixe + '.'
  return entrees
    .filter((e) => e.oid.startsWith(p))
    .map((e) => ({ index: e.oid.slice(p.length), valeur: e.valeur, type: e.type }))
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

const IF_NAME = '1.3.6.1.2.1.31.1.1.1.1'
const IF_ALIAS = '1.3.6.1.2.1.31.1.1.1.18'
const IF_SPEED = '1.3.6.1.2.1.31.1.1.1.15'

/**
 * Les interfaces, indexées par ifIndex.
 *
 * `ifAlias` est la description posée par l'exploitant. C'est souvent la meilleure source du
 * document : personne n'écrit « vers SW-CORE-01 Te1/0/1 » ailleurs que là.
 */
export function lireInterfaces(texte) {
  const entrees = lireWalk(texte)
  const interfaces = new Map()
  const poser = (index, champ, valeur) => {
    const actuel = interfaces.get(index) ?? { ifIndex: Number(index) }
    actuel[champ] = valeur
    interfaces.set(index, actuel)
  }
  for (const e of sous(entrees, IF_NAME)) poser(e.index, 'nom', String(e.valeur))
  for (const e of sous(entrees, IF_ALIAS)) if (e.valeur !== '') poser(e.index, 'description', String(e.valeur))
  for (const e of sous(entrees, IF_SPEED)) if (Number(e.valeur) > 0) poser(e.index, 'debitMbps', Number(e.valeur))
  return interfaces
}

/** Débit en langage de schéma : « 10 Gb/s » plutôt que 10000. */
export function debitLisible(mbps) {
  if (!mbps || mbps <= 0) return undefined
  return mbps >= 1000 ? `${Number((mbps / 1000).toFixed(1))} Gb/s` : `${mbps} Mb/s`
}

// ─── Agrégats, par l'empilement des interfaces ───────────────────────────────

const IF_STACK = '1.3.6.1.2.1.31.1.2.1.3'

/**
 * Composition des agrégats, d'après `ifStackStatus`.
 *
 * L'index de la table vaut « interfaceSupérieure.interfaceInférieure ». Un port-channel est
 * donc l'interface supérieure d'un groupe, et ses brins sont les inférieures. Les lignes où
 * l'une des deux vaut zéro bornent la table — elles disent « rien au-dessus » ou « rien en
 * dessous » — et ne décrivent aucun empilement.
 *
 * On n'y retient que les interfaces supérieures qui portent plusieurs brins ou dont le nom
 * ressemble à un agrégat : une interface de VLAN (SVI) est elle aussi empilée au-dessus de
 * ports, et ce n'est pas un faisceau.
 */
export function lireAgregats(texte, interfaces) {
  const brins = new Map()
  for (const e of sous(lireWalk(texte), IF_STACK)) {
    const [haut, bas] = e.index.split('.').map(Number)
    if (!haut || !bas) continue
    if (Number(e.valeur) !== 1 && e.type === 'INTEGER') continue // actif seulement
    const liste = brins.get(haut) ?? []
    liste.push(bas)
    brins.set(haut, liste)
  }

  const agregats = []
  for (const [haut, membres] of brins) {
    const porteur = interfaces.get(String(haut))
    const nom = porteur?.nom ?? `ifIndex ${haut}`
    const ressemble = /^(po|port-?channel|ae|bond|lag|trk)/i.test(nom)
    if (!ressemble && membres.length < 2) continue
    if (/^(vlan|svi|irb)/i.test(nom)) continue
    agregats.push({
      ifIndex: haut,
      nom,
      membres: membres.map((i) => interfaces.get(String(i))?.nom ?? `ifIndex ${i}`),
      membresIfIndex: membres,
    })
  }
  return agregats
}

// ─── Voisinages LLDP, avec les ports des deux côtés ──────────────────────────

const LLDP_LOC_PORT_ID = '1.0.8802.1.1.2.1.3.7.1.3'
const LLDP_REM_PORT_ID = '1.0.8802.1.1.2.1.4.1.1.7'
const LLDP_REM_PORT_DESC = '1.0.8802.1.1.2.1.4.1.1.8'
const LLDP_REM_SYS_NAME = '1.0.8802.1.1.2.1.4.1.1.9'
const LLDP_REM_SYS_DESC = '1.0.8802.1.1.2.1.4.1.1.10'

/**
 * Les voisins, avec le port local et le port distant.
 *
 * L'index de la table distante vaut « marqueDeTemps.portLocal.indexDuVoisin ». Le port local
 * y est un numéro propre à LLDP, que la norme ne confond pas avec l'ifIndex — même si la
 * plupart des équipements les font coïncider. On le traduit donc en deux temps : d'abord par
 * la table locale LLDP si elle est présente, sinon par l'ifIndex, et la réserve est consignée
 * pour qu'on sache sur quoi s'appuie le résultat.
 */
export function lireVoisins(texteDistant, texteLocal, interfaces) {
  const reserves = []
  const entrees = lireWalk(texteDistant)

  const portsLocaux = new Map()
  for (const e of sous(lireWalk(texteLocal ?? ''), LLDP_LOC_PORT_ID)) {
    portsLocaux.set(e.index, String(e.valeur))
  }

  const parIndex = new Map()
  const ramasser = (prefixe, champ) => {
    for (const e of sous(entrees, prefixe)) {
      const courant = parIndex.get(e.index) ?? {}
      courant[champ] = String(e.valeur)
      parIndex.set(e.index, courant)
    }
  }
  ramasser(LLDP_REM_PORT_ID, 'portDistant')
  ramasser(LLDP_REM_PORT_DESC, 'descriptionPortDistant')
  ramasser(LLDP_REM_SYS_NAME, 'nomDistant')
  ramasser(LLDP_REM_SYS_DESC, 'descriptionDistante')

  let parIfIndex = 0
  const voisins = []
  for (const [index, donnees] of parIndex) {
    const morceaux = index.split('.')
    if (morceaux.length < 2) continue
    const numeroLocal = morceaux[1]
    let portLocal = portsLocaux.get(numeroLocal)
    if (!portLocal) {
      portLocal = interfaces.get(numeroLocal)?.nom
      if (portLocal) parIfIndex += 1
    }
    if (!donnees.nomDistant) continue
    voisins.push({
      portLocal,
      portDistant: lisiblePort(donnees.descriptionPortDistant, donnees.portDistant),
      nomDistant: donnees.nomDistant,
      descriptionDistante: donnees.descriptionDistante,
    })
  }

  if (!texteLocal && parIfIndex > 0) {
    reserves.push(
      `Table LLDP locale absente : le port local de ${parIfIndex} voisin(s) a été déduit de l’ifIndex. ` +
        'Juste sur la plupart des équipements, à vérifier si un port paraît faux.',
    )
  }
  const sansPort = voisins.filter((v) => !v.portLocal).length
  if (sansPort > 0) reserves.push(`${sansPort} voisin(s) sans port local identifiable.`)
  return { voisins, reserves }
}

/**
 * Le port distant tel qu'on l'écrirait sur un schéma.
 *
 * `lldpRemPortId` contient parfois le nom de l'interface, parfois une adresse MAC ou un
 * numéro, selon le sous-type annoncé. La description, quand elle existe, est presque toujours
 * le nom lisible — on la préfère dès qu'elle ressemble à un nom d'interface.
 */
function lisiblePort(description, identifiant) {
  const ressembleNom = (v) => v && /[A-Za-z]/.test(v) && !/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(v)
  if (ressembleNom(description)) return description
  if (ressembleNom(identifiant)) return identifiant
  return description || identifiant || undefined
}

// ─── vPC ─────────────────────────────────────────────────────────────────────

const VPC_DOMAIN = '1.3.6.1.4.1.9.9.807.1.1.1.1.1'
const VPC_PEER_LINK_IF = '1.3.6.1.4.1.9.9.807.1.1.1.1.3'

/**
 * Domaine vPC, s'il est annoncé.
 *
 * La MIB est propre à Cisco et n'existe que sur les Nexus. Son absence n'est pas une erreur :
 * c'est le cas de tous les autres équipements, et le mécanisme reste alors à déclarer à la
 * main ou à déduire du reste du schéma.
 */
export function lireVpc(texte, interfaces) {
  const entrees = lireWalk(texte ?? '')
  const domaine = sous(entrees, VPC_DOMAIN)[0]?.valeur
  if (domaine === undefined) return null
  const lien = sous(entrees, VPC_PEER_LINK_IF)[0]?.valeur
  return {
    domaine: Number(domaine),
    peerLink: lien ? (interfaces.get(String(lien))?.nom ?? `ifIndex ${lien}`) : undefined,
  }
}

// ─── Assemblage ──────────────────────────────────────────────────────────────

/**
 * Tout ce qu'un équipement sait dire de lui-même, rassemblé.
 *
 * Les captures manquantes ne sont pas des erreurs : on travaille avec ce qu'on a, et l'on
 * dit ce qui manquait. Un collecteur qui s'arrête au premier sous-arbre absent ne sert à rien
 * sur un parc hétérogène.
 */
export function lireEquipement({ interfaces: txtIf, lldpDistant, lldpLocal, pile, vpc }) {
  const interfaces = lireInterfaces(txtIf ?? '')
  const agregats = lireAgregats(pile ?? '', interfaces)
  const { voisins, reserves } = lireVoisins(lldpDistant ?? '', lldpLocal, interfaces)
  if (!txtIf) reserves.push('Table des interfaces absente : les ports ne portent que leur numéro.')
  if (!pile) reserves.push('Table d’empilement absente : les agrégats ne sont pas reconstitués.')
  return { interfaces, agregats, voisins, vpc: lireVpc(vpc, interfaces), reserves }
}

/** L'agrégat auquel un port appartient, s'il y en a un. */
export function agregatDuPort(agregats, nomPort) {
  if (!nomPort) return undefined
  return agregats.find((a) => a.membres.some((m) => m.toLowerCase() === nomPort.toLowerCase()))
}

/** « port-channel23 » devient « Po23 » : c'est ainsi qu'on l'écrit sur un schéma. */
export function nomAgregatCourt(nom) {
  const m = String(nom).match(/^port-?channel\s*(\d+)$/i)
  return m ? `Po${m[1]}` : nom
}

/**
 * Verse dans un schéma ce qu'un équipement a dit de lui-même.
 *
 * Le schéma reçoit les liaisons avec le port des deux côtés, le nom de l'agrégat quand le
 * port en fait partie, et le débit de l'interface. C'est ce qui distingue une topologie
 * utilisable d'une simple liste de voisins : sans les ports, on ne peut ni vérifier un
 * brassage ni reconnaître un faisceau.
 */
export function verserDansSchema(diagram, nomLocal, releve, { kindLocal = 'switch' } = {}) {
  const local = diagram.node(nomLocal, { kind: kindLocal })
  if (releve.vpc) {
    // Le domaine vPC nomme la grappe : les deux châssis d'un même domaine s'y retrouvent.
    local.cluster = local.cluster ?? `vPC ${releve.vpc.domaine}`
    local.haTech = local.haTech ?? 'vpc'
  }

  let poses = 0
  for (const voisin of releve.voisins) {
    const distant = diagram.node(voisin.nomDistant, {
      kind: deviner(voisin.descriptionDistante),
      notes: 'Découvert par LLDP (SNMP)',
    })
    const agregat = agregatDuPort(releve.agregats, voisin.portLocal)
    const itf = [...releve.interfaces.values()].find(
      (i) => i.nom && voisin.portLocal && i.nom.toLowerCase() === voisin.portLocal.toLowerCase(),
    )
    diagram.link(local, distant, {
      portA: voisin.portLocal,
      portB: voisin.portDistant,
      lag: agregat ? nomAgregatCourt(agregat.nom) : undefined,
      speed: debitLisible(itf?.debitMbps),
      label: itf?.description || undefined,
    })
    poses += 1
  }
  return poses
}

/** Type d'équipement deviné d'après ce que le voisin annonce de lui-même. */
function deviner(description = '') {
  const t = String(description)
  if (/nexus|c9[56]\d\d/i.test(t)) return 'core-switch'
  if (/catalyst|c9[23]\d\d|procurve|aruba ?\d/i.test(t)) return 'switch'
  if (/fortigate|palo ?alto|asa\b|firepower/i.test(t)) return 'ngfw'
  if (/isr|asr\b|router/i.test(t)) return 'router'
  if (/esxi|vmware|proxmox/i.test(t)) return 'hypervisor'
  if (/air-|aironet|access ?point/i.test(t)) return 'wifi7'
  return 'server'
}
