import { hasDevice } from './catalog'
import { normalizeHeader, splitCsvLine } from './inventory'
import { uid } from './ids'
import type { NetLink, NetNode } from '../types'

/**
 * Reprise des relevés d'un outil de supervision : Cisco Prime Infrastructure, WhatsUp Gold,
 * et tout ce qui leur ressemble.
 *
 * Ces outils connaissent déjà le parc — nom, adresse, modèle, numéro de série, emplacement —
 * et parfois les voisinages CDP/LLDP. Le ressaisir dans NetSchema n'aurait aucun sens.
 *
 * Deux difficultés gouvernent la conception de ce module :
 *
 * D'abord, **les intitulés de colonnes ne sont pas stables**. Ils changent avec la version,
 * avec la langue de l'interface, et surtout avec le rapport choisi — l'inventaire détaillé de
 * Prime ne nomme pas ses colonnes comme son inventaire résumé. On ne peut donc pas exiger un
 * gabarit : chaque champ est reconnu par une liste de synonymes, et tout ce qui n'est pas
 * reconnu est signalé plutôt qu'ignoré en silence. L'utilisateur voit ce qui a été laissé de
 * côté et peut le dire.
 *
 * Ensuite, **les deux outils se ressemblent beaucoup** : « Device Name », « IP Address » et
 * « Device Type » existent des deux côtés. Plutôt que de parier sur l'origine du fichier, on
 * lit d'abord, on devine la provenance ensuite, et seulement pour l'afficher. Un export d'un
 * troisième outil bâti sur les mêmes notions sera repris sans rien changer ici.
 */

export type SourceNms = 'prime' | 'whatsup' | 'inconnue'

export const LIBELLES_SOURCE: Record<SourceNms, string> = {
  prime: 'Cisco Prime Infrastructure',
  whatsup: 'WhatsUp Gold',
  inconnue: 'outil de supervision',
}

export interface ReleveNms {
  source: SourceNms
  nodes: NetNode[]
  links: NetLink[]
  warnings: string[]
  /** Colonnes présentes dans le fichier mais dont on n'a rien su faire. */
  colonnesIgnorees: string[]
}

// ─── Synonymes de colonnes ───────────────────────────────────────────────────

/**
 * Les intitulés connus de chaque champ, en anglais et en français.
 *
 * L'ordre compte : la première entrée qui correspond gagne. « display name » passe donc
 * avant « name », parce que WhatsUp affiche l'un et stocke l'autre, et que c'est le premier
 * qui parle à un exploitant.
 */
const SYNONYMES = {
  nom: [
    'device name', 'devicename', 'display name', 'displayname', 'nom', "nom de l'equipement",
    'nom de l equipement', 'equipement', 'host name', 'hostname', 'name', 'node name', 'sysname',
  ],
  ip: [
    'ip address', 'ipaddress', 'management ip', 'management ip address', 'network address',
    'networkaddress', 'adresse ip', 'adresse', 'address', 'ip',
  ],
  categorie: [
    'device type', 'devicetype', 'device category', 'device role', 'devicerole', 'category',
    'categorie', 'role', 'platform', 'type',
  ],
  modele: [
    'product name', 'productname', 'model', 'model name', 'modele', 'product family',
    'productfamily', 'machine type', 'hardware',
  ],
  constructeur: ['manufacturer', 'vendor', 'brand', 'constructeur', 'fabricant', 'marque'],
  serie: [
    'serial number', 'serialnumber', 'serial', 'numero de serie', 'n de serie', 'chassis serial',
    'chassis serial number',
  ],
  site: [
    'location', 'site', 'civic location', 'building', 'batiment', 'emplacement', 'lieu', 'campus',
  ],
  zone: [
    'device group', 'devicegroup', 'group', 'groups', 'groupe', 'group name', 'device role',
    'role', 'zone', 'folder',
  ],
  version: [
    'software version', 'softwareversion', 'os version', 'ios version', 'version', 'firmware',
    'os', 'operating system',
  ],
  etat: [
    'reachability', 'collection status', 'status', 'device status', 'best state', 'worst state',
    'state', 'etat', 'statut', 'availability',
  ],
} as const

