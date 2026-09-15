import { deviceMeta } from './catalog'
import type { AssetStatus, Diagram, NetNode } from '../types'

export const STATUS_LABELS: Record<AssetStatus, string> = {
  production: 'En production',
  stock: 'En stock',
  maintenance: 'En maintenance',
  retire: 'Retiré',
}

export const STATUS_COLORS: Record<AssetStatus, string> = {
  production: '#059669',
  stock: '#2563eb',
  maintenance: '#d97706',
  retire: '#94a3b8',
}

export interface InventoryColumn {
  key: string
  label: string
  /** Largeur indicative en pixels pour la table. */
  width: number
  get: (node: NetNode, diagram: Diagram) => string
  /** Absent = colonne calculée, non modifiable directement. */
  set?: (value: string) => Partial<NetNode>
}

const rackName = (node: NetNode, diagram: Diagram) =>
  diagram.racks?.find((rack) => rack.id === node.rack)?.name ?? ''

export const INVENTORY_COLUMNS: InventoryColumn[] = [
  { key: 'name', label: 'Nom', width: 170, get: (node) => node.name, set: (name) => ({ name }) },
  { key: 'kind', label: 'Type', width: 150, get: (node) => deviceMeta(node.kind).label },
  {
    key: 'status',
    label: 'Statut',
    width: 120,
    get: (node) => (node.status ? STATUS_LABELS[node.status] : ''),
  },
  { key: 'vendor', label: 'Constructeur', width: 120, get: (node) => node.vendor ?? '', set: (vendor) => ({ vendor }) },
  { key: 'model', label: 'Modèle', width: 140, get: (node) => node.model ?? '', set: (model) => ({ model }) },
  { key: 'serial', label: 'N° de série', width: 130, get: (node) => node.serial ?? '', set: (serial) => ({ serial }) },
  { key: 'assetTag', label: 'Immobilisation', width: 120, get: (node) => node.assetTag ?? '', set: (assetTag) => ({ assetTag }) },
  { key: 'site', label: 'Site', width: 110, get: (node) => node.site ?? '', set: (site) => ({ site }) },
  { key: 'zone', label: 'Zone', width: 110, get: (node) => node.zone ?? '', set: (zone) => ({ zone }) },
  { key: 'rack', label: 'Baie', width: 110, get: rackName },
  {
    key: 'rackUnit',
    label: 'U',
    width: 60,
    get: (node) => (node.rackUnit ? String(node.rackUnit) : ''),
    set: (value) => ({ rackUnit: value.trim() ? Number(value) : undefined }),
  },
  {
    key: 'heightU',
    label: 'Hauteur U',
    width: 80,
    get: (node) => (node.heightU ? String(node.heightU) : ''),
    set: (value) => ({ heightU: value.trim() ? Number(value) : undefined }),
  },
  { key: 'ip', label: 'Adresse IP', width: 120, get: (node) => node.ip ?? '', set: (ip) => ({ ip }) },
  { key: 'vlan', label: 'VLAN', width: 90, get: (node) => node.vlan ?? '', set: (vlan) => ({ vlan }) },
  { key: 'owner', label: 'Responsable', width: 130, get: (node) => node.owner ?? '', set: (owner) => ({ owner }) },
  { key: 'purchaseDate', label: 'Achat', width: 110, get: (node) => node.purchaseDate ?? '', set: (purchaseDate) => ({ purchaseDate }) },
  { key: 'warrantyEnd', label: 'Garantie', width: 110, get: (node) => node.warrantyEnd ?? '', set: (warrantyEnd) => ({ warrantyEnd }) },
  {
    key: 'powerW',
    label: 'Puissance (W)',
    width: 100,
    get: (node) => (node.powerW ? String(node.powerW) : ''),
    set: (value) => ({ powerW: value.trim() ? Number(value) : undefined }),
  },
  { key: 'notes', label: 'Notes', width: 200, get: (node) => node.notes ?? '', set: (notes) => ({ notes }) },
]

function escapeCsv(value: string): string {
  return /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Export CSV du parc, séparateur point-virgule et BOM UTF-8 : le fichier s'ouvre
 * directement dans Excel en français, et se réimporte tel quel.
 */
export function inventoryToCsv(diagram: Diagram, nodes: NetNode[]): string {
  const header = INVENTORY_COLUMNS.map((column) => column.label).join(';')
  const rows = nodes.map((node) =>
    INVENTORY_COLUMNS.map((column) => escapeCsv(column.get(node, diagram))).join(';'),
  )
  return `﻿${[header, ...rows].join('\r\n')}\r\n`
}

function splitCsvLine(line: string, separator: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else quoted = false
      } else current += char
    } else if (char === '"') quoted = true
    else if (char === separator) {
      cells.push(current)
      current = ''
    } else current += char
  }
  cells.push(current)
  return cells
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^﻿/, '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export interface CsvImportResult {
  rows: { name: string; patch: Partial<NetNode> }[]
  warnings: string[]
}

/**
 * Import CSV : la colonne « Nom » identifie l'équipement. Les colonnes reconnues sont
 * celles de l'export ; les autres sont ignorées avec un avertissement.
 */
export function inventoryFromCsv(text: string): CsvImportResult {
  const warnings: string[] = []
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length < 2) return { rows: [], warnings: ['Le fichier ne contient aucune ligne de données.'] }

  const separator = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const headers = splitCsvLine(lines[0], separator).map(normalizeHeader)
  const byLabel = new Map(INVENTORY_COLUMNS.map((column) => [normalizeHeader(column.label), column]))
  const byKey = new Map(INVENTORY_COLUMNS.map((column) => [column.key.toLowerCase(), column]))

  const columns = headers.map((header) => byLabel.get(header) ?? byKey.get(header) ?? null)
  const nameIndex = headers.findIndex((header) => header === 'nom' || header === 'name')
  if (nameIndex === -1) {
    return { rows: [], warnings: ['Colonne « Nom » absente : impossible d’identifier les équipements.'] }
  }
  for (const [index, column] of columns.entries()) {
    if (!column && index !== nameIndex) warnings.push(`Colonne « ${headers[index]} » ignorée.`)
  }

  const rows: { name: string; patch: Partial<NetNode> }[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, separator)
    const name = cells[nameIndex]?.trim()
    if (!name) continue
    const patch: Partial<NetNode> = {}
    for (const [index, column] of columns.entries()) {
      if (!column?.set || index === nameIndex) continue
      const value = cells[index]?.trim() ?? ''
      if (value === '') continue
      Object.assign(patch, column.set(value))
    }
    rows.push({ name, patch })
  }
  return { rows, warnings }
}
