import { create } from 'zustand'
import { autoLayout, diagramBounds, layerBands } from '../lib/layout'
import { deviceMeta, findDevice, ROLES , rankOf } from '../lib/catalog'
import { bestMatch } from '../lib/speech'
import { searchModels } from '../lib/vendors'
import { STATUS_LABELS } from '../lib/inventory'
import { uid } from '../lib/ids'
import { HA_PATTERNS, instantiatePattern, type HaPattern } from '../lib/patterns'
import { suggestLinkKind } from '../lib/linkRules'
import { parseQuickImport } from '../lib/quickImport'
import {
  diagramFileContent,
  emptyDiagram,
  loadLocal,
  nomDePageLibre,
  saveLocal,
} from '../lib/storage'
import { sampleDiagram } from '../lib/sample'
import { collapsibleGroups, groupKey } from '../lib/derive'
import { auditDiagram } from '../lib/ha'
import { analyseImpact } from '../lib/impact'
import { constructeurDe, proposerMecanisme } from '../lib/haTech'
import type { OperationPlan } from '../lib/assistant'
import {
  dupliquer,
  encombrement,
  OPTIONS_PAR_DEFAUT,
  type OptionsDuplication,
} from '../lib/duplication'
import {
  ecrirePressePapier,
  lirePressePapier,
  type PressePapier,
} from '../lib/pressePapier'
import type { DiscoveryResult } from '../lib/discovery'
import { downloadBlob, downloadPng, downloadSvg, slugify } from '../lib/exportImage'
import { getDiagramSvg } from '../lib/exportRegistry'
import { interpret, isEditingIntent } from '../lib/voice'
import { inventoryFromCsv } from '../lib/inventory'
import { deduceVlans } from '../lib/osi'
import { NODE_H, NODE_W } from '../types'
import { modeDefinition } from '../lib/viewModes'
import { projectionLogique, VUES_LOGIQUES, type VueLogique } from '../lib/vlanViews'
import { firstFreeUnit, heightOf, rackOccupancy } from '../lib/racks'
import type {
  Annotation,
  AnnotationKind,
  AppView,
  Attach,
  FlowDef,
  TitleBlock,
  Classeur,
  DetailLevel,
  LabelOffset,
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

/**
 * Bandeaux latéraux : un réglage de confort, propre au poste et à son écran — il n'a rien à
 * faire dans le document, que l'on partage.
 */
const CLE_PANNEAUX = 'netschema:panneaux'

function lirePanneau(nom: 'palette' | 'inspecteur'): boolean {
  try {
    const brut = localStorage.getItem(CLE_PANNEAUX)
    if (!brut) return true
    const etat = JSON.parse(brut) as Record<string, unknown>
    return etat[nom] !== false
  } catch {
    return true
  }
}

function ecrirePanneau(nom: 'palette' | 'inspecteur', ouvert: boolean) {
  try {
    const brut = localStorage.getItem(CLE_PANNEAUX)
    const etat = brut ? (JSON.parse(brut) as Record<string, unknown>) : {}
    localStorage.setItem(CLE_PANNEAUX, JSON.stringify({ ...etat, [nom]: ouvert }))
  } catch {
    // Stockage indisponible : le réglage vaut pour la session, sans plus.
  }
}

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

/**
 * Alignements proposés. Ce sont ceux de tous les outils de dessin — les retrouver ici évite
 * d'aligner à l'œil des boîtes que la grille seule ne suffit pas à ranger.
 */
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

interface DiagramStore {
  /** Page ouverte. Tout le reste de l'application ne connaît qu'elle. */
  diagram: Diagram
  /**
   * Les autres pages du document, la page ouverte comprise (sa copie y est remise à chaque
   * bascule). `pagesCompletes()` donne à tout moment l'état vrai des pages.
   */
  pages: Diagram[]
  activePage: number
  past: Diagram[]
  future: Diagram[]
  selectedNodes: string[]
  selectedLinks: string[]
  /** Annotations sélectionnées : elles se déplacent et se suppriment comme le reste. */
  selectedAnnotations: string[]
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
  /** Répartition automatique des accroches pour éviter les liaisons superposées. */
  spreadLinks: boolean
  /** Légende posée sous le schéma, construite d'après son contenu. */
  showLegend: boolean
  /**
   * Ovales des agrégats de liens (port-channels). Sans eux, deux câbles indépendants et un
   * bundle LACP se dessinent pareil — et ne veulent pourtant pas dire la même chose.
   */
  showLags: boolean
  /** Mode de visualisation : architecture, technique, présentation. */
  viewMode: ViewMode
  /**
   * Lecture choisie pour le mode logique : routage, rails VLAN, domaines de diffusion. Les
   * deux dernières sont des projections du document — on les regarde, on n'y écrit pas.
   */
  vueLogique: VueLogique
  setVueLogique: (vue: VueLogique) => void
  /**
   * VLAN mis en avant sur le plan (le « projecteur ») : ce qui le porte ressort, le reste
   * s'estompe. Indépendant du mode et de la couche regardée.
   */
  vlanFocus: string | null
  setVlanFocus: (id: string | null) => void
  /**
   * Le schéma tel qu'il est affiché. C'est le document lui-même partout, sauf dans les vues
   * logiques projetées, qui en sont une lecture calculée.
   */
  schemaAffiche: () => Diagram
  /** Vrai quand ce qui est affiché est une projection : rien n'y est modifiable. */
  estProjection: () => boolean
  /** Module affiché : schéma, inventaire, baies, découverte. */
  appView: AppView
  mode: Mode
  panel: 'properties' | 'ha' | 'osi' | 'catalog' | 'impact'
  /**
   * Analyse d'impact : équipements arrêtés et câbles débranchés pour la simulation en cours.
   * Elle ne modifie jamais le schéma — c'est une hypothèse de travail, pas une édition.
   */
  pannes: { nodes: string[]; links: string[] }
  /** Incrémenté à chaque modification du catalogue, pour rafraîchir les listes de types. */
  catalogRevision: number
  /** Clés des groupes repliés (« zone:Bâtiment A »). */
  collapsed: string[]
  detail: DetailLevel
  /** Couche OSI mise en avant (toutes, physique, liaison, réseau). */
  osi: OsiView
  /** Masquer au lieu d'estomper ce qui n'appartient pas à la couche regardée. */
  strictOsi: boolean
  /** Bandeaux latéraux : la palette à gauche, l'inspecteur à droite. */
  paletteOpen: boolean
  inspectorOpen: boolean
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
  /** Déplace une étiquette de liaison à la main ; `null` la rend au placement automatique. */
  setLabelOffset: (id: string, which: 'mid' | 'a' | 'b', offset: LabelOffset | null) => void
  /** Ordre d'empilement des équipements : premier plan, arrière-plan, d'un cran. */
  reorderNodes: (ids: string[], where: ZOrder) => void
  /** Aligne les équipements sélectionnés sur un bord ou sur leur axe commun. */
  alignNodes: (ids: string[], mode: AlignMode) => void
  /** Répartit les équipements sélectionnés à intervalles égaux. */
  distributeNodes: (ids: string[], axis: 'x' | 'y') => void
  /** Sélectionne tout le contenu de la page (équipements et annotations). */
  selectAll: () => void
  deleteSelection: () => void

  /** Verrouille ou déverrouille le schéma entier : en lecture seule, plus rien ne bouge. */
  /** Renomme une couche pour ce schéma seulement ; un nom vide rend le nom par défaut. */
  setLayerName: (rank: number, name: string) => void
  /** Déplace en bloc les équipements d'une couche. */
  moveLayer: (rank: number, dx: number, dy: number) => void
  /** Étale ou resserre les équipements d'une couche autour d'un point fixe. */
  spreadLayer: (rank: number, facteur: number, ancre: number, axe: 'x' | 'y') => void
  /** Marge du cadre d'une couche, en pixels. */
  setLayerPad: (rank: number, pad: number) => void
  /** Renomme un site, une zone ou une grappe : tous ses équipements suivent. */
  renameGroup: (type: 'site' | 'zone' | 'cluster', from: string, to: string) => void
  setLocked: (locked: boolean) => void
  /**
   * Positions calculées des étiquettes, publiées par le plan de travail.
   *
   * Le store ne sait pas dessiner : c'est le canevas qui place les étiquettes. Il dépose ici
   * le résultat de son calcul, ce qui permet de figer ces positions au verrouillage.
   */
  labelPlacements: () => Map<string, { dx: number; dy: number }>
  publishLabelPlacements: (placements: Map<string, { dx: number; dy: number }>) => void
  /**
   * Fige les étiquettes de liaison là où elles sont, ou leur rend le placement automatique.
   * Le verrouillage inscrit la position calculée de chacune dans le schéma : elle ne bougera
   * plus, même si le schéma change autour d'elle.
   */
  setLabelsLocked: (locked: boolean, placements?: Map<string, { dx: number; dy: number }>) => void

  select: (target: { nodes?: string[]; links?: string[]; annotations?: string[] }, additive?: boolean) => void
  clearSelection: () => void
  setAppView: (view: AppView) => void
  setMode: (mode: Mode) => void
  setPanel: (panel: 'properties' | 'ha' | 'osi' | 'catalog' | 'impact') => void
  /** Bascule l'état « en panne » d'un équipement ou d'une liaison. */
  togglePanne: (type: 'node' | 'link', id: string) => void
  /** Rétablit tout : la simulation repart d'un réseau intact. */
  clearPannes: () => void
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

  /** Pose une note, un cadre commenté ou une flèche sur le plan et la sélectionne. */
  addAnnotation: (kind: AnnotationKind, seed?: Partial<Annotation>) => string
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
  moveAnnotation: (id: string, dx: number, dy: number) => void
  removeAnnotation: (id: string) => void
  /** Cartouche du document : auteur, indice, diffusion. */
  setTitleBlock: (patch: Partial<TitleBlock>) => void
  /** Matrice de flux : ajout / modification d'une ligne. */
  upsertFlow: (flow: FlowDef) => void
  removeFlow: (id: string) => void

  deduceVlansFromDiagram: () => number
  /**
   * Renseigne le mécanisme de bascule des grappes qui n'en déclarent pas, d'après le
   * matériel et la liaison tracée entre les membres. Ne touche jamais à ce qui est déjà saisi.
   */
  deduireMecanismesHa: () => { grappes: number; equipements: number }
  /**
   * Applique un plan de l'assistant : création des équipements manquants, des liaisons, et
   * mise à jour des champs. Tout passe par une seule entrée d'historique — on annule un plan
   * d'un seul Ctrl+Z, comme on annule une action.
   */
  appliquerPlan: (operations: OperationPlan[]) => { noeuds: number; liaisons: number }
  /** Panneau de l'assistant de conception. */
  assistantOpen: boolean
  setAssistantOpen: (open: boolean) => void
  /** Afficher ou masquer un bandeau latéral. Le choix est propre au poste, pas au document. */
  setPanelOpen: (panneau: 'palette' | 'inspecteur', ouvert: boolean) => void
  setCommandOpen: (open: boolean) => void
  setImportOpen: (open: boolean) => void
  setVoiceOpen: (open: boolean) => void
  runVoiceCommand: (transcript: string) => { ok: boolean; message: string }
  /**
   * Duplique la sélection sur place. `decalage` place la copie ; 0/0 sert au glisser-copier,
   * où c'est le déplacement de la souris qui la positionne ensuite.
   */
  duplicateSelection: (decalage?: { dx: number; dy: number }) => string[]
  /** Duplication en série : N copies renommées, réadressées et recâblées d'un seul geste. */
  duplicateSeries: (options: OptionsDuplication) => { equipements: number; liaisons: number }
  /** Dialogue de duplication en série. */
  duplicateOpen: boolean
  setDuplicateOpen: (open: boolean) => void
  duplicateOptions: OptionsDuplication
  setDuplicateOptions: (patch: Partial<OptionsDuplication>) => void
  /**
   * Presse-papiers du schéma. Il vit dans l'application *et* dans le presse-papiers du
   * système : c'est ce qui permet de coller un bloc sur une autre page, dans un autre
   * document, ou dans une autre fenêtre du navigateur.
   */
  presse: PressePapier | null
  copySelection: (couper?: boolean) => { equipements: number; liaisons: number }
  pasteClipboard: (at?: { x: number; y: number }) => Promise<{ equipements: number; liaisons: number }>
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
        | 'spreadLinks'
        | 'showLegend'
        | 'showLags'
      >
    >,
  ) => void
  insertPattern: (pattern: HaPattern) => void

  setView: (patch: Partial<ViewState>) => void
  zoomAt: (factor: number, screenX: number, screenY: number) => void
  setCanvasSize: (width: number, height: number) => void
  fitView: () => void

  loadDiagram: (diagram: Diagram) => void
  loadClasseur: (classeur: Classeur) => void
  /** Toutes les pages, page ouverte à jour : ce qu'on enregistre ou exporte. */
  pagesCompletes: () => Diagram[]
  classeur: () => Classeur
  addPage: (name?: string) => void
  duplicatePage: (index?: number) => void
  removePage: (index: number) => void
  renamePage: (index: number, name: string) => void
  selectPage: (index: number) => void
  movePage: (index: number, direction: -1 | 1) => void
  setPageLocked: (index: number, locked: boolean) => void
  newDiagram: () => void
  loadSample: () => void
  notify: (message: string | null) => void
}

