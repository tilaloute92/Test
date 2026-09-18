import { hasDevice } from './catalog'
import { uid } from './ids'
import type { LinkKind, NetLink, NetNode } from '../types'

/**
 * Découverte réseau : reconstruction d'une topologie à partir de ce que les équipements
 * savent déjà dire d'eux-mêmes.
 *
 * Un navigateur ne peut pas sonder un réseau (ni ICMP, ni SNMP, ni socket brut). La
 * découverte se fait donc en deux temps : un collecteur récupère les données sur le réseau
 * (voir `tools/collector/`), et l'application interprète ces relevés — voisinages LLDP/CDP,
 * balayages nmap, tables ARP — pour en tirer équipements et liaisons.
 */

export type DiscoveryFormat = 'lldp' | 'nmap-xml' | 'nmap-grep' | 'arp' | 'unknown'

export interface DiscoveryResult {
  format: DiscoveryFormat
  /** Nom lisible du format, pour l'aperçu. */
  label: string
  nodes: NetNode[]
  links: NetLink[]
  warnings: string[]
}

export const FORMAT_LABELS: Record<DiscoveryFormat, string> = {
  lldp: 'Voisinages LLDP / CDP',
  'nmap-xml': 'Balayage nmap (XML)',
  'nmap-grep': 'Balayage nmap (format grepable)',
  arp: 'Table ARP',
  unknown: 'Format non reconnu',
}

