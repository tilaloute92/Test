import { deviceMeta, LINKS, ROLES } from './catalog'
import { uid } from './ids'
import type { Diagram, HaRole, LinkKind, NetLink, NetNode } from '../types'

const STORAGE_KEY = 'netschema:diagram:v1'
const FILE_VERSION = 1

export function emptyDiagram(): Diagram {
  return { title: 'Nouveau schéma réseau', nodes: [], links: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

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
    links.push({
      id: str(item.id) ?? uid('l'),
      from,
      to,
      kind: kind && kind in LINKS ? (kind as LinkKind) : 'ethernet',
      label: str(item.label),
      speed: str(item.speed),
      redundant: item.redundant === true,
    })
  }

  return { title: str(source.title) ?? 'Schéma réseau', nodes, links }
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
