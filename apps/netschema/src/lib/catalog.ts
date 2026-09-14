import type { DeviceKind, LinkKind } from '../types'

export interface DeviceMeta {
  label: string
  /** Couche par défaut : c'est elle qui pilote le placement automatique. */
  rank: number
  /** Couleur de trait / pictogramme. */
  accent: string
  /** Couleur de fond de la boîte. */
  fill: string
}

/** Nom lisible de chaque couche, affiché en marge du schéma. */
export const LAYER_LABELS: Record<number, string> = {
  0: 'Internet / WAN',
  1: 'Périmètre',
  2: 'Sécurité',
  3: 'Cœur de réseau',
  4: 'Distribution',
  5: 'Accès',
  6: 'Serveurs & stockage',
  7: 'Postes & périphériques',
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
}

function device(label: string, rank: number): DeviceMeta {
  return { label, rank, ...PALETTE[rank] }
}

export const DEVICES: Record<DeviceKind, DeviceMeta> = {
  internet: device('Internet', 0),
  cloud: device('Cloud / SaaS', 0),
  wan: device('Lien opérateur', 0),
  router: device('Routeur', 1),
  firewall: device('Pare-feu', 2),
  loadbalancer: device('Répartiteur de charge', 2),
  'core-switch': device('Switch cœur', 3),
  switch: device('Switch distribution', 4),
  'access-switch': device('Switch accès', 5),
  wifi: device('Borne Wi-Fi', 5),
  server: device('Serveur', 6),
  storage: device('Baie de stockage', 6),
  workstation: device('Poste de travail', 7),
  printer: device('Imprimante', 7),
  phone: device('Téléphone IP', 7),
}

/** Ordre d'affichage de la palette, regroupé par couche. */
export const PALETTE_GROUPS: { title: string; kinds: DeviceKind[] }[] = [
  { title: 'Extérieur', kinds: ['internet', 'cloud', 'wan'] },
  { title: 'Périmètre & sécurité', kinds: ['router', 'firewall', 'loadbalancer'] },
  { title: 'Commutation', kinds: ['core-switch', 'switch', 'access-switch', 'wifi'] },
  { title: 'Datacenter', kinds: ['server', 'storage'] },
  { title: 'Utilisateurs', kinds: ['workstation', 'printer', 'phone'] },
]

export interface LinkMeta {
  label: string
  color: string
  width: number
  dash?: string
}

export const LINKS: Record<LinkKind, LinkMeta> = {
  ethernet: { label: 'Ethernet cuivre', color: '#475569', width: 2 },
  fiber: { label: 'Fibre optique', color: '#0891b2', width: 2.4 },
  trunk: { label: 'Trunk / agrégat', color: '#2563eb', width: 3 },
  wan: { label: 'Lien WAN / MPLS', color: '#7c3aed', width: 2.4 },
  vpn: { label: 'Tunnel VPN', color: '#dc2626', width: 2, dash: '7 5' },
  wireless: { label: 'Sans fil', color: '#059669', width: 2, dash: '2 5' },
}

export function deviceMeta(kind: DeviceKind): DeviceMeta {
  return DEVICES[kind] ?? DEVICES.server
}

export function rankOf(kind: DeviceKind, override?: number | null): number {
  return typeof override === 'number' ? override : deviceMeta(kind).rank
}