/** Reconnaît le format d'un relevé collé ou déposé. */
export function detectFormat(text: string): DiscoveryFormat {
  const head = text.slice(0, 4000)
  if (/<nmaprun\b/i.test(head)) return 'nmap-xml'
  if (/^Host:\s+\S+\s+\(.*?\)\s+(Status|Ports):/im.test(head)) return 'nmap-grep'
  if (/(Device ID:|Chassis id:|Local Intf:|System Name:|Port id:)/i.test(head)) return 'lldp'
  if (/(Protocol\s+Address\s+Age|\bat\s+([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b|([0-9a-f]{2}-){5}[0-9a-f]{2})/i.test(head)) {
    return 'arp'
  }
  return 'unknown'
}

// ─── Déduction du type d'équipement ──────────────────────────────────────────

const PLATFORM_HINTS: { pattern: RegExp; kind: string }[] = [
  { pattern: /fortigate|palo\s?alto|checkpoint|asa\b|srx|pfsense|firewall/i, kind: 'ngfw' },
  { pattern: /9800|wlc\b|wism|smartzone|zonedirector|mobility (controller|conductor)/i, kind: 'wlan-controller' },
  { pattern: /mds 9|brocade|fibre ?channel|\bfc ?switch/i, kind: 'san-switch' },
  { pattern: /scalance|moxa|hirschmann|phoenix contact/i, kind: 'industrial-switch' },
  { pattern: /opengear|console ?server|avocent|nport/i, kind: 'console-server' },
  { pattern: /nexus|catalyst 9[5-6]|c9500|c9600|core/i, kind: 'core-switch' },
  { pattern: /air-|aironet|access point|\bap\b|unifi|aruba ap/i, kind: 'wifi7' },
  { pattern: /isr|asr\b|router|rtr|mx\d|vedge|velocloud/i, kind: 'router' },
  { pattern: /catalyst|c9300|c2960|ex\d|switch|procurve|aruba \d/i, kind: 'switch' },
  { pattern: /esxi|vmware|proxmox|hyper-?v|xcp/i, kind: 'hypervisor' },
  { pattern: /netapp|unity|powerstore|synology|qnap|storage|san\b|nas\b/i, kind: 'storage' },
  { pattern: /ups|smart-?ups|galaxy|eaton/i, kind: 'ups' },
  { pattern: /pdu|rack ?pdu/i, kind: 'pdu' },
  { pattern: /printer|laserjet|imprimante/i, kind: 'printer' },
  { pattern: /ipbx|\bpbx\b|omnipcx|asterisk|mediant|audiocodes/i, kind: 'ipbx' },
  { pattern: /\bont\b|livebox|\bmodem\b/i, kind: 'modem' },
  { pattern: /phone|téléphone|voip|sip/i, kind: 'phone' },
]

/** Capacités annoncées par LLDP/CDP (B = bridge, R = router, W = WLAN, H = host…). */
const CAPABILITY_HINTS: { pattern: RegExp; kind: string }[] = [
  { pattern: /\bwlan|\bw\b|access point/i, kind: 'wifi7' },
  { pattern: /router|\br\b/i, kind: 'router' },
  { pattern: /bridge|switch|\bb\b|\bs\b/i, kind: 'switch' },
  { pattern: /phone|\bp\b/i, kind: 'phone' },
  { pattern: /host|station|\bh\b/i, kind: 'server' },
]

/** Services ouverts relevés par nmap. */
const PORT_HINTS: { ports: number[]; kind: string }[] = [
  { ports: [902, 5989], kind: 'hypervisor' },
  { ports: [9100, 515, 631], kind: 'printer' },
  { ports: [3389], kind: 'workstation' },
  { ports: [5060, 5061], kind: 'phone' },
  { ports: [6443, 10250], kind: 'k8s-cluster' },
  { ports: [3260], kind: 'storage' },
  { ports: [389, 636, 88], kind: 'idp' },
  { ports: [53, 67], kind: 'ddi' },
  { ports: [1433, 3306, 5432, 1521], kind: 'managed-db' },
  { ports: [161, 23], kind: 'switch' },
]

function kindFromText(...values: (string | undefined)[]): string | undefined {
  const text = values.filter(Boolean).join(' ')
  if (!text.trim()) return undefined
  for (const hint of PLATFORM_HINTS) if (hint.pattern.test(text)) return hint.kind
  return undefined
}

function kindFromCapabilities(capabilities?: string): string | undefined {
  if (!capabilities) return undefined
  for (const hint of CAPABILITY_HINTS) if (hint.pattern.test(capabilities)) return hint.kind
  return undefined
}

function kindFromPorts(ports: number[]): string | undefined {
  for (const hint of PORT_HINTS) {
    if (hint.ports.some((port) => ports.includes(port))) return hint.kind
  }
  if (ports.includes(443) || ports.includes(80) || ports.includes(22)) return 'server'
  return undefined
}

function safeKind(kind: string | undefined, fallback = 'server'): string {
  return kind && hasDevice(kind) ? kind : fallback
}

// ─── Fabrique d'équipements ──────────────────────────────────────────────────

class NodeBuilder {
  private readonly byKey = new Map<string, NetNode>()
  readonly nodes: NetNode[] = []

  get(name: string, seed: Partial<NetNode> = {}): NetNode {
    const key = name.trim().toLowerCase()
    const found = this.byKey.get(key)
    if (found) {
      Object.assign(found, Object.fromEntries(Object.entries(seed).filter(([, value]) => value !== undefined)))
      return found
    }
    const node: NetNode = {
      id: uid('n'),
      kind: safeKind(seed.kind),
      name: name.trim(),
      x: 0,
      y: 0,
      ...seed,
    }
    this.byKey.set(key, node)
    this.nodes.push(node)
    return node
  }
}

// ─── LLDP / CDP ──────────────────────────────────────────────────────────────

/** Nom de l'équipement interrogé, deviné depuis l'invite (« SW-CORE-01#show lldp… »). */
function localNameFrom(text: string): string | undefined {
  const match = text.match(/^\s*([\w.-]+)\s*[#>]\s*(?:sh|show)\b/im)
  return match?.[1]
}

const LINK_FROM_KIND: Record<string, LinkKind> = {
  wifi7: 'ethernet',
  wifi: 'ethernet',
  phone: 'ethernet',
}

/**
 * Voisinages LLDP et CDP : c'est la source la plus fiable pour la topologie, puisque
 * chaque équipement déclare ses voisins directs et le port par lequel il les voit.
 */
export function parseLldp(text: string, fallbackLocalName?: string): DiscoveryResult {
  const warnings: string[] = []
  const builder = new NodeBuilder()
  const links: NetLink[] = []

  const localName = localNameFrom(text) ?? fallbackLocalName?.trim() ?? 'Équipement local'
  const local = builder.get(localName, { kind: 'switch' })

  // Un bloc par voisin : les sorties « detail » séparent par des lignes de tirets ou
  // par la répétition du premier champ.
  const blocks = text
    .split(/\n-{3,}\n|\n(?=(?:Device ID:|Chassis id:|Local Intf:))/i)
    .map((block) => block.trim())
    .filter(Boolean)

  const field = (block: string, ...names: string[]): string | undefined => {
    for (const name of names) {
      const match = block.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'im'))
      if (match) return match[1].trim().replace(/,$/, '')
    }
    return undefined
  }

  for (const block of blocks) {
    const remoteName =
      field(block, 'Device ID', 'System Name') ??
      field(block, 'Chassis id')?.replace(/\s.*$/, '')
    if (!remoteName || /^show\b/i.test(remoteName)) continue

    const localPort = field(block, 'Interface', 'Local Intf', 'Local Interface')?.split(',')[0]
    const remotePort = field(block, 'Port ID \\(outgoing port\\)', 'Port id', 'Port ID')
    const platform = field(block, 'Platform', 'System Description')
    const capabilities = field(block, 'Capabilities', 'Enabled Capabilities')
    const ip =
      field(block, 'IP address', 'IP Address', 'IPv4 address', 'Management Addresses', 'IP') ??
      block.match(/\b(?:IP(?:v4)? address|IP)\s*:\s*([\d.]+)/i)?.[1]

    const kind = safeKind(
      kindFromText(platform, remoteName) ?? kindFromCapabilities(capabilities),
      'switch',
    )
    const remote = builder.get(remoteName.replace(/\.(local|lan)$/i, ''), {
      kind,
      ip: ip && /^[\d.]+$/.test(ip) ? ip : undefined,
      model: platform?.slice(0, 60),
      notes: 'Découvert par LLDP/CDP',
    })

    links.push({
      id: uid('l'),
      from: local.id,
      to: remote.id,
      kind: LINK_FROM_KIND[kind] ?? 'ethernet',
      portA: localPort?.trim(),
      portB: remotePort?.trim(),
      layers: ['l1', 'l2'],
    })
  }

  if (links.length === 0) warnings.push('Aucun voisin trouvé : vérifiez que le relevé est bien une sortie « detail ».')
  return { format: 'lldp', label: FORMAT_LABELS.lldp, nodes: builder.nodes, links, warnings }
}

// ─── nmap ────────────────────────────────────────────────────────────────────

export function parseNmapXml(text: string): DiscoveryResult {
  const warnings: string[] = []
  const builder = new NodeBuilder()
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (document.querySelector('parsererror')) {
    return { format: 'nmap-xml', label: FORMAT_LABELS['nmap-xml'], nodes: [], links: [], warnings: ['XML illisible.'] }
  }

  for (const host of [...document.querySelectorAll('host')]) {
    if (host.querySelector('status')?.getAttribute('state') !== 'up') continue
    const ipv4 = [...host.querySelectorAll('address')].find((a) => a.getAttribute('addrtype') === 'ipv4')
    const mac = [...host.querySelectorAll('address')].find((a) => a.getAttribute('addrtype') === 'mac')
    const ip = ipv4?.getAttribute('addr') ?? undefined
    const hostname = host.querySelector('hostname')?.getAttribute('name') ?? undefined
    const ports = [...host.querySelectorAll('port')]
      .filter((port) => port.querySelector('state')?.getAttribute('state') === 'open')
      .map((port) => Number(port.getAttribute('portid')))
      .filter((port) => Number.isFinite(port))
    const services = [...host.querySelectorAll('service')]
      .map((service) => service.getAttribute('name'))
      .filter(Boolean)
      .slice(0, 6)
      .join(', ')
    const osMatch = host.querySelector('osmatch')?.getAttribute('name') ?? undefined
    if (!ip && !hostname) continue

    builder.get(hostname ?? ip ?? 'hôte', {
      kind: safeKind(kindFromText(osMatch, hostname, mac?.getAttribute('vendor') ?? undefined) ?? kindFromPorts(ports)),
      ip,
      vendor: mac?.getAttribute('vendor') ?? undefined,
      model: osMatch?.slice(0, 60),
      notes: [services && `Ports : ${services}`, 'Découvert par nmap'].filter(Boolean).join(' · '),
    })
  }

  if (builder.nodes.length === 0) warnings.push('Aucun hôte actif dans ce balayage.')
  return { format: 'nmap-xml', label: FORMAT_LABELS['nmap-xml'], nodes: builder.nodes, links: [], warnings }
}

export function parseNmapGrepable(text: string): DiscoveryResult {
  const builder = new NodeBuilder()
  const warnings: string[] = []
  const hosts = new Map<string, { name?: string; ports: number[]; services: string[] }>()

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^Host:\s+(\S+)\s+\(([^)]*)\)\s+(.*)$/)
    if (!match) continue
    const [, ip, name, rest] = match
    const entry = hosts.get(ip) ?? { name: name || undefined, ports: [], services: [] }
    if (name) entry.name = name
    const portsPart = rest.match(/Ports:\s*(.+)$/)
    if (portsPart) {
      for (const chunk of portsPart[1].split(',')) {
        const fields = chunk.trim().split('/')
        if (fields[1] !== 'open') continue
        const port = Number(fields[0])
        if (Number.isFinite(port)) entry.ports.push(port)
        if (fields[4]) entry.services.push(fields[4])
      }
    }
    hosts.set(ip, entry)
  }

  for (const [ip, entry] of hosts) {
    builder.get(entry.name ?? ip, {
      kind: safeKind(kindFromText(entry.name) ?? kindFromPorts(entry.ports)),
      ip,
      notes: [entry.services.length > 0 && `Ports : ${entry.services.slice(0, 6).join(', ')}`, 'Découvert par nmap']
        .filter(Boolean)
        .join(' · '),
    })
  }

  if (builder.nodes.length === 0) warnings.push('Aucun hôte trouvé dans ce relevé.')
  return { format: 'nmap-grep', label: FORMAT_LABELS['nmap-grep'], nodes: builder.nodes, links: [], warnings }
}

