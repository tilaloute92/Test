import { create } from 'zustand'
import { autoLayout, diagramBounds } from '../lib/layout'
import { deviceMeta } from '../lib/catalog'
import { uid } from '../lib/ids'
import { instantiatePattern, type HaPattern } from '../lib/patterns'
import { suggestLinkKind } from '../lib/linkRules'
import { parseQuickImport } from '../lib/quickImport'
import { emptyDiagram, loadLocal, saveLocal } from '../lib/storage'
import { sampleDiagram } from '../lib/sample'
import { collapsibleGroups } from '../lib/derive'
import type { DiscoveryResult } from '../lib/discovery'
import { downloadPng, downloadSvg, slugify } from '../lib/exportImage'
import { getDiagramSvg } from '../lib/exportRegistry'
import { interpret } from '../lib/voice'
import { inventoryFromCsv } from '../lib/inventory'
import { deduceVlans } from '../lib/osi'
import { firstFreeUnit, heightOf, rackOccupancy } from '../lib/racks'
import type {
  AppView,
  DetailLevel,
  Diagram,
  DeviceKind,
  LayoutOptions,
  LinkStyle,
  NetLink,
  NetNode,
  OsiView,
  RackDef,
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
    const findNode = (name: string) => {
      const needle = plain(name)
      const squeezed = needle.replace(/[\s-]/g, '')
      const nodes = get().diagram.nodes
      return (
        nodes.find((node) => plain(node.name) === needle) ??
        nodes.find((node) => plain(node.name).startsWith(needle)) ??
        nodes.find((node) => plain(node.name).replace(/[\s-]/g, '').includes(squeezed))
      )
    }

    switch (intent.type) {
      case 'add': {
        const position = center()
        get().setAppView('diagram')
        get().addNode(intent.kind, position.x, position.y)
        return { ok: true, message: `${intent.label} ajouté.` }
      }
      case 'link': {
        const from = findNode(intent.from)
        const to = findNode(intent.to)
        if (!from) return { ok: false, message: `Équipement « ${intent.from} » introuvable.` }
        if (!to) return { ok: false, message: `Équipement « ${intent.to} » introuvable.` }
        get().addLink(from.id, to.id)
        return { ok: true, message: `${from.name} relié à ${to.name}.` }
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
      case 'detail':
        get().setDetail(intent.level)
        return { ok: true, message: 'Niveau de détail modifié.' }
      case 'view': {
        const labels = { diagram: 'Schéma', inventory: 'Inventaire', racks: 'Baies', discovery: 'Découverte' }
        get().setAppView(intent.view)
        return { ok: true, message: `${labels[intent.view]} ouvert.` }
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
        get().setVoiceOpen(true)
        return { ok: true, message: 'Voici les commandes reconnues.' }
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