type Champ = keyof typeof SYNONYMES

/** Synonymes des tableaux de voisinage, qui décrivent une liaison et non un équipement. */
const SYNONYMES_VOISINAGE = {
  local: ['device name', 'devicename', 'local device', 'device', 'source device', 'equipement', 'nom'],
  portLocal: [
    'local interface', 'localinterface', 'local port', 'interface', 'source interface', 'port',
    'interface locale', 'port local',
  ],
  distant: [
    'neighbor device name', 'neighbor name', 'neighbor device', 'neighbour name', 'neighbor',
    'connected device', 'remote device', 'destination device', 'peer device', 'voisin',
    'equipement distant',
  ],
  portDistant: [
    'neighbor interface', 'neighbor port', 'neighbour interface', 'connected port',
    'remote interface', 'remote port', 'destination interface', 'peer port', 'port distant',
  ],
} as const

type ChampVoisinage = keyof typeof SYNONYMES_VOISINAGE

/**
 * Indice de la colonne qui porte ce champ.
 *
 * On cherche d'abord une correspondance exacte, puis seulement un intitulé qui contient le
 * synonyme : « Device Name » doit l'emporter sur « Neighbor Device Name » quand on cherche
 * l'équipement local, et l'inclusion seule les confondrait.
 */
function indiceColonne(entetes: string[], synonymes: readonly string[], pris: Set<number>): number {
  for (const synonyme of synonymes) {
    const exact = entetes.findIndex((entete, i) => !pris.has(i) && entete === synonyme)
    if (exact !== -1) return exact
  }
  for (const synonyme of synonymes) {
    if (synonyme.length < 4) continue
    const partiel = entetes.findIndex((entete, i) => !pris.has(i) && entete.includes(synonyme))
    if (partiel !== -1) return partiel
  }
  return -1
}

// ─── Lecture d'un tableau ────────────────────────────────────────────────────

interface Tableau {
  entetes: string[]
  /** Intitulés d'origine, pour pouvoir nommer les colonnes ignorées à l'utilisateur. */
  origines: string[]
  lignes: string[][]
}

/**
 * Lit un CSV ou un collage de tableur.
 *
 * Le séparateur n'est pas imposé : Prime sort des virgules, un Excel français des
 * points-virgules, un copier-coller depuis le navigateur des tabulations. On retient celui
 * qui découpe le plus régulièrement la première ligne.
 */
export function lireTableau(texte: string): Tableau | null {
  const lignes = texte.split(/\r?\n/).filter((ligne) => ligne.trim() !== '')
  if (lignes.length < 2) return null

  const separateur = ['\t', ';', ','].reduce((meilleur, candidat) => {
    const compte = (sep: string) => (lignes[0].match(new RegExp(`\\${sep}`, 'g')) ?? []).length
    return compte(candidat) > compte(meilleur) ? candidat : meilleur
  }, ',')
  if ((lignes[0].match(new RegExp(`\\${separateur}`, 'g')) ?? []).length === 0) return null

  const origines = splitCsvLine(lignes[0], separateur).map((cellule) => cellule.trim())
  return {
    entetes: origines.map(normalizeHeader),
    origines,
    lignes: lignes.slice(1).map((ligne) => splitCsvLine(ligne, separateur)),
  }
}

// ─── Provenance ──────────────────────────────────────────────────────────────

/**
 * Devine l'outil d'origine.
 *
 * Purement cosmétique : la lecture ne dépend pas du résultat. Un fichier dont on ne reconnaît
 * pas la provenance est repris exactement de la même façon.
 */
export function devinerSource(texte: string): SourceNms {
  const tete = texte.slice(0, 6000).toLowerCase()
  if (/devicesdto|inventorydetailsdto|queryresponse|webacs|prime infrastructure|\bprime\b/.test(tete)) return 'prime'
  if (/whatsup|\bwug\b|networkaddress|bestsstate|best state|worst state|activemonitor/.test(tete)) return 'whatsup'
  if (/product family|collection status|reachability/.test(tete)) return 'prime'
  if (/device group|brand\b/.test(tete)) return 'whatsup'
  // Les rapports de voisinage ne portent aucun des marqueurs précédents ; seul l'intitulé du
  // voisin les distingue — « Neighbor » chez Prime, « Connected » dans la carte L2 de WhatsUp.
  if (/neighbou?r device|neighbou?r interface|neighbou?r port/.test(tete)) return 'prime'
  if (/connected device|connected port/.test(tete)) return 'whatsup'
  return 'inconnue'
}