// ─── Table ARP ───────────────────────────────────────────────────────────────

export function parseArp(text: string): DiscoveryResult {
  const builder = new NodeBuilder()
  const warnings: string[] = []

  for (const line of text.split(/\r?\n/)) {
    const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1]
    const mac = line.match(/\b((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|(?:[0-9a-f]{4}\.){2}[0-9a-f]{4})\b/i)?.[1]
    if (!ip || !mac) continue
    const vlan = line.match(/\bVlan\s*(\d+)/i)?.[1]
    const name = line.match(/^\s*([\w.-]+)\s+\(/)?.[1]
    builder.get(name && name !== '?' ? name : ip, {
      kind: 'server',
      ip,
      vlan: vlan ? `VLAN ${vlan}` : undefined,
      notes: `Découvert par ARP · ${mac}`,
    })
  }

  if (builder.nodes.length === 0) warnings.push('Aucune association adresse IP / adresse MAC trouvée.')
  return { format: 'arp', label: FORMAT_LABELS.arp, nodes: builder.nodes, links: [], warnings }
}

/** Analyse un relevé en détectant son format. */
export function parseDiscovery(text: string, options: { localName?: string } = {}): DiscoveryResult {
  const format = detectFormat(text)
  switch (format) {
    case 'lldp':
      return parseLldp(text, options.localName)
    case 'nmap-xml':
      return parseNmapXml(text)
    case 'nmap-grep':
      return parseNmapGrepable(text)
    case 'arp':
      return parseArp(text)
    default:
      return {
        format,
        label: FORMAT_LABELS.unknown,
        nodes: [],
        links: [],
        warnings: [
          'Format non reconnu. Formats acceptés : voisinages LLDP/CDP (sortie « detail »), nmap XML ou grepable, table ARP.',
        ],
      }
  }
}
