import { BUILTIN_PACKS, FAMILY_ORDER, type CatalogPack, type DeviceDef } from './catalogData'
import { PALETTE } from './palette'
import { bestMatch } from './speech'
import { registerModels } from './vendors'
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
  if (pack.models) registerModels(pack.models)
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
    // « cœur » et « coeur » doivent se correspondre : la dictée ne produit jamais la ligature.
    .replace(/[œŒ]/g, 'oe')
    .replace(/[æÆ]/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Recherche d'un type d'équipement par nom, famille ou synonyme : « k8s », « fortigate »,
 * « pare-feu », « waf », « bornes wifi »… Les correspondances en début de mot passent devant.
 */
export function searchDevices(query: string): DeviceMeta[] {
  const base = normalize(query.trim())
  if (!base) return allDevices()

  // La dictée met volontiers les types au pluriel (« tous les postes de travail ») et
  // écrit « wifi » là où le catalogue dit « Wi-Fi ». Chaque tentative applique la même
  // transformation des deux côtés, sinon les troncatures ne se correspondent plus.
  const attempts: ((value: string) => string)[] = [
    (value) => value,
    depluralize,
    (value) => compactForm(depluralize(value)),
  ]

  for (const transform of attempts) {
    const found = scoreDevices(transform(base), transform)
    if (found.length > 0) return found
  }

  return []
}

/**
 * Recherche tolérante : la recherche stricte d'abord, puis le type le plus proche au sens
 * de la distance d'édition. Réservée à la dictée, où « pare-fou » doit tomber sur
 * « Pare-feu » — la palette, elle, s'en tient à la recherche stricte.
 */
export function findDevice(query: string): DeviceMeta | undefined {
  return findDeviceScored(query)?.device
}

/**
 * Mots de tous les jours, ramenés au vocabulaire du catalogue.
 *
 * Le catalogue dit « Switch » et « Borne Wi-Fi » ; on dit aussi « commutateur » et « point
 * d'accès ». Ces équivalences sont écrites une fois ici, plutôt que répétées en synonymes
 * sur chaque type — où « commutateur », porté par trois switchs, ne désignait plus personne.
 */
const MOTS_COURANTS: [RegExp, string][] = [
  [/\bcommutateurs?\b/g, 'switch'],
  [/\bpoints? d'acces(?: wi-?fi| sans fil| radio)?\b/g, 'borne wifi'],
  [/\b(?:ordinateurs?|pc)(?: portables?| fixes?| de bureau)?\b|\bportables?\b|\bpostes? (?:fixes?|clients?|utilisateurs?|bureautiques?)\b/g, 'poste de travail'],
  [/\bmachines? virtuelles?\b/g, 'serveur'],
  [/\bcontroleurs? (?:de )?domaine\b|\bactive directory\b/g, 'annuaire'],
  [/\btelephones?(?! ip)(?: fixes?)?\b/g, 'telephone ip'],
  [/\bserveurs? (?:de )?supervision\b/g, 'supervision'],
  [/\bserveurs? (?:dns|dhcp)\b/g, 'dns'],
  [/\bcameras? de (?:surveillance|videosurveillance)\b/g, 'camera ip'],
]

function vocabulaireCourant(valeur: string): string {
  let texte = valeur.replace(/[’]/g, "'")
  for (const [motif, remplacement] of MOTS_COURANTS) texte = texte.replace(motif, remplacement)
  return texte.replace(/\s+/g, ' ').trim()
}

/** Mots qui ne désignent rien : ils ne comptent ni pour ni contre un rapprochement. */
const MOTS_VIDES = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'et', 'a', 'au', 'aux', 'en', 'un', 'une', 'pour'])