const classeurInitial = loadLocal() ?? {
  title: 'Architecture réseau',
  pages: [autoLayoutOf(sampleDiagram(), DEFAULT_LAYOUT)],
  activePage: 0,
}
const pagesInitiales = classeurInitial.pages.map((page) => ({
  ...page,
  title: classeurInitial.title,
  pageName: page.pageName ?? 'Schéma',
}))
const indexInitial = Math.max(0, Math.min(pagesInitiales.length - 1, classeurInitial.activePage ?? 0))

function autoLayoutOf(diagram: Diagram, layout: LayoutOptions): Diagram {
  return { ...diagram, nodes: autoLayout(diagram, layout) }
}

/**
 * Schéma verrouillé : garde posée à l'entrée de chaque action qui modifie le document.
 *
 * Le verrou appartient au schéma, pas à l'interface : le neutraliser en désactivant des
 * boutons laisserait passer la voix, les raccourcis et les imports. Une seule barrière, au
 * seul endroit par lequel tout passe.
 */
let lockedStore: () => boolean = () => false

/** Dernières positions d'étiquettes calculées par le plan de travail, en décalages. */
let lastLabelPlacements = new Map<string, { dx: number; dy: number }>()

/**
 * Retire les champs non renseignés d'un correctif.
 *
 * Les plans de l'assistant décrivent des champs facultatifs (zone, site, grappe) : laisser
 * passer leurs `undefined` effacerait ce que l'utilisateur a déjà saisi.
 */
function nettoyer<T extends object>(patch: T): Partial<T> {
  const propre: Record<string, unknown> = {}
  for (const [cle, valeur] of Object.entries(patch)) {
    if (valeur !== undefined) propre[cle] = valeur
  }
  return propre as Partial<T>
}

