import { registerPack, registeredPacks, removePack } from './catalog'
import { BUILTIN_CATALOG_VERSION, BUILTIN_PACKS, type CatalogPack, type DeviceDef } from './catalogData'
import { hasIcon } from './icons'
import type { HardwareModel } from './vendors'

const SOURCE_KEY = 'netschema:catalog-source'
const USER_PACKS_KEY = 'netschema:catalog-user-packs'
const CUSTOM_PACK_ID = 'perso'

export interface LoadedPack {
  id: string
  title: string
  version: string
  count: number
  origin: 'embarqué' | 'déposé' | 'distant' | 'local'
}

export interface CatalogReport {
  version: string
  packs: LoadedPack[]
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Relit un lot venant d'un fichier ou d'une URL sans lui faire confiance : tout champ
 * inconnu est ignoré, un pictogramme absent retombe sur l'icône neutre, une couche
 * aberrante est ramenée dans les bornes.
 */
export function parsePack(raw: unknown): CatalogPack {
  if (!isRecord(raw)) throw new Error("Ce fichier n'est pas un lot de catalogue.")
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : ''
  if (!id) throw new Error("Le lot n'a pas d'identifiant.")
  const devicesRaw = Array.isArray(raw.devices) ? raw.devices : []
  const devices: DeviceDef[] = []
  for (const item of devicesRaw) {
    if (!isRecord(item)) continue
    const deviceId = typeof item.id === 'string' ? item.id.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    if (!deviceId || !label) continue
    const icon = typeof item.icon === 'string' && hasIcon(item.icon) ? item.icon : 'generic'
    const rank = Number.isFinite(item.rank) ? Math.max(0, Math.min(8, Math.round(Number(item.rank)))) : 6
    devices.push({
      id: deviceId,
      label,
      rank,
      icon,
      family: typeof item.family === 'string' && item.family.trim() ? item.family.trim() : 'Autres',
      palette: Number.isFinite(item.palette) ? Math.max(0, Math.min(8, Number(item.palette))) : undefined,
      aliases: Array.isArray(item.aliases) ? item.aliases.filter((a): a is string => typeof a === 'string') : undefined,
      infrastructure: item.infrastructure === true,
      critical: item.critical === true,
    })
  }
  if (devices.length === 0) throw new Error('Ce lot ne contient aucun type d’équipement valide.')

  // Un lot peut aussi apporter des matériels constructeurs pour l'inventaire.
  const models: HardwareModel[] = []
  for (const item of Array.isArray(raw.models) ? raw.models : []) {
    if (!isRecord(item)) continue
    const vendor = typeof item.vendor === 'string' ? item.vendor.trim() : ''
    const model = typeof item.model === 'string' ? item.model.trim() : ''
    if (!vendor || !model) continue
    models.push({
      vendor,
      model,
      kind: typeof item.kind === 'string' && item.kind.trim() ? item.kind.trim() : 'server',
      heightU: Number.isFinite(item.heightU) ? Math.max(1, Number(item.heightU)) : undefined,
      powerW: Number.isFinite(item.powerW) ? Number(item.powerW) : undefined,
      spec: typeof item.spec === 'string' ? item.spec : undefined,
    })
  }

  return {
    id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : id,
    version: typeof raw.version === 'string' ? raw.version : '1.0.0',
    description: typeof raw.description === 'string' ? raw.description : '',
    devices,
    models: models.length > 0 ? models : undefined,
  }
}

export function getCatalogSource(): string {
  try {
    return localStorage.getItem(SOURCE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setCatalogSource(url: string) {
  try {
    if (url.trim()) localStorage.setItem(SOURCE_KEY, url.trim())
    else localStorage.removeItem(SOURCE_KEY)
  } catch {
    // stockage indisponible : la source ne sera pas mémorisée, sans conséquence.
  }
}

function readUserPacks(): CatalogPack[] {
  try {
    const raw = localStorage.getItem(USER_PACKS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      try {
        return [parsePack(item)]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

function writeUserPacks(packs: CatalogPack[]) {
  try {
    localStorage.setItem(USER_PACKS_KEY, JSON.stringify(packs))
  } catch {
    // stockage plein ou désactivé : les lots resteront valables pour la session.
  }
}

export function saveUserPack(pack: CatalogPack) {
  const packs = readUserPacks().filter((item) => item.id !== pack.id)
  packs.push(pack)
  writeUserPacks(packs)
  registerPack(pack)
}

export function deleteUserPack(packId: string) {
  writeUserPacks(readUserPacks().filter((item) => item.id !== packId))
  removePack(packId)
}

export function userPackIds(): string[] {
  return readUserPacks().map((pack) => pack.id)
}

/** Ajoute ou met à jour un type d'équipement maison, rangé dans le lot « perso ». */
export function upsertCustomDevice(def: DeviceDef) {
  const existing = readUserPacks().find((pack) => pack.id === CUSTOM_PACK_ID)
  const devices = (existing?.devices ?? []).filter((item) => item.id !== def.id)
  devices.push(def)
  saveUserPack({
    id: CUSTOM_PACK_ID,
    title: 'Types maison',
    version: new Date().toISOString().slice(0, 10),
    description: 'Types d’équipement créés dans l’application.',
    devices,
  })
}

export function customDevices(): DeviceDef[] {
  return readUserPacks().find((pack) => pack.id === CUSTOM_PACK_ID)?.devices ?? []
}

async function fetchPacks(baseUrl: string): Promise<CatalogPack[]> {
  const base = baseUrl.replace(/\/+$/, '')
  const response = await fetch(`${base}/index.json`, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`index.json : ${response.status}`)
  const index: unknown = await response.json()
  const files = isRecord(index) && Array.isArray(index.packs) ? index.packs : []
  const packs: CatalogPack[] = []
  for (const file of files) {
    if (typeof file !== 'string') continue
    const url = /^https?:/i.test(file) ? file : `${base}/${file}`
    const packResponse = await fetch(url, { cache: 'no-cache' })
    if (!packResponse.ok) throw new Error(`${file} : ${packResponse.status}`)
    packs.push(parsePack(await packResponse.json()))
  }
  return packs
}

/**
 * Chargement du catalogue au démarrage :
 *   1. les lots embarqués dans l'application ;
 *   2. les lots déposés à côté de l'application (`./catalog/index.json`) — c'est la voie
 *      de mise à jour sans recompiler : on remplace un fichier, on recharge la page ;
 *   3. les lots d'une source distante configurée (serveur interne, dépôt d'entreprise) ;
 *   4. les lots importés et les types maison enregistrés sur ce poste.
 */
let lastReport: CatalogReport | null = null

export function catalogReport(): CatalogReport | null {
  return lastReport
}

export async function bootstrapCatalog(): Promise<CatalogReport> {
  const errors: string[] = []
  const loaded: LoadedPack[] = BUILTIN_PACKS.map((pack) => ({
    id: pack.id,
    title: pack.title,
    version: pack.version,
    count: pack.devices.length,
    origin: 'embarqué' as const,
  }))

  const sources: { url: string; origin: LoadedPack['origin'] }[] = [
    { url: './catalog', origin: 'déposé' },
  ]
  const remote = getCatalogSource()
  if (remote) sources.push({ url: remote, origin: 'distant' })

  for (const source of sources) {
    try {
      for (const pack of await fetchPacks(source.url)) {
        registerPack(pack)
        loaded.push({
          id: pack.id,
          title: pack.title,
          version: pack.version,
          count: pack.devices.length,
          origin: source.origin,
        })
      }
    } catch (error) {
      // Une source absente n'est pas une erreur à signaler : seule une source
      // configurée explicitement mérite un message.
      if (source.origin === 'distant') {
        errors.push(`Source distante injoignable (${error instanceof Error ? error.message : 'erreur'}).`)
      }
    }
  }

  for (const pack of readUserPacks()) {
    registerPack(pack)
    loaded.push({
      id: pack.id,
      title: pack.title,
      version: pack.version,
      count: pack.devices.length,
      origin: 'local',
    })
  }

  lastReport = { version: BUILTIN_CATALOG_VERSION, packs: loaded, errors }
  return lastReport
}

export function catalogSummary(): { packs: number; devices: number } {
  const packs = registeredPacks()
  return { packs: packs.length, devices: packs.reduce((acc, pack) => acc + pack.devices.length, 0) }
}
