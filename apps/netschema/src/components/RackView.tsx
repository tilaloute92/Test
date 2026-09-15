import { useMemo, useRef, useState } from 'react'
import { Btn, Field, TextInput } from './ui'
import { deviceMeta } from '../lib/catalog'
import { downloadPng, downloadSvg, slugify } from '../lib/exportImage'
import { DeviceIcon } from '../lib/icons'
import { heightOf, rackOccupancy, racksOf, unrackedNodes } from '../lib/racks'
import { useDiagram } from '../store/useDiagram'
import type { NetNode, RackDef } from '../types'

const UNIT_H = 18
const RACK_W = 240
const LABEL_W = 26
const GAP = 64
const TOP = 74

interface DragState {
  nodeId: string
  rackId: string
  unit: number
}

/**
 * Implantation physique : élévation des baies, comme la vue « rack » d'un outil de parc.
 * Les équipements sont ceux du schéma — un serveur posé dans une baie reste le même objet
 * que celui câblé sur le schéma et listé dans l'inventaire.
 */
export function RackView() {
  const diagram = useDiagram((s) => s.diagram)
  const selectedNodes = useDiagram((s) => s.selectedNodes)
  const select = useDiagram((s) => s.select)
  const svgRef = useRef<SVGSVGElement>(null)
  const [activeRack, setActiveRack] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const racks = useMemo(() => racksOf(diagram), [diagram])
  const occupancies = useMemo(() => racks.map((rack) => rackOccupancy(diagram, rack)), [racks, diagram])
  const unracked = useMemo(() => unrackedNodes(diagram), [diagram])
  const current = activeRack ?? racks[0]?.id ?? null
  const currentRack = racks.find((rack) => rack.id === current) ?? null

  const maxUnits = Math.max(42, ...racks.map((rack) => rack.units))
  const width = Math.max(600, racks.length * (RACK_W + GAP) + 80)
  const height = TOP + maxUnits * UNIT_H + 70

  /** Position (baie, U) sous le pointeur. */
  const locate = (event: React.PointerEvent): DragState | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !drag) return null
    const scale = rect.width / width
    const x = (event.clientX - rect.left) / scale
    const y = (event.clientY - rect.top) / scale
    for (const [index, rack] of racks.entries()) {
      const rackX = 40 + index * (RACK_W + GAP)
      if (x < rackX - GAP / 2 || x > rackX + RACK_W + GAP / 2) continue
      const node = diagram.nodes.find((item) => item.id === drag.nodeId)
      const size = node ? heightOf(node) : 1
      const fromTop = Math.floor((y - TOP) / UNIT_H)
      const unit = Math.min(Math.max(1, rack.units - fromTop - size + 1), Math.max(1, rack.units - size + 1))
      return { nodeId: drag.nodeId, rackId: rack.id, unit }
    }
    return null
  }

  const exportRoom = async (format: 'svg' | 'png') => {
    const svg = svgRef.current
    if (!svg) return
    const filename = `${slugify(diagram.title)}-baies.${format}`
    if (format === 'svg') downloadSvg(svg, filename)
    else await downloadPng(svg, filename, 2)
  }

  return (
    <div className="flex min-h-0 flex-1 bg-slate-50">
      <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Baies</h2>
          <button
            type="button"
            onClick={() => setActiveRack(useDiagram.getState().addRack())}
            className="text-[11px] text-blue-600 hover:underline"
          >
            + nouvelle
          </button>
        </div>

        <ul className="flex flex-col gap-1">
          {occupancies.map((occupancy) => {
            const ratio = occupancy.usedUnits / occupancy.rack.units
            return (
              <li key={occupancy.rack.id}>
                <button
                  type="button"
                  onClick={() => setActiveRack(occupancy.rack.id)}
                  className={`w-full rounded-lg border p-2 text-left transition ${
                    current === occupancy.rack.id
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-[13px] font-semibold text-slate-700">{occupancy.rack.name}</span>
                  <span className="block text-[11px] text-slate-500">
                    {[occupancy.rack.site, occupancy.rack.room].filter(Boolean).join(' · ') || 'Site non précisé'}
                  </span>
                  <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.min(100, ratio * 100)}%`,
                        backgroundColor: ratio > 0.9 ? '#dc2626' : ratio > 0.7 ? '#d97706' : '#2563eb',
                      }}
                    />
                  </span>
                  <span className="block pt-0.5 text-[10px] text-slate-400">
                    {occupancy.usedUnits}/{occupancy.rack.units} U · {occupancy.freeUnits} U libres
                    {occupancy.powerW > 0 ? ` · ${occupancy.powerW} W` : ''}
                  </span>
                </button>
              </li>
            )
          })}
          {racks.length === 0 && (
            <li className="rounded-lg bg-slate-50 p-2.5 text-[11px] leading-snug text-slate-500">
              Aucune baie. Créez-en une, puis implantez les équipements du schéma.
            </li>
          )}
        </ul>

        {currentRack && <RackForm rack={currentRack} onRemoved={() => setActiveRack(null)} />}
      </aside>

      <main className="relative min-w-0 flex-1 overflow-auto p-4">
        <div className="mb-3 flex items-center gap-2">
          <h1 className="text-[15px] font-semibold text-slate-800">Implantation en salle</h1>
          <div className="ml-auto flex gap-2">
            <Btn onClick={() => void exportRoom('svg')}>SVG</Btn>
            <Btn onClick={() => void exportRoom('png')}>PNG</Btn>
          </div>
        </div>

        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="max-w-full touch-none select-none"
          onPointerMove={(event) => {
            if (!drag) return
            const next = locate(event)
            if (next) setDrag(next)
          }}
          onPointerUp={() => {
            if (drag) useDiagram.getState().assignToRack([drag.nodeId], drag.rackId, drag.unit)
            setDrag(null)
          }}
          onPointerLeave={() => setDrag(null)}
        >
          <g data-export-root>
            <rect width={width} height={height} fill="#ffffff" />
            {occupancies.map((occupancy, index) => (
              <RackElevation
                key={occupancy.rack.id}
                x={40 + index * (RACK_W + GAP)}
                occupancy={occupancy}
                selectedNodes={selectedNodes}
                drag={drag}
                onPickUp={(node, event) => {
                  event.stopPropagation()
                  select({ nodes: [node.id] })
                  setDrag({ nodeId: node.id, rackId: occupancy.rack.id, unit: node.rackUnit ?? 1 })
                  ;(event.currentTarget as SVGGElement).setPointerCapture?.(event.pointerId)
                }}
              />
            ))}
          </g>
        </svg>
      </main>

      <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-slate-200 bg-white p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Non implantés ({unracked.length})
        </h2>
        <ul className="flex flex-col gap-1">
          {unracked.map((node) => {
            const meta = deviceMeta(node.kind)
            return (
              <li key={node.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5">
                <svg width="16" height="16" viewBox="0 0 24 24" className="shrink-0">
                  <DeviceIcon icon={meta.icon} color={meta.accent} />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-slate-700">{node.name}</span>
                  <span className="block text-[10px] text-slate-400">
                    {meta.label} · {heightOf(node)} U
                  </span>
                </span>
                <button
                  type="button"
                  disabled={!current}
                  onClick={() => current && useDiagram.getState().assignToRack([node.id], current)}
                  className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  implanter
                </button>
              </li>
            )
          })}
          {unracked.length === 0 && (
            <li className="rounded-lg bg-emerald-50 p-2.5 text-[11px] text-emerald-700">
              Tous les équipements physiques sont implantés.
            </li>
          )}
        </ul>

        <SelectionDetails />
      </aside>
    </div>
  )
}

