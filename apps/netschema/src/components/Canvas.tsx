import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LinkHandles } from './LinkHandles'
import { LinkShape, type PlacedLabel } from './LinkShape'
import { LinkTooltip } from './LinkTooltip'
import { NodeTooltip } from './NodeTooltip'
import { NodeShape } from './NodeShape'
import { LINKS, rankOf } from '../lib/catalog'
import { deriveDiagram, groupMembers, type DisplayNode } from '../lib/derive'
import { setDiagramSvg } from '../lib/exportRegistry'
import { readProjectFile } from '../lib/storage'
import { linkColorFor, linkEndLabels, linkLabelFor } from '../lib/osi'
import { crossingCount, linkCrossings, overlappingPairs, type Crossing } from '../lib/crossings'
import { modeStyle } from '../lib/viewModes'
import { analyseImpact, COULEURS_IMPACT } from '../lib/impact'
import { diagramBounds, groupBoxes, layerBands } from '../lib/layout'
import {
  insertIndexAt,
  linkGeometry,
  parallelOffsets,
  pathLength,
  pointAlong,
  snapAttach,
  ANCHOR_RING,
  attachToPoint,
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
  /** Boîte survolée pendant qu'on pose une accroche, et repère retenu : c'est l'aide visuelle. */
  const [accroche, setAccroche] = useState<{ nodeId: string; attach: Attach } | null>(null)
  /**
   * Renommage sur le schéma : couche, site, zone ou grappe. Le champ est posé en HTML par
   * dessus le plan — un champ de saisie dans du SVG ne se comporte pas pareil d'un navigateur
   * à l'autre.
   */
  const [edition, setEdition] = useState<{
    type: 'layer' | 'site' | 'zone' | 'cluster'
    cle: string
    valeur: string
    x: number
    y: number
  } | null>(null)
  /** Le second clic d'un double-clic vole le focus au champ à peine affiché : on l'ignore. */
  const editionFraiche = useRef(false)
  const layerDragRef = useRef<{
    pointerId: number
    rang: number
    bord: 'deplacer' | 'debut' | 'fin' | 'marge'
    depart: { x: number; y: number }
    cadre: { x: number; y: number; width: number; height: number; centreX: number; centreY: number }
    padDepart: number
  } | null>(null)
  /** Liaison survolée et position du pointeur : c'est ce que l'info-bulle affiche. */
  const [hovered, setHovered] = useState<{ link: NetLink; x: number; y: number } | null>(null)
  /** Équipement survolé : même mécanique que pour les liaisons, même délai. */
  const [hoveredNode, setHoveredNode] = useState<{ node: DisplayNode; x: number; y: number } | null>(null)
  const nodeHoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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
  const canvasSize = useDiagram((s) => s.canvasSize)
  /** Schéma verrouillé : lecture seule. Étiquettes verrouillées : elles ne se déplacent plus. */
  const locked = useDiagram((s) => s.diagram.locked === true)
  const panel = useDiagram((s) => s.panel)
  // Le catalogue et les logos constructeurs arrivent après le premier rendu : s'abonner à leur
  // compteur de révision suffit à repeindre le plan quand ils sont là.
  const catalogRevision = useDiagram((s) => s.catalogRevision)
  const pannes = useDiagram((s) => s.pannes)
  const labelsLocked = useDiagram((s) => s.diagram.labelsLocked === true)
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

    // Analyse d'impact : le clic déclare une panne. Le schéma n'est pas modifié.
    if (panel === 'impact' && !node.group) {
      store.togglePanne('node', node.id)
      return
    }
    // Schéma verrouillé : on peut encore sélectionner pour consulter la fiche, pas déplacer.
    if (locked) {
      store.select({ nodes: node.group ? [] : [node.id] })
      return
    }

    if (mode === 'connect') {
      // Cliquer près d'un bord fixe le point d'accroche de ce côté ; cliquer au centre
      // laisse l'accroche se calculer, comme avant.
      const point = toDiagram(event.clientX, event.clientY)
      const attach = edgeAttach(node, point, event.altKey)
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

    // Analyse d'impact : cliquer une liaison la débranche, le temps de la simulation.
    if (panel === 'impact' && isRealLink(link.id)) {
      store.togglePanne('link', link.id)
      return
    }

    store.select({ links: [link.id] }, event.shiftKey)
    if (locked || !isRealLink(link.id) || event.shiftKey) return

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
    if (locked || !isRealLink(link.id)) return
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
  const edgeAttach = (
    node: { x: number; y: number },
    point: { x: number; y: number },
    libre = false,
  ): Attach | null => {
    // Zone morte au centre : cliquer sur le nom ou l'icône laisse l'accroche se calculer toute
    // seule, comme avant. Partout ailleurs, on désigne un point précis.
    const margin = 20
    const nearEdge =
      Math.abs(point.x - node.x) > NODE_W / 2 - margin || Math.abs(point.y - node.y) > NODE_H / 2 - margin
    return nearEdge ? snapAttach(node, point, libre) : null
  }

  /**
   * Équipement sous le pointeur. `marge` élargit la zone : en tirant une extrémité, on vise le
   * bord d'une boîte, et le pointeur déborde forcément un peu.
   */
  const nodeAt = (point: { x: number; y: number }, marge = 0) => {
    for (let i = display.nodes.length - 1; i >= 0; i -= 1) {
      const node = display.nodes[i]
      if (node.group) continue
      if (
        Math.abs(point.x - node.x) <= NODE_W / 2 + marge &&
        Math.abs(point.y - node.y) <= NODE_H / 2 + marge
      ) {
        return node
      }
    }
    return null
  }

  const beginEndpointDrag = (event: React.PointerEvent<SVGRectElement>, link: NetLink, end: 'a' | 'b') => {
    event.stopPropagation()
    if (locked || !isRealLink(link.id)) return
    const store = useDiagram.getState()
    store.select({ links: [link.id] })
    store.pushHistory()
    endpointDragRef.current = { pointerId: event.pointerId, linkId: link.id, end }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const removeWaypoint = (link: NetLink, index: number) => {
    if (locked || !isRealLink(link.id)) return
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
    if (mode === 'connect') {
      const point = toDiagram(event.clientX, event.clientY)
      if (connectFrom) setCursor(point)
      // Survol en mode Relier : on montre où la liaison se branchera si l'on clique ici.
      const survole = nodeAt(point)
      if (survole && !endpointDragRef.current) {
        const attach = edgeAttach(survole, point, event.altKey)
        setAccroche(attach ? { nodeId: survole.id, attach } : { nodeId: survole.id, attach: { dx: 0, dy: 0 } })
      } else if (!endpointDragRef.current) {
        setAccroche(null)
      }
    }

    const labelDrag = labelDragRef.current
    if (labelDrag) {
      const point = toDiagram(event.clientX, event.clientY)
      useDiagram.getState().setLabelOffset(labelDrag.linkId, labelDrag.which, {
        dx: Math.round(point.x - labelDrag.anchor.x),
        dy: Math.round(point.y - labelDrag.anchor.y),
      })
      return
    }

    const layerDrag = layerDragRef.current
    if (layerDrag) {
      const point = toDiagram(event.clientX, event.clientY)
      const dx = point.x - layerDrag.depart.x
      const dy = point.y - layerDrag.depart.y
      const store = useDiagram.getState()
      const long = direction === 'TB' ? 'x' : 'y'

      if (layerDrag.bord === 'deplacer') {
        store.moveLayer(layerDrag.rang, dx, dy)
        layerDrag.depart = point
      } else if (layerDrag.bord === 'marge') {
        // Bord en travers : la marge du cadre, sans toucher aux équipements.
        const sens = direction === 'TB' ? dy : dx
        store.setLayerPad(layerDrag.rang, layerDrag.padDepart + (point.y < layerDrag.cadre.centreY ? -sens : sens))
      } else {
        // Bord long : on étale ou resserre la couche autour du bord opposé.
        const demi = (direction === 'TB' ? layerDrag.cadre.width : layerDrag.cadre.height) / 2
        const deplacement = long === 'x' ? dx : dy
        const signe = layerDrag.bord === 'fin' ? 1 : -1
        const facteur = demi > 10 ? Math.max(0.25, (demi + signe * deplacement) / demi) : 1
        const ancre = direction === 'TB' ? layerDrag.cadre.centreX : layerDrag.cadre.centreY
        store.spreadLayer(layerDrag.rang, facteur, ancre, long)
        layerDrag.depart = point
        layerDrag.cadre = {
          ...layerDrag.cadre,
          width: direction === 'TB' ? demi * 2 * facteur : layerDrag.cadre.width,
          height: direction === 'TB' ? layerDrag.cadre.height : demi * 2 * facteur,
        }
      }
      return
    }

    const endpointDrag = endpointDragRef.current
    if (endpointDrag) {
      const point = toDiagram(event.clientX, event.clientY)
      const target = nodeAt(point, 26)
      if (target) {
        const attach = snapAttach(target, point, event.altKey)
        setAccroche({ nodeId: target.id, attach })
        useDiagram.getState().attachLink(endpointDrag.linkId, endpointDrag.end, target.id, attach)
      } else {
        setAccroche(null)
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
    layerDragRef.current = null
    setAccroche(null)
    clearTimeout(nodeHoverTimer.current)
    setHoveredNode(null)
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (locked) {
      useDiagram.getState().notify('Schéma verrouillé : déverrouillez-le pour le modifier.')
      return
    }

    // Un fichier lâché sur le plan de travail est un schéma à ouvrir (projet ou draw.io).
    const file = event.dataTransfer.files?.[0]
    if (file) {
      void readProjectFile(file)
        .then(({ classeur, warnings }) => {
          const store = useDiagram.getState()
          store.loadClasseur(classeur)
          const equipements = classeur.pages.reduce((total, page) => total + page.nodes.length, 0)
          store.notify(
            `« ${file.name} » chargé : ${equipements} équipement(s), ${classeur.pages.length} page(s).` +
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
  const bands = showLayerLabels ? layerBands(display.nodes, direction, diagram.layerNames) : []

  /**
   * Cadres de couche : le rectangle qui entoure les équipements d'un même rang. Il n'existait
   * que comme étiquette en marge ; on le dessine pour pouvoir le saisir — le déplacer emmène
   * la couche, l'étirer étale ses équipements, ses bords longs règlent sa marge.
   */
  const cadresCouches = useMemo(() => {
    void catalogRevision
    if (!showLayerLabels) return []
    const parRang = new Map<number, DisplayNode[]>()
    for (const node of display.nodes) {
      const rang = rankOf(node.kind, node.rank)
      const liste = parRang.get(rang)
      if (liste) liste.push(node)
      else parRang.set(rang, [node])
    }
    return [...parRang.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rang, noeuds]) => {
        const marge = 18 + (diagram.layerPads?.[String(rang)] ?? 0)
        const minX = Math.min(...noeuds.map((n) => n.x)) - NODE_W / 2
        const maxX = Math.max(...noeuds.map((n) => n.x)) + NODE_W / 2
        const minY = Math.min(...noeuds.map((n) => n.y)) - NODE_H / 2
        const maxY = Math.max(...noeuds.map((n) => n.y)) + NODE_H / 2
        // La couche s'étire dans le sens de la mise en page : marge large dans ce sens,
        // resserrée en travers, pour que deux couches voisines ne se recouvrent pas.
        const padLong = direction === 'TB' ? 26 : marge
        const padTravers = direction === 'TB' ? marge : 26
        return {
          rang,
          noeuds,
          x: minX - padLong,
          y: minY - padTravers,
          width: maxX - minX + padLong * 2,
          height: maxY - minY + padTravers * 2,
          centreX: (minX + maxX) / 2,
          centreY: (minY + maxY) / 2,
        }
      })
  }, [showLayerLabels, display.nodes, direction, diagram.layerPads, catalogRevision])
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
   * Analyse d'impact : elle ne s'affiche que lorsque son panneau est ouvert — c'est une
   * lecture du schéma, pas un état permanent, et le calcul a un coût.
   */
  const impact = useMemo(
    () => (panel === 'impact' ? analyseImpact(diagram, pannes) : null),
    [panel, diagram, pannes],
  )

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

      // Chaque mode montre ce qu'on vient y chercher : l'architecture, le débit ; la
      // documentation, les ports des deux bouts ; la présentation, rien du tout.
      const middle = style.linkLabels
        ? linkLabelFor(link, osi) || (style.labelAlways ? [link.label, link.speed].filter(Boolean).join(' · ') : '')
        : ''
      // Deux raisons d'écrire aux extrémités : le mode technique, qui documente tout, et une
      // couche OSI choisie explicitement — on y vient pour voir les ports ou les adresses.
      const ends = style.endLabels || osi !== 'all' ? linkEndLabels(link, osi, style.endLabels) : {}
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
    // Le store a besoin de ces positions pour pouvoir les figer au verrouillage.
    const offsets = new Map<string, { dx: number; dy: number }>()
    for (const candidate of candidates) {
      const placement = placements.get(candidate.id)
      if (placement) {
        offsets.set(candidate.id, {
          dx: Math.round(placement.x - candidate.anchor.x),
          dy: Math.round(placement.y - candidate.anchor.y),
        })
      }
    }
    useDiagram.getState().publishLabelPlacements(offsets)

    return byLink
  }, [display.links, display.nodes, geometries, osi, showDetails, style])

  /**
   * Survol d'une liaison. Un court délai évite que l'info-bulle clignote quand on traverse
   * le schéma, et tout geste en cours (déplacement, tracé) la fait disparaître.
   */
  const onLinkHover = (link: NetLink | null, event?: React.PointerEvent<SVGPathElement>) => {
    clearTimeout(hoverTimer.current)
    if (link) {
      clearTimeout(nodeHoverTimer.current)
      setHoveredNode(null)
    }
    if (!link || !event || dragRef.current || linkDragRef.current || labelDragRef.current || endpointDragRef.current) {
      setHovered(null)
      return
    }
    const rect = containerRef.current?.getBoundingClientRect()
    const x = event.clientX - (rect?.left ?? 0)
    const y = event.clientY - (rect?.top ?? 0)
    if (hovered?.link.id === link.id) {
      setHovered({ link, x, y })
      return
    }
    hoverTimer.current = setTimeout(() => setHovered({ link, x, y }), 260)
  }

  /**
   * Survol d'un équipement. Un bloc replié n'a pas de fiche : il en contient plusieurs, et
   * c'est son contenu qu'on veut voir — un double-clic l'ouvre.
   */
  const onNodeHover = (node: DisplayNode | null, event?: React.PointerEvent<SVGGElement>) => {
    clearTimeout(nodeHoverTimer.current)
    if (
      !node ||
      !event ||
      node.group ||
      dragRef.current ||
      linkDragRef.current ||
      labelDragRef.current ||
      endpointDragRef.current
    ) {
      setHoveredNode(null)
      return
    }
    const rect = containerRef.current?.getBoundingClientRect()
    const x = event.clientX - (rect?.left ?? 0)
    const y = event.clientY - (rect?.top ?? 0)
    if (hoveredNode?.node.id === node.id) {
      setHoveredNode({ node, x, y })
      return
    }
    nodeHoverTimer.current = setTimeout(() => setHoveredNode({ node, x, y }), 320)
  }

  /**
   * Prise en main d'un cadre de couche : déplacement en bloc, ou étirement par un bord.
   * `bord` vaut 'deplacer' pour le corps du cadre, ou le bord saisi.
   */
  const beginLayerDrag = (
    event: React.PointerEvent<SVGElement>,
    rang: number,
    bord: 'deplacer' | 'debut' | 'fin' | 'marge',
    cadre: { x: number; y: number; width: number; height: number; centreX: number; centreY: number },
  ) => {
    event.stopPropagation()
    if (locked) {
      useDiagram.getState().notify('Schéma verrouillé : déverrouillez-le pour le modifier.')
      return
    }
    useDiagram.getState().pushHistory()
    const point = toDiagram(event.clientX, event.clientY)
    layerDragRef.current = {
      pointerId: event.pointerId,
      rang,
      bord,
      depart: point,
      cadre,
      padDepart: diagram.layerPads?.[String(rang)] ?? 0,
    }
    ;(event.currentTarget as SVGElement).setPointerCapture?.(event.pointerId)
  }

  /** Ouvre le champ de renommage à l'endroit du libellé double-cliqué. */
  const ouvrirEdition = (
    type: 'layer' | 'site' | 'zone' | 'cluster',
    cle: string,
    valeur: string,
    point: { x: number; y: number },
  ) => {
    if (locked) {
      useDiagram.getState().notify('Schéma verrouillé : déverrouillez-le pour le modifier.')
      return
    }
    setEdition({
      type,
      cle,
      valeur,
      x: point.x * view.zoom + view.tx,
      y: point.y * view.zoom + view.ty,
    })
    editionFraiche.current = true
    setTimeout(() => {
      editionFraiche.current = false
    }, 350)
  }

  const validerEdition = (valeur: string) => {
    if (!edition) return
    const store = useDiagram.getState()
    if (edition.type === 'layer') store.setLayerName(Number(edition.cle), valeur)
    else store.renameGroup(edition.type, edition.cle, valeur)
    setEdition(null)
  }

  const beginLabelDrag = (event: React.PointerEvent<SVGGElement>, link: NetLink, label: PlacedLabel) => {
    event.stopPropagation()
    if (locked || labelsLocked || !isRealLink(link.id)) return
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
            <g key={`site-${site.key}`} data-couche="groupe">
              <rect
                x={site.x}
                y={site.y}
                width={site.width}
                height={site.height}
                rx={22}
                fill="#0f172a"
                fillOpacity={0.03 * style.groupStrength}
                stroke={style.groupStrength > 1 ? '#94a3b8' : '#cbd5e1'}
                strokeWidth={1.6 * style.groupStrength}
              />
              {site.label && (
                <text
                  data-couche="groupe"
                  data-renommer={`site:${site.label}`}
                  x={site.x + 18}
                  y={site.y + 22}
                  fontSize={12.5}
                  fontWeight={700}
                  fill="#64748b"
                  pointerEvents="all"
                  style={{ cursor: 'text' }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    ouvrirEdition('site', site.label, site.label, { x: site.x + 18, y: site.y + 10 })
                  }}
                >
                  <title>Double-clic pour renommer ce site</title>
                  {`SITE — ${site.label.toUpperCase()}`}
                </text>
              )}
            </g>
          ))}

          {zones.map((zone) => (
            <g key={`zone-${zone.key}`} data-couche="groupe">
              <rect
                x={zone.x}
                y={zone.y}
                width={zone.width}
                height={zone.height}
                rx={16}
                fill="#0f172a"
                fillOpacity={0.025 * style.groupStrength}
                stroke="#94a3b8"
                strokeWidth={1.2 * style.groupStrength}
                strokeDasharray="7 6"
              />
              {zone.label && (
                <text
                  data-couche="groupe"
                  data-renommer={`zone:${zone.label}`}
                  x={zone.x + 14}
                  y={zone.y + 17}
                  fontSize={11}
                  fontWeight={700}
                  fill="#64748b"
                  pointerEvents="all"
                  style={{ cursor: 'text' }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    ouvrirEdition('zone', zone.label, zone.label, { x: zone.x + 14, y: zone.y + 6 })
                  }}
                >
                  <title>Double-clic pour renommer cette zone</title>
                  {zone.label.toUpperCase()}
                </text>
              )}
            </g>
          ))}

          {clusters.map((cluster) => (
            <g key={`cluster-${cluster.key}`} data-couche="groupe">
              <rect
                x={cluster.x}
                y={cluster.y}
                width={cluster.width}
                height={cluster.height}
                rx={12}
                fill="#db2777"
                fillOpacity={0.04 * style.groupStrength}
                stroke="#db2777"
                strokeWidth={1.2 * style.groupStrength}
                strokeDasharray="4 4"
              />
              {cluster.label && (
                <text
                  data-couche="groupe"
                  data-renommer={`cluster:${cluster.label}`}
                  x={cluster.x + 12}
                  y={cluster.y + 16}
                  fontSize={9.5}
                  fontWeight={700}
                  fill="#db2777"
                  pointerEvents="all"
                  style={{ cursor: 'text' }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    ouvrirEdition('cluster', cluster.label, cluster.label, { x: cluster.x + 12, y: cluster.y + 6 })
                  }}
                >
                  <title>Double-clic pour renommer cette grappe</title>
                  {/* L'adresse virtuelle est une donnée d'exploitation : elle n'a rien à faire
                      sur une vue de présentation. */}
                  {`GRAPPE ${cluster.label}${
                    style.annotations && clusterVips.get(cluster.label)
                      ? ` · VIP ${clusterVips.get(cluster.label)}`
                      : ''
                  }`}
                </text>
              )}
            </g>
          ))}

          {/*
            Cadres de couche : saisissables. Le corps déplace la couche entière, les bords longs
            l'étalent ou la resserrent, les bords en travers règlent la marge du cadre.
          */}
          {cadresCouches.map((cadre) => (
            <g key={`couche-${cadre.rang}`} data-couche="bande">
              {/* Le cadre ne prend pas les clics : à l'intérieur, on doit pouvoir saisir un
                  équipement ou une liaison comme d'habitude. */}
              <rect
                data-cadre={`couche-${cadre.rang}`}
                x={cadre.x}
                y={cadre.y}
                width={cadre.width}
                height={cadre.height}
                rx={14}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth={1}
                strokeDasharray="2 6"
                pointerEvents="none"
              />

            </g>
          ))}

          {bands.map((band) =>
            direction === 'TB' ? (
              <text
                key={band.rank}
                data-couche="bande"
                data-renommer={`layer:${band.rank}`}
                x={bounds.minX - 28}
                y={band.main + 4}
                textAnchor="end"
                fontSize={11}
                fontWeight={700}
                fill="#94a3b8"
                pointerEvents="all"
                style={{ cursor: 'text' }}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  ouvrirEdition('layer', String(band.rank), band.label, {
                    x: bounds.minX - 150,
                    y: band.main - 8,
                  })
                }}
              >
                <title>Double-clic pour renommer cette couche</title>
                {band.label}
              </text>
            ) : (
              <text
                key={band.rank}
                data-couche="bande"
                data-renommer={`layer:${band.rank}`}
                x={band.main}
                y={bounds.minY - 30}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="#94a3b8"
                pointerEvents="all"
                style={{ cursor: 'text' }}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  ouvrirEdition('layer', String(band.rank), band.label, {
                    x: band.main - 60,
                    y: bounds.minY - 44,
                  })
                }}
              >
                <title>Double-clic pour renommer cette couche</title>
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
                editable={!locked && isRealLink(link.id)}
                labelsEditable={!locked && !labelsLocked}
                style={style}
                onPointerDown={onLinkPointerDown}
                onHover={onLinkHover}
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
                onHover={onNodeHover}
              />
            )
          })}

          {/* Poignées de tracé : au-dessus des équipements pour rester attrapables. */}
          {display.links.map((link) => {
            if (locked || !selectedLinks.includes(link.id) || !isRealLink(link.id)) return null
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

          {/*
            Poignées des cadres de couche. Elles vivent dans la couche des poignées : posées
            plus bas, le tracé de saisie d'une liaison les recouvrirait.
          */}
          {cadresCouches.map((cadre) => (
            <g key={`poignees-couche-${cadre.rang}`} data-export="false">
              {/* Poignée de déplacement, posée en marge du cadre : elle ne recouvre rien. */}
              <g
                data-export="false"
                data-poignee={`couche-${cadre.rang}`}
                transform={`translate(${direction === 'TB' ? cadre.x - 9 : cadre.centreX - 14}, ${
                  direction === 'TB' ? cadre.centreY - 14 : cadre.y - 9
                })`}
                style={{ cursor: locked ? 'default' : 'move' }}
                onPointerDown={(event) => beginLayerDrag(event, cadre.rang, 'deplacer', cadre)}
              >
                <title>Glisser pour déplacer toute la couche</title>
                <rect
                  width={direction === 'TB' ? 18 : 28}
                  height={direction === 'TB' ? 28 : 18}
                  rx={6}
                  fill="#ffffff"
                  stroke="#cbd5e1"
                  strokeWidth={1.2}
                />
                {[0, 1, 2].map((rangee) => (
                  <g key={rangee} fill="#94a3b8">
                    <circle cx={direction === 'TB' ? 7 : 9 + rangee * 5} cy={direction === 'TB' ? 9 + rangee * 5 : 7} r={1.3} />
                    <circle cx={direction === 'TB' ? 11 : 9 + rangee * 5} cy={direction === 'TB' ? 9 + rangee * 5 : 11} r={1.3} />
                  </g>
                ))}
              </g>

              {/* Bords longs : étaler ou resserrer. */}
              {(direction === 'TB'
                ? [
                    { bord: 'debut' as const, x: cadre.x, y: cadre.y, w: 10, h: cadre.height, curseur: 'ew-resize' },
                    { bord: 'fin' as const, x: cadre.x + cadre.width - 10, y: cadre.y, w: 10, h: cadre.height, curseur: 'ew-resize' },
                    { bord: 'marge' as const, x: cadre.x, y: cadre.y, w: cadre.width, h: 8, curseur: 'ns-resize' },
                    { bord: 'marge' as const, x: cadre.x, y: cadre.y + cadre.height - 8, w: cadre.width, h: 8, curseur: 'ns-resize' },
                  ]
                : [
                    { bord: 'debut' as const, x: cadre.x, y: cadre.y, w: cadre.width, h: 10, curseur: 'ns-resize' },
                    { bord: 'fin' as const, x: cadre.x, y: cadre.y + cadre.height - 10, w: cadre.width, h: 10, curseur: 'ns-resize' },
                    { bord: 'marge' as const, x: cadre.x, y: cadre.y, w: 8, h: cadre.height, curseur: 'ew-resize' },
                    { bord: 'marge' as const, x: cadre.x + cadre.width - 8, y: cadre.y, w: 8, h: cadre.height, curseur: 'ew-resize' },
                  ]
              ).map((poignee, index) => (
                <rect
                  key={`poignee-${cadre.rang}-${poignee.bord}-${index}`}
                  data-export="false"
                  x={poignee.x}
                  y={poignee.y}
                  width={poignee.w}
                  height={poignee.h}
                  fill="transparent"
                  style={{ cursor: locked ? 'default' : poignee.curseur }}
                  onPointerDown={(event) => beginLayerDrag(event, cadre.rang, poignee.bord, cadre)}
                >
                  <title>
                    {poignee.bord === 'marge'
                      ? 'Glisser pour agrandir ou resserrer le cadre'
                      : 'Glisser pour étaler ou resserrer les équipements de la couche'}
                  </title>
                </rect>
              ))}
            </g>
          ))}

          {/*
            Analyse d'impact : un halo dit l'état de chaque équipement, sans toucher au dessin
            du schéma lui-même — on doit pouvoir lire les deux en même temps.
          */}
          {impact && (
            <g data-export="false" pointerEvents="none">
              {display.nodes.map((node) => {
                if (node.group) return null
                const etat = impact.etats.get(node.id)
                if (!etat || etat === 'intact') return null
                return (
                  <rect
                    key={`impact-${node.id}`}
                    x={node.x - NODE_W / 2 - 4}
                    y={node.y - NODE_H / 2 - 4}
                    width={NODE_W + 8}
                    height={NODE_H + 8}
                    rx={12}
                    fill={COULEURS_IMPACT[etat]}
                    fillOpacity={etat === 'panne' ? 0.2 : 0.11}
                    stroke={COULEURS_IMPACT[etat]}
                    strokeWidth={etat === 'panne' ? 2.4 : 1.8}
                    strokeDasharray={etat === 'fragile' ? '6 4' : undefined}
                  />
                )
              })}
              {/* Liaisons hors service : marquées d'une croix à mi-parcours. */}
              {display.links.map((link) => {
                if (!impact.liensCoupes.has(link.id)) return null
                const geometry = geometries.get(link.id)
                if (!geometry) return null
                const milieu = pointAlong(geometry.points, pathLength(geometry.points) / 2, false, 0.5)
                return (
                  <g
                    key={`coupe-${link.id}`}
                    stroke={COULEURS_IMPACT.panne}
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    transform={`translate(${milieu.x}, ${milieu.y})`}
                  >
                    <circle r={8} fill="#ffffff" stroke={COULEURS_IMPACT.panne} strokeWidth={1.6} />
                    <path d="M -4 -4 l 8 8" />
                    <path d="M 4 -4 l -8 8" />
                  </g>
                )
              })}

              {/* Croix sur ce qui est déclaré en panne : l'état le plus fort se voit de loin. */}
              {display.nodes.map((node) => {
                if (node.group || impact.etats.get(node.id) !== 'panne') return null
                return (
                  <g key={`croix-${node.id}`} stroke={COULEURS_IMPACT.panne} strokeWidth={3} strokeLinecap="round">
                    <path d={`M ${node.x - 14} ${node.y - 14} l 28 28`} />
                    <path d={`M ${node.x + 14} ${node.y - 14} l -28 28`} />
                  </g>
                )
              })}
            </g>
          )}

          {/*
            Repères d'accroche : ils n'apparaissent qu'au moment utile — quand on tire une
            extrémité ou qu'on relie — et disent, avant le clic, où la liaison se branchera.
          */}
          {accroche &&
            (() => {
              const cible = nodeById.get(accroche.nodeId)
              if (!cible) return null
              const retenu = attachToPoint(cible, accroche.attach)
              // Les repères gardent leur taille à l'écran : à 40 % de zoom, des pastilles
              // réduites d'autant ne se verraient plus.
              const echelle = 1 / Math.max(0.2, view.zoom)
              return (
                <g key="reperes" data-export="false" pointerEvents="none">
                  <rect
                    x={cible.x - NODE_W / 2 - 3}
                    y={cible.y - NODE_H / 2 - 3}
                    width={NODE_W + 6}
                    height={NODE_H + 6}
                    rx={10}
                    fill="none"
                    stroke="#059669"
                    strokeWidth={1.4 * echelle}
                    strokeDasharray={`${5 * echelle} ${4 * echelle}`}
                    opacity={0.75}
                  />
                  {ANCHOR_RING.map((repere) => {
                    const point = attachToPoint(cible, repere)
                    const actif =
                      Math.abs(repere.dx - accroche.attach.dx) < 0.01 &&
                      Math.abs(repere.dy - accroche.attach.dy) < 0.01
                    return (
                      <circle
                        key={`repere-${repere.dx}-${repere.dy}`}
                        cx={point.x}
                        cy={point.y}
                        r={(actif ? 5 : 2.8) * echelle}
                        fill={actif ? '#059669' : '#ffffff'}
                        stroke="#059669"
                        strokeWidth={(actif ? 2 : 1.2) * echelle}
                      />
                    )
                  })}
                  {/* Accroche posée entre deux repères (touche Alt) : on la montre quand même. */}
                  {!ANCHOR_RING.some(
                    (repere) =>
                      Math.abs(repere.dx - accroche.attach.dx) < 0.01 &&
                      Math.abs(repere.dy - accroche.attach.dy) < 0.01,
                  ) && (
                    <circle
                      cx={retenu.x}
                      cy={retenu.y}
                      r={5 * echelle}
                      fill="#059669"
                      stroke="#ffffff"
                      strokeWidth={1.6 * echelle}
                    />
                  )}
                </g>
              )
            })()}
        </g>
      </svg>

      {/* Renommage sur le schéma : couche, site, zone ou grappe. */}
      {edition && (
        <input
          data-export="false"
          autoFocus
          value={edition.valeur}
          onChange={(event) => setEdition({ ...edition, valeur: event.target.value })}
          onBlur={(event) => {
            // Ce premier retrait de focus n'est pas une validation : il vient du double-clic.
            if (editionFraiche.current) {
              event.currentTarget.focus()
              return
            }
            validerEdition(edition.valeur)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') validerEdition(edition.valeur)
            if (event.key === 'Escape') setEdition(null)
            event.stopPropagation()
          }}
          placeholder={edition.type === 'layer' ? 'Nom de la couche' : 'Nouveau nom'}
          className="absolute z-40 h-7 w-52 rounded-lg border border-blue-500 bg-white px-2 text-[12.5px] shadow-lg outline-none"
          style={{ left: Math.max(4, edition.x), top: Math.max(4, edition.y) }}
        />
      )}

      {hoveredNode && !hovered && (
        <NodeTooltip
          node={hoveredNode.node}
          links={diagram.links}
          nodes={diagram.nodes}
          x={hoveredNode.x}
          y={hoveredNode.y}
          width={canvasSize.width}
          height={canvasSize.height}
        />
      )}

      {hovered && (
        <LinkTooltip
          link={hovered.link}
          from={diagram.nodes.find((node) => node.id === hovered.link.from)}
          to={diagram.nodes.find((node) => node.id === hovered.link.to)}
          x={hovered.x}
          y={hovered.y}
          width={canvasSize.width}
          height={canvasSize.height}
        />
      )}

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
