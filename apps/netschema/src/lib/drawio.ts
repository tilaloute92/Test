import { hasDevice, searchDevices } from './catalog'
import { uid } from './ids'
import { guessKind } from './quickImport'
import type { Diagram, NetLink, NetNode } from '../types'

/**
 * Import de schémas draw.io (diagrams.net).
 *
 * Un fichier `.drawio` contient un `<mxGraphModel>`, soit en clair, soit compressé
 * (base64 + deflate brut). Les deux sont acceptés. On reprend les positions d'origine —
 * l'idée est de récupérer un schéma existant tel qu'il a été dessiné, quitte à relancer
 * le placement automatique ensuite.
 */

export function looksLikeDrawio(text: string): boolean {
  return /<mxfile\b|<mxGraphModel\b/i.test(text.slice(0, 4000))
}

/** Les stencils draw.io nomment les équipements : c'est la meilleure piste de typage. */
const STYLE_HINTS: { pattern: RegExp; kind: string }[] = [
  { pattern: /firewall|pare.?feu|palo|forti|asa\b/i, kind: 'ngfw' },
  { pattern: /load.?balanc|\bslb\b|\badc\b/i, kind: 'loadbalancer' },
  { pattern: /wireless|access.?point|\bwifi\b|\bap\b/i, kind: 'wifi7' },
  { pattern: /core.?switch|nexus|multilayer|layer.?3.?switch|l3_switch/i, kind: 'core-switch' },
  { pattern: /spine/i, kind: 'spine' },
  { pattern: /leaf|top.?of.?rack|\btor\b/i, kind: 'leaf' },
  { pattern: /switch|hub|bridge/i, kind: 'switch' },
  { pattern: /router|routeur|gateway/i, kind: 'router' },
  { pattern: /internet|www|world/i, kind: 'internet' },
  { pattern: /cloud|azure|aws|gcp/i, kind: 'cloud' },
  { pattern: /storage|\bsan\b|\bnas\b|disk.?array|filer/i, kind: 'storage' },
  { pattern: /database|\bdb\b|sql/i, kind: 'managed-db' },
  { pattern: /kubernetes|k8s|container|docker/i, kind: 'k8s-cluster' },
  { pattern: /virtual.?machine|hypervisor|esxi|\bvm\b/i, kind: 'hypervisor' },
  { pattern: /server|serveur|host\b|blade/i, kind: 'server' },
  { pattern: /printer|imprimante/i, kind: 'printer' },
  { pattern: /ip.?phone|telephone|voip/i, kind: 'phone' },
  { pattern: /laptop|desktop|\bpc\b|workstation|poste/i, kind: 'workstation' },
  { pattern: /\bups\b|onduleur/i, kind: 'ups' },
  { pattern: /\bpdu\b/i, kind: 'pdu' },
  { pattern: /camera/i, kind: 'camera' },
  { pattern: /rack/i, kind: 'rack' },
]

function kindFrom(style: string, label: string): string {
  for (const hint of STYLE_HINTS) {
    if (hint.pattern.test(style)) return hasDevice(hint.kind) ? hint.kind : 'server'
  }
  const byLabel = label.trim() ? searchDevices(label)[0] : undefined
  if (byLabel) return byLabel.id
  return guessKind(label)
}

/** Champs personnalisés draw.io repris tels quels dans la fiche d'équipement. */
const ATTRIBUTE_FIELDS: Record<string, keyof NetNode> = {
  ip: 'ip',
  adresse: 'ip',
  'adresse ip': 'ip',
  vlan: 'vlan',
  zone: 'zone',
  site: 'site',
  model: 'model',
  modele: 'model',
  'modèle': 'model',
  vendor: 'vendor',
  constructeur: 'vendor',
  serial: 'serial',
  'numero de serie': 'serial',
  owner: 'owner',
  responsable: 'owner',
  rack: 'rack',
  notes: 'notes',
  note: 'notes',
  description: 'notes',
}

