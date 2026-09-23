import { deviceMeta, LINKS, ROLES } from './catalog'
import { looksLikeDrawio, parseDrawio } from './drawio'
import { uid } from './ids'
import type {
  AnchorSide,
  Annotation,
  AnnotationKind,
  Classeur,
  AssetStatus,
  Attach,
  FlowAction,
  FlowDef,
  TitleBlock,
  LabelOffset,
  Diagram,
  LinkShape,
  HaRole,
  LinkKind,
  NetLink,
  NetNode,
  OsiLayer,
  RackDef,
  PortMode,
  RoutingProtocol,
  StpRole,
  VlanDef,
} from '../types'

const STORAGE_KEY = 'netschema:diagram:v1'
const FILE_VERSION = 1

export function emptyDiagram(): Diagram {
  return { title: 'Nouveau schéma réseau', pageName: 'Schéma', nodes: [], links: [], vlans: [], racks: [] }
}

/** Date du jour au format AAAA-MM-JJ, pour le cartouche et les exports. */
export function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Nom de page libre : « Schéma 2 », « Schéma 3 »… */
export function nomDePageLibre(pages: Diagram[], base = 'Schéma'): string {
  const pris = new Set(pages.map((page) => (page.pageName ?? '').toLowerCase()))
  if (!pris.has(base.toLowerCase())) return base
  for (let index = 2; index < 500; index += 1) {
    const candidat = `${base} ${index}`
    if (!pris.has(candidat.toLowerCase())) return candidat
  }
  return `${base} ${Date.now()}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

const SHAPES = ['auto', 'orthogonal', 'straight', 'curved']
const ANCHORS = ['auto', 'top', 'bottom', 'left', 'right']
const STATUSES = ['production', 'stock', 'maintenance', 'retire']
const STP_ROLES = ['root', 'designated', 'alternate', 'blocking', 'edge']
const ROUTING = ['static', 'ospf', 'bgp', 'eigrp', 'is-is', 'rip']

function portMode(value: unknown): PortMode | undefined {
  return value === 'access' || value === 'trunk' ? value : undefined
}

/** Mode de négociation d'un agrégat : on n'accepte que les trois valeurs de la norme. */
function modeLacp(valeur: unknown): NetLink['lacp'] {
  return valeur === 'active' || valeur === 'passive' || valeur === 'static' ? valeur : undefined
}

function stpRole(value: unknown): StpRole | undefined {
  return STP_ROLES.includes(String(value)) ? (value as StpRole) : undefined
}

/** Point d'accroche libre : deux fractions bornées à la boîte de l'équipement. */
function attach(value: unknown): Attach | undefined {
  if (!isRecord(value) || !Number.isFinite(value.dx) || !Number.isFinite(value.dy)) return undefined
  const clamp = (n: number) => Math.max(-0.5, Math.min(0.5, n))
  return { dx: clamp(Number(value.dx)), dy: clamp(Number(value.dy)) }
}

/** Décalage d'étiquette : deux distances en coordonnées du schéma. */
function offset(value: unknown): LabelOffset | undefined {
  if (!isRecord(value) || !Number.isFinite(value.dx) || !Number.isFinite(value.dy)) return undefined
  return { dx: Number(value.dx), dy: Number(value.dy) }
}

function roleOf(value: unknown): HaRole | undefined {
  const role = str(value)
  return role && role in ROLES ? (role as HaRole) : undefined
}

const ANNOTATION_KINDS = ['note', 'zone', 'arrow']
const FLOW_ACTIONS = ['autorise', 'refuse', 'etudier']

/** Couleur acceptée : une couleur CSS courte et reconnaissable, rien d'exotique. */
function couleur(value: unknown): string | undefined {
  const texte = str(value)
  return texte && /^#[0-9a-fA-F]{3,8}$/.test(texte) ? texte : undefined
}

/** Annotations : notes, cadres et flèches posés sur le plan. */
function annotations(value: unknown): Annotation[] | undefined {
  if (!Array.isArray(value)) return undefined
  const lues: Annotation[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const kind = str(item.kind)
    if (!kind || !ANNOTATION_KINDS.includes(kind)) continue
    const nombre = (v: unknown, defaut: number) => (Number.isFinite(v) ? Number(v) : defaut)
    lues.push({
      id: str(item.id) ?? uid('a'),
      kind: kind as AnnotationKind,
      text: str(item.text)?.slice(0, 2000),
      x: nombre(item.x, 0),
      y: nombre(item.y, 0),
      w: nombre(item.w, 200),
      h: nombre(item.h, 80),
      color: couleur(item.color),
    })
  }
  return lues.length > 0 ? lues : undefined
}

/** Matrice de flux : une ligne par flux documenté. */
function flows(value: unknown): FlowDef[] | undefined {
  if (!Array.isArray(value)) return undefined
  const lus: FlowDef[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const from = str(item.from)
    const to = str(item.to)
    if (!from || !to) continue
    const action = str(item.action)
    lus.push({
      id: str(item.id) ?? uid('f'),
      from,
      to,
      service: str(item.service),
      protocol: str(item.protocol),
      action: action && FLOW_ACTIONS.includes(action) ? (action as FlowAction) : undefined,
      purpose: str(item.purpose),
      owner: str(item.owner),
      encryption: str(item.encryption),
      notes: str(item.notes),
    })
  }
  return lus.length > 0 ? lus : undefined
}

/** Cartouche : uniquement des champs de texte courts, plus l'affichage. */
function titleBlock(value: unknown): TitleBlock | undefined {
  if (!isRecord(value)) return undefined
  const court = (v: unknown) => str(v)?.slice(0, 120)
  const bloc: TitleBlock = {
    show: value.show === true,
    organisation: court(value.organisation),
    author: court(value.author),
    reference: court(value.reference),
    version: court(value.version),
    date: court(value.date),
    status: court(value.status),
    confidentiality: court(value.confidentiality),
    notes: str(value.notes)?.slice(0, 400),
  }
  const rempli = Object.entries(bloc).some(([cle, valeur]) => cle !== 'show' && valeur !== undefined)
  return bloc.show || rempli ? bloc : undefined
}

/**
 * Relit un schéma venant du disque ou du stockage local sans jamais faire confiance à sa
 * forme : tout champ inconnu est ignoré, toute liaison orpheline est supprimée.
 */
export function parseDiagram(raw: unknown): Diagram {
  const source = isRecord(raw) && isRecord(raw.diagram) ? raw.diagram : raw
  if (!isRecord(source)) throw new Error("Fichier illisible : ce n'est pas un schéma NetSchema.")

  const rawNodes = Array.isArray(source.nodes) ? source.nodes : []
  const nodes: NetNode[] = []
  const seen = new Set<string>()
  for (const item of rawNodes) {
    if (!isRecord(item)) continue
    // Un type absent du catalogue local est conservé tel quel : le schéma reste ouvrable
    // même si le lot d'équipements correspondant n'est pas installé sur ce poste.
    const kind = str(item.kind)
    if (!kind) continue
    let id = str(item.id) ?? uid('n')
    if (seen.has(id)) id = uid('n')
    seen.add(id)
    nodes.push({
      id,
      kind,
      name: str(item.name) ?? deviceMeta(kind).label,
      model: str(item.model),
      ip: str(item.ip),
      vlan: str(item.vlan),
      zone: str(item.zone),
      site: str(item.site),
      cluster: str(item.cluster),
      role: roleOf(item.role),
      vip: str(item.vip),
      haTech: str(item.haTech),
      dualPower: item.dualPower === true,
      serial: str(item.serial),
      vendor: str(item.vendor),
      assetTag: str(item.assetTag),
      purchaseDate: str(item.purchaseDate),
      warrantyEnd: str(item.warrantyEnd),
      status: STATUSES.includes(String(item.status)) ? (item.status as AssetStatus) : undefined,
      owner: str(item.owner),
      rack: str(item.rack),
      rackUnit: Number.isFinite(item.rackUnit) ? Number(item.rackUnit) : undefined,
      heightU: Number.isFinite(item.heightU) ? Math.max(1, Number(item.heightU)) : undefined,
      powerW: Number.isFinite(item.powerW) ? Number(item.powerW) : undefined,
      notes: str(item.notes),
      x: Number.isFinite(item.x) ? Number(item.x) : 0,
      y: Number.isFinite(item.y) ? Number(item.y) : 0,
      pinned: item.pinned === true,
      rank: typeof item.rank === 'number' ? item.rank : null,
    })
  }

  const ids = new Set(nodes.map((n) => n.id))
  const rawLinks = Array.isArray(source.links) ? source.links : []
  const links: NetLink[] = []
  for (const item of rawLinks) {
    if (!isRecord(item)) continue
    const from = str(item.from)
    const to = str(item.to)
    if (!from || !to || from === to || !ids.has(from) || !ids.has(to)) continue
    const kind = str(item.kind)
    const layers = Array.isArray(item.layers)
      ? item.layers.filter((layer): layer is OsiLayer => layer === 'l1' || layer === 'l2' || layer === 'l3')
      : undefined
    links.push({
      id: str(item.id) ?? uid('l'),
      from,
      to,
      kind: kind && kind in LINKS ? (kind as LinkKind) : 'ethernet',
      label: str(item.label),
      speed: str(item.speed),
      redundant: item.redundant === true,
      layers: layers && layers.length > 0 ? layers : undefined,
      waypoints: Array.isArray(item.waypoints)
        ? item.waypoints
            .filter((point): point is { x: number; y: number } => isRecord(point) && Number.isFinite(point.x) && Number.isFinite(point.y))
            .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
        : undefined,
      shape: SHAPES.includes(String(item.shape)) ? (item.shape as LinkShape) : undefined,
      anchorA: ANCHORS.includes(String(item.anchorA)) ? (item.anchorA as AnchorSide) : undefined,
      anchorB: ANCHORS.includes(String(item.anchorB)) ? (item.anchorB as AnchorSide) : undefined,
      attachA: attach(item.attachA),
      attachB: attach(item.attachB),
      labelOffset: offset(item.labelOffset),
      labelOffsetA: offset(item.labelOffsetA),
      labelOffsetB: offset(item.labelOffsetB),
      portA: str(item.portA),
      portB: str(item.portB),
      vlans: str(item.vlans),
      mode: portMode(item.mode),
      nativeVlan: str(item.nativeVlan),
      lag: str(item.lag),
      lacp: modeLacp(item.lacp),
      stp: stpRole(item.stp),
      mtu: Number.isFinite(item.mtu) ? Number(item.mtu) : undefined,
      // Configuration propre à chaque extrémité (ce qui diffère d'un équipement à l'autre).
      modeA: portMode(item.modeA),
      modeB: portMode(item.modeB),
      vlansA: str(item.vlansA),
      vlansB: str(item.vlansB),
      nativeVlanA: str(item.nativeVlanA),
      nativeVlanB: str(item.nativeVlanB),
      stpA: stpRole(item.stpA),
      stpB: stpRole(item.stpB),
      lagA: str(item.lagA),
      lagB: str(item.lagB),
      subnet: str(item.subnet),
      ipA: str(item.ipA),
      ipB: str(item.ipB),
      vrf: str(item.vrf),
      routing: ROUTING.includes(String(item.routing)) ? (item.routing as RoutingProtocol) : undefined,
    })
  }

  const rawVlans = Array.isArray(source.vlans) ? source.vlans : []
  const vlans: VlanDef[] = []
  const seenVlans = new Set<string>()
  for (const item of rawVlans) {
    if (!isRecord(item)) continue
    const id = str(item.id) ?? (Number.isFinite(item.id) ? String(item.id) : undefined)
    if (!id || seenVlans.has(id)) continue
    seenVlans.add(id)
    vlans.push({
      id,
      name: str(item.name),
      subnet: str(item.subnet),
      gateway: str(item.gateway),
      color: str(item.color),
      notes: str(item.notes),
    })
  }

  const rawRacks = Array.isArray(source.racks) ? source.racks : []
  const racks: RackDef[] = []
  const seenRacks = new Set<string>()
  for (const item of rawRacks) {
    if (!isRecord(item)) continue
    const id = str(item.id)
    if (!id || seenRacks.has(id)) continue
    seenRacks.add(id)
    racks.push({
      id,
      name: str(item.name) ?? id,
      site: str(item.site),
      room: str(item.room),
      units: Number.isFinite(item.units) ? Math.max(1, Math.min(60, Number(item.units))) : 42,
      notes: str(item.notes),
    })
  }

  return {
    title: str(source.title) ?? 'Schéma réseau',
    pageName: str(source.pageName),
    nodes,
    links,
    vlans,
    racks,
    annotations: annotations(source.annotations),
    flows: flows(source.flows),
    titleBlock: titleBlock(source.titleBlock),
    locked: source.locked === true,
    labelsLocked: source.labelsLocked === true,
    layerNames: layerNames(source.layerNames),
    layerPads: layerPads(source.layerPads),
  }
}

/** Marges de cadre par couche, bornées : un cadre ne se dessine pas à l'autre bout du plan. */
function layerPads(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined
  const marges: Record<string, number> = {}
  for (const [rang, marge] of Object.entries(value)) {
    const nombre = Number(marge)
    if (/^\d{1,2}$/.test(rang) && Number.isFinite(nombre)) {
      marges[rang] = Math.max(-20, Math.min(160, Math.round(nombre)))
    }
  }
  return Object.keys(marges).length > 0 ? marges : undefined
}

/** Noms de couches personnalisés : des rangs numériques vers des libellés courts. */
function layerNames(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const noms: Record<string, string> = {}
  for (const [rang, nom] of Object.entries(value)) {
    const texte = str(nom)
    if (/^\d{1,2}$/.test(rang) && texte) noms[rang] = texte.slice(0, 40)
  }
  return Object.keys(noms).length > 0 ? noms : undefined
}

/**
 * Relit un document, quel que soit son âge.
 *
 * Les fichiers d'avant les onglets ne contiennent qu'un schéma : ils deviennent un document
 * d'une seule page. Personne n'a de conversion à faire, et un fichier enregistré aujourd'hui
 * reste lisible par la version d'hier — elle y verra sa première page.
 */
export function parseClasseur(raw: unknown): Classeur {
  const source = isRecord(raw) && isRecord(raw.diagram) ? raw.diagram : raw
  const conteneur = isRecord(raw) ? raw : {}
  const brutes = Array.isArray((source as Record<string, unknown>)?.pages)
    ? ((source as Record<string, unknown>).pages as unknown[])
    : Array.isArray(conteneur.pages)
      ? (conteneur.pages as unknown[])
      : null

  if (!brutes || brutes.length === 0) {
    const page = parseDiagram(raw)
    return { title: page.title, pages: [{ ...page, pageName: page.pageName ?? 'Schéma' }], activePage: 0 }
  }

  const pages = brutes.map((page, index) => {
    const lue = parseDiagram(page)
    return { ...lue, pageName: lue.pageName ?? `Schéma ${index + 1}` }
  })
  const titre =
    str((source as Record<string, unknown>)?.title) ?? str(conteneur.title) ?? pages[0].title
  const active = Number((source as Record<string, unknown>)?.activePage ?? conteneur.activePage ?? 0)
  return {
    title: titre,
    pages: pages.map((page) => ({ ...page, title: titre })),
    activePage: Number.isFinite(active) ? Math.max(0, Math.min(pages.length - 1, active)) : 0,
  }
}

export function saveLocal(classeur: Classeur) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: FILE_VERSION, ...classeurJson(classeur) }))
  } catch {
    // Stockage plein ou désactivé (navigation privée) : l'application reste utilisable,
    // seule la reprise automatique au prochain lancement est perdue.
  }
}

export function loadLocal(): Classeur | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return parseClasseur(JSON.parse(raw))
  } catch {
    return null
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // sans effet si le stockage local est indisponible
  }
}

/**
 * Forme enregistrée d'un document.
 *
 * La première page est aussi recopiée à la racine : un lecteur qui ne connaît pas les onglets
 * (une version plus ancienne, un outil tiers) y retrouve un schéma complet et exploitable.
 */
export function classeurJson(classeur: Classeur): Record<string, unknown> {
  const premiere = classeur.pages[0] ?? emptyDiagram()
  return {
    ...premiere,
    title: classeur.title,
    activePage: classeur.activePage ?? 0,
    pages: classeur.pages.map((page) => ({ ...page, title: classeur.title })),
  }
}

export function diagramFileContent(classeur: Classeur): string {
  return JSON.stringify({ version: FILE_VERSION, diagram: classeurJson(classeur) }, null, 2)
}

export async function readDiagramFile(file: File): Promise<Diagram> {
  return parseDiagram(JSON.parse(await file.text()))
}

/**
 * Ouverture d'un fichier de schéma, quel qu'en soit le format : projet NetSchema (.json)
 * ou schéma draw.io / diagrams.net (.drawio, .xml), compressé ou non.
 */
export async function readProjectFile(file: File): Promise<{ classeur: Classeur; warnings: string[] }> {
  const text = await file.text()
  if (looksLikeDrawio(text)) {
    const { diagram, warnings } = await parseDrawio(text, file.name.replace(/\.[^.]+$/, ""))
    return { classeur: { title: diagram.title, pages: [{ ...diagram, pageName: 'Schéma' }], activePage: 0 }, warnings }
  }
  try {
    return { classeur: parseClasseur(JSON.parse(text)), warnings: [] }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Fichier non reconnu : attendu un projet NetSchema (.json) ou un schéma draw.io.')
    }
    throw error
  }
}
