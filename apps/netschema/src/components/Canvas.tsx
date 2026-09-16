import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LinkHandles } from './LinkHandles'
import { LinkShape, type PlacedLabel } from './LinkShape'
import { NodeShape } from './NodeShape'
import { LINKS } from '../lib/catalog'
import { deriveDiagram, groupMembers, type DisplayNode } from '../lib/derive'
import { setDiagramSvg } from '../lib/exportRegistry'
import { readProjectFile } from '../lib/storage'
import { linkColorFor, linkEndLabels, linkLabelFor } from '../lib/osi'
import { crossingCount, linkCrossings, overlappingPairs, type Crossing } from '../lib/crossings'
import { modeStyle } from '../lib/viewModes'
import { diagramBounds, groupBoxes, layerBands } from '../lib/layout'
import {
  insertIndexAt,
  linkGeometry,
  parallelOffsets,
  pathLength,
  pointAlong,
  pointToAttach,
  resolveSide,
  type LinkGeometry,
} from '../lib/routing'
import { labelSize, placeLabels, type LabelCandidate, type Rect } from '../lib/labels'
import { assignLanes, corridorOf, spreadAnchors, type SpreadResult } from '../lib/spread'
import { GRID, useDiagram } from '../store/useDiagram'
import { useAudit } from '../store/useAudit'
import { DRAG_MIME } from '../lib/dnd'
import { NODE_H, NODE_W, type Attach, type DeviceKind, type NetLink } from '../types'

interface DragState {
  pointerId: number
  startX: number
  startY: number
  origins: Record<string, { x: number; y: number }>
}

/** Déplacement d'un point de passage de liaison (ou création par tirage du trait). */
interface LinkDragState {
  pointerId: number
  linkId: string
  index: number
  /** Vrai tant que le point n'est pas encore créé : il naîtra au premier mouvement. */
  pending: boolean
  startX: number
  startY: number
}

/** Déplacement d'une extrémité de liaison vers un équipement (et un point de sa boîte). */
interface EndpointDragState {
  pointerId: number
  linkId: string
  end: 'a' | 'b'
}

/** Glissement d'une étiquette de liaison. */
interface LabelDragState {
  pointerId: number
  linkId: string
  which: 'mid' | 'a' | 'b'
  anchor: { x: number; y: number }
}

