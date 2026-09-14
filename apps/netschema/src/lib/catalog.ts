import { BUILTIN_PACKS, FAMILY_ORDER, type CatalogPack, type DeviceDef } from './catalogData'
import type { HaRole, LinkKind } from '../types'

export interface DeviceMeta extends DeviceDef {
  /** Couleur de trait / pictogramme. */
  accent: string
  /** Couleur de fond de la boîte. */
  fill: string
  /** Vrai si le type n'existe dans aucun lot chargé (schéma venant d'un autre poste). */
  unknown?: boolean
  /** Lot d'origine. */
  packId?: string
}

/** Nom lisible de chaque couche, affiché en marge du schéma. */
export const LAYER_LABELS: Record<number, string> = {
  0: 'Internet / WAN',
  1: 'Périmètre',
  2: 'Sécurité',
  3: 'Cœur de réseau',
  4: 'Distribution',
  5: 'Accès',
  6: 'Serveurs & services',
  7: 'Postes & périphériques',
  8: 'Énergie & environnement',
}

const PALETTE: Record<number, { accent: string; fill: string }> = {
  0: { accent: '#475569', fill: '#f1f5f9' },
  1: { accent: '#7c3aed', fill: '#f5f3ff' },
  2: { accent: '#dc2626', fill: '#fef2f2' },
  3: { accent: '#2563eb', fill: '#eff6ff' },
  4: { accent: '#0891b2', fill: '#ecfeff' },
  5: { accent: '#059669', fill: '#ecfdf5' },
  6: { accent: '#d97706', fill: '#fffbeb' },
  7: { accent: '#64748b', fill: '#f8fafc' },
  8: { accent: '#a16207', fill: '#fefce8' },
}

const registry = new Map<string, DeviceMeta>()
const packs = new Map<string, CatalogPack>()

function metaOf(def: DeviceDef, packId: string): DeviceMeta {
  const colors = PALETTE[def.palette ?? def.rank] ?? PALETTE[6]
  return { ...def, ...colors, packId }
}

/**
 * Enregistre (ou remplace) un lot d'équipements. Appelé pour les lots embarqués, pour
 * ceux déposés dans `public/catalog/`, et pour ceux importés par l'utilisateur.
 */
export function registerPack(pack: CatalogPack) {
  packs.set(pack.id, pack)
  for (const def of pack.devices) registry.set(def.id, metaOf(def, pack.id))
}

export function removePack(packId: string) {
  const pack = packs.get(packId)
  if (!pack) return
  for (const def of pack.devices) {
    if (registry.get(def.id)?.packId === packId) registry.delete(def.id)
  }
  packs.delete(packId)
}

export function registeredPacks(): CatalogPack[] {
  return [...packs.values()]
}

for (const pack of BUILTIN_PACKS) registerPack(pack)

/** Type inconnu : le schéma reste lisible et modifiable, avec un pictogramme neutre. */
function unknownMeta(kind: string): DeviceMeta {
  return {
    id: kind,
    label: kind,
    rank: 6,
    icon: 'generic',
    family: 'Types inconnus',
    ...PALETTE[6],
    unknown: true,
  }
}

export function deviceMeta(kind: string): DeviceMeta {
  return registry.get(kind) ?? unknownMeta(kind)
}

export function hasDevice(kind: string): boolean {
  return registry.has(kind)
}

export function allDevices(): DeviceMeta[] {
  return [...registry.values()]
}

/** Palette : familles dans l'ordre déclaré, puis familles inconnues à la fin. */
export function familyGroups(): { title: string; devices: DeviceMeta[] }[] {
  const groups = new Map<string, DeviceMeta[]>()
  for (const device of registry.values()) {
    const group = groups.get(device.family)
    if (group) group.push(device)
    else groups.set(device.family, [device])
  }
  const ordered = [...groups.keys()].sort((a, b) => {
    const ia = FAMILY_ORDER.indexOf(a)
    const ib = FAMILY_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
  })
  return ordered.map((title) => ({
    title,
    devices: groups.get(title)!.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label)),
  }))
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Recherche d'un type d'équipement par nom, famille ou synonyme : « k8s », « fortigate »,
 * « pare-feu », « waf », « borne »… Les correspondances en début de mot passent devant.
 */
export function searchDevices(query: string): DeviceMeta[] {
  const q = normalize(query.trim())
  if (!q) return allDevices()
  const scored: { device: DeviceMeta; score: number }[] = []
  for (const device of registry.values()) {
    const haystacks = [device.label, device.id, device.family, ...(device.aliases ?? [])]
    let best = -1
    for (const raw of haystacks) {
      const value = normalize(raw)
      if (value === q) best = Math.max(best, 100)
      else if (value.startsWith(q)) best = Math.max(best, 80)
      else if (value.includes(q)) best = Math.max(best, 50)
    }
    if (best >= 0) scored.push({ device, score: best })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.device.label.localeCompare(b.device.label))
    .map((item) => item.device)
}

export function rankOf(kind: string, override?: number | null): number {
  return typeof override === 'number' ? override : deviceMeta(kind).rank
}

export interface LinkMeta {
  label: string
  color: string
  width: number
  dash?: string
  /**
   * Liaison de service : elle ne transporte pas le trafic principal (battement de cœur,
   * réplication, administration hors bande, alimentation) et ne compte donc pas comme
   * chemin redondant dans l'analyse de haute disponibilité.
   */
  service?: boolean
}

export const LINKS: Record<LinkKind, LinkMeta> = {
  ethernet: { label: 'Ethernet cuivre', color: '#475569', width: 2 },
  fiber: { label: 'Fibre optique', color: '#0891b2', width: 2.4 },
  trunk: { label: 'Trunk / agrégat LACP', color: '#2563eb', width: 3 },
  stack: { label: 'Stack / MLAG / VSS', color: '#7c3aed', width: 3.4 },
  wan: { label: 'Lien WAN / MPLS', color: '#6d28d9', width: 2.4 },
  vpn: { label: 'Tunnel VPN', color: '#dc2626', width: 2, dash: '7 5' },
  wireless: { label: 'Sans fil', color: '#059669', width: 2, dash: '2 5' },
  overlay: { label: 'Overlay VXLAN / SD-WAN', color: '#0d9488', width: 2.2, dash: '9 3 2 3' },
  heartbeat: { label: 'Battement de cœur (HA)', color: '#db2777', width: 1.8, dash: '3 4', service: true },
  replication: { label: 'Réplication / synchronisation', color: '#ea580c', width: 2.2, dash: '10 4', service: true },
  oob: { label: 'Administration hors bande', color: '#94a3b8', width: 1.4, dash: '2 4', service: true },
  power: { label: 'Alimentation électrique', color: '#a16207', width: 1.8, dash: '6 3', service: true },
}

export interface RoleMeta {
  label: string
  badge: string
  color: string
}

/** Conventions de rôle reprises des architectures HA courantes (VRRP/HSRP, cluster A/P, quorum). */
export const ROLES: Record<HaRole, RoleMeta> = {
  standalone: { label: 'Autonome (hors grappe)', badge: '', color: '#94a3b8' },
  active: { label: 'Actif (maître)', badge: 'ACTIF', color: '#059669' },
  passive: { label: 'Passif (secours)', badge: 'PASSIF', color: '#64748b' },
  'active-active': { label: 'Actif / actif', badge: 'A/A', color: '#2563eb' },
  witness: { label: 'Témoin / quorum', badge: 'QUORUM', color: '#a16207' },
}
