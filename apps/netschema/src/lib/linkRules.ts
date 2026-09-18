import { deviceMeta, rankOf } from './catalog'
import type { LinkKind, NetNode } from '../types'

const SWITCHES = new Set(['core-switch', 'switch', 'access-switch', 'spine', 'leaf', 'industrial-switch'])
const POWER = new Set(['ups', 'pdu', 'generator', 'cooling'])
const STORAGE = new Set(['storage', 'nvme-storage', 'object-storage', 'backup', 'tape-backup', 'managed-db'])
const MANAGEMENT = new Set(['bastion', 'nms', 'siem', 'pam', 'vuln-scanner', 'console-server'])
/** Ce qui ne se raccorde qu'en optique : SAN Fibre Channel, transport DWDM, conversion. */
const OPTIQUE = new Set(['san-switch', 'dwdm', 'media-converter'])
const OVERLAY = new Set(['sdwan', 'sase-pop', 'cloud-interconnect', 'vpc', 'cloud-region'])

/**
 * Type de liaison proposé automatiquement à la création, d'après les deux équipements
 * reliés. On évite ainsi le réflexe « tout en Ethernet » : deux pare-feu d'une même
 * grappe se relient par un battement de cœur, deux switches cœur par un lien de pile,
 * un onduleur par une liaison électrique.
 *
 * C'est une proposition : le type reste modifiable dans l'inspecteur.
 */
export function suggestLinkKind(a: NetNode, b: NetNode): LinkKind {
  const kinds = [a.kind, b.kind]
  const sameCluster = !!a.cluster?.trim() && a.cluster?.trim() === b.cluster?.trim()

  if (kinds.some((kind) => POWER.has(kind))) return 'power'
  if (sameCluster) return kinds.every((kind) => SWITCHES.has(kind)) ? 'stack' : 'heartbeat'
  if (kinds.every((kind) => STORAGE.has(kind))) return 'replication'
  if (kinds.some((kind) => MANAGEMENT.has(kind))) return 'oob'
  if (kinds.some((kind) => OPTIQUE.has(kind))) return 'fiber'
  if (kinds.some((kind) => OVERLAY.has(kind))) return 'overlay'

  const rankA = rankOf(a.kind, a.rank)
  const rankB = rankOf(b.kind, b.rank)
  if (rankA === 0 || rankB === 0) return 'wan'
  if (kinds.some((kind) => kind === 'wifi' || kind === 'wifi7')) return 'ethernet'

  const infra = deviceMeta(a.kind).infrastructure && deviceMeta(b.kind).infrastructure
  const backbone = Math.min(rankA, rankB) <= 4
  if (infra && backbone) return 'fiber'
  if (Math.max(rankA, rankB) >= 6 && Math.min(rankA, rankB) <= 4) return 'trunk'
  return 'ethernet'
}
