#!/usr/bin/env node
/**
 * Collecteur NetSchema — découverte réseau en ligne de commande.
 *
 * Un navigateur ne peut ni envoyer un ping, ni interroger un équipement en SNMP. Ce script
 * fait la collecte depuis un poste d'administration et écrit un fichier de projet NetSchema
 * (ouvrable avec « Ouvrir… » dans l'application).
 *
 * Il n'a aucune dépendance npm : il s'appuie sur les outils déjà présents sur le poste
 * (`nmap`, `snmpwalk`) et se contente d'interpréter leurs sorties. Sans ces outils, il sait
 * aussi relire des relevés déjà pris (`--from`).
 *
 * Exemples :
 *   node netschema-collect.mjs --subnet 10.10.0.0/24 --out decouverte.json
 *   node netschema-collect.mjs --subnet 10.10.0.0/24 --snmp-community public --out site.json
 *   node netschema-collect.mjs --from exemples/lldp.txt exemples/nmap.xml --out exemple.json
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const HELP = `Collecteur NetSchema

  --subnet <CIDR>          Balaye un réseau avec nmap (peut être répété)
  --snmp-community <nom>   Interroge chaque hôte trouvé en SNMP v2c (sysName, voisins LLDP)
  --from <fichier...>      Relit des relevés déjà pris (nmap XML, LLDP/CDP, ARP)
  --title <texte>          Titre du schéma produit
  --out <fichier>          Fichier de sortie (défaut : netschema-decouverte.json)
  --help                   Affiche cette aide

Le fichier produit s'ouvre dans NetSchema avec « Ouvrir… ».`

// ─── Arguments ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = { subnets: [], from: [], out: 'netschema-decouverte.json', title: 'Découverte réseau', community: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { help: true, ...options }
    else if (arg === '--subnet') options.subnets.push(argv[++i])
    else if (arg === '--snmp-community') options.community = argv[++i]
    else if (arg === '--title') options.title = argv[++i]
    else if (arg === '--out') options.out = argv[++i]
    else if (arg === '--from') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) options.from.push(argv[++i])
    } else if (arg.startsWith('--')) throw new Error(`Option inconnue : ${arg}`)
  }
  return options
}

// ─── Outils externes ─────────────────────────────────────────────────────────

function hasTool(name) {
  try {
    execFileSync('which', [name], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

// ─── Modèle ──────────────────────────────────────────────────────────────────

let counter = 0
const uid = (prefix) => `${prefix}_${(counter += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`

class Diagram {
  constructor(title) {
    this.title = title
    this.nodes = []
    this.links = []
    this.byName = new Map()
    this.byIp = new Map()
  }

  node(name, seed = {}) {
    const key = String(name).trim().toLowerCase()
    const existing = this.byName.get(key) ?? (seed.ip ? this.byIp.get(seed.ip) : undefined)
    if (existing) {
      for (const [field, value] of Object.entries(seed)) {
        if (value !== undefined && existing[field] === undefined) existing[field] = value
      }
      return existing
    }
    const node = { id: uid('n'), kind: seed.kind ?? 'server', name: String(name).trim(), x: 0, y: 0, ...seed }
    this.nodes.push(node)
    this.byName.set(key, node)
    if (node.ip) this.byIp.set(node.ip, node)
    return node
  }

  link(from, to, extra = {}) {
    if (from.id === to.id) return
    const signature = [from.id, to.id].sort().join('~')
    if (this.links.some((item) => [item.from, item.to].sort().join('~') === signature)) return
    this.links.push({ id: uid('l'), from: from.id, to: to.id, kind: 'ethernet', layers: ['l1', 'l2'], ...extra })
  }

  toFile() {
    return JSON.stringify(
      {
        version: 1,
        diagram: {
          title: this.title,
          nodes: this.nodes.map(({ id, kind, name, x, y, ...rest }) => ({ id, kind, name, x, y, ...rest })),
          links: this.links,
        },
      },
      null,
      2,
    )
  }
}

// ─── Déduction du type ───────────────────────────────────────────────────────

const PLATFORM_HINTS = [
  [/fortigate|palo\s?alto|checkpoint|asa\b|srx|pfsense|firewall/i, 'ngfw'],
  [/nexus|c9500|c9600/i, 'core-switch'],
  [/air-|aironet|access point|aruba ap/i, 'wifi7'],
  [/isr|asr\b|router|vedge/i, 'router'],
  [/catalyst|c9300|c2960|ex\d|switch|procurve/i, 'switch'],
  [/esxi|vmware|proxmox|hyper-?v/i, 'hypervisor'],
  [/netapp|unity|synology|qnap|storage/i, 'storage'],
  [/ups|smart-?ups|eaton/i, 'ups'],
  [/laserjet|printer/i, 'printer'],
]

const PORT_HINTS = [
  [[902, 5989], 'hypervisor'],
  [[9100, 515, 631], 'printer'],
  [[3389], 'workstation'],
  [[6443, 10250], 'k8s-cluster'],
  [[3260], 'storage'],
  [[389, 636, 88], 'idp'],
  [[161, 23], 'switch'],
]

function kindFrom(text = '', ports = []) {
  for (const [pattern, kind] of PLATFORM_HINTS) if (pattern.test(text)) return kind
  for (const [list, kind] of PORT_HINTS) if (list.some((port) => ports.includes(port))) return kind
  return ports.length > 0 ? 'server' : 'server'
}

// ─── Analyse des relevés ─────────────────────────────────────────────────────

/** nmap XML, sans dépendance : on lit les blocs <host> tels quels. */
export function parseNmapXml(xml, diagram) {
  for (const block of xml.split(/<host\b/).slice(1)) {
    if (!/<status[^>]*state="up"/.test(block)) continue
    const ip = block.match(/<address addr="([\d.]+)" addrtype="ipv4"/)?.[1]
    const vendor = block.match(/addrtype="mac"[^>]*vendor="([^"]+)"/)?.[1]
    const hostname = block.match(/<hostname name="([^"]+)"/)?.[1]
    const os = block.match(/<osmatch name="([^"]+)"/)?.[1]
    const ports = [...block.matchAll(/<port protocol="\w+" portid="(\d+)"><state state="open"/g)].map((m) => Number(m[1]))
    const services = [...block.matchAll(/<service name="([^"]+)"/g)].map((m) => m[1]).slice(0, 6)
    if (!ip && !hostname) continue
    diagram.node(hostname ?? ip, {
      kind: kindFrom([os, hostname, vendor].filter(Boolean).join(' '), ports),
      ip,
      vendor,
      model: os,
      notes: [services.length > 0 ? `Ports : ${services.join(', ')}` : null, 'Découvert par nmap'].filter(Boolean).join(' · '),
    })
  }
  return diagram
}