async function inflateDiagram(payload: string): Promise<string> {
  const compact = payload.replace(/\s/g, '')
  const bytes = Uint8Array.from(atob(compact), (char) => char.charCodeAt(0))
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'Ce schéma est compressé et ce navigateur ne sait pas le décompresser. Dans draw.io : Fichier > Propriétés > décochez « Compressé », puis réenregistrez.',
    )
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return decodeURIComponent(await new Response(stream).text())
}

interface Cell {
  id: string
  parent: string | null
  label: string
  style: string
  vertex: boolean
  edge: boolean
  source: string | null
  target: string | null
  x: number
  y: number
  width: number
  height: number
  attributes: Record<string, string>
}

function textOf(value: string | null): string {
  if (!value) return ''
  // Les libellés draw.io peuvent contenir du HTML.
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function readCells(model: Element): Cell[] {
  const cells: Cell[] = []
  for (const element of [...model.querySelectorAll('mxCell')]) {
    const holder = element.parentElement?.tagName === 'object' ? element.parentElement : null
    const geometry = element.querySelector('mxGeometry')
    const attributes: Record<string, string> = {}
    if (holder) {
      for (const attribute of [...holder.attributes]) {
        if (attribute.name !== 'label' && attribute.name !== 'id') attributes[attribute.name] = attribute.value
      }
    }
    cells.push({
      id: holder?.getAttribute('id') ?? element.getAttribute('id') ?? uid('c'),
      parent: element.getAttribute('parent'),
      label: textOf(holder?.getAttribute('label') ?? element.getAttribute('value')),
      style: element.getAttribute('style') ?? '',
      vertex: element.getAttribute('vertex') === '1',
      edge: element.getAttribute('edge') === '1',
      source: element.getAttribute('source'),
      target: element.getAttribute('target'),
      x: Number(geometry?.getAttribute('x') ?? 0),
      y: Number(geometry?.getAttribute('y') ?? 0),
      width: Number(geometry?.getAttribute('width') ?? 120),
      height: Number(geometry?.getAttribute('height') ?? 60),
      attributes,
    })
  }
  return cells
}

export interface DrawioImport {
  diagram: Diagram
  warnings: string[]
}

export async function parseDrawio(text: string, fallbackTitle = 'Schéma importé'): Promise<DrawioImport> {
  const warnings: string[] = []
  const parser = new DOMParser()
  let document_ = parser.parseFromString(text, 'application/xml')
  if (document_.querySelector('parsererror')) throw new Error('Fichier draw.io illisible (XML invalide).')

  let title = fallbackTitle
  let model = document_.querySelector('mxGraphModel')

  if (!model) {
    const pages = [...document_.querySelectorAll('diagram')]
    if (pages.length === 0) throw new Error('Aucun schéma trouvé dans ce fichier.')
    if (pages.length > 1) warnings.push(`Le fichier contient ${pages.length} pages : seule la première est importée.`)
    const page = pages[0]
    title = page.getAttribute('name') ?? fallbackTitle
    const inner = page.querySelector('mxGraphModel')
    if (inner) model = inner
    else {
      const decoded = await inflateDiagram(page.textContent ?? '')
      document_ = parser.parseFromString(decoded, 'application/xml')
      model = document_.querySelector('mxGraphModel')
    }
  }
  if (!model) throw new Error('Aucun modèle mxGraphModel exploitable.')

  const cells = readCells(model)
  const byId = new Map(cells.map((cell) => [cell.id, cell]))

  // Position absolue : draw.io exprime les coordonnées d'un enfant par rapport à son groupe.
  const absolute = (cell: Cell): { x: number; y: number } => {
    let x = cell.x
    let y = cell.y
    let parent = cell.parent ? byId.get(cell.parent) : undefined
    let guard = 0
    while (parent?.vertex && guard < 20) {
      x += parent.x
      y += parent.y
      parent = parent.parent ? byId.get(parent.parent) : undefined
      guard += 1
    }
    return { x, y }
  }

  const childCount = new Map<string, number>()
  for (const cell of cells) {
    if (!cell.vertex || !cell.parent) continue
    childCount.set(cell.parent, (childCount.get(cell.parent) ?? 0) + 1)
  }

  // Un conteneur nommé devient une zone plutôt qu'un équipement.
  const zoneOf = new Map<string, string>()
  const groups = new Set<string>()
  for (const cell of cells) {
    if (!cell.vertex) continue
    const isGroup =
      (childCount.get(cell.id) ?? 0) >= 2 && (/container=1|swimlane|group/i.test(cell.style) || cell.label !== '')
    if (isGroup) groups.add(cell.id)
  }
  for (const cell of cells) {
    if (!cell.vertex || !cell.parent) continue
    const parent = byId.get(cell.parent)
    if (parent && groups.has(parent.id) && parent.label) zoneOf.set(cell.id, parent.label)
  }

  const nodes: NetNode[] = []
  const nodeByCell = new Map<string, NetNode>()
  for (const cell of cells) {
    if (!cell.vertex || groups.has(cell.id)) continue
    // Les cellules purement décoratives (texte libre, flèches) n'ont pas de nom exploitable.
    if (!cell.label && /text;|shape=none|edgeLabel/i.test(cell.style)) continue
    const position = absolute(cell)
    const node: NetNode = {
      id: uid('n'),
      kind: kindFrom(cell.style, cell.label),
      name: cell.label || 'Sans nom',
      x: Math.round(position.x + cell.width / 2),
      y: Math.round(position.y + cell.height / 2),
      zone: zoneOf.get(cell.id),
    }
    for (const [key, value] of Object.entries(cell.attributes)) {
      const field = ATTRIBUTE_FIELDS[key.toLowerCase()]
      // Les champs repris sont tous des chaînes : l'affectation dynamique reste sûre.
      if (field && value.trim()) Object.assign(node, { [field]: value.trim() })
    }
    nodes.push(node)
    nodeByCell.set(cell.id, node)
  }

  const links: NetLink[] = []
  let danglingEdges = 0
  for (const cell of cells) {
    if (!cell.edge) continue
    const from = cell.source ? nodeByCell.get(cell.source) : undefined
    const to = cell.target ? nodeByCell.get(cell.target) : undefined
    if (!from || !to || from.id === to.id) {
      danglingEdges += 1
      continue
    }
    links.push({
      id: uid('l'),
      from: from.id,
      to: to.id,
      kind: /dashed=1/.test(cell.style) ? 'vpn' : 'ethernet',
      label: cell.label || undefined,
      redundant: /dashed=1/.test(cell.style) || undefined,
      layers: ['l1', 'l2'],
    })
  }

  // Les libellés posés sur une liaison sont des cellules enfants : on les rapatrie.
  for (const cell of cells) {
    if (!/edgeLabel/i.test(cell.style) || !cell.label || !cell.parent) continue
    const parentEdge = byId.get(cell.parent)
    if (!parentEdge?.edge) continue
    const link = links.find(
      (item) =>
        nodeByCell.get(parentEdge.source ?? '')?.id === item.from &&
        nodeByCell.get(parentEdge.target ?? '')?.id === item.to,
    )
    if (link && !link.label) link.label = cell.label
  }

  if (nodes.length === 0) throw new Error('Aucun équipement trouvé dans ce schéma.')
  if (danglingEdges > 0) {
    warnings.push(`${danglingEdges} liaison(s) ignorée(s) : extrémité absente ou attachée à un groupe.`)
  }
  const unnamed = nodes.filter((node) => node.name === 'Sans nom').length
  if (unnamed > 0) warnings.push(`${unnamed} forme(s) sans libellé importée(s) sous le nom « Sans nom ».`)

  return { diagram: { title, nodes, links, vlans: [], racks: [] }, warnings }
}
