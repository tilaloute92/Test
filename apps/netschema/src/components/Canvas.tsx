import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LinkShape } from './LinkShape'
import { NodeShape } from './NodeShape'
import { diagramBounds, layerBands, zoneBoxes } from '../lib/layout'
import { parallelOffsets } from '../lib/routing'
import { GRID, useDiagram } from '../store/useDiagram'
import { DRAG_MIME } from '../lib/dnd'
import type { DeviceKind, NetLink, NetNode } from '../types'

interface DragState {
  pointerId: number
  startX: number
  startY: number
  origins: Record<string, { x: number; y: number }>
}

interface PanState {
  pointerId: number
  startX: number
  startY: number
  tx: number
  ty: number
}

export function Canvas({ svgRef }: { svgRef: React.RefObject<SVGSVGElement | null> }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const panRef = useRef<PanState | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  const diagram = useDiagram((s) => s.diagram)
  const view = useDiagram((s) => s.view)
  const mode = useDiagram((s) => s.mode)
  const connectFrom = useDiagram((s) => s.connectFrom)
  const selectedNodes = useDiagram((s) => s.selectedNodes)
  const selectedLinks = useDiagram((s) => s.selectedLinks)
  const snap = useDiagram((s) => s.snap)
  const showGrid = useDiagram((s) => s.showGrid)
  const showZones = useDiagram((s) => s.showZones)
  const showLayerLabels = useDiagram((s) => s.showLayerLabels)
  const showDetails = useDiagram((s) => s.showDetails)
  const linkStyle = useDiagram((s) => s.linkStyle)
  const direction = useDiagram((s) => s.layout.direction)

  const nodeById = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram.nodes])

  /** Conversion écran → coordonnées du schéma. */
  const toDiagram = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - view.tx) / view.zoom,
        y: (clientY - rect.top - view.ty) / view.zoom,
      }
    },
    [view.tx, view.ty, view.zoom],
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      useDiagram.getState().setCanvasSize(element.clientWidth, element.clientHeight)
    })
    observer.observe(element)
    useDiagram.getState().setCanvasSize(element.clientWidth, element.clientHeight)
    return () => observer.disconnect()
  }, [])

  // Molette : zoom centré sur le pointeur (avec Ctrl ou non, comme dans les outils de dessin).
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const factor = Math.exp(-event.deltaY * 0.0015)
      useDiagram.getState().zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const onNodePointerDown = (event: React.PointerEvent<SVGGElement>, node: NetNode) => {
    event.stopPropagation()
    const store = useDiagram.getState()

    if (mode === 'connect') {
      if (!connectFrom) {
        store.setConnectFrom(node.id)
        store.select({ nodes: [node.id] })
      } else if (connectFrom === node.id) {
        store.setConnectFrom(null)
      } else {
        store.addLink(connectFrom, node.id)
        store.setConnectFrom(null)
      }
      return
    }

    const additive = event.shiftKey
    const alreadySelected = selectedNodes.includes(node.id)
    const ids = additive
      ? alreadySelected
        ? selectedNodes.filter((id) => id !== node.id)
        : [...selectedNodes, node.id]
      : alreadySelected
        ? selectedNodes
        : [node.id]
    store.select({ nodes: ids })
    if (ids.length === 0) return

    store.pushHistory()
    const origins: Record<string, { x: number; y: number }> = {}
    for (const id of ids) {
      const target = nodeById.get(id)
      if (target) origins[id] = { x: target.x, y: target.y }
    }
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origins }
    ;(event.currentTarget as SVGGElement).setPointerCapture?.(event.pointerId)
  }

  const onLinkPointerDown = (event: React.PointerEvent<SVGPathElement>, link: NetLink) => {
    event.stopPropagation()
    useDiagram.getState().select({ links: [link.id] }, event.shiftKey)
  }

  const onBackgroundPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const store = useDiagram.getState()
    if (mode === 'connect' && connectFrom) store.setConnectFrom(null)
    if (!event.shiftKey) store.clearSelection()
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      tx: view.tx,
      ty: view.ty,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'connect' && connectFrom) setCursor(toDiagram(event.clientX, event.clientY))

    const drag = dragRef.current
    if (drag) {
      const dx = (event.clientX - drag.startX) / view.zoom
      const dy = (event.clientY - drag.startY) / view.zoom
      const positions: Record<string, { x: number; y: number }> = {}
      for (const [id, origin] of Object.entries(drag.origins)) {
        const x = origin.x + dx
        const y = origin.y + dy
        positions[id] = snap
          ? { x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID }
          : { x: Math.round(x), y: Math.round(y) }
      }
      useDiagram.getState().setNodePositions(positions)
      return
    }

    const pan = panRef.current
    if (pan) {
      useDiagram.getState().setView({
        tx: pan.tx + (event.clientX - pan.startX),
        ty: pan.ty + (event.clientY - pan.startY),
      })
    }
  }

  const endGesture = () => {
    dragRef.current = null
    panRef.current = null
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const kind = event.dataTransfer.getData(DRAG_MIME) as DeviceKind
    if (!kind) return
    const point = toDiagram(event.clientX, event.clientY)
    const x = snap ? Math.round(point.x / GRID) * GRID : Math.round(point.x)
    const y = snap ? Math.round(point.y / GRID) * GRID : Math.round(point.y)
    useDiagram.getState().addNode(kind, x, y)
  }

  const bounds = diagramBounds(diagram.nodes)
  const bands = showLayerLabels ? layerBands(diagram.nodes, direction) : []
  const zones = showZones ? zoneBoxes(diagram.nodes) : []

  // Étalement des liaisons parallèles (deux équipements reliés par plusieurs câbles).
  const linkOffsets = useMemo(() => {
    const groups = new Map<string, NetLink[]>()
    for (const link of diagram.links) {
      const key = [link.from, link.to].sort().join('~')
      const group = groups.get(key)
      if (group) group.push(link)
      else groups.set(key, [link])
    }
    const offsets = new Map<string, number>()
    for (const group of groups.values()) {
      const values = parallelOffsets(group.length)
      group.forEach((link, i) => offsets.set(link.id, values[i]))
    }
    return offsets
  }, [diagram.links])

  const source = connectFrom ? nodeById.get(connectFrom) : undefined
  const gridStep = GRID * view.zoom

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-slate-50"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        style={{ cursor: mode === 'connect' ? 'crosshair' : 'default' }}
      >
        <defs>
          <pattern
            id="netschema-grid"
            width={gridStep}
            height={gridStep}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${view.tx % gridStep}, ${view.ty % gridStep})`}
          >
            <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="#e2e8f0" strokeWidth={1} />
          </pattern>
        </defs>

        {showGrid && <rect data-export="false" width="100%" height="100%" fill="url(#netschema-grid)" />}

        <g data-export-root transform={`translate(${view.tx}, ${view.ty}) scale(${view.zoom})`}>
          {zones.map((zone) => (
            <g key={zone.zone}>
              <rect
                x={zone.x}
                y={zone.y}
                width={zone.width}
                height={zone.height}
                rx={16}
                fill="#0f172a"
                fillOpacity={0.025}
                stroke="#94a3b8"
                strokeWidth={1.2}
                strokeDasharray="7 6"
              />
              <text x={zone.x + 14} y={zone.y + 18} fontSize={11} fontWeight={700} fill="#64748b">
                {zone.zone.toUpperCase()}
              </text>
            </g>
          ))}

          {bands.map((band) =>
            direction === 'TB' ? (
              <text
                key={band.rank}
                x={bounds.minX - 28}
                y={band.main + 4}
                textAnchor="end"
                fontSize={11}
                fontWeight={700}
                fill="#94a3b8"
              >
                {band.label}
              </text>
            ) : (
              <text
                key={band.rank}
                x={band.main}
                y={bounds.minY - 30}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="#94a3b8"
              >
                {band.label}
              </text>
            ),
          )}

          {diagram.links.map((link) => {
            const from = nodeById.get(link.from)
            const to = nodeById.get(link.to)
            if (!from || !to) return null
            return (
              <LinkShape
                key={link.id}
                link={link}
                from={from}
                to={to}
                style={linkStyle}
                offset={linkOffsets.get(link.id) ?? 0}
                selected={selectedLinks.includes(link.id)}
                showDetails={showDetails}
                onPointerDown={onLinkPointerDown}
              />
            )
          })}

          {source && cursor && (
            <path
              data-export="false"
              d={`M ${source.x} ${source.y} L ${cursor.x} ${cursor.y}`}
              stroke="#059669"
              strokeWidth={2}
              strokeDasharray="6 5"
              fill="none"
              pointerEvents="none"
            />
          )}

          {diagram.nodes.map((node) => (
            <NodeShape
              key={node.id}
              node={node}
              selected={selectedNodes.includes(node.id)}
              isConnectSource={connectFrom === node.id}
              showDetails={showDetails}
              onPointerDown={onNodePointerDown}
            />
          ))}
        </g>
      </svg>

      {diagram.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="max-w-sm rounded-xl border border-dashed border-slate-300 bg-white/80 p-6 text-center text-sm text-slate-500">
            Glissez un équipement depuis la palette de gauche, reliez-les en mode «&nbsp;Relier&nbsp;»,
            puis lancez le placement automatique.
          </p>
        </div>
      )}

      {mode === 'connect' && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white shadow">
          {connectFrom ? 'Cliquez sur l’équipement de destination' : 'Cliquez sur l’équipement de départ'}
        </div>
      )}
    </div>
  )
}
