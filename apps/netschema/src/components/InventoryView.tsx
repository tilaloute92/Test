import { useMemo, useRef, useState } from 'react'
import { Btn } from './ui'
import { deviceMeta } from '../lib/catalog'
import { downloadBlob, slugify } from '../lib/exportImage'
import { DeviceIcon } from '../lib/icons'
import {
  INVENTORY_COLUMNS,
  inventoryToCsv,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../lib/inventory'
import { ModelPicker } from './ModelPicker'
import { vendors } from '../lib/vendors'
import { useDiagram } from '../store/useDiagram'
import type { AssetStatus, NetNode } from '../types'

const STATUS_OPTIONS = Object.keys(STATUS_LABELS) as AssetStatus[]

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Inventaire du parc : la même base d'équipements que le schéma, vue comme une table
 * d'actifs — constructeur, modèle, numéro de série, immobilisation, garantie,
 * responsable, implantation en baie, consommation.
 */
export function InventoryView() {
  const diagram = useDiagram((s) => s.diagram)
  const updateNode = useDiagram((s) => s.updateNode)
  const selectedNodes = useDiagram((s) => s.selectedNodes)
  const select = useDiagram((s) => s.select)
  const notify = useDiagram((s) => s.notify)
  const fileRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [site, setSite] = useState('')
  const [status, setStatus] = useState('')
  const [rack, setRack] = useState('')
  const [vendor, setVendor] = useState('')

  // Constructeurs présents dans le parc, puis ceux de la base matériels.
  const vendorOptions = useMemo(() => {
    const used = new Set(diagram.nodes.map((node) => node.vendor?.trim()).filter(Boolean) as string[])
    return [...new Set([...used, ...vendors()])].sort((a, b) => a.localeCompare(b))
  }, [diagram.nodes])

  const sites = useMemo(
    () => [...new Set(diagram.nodes.map((node) => node.site?.trim()).filter(Boolean))].sort() as string[],
    [diagram.nodes],
  )

  const rows = useMemo(() => {
    const q = normalize(query.trim())
    return diagram.nodes
      .filter((node) => {
        if (site && node.site !== site) return false
        if (vendor && node.vendor !== vendor) return false
        if (status && node.status !== status) return false
        if (rack === '__none' && node.rack) return false
        if (rack && rack !== '__none' && node.rack !== rack) return false
        if (!q) return true
        const haystack = [
          node.name,
          node.ip,
          node.serial,
          node.model,
          node.vendor,
          node.assetTag,
          node.owner,
          deviceMeta(node.kind).label,
        ]
          .filter(Boolean)
          .join(' ')
        return normalize(haystack).includes(q)
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [diagram.nodes, query, site, status, rack, vendor])

  const totalPower = rows.reduce((acc, node) => acc + (node.powerW ?? 0), 0)

  const exportCsv = () => {
    downloadBlob(
      new Blob([inventoryToCsv(diagram, rows)], { type: 'text/csv;charset=utf-8' }),
      `${slugify(diagram.title)}-inventaire.csv`,
    )
  }

  const importCsv = async (file: File | undefined) => {
    if (!file) return
    const result = useDiagram.getState().applyInventoryCsv(await file.text())
    notify(
      `${result.updated} équipement(s) mis à jour, ${result.created} créé(s).` +
        (result.warnings.length > 0 ? ` ${result.warnings[0]}` : ''),
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher un nom, une IP, un n° de série…"
          className="w-72 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <select value={site} onChange={(e) => setSite(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]">
          <option value="">Tous les sites</option>
          {sites.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]">
          <option value="">Tous les statuts</option>
          {STATUS_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {STATUS_LABELS[item]}
            </option>
          ))}
        </select>
        <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]">
          <option value="">Tous les constructeurs</option>
          {vendorOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={rack} onChange={(e) => setRack(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]">
          <option value="">Toutes les baies</option>
          <option value="__none">Non implantés</option>
          {(diagram.racks ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-slate-500">
            {rows.length} ligne(s){totalPower > 0 ? ` · ${totalPower} W` : ''}
          </span>
          <Btn onClick={exportCsv}>Exporter CSV</Btn>
          <Btn onClick={() => fileRef.current?.click()}>Importer CSV</Btn>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              void importCsv(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max border-separate border-spacing-0 text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr>
              {INVENTORY_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  style={{ minWidth: column.width }}
                  className="border-b border-slate-200 bg-white px-2 py-2 text-left font-semibold text-slate-500"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((node) => (
              <Row
                key={node.id}
                node={node}
                selected={selectedNodes.includes(node.id)}
                onSelect={() => select({ nodes: [node.id] })}
                onChange={(patch) => updateNode(node.id, patch)}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-8 text-center text-[13px] text-slate-400">
            Aucun équipement ne correspond aux filtres.
          </p>
        )}
      </div>
    </div>
  )
}

function Row({
  node,
  selected,
  onSelect,
  onChange,
}: {
  node: NetNode
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<NetNode>) => void
}) {
  const diagram = useDiagram((s) => s.diagram)
  const setAppView = useDiagram((s) => s.setAppView)
  const meta = deviceMeta(node.kind)

  return (
    <tr
      onClick={onSelect}
      className={`${selected ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'} `}
    >
      {INVENTORY_COLUMNS.map((column) => {
        const value = column.get(node, diagram)
        if (column.key === 'kind') {
          return (
            <td key={column.key} className="border-b border-slate-100 px-2 py-1">
              <button
                type="button"
                title="Voir dans le schéma"
                onClick={() => {
                  useDiagram.getState().focusNode(node.id)
                  setAppView('diagram')
                }}
                className="flex items-center gap-1.5 text-slate-600 hover:text-blue-700"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" className="shrink-0">
                  <DeviceIcon icon={meta.icon} color={meta.accent} />
                </svg>
                {value}
              </button>
            </td>
          )
        }
        if (column.key === 'model') {
          return (
            <td key={column.key} className="border-b border-slate-100 px-2 py-1">
              <ModelPicker node={node} onPick={onChange} compact />
            </td>
          )
        }
        if (column.key === 'status') {
          return (
            <td key={column.key} className="border-b border-slate-100 px-2 py-1">
              <select
                value={node.status ?? ''}
                onChange={(event) =>
                  onChange({ status: event.target.value ? (event.target.value as AssetStatus) : undefined })
                }
                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] hover:border-slate-200"
                style={{ color: node.status ? STATUS_COLORS[node.status] : undefined }}
              >
                <option value="">—</option>
                {STATUS_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {STATUS_LABELS[item]}
                  </option>
                ))}
              </select>
            </td>
          )
        }
        return (
          <td key={column.key} className="border-b border-slate-100 px-2 py-1">
            {column.set ? (
              <input
                value={value}
                onChange={(event) => onChange(column.set!(event.target.value))}
                className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-slate-200 focus:border-blue-500 focus:bg-white"
              />
            ) : (
              <span className="text-slate-500">{value || '—'}</span>
            )}
          </td>
        )
      })}
    </tr>
  )
}
