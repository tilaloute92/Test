import { hasDevice, LINKS, searchDevices } from './catalog'
import { uid } from './ids'
import { suggestLinkKind } from './linkRules'
import type { Diagram, HaRole, LinkKind, NetLink, NetNode } from '../types'

export interface ImportResult {
  /** Équipements créés par l'import. */
  nodes: NetNode[]
  /** Copies modifiées d'équipements déjà présents (jamais mutés sur place). */
  updates: NetNode[]
  links: NetLink[]
  warnings: string[]
}

const ROLE_WORDS: Record<string, HaRole> = {
  actif: 'active',
  active: 'active',
  maitre: 'active',
  passif: 'passive',
  passive: 'passive',
  secours: 'passive',
  'actif-actif': 'active-active',
  'active-active': 'active-active',
  aa: 'active-active',
  temoin: 'witness',
  quorum: 'witness',
  witness: 'witness',
}

const LINK_WORDS: Record<string, LinkKind> = {
  cuivre: 'ethernet',
  ethernet: 'ethernet',
  rj45: 'ethernet',
  fibre: 'fiber',
  fiber: 'fiber',
  optique: 'fiber',
  trunk: 'trunk',
  lacp: 'trunk',
  agregat: 'trunk',
  stack: 'stack',
  mlag: 'stack',
  vss: 'stack',
  wan: 'wan',
  mpls: 'wan',
  vpn: 'vpn',
  tunnel: 'vpn',
  wifi: 'wireless',
  'sans-fil': 'wireless',
  overlay: 'overlay',
  vxlan: 'overlay',
  sdwan: 'overlay',
  heartbeat: 'heartbeat',
  ha: 'heartbeat',
  battement: 'heartbeat',
  replication: 'replication',
  synchro: 'replication',
  oob: 'oob',
  admin: 'oob',
  power: 'power',
  elec: 'power',
  alim: 'power',
}

const STP_WORDS: Record<string, 'root' | 'designated' | 'alternate' | 'blocking' | 'edge'> = {
  root: 'root',
  racine: 'root',
  designated: 'designated',
  designe: 'designated',
  alternate: 'alternate',
  alternatif: 'alternate',
  blocking: 'blocking',
  bloquant: 'blocking',
  edge: 'edge',
}

const ROUTING_WORDS: Record<string, 'static' | 'ospf' | 'bgp' | 'eigrp' | 'is-is' | 'rip'> = {
  static: 'static',
  statique: 'static',
  ospf: 'ospf',
  bgp: 'bgp',
  eigrp: 'eigrp',
  isis: 'is-is',
  'is-is': 'is-is',
  rip: 'rip',
}

const NAME_HINTS: { pattern: RegExp; kind: string }[] = [
  { pattern: /^(wlc|ctrl-?wifi|controleur|contrôleur)/i, kind: 'wlan-controller' },
  { pattern: /^(fc|sw-?fc|sansw)/i, kind: 'san-switch' },
  { pattern: /^(pp|patch|brassage)/i, kind: 'patch-panel' },
  { pattern: /^(ipbx|pbx)/i, kind: 'ipbx' },
  { pattern: /^(fw|pare-?feu|ngfw)/i, kind: 'firewall' },
  { pattern: /^(rtr|rout)/i, kind: 'router' },
  { pattern: /^(sw-?core|core)/i, kind: 'core-switch' },
  { pattern: /^(sw-?dist|dist)/i, kind: 'switch' },
  { pattern: /^(sw-?acc|acc)/i, kind: 'access-switch' },
  { pattern: /^(sw|switch)/i, kind: 'switch' },
  { pattern: /^(spine)/i, kind: 'spine' },
  { pattern: /^(leaf|tor)/i, kind: 'leaf' },
  { pattern: /^(ap|wifi|borne)/i, kind: 'wifi7' },
  { pattern: /^(lb|vip)/i, kind: 'loadbalancer' },
  { pattern: /^(esxi|hv|hyper)/i, kind: 'hypervisor' },
  { pattern: /^(san|nas|baie)/i, kind: 'storage' },
  { pattern: /^(bkp|backup|sauv)/i, kind: 'backup' },
  { pattern: /^(k8s|kube)/i, kind: 'k8s-cluster' },
  { pattern: /^(pc|poste)/i, kind: 'workstation' },
  { pattern: /^(ups|onduleur)/i, kind: 'ups' },
]

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
}

