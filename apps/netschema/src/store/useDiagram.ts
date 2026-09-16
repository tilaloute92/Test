import { create } from 'zustand'
import { autoLayout, diagramBounds } from '../lib/layout'
import { deviceMeta, findDevice, ROLES } from '../lib/catalog'
import { bestMatch } from '../lib/speech'
import { searchModels } from '../lib/vendors'
import { STATUS_LABELS } from '../lib/inventory'
import { uid } from '../lib/ids'
import { HA_PATTERNS, instantiatePattern, type HaPattern } from '../lib/patterns'
import { suggestLinkKind } from '../lib/linkRules'
import { parseQuickImport } from '../lib/quickImport'
import { diagramFileContent, emptyDiagram, loadLocal, saveLocal } from '../lib/storage'
import { sampleDiagram } from '../lib/sample'
import { collapsibleGroups } from '../lib/derive'
import { auditDiagram } from '../lib/ha'
import type { DiscoveryResult } from '../lib/discovery'
import { downloadBlob, downloadPng, downloadSvg, slugify } from '../lib/exportImage'
import { getDiagramSvg } from '../lib/exportRegistry'
import { interpret } from '../lib/voice'
import { inventoryFromCsv } from '../lib/inventory'
import { deduceVlans } from '../lib/osi'
import { modeDefinition } from '../lib/viewModes'
import { firstFreeUnit, heightOf, rackOccupancy } from '../lib/racks'
import type {
  AppView,
  Attach,
  DetailLevel,
  Diagram,
  DeviceKind,
  LayoutOptions,
  LinkStyle,
  NetLink,
  NetNode,
  OsiView,
  RackDef,
  ViewMode,
  VlanDef,
  Waypoint,
  ZOrder,
} from '../types'

const DEFAULT_LAYOUT: LayoutOptions = {
  direction: 'TB',
  nodeGap: 52,
  layerGap: 96,
  groupByZone: true,
  groupBySite: true,
}

const HISTORY_LIMIT = 60
export const GRID = 20

export interface ViewState {
  zoom: number
  tx: number
  ty: number
}

export type Mode = 'select' | 'connect'

interface DiagramStore {
  diagram: Diagram
  past: Diagram[]
  future: Diagram[]
  selectedNodes: string[]
  selectedLinks: string[]
  layout: LayoutOptions
  linkStyle: LinkStyle
  showGrid: boolean
  snap: boolean
  showZones: boolean
  showSites: boolean
  showClusters: boolean
  showLayerLabels: boolean
  showDetails: boolean
  showAudit: boolean
  /** Ponts dessinés là où deux liaisons se croisent. */
  showHops: boolean
  /** Mode de visualisation : architecture, technique, présentation. */
  viewMode: ViewMode
  /** Module affiché : schéma, inventaire, baies, découverte. */
  appView: AppView
  mode: Mode
  panel: 'properties' | 'ha' | 'osi' | 'catalog'
  /** Incrémenté à chaque modification du catalogue, pour rafraîchir les listes de types. */
  catalogRevision: number
  /** Clés des groupes repliés (« zone:Bâtiment A »). */
  collapsed: string[]
  detail: DetailLevel
  /** Couche OSI mise en avant (toutes, physique, liaison, réseau). */
  osi: OsiView
  /** Masquer au lieu d'estomper ce qui n'appartient pas à la couche regardée. */
  strictOsi: boolean
  commandOpen: boolean
  importOpen: boolean
  /** Panneau de commande vocale ouvert. */
  voiceOpen: boolean
  connectFrom: string | null
  view: ViewState
  canvasSize: { width: number; height: number }
  toast: string | null

  pushHistory: () => void
  undo: () => void
  redo: () => void

  setTitle: (title: string) => void
  addNode: (kind: DeviceKind, x: number, y: number, seed?: Partial<NetNode>) => string
  updateNode: (id: string, patch: Partial<NetNode>) => void
  updateNodes: (ids: string[], patch: Partial<NetNode>) => void
  moveNodes: (ids: string[], dx: number, dy: number) => void
  setNodePositions: (positions: Record<string, { x: number; y: number }>) => void
  addLink: (from: string, to: string, seed?: Partial<NetLink>) => void
  updateLink: (id: string, patch: Partial<NetLink>) => void
  setLinkWaypoints: (id: string, waypoints: Waypoint[]) => void
  clearLinkRoute: (id: string) => void
  /** Accroche une extrémité de liaison à un équipement, en un point précis de sa boîte. */
  attachLink: (id: string, end: 'a' | 'b', nodeId: string, attach: Attach | null) => void
  /** Rend leur accroche automatique aux deux extrémités d'une liaison. */
  clearLinkAttach: (id: string) => void
  /** Ordre d'empilement des équipements : premier plan, arrière-plan, d'un cran. */
  reorderNodes: (ids: string[], where: ZOrder) => void
  deleteSelection: () => void

  select: (target: { nodes?: string[]; links?: string[] }, additive?: boolean) => void
  clearSelection: () => void
  setAppView: (view: AppView) => void
  setMode: (mode: Mode) => void
  setPanel: (panel: 'properties' | 'ha' | 'osi' | 'catalog') => void
  bumpCatalog: () => void
  toggleCollapse: (key: string) => void
  setCollapsed: (keys: string[]) => void
  setDetail: (detail: DetailLevel) => void
  setOsi: (osi: OsiView) => void
  setStrictOsi: (strict: boolean) => void
  setVlans: (vlans: VlanDef[]) => void
  addRack: (rack?: Partial<RackDef>) => string
  updateRack: (id: string, patch: Partial<RackDef>) => void
  removeRack: (id: string) => void
  assignToRack: (nodeIds: string[], rackId: string, startUnit?: number) => void
  detachFromRack: (nodeIds: string[]) => void
  applyInventoryCsv: (text: string) => { updated: number; created: number; warnings: string[] }
  mergeDiscovery: (result: DiscoveryResult) => { created: number; updated: number; links: number }
  upsertVlan: (vlan: VlanDef) => void
  removeVlan: (id: string) => void
  deduceVlansFromDiagram: () => number
  setCommandOpen: (open: boolean) => void
  setImportOpen: (open: boolean) => void
  setVoiceOpen: (open: boolean) => void
  runVoiceCommand: (transcript: string) => { ok: boolean; message: string }
  duplicateSelection: () => void
  importText: (text: string, mode: 'merge' | 'replace') => { nodes: number; links: number; warnings: string[] }
  focusNode: (id: string) => void
  setConnectFrom: (id: string | null) => void

  /** Choisit un mode de visualisation et applique ses réglages d'affichage. */
  setViewMode: (mode: ViewMode) => void
  setLayout: (patch: Partial<LayoutOptions>) => void
  applyAutoLayout: () => void
  setDisplay: (
    patch: Partial<
      Pick<
        DiagramStore,
        | 'linkStyle'
        | 'showGrid'
        | 'snap'
        | 'showZones'
        | 'showSites'
        | 'showClusters'
        | 'showLayerLabels'
        | 'showDetails'
        | 'showAudit'
        | 'showHops'
      >
    >,
  ) => void
  insertPattern: (pattern: HaPattern) => void

