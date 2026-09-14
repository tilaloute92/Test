import type { DeviceKind, HaRole, LinkKind } from '../types'

export interface DeviceMeta {
  label: string
  /** Couche par défaut : c'est elle qui pilote le placement automatique. */
  rank: number
  /** Couleur de trait / pictogramme. */
  accent: string
  /** Couleur de fond de la boîte. */
  fill: string
  /**
   * Équipement d'infrastructure : c'est sur ces équipements que porte l'analyse de
   * haute disponibilité (un poste de travail non redondé n'est pas un défaut).
   */
  infrastructure?: boolean
  /** Équipement dont la panne coupe le service s'il n'a pas de pair : contrôlé plus sévèrement. */
  critical?: boolean
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
  8: 'Énergie & alimentation',
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

function device(label: string, rank: number, flags: Partial<DeviceMeta> = {}): DeviceMeta {
  return { label, rank, ...PALETTE[rank], ...flags }
}

export const DEVICES: Record<DeviceKind, DeviceMeta> = {
  internet: device('Internet', 0, { infrastructure: true }),
  cloud: device('Cloud / SaaS', 0, { infrastructure: true }),
  wan: device('Lien opérateur', 0, { infrastructure: true, critical: true }),
  router: device('Routeur', 1, { infrastructure: true, critical: true }),
  firewall: device('Pare-feu', 2, { infrastructure: true, critical: true }),
  loadbalancer: device('Répartiteur de charge', 2, { infrastructure: true, critical: true }),
  'core-switch': device('Switch cœur', 3, { infrastructure: true, critical: true }),
  switch: device('Switch distribution', 4, { infrastructure: true, critical: true }),
  'access-switch': device('Switch accès', 5, { infrastructure: true }),
  wifi: device('Borne Wi-Fi', 5, { infrastructure: true }),
  server: device('Serveur', 6),
  hypervisor: device('Nœud hyperviseur', 6, { critical: true }),
  storage: device('Baie de stockage', 6, { critical: true }),
  backup: device('Serveur de sauvegarde', 6),
  witness: device('Témoin de quorum', 6),
  workstation: device('Poste de travail', 7),
  printer: device('Imprimante', 7),
  phone: device('Téléphone IP', 7),
  ups: device('Onduleur', 8, { critical: true }),
  pdu: device('Bandeau PDU', 8),
}

/** Ordre d'affichage de la palette, regroupé par famille. */
export const PALETTE_GROUPS: { title: string; kinds: DeviceKind[] }[] = [
  { title: 'Extérieur', kinds: ['internet', 'cloud', 'wan'] },
  { title: 'Périmètre & sécurité', kinds: ['router', 'firewall', 'loadbalancer'] },
  { title: 'Commutation', kinds: ['core-switch', 'switch', 'access-switch', 'wifi'] },
  { title: 'Datacenter', kinds: ['server', 'hypervisor', 'storage', 'backup', 'witness'] },
  { title: 'Utilisateurs', kinds: ['workstation', 'printer', 'phone'] },
  { title: 'Énergie', kinds: ['ups', 'pdu'] },
]

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

export function deviceMeta(kind: DeviceKind): DeviceMeta {
  return DEVICES[kind] ?? DEVICES.server
}

export function rankOf(kind: DeviceKind, override?: number | null): number {
  return typeof override === 'number' ? override : deviceMeta(kind).rank
}