/** Écart entre deux couloirs voisins quand des liaisons doivent être séparées. */
const LANE_STEP = 12

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
  const linkDragRef = useRef<LinkDragState | null>(null)
  const endpointDragRef = useRef<EndpointDragState | null>(null)
  const labelDragRef = useRef<LabelDragState | null>(null)
  /** Point d'accroche choisi sur l'équipement de départ, en mode « Relier ». */
  const connectAttachRef = useRef<Attach | null>(null)
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
  const showSites = useDiagram((s) => s.showSites)
  const showClusters = useDiagram((s) => s.showClusters)
  const showAudit = useDiagram((s) => s.showAudit)
  const showLayerLabels = useDiagram((s) => s.showLayerLabels)
  const showDetails = useDiagram((s) => s.showDetails)
  const linkStyle = useDiagram((s) => s.linkStyle)
  const showHops = useDiagram((s) => s.showHops)
  const spreadLinks = useDiagram((s) => s.spreadLinks)
  const viewMode = useDiagram((s) => s.viewMode)
  const direction = useDiagram((s) => s.layout.direction)

  const collapsed = useDiagram((s) => s.collapsed)
  const detail = useDiagram((s) => s.detail)
  const osi = useDiagram((s) => s.osi)
  const strictOsi = useDiagram((s) => s.strictOsi)

  /**
   * Le plan de travail n'affiche pas le schéma brut mais sa version dérivée : niveau de
   * détail appliqué et blocs repliés remplacés par un équipement unique. Le modèle, lui,
   * n'est jamais modifié.
   */
  const display = useMemo(
    () => deriveDiagram(diagram, { collapsed, detail, direction, osi, strictOsi }),
    [diagram, collapsed, detail, direction, osi, strictOsi],
  )

  const nodeById = useMemo(() => new Map(display.nodes.map((n) => [n.id, n])), [display.nodes])

  /** Un bloc replié représente plusieurs équipements réels : on agit sur ses membres. */
  const realIds = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const node of display.nodes) {
      map.set(node.id, node.group ? groupMembers(diagram, node.group.key).map((n) => n.id) : [node.id])
    }
    return map
  }, [display.nodes, diagram])

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
    setDiagramSvg(svgRef.current)
    return () => setDiagramSvg(null)
  }, [svgRef])

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

  const onNodePointerDown = (event: React.PointerEvent<SVGGElement>, node: DisplayNode) => {
    event.stopPropagation()
    const store = useDiagram.getState()

    if (mode === 'connect') {
      // Cliquer près d'un bord fixe le point d'accroche de ce côté ; cliquer au centre
      // laisse l'accroche se calculer, comme avant.
      const point = toDiagram(event.clientX, event.clientY)
      const attach = edgeAttach(node, point)
      if (!connectFrom) {
        connectAttachRef.current = attach
        store.setConnectFrom(node.id)
        store.select({ nodes: [node.id] })
      } else if (connectFrom === node.id) {
        connectAttachRef.current = null
        store.setConnectFrom(null)
      } else {
        store.addLink(connectFrom, node.id, {
          attachA: connectAttachRef.current ?? undefined,
          attachB: attach ?? undefined,
        })
        connectAttachRef.current = null
        store.setConnectFrom(null)
      }
      return
    }

    const additive = event.shiftKey
    const own = realIds.get(node.id) ?? [node.id]
    const alreadySelected = own.every((id) => selectedNodes.includes(id))
    const ids = additive
      ? alreadySelected
        ? selectedNodes.filter((id) => !own.includes(id))
        : [...new Set([...selectedNodes, ...own])]
      : alreadySelected
        ? selectedNodes
        : own
    store.select({ nodes: ids })
    if (ids.length === 0) return

    store.pushHistory()
    const origins: Record<string, { x: number; y: number }> = {}
    for (const id of ids) {
      const target = store.diagram.nodes.find((n) => n.id === id)
      if (target) origins[id] = { x: target.x, y: target.y }
    }
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origins }
    ;(event.currentTarget as SVGGElement).setPointerCapture?.(event.pointerId)
  }

  /** Une liaison de la vue dérivée (blocs repliés) n'est pas modifiable telle quelle. */
  const isRealLink = (id: string) => diagram.links.some((link) => link.id === id)

  const onLinkPointerDown = (
    event: React.PointerEvent<SVGPathElement>,
    link: NetLink,
    geometry: LinkGeometry,
  ) => {
    event.stopPropagation()
    const store = useDiagram.getState()
    store.select({ links: [link.id] }, event.shiftKey)
    if (!isRealLink(link.id) || event.shiftKey) return

    // Tirer le trait lui-même pose un point de passage à cet endroit : c'est le geste
    // attendu quand on veut « faire passer la liaison par là ».
    const point = toDiagram(event.clientX, event.clientY)
    linkDragRef.current = {
      pointerId: event.pointerId,
      linkId: link.id,
      index: insertIndexAt(geometry, point),
      pending: true,
      startX: event.clientX,
      startY: event.clientY,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const beginWaypointDrag = (
    event: React.PointerEvent<SVGCircleElement>,
    link: NetLink,
    index: number,
    insert: boolean,
    point?: { x: number; y: number },
  ) => {
    event.stopPropagation()
    if (!isRealLink(link.id)) return
    const store = useDiagram.getState()
    store.select({ links: [link.id] })
    store.pushHistory()
    if (insert && point) {
      const waypoints = [...(link.waypoints ?? [])]
      waypoints.splice(index, 0, point)
      store.setLinkWaypoints(link.id, waypoints)
    }
    linkDragRef.current = {
      pointerId: event.pointerId,
      linkId: link.id,
      index,
      pending: false,
      startX: event.clientX,
      startY: event.clientY,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  /**
   * Équipement réel sous le pointeur. Les blocs repliés sont ignorés : ils représentent
   * plusieurs équipements, on ne saurait pas auquel accrocher la liaison.
   */
  /**
   * Accroche déduite d'un clic sur un équipement : seulement si le clic tombe dans la bande
   * proche du bord, là où l'on désigne visiblement un point de branchement précis.
   */
  const edgeAttach = (node: { x: number; y: number }, point: { x: number; y: number }): Attach | null => {
    const margin = 14
    const nearEdge =
      Math.abs(point.x - node.x) > NODE_W / 2 - margin || Math.abs(point.y - node.y) > NODE_H / 2 - margin
    return nearEdge ? pointToAttach(node, point) : null
  }

  const nodeAt = (point: { x: number; y: number }) => {
    for (let i = display.nodes.length - 1; i >= 0; i -= 1) {
      const node = display.nodes[i]
      if (node.group) continue
      if (Math.abs(point.x - node.x) <= NODE_W / 2 && Math.abs(point.y - node.y) <= NODE_H / 2) return node
    }
    return null
  }

  const beginEndpointDrag = (event: React.PointerEvent<SVGRectElement>, link: NetLink, end: 'a' | 'b') => {
    event.stopPropagation()
    if (!isRealLink(link.id)) return
    const store = useDiagram.getState()
    store.select({ links: [link.id] })
    store.pushHistory()
    endpointDragRef.current = { pointerId: event.pointerId, linkId: link.id, end }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const removeWaypoint = (link: NetLink, index: number) => {
    if (!isRealLink(link.id)) return
    const store = useDiagram.getState()
    store.pushHistory()
    store.setLinkWaypoints(
      link.id,
      (link.waypoints ?? []).filter((_, position) => position !== index),
    )
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

    const labelDrag = labelDragRef.current
    if (labelDrag) {
      const point = toDiagram(event.clientX, event.clientY)
      useDiagram.getState().setLabelOffset(labelDrag.linkId, labelDrag.which, {
        dx: Math.round(point.x - labelDrag.anchor.x),
        dy: Math.round(point.y - labelDrag.anchor.y),
      })
      return
    }

    const endpointDrag = endpointDragRef.current
    if (endpointDrag) {
      const point = toDiagram(event.clientX, event.clientY)
      const target = nodeAt(point)
      if (target) {
        useDiagram
          .getState()
          .attachLink(endpointDrag.linkId, endpointDrag.end, target.id, pointToAttach(target, point))
      }
      return
    }

    const linkDrag = linkDragRef.current
    if (linkDrag) {
      const moved = Math.hypot(event.clientX - linkDrag.startX, event.clientY - linkDrag.startY)
      if (linkDrag.pending && moved < 4) return
      const store = useDiagram.getState()
      const link = store.diagram.links.find((item) => item.id === linkDrag.linkId)
      if (!link) return
      const raw = toDiagram(event.clientX, event.clientY)
      const point = snap
        ? { x: Math.round(raw.x / GRID) * GRID, y: Math.round(raw.y / GRID) * GRID }
        : { x: Math.round(raw.x), y: Math.round(raw.y) }
      const waypoints = [...(link.waypoints ?? [])]
      if (linkDrag.pending) {
        store.pushHistory()
        waypoints.splice(linkDrag.index, 0, point)
        linkDragRef.current = { ...linkDrag, pending: false }
      } else {
        waypoints[linkDrag.index] = point
      }
      store.setLinkWaypoints(link.id, waypoints)
      return
    }

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
    linkDragRef.current = null
    endpointDragRef.current = null
    labelDragRef.current = null
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()

    // Un fichier lâché sur le plan de travail est un schéma à ouvrir (projet ou draw.io).
    const file = event.dataTransfer.files?.[0]
    if (file) {
      void readProjectFile(file)
        .then(({ diagram: loaded, warnings }) => {
          const store = useDiagram.getState()
          store.loadDiagram(loaded)
          store.notify(
            `« ${file.name} » chargé : ${loaded.nodes.length} équipement(s).` +
              (warnings.length > 0 ? ` ${warnings[0]}` : ''),
          )
        })
        .catch((error: unknown) =>
          useDiagram.getState().notify(error instanceof Error ? error.message : 'Fichier illisible.'),
        )
      return
    }

    const kind = event.dataTransfer.getData(DRAG_MIME) as DeviceKind
    if (!kind) return
    const point = toDiagram(event.clientX, event.clientY)
    const x = snap ? Math.round(point.x / GRID) * GRID : Math.round(point.x)
    const y = snap ? Math.round(point.y / GRID) * GRID : Math.round(point.y)
    useDiagram.getState().addNode(kind, x, y)
  }

  const report = useAudit()
  const flagged = useMemo(() => {
    if (!showAudit) return new Set<string>()
    return new Set(report.findings.filter((f) => f.severity === 'critique').flatMap((f) => f.nodeIds))
  }, [report, showAudit])

  /** Adresse virtuelle portée par chaque grappe, affichée sur son cadre. */
  const clusterVips = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of diagram.nodes) {
      const cluster = node.cluster?.trim()
      const vip = node.vip?.trim()
      if (cluster && vip && !map.has(cluster)) map.set(cluster, vip)
    }
    return map
  }, [diagram.nodes])

  // Les cadres de groupe ne s'appuient que sur les équipements réellement affichés :
  // un groupe replié est déjà représenté par son bloc, inutile de l'encadrer.
  const framed = display.nodes.filter((node) => !node.group)
  const bounds = diagramBounds(display.nodes)
  const bands = showLayerLabels ? layerBands(display.nodes, direction) : []
  const sites = showSites ? groupBoxes(framed, (n) => n.site, 50, 28, direction) : []
  const zones = showZones ? groupBoxes(framed, (n) => n.zone, 26, 14, direction) : []
  const clusters = showClusters ? groupBoxes(framed, (n) => n.cluster, 11, 13, direction) : []

  // Étalement des liaisons parallèles (deux équipements reliés par plusieurs câbles).
  const linkOffsets = useMemo(() => {
    const groups = new Map<string, NetLink[]>()
    for (const link of display.links) {
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
  }, [display.links])

  const style = modeStyle(viewMode)

  /**
   * Répartition des accroches : sans elle, toutes les liaisons quittant un équipement par le
   * même côté partent du même point et se superposent. Les accroches posées à la main sont
   * laissées telles quelles — c'est la seule façon d'obtenir deux liaisons confondues, et
   * c'est alors un choix.
   */
  const spreads = useMemo(() => {
    if (!spreadLinks) return new Map<string, SpreadResult>()
    const inputs = display.links.flatMap((link) => {
      const from = nodeById.get(link.from)
      const to = nodeById.get(link.to)
      if (!from || !to) return []
      const waypoints = link.waypoints ?? []
      const towardA = waypoints[0] ?? { x: to.x, y: to.y }
      const towardB = waypoints[waypoints.length - 1] ?? { x: from.x, y: from.y }
      // Un tracé dessiné à la main ne se fait pas déplacer, pas même ses accroches.
      const drawn = waypoints.length > 0
      return [
        {
          id: link.id,
          a: {
            nodeId: link.from,
            side: resolveSide(from, towardA, { forced: link.anchorA, attach: link.attachA }),
            toward: towardA,
            fixed: drawn || link.attachA !== undefined,
          },
          b: {
            nodeId: link.to,
            side: resolveSide(to, towardB, { forced: link.anchorB, attach: link.attachB }),
            toward: towardB,
            fixed: drawn || link.attachB !== undefined,
          },
        },
      ]
    })
    return spreadAnchors(inputs)
  }, [display.links, nodeById, spreadLinks])

  /**
   * Tracés calculés une fois pour toutes : les liaisons en ont besoin pour se dessiner, et
   * la recherche des croisements pour comparer les lignes brisées entre elles.
   */
  const geometries = useMemo(() => {
    const build = (lanes: Map<string, number>) => {
      const map = new Map<string, LinkGeometry>()
      for (const link of display.links) {
        const from = nodeById.get(link.from)
        const to = nodeById.get(link.to)
        if (!from || !to) continue
        map.set(
          link.id,
          linkGeometry(from, to, {
            style: linkStyle,
            shape: link.shape,
            offset: linkOffsets.get(link.id) ?? 0,
            waypoints: link.waypoints,
            anchorA: link.anchorA,
            anchorB: link.anchorB,
            attachA: link.attachA,
            attachB: link.attachB,
            offsetA: spreads.get(link.id)?.offsetA,
            offsetB: spreads.get(link.id)?.offsetB,
            lane: lanes.get(link.id),
          }),
        )
      }
      return map
    }

    const map = build(new Map())
    if (!spreadLinks) return map

    /*
     * Après la répartition des accroches, deux liaisons peuvent encore emprunter le même
     * couloir : on les range alors dans des couloirs voisins, comme des câbles dans un
     * chemin de câbles. Un tracé posé à la main garde le sien — les autres s'écartent
     * autour de lui.
     */
    const fixed = (link: NetLink) => (link.waypoints?.length ?? 0) > 0 || link.shape === 'straight'
    const corridors = display.links.flatMap((link) => {
      const geometry = map.get(link.id)
      if (!geometry) return []
      const corridor = corridorOf(link.id, geometry.points, fixed(link))
      return corridor ? [corridor] : []
    })
    const lanes = assignLanes(corridors, LANE_STEP)
    return lanes.size > 0 ? build(lanes) : map
  }, [display.links, nodeById, linkStyle, linkOffsets, spreads, spreadLinks])

  const crossings = useMemo(() => {
    if (!showHops) return new Map<string, Crossing[]>()
    return linkCrossings(
      display.links.flatMap((link) => {
        const geometry = geometries.get(link.id)
        if (!geometry) return []
        return [
          {
            id: link.id,
            points: geometry.points,
            ends: [link.from, link.to] as [string, string],
            hoppable: geometry.shape !== 'curved',
          },
        ]
      }),
    )
  }, [display.links, geometries, showHops])

  /**
   * Étiquettes : leur position est calculée ici, où l'on voit à la fois toutes les liaisons
   * et toutes les boîtes. Chacune se pose au plus près de son point d'ancrage, sans recouvrir
   * ni une autre étiquette ni un équipement ; celles que l'on a déplacées à la main gardent
   * leur place et les autres s'arrangent autour.
   */
  const labels = useMemo(() => {
    const byLink = new Map<string, PlacedLabel[]>()
    if (!showDetails) return byLink

    const size = style.labelSize
    const candidates: LabelCandidate[] = []
    const content = new Map<string, { lines: string[]; width: number; height: number; anchor: { x: number; y: number } }>()

    for (const link of display.links) {
      const geometry = geometries.get(link.id)
      if (!geometry) continue

      const middle = linkLabelFor(link, osi) || (style.labelAlways ? [link.label, link.speed].filter(Boolean).join(' · ') : '')
      const ends = linkEndLabels(link, osi)
      const entries: { which: 'mid' | 'a' | 'b'; lines: string[]; manual?: { dx: number; dy: number } }[] = []
      if (middle) entries.push({ which: 'mid', lines: [middle], manual: link.labelOffset })
      if (ends.a && ends.a.length > 0) entries.push({ which: 'a', lines: ends.a, manual: link.labelOffsetA })
      if (ends.b && ends.b.length > 0) entries.push({ which: 'b', lines: ends.b, manual: link.labelOffsetB })

      for (const entry of entries) {
        const spot =
          entry.which === 'mid'
            ? pointAlong(geometry.points, pathLength(geometry.points) / 2, false, 0.5)
            : pointAlong(geometry.points, 30, entry.which === 'b')
        const { width, height } = labelSize(entry.lines, entry.which === 'mid' ? size : size - 1)
        // Toutes les étiquettes se posent *à côté* du trait, jamais dessus : le trait reste
        // lisible, et l'étiquette ne se retrouve pas sous une poignée de tracé.
        const across = (entry.which === 'mid' ? 3 : 6) + height / 2
        const base = { dx: -spot.dy * across, dy: spot.dx * across }
        const id = `${link.id}:${entry.which}`
        candidates.push({
          id,
          anchor: { x: spot.x, y: spot.y },
          dir: { dx: spot.dx, dy: spot.dy },
          width,
          height,
          base,
          manual: entry.manual,
          priority: entry.which === 'mid' ? 1 : 0,
        })
        content.set(id, { lines: entry.lines, width, height, anchor: { x: spot.x, y: spot.y } })
      }
    }

    const obstacles: Rect[] = display.nodes.map((node) => ({
      x: node.x,
      y: node.y,
      width: NODE_W + 4,
      height: NODE_H + 4,
    }))
    const placements = placeLabels(candidates, obstacles)

    for (const candidate of candidates) {
      const placement = placements.get(candidate.id)
      const info = content.get(candidate.id)
      if (!placement || !info) continue
      const [linkId, which] = [candidate.id.slice(0, candidate.id.lastIndexOf(':')), candidate.id.slice(candidate.id.lastIndexOf(':') + 1)]
      const list = byLink.get(linkId) ?? []
      list.push({
        which: which as 'mid' | 'a' | 'b',
        lines: info.lines,
        x: placement.x,
        y: placement.y,
        width: info.width,
        height: info.height,
        size: which === 'mid' ? style.labelSize : style.labelSize - 1,
        anchor: info.anchor,
        manual: candidate.manual !== undefined,
      })
      byLink.set(linkId, list)
    }
    return byLink
  }, [display.links, display.nodes, geometries, osi, showDetails, style])

  const beginLabelDrag = (event: React.PointerEvent<SVGGElement>, link: NetLink, label: PlacedLabel) => {
    event.stopPropagation()
    if (!isRealLink(link.id)) return
    const store = useDiagram.getState()
    store.select({ links: [link.id] })
    store.pushHistory()
    labelDragRef.current = {
      pointerId: event.pointerId,
      linkId: link.id,
      which: label.which,
      anchor: label.anchor,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const hopCount = crossingCount(crossings)
  /** Liaisons encore confondues : c'est la mesure de ce qui reste illisible. */
  const overlapCount = useMemo(
    () => overlappingPairs([...geometries].map(([id, geometry]) => ({ id, points: geometry.points }))).length,
    [geometries],
  )

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
          {sites.map((site) => (
            <g key={`site-${site.key}`}>
              <rect
                x={site.x}
                y={site.y}
                width={site.width}
                height={site.height}
                rx={22}
                fill="#0f172a"
                fillOpacity={0.03}
                stroke="#cbd5e1"
                strokeWidth={1.6}
              />
              {site.label && (
                <text x={site.x + 18} y={site.y + 22} fontSize={12.5} fontWeight={700} fill="#64748b">
                  {`SITE — ${site.label.toUpperCase()}`}
                </text>
              )}
            </g>
          ))}

          {zones.map((zone) => (
            <g key={`zone-${zone.key}`}>
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
              {zone.label && (
                <text x={zone.x + 14} y={zone.y + 17} fontSize={11} fontWeight={700} fill="#64748b">
                  {zone.label.toUpperCase()}
                </text>
              )}
            </g>
          ))}

          {clusters.map((cluster) => (
            <g key={`cluster-${cluster.key}`}>
              <rect
                x={cluster.x}
                y={cluster.y}
                width={cluster.width}
                height={cluster.height}
                rx={12}
                fill="#db2777"
                fillOpacity={0.04}
                stroke="#db2777"
                strokeWidth={1.2}
                strokeDasharray="4 4"
              />
              {cluster.label && (
                <text x={cluster.x + 12} y={cluster.y + 16} fontSize={9.5} fontWeight={700} fill="#db2777">
                  {`GRAPPE ${cluster.label}${
                    clusterVips.get(cluster.label) ? ` · VIP ${clusterVips.get(cluster.label)}` : ''
                  }`}
                </text>
              )}
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

          {display.links.map((link) => {
            const geometry = geometries.get(link.id)
            if (!geometry) return null
            return (
              <LinkShape
                key={link.id}
                link={link}
                geometry={geometry}
                selected={selectedLinks.includes(link.id)}
                labels={labels.get(link.id) ?? []}
                hops={crossings.get(link.id) ?? []}
                color={linkColorFor(link, osi, diagram.vlans) ?? LINKS[link.kind].color}
                dimmed={display.dimmed.has(link.id)}
                editable={isRealLink(link.id)}
                style={style}
                onPointerDown={onLinkPointerDown}
                onLabelDown={beginLabelDrag}
                onLabelReset={(target, label) => {
                  const store = useDiagram.getState()
                  store.pushHistory()
                  store.setLabelOffset(target.id, label.which, null)
                }}
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

          {display.nodes.map((node) => {
            const own = realIds.get(node.id) ?? [node.id]
            return (
              <NodeShape
                key={node.id}
                node={node}
                selected={own.every((id) => selectedNodes.includes(id))}
                isConnectSource={connectFrom === node.id}
                showDetails={showDetails}
                flagged={own.some((id) => flagged.has(id))}
                dimmed={display.dimmed.has(node.id)}
                style={style}
                onPointerDown={onNodePointerDown}
                onDoubleClick={() => node.group && useDiagram.getState().toggleCollapse(node.group.key)}
              />
            )
          })}

          {/* Poignées de tracé : au-dessus des équipements pour rester attrapables. */}
          {display.links.map((link) => {
            if (!selectedLinks.includes(link.id) || !isRealLink(link.id)) return null
            const from = nodeById.get(link.from)
            const to = nodeById.get(link.to)
            if (!from || !to) return null
            return (
              <LinkHandles
                key={`handles-${link.id}`}
                link={link}
                from={from}
                to={to}
                style={linkStyle}
                offset={linkOffsets.get(link.id) ?? 0}
                onWaypointDown={(event, target, index) => beginWaypointDrag(event, target, index, false)}
                onWaypointRemove={removeWaypoint}
                onInsertDown={(event, target, index, point) =>
                  beginWaypointDrag(event, target, index, true, point)
                }
                onEndpointDown={beginEndpointDrag}
                onEndpointReset={(target) => useDiagram.getState().clearLinkAttach(target.id)}
              />
            )
          })}
        </g>
      </svg>

      {(display.hiddenNodes > 0 || collapsed.length > 0 || hopCount > 0 || overlapCount > 0) && (
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-lg bg-white/90 px-3 py-1.5 text-[11px] text-slate-500 shadow-sm ring-1 ring-slate-200">
          {[
            collapsed.length > 0 ? `${collapsed.length} groupe(s) replié(s)` : null,
            display.hiddenNodes > 0 ? `${display.hiddenNodes} équipement(s) masqué(s)` : null,
            hopCount > 0 ? `${hopCount} croisement(s) enjambé(s)` : null,
            overlapCount > 0 ? `${overlapCount} liaison(s) encore superposée(s)` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}

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