/** Devine le type d'un équipement d'après son nom, à la façon des conventions de nommage. */
export function guessKind(name: string): string {
  for (const hint of NAME_HINTS) if (hint.pattern.test(name.trim())) return hint.kind
  return 'server'
}

function resolveKind(raw: string | undefined, name: string): { kind: string; guessed: boolean } {
  if (!raw || !raw.trim()) return { kind: guessKind(name), guessed: true }
  const value = raw.trim()
  if (hasDevice(value)) return { kind: value, guessed: false }
  const found = searchDevices(value)[0]
  if (found) return { kind: found.id, guessed: false }
  return { kind: guessKind(name), guessed: true }
}

/**
 * Import rapide par collage de texte : une ligne par équipement, une ligne par liaison.
 *
 *   SW-CORE-01 ; switch cœur ; ip=10.10.0.11 ; zone=Datacenter ; cluster=CORE-MLAG ; role=actif
 *   FW-01 -> SW-CORE-01 : fibre 10 Gb/s
 *   FW-02 -> SW-CORE-02 : fibre ! secours
 *
 * Le type accepte l'identifiant, le libellé ou un synonyme (« k8s », « waf », « pare-feu ») ;
 * s'il est absent, il est deviné d'après le nom. Un équipement cité dans une liaison sans
 * avoir été déclaré est créé automatiquement.
 */
export function parseQuickImport(text: string, existing?: Diagram): ImportResult {
  const warnings: string[] = []
  const nodes: NetNode[] = []
  const links: NetLink[] = []

  // Un équipement déjà présent est retrouvé par son nom : réimporter une liste enrichie
  // met à jour les fiches au lieu de créer des doublons. On travaille sur des copies,
  // pour ne jamais modifier le schéma courant sous les pieds de l'historique.
  const knownByName = new Map<string, NetNode>()
  for (const node of existing?.nodes ?? []) knownByName.set(normalize(node.name), node)
  const working = new Map<string, NetNode>()
  const updates = new Map<string, NetNode>()

  const ensureNode = (rawName: string, kind?: string): NetNode => {
    const name = rawName.trim()
    const key = normalize(name)
    const active = working.get(key)
    if (active) return active
    const known = knownByName.get(key)
    if (known) {
      const copy = { ...known }
      working.set(key, copy)
      updates.set(copy.id, copy)
      return copy
    }
    const resolved = resolveKind(kind, name)
    const node: NetNode = { id: uid('n'), kind: resolved.kind, name, x: 0, y: 0 }
    working.set(key, node)
    nodes.push(node)
    return node
  }

  const existingPairs = new Set(
    (existing?.links ?? []).map((link) => [link.from, link.to].sort().join('~') + `|${link.kind}`),
  )

  const lines = text.split(/\r?\n/)
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const where = `ligne ${index + 1}`

    const linkMatch = line.match(/^(.+?)\s*(?:->|-->|--|→)\s*([^:]+)(?::(.*))?$/)
    if (linkMatch) {
      const from = ensureNode(linkMatch[1])
      const to = ensureNode(linkMatch[2])
      if (from.id === to.id) {
        warnings.push(`${where} : une liaison ne peut pas boucler sur le même équipement.`)
        continue
      }
      const rest = (linkMatch[3] ?? '').trim()
      let kind: LinkKind | undefined
      const labelWords: string[] = []
      let redundant = false
      const extra: Partial<NetLink> = {}
      for (const word of rest.split(/\s+/).filter(Boolean)) {
        // Champs de niveau 1/2/3 : vlans=10,20 mode=trunk mtu=9000 lag=Po1 subnet=10.0.0.0/30
        const pair = word.match(/^([a-zA-Zé]+)=(.+)$/)
        if (pair) {
          const field = normalize(pair[1])
          const value = pair[2]
          if (field === 'vlan' || field === 'vlans') extra.vlans = value
          else if (field === 'mode') extra.mode = normalize(value) === 'trunk' ? 'trunk' : 'access'
          else if (field === 'natif' || field === 'native') extra.nativeVlan = value
          else if (field === 'lag' || field === 'po' || field === 'agregat') extra.lag = value
          else if (field === 'mtu') extra.mtu = Number(value) || undefined
          else if (field === 'stp') extra.stp = STP_WORDS[normalize(value)]
          else if (field === 'subnet' || field === 'reseau' || field === 'sousreseau') extra.subnet = value
          else if (field === 'ipa') extra.ipA = value
          else if (field === 'ipb') extra.ipB = value
          else if (field === 'vrf') extra.vrf = value
          else if (field === 'routage' || field === 'routing') extra.routing = ROUTING_WORDS[normalize(value)]
          else if (field === 'porta') extra.portA = value
          else if (field === 'portb') extra.portB = value
          else if (field === 'debit' || field === 'speed') extra.speed = value
          else warnings.push(`${where} : champ « ${pair[1]} » ignoré.`)
          continue
        }
        const token = normalize(word.replace(/^!/, ''))
        if (word.startsWith('!') || token === 'secours' || token === 'backup') {
          redundant = true
          if (token === 'secours' || token === 'backup') continue
        }
        if (!kind && token in LINK_WORDS) kind = LINK_WORDS[token]
        else if (token in LINKS) kind = token as LinkKind
        else labelWords.push(word)
      }
      const resolvedKind = kind ?? suggestLinkKind(from, to)
      const signature = [from.id, to.id].sort().join('~') + `|${resolvedKind}`
      if (existingPairs.has(signature)) continue
      existingPairs.add(signature)
      links.push({
        id: uid('l'),
        from: from.id,
        to: to.id,
        kind: resolvedKind,
        label: labelWords.join(' ') || undefined,
        redundant: redundant || undefined,
        ...extra,
      })
      continue
    }

    const parts = line.split(/\s*;\s*/)
    const name = parts[0]?.trim()
    if (!name) continue
    const typeField = parts[1] && !parts[1].includes('=') ? parts[1] : undefined
    const node = ensureNode(name, typeField)
    if (typeField) {
      const resolved = resolveKind(typeField, name)
      if (resolved.guessed) {
        warnings.push(`${where} : type « ${typeField.trim()} » inconnu, « ${resolved.kind} » utilisé.`)
      }
      node.kind = resolved.kind
    }

    for (const part of parts.slice(typeField ? 2 : 1)) {
      const [rawKey, ...valueParts] = part.split('=')
      const key = normalize(rawKey ?? '')
      const value = valueParts.join('=').trim()
      if (!value) continue
      switch (key) {
        case 'ip':
          node.ip = value
          break
        case 'vlan':
          node.vlan = value
          break
        case 'zone':
          node.zone = value
          break
        case 'site':
          node.site = value
          break
        case 'cluster':
        case 'grappe':
          node.cluster = value
          break
        case 'vip':
          node.vip = value
          break
        case 'modele':
        case 'model':
          node.model = value
          break
        case 'role':
          node.role = ROLE_WORDS[normalize(value)] ?? undefined
          if (!node.role) warnings.push(`${where} : rôle « ${value} » inconnu.`)
          break
        case 'alim':
        case 'power':
          node.dualPower = /^(oui|yes|ab|a\/b|true|1)$/i.test(value)
          break
        case 'note':
        case 'notes':
          node.notes = value
          break
        default:
          warnings.push(`${where} : champ « ${rawKey?.trim()} » ignoré.`)
      }
    }
  }

  return { nodes, updates: [...updates.values()], links, warnings }
}