  setView: (patch: Partial<ViewState>) => void
  zoomAt: (factor: number, screenX: number, screenY: number) => void
  setCanvasSize: (width: number, height: number) => void
  fitView: () => void

  loadDiagram: (diagram: Diagram) => void
  newDiagram: () => void
  loadSample: () => void
  notify: (message: string | null) => void
}

const initialDiagram = loadLocal() ?? autoLayoutOf(sampleDiagram(), DEFAULT_LAYOUT)

function autoLayoutOf(diagram: Diagram, layout: LayoutOptions): Diagram {
  return { ...diagram, nodes: autoLayout(diagram, layout) }
}

export const useDiagram = create<DiagramStore>((set, get) => ({
  diagram: initialDiagram,
  past: [],
  future: [],
  selectedNodes: [],
  selectedLinks: [],
  layout: DEFAULT_LAYOUT,
  linkStyle: 'orthogonal',
  showGrid: true,
  snap: true,
  showZones: true,
  showSites: true,
  showClusters: true,
  showLayerLabels: true,
  showDetails: true,
  showAudit: true,
  showHops: true,
  viewMode: 'architecture',
  appView: 'diagram',
  mode: 'select',
  panel: 'properties',
  catalogRevision: 0,
  collapsed: [],
  detail: 'full',
  osi: 'all',
  strictOsi: false,
  commandOpen: false,
  importOpen: false,
  voiceOpen: false,
  connectFrom: null,
  view: { zoom: 0.8, tx: 40, ty: 20 },
  canvasSize: { width: 1200, height: 800 },
  toast: null,

  pushHistory: () =>
    set((state) => ({
      past: [...state.past, state.diagram].slice(-HISTORY_LIMIT),
      future: [],
    })),

  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return {
        diagram: previous,
        past: state.past.slice(0, -1),
        future: [state.diagram, ...state.future].slice(0, HISTORY_LIMIT),
        selectedNodes: [],
        selectedLinks: [],
      }
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0]
      if (!next) return state
      return {
        diagram: next,
        past: [...state.past, state.diagram].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        selectedNodes: [],
        selectedLinks: [],
      }
    }),

  setTitle: (title) => set((state) => ({ diagram: { ...state.diagram, title } })),

  addNode: (kind, x, y, seed) => {
    get().pushHistory()
    const id = uid('n')
    const count = get().diagram.nodes.filter((n) => n.kind === kind).length + 1
    const node: NetNode = {
      id,
      kind,
      name: `${deviceMeta(kind).label} ${count}`,
      x: Math.round(x),
      y: Math.round(y),
      ...seed,
    }
    set((state) => ({
      diagram: { ...state.diagram, nodes: [...state.diagram.nodes, node] },
      selectedNodes: [id],
      selectedLinks: [],
    }))
    return id
  },

  updateNode: (id, patch) => {
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      },
    }))
  },

  updateNodes: (ids, patch) => {
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((n) => (ids.includes(n.id) ? { ...n, ...patch } : n)),
      },
    }))
  },

  // Appelé en continu pendant un glisser : l'instantané d'historique est pris une seule
  // fois, au début du geste, par le composant Canvas.
  moveNodes: (ids, dx, dy) =>
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((n) =>
          ids.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n,
        ),
      },
    })),

  setNodePositions: (positions) =>
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((n) => (positions[n.id] ? { ...n, ...positions[n.id] } : n)),
      },
    })),

  addLink: (from, to, seed) => {
    if (from === to) return
    const exists = get().diagram.links.some(
      (l) => (l.from === from && l.to === to) || (l.from === to && l.to === from),
    )
    const nodes = get().diagram.nodes
    const fromNode = nodes.find((n) => n.id === from)
    const toNode = nodes.find((n) => n.id === to)
    get().pushHistory()
    // Le type est proposé d'après les deux équipements reliés (cf. lib/linkRules.ts).
    const link: NetLink = {
      id: uid('l'),
      from,
      to,
      kind: fromNode && toNode ? suggestLinkKind(fromNode, toNode) : 'ethernet',
      ...seed,
    }
    set((state) => ({
      diagram: { ...state.diagram, links: [...state.diagram.links, link] },
      selectedLinks: [link.id],
      selectedNodes: [],
      toast: exists ? 'Liaison supplémentaire ajoutée entre ces deux équipements.' : null,
    }))
  },

  updateLink: (id, patch) => {
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        links: state.diagram.links.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      },
    }))
  },

  /**
   * Points de passage d'une liaison, sans instantané d'historique : le geste de
   * déplacement en enregistre un seul, à son début (comme pour le déplacement d'un
   * équipement).
   */
  setLinkWaypoints: (id, waypoints) =>
    set((state) => ({
      diagram: {
        ...state.diagram,
        links: state.diagram.links.map((link) =>
          link.id === id ? { ...link, waypoints: waypoints.length > 0 ? waypoints : undefined } : link,
        ),
      },
    })),

  /** Rend son tracé automatique à une liaison : points de passage et accroches effacés. */
  clearLinkRoute: (id) => {
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        links: state.diagram.links.map((link) =>
          link.id === id
            ? {
                ...link,
                waypoints: undefined,
                anchorA: undefined,
                anchorB: undefined,
                attachA: undefined,
                attachB: undefined,
                shape: undefined,
              }
            : link,
        ),
      },
    }))
  },

  /**
   * Déplace une extrémité de liaison : elle change d'équipement si on l'a lâchée sur un
   * autre, et retient le point exact de la boîte où elle a été posée.
   */
  attachLink: (id, end, nodeId, attach) =>
    set((state) => ({
      diagram: {
        ...state.diagram,
        links: state.diagram.links.map((link) => {
          if (link.id !== id) return link
          const other = end === 'a' ? link.to : link.from
          if (nodeId === other) return link
          return end === 'a'
            ? { ...link, from: nodeId, attachA: attach ?? undefined }
            : { ...link, to: nodeId, attachB: attach ?? undefined }
        }),
      },
    })),

  clearLinkAttach: (id) => {
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        links: state.diagram.links.map((link) =>
          link.id === id ? { ...link, attachA: undefined, attachB: undefined } : link,
        ),
      },
    }))
  },

  /**
   * Ordre d'empilement.
   *
   * L'ordre du tableau est l'ordre de dessin : ce qui vient après passe devant. « Avancer »
   * et « reculer » sautent par-dessus le voisin non sélectionné le plus proche, pour qu'une
   * sélection multiple se déplace d'un bloc sans se désordonner.
   */
  reorderNodes: (ids, where) => {
    if (ids.length === 0) return
    const selected = new Set(ids)
    get().pushHistory()
    set((state) => {
      const nodes = state.diagram.nodes
      const picked = nodes.filter((node) => selected.has(node.id))
      const rest = nodes.filter((node) => !selected.has(node.id))
      if (picked.length === 0) return {}

      let next: typeof nodes
      if (where === 'front') next = [...rest, ...picked]
      else if (where === 'back') next = [...picked, ...rest]
      else {
        next = [...nodes]
        const indexes = next.flatMap((node, index) => (selected.has(node.id) ? [index] : []))
        const order = where === 'forward' ? [...indexes].reverse() : indexes
        for (const index of order) {
          const target = where === 'forward' ? index + 1 : index - 1
          if (target < 0 || target >= next.length || selected.has(next[target].id)) continue
          ;[next[index], next[target]] = [next[target], next[index]]
        }
      }
      return { diagram: { ...state.diagram, nodes: next } }
    })
  },

  deleteSelection: () => {
    const { selectedNodes, selectedLinks } = get()
    if (selectedNodes.length === 0 && selectedLinks.length === 0) return
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.filter((n) => !selectedNodes.includes(n.id)),
        links: state.diagram.links.filter(
          (l) =>
            !selectedLinks.includes(l.id) &&
            !selectedNodes.includes(l.from) &&
            !selectedNodes.includes(l.to),
        ),
      },
      selectedNodes: [],
      selectedLinks: [],
    }))
  },

  select: (target, additive = false) =>
    set((state) => {
      const nodes = target.nodes ?? []
      const links = target.links ?? []
      if (!additive) return { selectedNodes: nodes, selectedLinks: links }
      const toggle = (current: string[], next: string[]) => {
        const set_ = new Set(current)
        for (const id of next) {
          if (set_.has(id)) set_.delete(id)
          else set_.add(id)
        }
        return [...set_]
      }
      return {
        selectedNodes: toggle(state.selectedNodes, nodes),
        selectedLinks: toggle(state.selectedLinks, links),
      }
    }),

  clearSelection: () => set({ selectedNodes: [], selectedLinks: [] }),
  setAppView: (appView) => set({ appView }),
  setMode: (mode) => set({ mode, connectFrom: null }),
  setPanel: (panel) => set({ panel }),
  bumpCatalog: () => set((state) => ({ catalogRevision: state.catalogRevision + 1 })),

  toggleCollapse: (key) =>
    set((state) => ({
      collapsed: state.collapsed.includes(key)
        ? state.collapsed.filter((item) => item !== key)
        : [...state.collapsed, key],
      selectedNodes: [],
      selectedLinks: [],
    })),
  setCollapsed: (collapsed) => set({ collapsed, selectedNodes: [], selectedLinks: [] }),
  setDetail: (detail) => set({ detail }),
  setOsi: (osi) => set({ osi }),
  setStrictOsi: (strictOsi) => set({ strictOsi }),

  addRack: (rack) => {
    const id = rack?.id ?? uid('r')
    get().pushHistory()
    const racks = get().diagram.racks ?? []
    const next: RackDef = {
      id,
      name: rack?.name ?? `Baie ${racks.length + 1}`,
      site: rack?.site,
      room: rack?.room,
      units: rack?.units ?? 42,
      notes: rack?.notes,
    }
    set((state) => ({ diagram: { ...state.diagram, racks: [...(state.diagram.racks ?? []), next] } }))
    return id
  },

  updateRack: (id, patch) => {
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        racks: (state.diagram.racks ?? []).map((rack) => (rack.id === id ? { ...rack, ...patch } : rack)),
      },
    }))
  },

  /** Supprimer une baie ne supprime pas les équipements : ils redeviennent non implantés. */
  removeRack: (id) => {
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        racks: (state.diagram.racks ?? []).filter((rack) => rack.id !== id),
        nodes: state.diagram.nodes.map((node) =>
          node.rack === id ? { ...node, rack: undefined, rackUnit: undefined } : node,
        ),
      },
    }))
  },

  /**
   * Implante des équipements dans une baie. Sans position imposée, chacun prend la
   * première hauteur libre en partant du bas, comme on remplit une baie réelle.
   */
  assignToRack: (nodeIds, rackId, startUnit) => {
    const { diagram } = get()
    const rack = (diagram.racks ?? []).find((item) => item.id === rackId)
    if (!rack) return
    get().pushHistory()

    let working: Diagram = diagram
    let unit = startUnit
    for (const id of nodeIds) {
      const node = working.nodes.find((item) => item.id === id)
      if (!node) continue
      const height = heightOf(node)
      const position = unit ?? firstFreeUnit(rackOccupancy(working, rack), height)
      if (position === null) break
      working = {
        ...working,
        nodes: working.nodes.map((item) =>
          item.id === id ? { ...item, rack: rackId, rackUnit: position, heightU: height } : item,
        ),
      }
      unit = startUnit ? position + height : undefined
    }
    set({ diagram: working })
  },

  detachFromRack: (nodeIds) => {
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((node) =>
          nodeIds.includes(node.id) ? { ...node, rack: undefined, rackUnit: undefined } : node,
        ),
      },
    }))
  },

  /** Import d'un inventaire CSV : la colonne « Nom » identifie l'équipement. */
  applyInventoryCsv: (text) => {
    const { rows, warnings } = inventoryFromCsv(text)
    if (rows.length === 0) return { updated: 0, created: 0, warnings }
    get().pushHistory()
    const normalize = (value: string) => value.trim().toLowerCase()
    const byName = new Map(get().diagram.nodes.map((node) => [normalize(node.name), node]))
    const patched = new Map<string, NetNode>()
    const created: NetNode[] = []

    for (const row of rows) {
      const existing = byName.get(normalize(row.name))
      if (existing) {
        const current = patched.get(existing.id) ?? existing
        patched.set(existing.id, { ...current, ...row.patch })
      } else {
        const node: NetNode = { id: uid('n'), kind: 'server', name: row.name, x: 0, y: 0, ...row.patch }
        created.push(node)
        byName.set(normalize(row.name), node)
      }
    }

    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: [...state.diagram.nodes.map((node) => patched.get(node.id) ?? node), ...created],
      },
    }))
    return { updated: patched.size, created: created.length, warnings }
  },

  /**
   * Fusion d'une découverte : un équipement est reconnu par son nom ou son adresse IP.
   * Les champs déjà renseignés à la main ne sont jamais écrasés — la découverte complète,
   * elle ne remplace pas.
   */
  mergeDiscovery: (result) => {
    const { diagram } = get()
    const normalize = (value: string) => value.trim().toLowerCase()
    const byName = new Map(diagram.nodes.map((node) => [normalize(node.name), node]))
    const byIp = new Map(diagram.nodes.filter((node) => node.ip).map((node) => [node.ip!.trim(), node]))

    const resolved = new Map<string, string>()
    const patched = new Map<string, NetNode>()
    const created: NetNode[] = []

    for (const discovered of result.nodes) {
      const existing = byName.get(normalize(discovered.name)) ?? (discovered.ip ? byIp.get(discovered.ip) : undefined)
      if (existing) {
        resolved.set(discovered.id, existing.id)
        const current = patched.get(existing.id) ?? existing
        patched.set(existing.id, {
          ...current,
          ip: current.ip ?? discovered.ip,
          model: current.model ?? discovered.model,
          vendor: current.vendor ?? discovered.vendor,
          vlan: current.vlan ?? discovered.vlan,
          notes: current.notes ?? discovered.notes,
        })
      } else {
        const node: NetNode = { ...discovered, id: uid('n') }
        resolved.set(discovered.id, node.id)
        created.push(node)
        byName.set(normalize(node.name), node)
        if (node.ip) byIp.set(node.ip, node)
      }
    }

    const signature = (from: string, to: string, kind: string) => [from, to].sort().join('~') + `|${kind}`
    const known = new Set(diagram.links.map((link) => signature(link.from, link.to, link.kind)))
    const links: NetLink[] = []
    for (const link of result.links) {
      const from = resolved.get(link.from)
      const to = resolved.get(link.to)
      if (!from || !to || from === to) continue
      const key = signature(from, to, link.kind)
      if (known.has(key)) continue
      known.add(key)
      links.push({ ...link, id: uid('l'), from, to })
    }

    if (created.length === 0 && patched.size === 0 && links.length === 0) {
      return { created: 0, updated: 0, links: 0 }
    }

    get().pushHistory()
    const merged: Diagram = {
      ...diagram,
      nodes: [...diagram.nodes.map((node) => patched.get(node.id) ?? node), ...created],
      links: [...diagram.links, ...links],
    }
    set((state) => ({ diagram: autoLayoutOf(merged, state.layout), selectedNodes: [], selectedLinks: [] }))
    get().fitView()
    return { created: created.length, updated: patched.size, links: links.length }
  },

  setVlans: (vlans) => {
    get().pushHistory()
    set((state) => ({ diagram: { ...state.diagram, vlans } }))
  },

  upsertVlan: (vlan) => {
    get().pushHistory()
    set((state) => {
      const vlans = [...(state.diagram.vlans ?? [])]
      const index = vlans.findIndex((item) => item.id === vlan.id)
      if (index >= 0) vlans[index] = { ...vlans[index], ...vlan }
      else vlans.push(vlan)
      return { diagram: { ...state.diagram, vlans } }
    })
  },

  removeVlan: (id) => {
    get().pushHistory()
    set((state) => ({
      diagram: { ...state.diagram, vlans: (state.diagram.vlans ?? []).filter((vlan) => vlan.id !== id) },
    }))
  },

  /** Complète la table des VLAN avec ceux déjà cités dans le schéma. */
  deduceVlansFromDiagram: () => {
    const before = get().diagram.vlans?.length ?? 0
    const vlans = deduceVlans(get().diagram)
    if (vlans.length === before) return 0
    get().pushHistory()
    set((state) => ({ diagram: { ...state.diagram, vlans } }))
    return vlans.length - before
  },
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setImportOpen: (importOpen) => set({ importOpen }),
  setVoiceOpen: (voiceOpen) => set({ voiceOpen }),

  /**
   * Exécute une commande dictée (ou tapée dans le panneau vocal). L'interprétation vit
   * dans `lib/voice.ts` ; ici on ne fait qu'appliquer l'intention et rendre compte.
   */
  runVoiceCommand: (transcript) => {
    const intent = interpret(transcript)
    if (!intent) {
      return { ok: false, message: `Commande non comprise : « ${transcript.trim()} »` }
    }

    const state = get()
    const center = () => {
      const { view, canvasSize, snap } = get()
      const raw = {
        x: (canvasSize.width / 2 - view.tx) / view.zoom,
        y: (canvasSize.height / 2 - view.ty) / view.zoom,
      }
      return snap
        ? { x: Math.round(raw.x / GRID) * GRID, y: Math.round(raw.y / GRID) * GRID }
        : { x: Math.round(raw.x), y: Math.round(raw.y) }
    }
    // La dictée arrive sans accents ni casse : la comparaison doit l'être aussi.
    const plain = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
    /**
     * Cible d'une commande : un nom d'équipement, « la sélection », ou « tous les … »
     * suivi d'un type. C'est ce qui permet de dicter une modification en lot.
     */
    const resolveTargets = (target: string): NetNode[] => {
      const nodes = get().diagram.nodes
      const needle = plain(target)
      if (/^(la selection|selection|ca|cela|eux|celles ci|ceux ci)$/.test(needle)) {
        return nodes.filter((node) => get().selectedNodes.includes(node.id))
      }
      const bulk = needle.match(/^(?:tous|toutes)\s+(?:les|des)\s+(.+)$/)
      if (bulk) {
        const device = findDevice(bulk[1])
        return device ? nodes.filter((node) => node.kind === device.id) : []
      }
      const single = findNode(target)
      return single ? [single] : []
    }

    /** Message d'échec parlant : « aucun téléphone IP » plutôt que « introuvable ». */
    const missMessage = (target: string): string => {
      const needle = plain(target)
      if (/^(la selection|selection|ca|cela)$/.test(needle)) return 'Rien n’est sélectionné.'
      const bulk = needle.match(/^(?:tous|toutes)\s+(?:les|des)\s+(.+)$/)
      if (bulk) {
        const device = findDevice(bulk[1])
        return device
          ? `Aucun équipement « ${device.label} » dans le schéma.`
          : `Type d’équipement « ${bulk[1]} » inconnu.`
      }
      return `Équipement « ${target} » introuvable.`
    }

    /** Une liaison désignée par ses deux extrémités, dans un sens ou dans l'autre. */
    const findLink = (fromName: string, toName: string) => {
      const from = findNode(fromName)
      const to = findNode(toName)
      if (!from || !to) return { from, to, link: undefined }
      const link = get().diagram.links.find(
        (item) =>
          (item.from === from.id && item.to === to.id) || (item.from === to.id && item.to === from.id),
      )
      return { from, to, link }
    }

    /**
     * Retrouve un équipement par son nom. La dictée rend rarement « SW-CORE-01 » à la
     * lettre : on accepte « sw core 01 », « swcore1 », et à défaut le nom le plus proche
     * au sens de la distance d'édition.
     */
    const findNode = (name: string) => {
      const needle = plain(name)
      const squeezed = needle.replace(/[\s-]/g, '')
      const nodes = get().diagram.nodes
      return (
        nodes.find((node) => plain(node.name) === needle) ??
        nodes.find((node) => plain(node.name).startsWith(needle)) ??
        nodes.find((node) => plain(node.name).replace(/[\s-]/g, '').includes(squeezed)) ??
        bestMatch(name, nodes, (node) => node.name)?.item
      )
    }

    switch (intent.type) {
      case 'add': {
        const position = center()
        get().setAppView('diagram')

        const seed: Partial<NetNode> = {}
        if (intent.name) seed.name = intent.name
        for (const [field, value] of Object.entries(intent.props ?? {})) {
          if (field === 'vlan') seed.vlan = /^\d+$/.test(value) ? `VLAN ${value}` : value
          else if (field === 'rackUnit' || field === 'heightU' || field === 'powerW') {
            const numeric = Number(value.replace(/[^\d.]/g, ''))
            if (Number.isFinite(numeric)) Object.assign(seed, { [field]: numeric })
          } else Object.assign(seed, { [field]: value })
        }

        const id = get().addNode(intent.kind, position.x, position.y, seed)
        const extras: string[] = []

        if (intent.rack) {
          const wanted = plain(intent.rack)
          const racks = get().diagram.racks ?? []
          const rack =
            racks.find((item) => plain(item.name) === wanted || plain(item.name).includes(wanted)) ??
            bestMatch(intent.rack, racks, (item) => item.name)?.item
          if (rack) {
            get().assignToRack([id], rack.id)
            extras.push(`implanté dans ${rack.name}`)
          } else extras.push(`baie « ${intent.rack} » introuvable`)
        }

        if (intent.connectTo) {
          const peer = findNode(intent.connectTo)
          if (peer) {
            get().addLink(id, peer.id)
            extras.push(`relié à ${peer.name}`)
          } else extras.push(`« ${intent.connectTo} » introuvable`)
        }

        get().select({ nodes: [id] })
        const created = get().diagram.nodes.find((node) => node.id === id)
        return {
          ok: true,
          message: `${intent.label} « ${created?.name ?? intent.label} » ajouté${extras.length > 0 ? `, ${extras.join(', ')}` : ''}.`,
        }
      }

      case 'setKind': {
        const targets = resolveTargets(intent.target)
        if (targets.length === 0) return { ok: false, message: missMessage(intent.target) }
        get().updateNodes(
          targets.map((node) => node.id),
          { kind: intent.kind },
        )
        return {
          ok: true,
          message:
            targets.length === 1
              ? `${targets[0].name} est maintenant un ${intent.label.toLowerCase()}.`
              : `${targets.length} équipements passés en ${intent.label.toLowerCase()}.`,
        }
      }

      case 'move': {
        const targets = resolveTargets(intent.target)
        if (targets.length === 0) return { ok: false, message: missMessage(intent.target) }
        const delta = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[intent.direction]
        get().pushHistory()
        get().moveNodes(
          targets.map((node) => node.id),
          delta[0] * intent.amount,
          delta[1] * intent.amount,
        )
        return {
          ok: true,
          message:
            targets.length === 1 ? `${targets[0].name} déplacé.` : `${targets.length} équipements déplacés.`,
        }
      }

      case 'linkDelete': {
        const { from, to, link } = findLink(intent.from, intent.to)
        if (!from) return { ok: false, message: `Équipement « ${intent.from} » introuvable.` }
        if (!to) return { ok: false, message: `Équipement « ${intent.to} » introuvable.` }
        if (!link) return { ok: false, message: `Aucune liaison entre ${from.name} et ${to.name}.` }
        get().select({ links: [link.id] })
        get().deleteSelection()
        return { ok: true, message: `Liaison ${from.name} – ${to.name} supprimée.` }
      }

      case 'linkEdit': {
        const { from, to, link } = findLink(intent.from, intent.to)
        if (!from) return { ok: false, message: `Équipement « ${intent.from} » introuvable.` }
        if (!to) return { ok: false, message: `Équipement « ${intent.to} » introuvable.` }

        // « la liaison entre A et B est en fibre » vaut aussi bien pour une liaison qui
        // existe déjà que pour une qui reste à créer.
        let id = link?.id
        let created = false
        if (!id) {
          get().addLink(from.id, to.id)
          id = get().selectedLinks[0]
          created = true
        }
        if (!id) return { ok: false, message: 'La liaison n’a pas pu être créée.' }

        get().updateLink(id, intent.patch)
        get().select({ links: [id] })
        return {
          ok: true,
          message: `Liaison ${from.name} – ${to.name} ${created ? 'créée' : 'modifiée'}.`,
        }
      }

      case 'selectKind': {
        const ids = get()
          .diagram.nodes.filter((node) => node.kind === intent.kind)
          .map((node) => node.id)
        if (ids.length === 0) return { ok: false, message: `Aucun ${intent.label.toLowerCase()} dans le schéma.` }
        get().setAppView('diagram')
        get().select({ nodes: ids })
        return {
          ok: true,
          message:
            ids.length === 1
              ? `1 équipement « ${intent.label} » sélectionné.`
              : `${ids.length} équipements « ${intent.label} » sélectionnés.`,
        }
      }
      case 'link': {
        const from = findNode(intent.from)
        const to = findNode(intent.to)
        if (!from) return { ok: false, message: `Équipement « ${intent.from} » introuvable.` }
        if (!to) return { ok: false, message: `Équipement « ${intent.to} » introuvable.` }
        get().addLink(from.id, to.id)
        if (intent.linkKind) {
          const created = get().selectedLinks[0]
          if (created) get().updateLink(created, { kind: intent.linkKind })
        }
        return { ok: true, message: `${from.name} relié à ${to.name}.` }
      }

      case 'rename': {
        const node = findNode(intent.target)
        if (!node) return { ok: false, message: `Équipement « ${intent.target} » introuvable.` }
        get().updateNode(node.id, { name: intent.name })
        return { ok: true, message: `${node.name} renommé en ${intent.name}.` }
      }

      case 'setField': {
        const targets = resolveTargets(intent.target)
        if (targets.length === 0) return { ok: false, message: missMessage(intent.target) }
        const ids = targets.map((node) => node.id)

        // Un modèle dicté est cherché dans la base matériels : il remplit aussi le
        // constructeur, la hauteur en baie et la consommation.
        if (intent.field === 'model') {
          const hardware = searchModels(intent.value)[0]
          if (hardware) {
            get().updateNodes(ids, {
              vendor: hardware.vendor,
              model: hardware.model,
              heightU: hardware.heightU,
              powerW: hardware.powerW,
            })
            return { ok: true, message: `${hardware.vendor} ${hardware.model} appliqué.` }
          }
        }

        const numericFields = ['rackUnit', 'heightU', 'powerW']
        let value: string | number = intent.value
        if (numericFields.includes(intent.field)) {
          const numeric = Number(intent.value.replace(/[^\d.]/g, ''))
          if (!Number.isFinite(numeric)) return { ok: false, message: `Valeur « ${intent.value} » non numérique.` }
          value = numeric
        } else if (intent.field === 'vlan' && /^\d+$/.test(intent.value)) {
          value = `VLAN ${intent.value}`
        }

        get().updateNodes(ids, { [intent.field]: value })
        return {
          ok: true,
          message:
            targets.length === 1
              ? `${targets[0].name} mis à jour.`
              : `${targets.length} équipements mis à jour.`,
        }
      }

      case 'setRole': {
        const targets = resolveTargets(intent.target)
        if (targets.length === 0) return { ok: false, message: missMessage(intent.target) }
        get().updateNodes(
          targets.map((node) => node.id),
          { role: intent.role },
        )
        return { ok: true, message: `Rôle « ${ROLES[intent.role].label} » appliqué à ${targets.length} équipement(s).` }
      }

      case 'setStatus': {
        const targets = resolveTargets(intent.target)
        if (targets.length === 0) return { ok: false, message: missMessage(intent.target) }
        get().updateNodes(
          targets.map((node) => node.id),
          { status: intent.status },
        )
        return {
          ok: true,
          message: `${targets.length} équipement(s) : ${STATUS_LABELS[intent.status].toLowerCase()}.`,
        }
      }

      case 'setPinned': {
        const ids = intent.target
          ? resolveTargets(intent.target).map((node) => node.id)
          : state.selectedNodes
        if (ids.length === 0) return { ok: false, message: 'Aucun équipement visé.' }
        get().updateNodes(ids, { pinned: intent.pinned })
        return { ok: true, message: intent.pinned ? 'Position figée.' : 'Position libérée.' }
      }

      case 'zorder': {
        const ids = intent.target
          ? resolveTargets(intent.target).map((node) => node.id)
          : state.selectedNodes
        if (ids.length === 0) {
          return { ok: false, message: intent.target ? missMessage(intent.target) : 'Aucun équipement visé.' }
        }
        get().setAppView('diagram')
        get().select({ nodes: ids })
        get().reorderNodes(ids, intent.where)
        const labels: Record<ZOrder, string> = {
          front: 'au premier plan',
          back: 'à l’arrière-plan',
          forward: 'avancé d’un cran',
          backward: 'reculé d’un cran',
        }
        return { ok: true, message: `${ids.length} équipement(s) ${labels[intent.where]}.` }
      }

      case 'linkAttach': {
        const id = state.selectedLinks[0]
        if (!id) return { ok: false, message: 'Sélectionnez d’abord une liaison.' }
        get().clearLinkAttach(id)
        return { ok: true, message: 'Accroches rendues automatiques.' }
      }

      case 'duplicate': {
        if (intent.target) {
          const targets = resolveTargets(intent.target)
          if (targets.length === 0) return { ok: false, message: missMessage(intent.target) }
          get().select({ nodes: targets.map((node) => node.id) })
        } else if (state.selectedNodes.length === 0) {
          return { ok: false, message: 'Rien n’est sélectionné.' }
        }
        get().duplicateSelection()
        const copies = get().selectedNodes.length
        return { ok: true, message: copies === 1 ? 'Équipement dupliqué.' : `${copies} équipements dupliqués.` }
      }

      case 'selectAll': {
        get().select({ nodes: get().diagram.nodes.map((node) => node.id) })
        return { ok: true, message: `${get().diagram.nodes.length} équipements sélectionnés.` }
      }

      case 'clearSelection':
        get().clearSelection()
        return { ok: true, message: 'Sélection vidée.' }

      case 'pattern': {
        // « pare-feu actif passif » doit retrouver « Pare-feu actif / passif » : on compare
        // mot à mot, sans ponctuation ni accents.
        const words = plain(intent.query)
          .split(/[^a-z0-9]+/)
          .filter((word) => word.length > 2)
        const score = (text: string) => {
          const haystack = plain(text)
          return words.filter((word) => haystack.includes(word)).length
        }
        const pattern = HA_PATTERNS.map((item) => ({ item, score: score(`${item.title} ${item.summary}`) }))
          .filter((entry) => entry.score >= Math.max(1, words.length - 1))
          .sort((a, b) => b.score - a.score)[0]?.item
        if (!pattern) return { ok: false, message: `Aucun modèle « ${intent.query} ».` }
        get().setAppView('diagram')
        get().insertPattern(pattern)
        return { ok: true, message: `Modèle ${pattern.title} inséré.` }
      }

      case 'direction':
        get().setLayout({ direction: intent.direction })
        get().applyAutoLayout()
        return { ok: true, message: intent.direction === 'LR' ? 'Couches de gauche à droite.' : 'Couches de haut en bas.' }

      case 'route': {
        const id = state.selectedLinks[0]
        if (!id) return { ok: false, message: 'Sélectionnez d’abord une liaison.' }
        if (intent.shape === 'auto') {
          get().clearLinkRoute(id)
          return { ok: true, message: 'Tracé rendu automatique.' }
        }
        get().updateLink(id, { shape: intent.shape })
        const labels = { orthogonal: 'orthogonal', straight: 'direct', curved: 'courbe', auto: 'automatique' }
        return { ok: true, message: `Tracé ${labels[intent.shape]}.` }
      }

      case 'linkStyle':
        get().setDisplay({ linkStyle: intent.style })
        return { ok: true, message: intent.style === 'straight' ? 'Liaisons en ligne droite.' : 'Liaisons orthogonales.' }

      case 'toggle':
        get().setDisplay({ [intent.key]: intent.value })
        return { ok: true, message: intent.value ? 'Affiché.' : 'Masqué.' }

      case 'project': {
        if (intent.action === 'new') {
          get().newDiagram()
          return { ok: true, message: 'Nouveau schéma.' }
        }
        if (intent.action === 'sample') {
          get().loadSample()
          return { ok: true, message: 'Schéma d’exemple chargé.' }
        }
        const diagram = get().diagram
        downloadBlob(
          new Blob([diagramFileContent(diagram)], { type: 'application/json' }),
          `${slugify(diagram.title)}.json`,
        )
        return { ok: true, message: 'Projet enregistré.' }
      }

      case 'title':
        get().setTitle(intent.title)
        return { ok: true, message: `Schéma renommé : ${intent.title}.` }

      case 'rackAssign': {
        const node = findNode(intent.target)
        if (!node) return { ok: false, message: `Équipement « ${intent.target} » introuvable.` }
        const wanted = plain(intent.rack)
        const racks = get().diagram.racks ?? []
        const rack =
          racks.find((item) => plain(item.name) === wanted || plain(item.name).includes(wanted)) ??
          bestMatch(intent.rack, racks, (item) => item.name)?.item
        if (!rack) return { ok: false, message: `Baie « ${intent.rack} » introuvable.` }
        get().assignToRack([node.id], rack.id)
        return { ok: true, message: `${node.name} implanté dans ${rack.name}.` }
      }

      case 'rackDetach': {
        const node = findNode(intent.target)
        if (!node) return { ok: false, message: `Équipement « ${intent.target} » introuvable.` }
        get().detachFromRack([node.id])
        return { ok: true, message: `${node.name} retiré de sa baie.` }
      }

      case 'vlanAdd':
        get().upsertVlan({ id: intent.id, name: intent.name, subnet: intent.subnet })
        return { ok: true, message: `VLAN ${intent.id} ajouté au plan d’adressage.` }

      case 'query': {
        const diagram = get().diagram
        switch (intent.question) {
          case 'count':
            return { ok: true, message: `Le schéma compte ${diagram.nodes.length} équipements et ${diagram.links.length} liaisons.` }
          case 'countKind': {
            const device = intent.argument ? findDevice(intent.argument) : undefined
            if (!device) return { ok: false, message: `Type « ${intent.argument ?? ''} » inconnu.` }
            const total = diagram.nodes.filter((node) => node.kind === device.id).length
            return { ok: true, message: `${total} ${device.label.toLowerCase()} dans le schéma.` }
          }
          case 'ha': {
            const report = auditDiagram(diagram)
            return { ok: true, message: `Robustesse : ${report.score} sur 100, niveau ${report.level}, ${report.findings.length} constats.` }
          }
          case 'spof': {
            const report = auditDiagram(diagram)
            if (report.spof.length === 0) return { ok: true, message: 'Aucun point de défaillance unique détecté.' }
            const names = report.spof
              .map((id) => diagram.nodes.find((node) => node.id === id)?.name)
              .filter(Boolean)
              .slice(0, 4)
            return { ok: true, message: `${report.spof.length} point(s) de défaillance : ${names.join(', ')}.` }
          }
          case 'power': {
            const total = diagram.nodes.reduce((acc, node) => acc + (node.powerW ?? 0), 0)
            return { ok: true, message: `Consommation renseignée : ${total} watts.` }
          }
          case 'vlans':
            return { ok: true, message: `${diagram.vlans?.length ?? 0} VLAN au plan d’adressage.` }
          case 'racks':
            return { ok: true, message: `${diagram.racks?.length ?? 0} baie(s) déclarée(s).` }
          case 'freeUnits': {
            const racks = diagram.racks ?? []
            if (racks.length === 0) return { ok: false, message: 'Aucune baie déclarée.' }
            const wanted = intent.argument ? plain(intent.argument) : null
            const target = wanted
              ? (racks.find((rack) => plain(rack.name) === wanted || plain(rack.name).includes(wanted)) ??
                (intent.argument ? bestMatch(intent.argument, racks, (rack) => rack.name)?.item : undefined))
              : undefined
            if (wanted && !target) return { ok: false, message: `Baie « ${intent.argument} » introuvable.` }
            const list = target ? [target] : racks
            const parts = list.map((rack) => `${rack.name} : ${rackOccupancy(diagram, rack).freeUnits} U libres`)
            return { ok: true, message: parts.join(', ') + '.' }
          }
          default:
            return { ok: false, message: 'Question non comprise.' }
        }
      }
      case 'focus': {
        const node = findNode(intent.name)
        if (!node) return { ok: false, message: `Équipement « ${intent.name} » introuvable.` }
        get().setAppView('diagram')
        get().focusNode(node.id)
        return { ok: true, message: `${node.name} sélectionné.` }
      }
      case 'layout':
        get().setAppView('diagram')
        get().applyAutoLayout()
        return { ok: true, message: 'Placement automatique appliqué.' }
      case 'fit':
        get().fitView()
        return { ok: true, message: 'Vue ajustée.' }
      case 'undo':
        get().undo()
        return { ok: true, message: 'Annulé.' }
      case 'redo':
        get().redo()
        return { ok: true, message: 'Rétabli.' }
      case 'delete': {
        if (intent.target) {
          const targets = resolveTargets(intent.target)
          if (targets.length === 0) return { ok: false, message: missMessage(intent.target) }
          get().select({ nodes: targets.map((node) => node.id) })
          get().deleteSelection()
          return {
            ok: true,
            message:
              targets.length === 1 ? `${targets[0].name} supprimé.` : `${targets.length} équipements supprimés.`,
          }
        }
        const count = state.selectedNodes.length + state.selectedLinks.length
        if (count === 0) return { ok: false, message: 'Rien n’est sélectionné.' }
        get().deleteSelection()
        return { ok: true, message: `${count} élément(s) supprimé(s).` }
      }
      case 'connect':
        get().setAppView('diagram')
        get().setMode('connect')
        return { ok: true, message: 'Mode Relier activé.' }
      case 'osi':
        get().setAppView('diagram')
        get().setOsi(intent.layer)
        return {
          ok: true,
          message: intent.layer === 'all' ? 'Toutes les couches affichées.' : `Vue ${intent.layer.toUpperCase()}.`,
        }
      case 'detail': {
        const labels = { full: 'détail complet', 'no-endpoints': 'sans les postes', summary: 'synthèse' }
        get().setDetail(intent.level)
        return { ok: true, message: `Affichage : ${labels[intent.level]}.` }
      }
      case 'view': {
        const labels = {
          diagram: 'Schéma',
          inventory: 'Inventaire',
          racks: 'Baies',
          discovery: 'Découverte',
          guide: 'Guide',
        }
        get().setAppView(intent.view)
        return { ok: true, message: `${labels[intent.view]} ouvert.` }
      }
      case 'viewMode': {
        get().setAppView('diagram')
        get().setViewMode(intent.mode)
        return { ok: true, message: `Mode ${modeDefinition(intent.mode).label.toLowerCase()}.` }
      }

      case 'collapse': {
        const groups = collapsibleGroups(get().diagram)
        if (!intent.label) {
          const zones = groups.filter((group) => group.type === 'zone').map((group) => group.key)
          if (zones.length === 0) return { ok: false, message: 'Aucune zone à replier.' }
          get().setCollapsed(zones)
          return { ok: true, message: `${zones.length} zone(s) repliée(s).` }
        }
        const needle = intent.label.toLowerCase()
        const group = groups.find((item) => item.label.toLowerCase().includes(needle))
        if (!group) return { ok: false, message: `Groupe « ${intent.label} » introuvable.` }
        if (!get().collapsed.includes(group.key)) get().toggleCollapse(group.key)
        return { ok: true, message: `${group.label} replié.` }
      }
      case 'expand':
        get().setCollapsed([])
        return { ok: true, message: 'Tout est déplié.' }
      case 'export': {
        const svg = getDiagramSvg()
        if (!svg) return { ok: false, message: 'Ouvrez le schéma avant d’exporter.' }
        const filename = `${slugify(get().diagram.title)}.${intent.format}`
        if (intent.format === 'svg') downloadSvg(svg, filename)
        else void downloadPng(svg, filename, 2)
        return { ok: true, message: `Export ${intent.format.toUpperCase()} lancé.` }
      }
      case 'zoom': {
        const { canvasSize } = get()
        get().zoomAt(intent.direction === 'in' ? 1.25 : 0.8, canvasSize.width / 2, canvasSize.height / 2)
        return { ok: true, message: intent.direction === 'in' ? 'Zoom avant.' : 'Zoom arrière.' }
      }
      case 'import':
        get().setImportOpen(true)
        return { ok: true, message: 'Import rapide ouvert.' }
      case 'help':
        get().setAppView('guide')
        get().setVoiceOpen(true)
        return { ok: true, message: 'Guide ouvert : voici les commandes reconnues.' }
      default:
        return { ok: false, message: 'Commande non comprise.' }
    }
  },

  /**
   * Duplication : le nom est incrémenté (SW-ACC-A1 → SW-ACC-A2), les attributs sont
   * conservés, et les liaisons internes à la sélection sont dupliquées elles aussi.
   */
  duplicateSelection: () => {
    const { diagram, selectedNodes } = get()
    if (selectedNodes.length === 0) return
    get().pushHistory()
    const taken = new Set(diagram.nodes.map((n) => n.name))
    const mapping = new Map<string, string>()
    const clones = diagram.nodes
      .filter((n) => selectedNodes.includes(n.id))
      .map((node) => {
        const id = uid('n')
        mapping.set(node.id, id)
        const name = nextName(node.name, taken)
        taken.add(name)
        return { ...node, id, name, x: node.x + 40, y: node.y + 40, pinned: false }
      })
    const clonedLinks = diagram.links
      .filter((l) => mapping.has(l.from) && mapping.has(l.to))
      .map((link) => ({ ...link, id: uid('l'), from: mapping.get(link.from)!, to: mapping.get(link.to)! }))
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: [...state.diagram.nodes, ...clones],
        links: [...state.diagram.links, ...clonedLinks],
      },
      selectedNodes: clones.map((n) => n.id),
      selectedLinks: [],
    }))
  },

  importText: (text, mode) => {
    const base = mode === 'merge' ? get().diagram : emptyDiagram()
    const result = parseQuickImport(text, base)
    if (result.nodes.length === 0 && result.links.length === 0) {
      return { nodes: 0, links: 0, warnings: result.warnings }
    }
    get().pushHistory()
    const updated = new Map(result.updates.map((node) => [node.id, node]))
    const diagram: Diagram = {
      title: base.title,
      nodes: [...base.nodes.map((node) => updated.get(node.id) ?? node), ...result.nodes],
      links: [...base.links, ...result.links],
    }
    set((state) => ({
      diagram: autoLayoutOf(diagram, state.layout),
      selectedNodes: [],
      selectedLinks: [],
    }))
    get().fitView()
    return { nodes: result.nodes.length, links: result.links.length, warnings: result.warnings }
  },

  focusNode: (id) => {
    const { diagram, canvasSize, view } = get()
    const node = diagram.nodes.find((n) => n.id === id)
    if (!node) return
    const zoom = Math.max(view.zoom, 0.7)
    set({
      selectedNodes: [id],
      selectedLinks: [],
      view: { zoom, tx: canvasSize.width / 2 - node.x * zoom, ty: canvasSize.height / 2 - node.y * zoom },
    })
  },
  setConnectFrom: (id) => set({ connectFrom: id }),

  setLayout: (patch) => set((state) => ({ layout: { ...state.layout, ...patch } })),

  applyAutoLayout: () => {
    get().pushHistory()
    set((state) => ({ diagram: autoLayoutOf(state.diagram, state.layout) }))
    get().fitView()
  },

  setDisplay: (patch) => set(patch),

  /**
   * Un mode n'est pas qu'un habillage : il règle aussi ce que l'on montre. Les cases
   * d'affichage restent modifiables ensuite — le mode donne le point de départ.
   */
  setViewMode: (mode) => set({ viewMode: mode, ...modeDefinition(mode).display }),

  /**
   * Insertion d'un modèle haute disponibilité : les équipements arrivent au centre de la
   * vue, déjà reliés et déjà décrits (grappe, rôles, VIP), prêts à être raccordés au reste
   * du schéma puis replacés automatiquement.
   */
  insertPattern: (pattern) => {
    get().pushHistory()
    const { view, canvasSize } = get()
    const center = {
      x: (canvasSize.width / 2 - view.tx) / view.zoom,
      y: (canvasSize.height / 2 - view.ty) / view.zoom,
    }
    const taken = new Set(
      get()
        .diagram.nodes.map((n) => n.cluster?.trim())
        .filter((name): name is string => !!name),
    )
    const { nodes, links } = instantiatePattern(pattern, center, taken)
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: [...state.diagram.nodes, ...nodes],
        links: [...state.diagram.links, ...links],
      },
      selectedNodes: nodes.map((n) => n.id),
      selectedLinks: [],
      toast: `Modèle « ${pattern.title} » inséré — reliez-le au schéma puis lancez le placement auto.`,
    }))
  },

  setView: (patch) => set((state) => ({ view: { ...state.view, ...patch } })),

  zoomAt: (factor, screenX, screenY) =>
    set((state) => {
      const zoom = Math.min(3, Math.max(0.15, state.view.zoom * factor))
      const ratio = zoom / state.view.zoom
      return {
        view: {
          zoom,
          tx: screenX - (screenX - state.view.tx) * ratio,
          ty: screenY - (screenY - state.view.ty) * ratio,
        },
      }
    }),

  setCanvasSize: (width, height) => set({ canvasSize: { width, height } }),

  fitView: () => {
    const { diagram, canvasSize } = get()
    if (diagram.nodes.length === 0) {
      set({ view: { zoom: 1, tx: canvasSize.width / 2, ty: canvasSize.height / 2 } })
      return
    }
    const padding = 72
    const bounds = diagramBounds(diagram.nodes)
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    const zoom = Math.min(
      2,
      Math.max(0.15, Math.min((canvasSize.width - padding * 2) / width, (canvasSize.height - padding * 2) / height)),
    )
    set({
      view: {
        zoom,
        tx: canvasSize.width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
        ty: canvasSize.height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
      },
    })
  },

  loadDiagram: (diagram) => {
    get().pushHistory()
    set({ diagram, selectedNodes: [], selectedLinks: [], connectFrom: null })
    get().fitView()
  },

  newDiagram: () => {
    get().pushHistory()
    set({ diagram: emptyDiagram(), selectedNodes: [], selectedLinks: [], connectFrom: null })
  },

  loadSample: () => {
    get().pushHistory()
    set((state) => ({
      diagram: autoLayoutOf(sampleDiagram(), state.layout),
      selectedNodes: [],
      selectedLinks: [],
      connectFrom: null,
    }))
    get().fitView()
  },

  notify: (toast) => set({ toast }),
}))

/** Incrémente le suffixe numérique d'un nom : SW-ACC-A1 → SW-ACC-A2, FW-01 → FW-02. */
function nextName(name: string, taken: Set<string>): string {
  const match = name.match(/^(.*?)(\d+)(\D*)$/)
  let candidate = match ? `${match[1]}${String(Number(match[2]) + 1).padStart(match[2].length, '0')}${match[3]}` : `${name} 2`
  let counter = 2
  while (taken.has(candidate)) {
    candidate = match ? `${match[1]}${String(Number(match[2]) + counter).padStart(match[2].length, '0')}${match[3]}` : `${name} ${counter + 1}`
    counter += 1
  }
  return candidate
}

/** Sauvegarde locale automatique, pour retrouver son travail au prochain lancement. */
let saveTimer: ReturnType<typeof setTimeout> | undefined
useDiagram.subscribe((state, previous) => {
  if (state.diagram === previous.diagram) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveLocal(useDiagram.getState().diagram), 400)
})