function RackForm({ rack, onRemoved }: { rack: RackDef; onRemoved: () => void }) {
  const updateRack = useDiagram((s) => s.updateRack)
  const removeRack = useDiagram((s) => s.removeRack)
  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Baie sélectionnée</h3>
      <Field label="Nom">
        <TextInput value={rack.name} onChange={(name) => updateRack(rack.id, { name })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Site">
          <TextInput value={rack.site ?? ''} onChange={(site) => updateRack(rack.id, { site })} />
        </Field>
        <Field label="Local">
          <TextInput value={rack.room ?? ''} onChange={(room) => updateRack(rack.id, { room })} />
        </Field>
      </div>
      <Field label="Hauteur (U)">
        <TextInput
          value={String(rack.units)}
          onChange={(value) => updateRack(rack.id, { units: Math.max(1, Math.min(60, Number(value) || 42)) })}
        />
      </Field>
      <button
        type="button"
        onClick={() => {
          removeRack(rack.id)
          onRemoved()
        }}
        className="text-left text-[11px] text-red-600 hover:underline"
      >
        Supprimer la baie (les équipements sont conservés)
      </button>
    </div>
  )
}

function SelectionDetails() {
  const selectedNodes = useDiagram((s) => s.selectedNodes)
  const node = useDiagram((s) => s.diagram.nodes.find((item) => item.id === s.selectedNodes[0]))
  const updateNode = useDiagram((s) => s.updateNode)
  const detach = useDiagram((s) => s.detachFromRack)
  if (!node || selectedNodes.length === 0) return null

  return (
    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Équipement</h3>
      <p className="text-[13px] font-semibold text-slate-700">{node.name}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Hauteur (U)">
          <TextInput
            value={String(heightOf(node))}
            onChange={(value) => updateNode(node.id, { heightU: Math.max(1, Number(value) || 1) })}
          />
        </Field>
        <Field label="Position (U)">
          <TextInput
            value={node.rackUnit ? String(node.rackUnit) : ''}
            onChange={(value) => updateNode(node.id, { rackUnit: value.trim() ? Number(value) : undefined })}
          />
        </Field>
      </div>
      <Field label="Puissance (W)">
        <TextInput
          value={node.powerW ? String(node.powerW) : ''}
          onChange={(value) => updateNode(node.id, { powerW: value.trim() ? Number(value) : undefined })}
        />
      </Field>
      {node.rack && (
        <button type="button" onClick={() => detach([node.id])} className="text-left text-[11px] text-red-600 hover:underline">
          Retirer de la baie
        </button>
      )}
    </div>
  )
}