export const QUICK_IMPORT_EXAMPLE = `# Équipements : nom ; type ; champs=valeur
RTR-EDGE-01 ; routeur ; ip=192.168.0.1 ; site=Siège ; zone=DMZ ; cluster=EDGE-VRRP ; role=actif ; vip=192.168.0.254
RTR-EDGE-02 ; routeur ; ip=192.168.0.2 ; site=Siège ; zone=DMZ ; cluster=EDGE-VRRP ; role=passif ; vip=192.168.0.254
FW-01 ; ngfw ; site=Siège ; zone=DMZ ; cluster=FW-HA ; role=actif ; alim=oui
SW-CORE-01 ; switch cœur ; site=Siège ; zone=Datacenter ; cluster=CORE-MLAG ; role=aa
K8S-PROD ; k8s ; site=Siège ; zone=Datacenter

# Liaisons : A -> B : type libellé (! = liaison de secours)
RTR-EDGE-01 -> FW-01 : fibre 10 Gb/s
RTR-EDGE-02 -> FW-01 : fibre !
FW-01 -> SW-CORE-01 : fibre
SW-CORE-01 -> K8S-PROD : trunk vlans=100,110 mtu=9000 lag=Po1
FW-01 -> SW-CORE-01 : subnet=10.0.0.0/30 ipa=10.0.0.1 ipb=10.0.0.2 routage=ospf`
