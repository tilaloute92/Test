import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { ensureDir, pathInside, readJson, safeId, version, writeJsonAtomic } from './files.ts'

/**
 * Magasin de schémas.
 *
 * Un schéma par fichier, dans un dossier connu : une sauvegarde est une copie de dossier,
 * une restauration aussi. Chaque enregistrement porte un numéro de version — l'empreinte du
 * contenu — que le client renvoie : deux personnes qui modifient le même schéma ne
 * s'écrasent pas en silence, la seconde reçoit un conflit et recharge.
 */

export interface DiagramRecord {
  id: string
  title: string
  /** Contenu du schéma, tel que l'application le produit. */
  diagram: unknown
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface DiagramSummary {
  id: string
  title: string
  updatedAt: string
  updatedBy: string
  version: string
  nodes: number
  links: number
  locked: boolean
}

/** Limites de garde : un schéma légitime reste très en deçà. */
const MAX_NODES = 5000
const MAX_LINKS = 10000

/**
 * Nettoyage d'une valeur venue du réseau.
 *
 * Le serveur ne cherche pas à connaître le format d'un schéma — c'est l'application qui le
 * valide à l'ouverture, et elle sait le faire. Il s'assure en revanche qu'aucune clé
 * dangereuse (`__proto__`, `constructor`) ne se promène dans les données, que la structure
 * reste raisonnable, et que rien n'est stocké qui ne soit du JSON simple.
 */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 12) return null
  if (value === null) return null
  if (Array.isArray(value)) return value.slice(0, 20000).map((item) => sanitize(item, depth + 1))
  switch (typeof value) {
    case 'string':
      return value.length > 20000 ? value.slice(0, 20000) : value
    case 'number':
      return Number.isFinite(value) ? value : 0
    case 'boolean':
      return value
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
        if (key.length > 64) continue
        out[key] = sanitize(item, depth + 1)
      }
      return out
    }
    default:
      return undefined
  }
}

export function checkDiagram(raw: unknown): { ok: true; diagram: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Schéma attendu : un objet JSON.' }
  }
  const diagram = sanitize(raw) as Record<string, unknown>
  const nodes = diagram.nodes
  const links = diagram.links
  if (!Array.isArray(nodes) || !Array.isArray(links)) {
    return { ok: false, error: 'Schéma invalide : « nodes » et « links » sont attendus.' }
  }
  if (nodes.length > MAX_NODES) return { ok: false, error: `Trop d'équipements (${MAX_NODES} au plus).` }
  if (links.length > MAX_LINKS) return { ok: false, error: `Trop de liaisons (${MAX_LINKS} au plus).` }
  return { ok: true, diagram }
}

export class DiagramStore {
  private readonly dir: string

  constructor(dataDir: string) {
    this.dir = resolve(dataDir, 'diagrams')
    ensureDir(this.dir)
  }

  private fileOf(id: string): string | null {
    const safe = safeId(id)
    if (!safe) return null
    return pathInside(this.dir, `${safe}.json`)
  }

  list(): DiagramSummary[] {
    const files = readdirSync(this.dir).filter((name) => name.endsWith('.json'))
    const summaries: DiagramSummary[] = []
    for (const name of files) {
      const record = readJson<DiagramRecord | null>(resolve(this.dir, name), null)
      if (!record?.id) continue
      const diagram = (record.diagram ?? {}) as Record<string, unknown>
      summaries.push({
        id: record.id,
        title: record.title,
        updatedAt: record.updatedAt,
        updatedBy: record.updatedBy,
        version: version(record.diagram),
        nodes: Array.isArray(diagram.nodes) ? diagram.nodes.length : 0,
        links: Array.isArray(diagram.links) ? diagram.links.length : 0,
        locked: diagram.locked === true,
      })
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  get(id: string): { record: DiagramRecord; version: string } | null {
    const file = this.fileOf(id)
    if (!file || !existsSync(file)) return null
    const record = readJson<DiagramRecord | null>(file, null)
    if (!record?.id) return null
    return { record, version: version(record.diagram) }
  }

  create(title: string, diagram: Record<string, unknown>, author: string): { record: DiagramRecord; version: string } {
    const now = new Date().toISOString()
    const record: DiagramRecord = {
      id: randomUUID(),
      title: title.slice(0, 200),
      diagram,
      createdAt: now,
      createdBy: author,
      updatedAt: now,
      updatedBy: author,
    }
    const file = this.fileOf(record.id)
    if (!file) throw new Error('Identifiant de schéma invalide.')
    writeJsonAtomic(file, record)
    return { record, version: version(record.diagram) }
  }

  /**
   * Enregistrement avec contrôle de version. `expected` est le numéro reçu au chargement :
   * s'il ne correspond plus, quelqu'un est passé entre-temps et l'écriture est refusée.
   */
  update(
    id: string,
    diagram: Record<string, unknown>,
    author: string,
    expected: string | undefined,
    title?: string,
  ): { ok: true; version: string; record: DiagramRecord } | { ok: false; conflict: true; version: string } | null {
    const current = this.get(id)
    if (!current) return null
    if (expected && expected !== current.version) {
      return { ok: false, conflict: true, version: current.version }
    }
    const record: DiagramRecord = {
      ...current.record,
      title: (title ?? (typeof diagram.title === 'string' ? diagram.title : current.record.title)).slice(0, 200),
      diagram,
      updatedAt: new Date().toISOString(),
      updatedBy: author,
    }
    const file = this.fileOf(id)
    if (!file) return null
    writeJsonAtomic(file, record)
    return { ok: true, version: version(record.diagram), record }
  }

  remove(id: string): boolean {
    const file = this.fileOf(id)
    if (!file || !existsSync(file)) return false
    rmSync(file)
    return true
  }
}