/** Voisinages LLDP/CDP en sortie « detail », ou table LLDP remontée par SNMP. */
export function parseLldp(text, diagram, localNameHint) {
  const localName = text.match(/^\s*([\w.-]+)\s*[#>]\s*sh(?:ow)?\b/im)?.[1] ?? localNameHint ?? 'Équipement local'
  const local = diagram.node(localName, { kind: 'switch' })
  const blocks = text.split(/\n-{3,}\n|\n(?=(?:Device ID:|Chassis id:|Local Intf:))/i)
  let found = 0

  for (const block of blocks) {
    const field = (...names) => {
      for (const name of names) {
        const match = block.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'im'))
        if (match) return match[1].trim().replace(/,$/, '')
      }
      return undefined
    }
    const remoteName = field('Device ID', 'System Name') ?? field('Chassis id')?.split(/\s/)[0]
    if (!remoteName || /^show\b/i.test(remoteName)) continue
    const platform = field('Platform', 'System Description')
    const ip = block.match(/\b(?:IP(?:v4)? address|IP)\s*:\s*([\d.]+)/i)?.[1]
    const remote = diagram.node(remoteName.replace(/\.(local|lan)$/i, ''), {
      kind: kindFrom(`${platform ?? ''} ${remoteName}`),
      ip,
      model: platform?.slice(0, 60),
      notes: 'Découvert par LLDP/CDP',
    })
    diagram.link(local, remote, {
      portA: field('Interface', 'Local Intf', 'Local Interface')?.split(',')[0],
      portB: field('Port ID \\(outgoing port\\)', 'Port id', 'Port ID'),
    })
    found += 1
  }
  return found
}