export const useDiagram = create<DiagramStore>((set, get) => ({
  diagram: pagesInitiales[indexInitial],
  pages: pagesInitiales,
  activePage: indexInitial,
  past: [],
  future: [],
  selectedNodes: [],
  selectedLinks: [],
  selectedAnnotations: [],
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
  spreadLinks: true,
  showLegend: false,
  showLags: true,
  vueLogique: 'routage' as VueLogique,
  vlanFocus: null as string | null,
  viewMode: 'architecture',
  appView: 'diagram',
  mode: 'select',
  panel: 'properties',
  catalogRevision: 0,
  collapsed: [],
  detail: 'full',
  osi: 'all',
  strictOsi: false,
  paletteOpen: lirePanneau('palette'),
  inspectorOpen: lirePanneau('inspecteur'),
  pannes: { nodes: [], links: [] },
  commandOpen: false,
  importOpen: false,
  assistantOpen: false,
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

  setTitle: (title) => {
    if (lockedStore()) return
    // Le titre appartient au document : les onglets portent des noms, pas des titres.
    set((state) => ({
      diagram: { ...state.diagram, title },
      pages: state.pages.map((page) => ({ ...page, title })),
    }))
  },

  addNode: (kind, x, y, seed) => {
    if (lockedStore()) return ''
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
    if (lockedStore()) return
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      },
    }))
  },

  updateNodes: (ids, patch) => {
    if (lockedStore()) return
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
  moveNodes: (ids, dx, dy) => {
    if (lockedStore()) return
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((n) =>
          ids.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n,
        ),
      },
    }))
  },

  setNodePositions: (positions) => {
    if (lockedStore()) return
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((n) => (positions[n.id] ? { ...n, ...positions[n.id] } : n)),
      },
    }))
  },

  addLink: (from, to, seed) => {
    if (lockedStore()) return
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
    if (lockedStore()) return
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
  setLinkWaypoints: (id, waypoints) => {
    if (lockedStore()) return
    set((state) => ({
      diagram: {
        ...state.diagram,
        links: state.diagram.links.map((link) =>
          link.id === id ? { ...link, waypoints: waypoints.length > 0 ? waypoints : undefined } : link,
        ),
      },
    }))
  },

  /** Rend son tracé automatique à une liaison : points de passage et accroches effacés. */
  clearLinkRoute: (id) => {
    if (lockedStore()) return
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
                labelOffset: undefined,
                labelOffsetA: undefined,
                labelOffsetB: undefined,
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
  attachLink: (id, end, nodeId, attach) => {
    if (lockedStore()) return
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
    }))
  },

  labelPlacements: () => lastLabelPlacements,
  publishLabelPlacements: (placements) => {
    lastLabelPlacements = placements
  },

  setLayerName: (rank, name) => {
    if (lockedStore()) return
    get().pushHistory()
    set((state) => {
      const noms = { ...(state.diagram.layerNames ?? {}) }
      const propre = name.trim().slice(0, 40)
      if (propre) noms[String(rank)] = propre
      else delete noms[String(rank)]
      return {
        diagram: { ...state.diagram, layerNames: Object.keys(noms).length > 0 ? noms : undefined },
      }
    })
  },

  moveLayer: (rank, dx, dy) => {
    if (lockedStore()) return
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((node) =>
          rankOf(node.kind, node.rank) === rank
            ? // Déplacer une couche à la main l'épingle, comme un équipement déplacé : sans
              // cela, le prochain placement automatique effacerait le geste.
              { ...node, x: Math.round(node.x + dx), y: Math.round(node.y + dy), pinned: true }
            : node,
        ),
      },
    }))
  },

  spreadLayer: (rank, facteur, ancre, axe) => {
    if (lockedStore()) return
    const borne = Math.max(0.2, Math.min(4, facteur))
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((node) => {
          if (rankOf(node.kind, node.rank) !== rank) return node
          const valeur = axe === 'x' ? node.x : node.y
          const suivant = Math.round(ancre + (valeur - ancre) * borne)
          return { ...node, [axe]: suivant, pinned: true }
        }),
      },
    }))
  },

  setLayerPad: (rank, pad) => {
    if (lockedStore()) return
    set((state) => {
      const marges = { ...(state.diagram.layerPads ?? {}) }
      const valeur = Math.max(-20, Math.min(160, Math.round(pad)))
      if (valeur === 0) delete marges[String(rank)]
      else marges[String(rank)] = valeur
      return {
        diagram: { ...state.diagram, layerPads: Object.keys(marges).length > 0 ? marges : undefined },
      }
    })
  },

  renameGroup: (type, from, to) => {
    if (lockedStore()) return
    const propre = to.trim()
    if (!propre || propre === from) return
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((node) => (node[type] === from ? { ...node, [type]: propre } : node)),
      },
    }))
    const collapsedKey = groupKey(type === 'cluster' ? 'cluster' : type, from)
    // Un groupe replié garde son repli sous son nouveau nom.
    set((state) => ({
      collapsed: state.collapsed.map((key) =>
        key === collapsedKey ? groupKey(type === 'cluster' ? 'cluster' : type, propre) : key,
      ),
    }))
  },

  setLocked: (locked) => {
    get().pushHistory()
    set((state) => ({
      diagram: { ...state.diagram, locked: locked || undefined },
      mode: 'select',
      selectedNodes: locked ? [] : state.selectedNodes,
      selectedLinks: locked ? [] : state.selectedLinks,
      toast: locked ? 'Schéma verrouillé : lecture seule.' : 'Schéma déverrouillé.',
    }))
  },

  setLabelsLocked: (locked, placements) => {
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        labelsLocked: locked || undefined,
        // Au verrouillage, la position calculée de chaque étiquette devient sa position
        // propre : c'est ce qui la rend stable quand le schéma évolue autour d'elle.
        links: placements
          ? state.diagram.links.map((link) => ({
              ...link,
              labelOffset: placements.get(`${link.id}:mid`) ?? link.labelOffset,
              labelOffsetA: placements.get(`${link.id}:a`) ?? link.labelOffsetA,
              labelOffsetB: placements.get(`${link.id}:b`) ?? link.labelOffsetB,
            }))
          : state.diagram.links,
      },
      toast: locked ? 'Étiquettes verrouillées.' : 'Étiquettes déverrouillées.',
    }))
  },

  /**
   * Étiquette déplacée à la main. Comme pour un point de passage, l'historique n'enregistre
   * qu'une étape au début du glissement : c'est `pushHistory` de l'appelant qui s'en charge.
   */
  setLabelOffset: (id, which, offset) => {
    if (lockedStore()) return
    set((state) => ({
      diagram: {
        ...state.diagram,
        links: state.diagram.links.map((link) => {
          if (link.id !== id) return link
          const value = offset ?? undefined
          if (which === 'mid') return { ...link, labelOffset: value }
          return which === 'a' ? { ...link, labelOffsetA: value } : { ...link, labelOffsetB: value }
        }),
      },
    }))
  },

  clearLinkAttach: (id) => {
    if (lockedStore()) return
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
    if (lockedStore()) return
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

  /**
   * Alignement : on prend le bord commun de la sélection et on y range tout le monde.
   *
   * L'aimantation à la grille ne suffit pas — deux équipements peuvent être sur la grille et
   * décalés d'un pas. Les positions sont des centres de boîte, d'où la demi-taille ajoutée
   * pour les bords.
   */
  alignNodes: (ids, mode) => {
    if (lockedStore() || ids.length < 2) return
    const cibles = get().diagram.nodes.filter((node) => ids.includes(node.id))
    if (cibles.length < 2) return
    get().pushHistory()
    const xs = cibles.map((node) => node.x)
    const ys = cibles.map((node) => node.y)
    const valeur = {
      left: Math.min(...xs),
      right: Math.max(...xs),
      hcenter: (Math.min(...xs) + Math.max(...xs)) / 2,
      top: Math.min(...ys),
      bottom: Math.max(...ys),
      vcenter: (Math.min(...ys) + Math.max(...ys)) / 2,
    }[mode]
    const horizontal = mode === 'left' || mode === 'right' || mode === 'hcenter'
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((node) =>
          ids.includes(node.id)
            ? { ...node, [horizontal ? 'x' : 'y']: Math.round(valeur) }
            : node,
        ),
      },
    }))
  },

  /** Répartition : les extrêmes ne bougent pas, les autres se placent à pas égal entre eux. */
  distributeNodes: (ids, axis) => {
    if (lockedStore() || ids.length < 3) return
    const cibles = get()
      .diagram.nodes.filter((node) => ids.includes(node.id))
      .sort((a, b) => a[axis] - b[axis])
    if (cibles.length < 3) return
    get().pushHistory()
    const debut = cibles[0][axis]
    const fin = cibles[cibles.length - 1][axis]
    const pas = (fin - debut) / (cibles.length - 1)
    const positions = new Map(cibles.map((node, index) => [node.id, Math.round(debut + index * pas)]))
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((node) =>
          positions.has(node.id) ? { ...node, [axis]: positions.get(node.id) as number } : node,
        ),
      },
    }))
  },

  selectAll: () =>
    set((state) => ({
      selectedNodes: state.diagram.nodes.map((node) => node.id),
      selectedLinks: [],
      selectedAnnotations: (state.diagram.annotations ?? []).map((annotation) => annotation.id),
    })),

  deleteSelection: () => {
    if (lockedStore()) return
    const { selectedNodes, selectedLinks, selectedAnnotations } = get()
    if (selectedNodes.length === 0 && selectedLinks.length === 0 && selectedAnnotations.length === 0) {
      return
    }
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
        annotations: (state.diagram.annotations ?? []).filter(
          (a) => !selectedAnnotations.includes(a.id),
        ),
      },
      selectedNodes: [],
      selectedLinks: [],
      selectedAnnotations: [],
    }))
  },

  select: (target, additive = false) =>
    set((state) => {
      const nodes = target.nodes ?? []
      const links = target.links ?? []
      const annotations = target.annotations ?? []
      if (!additive) {
        return { selectedNodes: nodes, selectedLinks: links, selectedAnnotations: annotations }
      }
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
        selectedAnnotations: toggle(state.selectedAnnotations, annotations),
      }
    }),

  clearSelection: () => set({ selectedNodes: [], selectedLinks: [], selectedAnnotations: [] }),
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
    if (lockedStore()) return ''
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
    if (lockedStore()) return
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
    if (lockedStore()) return
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
    if (lockedStore()) return
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
    if (lockedStore()) return
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
    if (lockedStore()) return { updated: 0, created: 0, warnings: ['Schéma verrouillé.'] }
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
    if (lockedStore()) return { created: 0, updated: 0, links: 0 }
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
    if (lockedStore()) return
    get().pushHistory()
    set((state) => ({ diagram: { ...state.diagram, vlans } }))
  },

  upsertVlan: (vlan) => {
    if (lockedStore()) return
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
    if (lockedStore()) return
    get().pushHistory()
    set((state) => ({
      diagram: { ...state.diagram, vlans: (state.diagram.vlans ?? []).filter((vlan) => vlan.id !== id) },
    }))
  },

  /**
   * Pose une annotation au centre de la vue, ou à l'endroit demandé.
   *
   * Les trois formes répondent à trois besoins distincts : la note explique, le cadre
   * délimite un périmètre qui n'est pas une zone du modèle (un lot de travaux, une phase de
   * migration), la flèche montre du doigt.
   */
  addAnnotation: (kind, seed) => {
    if (lockedStore()) return ''
    const { view, canvasSize } = get()
    const centre = {
      x: Math.round((canvasSize.width / 2 - view.tx) / view.zoom),
      y: Math.round((canvasSize.height / 2 - view.ty) / view.zoom),
    }
    const gabarit =
      kind === 'note'
        ? { w: 220, h: 88, text: 'Note' }
        : kind === 'zone'
          ? { w: 340, h: 220, text: 'Périmètre' }
          : { w: 160, h: 90, text: '' }
    const annotation: Annotation = {
      id: uid('a'),
      kind,
      x: seed?.x ?? centre.x - gabarit.w / 2,
      y: seed?.y ?? centre.y - gabarit.h / 2,
      w: seed?.w ?? gabarit.w,
      h: seed?.h ?? gabarit.h,
      text: seed?.text ?? gabarit.text,
      color: seed?.color,
    }
    get().pushHistory()
    set((state) => ({
      diagram: { ...state.diagram, annotations: [...(state.diagram.annotations ?? []), annotation] },
      selectedNodes: [],
      selectedLinks: [],
      selectedAnnotations: [annotation.id],
    }))
    return annotation.id
  },

  updateAnnotation: (id, patch) => {
    if (lockedStore()) return
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        annotations: (state.diagram.annotations ?? []).map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      },
    }))
  },

  /** Déplacement : sans historique à chaque pixel, c'est le glisser qui l'empile. */
  moveAnnotation: (id, dx, dy) =>
    set((state) => ({
      diagram: {
        ...state.diagram,
        annotations: (state.diagram.annotations ?? []).map((item) =>
          item.id === id ? { ...item, x: item.x + dx, y: item.y + dy } : item,
        ),
      },
    })),

  removeAnnotation: (id) => {
    if (lockedStore()) return
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        annotations: (state.diagram.annotations ?? []).filter((item) => item.id !== id),
      },
      selectedAnnotations: state.selectedAnnotations.filter((item) => item !== id),
    }))
  },

  setTitleBlock: (patch) => {
    if (lockedStore()) return
    get().pushHistory()
    set((state) => ({
      diagram: { ...state.diagram, titleBlock: { ...(state.diagram.titleBlock ?? {}), ...patch } },
    }))
  },

  upsertFlow: (flow) => {
    if (lockedStore()) return
    get().pushHistory()
    set((state) => {
      const flows = [...(state.diagram.flows ?? [])]
      const index = flows.findIndex((item) => item.id === flow.id)
      if (index >= 0) flows[index] = { ...flows[index], ...flow }
      else flows.push(flow)
      return { diagram: { ...state.diagram, flows } }
    })
  },

  removeFlow: (id) => {
    if (lockedStore()) return
    get().pushHistory()
    set((state) => ({
      diagram: { ...state.diagram, flows: (state.diagram.flows ?? []).filter((f) => f.id !== id) },
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
  deduireMecanismesHa: () => {
    if (lockedStore()) return { grappes: 0, equipements: 0 }
    const diagram = get().diagram
    const parGrappe = new Map<string, NetNode[]>()
    for (const node of diagram.nodes) {
      const nom = node.cluster?.trim()
      if (!nom) continue
      const liste = parGrappe.get(nom)
      if (liste) liste.push(node)
      else parGrappe.set(nom, [node])
    }

    const choix = new Map<string, string>()
    let grappes = 0
    for (const [, membres] of parGrappe) {
      if (membres.length < 2) continue
      if (membres.some((membre) => membre.haTech?.trim())) continue
      const ids = new Set(membres.map((membre) => membre.id))
      const interne = diagram.links.find((link) => ids.has(link.from) && ids.has(link.to))
      const actifs = membres.filter((membre) => membre.role !== 'witness')
      const reference = actifs[0] ?? membres[0]
      const propose = proposerMecanisme(
        reference.kind,
        constructeurDe(reference.vendor, reference.model),
        interne?.kind,
        actifs.length,
        reference.model,
      )
      if (!propose) continue
      grappes += 1
      // Le témoin ne met pas en œuvre le mécanisme : il l'arbitre.
      for (const membre of actifs) choix.set(membre.id, propose.id)
    }

    if (choix.size === 0) return { grappes: 0, equipements: 0 }
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: state.diagram.nodes.map((node) =>
          choix.has(node.id) ? { ...node, haTech: choix.get(node.id) } : node,
        ),
      },
    }))
    return { grappes, equipements: choix.size }
  },

  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),

  appliquerPlan: (operations) => {
    if (lockedStore()) return { noeuds: 0, liaisons: 0 }
    const etat = get()
    etat.pushHistory()

    const parNom = new Map(etat.diagram.nodes.map((node) => [node.name.trim().toLowerCase(), node.id]))
    const nodes = [...etat.diagram.nodes]
    const links = [...etat.diagram.links]
    let noeuds = 0
    let liaisons = 0

    /*
      Placement des nouveautés : une rangée par couche, sous le schéma existant. Le placement
      automatique rangerait mieux, mais il déplacerait aussi ce que l'utilisateur a disposé à
      la main — ce n'est pas à un assistant d'en décider.
    */
    const bornes = diagramBounds(etat.diagram.nodes)
    const depart = etat.diagram.nodes.length === 0 ? 0 : bornes.maxY + 140
    const occupation = new Map<number, number>()

    const creer = (nom: string, kind: DeviceKind, patch?: Partial<NetNode>): string => {
      const cle = nom.trim().toLowerCase()
      const existant = parNom.get(cle)
      if (existant) {
        if (patch) {
          const index = nodes.findIndex((node) => node.id === existant)
          if (index >= 0) nodes[index] = { ...nodes[index], ...nettoyer(patch) }
        }
        return existant
      }
      const rang = rankOf(kind, patch?.rank ?? null)
      const colonne = occupation.get(rang) ?? 0
      occupation.set(rang, colonne + 1)
      const id = uid('n')
      nodes.push({
        id,
        kind,
        name: nom,
        x: Math.round(bornes.minX + colonne * (NODE_W + 60)),
        y: Math.round(depart + rang * 150),
        ...nettoyer(patch ?? {}),
      })
      parNom.set(cle, id)
      noeuds += 1
      return id
    }

    for (const operation of operations) {
      if (operation.type === 'noeud') {
        creer(operation.nom, operation.kind, operation.patch)
      } else if (operation.type === 'champs') {
        const id = parNom.get(operation.nom.trim().toLowerCase())
        const index = id ? nodes.findIndex((node) => node.id === id) : -1
        if (index >= 0) nodes[index] = { ...nodes[index], ...nettoyer(operation.patch) }
      } else if (operation.type === 'liaison') {
        const de = parNom.get(operation.de.trim().toLowerCase())
        const vers = parNom.get(operation.vers.trim().toLowerCase())
        if (!de || !vers || de === vers) continue
        links.push({ id: uid('l'), from: de, to: vers, kind: operation.kind, ...nettoyer(operation.patch ?? {}) })
        liaisons += 1
      } else {
        const de = parNom.get(operation.de.trim().toLowerCase())
        const vers = parNom.get(operation.vers.trim().toLowerCase())
        if (!de || !vers) continue
        for (const [index, link] of links.entries()) {
          const memeCouple =
            (link.from === de && link.to === vers) || (link.from === vers && link.to === de)
          if (memeCouple) links[index] = { ...link, ...nettoyer(operation.patch) }
        }
      }
    }

    set((state) => ({ diagram: { ...state.diagram, nodes, links }, selectedNodes: [], selectedLinks: [] }))
    return { noeuds, liaisons }
  },

  setPanelOpen: (panneau, ouvert) => {
    ecrirePanneau(panneau === 'palette' ? 'palette' : 'inspecteur', ouvert)
    set(panneau === 'palette' ? { paletteOpen: ouvert } : { inspectorOpen: ouvert })
  },

  togglePanne: (type, id) =>
    set((state) => {
      const champ = type === 'node' ? 'nodes' : 'links'
      const courant = state.pannes[champ]
      const suivant = courant.includes(id)
        ? courant.filter((item) => item !== id)
        : [...courant, id]
      return { pannes: { ...state.pannes, [champ]: suivant } }
    }),

  clearPannes: () => set({ pannes: { nodes: [], links: [] } }),

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
    // Lire, naviguer, interroger et exporter restent permis sur un schéma verrouillé ; le
    // modifier est refusé avec l'explication, plutôt que de ne rien faire en silence.
    if (lockedStore() && isEditingIntent(intent)) {
      return { ok: false, message: 'Schéma verrouillé : dites « déverrouille le schéma » pour le modifier.' }
    }

    const state = get()
    /**
     * Point de dépose d'un équipement ajouté à la voix : le centre de la vue, décalé jusqu'à
     * trouver une place libre.
     *
     * Sans cela, dicter deux équipements de suite les empile exactement l'un sur l'autre — on
     * croit n'en avoir ajouté qu'un, et la liaison entre eux n'a nulle part où passer.
     */
    const center = () => {
      const { view, canvasSize, snap, diagram } = get()
      const raw = {
        x: (canvasSize.width / 2 - view.tx) / view.zoom,
        y: (canvasSize.height / 2 - view.ty) / view.zoom,
      }
      const arrondi = (point: { x: number; y: number }) =>
        snap
          ? { x: Math.round(point.x / GRID) * GRID, y: Math.round(point.y / GRID) * GRID }
          : { x: Math.round(point.x), y: Math.round(point.y) }

      const occupe = (point: { x: number; y: number }) =>
        diagram.nodes.some(
          (node) => Math.abs(node.x - point.x) < NODE_W * 0.8 && Math.abs(node.y - point.y) < NODE_H * 1.2,
        )

      // Balayage en carrés concentriques : on reste près du centre de la vue.
      const pasX = NODE_W + 40
      const pasY = NODE_H + 40
      for (let anneau = 0; anneau < 8; anneau += 1) {
        for (let dy = -anneau; dy <= anneau; dy += 1) {
          for (let dx = -anneau; dx <= anneau; dx += 1) {
            if (anneau > 0 && Math.abs(dx) !== anneau && Math.abs(dy) !== anneau) continue
            const candidat = arrondi({ x: raw.x + dx * pasX, y: raw.y + dy * pasY })
            if (!occupe(candidat)) return candidat
          }
        }
      }
      return arrondi(raw)
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

      case 'lock': {
        get().setAppView('diagram')
        if (intent.what === 'labels') {
          get().setLabelsLocked(intent.locked, intent.locked ? get().labelPlacements() : undefined)
          return { ok: true, message: intent.locked ? 'Étiquettes verrouillées.' : 'Étiquettes déverrouillées.' }
        }
        get().setLocked(intent.locked)
        return {
          ok: true,
          message: intent.locked ? 'Schéma verrouillé : lecture seule.' : 'Schéma déverrouillé.',
        }
      }

      case 'impact': {
        get().setAppView('diagram')
        get().setPanel('impact')
        if (intent.action === 'open') {
          const rapport = analyseImpact(get().diagram, get().pannes)
          return {
            ok: true,
            message:
              rapport.compte.panne === 0
                ? `Réseau intact : ${rapport.compte.fragile} équipement(s) ne tiennent qu'à un fil.`
                : `${rapport.compte.isole} isolé(s), ${rapport.compte.fragile} à un fil, ${rapport.disponibilite} % joignable.`,
          }
        }
        if (intent.action === 'reset') {
          get().clearPannes()
          return { ok: true, message: 'Simulation remise à zéro : réseau intact.' }
        }
        if (intent.action === 'unplug') {
          const from = findNode(intent.target ?? '')
          const to = findNode(intent.to ?? '')
          if (!from || !to) return { ok: false, message: 'Les deux équipements de la liaison sont attendus.' }
          const lien = get().diagram.links.find(
            (link) =>
              (link.from === from.id && link.to === to.id) || (link.from === to.id && link.to === from.id),
          )
          if (!lien) return { ok: false, message: `Aucune liaison entre ${from.name} et ${to.name}.` }
          get().togglePanne('link', lien.id)
          const coupee = get().pannes.links.includes(lien.id)
          const rapport = analyseImpact(get().diagram, get().pannes)
          return {
            ok: true,
            message: coupee
              ? `Liaison ${from.name} ↔ ${to.name} débranchée : ${rapport.compte.isole} isolé(s), ${rapport.compte.fragile} à un fil.`
              : `Liaison ${from.name} ↔ ${to.name} rebranchée.`,
          }
        }

        const cible = findNode(intent.target ?? '')
        if (!cible) return { ok: false, message: `Équipement « ${intent.target} » introuvable.` }
        get().togglePanne('node', cible.id)
        const rapport = analyseImpact(get().diagram, get().pannes)
        if (!get().pannes.nodes.includes(cible.id)) {
          return { ok: true, message: `${cible.name} rétabli.` }
        }
        const detail =
          rapport.isoles.length > 0
            ? ` Isolés : ${rapport.isoles.slice(0, 4).map((item) => item.nom).join(', ')}${rapport.isoles.length > 4 ? '…' : ''}.`
            : ' Aucun équipement isolé.'
        return {
          ok: true,
          message: `Panne de ${cible.name} : ${rapport.compte.isole} isolé(s), ${rapport.compte.fragile} à un fil, ${rapport.disponibilite} % joignable.${detail}`,
        }
      }

      case 'groupRename': {
        get().setAppView('diagram')
        if (intent.what === 'layer') {
          // « couche Accès » : on retrouve le rang par son nom courant, personnalisé ou non.
          const courants = layerBands(get().diagram.nodes, get().layout.direction, get().diagram.layerNames)
          const voulu = plain(intent.from)
          const bande =
            courants.find((item) => plain(item.label) === voulu) ??
            courants.find((item) => plain(item.label).includes(voulu))
          if (!bande) return { ok: false, message: `Couche « ${intent.from} » introuvable.` }
          get().setLayerName(bande.rank, intent.to)
          return { ok: true, message: `Couche « ${bande.label} » renommée : ${intent.to}.` }
        }

        const champ = intent.what
        const valeurs = [...new Set(get().diagram.nodes.map((node) => node[champ]).filter(Boolean))] as string[]
        const voulu = plain(intent.from)
        const trouve =
          valeurs.find((valeur) => plain(valeur) === voulu) ??
          valeurs.find((valeur) => plain(valeur).includes(voulu))
        if (!trouve) {
          const noms = { site: 'Site', zone: 'Zone', cluster: 'Grappe' }[champ]
          return { ok: false, message: `${noms} « ${intent.from} » introuvable.` }
        }
        get().renameGroup(champ, trouve, intent.to)
        const combien = get().diagram.nodes.filter((node) => node[champ] === intent.to).length
        return { ok: true, message: `« ${trouve} » renommé en ${intent.to} (${combien} équipement(s)).` }
      }

      case 'page': {
        get().setAppView('diagram')
        const pages = get().pagesCompletes()
        const nomDe = (index: number) => pages[index]?.pageName ?? `Schéma ${index + 1}`
        const cherche = (nom: string) => {
          const voulu = nom.toLowerCase()
          return pages.findIndex((page) => (page.pageName ?? '').toLowerCase().includes(voulu))
        }

        switch (intent.action) {
          case 'add':
            get().addPage(intent.name)
            return { ok: true, message: `Page « ${get().diagram.pageName} » ajoutée.` }

          case 'duplicate':
            get().duplicatePage()
            return { ok: true, message: `Page « ${get().diagram.pageName} » créée.` }

          case 'remove': {
            const index = intent.name ? cherche(intent.name) : get().activePage
            if (index < 0) return { ok: false, message: `Page « ${intent.name} » introuvable.` }
            const nom = nomDe(index)
            get().removePage(index)
            return { ok: true, message: `Page « ${nom} » supprimée.` }
          }

          case 'rename': {
            if (!intent.name) return { ok: false, message: 'Dites : « renomme la page en Agence Lyon ».' }
            get().renamePage(get().activePage, intent.name)
            return { ok: true, message: `Page renommée : ${intent.name}.` }
          }

          case 'next':
          case 'previous': {
            const pas = intent.action === 'next' ? 1 : -1
            const cible = get().activePage + pas
            if (cible < 0 || cible >= pages.length) {
              return { ok: false, message: intent.action === 'next' ? 'Dernière page.' : 'Première page.' }
            }
            get().selectPage(cible)
            return { ok: true, message: `Page ${nomDe(cible)}.` }
          }

          default: {
            const index = intent.number !== undefined ? intent.number - 1 : cherche(intent.name ?? '')
            if (index < 0 || index >= pages.length) {
              return { ok: false, message: `Page ${intent.name ?? intent.number} introuvable.` }
            }
            get().selectPage(index)
            return { ok: true, message: `Page ${nomDe(index)}.` }
          }
        }
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
        if (intent.copies && intent.copies > 1) {
          const { equipements, liaisons } = get().duplicateSeries({
            ...get().duplicateOptions,
            copies: intent.copies,
          })
          return {
            ok: equipements > 0,
            message:
              equipements > 0
                ? `${intent.copies} copies : ${equipements} équipements et ${liaisons} liaisons ajoutés.`
                : 'Rien à dupliquer.',
          }
        }
        get().duplicateSelection()
        const copies = get().selectedNodes.length
        return { ok: true, message: copies === 1 ? 'Équipement dupliqué.' : `${copies} équipements dupliqués.` }
      }

      case 'duplicateSeries': {
        if (state.selectedNodes.length === 0) return { ok: false, message: 'Rien n’est sélectionné.' }
        get().setAppView('diagram')
        get().setDuplicateOpen(true)
        return { ok: true, message: 'Duplication en série.' }
      }

      case 'clipboard': {
        if (intent.action === 'paste') {
          void get()
            .pasteClipboard()
            .then(({ equipements, liaisons }) =>
              get().notify(
                equipements > 0
                  ? `${equipements} équipement(s) et ${liaisons} liaison(s) collés.`
                  : 'Rien à coller : copiez d’abord une sélection.',
              ),
            )
          return { ok: true, message: 'Collage en cours…' }
        }
        const { equipements } = get().copySelection(intent.action === 'cut')
        if (equipements === 0) return { ok: false, message: 'Rien n’est sélectionné.' }
        return {
          ok: true,
          message:
            intent.action === 'cut'
              ? `${equipements} équipement(s) coupés.`
              : `${equipements} équipement(s) copiés.`,
        }
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

      case 'annotate': {
        const libelles = { note: 'Note', zone: 'Cadre', arrow: 'Flèche' }
        get().addAnnotation(intent.kind, intent.text ? { text: intent.text } : undefined)
        return {
          ok: true,
          message: `${libelles[intent.kind]} posée sur le plan${intent.text ? ` : « ${intent.text} »` : ''}.`,
        }
      }

      case 'project': {
        if (intent.action === 'new') {
          get().newDiagram()
          return { ok: true, message: 'Nouveau schéma.' }
        }
        if (intent.action === 'sample') {
          get().loadSample()
          return { ok: true, message: 'Schéma d’exemple chargé.' }
        }
        downloadBlob(
          new Blob([diagramFileContent(get().classeur())], { type: 'application/json' }),
          `${slugify(get().diagram.title)}.json`,
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
      case 'vueLogique': {
        get().setAppView('diagram')
        get().setVueLogique(intent.vue)
        const label = VUES_LOGIQUES.find((item) => item.value === intent.vue)?.label
        return { ok: true, message: `Vue logique : ${label?.toLowerCase()}.` }
      }

      case 'vlanFocus': {
        if (intent.id && !(get().diagram.vlans ?? []).some((vlan) => vlan.id === intent.id)) {
          return { ok: false, message: `Aucun VLAN ${intent.id} au plan d’adressage.` }
        }
        get().setAppView('diagram')
        get().setVlanFocus(intent.id)
        return {
          ok: true,
          message: intent.id ? `Projecteur sur le VLAN ${intent.id}.` : 'Projecteur retiré.',
        }
      }

      case 'assistant': {
        get().setAssistantOpen(true)
        return { ok: true, message: 'Assistant de conception ouvert.' }
      }
      case 'view': {
        const labels: Record<AppView, string> = {
          diagram: 'Schéma',
          inventory: 'Inventaire',
          racks: 'Baies',
          flows: 'Flux',
          discovery: 'Découverte',
          dossier: 'Dossier',
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
  duplicateSelection: (decalage) => {
    if (lockedStore()) return []
    const { diagram, selectedNodes, selectedAnnotations } = get()
    if (selectedNodes.length === 0 && selectedAnnotations.length === 0) return []
    get().pushHistory()
    const dx = decalage?.dx ?? 40
    const dy = decalage?.dy ?? 40
    const taken = new Set(diagram.nodes.map((n) => n.name))
    const mapping = new Map<string, string>()
    const clones = diagram.nodes
      .filter((n) => selectedNodes.includes(n.id))
      .map((node) => {
        const id = uid('n')
        mapping.set(node.id, id)
        const name = nextName(node.name, taken)
        taken.add(name)
        /*
          Ce qui n'appartient qu'à un exemplaire physique ne se duplique pas : deux
          équipements ne partagent ni un numéro de série, ni une immobilisation, ni une place
          dans une baie. Le reste — adressage, grappe, rôle — est recopié : c'est justement ce
          qu'on veut retrouver, et les contrôles du module Dossier signalent les doublons.
        */
        return {
          ...node,
          id,
          name,
          x: node.x + dx,
          y: node.y + dy,
          pinned: false,
          serial: undefined,
          assetTag: undefined,
          rack: undefined,
          rackUnit: undefined,
        }
      })
    const clonedLinks = diagram.links
      .filter((l) => mapping.has(l.from) && mapping.has(l.to))
      .map((link) => ({ ...link, id: uid('l'), from: mapping.get(link.from)!, to: mapping.get(link.to)! }))
    // Les notes, cadres et flèches sélectionnés suivent : un bloc annoté se duplique annoté.
    const clonedAnnotations = (diagram.annotations ?? [])
      .filter((annotation) => selectedAnnotations.includes(annotation.id))
      .map((annotation) => ({ ...annotation, id: uid('a'), x: annotation.x + dx, y: annotation.y + dy }))
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: [...state.diagram.nodes, ...clones],
        links: [...state.diagram.links, ...clonedLinks],
        annotations: [...(state.diagram.annotations ?? []), ...clonedAnnotations],
      },
      selectedNodes: clones.map((n) => n.id),
      selectedLinks: [],
      selectedAnnotations: clonedAnnotations.map((annotation) => annotation.id),
    }))
    return clones.map((n) => n.id)
  },

  duplicateOpen: false,
  setDuplicateOpen: (open) => set({ duplicateOpen: open }),
  duplicateOptions: OPTIONS_PAR_DEFAUT,
  setDuplicateOptions: (patch) =>
    set((state) => ({ duplicateOptions: { ...state.duplicateOptions, ...patch } })),

  duplicateSeries: (options) => {
    if (lockedStore()) return { equipements: 0, liaisons: 0 }
    const { diagram, selectedNodes, selectedAnnotations } = get()
    const resultat = dupliquer(diagram, selectedNodes, selectedAnnotations, options)
    if (resultat.nodes.length === 0 && resultat.annotations.length === 0) {
      return { equipements: 0, liaisons: 0 }
    }
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        nodes: [...state.diagram.nodes, ...resultat.nodes],
        links: [...state.diagram.links, ...resultat.links],
        annotations: [...(state.diagram.annotations ?? []), ...resultat.annotations],
      },
      selectedNodes: resultat.nodes.map((node) => node.id),
      selectedLinks: [],
      selectedAnnotations: resultat.annotations.map((annotation) => annotation.id),
    }))
    return { equipements: resultat.nodes.length, liaisons: resultat.links.length }
  },

  presse: null,
  copySelection: (couper = false) => {
    const { diagram, selectedNodes, selectedAnnotations } = get()
    const selection = new Set(selectedNodes)
    const nodes = diagram.nodes.filter((node) => selection.has(node.id))
    const annotations = (diagram.annotations ?? []).filter((annotation) =>
      selectedAnnotations.includes(annotation.id),
    )
    if (nodes.length === 0 && annotations.length === 0) return { equipements: 0, liaisons: 0 }
    // Seules les liaisons internes voyagent : une liaison dont l'autre bout reste sur place
    // n'aurait nulle part où se rattacher une fois collée.
    const links = diagram.links.filter(
      (link) => selection.has(link.from) && selection.has(link.to),
    )
    const presse: PressePapier = {
      format: 'netschema/selection',
      version: 1,
      origine: diagram.title,
      coupe: couper,
      nodes,
      links,
      annotations,
    }
    set({ presse })
    void ecrirePressePapier(presse)
    if (couper) {
      if (lockedStore()) get().notify('Schéma verrouillé : le bloc est copié, pas retiré.')
      else get().deleteSelection()
    }
    return { equipements: nodes.length, liaisons: links.length }
  },

  pasteClipboard: async (at) => {
    if (lockedStore()) {
      get().notify('Schéma verrouillé : déverrouillez-le pour coller.')
      return { equipements: 0, liaisons: 0 }
    }
    // Le presse-papiers du système d'abord : c'est lui qui porte ce qui vient d'un autre
    // onglet ou d'un autre document. La copie interne prend le relais s'il est inaccessible.
    const presse = (await lirePressePapier()) ?? get().presse
    if (!presse || (presse.nodes.length === 0 && presse.annotations.length === 0)) {
      return { equipements: 0, liaisons: 0 }
    }
    get().pushHistory()
    const state = get()
    const cadre = encombrement(presse.nodes, presse.annotations)
    // Collé au pointeur, le bloc se centre dessus ; sans point de dépose, on le pose à côté
    // de l'original plutôt que par-dessus.
    const cible = at
      ? { x: at.x - cadre.w / 2, y: at.y - cadre.h / 2 }
      : { x: cadre.x + 40, y: cadre.y + 40 }
    const brut = { dx: cible.x - cadre.x, dy: cible.y - cadre.y }
    const dx = state.snap ? Math.round(brut.dx / GRID) * GRID : Math.round(brut.dx)
    const dy = state.snap ? Math.round(brut.dy / GRID) * GRID : Math.round(brut.dy)
    const taken = new Set(state.diagram.nodes.map((node) => node.name))
    const correspondance = new Map<string, string>()
    const nodes = presse.nodes.map((node) => {
      const id = uid('n')
      correspondance.set(node.id, id)
      const name = taken.has(node.name) ? nextName(node.name, taken) : node.name
      taken.add(name)
      // Un bloc coupé est déplacé, pas recopié : il garde son identité d'inventaire.
      const identite = presse.coupe
        ? {}
        : { serial: undefined, assetTag: undefined, rack: undefined, rackUnit: undefined }
      return { ...node, id, name, x: node.x + dx, y: node.y + dy, pinned: false, ...identite }
    })
    const links = presse.links
      .filter((link) => correspondance.has(link.from) && correspondance.has(link.to))
      .map((link) => ({
        ...link,
        id: uid('l'),
        from: correspondance.get(link.from)!,
        to: correspondance.get(link.to)!,
      }))
    const annotations = presse.annotations.map((annotation) => ({
      ...annotation,
      id: uid('a'),
      x: annotation.x + dx,
      y: annotation.y + dy,
    }))
    set((current) => ({
      diagram: {
        ...current.diagram,
        nodes: [...current.diagram.nodes, ...nodes],
        links: [...current.diagram.links, ...links],
        annotations: [...(current.diagram.annotations ?? []), ...annotations],
      },
      selectedNodes: nodes.map((node) => node.id),
      selectedLinks: [],
      selectedAnnotations: annotations.map((annotation) => annotation.id),
    }))
    return { equipements: nodes.length, liaisons: links.length }
  },

  importText: (text, mode) => {
    if (lockedStore()) return { nodes: 0, links: 0, warnings: ['Schéma verrouillé.'] }
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
    if (lockedStore()) return
    get().pushHistory()
    set((state) => ({ diagram: autoLayoutOf(state.diagram, state.layout) }))
    get().fitView()
  },

  setDisplay: (patch) => set(patch),

  /**
   * Un mode n'est pas qu'un habillage : il règle aussi ce que l'on montre. Les cases
   * d'affichage restent modifiables ensuite — le mode donne le point de départ.
   */
  setVueLogique: (vue) => {
    set({ vueLogique: vue, viewMode: 'logique' })
    const definition = modeDefinition('logique')
    set({ ...definition.display, osi: definition.osi ?? 'l3', strictOsi: definition.strictOsi ?? true })
    get().fitView()
  },

  setVlanFocus: (id) => {
    set({ vlanFocus: id })
    if (id) {
      const vlan = (get().diagram.vlans ?? []).find((item) => item.id === id)
      get().notify(
        `Projecteur sur le VLAN ${id}${vlan?.name ? ` — ${vlan.name}` : ''}. Le reste du plan est estompé.`,
      )
    }
  },

  schemaAffiche: () => {
    const { diagram, viewMode, vueLogique, layout } = get()
    return viewMode === 'logique' ? projectionLogique(diagram, vueLogique, layout) : diagram
  },

  estProjection: () => get().viewMode === 'logique',

  setViewMode: (mode) =>
    set((state) => {
      const definition = modeDefinition(mode)
      const precedent = modeDefinition(state.viewMode)
      return {
        viewMode: mode,
        ...definition.display,
        // Un mode qui suppose une couche l'impose ; en le quittant, on rend la vue OSI au
        // choix de l'utilisateur plutôt que de la laisser figée sur la couche du mode.
        osi: definition.osi ?? (precedent.osi ? 'all' : state.osi),
        strictOsi: definition.strictOsi ?? (precedent.osi ? false : state.strictOsi),
      }
    }),

  /**
   * Insertion d'un modèle haute disponibilité : les équipements arrivent au centre de la
   * vue, déjà reliés et déjà décrits (grappe, rôles, VIP), prêts à être raccordés au reste
   * du schéma puis replacés automatiquement.
   */
  insertPattern: (pattern) => {
    if (lockedStore()) return
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
    const { canvasSize } = get()
    const diagram = get().schemaAffiche()
    if (diagram.nodes.length === 0) {
      set({ view: { zoom: 1, tx: canvasSize.width / 2, ty: canvasSize.height / 2 } })
      return
    }
    const padding = 72
    const bounds = diagramBounds(diagram.nodes)
    // Les annotations, la légende et le cartouche vivent hors du nuage d'équipements :
    // les ignorer ferait cadrer sur un schéma dont il manque un bout.
    for (const annotation of diagram.annotations ?? []) {
      bounds.minX = Math.min(bounds.minX, annotation.x, annotation.x + annotation.w)
      bounds.maxX = Math.max(bounds.maxX, annotation.x, annotation.x + annotation.w)
      bounds.minY = Math.min(bounds.minY, annotation.y, annotation.y + annotation.h)
      bounds.maxY = Math.max(bounds.maxY, annotation.y, annotation.y + annotation.h)
    }
    if (get().showLegend || diagram.titleBlock?.show) bounds.maxY += 190
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
    set((state) => ({
      diagram,
      pages: state.pages.map((page, index) => (index === state.activePage ? diagram : page)),
      selectedNodes: [],
      selectedLinks: [],
      connectFrom: null,
    }))
    get().fitView()
  },

  loadClasseur: (classeur) => {
    const pages = classeur.pages.length > 0 ? classeur.pages : [emptyDiagram()]
    const index = Math.max(0, Math.min(pages.length - 1, classeur.activePage ?? 0))
    const completes = pages.map((page, position) => ({
      ...page,
      title: classeur.title,
      pageName: page.pageName ?? `Schéma ${position + 1}`,
    }))
    // Un autre document : l'historique de l'ancien n'a plus de sens.
    set({
      diagram: completes[index],
      pages: completes,
      activePage: index,
      past: [],
      future: [],
      selectedNodes: [],
      selectedLinks: [],
      connectFrom: null,
    })
    get().fitView()
  },

  pagesCompletes: () => {
    const { pages, activePage, diagram } = get()
    return pages.map((page, index) => (index === activePage ? diagram : page))
  },

  classeur: () => ({
    title: get().diagram.title,
    pages: get().pagesCompletes(),
    activePage: get().activePage,
  }),

  addPage: (name) => {
    const pages = get().pagesCompletes()
    const page: Diagram = {
      ...emptyDiagram(),
      title: get().diagram.title,
      pageName: name?.trim() || nomDePageLibre(pages),
    }
    set({ pages: [...pages, page], activePage: pages.length, diagram: page, past: [], future: [], selectedNodes: [], selectedLinks: [] })
    get().fitView()
    get().notify(`Page « ${page.pageName} » ajoutée.`)
  },

  duplicatePage: (index) => {
    const pages = get().pagesCompletes()
    const position = index ?? get().activePage
    const source = pages[position]
    if (!source) return
    // Copie complète : les identifiants restent valables, la page est indépendante.
    const copie: Diagram = {
      ...structuredClone(source),
      pageName: nomDePageLibre(pages, `${source.pageName ?? 'Schéma'} (copie)`),
    }
    const suivantes = [...pages.slice(0, position + 1), copie, ...pages.slice(position + 1)]
    set({ pages: suivantes, activePage: position + 1, diagram: copie, past: [], future: [] })
    get().notify(`Page « ${copie.pageName} » créée.`)
  },

  removePage: (index) => {
    const pages = get().pagesCompletes()
    if (pages.length <= 1) {
      get().notify('Un document garde au moins une page.')
      return
    }
    if (pages[index]?.locked) {
      get().notify('Page verrouillée : déverrouillez-la avant de la supprimer.')
      return
    }
    const nom = pages[index]?.pageName ?? 'Schéma'
    const suivantes = pages.filter((_, position) => position !== index)
    const active = Math.max(0, Math.min(suivantes.length - 1, get().activePage > index ? get().activePage - 1 : get().activePage))
    set({ pages: suivantes, activePage: active, diagram: suivantes[active], past: [], future: [], selectedNodes: [], selectedLinks: [] })
    get().notify(`Page « ${nom} » supprimée.`)
  },

  renamePage: (index, name) => {
    const propre = name.trim()
    if (!propre) return
    const pages = get().pagesCompletes()
    if (pages[index]?.locked) {
      get().notify('Page verrouillée : son nom ne peut pas changer.')
      return
    }
    const suivantes = pages.map((page, position) => (position === index ? { ...page, pageName: propre } : page))
    set({
      pages: suivantes,
      diagram: index === get().activePage ? suivantes[index] : get().diagram,
    })
  },

  selectPage: (index) => {
    const pages = get().pagesCompletes()
    if (index < 0 || index >= pages.length || index === get().activePage) return
    // L'historique suit la page : annuler ne doit jamais modifier une page qu'on ne voit pas.
    set({ pages, activePage: index, diagram: pages[index], past: [], future: [], selectedNodes: [], selectedLinks: [], connectFrom: null })
    get().fitView()
  },

  movePage: (index, direction) => {
    const pages = get().pagesCompletes()
    const cible = index + direction
    if (cible < 0 || cible >= pages.length) return
    const suivantes = [...pages]
    const [page] = suivantes.splice(index, 1)
    suivantes.splice(cible, 0, page)
    const active = get().activePage === index ? cible : get().activePage === cible ? index : get().activePage
    set({ pages: suivantes, activePage: active, diagram: suivantes[active] })
  },

  setPageLocked: (index, locked) => {
    const pages = get().pagesCompletes()
    const suivantes = pages.map((page, position) =>
      position === index ? { ...page, locked: locked || undefined } : page,
    )
    set({
      pages: suivantes,
      diagram: index === get().activePage ? suivantes[index] : get().diagram,
    })
    get().notify(locked ? 'Page verrouillée.' : 'Page déverrouillée.')
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

lockedStore = () => useDiagram.getState().diagram.locked === true

/** Sauvegarde locale automatique, pour retrouver son travail au prochain lancement. */
let saveTimer: ReturnType<typeof setTimeout> | undefined
useDiagram.subscribe((state, previous) => {
  if (state.diagram === previous.diagram) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveLocal(useDiagram.getState().classeur()), 400)
})