function RackElevation({
  x,
  occupancy,
  selectedNodes,
  drag,
  onPickUp,
}: {
  x: number
  occupancy: ReturnType<typeof rackOccupancy>
  selectedNodes: string[]
  drag: DragState | null
  onPickUp: (node: NetNode, event: React.PointerEvent<SVGGElement>) => void
}) {
  const { rack, slots, conflicts } = occupancy
  const conflicted = new Set(conflicts.flatMap((conflict) => conflict.nodes.map((node) => node.id)))
  const unitY = (unit: number, height: number) => TOP + (rack.units - (unit + height - 1)) * UNIT_H

  return (
    <g>
      <text x={x + RACK_W / 2} y={TOP - 34} textAnchor="middle" fontSize={13} fontWeight={700} fill="#0f172a">
        {rack.name}
      </text>
      <text x={x + RACK_W / 2} y={TOP - 18} textAnchor="middle" fontSize={10} fill="#64748b">
        {[rack.site, rack.room].filter(Boolean).join(' · ') || '—'} · {rack.units} U ·{' '}
        {occupancy.freeUnits} U libres
      </text>

      <rect
        x={x}
        y={TOP - 6}
        width={RACK_W}
        height={rack.units * UNIT_H + 12}
        rx={6}
        fill="#f8fafc"
        stroke="#94a3b8"
        strokeWidth={1.4}
      />

      {Array.from({ length: rack.units }, (_, index) => {
        const unit = rack.units - index
        const y = TOP + index * UNIT_H
        return (
          <g key={unit}>
            <rect
              x={x + LABEL_W}
              y={y}
              width={RACK_W - LABEL_W - 6}
              height={UNIT_H}
              fill={unit % 2 === 0 ? '#ffffff' : '#f1f5f9'}
              stroke="#e2e8f0"
              strokeWidth={0.5}
            />
            <text x={x + LABEL_W - 6} y={y + UNIT_H - 5} textAnchor="end" fontSize={8} fill="#94a3b8">
              {unit}
            </text>
          </g>
        )
      })}

      {drag?.rackId === rack.id && (
        <rect
          data-export="false"
          x={x + LABEL_W}
          y={unitY(drag.unit, 1)}
          width={RACK_W - LABEL_W - 6}
          height={UNIT_H}
          fill="#2563eb"
          fillOpacity={0.18}
          stroke="#2563eb"
          strokeDasharray="4 3"
        />
      )}

      {slots.map(({ node, start, height }) => {
        const meta = deviceMeta(node.kind)
        const selected = selectedNodes.includes(node.id)
        const bad = conflicted.has(node.id)
        const y = unitY(start, height)
        return (
          <g
            key={node.id}
            transform={`translate(${x + LABEL_W + 2}, ${y + 1})`}
            style={{ cursor: 'grab' }}
            opacity={drag?.nodeId === node.id ? 0.4 : 1}
            onPointerDown={(event) => onPickUp(node, event)}
          >
            <rect
              width={RACK_W - LABEL_W - 10}
              height={height * UNIT_H - 2}
              rx={3}
              fill={meta.fill}
              stroke={bad ? '#dc2626' : selected ? '#2563eb' : meta.accent}
              strokeWidth={bad || selected ? 2 : 1.2}
            />
            <g transform={`translate(5, ${(height * UNIT_H - 2) / 2 - 7})`}>
              <svg width="14" height="14" viewBox="0 0 24 24">
                <DeviceIcon icon={meta.icon} color={meta.accent} />
              </svg>
            </g>
            <text x={24} y={height * UNIT_H / 2 + 1} fontSize={9.5} fontWeight={600} fill="#0f172a">
              {node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name}
            </text>
            <text x={RACK_W - LABEL_W - 16} y={height * UNIT_H / 2 + 1} textAnchor="end" fontSize={8} fill="#64748b">
              {height} U
            </text>
          </g>
        )
      })}

      {conflicts.length > 0 && (
        <text x={x + RACK_W / 2} y={TOP + rack.units * UNIT_H + 22} textAnchor="middle" fontSize={10} fill="#dc2626">
          {conflicts.length} chevauchement(s) d’implantation
        </text>
      )}
    </g>
  )
}