export function parseArp(text, diagram) {
  let found = 0
  for (const line of text.split(/\r?\n/)) {
    const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1]
    const mac = line.match(/\b((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|(?:[0-9a-f]{4}\.){2}[0-9a-f]{4})\b/i)?.[1]
    if (!ip || !mac) continue
    const vlan = line.match(/\bVlan\s*(\d+)/i)?.[1]
    diagram.node(ip, { ip, vlan: vlan ? `VLAN ${vlan}` : undefined, notes: `Découvert par ARP · ${mac}` })
    found += 1
  }
  return found
}

function detect(text) {
  if (/<nmaprun\b/i.test(text)) return 'nmap'
  if (/(Device ID:|Chassis id:|Local Intf:|System Name:)/i.test(text)) return 'lldp'
  if (/(Protocol\s+Address\s+Age|\bat\s+([0-9a-f]{2}[:-]){5})/i.test(text)) return 'arp'
  return 'inconnu'
}

// ─── Collecte ────────────────────────────────────────────────────────────────

function sweep(subnet, diagram) {
  if (!hasTool('nmap')) {
    console.warn(`  nmap absent : balayage de ${subnet} ignoré.`)
    return 0
  }
  console.log(`  Balayage de ${subnet}…`)
  const before = diagram.nodes.length
  parseNmapXml(run('nmap', ['-sn', '-oX', '-', subnet]), diagram)
  return diagram.nodes.length - before
}

function snmpDetails(diagram, community) {
  if (!hasTool('snmpwalk')) {
    console.warn('  snmpwalk absent : relevés SNMP ignorés.')
    return
  }
  for (const node of [...diagram.nodes]) {
    if (!node.ip) continue
    try {
      const sysName = run('snmpwalk', ['-v2c', '-c', community, '-Oqv', '-t', '1', '-r', '0', node.ip, '1.3.6.1.2.1.1.5.0'])
        .trim()
        .replace(/^"|"$/g, '')
      if (sysName && sysName !== node.name) node.name = sysName
      const sysDescr = run('snmpwalk', ['-v2c', '-c', community, '-Oqv', '-t', '1', '-r', '0', node.ip, '1.3.6.1.2.1.1.1.0'])
        .trim()
        .replace(/^"|"$/g, '')
      if (sysDescr) {
        node.model = node.model ?? sysDescr.slice(0, 60)
        node.kind = kindFrom(sysDescr) ?? node.kind
      }
      // Table LLDP distante : lldpRemSysName
      const neighbours = run('snmpwalk', ['-v2c', '-c', community, '-Oqv', '-t', '1', '-r', '0', node.ip, '1.0.8802.1.1.2.1.4.1.1.9'])
      for (const line of neighbours.split(/\r?\n/)) {
        const name = line.trim().replace(/^"|"$/g, '')
        if (!name) continue
        diagram.link(node, diagram.node(name, { kind: 'switch', notes: 'Découvert par LLDP (SNMP)' }))
      }
    } catch {
      // Hôte muet en SNMP : ce n'est pas une erreur de collecte.
    }
  }
}

// ─── Programme ───────────────────────────────────────────────────────────────

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }
  if (options.help || (options.subnets.length === 0 && options.from.length === 0)) {
    console.log(HELP)
    process.exit(options.help ? 0 : 1)
  }

  const diagram = new Diagram(options.title)

  for (const file of options.from) {
    const text = readFileSync(file, 'utf8')
    const format = detect(text)
    const hint = basename(file).replace(/\.[^.]+$/, '')
    let count = 0
    if (format === 'nmap') {
      const before = diagram.nodes.length
      parseNmapXml(text, diagram)
      count = diagram.nodes.length - before
    } else if (format === 'lldp') count = parseLldp(text, diagram, hint)
    else if (format === 'arp') count = parseArp(text, diagram)
    console.log(`  ${file} → ${format} (${count} entrée(s))`)
  }

  for (const subnet of options.subnets) sweep(subnet, diagram)
  if (options.community) snmpDetails(diagram, options.community)

  writeFileSync(options.out, diagram.toFile(), 'utf8')
  console.log(`\n${diagram.nodes.length} équipement(s) et ${diagram.links.length} liaison(s) → ${options.out}`)
  console.log('Ouvrez ce fichier dans NetSchema avec « Ouvrir… », puis lancez le placement automatique.')
}

if (import.meta.url === `file://${process.argv[1]}`) main()
