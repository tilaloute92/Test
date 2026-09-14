import { create } from 'zustand'
import { autoLayout, diagramBounds } from '../lib/layout'
import { deviceMeta } from '../lib/catalog'
import { uid } from '../lib/ids'
import { instantiatePattern, type HaPattern } from '../lib/patterns'
import { suggestLinkKind } from '../lib/linkRules'
import { parseQuickImport } from '../lib/quickImport'
import { emptyDiagram, loadLocal, saveLocal } from '../lib/storage'
import { sampleDiagram } from '../lib/sample'
import { deduceVlans } from '../lib/osi'
import type {
  DetailLevel,
  Diagram,
  DeviceKind,
  LayoutOptions,
  LinkStyle,
  NetLink,
  NetNode,
  OsiView,
  VlanDef,
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
  connectFrom: string | null
  view: ViewState
  canvasSize: { width: number; height: number }
  toast: string | null

  pushHistory: () => void
  undo: () => void
  redo: () => void

  setTitle: (title: string) => void
  addNode: (kind: DeviceKind, x: number, y: number) => string
  updateNode: (id: string, patch: Partial<NetNode>) => void
  updateNodes: (ids: string[], patch: Partial<NetNode>) => void
  moveNodes: (ids: string[], dx: number, dy: number) => void
  setNodePositions: (positions: Record<string, { x: number; y: number }>) => void
  addLink: (from: string, to: string) => void
  updateLink: (id: string, patch: Partial<NetLink>) => void
  deleteSelection: () => void

  select: (target: { nodes?: string[]; links?: string[] }, additive?: boolean) => void
  clearSelection: () => void
  setMode: (mode: Mode) => void
  setPanel: (panel: 'properties' | 'ha' | 'osi' | 'catalog') => void
  bumpCatalog: () => void
  toggleCollapse: (key: string) => void
  setCollapsed: (keys: string[]) => void
  setDetail: (detail: DetailLevel) => void
  setOsi: (osi: OsiView) => void
  setStrictOsi: (strict: boolean) => void
  setVlans: (vlans: VlanDef[]) => void
  upsertVlan: (vlan: VlanDef) => void
  removeVlan: (id: string) => void
  deduceVlansFromDiagram: () => number
  setCommandOpen: (open: boolean) => void
  setImportOpen: (open: boolean) => void
  duplicateSelection: () => void
  importText: (text: string, mode: 'merge' | 'replace') => { nodes: number; links: number; warnings: string[] }
  focusNode: (id: string) => void
  setConnectFrom: (id: string | null) => void

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
  mode: 'select',
  panel: 'properties',
  catalogRevision: 0,
  collapsed: [],
  detail: 'full',
  osi: 'all',
  strictOsi: false,
  commandOpen: false,
  importOpen: false,
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

  addNode: (kind, x, y) => {
    get().pushHistory()
    const id = uid('n')
    const count = get().diagram.nodes.filter((n) => n.kind === kind).length + 1
    const node: NetNode = {
      id,
      kind,
      name: `${deviceMeta(kind).label} ${count}`,
      x: Math.round(x),
      y: Math.round(y),
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

  addLink: (from, to) => {
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