/** Mots significatifs d'un libellé ou d'une demande, sans pluriel ni ponctuation. */
function motsSignificatifs(valeur: string): string[] {
  return normalize(valeur)
    .replace(/[’']/g, ' ')
    .split(/[\s/(),]+/)
    .map((mot) => compactForm(depluralize(mot)))
    .filter((mot) => mot.length > 0 && !MOTS_VIDES.has(mot))
}

/**
 * Deux mots sont-ils le même ? Égaux, ou l'un prolonge l'autre de peu.
 *
 * La limite est ce qui compte : « automate » n'est pas « automatisation », « ca » n'est pas
 * « caméra », « ap » n'est pas « application ». Un préfixe ne vaut le mot que s'il en couvre
 * les trois quarts.
 */
function memeMot(a: string, b: string): boolean {
  if (a === b) return true
  const [court, long] = a.length <= b.length ? [a, b] : [b, a]
  return court.length >= 4 && long.startsWith(court) && court.length / long.length >= 0.75
}

/** Comparaison critère par critère : le premier qui diffère décide. */
function devance(a: number[], b: number[]): boolean {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }
  return false
}

/**
 * Type d'équipement désigné par des mots dictés, avec la solidité de la reconnaissance.
 *
 * Quatre niveaux, du plus sûr au moins sûr :
 *  - 1    : la demande est exactement un libellé, un identifiant ou un synonyme ;
 *  - 0,95 : tous ses mots se retrouvent dans le type (« switch d'accès », « baie SAN ») ;
 *  - 0,8  : son premier mot — le nom, en français — est celui du type, le reste le qualifie
 *           (« serveur web », « routeur de périmètre ») ;
 *  - moins : un mot écorché par la reconnaissance, à une lettre près (« pare-fou »).
 *
 * En dessous, rien : mieux vaut dire qu'on n'a pas compris que créer un équipement qui
 * ressemble de loin. La recherche de la palette (`searchDevices`) reste, elle, une recherche
 * au fil de la frappe : elle propose, elle ne décide pas.
 */
export function findDeviceScored(query: string): { device: DeviceMeta; score: number } | undefined {
  const base = vocabulaireCourant(normalize(query.trim()))
  if (!base) return undefined
  const devices = allDevices().filter((device) => !device.unknown)

  // 1. Exactement un libellé, un identifiant ou un synonyme.
  const formes: ((value: string) => string)[] = [
    (value) => value,
    depluralize,
    (value) => compactForm(depluralize(value)),
  ]
  for (const forme of formes) {
    const cherche = forme(base)
    if (!cherche) continue
    let exact: { device: DeviceMeta; rang: number } | undefined
    for (const device of devices) {
      const libelle = forme(normalize(device.label))
      const textes = [device.label, device.id, ...(device.aliases ?? [])]
      textes.forEach((texte, index) => {
        if (forme(normalize(texte)) !== cherche) return
        // Un mot partagé par plusieurs types (« poste », « borne », « san ») désigne d'abord
        // celui dont c'est le nom, puis le plus général — le libellé le plus court.
        const rang = (index === 0 ? 0 : index === 1 ? 1000 : libelle.startsWith(cherche) ? 2000 : 3000) + device.label.length
        if (!exact || rang < exact.rang) exact = { device, rang }
      })
    }
    if (exact) return { device: (exact as { device: DeviceMeta }).device, score: 1 }
  }

  // 2 et 3. Mot à mot.
  const demande = motsSignificatifs(base)
  if (demande.length > 0) {
    let meilleur: { device: DeviceMeta; cle: number[] } | undefined
    for (const device of devices) {
      const libelle = motsSignificatifs(device.label)
      const sac = [...libelle, ...motsSignificatifs(device.id.replace(/-/g, ' ')), ...(device.aliases ?? []).flatMap(motsSignificatifs)]
      const couverts = demande.filter((mot) => sac.some((autre) => memeMot(mot, autre))).length
      if (couverts === 0) continue
      const complet = couverts === demande.length
      const tete = libelle.some((mot) => memeMot(mot, demande[0]))
      if (!complet && !(tete && demande.length >= 2)) continue
      const dansLibelle = demande.filter((mot) => libelle.some((autre) => memeMot(mot, autre))).length
      // Départage : tout couvert d'abord, puis le nom en tête, puis le libellé qui reprend le
      // plus de mots (« switch cœur » pour « switches cœur en MLAG »), puis le type qui *est*
      // ce nom (« switch » pour « switch industriel »), puis le libellé le moins débordant.
      const estLeNom = device.id === demande[0] || (libelle.length === 1 && memeMot(libelle[0], demande[0]))
      const cle = [complet ? 1 : 0, tete ? 1 : 0, dansLibelle, estLeNom ? 1 : 0, -(libelle.length - dansLibelle)]
      if (!meilleur || devance(cle, meilleur.cle)) meilleur = { device, cle }
    }
    if (meilleur) return { device: meilleur.device, score: meilleur.cle[0] === 1 ? 0.95 : 0.8 }
  }

  // 4. Un mot écorché : à une lettre près sur un mot long, pas davantage.
  if (compactForm(base).length < 5) return undefined
  const candidates = devices.flatMap((device) =>
    [device.label, ...(device.aliases ?? [])].map((text) => ({ device, text })),
  )
  const found = bestMatch(base, candidates, (item) => item.text)
  return found && found.score >= 0.84 ? { device: found.item.device, score: found.score } : undefined
}

/**
 * Racine approximative d'un mot : on retire le pluriel puis le « e » final. Appliquée des
 * deux côtés, elle fait correspondre « postes » à « poste », « switches » à « switch » et
 * « téléphones » à « téléphone » sans dictionnaire.
 */
function depluralize(value: string): string {
  return value
    .split(' ')
    .map((word) => (word.length > 3 ? word.replace(/s$/, '').replace(/e$/, '') : word))
    .join(' ')
    .trim()
}

/** Forme compacte : ni espaces, ni tirets, ni points (« wi-fi » et « wifi » se rejoignent). */
function compactForm(value: string): string {
  return value.replace(/[^a-z0-9]/g, '')
}

function scoreDevices(query: string, transform: (value: string) => string): DeviceMeta[] {
  if (!query) return []
  const scored: { device: DeviceMeta; score: number }[] = []
  for (const device of registry.values()) {
    const haystacks = [device.label, device.id, device.family, ...(device.aliases ?? [])]
    let best = -1
    for (const raw of haystacks) {
      const value = transform(normalize(raw))
      if (!value) continue
      if (value === query) best = Math.max(best, 100)
      else if (value.startsWith(query)) best = Math.max(best, 80)
      else if (value.includes(query)) best = Math.max(best, 50)
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
