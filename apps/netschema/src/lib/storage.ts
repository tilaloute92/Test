import { deviceMeta, LINKS, ROLES } from './catalog'
import { looksLikeDrawio, parseDrawio } from './drawio'
import { uid } from './ids'
import type {
  AssetStatus,
  Diagram,
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
  return { title: 'Nouveau schéma réseau', nodes: [], links: [], vlans: [], racks: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

const STATUSES = ['production', 'stock', 'maintenance', 'retire']
const STP_ROLES = ['root', 'designated', 'alternate', 'blocking', 'edge']
const ROUTING = ['static', 'ospf', 'bgp', 'eigrp', 'is-is', 'rip']

function roleOf(value: unknown): HaRole | undefined {
  const role = str(value)
  return role && role in ROLES ? (role as HaRole) : undefined
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
      portA: str(item.portA),
      portB: str(item.portB),
      vlans: str(item.vlans),
      mode: item.mode === 'access' || item.mode === 'trunk' ? (item.mode as PortMode) : undefined,
      nativeVlan: str(item.nativeVlan),
      lag: str(item.lag),
      stp: STP_ROLES.includes(String(item.stp)) ? (item.stp as StpRole) : undefined,
      mtu: Number.isFinite(item.mtu) ? Number(item.mtu) : undefined,
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

  return { title: str(source.title) ?? 'Schéma réseau', nodes, links, vlans, racks }
}

export function saveLocal(diagram: Diagram) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: FILE_VERSION, diagram }))
  } catch {
    // Stockage plein ou désactivé (navigation privée) : l'application reste utilisable,
    // seule la reprise automatique au prochain lancement est perdue.
  }
}

export function loadLocal(): Diagram | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return parseDiagram(JSON.parse(raw))
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

export function diagramFileContent(diagram: Diagram): string {
  return JSON.stringify({ version: FILE_VERSION, diagram }, null, 2)
}

export async function readDiagramFile(file: File): Promise<Diagram> {
  return parseDiagram(JSON.parse(await file.text()))
}

/**
 * Ouverture d'un fichier de schéma, quel qu'en soit le format : projet NetSchema (.json)
 * ou schéma draw.io / diagrams.net (.drawio, .xml), compressé ou non.
 */
export async function readProjectFile(file: File): Promise<{ diagram: Diagram; warnings: string[] }> {
  const text = await file.text()
  if (looksLikeDrawio(text)) {
    return parseDrawio(text, file.name.replace(/\.[^.]+$/, ''))
  }
  try {
    return { diagram: parseDiagram(JSON.parse(text)), warnings: [] }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Fichier non reconnu : attendu un projet NetSchema (.json) ou un schéma draw.io.')
    }
    throw error
  }
}