// ─── Déduction du type d'équipement ──────────────────────────────────────────

/**
 * Indices de type propres aux outils de supervision.
 *
 * `discovery.ts` a déjà ses propres règles, fondées sur les plateformes annoncées en LLDP.
 * Celles-ci s'y ajoutent pour les vocabulaires que seuls les superviseurs emploient — le
 * « rôle » de Prime, les catégories de WhatsUp.
 */
const INDICES_TYPE: { motif: RegExp; kind: string }[] = [
  { motif: /nexus|c9[56]\d\d|catalyst 9[56]|\bcore\b|coeur/i, kind: 'core-switch' },
  { motif: /firewall|asa\b|firepower|fortigate|palo ?alto|checkpoint|srx|pare-?feu/i, kind: 'ngfw' },
  { motif: /wireless ?lan ?controller|\bwlc\b|air-ct|c9800|mobility (controller|conductor)/i, kind: 'wlan-controller' },
  { motif: /access ?point|\bap\b|air-|aironet|\bcap\b|unifi ap/i, kind: 'wifi7' },
  { motif: /\brouters?\b|routeurs?|\bisr\b|\basr\b|\bcsr\b|\bmx\d|\brtr\b/i, kind: 'router' },
  { motif: /c9200|c2960|c1000|catalyst 9200|ex2300|\baccess ?switch\b|switch d'?acces/i, kind: 'access-switch' },
  { motif: /\bswitch(es)?\b|commutateurs?|catalyst|procurve|aruba ?\d|ex\d{4}|\bsg\d{3}|\bsw-/i, kind: 'switch' },
  { motif: /\bups\b|onduleur|smart-?ups|galaxy/i, kind: 'ups' },
  { motif: /\bpdu\b|rack ?pdu/i, kind: 'pdu' },
  { motif: /printer|imprimante|laserjet/i, kind: 'printer' },
  { motif: /esxi|vmware|hyper-?v|proxmox|hyperviseur/i, kind: 'hypervisor' },
  { motif: /netapp|storage|stockage|\bsan\b|\bnas\b|unity|powerstore/i, kind: 'storage' },
  { motif: /\bserver\b|serveur|windows|linux|ubuntu|debian|centos/i, kind: 'server' },
  { motif: /\bolt\b|isam|gpon|xgs-?pon/i, kind: 'olt' },
  { motif: /load ?balancer|\bf5\b|big-?ip|netscaler|repartiteur/i, kind: 'loadbalancer' },
]

function typeDepuis(...valeurs: (string | undefined)[]): string | undefined {
  const texte = valeurs.filter(Boolean).join(' ')
  if (!texte.trim()) return undefined
  for (const indice of INDICES_TYPE) if (indice.motif.test(texte)) return indice.kind
  return undefined
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** Un équipement injoignable reste au parc, mais la réserve est consignée. */
const ETATS_SOURDS = /^(down|unreachable|injoignable|critical|unknown|inconnu|unmanaged|non gere)/i

// ─── Inventaire ──────────────────────────────────────────────────────────────

/**
 * Reprend un tableau d'inventaire : une ligne, un équipement.
 *
 * Les équipements sans nom exploitable sont nommés par leur adresse — un relevé de
 * supervision en contient toujours une, et une ligne muette vaut mieux qu'une ligne perdue.
 */
function reprendreInventaire(tableau: Tableau, source: SourceNms): ReleveNms {
  const warnings: string[] = []
  const pris = new Set<number>()
  const colonnes = {} as Record<Champ, number>
  for (const champ of Object.keys(SYNONYMES) as Champ[]) {
    const index = indiceColonne(tableau.entetes, SYNONYMES[champ], pris)
    colonnes[champ] = index
    if (index !== -1) pris.add(index)
  }

  if (colonnes.nom === -1 && colonnes.ip === -1) {
    return {
      source,
      nodes: [],
      links: [],
      warnings: ['Ni colonne de nom ni colonne d’adresse IP : impossible d’identifier les équipements.'],
      colonnesIgnorees: tableau.origines,
    }
  }

  const colonnesIgnorees = tableau.origines.filter((_, index) => !pris.has(index))
  const cellule = (ligne: string[], champ: Champ): string | undefined => {
    const index = colonnes[champ]
    if (index === -1) return undefined
    const valeur = ligne[index]?.trim()
    return valeur && valeur !== '-' && valeur.toLowerCase() !== 'n/a' ? valeur : undefined
  }

  const nodes: NetNode[] = []
  const vus = new Map<string, NetNode>()
  let sansNom = 0
  let injoignables = 0

  for (const ligne of tableau.lignes) {
    const nomBrut = cellule(ligne, 'nom')
    const ip = cellule(ligne, 'ip')
    const nom = nomBrut ?? ip
    if (!nom) continue
    if (!nomBrut) sansNom += 1

    const cle = nom.toLowerCase()
    if (vus.has(cle)) continue

    const modele = cellule(ligne, 'modele')
    const categorie = cellule(ligne, 'categorie')
    const etat = cellule(ligne, 'etat')
    if (etat && ETATS_SOURDS.test(etat)) injoignables += 1

    const notes = [
      cellule(ligne, 'version') && `Version ${cellule(ligne, 'version')}`,
      etat && `État ${etat}`,
      `Repris de ${LIBELLES_SOURCE[source]}`,
    ]
      .filter(Boolean)
      .join(' · ')

    const node: NetNode = {
      id: uid('n'),
      kind: typeDepuis(categorie, modele, cellule(ligne, 'zone'), nom) ?? 'server',
      name: nom.replace(/\.(local|lan)$/i, ''),
      x: 0,
      y: 0,
      ip: ip && IPV4.test(ip) ? ip : undefined,
      model: (modele ?? categorie)?.slice(0, 60),
      vendor: cellule(ligne, 'constructeur'),
      serial: cellule(ligne, 'serie'),
      site: cellule(ligne, 'site'),
      zone: cellule(ligne, 'zone'),
      notes,
    }
    if (!hasDevice(node.kind)) node.kind = 'server'
    vus.set(cle, node)
    nodes.push(node)
  }

  if (nodes.length === 0) warnings.push('Aucune ligne exploitable dans ce tableau.')
  if (sansNom > 0) warnings.push(`${sansNom} équipement(s) sans nom : nommés par leur adresse IP.`)
  if (injoignables > 0) {
    warnings.push(`${injoignables} équipement(s) signalés injoignables par la supervision : repris quand même.`)
  }
  if (colonnes.site === -1 && colonnes.zone === -1) {
    warnings.push('Aucune colonne d’emplacement ni de groupe : les équipements arrivent sans site ni zone.')
  }
  return { source, nodes, links: [], warnings, colonnesIgnorees }
}

// ─── Voisinages ──────────────────────────────────────────────────────────────

/** Un tableau de voisinage se reconnaît à ce qu'il nomme deux équipements par ligne. */
export function estVoisinage(tableau: Tableau): boolean {
  const pris = new Set<number>()
  const local = indiceColonne(tableau.entetes, SYNONYMES_VOISINAGE.local, pris)
  if (local !== -1) pris.add(local)
  return indiceColonne(tableau.entetes, SYNONYMES_VOISINAGE.distant, pris) !== -1 && local !== -1
}

/**
 * Reprend un rapport de voisinage CDP/LLDP : une ligne, une liaison.
 *
 * C'est la partie qui vaut le détour. Un inventaire donne une liste ; un voisinage donne un
 * schéma. Les liaisons déjà vues dans l'autre sens sont écartées — chaque équipement déclare
 * son voisin, donc le rapport contient deux fois chaque câble.
 */
function reprendreVoisinage(tableau: Tableau, source: SourceNms): ReleveNms {
  const warnings: string[] = []
  const pris = new Set<number>()
  const colonnes = {} as Record<ChampVoisinage, number>
  for (const champ of ['local', 'distant', 'portLocal', 'portDistant'] as ChampVoisinage[]) {
    const index = indiceColonne(tableau.entetes, SYNONYMES_VOISINAGE[champ], pris)
    colonnes[champ] = index
    if (index !== -1) pris.add(index)
  }

  const nodes: NetNode[] = []
  const parNom = new Map<string, NetNode>()
  const equipement = (nom: string): NetNode => {
    const cle = nom.trim().toLowerCase()
    const trouve = parNom.get(cle)
    if (trouve) return trouve
    const node: NetNode = {
      id: uid('n'),
      kind: typeDepuis(nom) ?? 'switch',
      name: nom.trim().replace(/\.(local|lan)$/i, ''),
      x: 0,
      y: 0,
      notes: `Repris de ${LIBELLES_SOURCE[source]} · voisinage CDP/LLDP`,
    }
    parNom.set(cle, node)
    nodes.push(node)
    return node
  }

  const links: NetLink[] = []
  const paires = new Set<string>()
  for (const ligne of tableau.lignes) {
    const nomLocal = ligne[colonnes.local]?.trim()
    const nomDistant = ligne[colonnes.distant]?.trim()
    if (!nomLocal || !nomDistant || nomLocal === nomDistant) continue
    const a = equipement(nomLocal)
    const b = equipement(nomDistant)
    // Le même câble est déclaré des deux bouts : on ne garde qu'un exemplaire.
    const cle = [a.id, b.id].sort().join('|')
    if (paires.has(cle)) continue
    paires.add(cle)
    links.push({
      id: uid('l'),
      from: a.id,
      to: b.id,
      kind: 'ethernet',
      portA: colonnes.portLocal === -1 ? undefined : ligne[colonnes.portLocal]?.trim() || undefined,
      portB: colonnes.portDistant === -1 ? undefined : ligne[colonnes.portDistant]?.trim() || undefined,
      layers: ['l1', 'l2'],
    })
  }

  if (links.length === 0) warnings.push('Aucun voisinage exploitable dans ce tableau.')
  if (colonnes.portLocal === -1 || colonnes.portDistant === -1) {
    warnings.push('Colonnes de ports absentes : les liaisons arrivent sans numéro d’interface.')
  }
  return {
    source,
    nodes,
    links,
    warnings,
    colonnesIgnorees: tableau.origines.filter((_, index) => !pris.has(index)),
  }
}

// ─── JSON des API ────────────────────────────────────────────────────────────

/**
 * Aplatit un objet en couples « chemin → valeur », pour retrouver les champs quelle que soit
 * la profondeur à laquelle l'API les a rangés.
 *
 * Prime emboîte ses équipements sous `queryResponse.entity[].devicesDTO`, WhatsUp sous
 * `data.devices[]`, et la forme change d'une version à l'autre. Plutôt que de coder ces
 * chemins — qu'on ne peut pas vérifier sans l'outil sous la main —, on cherche les tableaux
 * d'objets qui ressemblent à des équipements, et on lit leurs clés comme des en-têtes.
 */
function tableauxDObjets(valeur: unknown, profondeur = 0): Record<string, unknown>[][] {
  if (profondeur > 6 || valeur === null || typeof valeur !== 'object') return []
  if (Array.isArray(valeur)) {
    const objets = valeur.filter(
      (element): element is Record<string, unknown> =>
        element !== null && typeof element === 'object' && !Array.isArray(element),
    )
    const imbriques = objets.flatMap((objet) => tableauxDObjets(objet, profondeur + 1))
    return objets.length > 0 ? [objets, ...imbriques] : imbriques
  }
  return Object.values(valeur as Record<string, unknown>).flatMap((v) => tableauxDObjets(v, profondeur + 1))
}

/** Rabat un objet imbriqué sur un seul niveau : `summary.deviceName` devient `deviceName`. */
function aplatir(objet: Record<string, unknown>, profondeur = 0): Record<string, string> {
  const plat: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(objet)) {
    if (valeur === null || valeur === undefined) continue
    if (typeof valeur === 'object' && !Array.isArray(valeur) && profondeur < 3) {
      for (const [sousCle, sousValeur] of Object.entries(aplatir(valeur as Record<string, unknown>, profondeur + 1))) {
        if (!(sousCle in plat)) plat[sousCle] = sousValeur
      }
    } else if (Array.isArray(valeur)) {
      const simples = valeur.filter((v) => typeof v === 'string' || typeof v === 'number')
      if (simples.length > 0 && !(cle in plat)) plat[cle] = simples.join(', ')
    } else if (!(cle in plat)) {
      plat[cle] = String(valeur)
    }
  }
  return plat
}

/** Le tableau d'objets le plus prometteur, converti en tableau de colonnes. */
function tableauDepuisJson(texte: string): Tableau | null {
  let racine: unknown
  try {
    racine = JSON.parse(texte)
  } catch {
    return null
  }
  const candidats = tableauxDObjets(racine)
    .map((objets) => objets.map((objet) => aplatir(objet)))
    .filter((lignes) => lignes.length > 0)
  if (candidats.length === 0) return null

  // On retient le tableau qui porte le plus de champs reconnus, puis le plus long.
  const score = (lignes: Record<string, string>[]) => {
    const entetes = Object.keys(lignes[0]).map(normalizeHeader)
    const pris = new Set<number>()
    let reconnus = 0
    for (const champ of Object.keys(SYNONYMES) as Champ[]) {
      const index = indiceColonne(entetes, SYNONYMES[champ], pris)
      if (index !== -1) {
        pris.add(index)
        reconnus += 1
      }
    }
    return reconnus
  }
  const meilleur = candidats.reduce((a, b) => {
    const sa = score(a)
    const sb = score(b)
    return sb > sa || (sb === sa && b.length > a.length) ? b : a
  })
  if (score(meilleur) < 2) return null

  // Toutes les entrées n'ont pas forcément les mêmes clés : on prend l'union.
  const origines = [...new Set(meilleur.flatMap((ligne) => Object.keys(ligne)))]
  return {
    entetes: origines.map(normalizeHeader),
    origines,
    lignes: meilleur.map((ligne) => origines.map((cle) => ligne[cle] ?? '')),
  }
}

// ─── Entrée publique ─────────────────────────────────────────────────────────

/** Reconnaît un relevé de supervision sans l'analyser — pour l'aiguillage des formats. */
export function estReleveNms(texte: string): boolean {
  const tableau = texte.trimStart().startsWith('{') || texte.trimStart().startsWith('[')
    ? tableauDepuisJson(texte)
    : lireTableau(texte)
  if (!tableau) return false
  if (estVoisinage(tableau)) return true
  const pris = new Set<number>()
  const nom = indiceColonne(tableau.entetes, SYNONYMES.nom, pris)
  if (nom === -1) return false
  pris.add(nom)
  // Un nom seul ne suffit pas : il faut au moins une adresse ou un modèle pour que ce soit
  // un inventaire d'équipements et non n'importe quel tableau nommé.
  return (
    indiceColonne(tableau.entetes, SYNONYMES.ip, pris) !== -1 ||
    indiceColonne(tableau.entetes, SYNONYMES.modele, pris) !== -1 ||
    indiceColonne(tableau.entetes, SYNONYMES.categorie, pris) !== -1
  )
}

/**
 * Reprend un relevé de supervision, CSV ou JSON, inventaire ou voisinage.
 *
 * Le même point d'entrée sert aux deux outils et aux deux formes de sortie : c'est le
 * contenu qui décide, jamais une case cochée par l'utilisateur.
 */
export function analyserNms(texte: string): ReleveNms {
  const debut = texte.trimStart()
  const tableau = debut.startsWith('{') || debut.startsWith('[') ? tableauDepuisJson(texte) : lireTableau(texte)
  const source = devinerSource(texte)
  if (!tableau) {
    return {
      source,
      nodes: [],
      links: [],
      warnings: ['Tableau illisible : attendu un CSV avec une ligne d’en-tête, ou la réponse JSON d’une API.'],
      colonnesIgnorees: [],
    }
  }
  return estVoisinage(tableau) ? reprendreVoisinage(tableau, source) : reprendreInventaire(tableau, source)
}
