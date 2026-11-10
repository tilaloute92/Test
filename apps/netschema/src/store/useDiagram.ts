import { create } from 'zustand'
import { autoLayout, diagramBounds, layerBands } from '../lib/layout'
import { deviceMeta, findDevice, findDeviceScored, LINKS, ROLES , rankOf } from '../lib/catalog'
import { bestMatch } from '../lib/speech'
import { searchModels } from '../lib/vendors'
import { STATUS_LABELS } from '../lib/inventory'
import { uid } from '../lib/ids'
import { heritageLiaison, heritageNoeud, resumerHeritage } from '../lib/heritage'
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
import { ARCHITECTURES } from '../lib/architectures'
import { cleNom, inventaireDuDocument, preparerReprise, sansTrace } from '../lib/reprise'
import { analyserDescription, nomPropose, type OperationPlan } from '../lib/assistant'
import { cheminsEntre } from '../lib/paths'
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
import { interpret, isEditingIntent, normalizeSpeech, type VoiceIntent } from '../lib/voice'
import { decouperCommandes, REPERE_PRONOM } from '../lib/voiceGrammar'
import { eclaterAjouts, phrase } from '../lib/voiceParle'
import { inventoryFromCsv } from '../lib/inventory'
import { deduceVlans } from '../lib/osi'
import { analyserVlans } from '../lib/vlanImport'
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

type Panneau = 'palette' | 'inspecteur' | 'minicarte'

function lirePanneau(nom: Panneau): boolean {
  try {
    const brut = localStorage.getItem(CLE_PANNEAUX)
    if (!brut) return true
    const etat = JSON.parse(brut) as Record<string, unknown>
    return etat[nom] !== false
  } catch {
    return true
  }
}

function ecrirePanneau(nom: Panneau, ouvert: boolean) {
  try {
    const brut = localStorage.getItem(CLE_PANNEAUX)
    const etat = brut ? (JSON.parse(brut) as Record<string, unknown>) : {}
    localStorage.setItem(CLE_PANNEAUX, JSON.stringify({ ...etat, [nom]: ouvert }))
  } catch {
    // Stockage indisponible : le réglage vaut pour la session, sans plus.
  }
}

/**
 * Durée du clignotement, en secondes.
 *
 * Elle dépend de la façon de travailler : qui bascule vers le schéma puis va chercher un
 * câble en salle a besoin que le repère tienne le temps du déplacement ; qui vérifie d'un
 * coup d'œil n'en veut pas davantage. C'est donc un réglage, et il appartient au poste comme
 * les bandeaux — il n'a rien à faire dans le document, qu'on partage.
 */
const CLE_CLIGNOTEMENT = 'netschema:clignotement'
export const CLIGNOTEMENT_MIN = 30
export const CLIGNOTEMENT_MAX = 60

function borner(secondes: number): number {
  if (!Number.isFinite(secondes)) return CLIGNOTEMENT_MIN
  return Math.min(CLIGNOTEMENT_MAX, Math.max(CLIGNOTEMENT_MIN, Math.round(secondes)))
}

function lireDureeClignotement(): number {
  try {
    const brut = localStorage.getItem(CLE_CLIGNOTEMENT)
    return brut ? borner(Number(brut)) : CLIGNOTEMENT_MIN
  } catch {
    return CLIGNOTEMENT_MIN
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

/**
 * Mémoire de la conversation vocale.
 *
 * Elle n'est pas dans le magasin : rien de tout cela ne se dessine, et rien ne doit
 * provoquer un rendu. C'est ce qui permet de dire « relie-le au cœur » sans répéter le nom
 * qu'on vient de donner — exactement comme on parle à quelqu'un.
 */
const voix = {
  /** Équipements dont on vient de parler : ce que désignent « le », « les », « celui-ci ». */
  noeuds: [] as string[],
  /** Liaisons dont on vient de parler : « cette liaison », « passe-la en fibre ». */
  liens: [] as string[],
  /** Équipements et liaisons désignés pendant la commande en cours. */
  touches: [] as string[],
  liensTouches: [] as string[],
  /** Raison précise du dernier échec de désignation, pour remplacer un « introuvable » muet. */
  erreur: null as string | null,
  /** Action suspendue à un « oui ». */
  attente: null as null | { executer: () => { ok: boolean; message: string } },
  /** Dictée en cours : tout ce qui est dit devient du texte, jusqu'à « fin de dictée ». */
  dictee: null as null | { noeud: string | null; nom: string; texte: string[] },
}

/** Oublie la conversation : un autre document, c'est une autre conversation. */
function oublierVoix() {
  voix.noeuds = []
  voix.liens = []
  voix.touches = []
  voix.liensTouches = []
  voix.erreur = null
  voix.attente = null
  voix.dictee = null
}
export const GRID = 20

/**
 * Largeur du plan que le panneau vocal recouvre, à gauche, tant qu'il est ouvert.
 *
 * Celui qui dicte regarde le plan et le panneau en même temps : un équipement posé derrière
 * le panneau est, pour lui, un équipement qui n'est pas apparu. Le cadrage et le suivi des
 * ajouts tiennent donc cette bande pour invisible.
 *
 * Le panneau s'ouvre sur la palette — on ne glisse pas d'équipements pendant qu'on dicte —
 * et ne déborde sur le plan que de ce qui dépasse d'elle : peu quand elle est ouverte, toute
 * sa largeur quand elle est repliée (le plan a alors gagné la place de la palette). Sur un
 * plan trop étroit pour céder cette bande, on ne réserve rien.
 */
const DEBORD_PANNEAU_VOCAL = { paletteOuverte: 190, paletteRepliee: 420 }
function bandeMasquee(etat: { voiceOpen: boolean; paletteOpen: boolean; canvasSize: { width: number } }): number {
  if (!etat.voiceOpen) return 0
  const bande = etat.paletteOpen ? DEBORD_PANNEAU_VOCAL.paletteOuverte : DEBORD_PANNEAU_VOCAL.paletteRepliee
  return etat.canvasSize.width - bande >= 600 ? bande : 0
}

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
  /** Cadres par famille d'équipements : une lecture par métier, à part des sites et des zones. */
  showFamilies: boolean
  showLayerLabels: boolean
  /*
    Trois natures d'information, trois cases.

    Elles n'encombrent pas un plan pour les mêmes raisons et ne se masquent donc pas ensemble :
    on veut couramment le plan d'adressage sans les listes de VLAN, ou les débits seuls pour
    parler dimensionnement. Une case unique obligeait à choisir entre un plan illisible et un
    plan muet.
  */
  /** Adresses IP des équipements et des interfaces, sous-réseaux. */
  showIp: boolean
  /** Listes de VLAN, VLAN natif et mode de port. */
  showVlans: boolean
  /** Débits annoncés, sur les liaisons comme sur les agrégats. */
  showSpeeds: boolean
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
  /**
   * Marque en couleur les câbles qui portent des VLAN d'interconnexion (HA, transit).
   *
   * Sur un plan de câblage, tout VLAN se ressemble. Repérer d'un coup d'œil ce qui ne porte
   * que du battement de cœur — et ce qui en porte alors qu'il ne devrait pas — est justement
   * ce qu'un schéma ne montre jamais.
   */
  showInterco: boolean
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
   * Liaisons que l'application montre du doigt, le temps de quelques clignotements.
   *
   * C'est un repère, pas un état du document : il s'efface tout seul. Sans cela, la
   * désignation resterait posée sur le schéma et deviendrait du bruit dès la manipulation
   * suivante.
   */
  projecteurLiens: string[]
  montrerLiens: (ids: string[], duree?: number) => void
  /** Durée du clignotement, en secondes, entre 30 et 60. */
  dureeClignotement: number
  setDureeClignotement: (secondes: number) => void
  /**
   * Suivre les VLAN le long des trunks. Un VLAN déclaré sur le cœur de réseau atteint tout
   * ce que les trunks desservent : c'est la réalité du domaine de diffusion, et c'est ce
   * qu'on veut voir en vue logique. Débrayable pour ne montrer que ce qui est écrit.
   */
  vlanPropagation: boolean
  setVlanPropagation: (actif: boolean) => void
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
  /** Minicarte du plan, en bas à gauche : une vue d'ensemble quand le schéma dépasse l'écran. */
  minimapOpen: boolean
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
  /**
   * Placement d'un agrégat, posé à la main. Il s'écrit sur tous les brins du faisceau : un
   * agrégat n'a qu'un ovale, et il doit se retrouver au même endroit quel que soit le brin
   * par lequel on le lit. `null` remet le réglage au calcul automatique.
   */
  setLagPlacement: (
    ids: string[],
    patch: { shift?: number | null; offset?: LabelOffset | null },
  ) => void
  /** Masque ou réaffiche l'ovale d'un agrégat, sans toucher aux autres. */
  setLagHidden: (ids: string[], hidden: boolean) => void
  /** Renomme un agrégat : le nom s'écrit sur tous ses brins, des deux côtés. */
  renameLag: (ids: string[], nom: string) => void
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
  /** Teinte d'une grappe ; `undefined` la rend au rose par défaut. */
  setClusterColor: (cluster: string, couleur: string | undefined) => void
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
  /**
   * Import d'un plan d'adressage collé : tableau, collage de tableur ou sortie de
   * commutateur. En mode « compléter », ce qui est déjà renseigné n'est jamais écrasé par
   * une cellule vide — on complète un plan existant sans lui faire perdre ce qu'il savait.
   */
  importerVlans: (
    texte: string,
    mode: 'merge' | 'replace',
  ) => { ajoutes: number; completes: number; format: string; avertissements: string[] }

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
  setPanelOpen: (panneau: Panneau, ouvert: boolean) => void
  setCommandOpen: (open: boolean) => void
  setImportOpen: (open: boolean) => void
  /** Dialogue « reprendre de l'inventaire ». */
  repriseOuverte: boolean
  /** Équipements cochés d'avance à l'ouverture : ceux qu'on avait sélectionnés dans l'inventaire. */
  repriseChoix: string[]
  ouvrirReprise: (choix?: string[]) => void
  fermerReprise: () => void
  /**
   * Reprend sur une page des équipements déjà enregistrés ailleurs : leurs fiches, les
   * liaisons tracées entre eux, leurs baies, les VLAN qu'ils citent. Sur la page ouverte, ou
   * sur une page neuve si `nouvellePage` est donné (une chaîne vide laisse l'application la
   * nommer). Un équipement déjà sur la page n'est pas repris une seconde fois.
   */
  reprendreEquipements: (
    sources: Diagram[],
    noms: string[],
    options?: { liaisons?: boolean; nouvellePage?: string; disposition?: 'origine' | 'auto' },
  ) => { equipements: number; liaisons: number; dejaLa: string[]; introuvables: string[] }
  setVoiceOpen: (open: boolean) => void
  runVoiceCommand: (transcript: string) => { ok: boolean; message: string }
  /** Exécute une intention déjà comprise. `runVoiceCommand` orchestre, celle-ci agit. */
  executerIntention: (intent: VoiceIntent) => { ok: boolean; message: string }
  /** Dictée en cours : l'équipement qui reçoit le texte, ou « plan » pour une note libre. */
  dicteeVocale: string | null
  /** Une suppression attend un « oui » : le panneau propose alors les deux réponses. */
  attenteVocale: boolean
  /** Compteur de demandes d'écoute : le raccourci clavier l'incrémente, le panneau y répond. */
  demandeEcoute: number
  /** Ouvre le panneau vocal et bascule le micro — le geste du raccourci clavier. */
  basculerEcoute: () => void
  /** Pose une architecture de départ, comme si on en avait tapé la description dans l'assistant. */
  poserArchitecture: (id: string) => { noeuds: number; liaisons: number }
  /** Le travail de `runVoiceCommand`, sans la mise à jour de ce que montre le panneau. */
  traiterPhraseVocale: (transcript: string) => { ok: boolean; message: string }
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
  importText: (
    text: string,
    mode: 'merge' | 'replace',
  ) => { nodes: number; links: number; vlans: number; warnings: string[] }
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
        | 'showFamilies'
        | 'showLayerLabels'
        | 'showIp'
        | 'showVlans'
        | 'showSpeeds'
        | 'showAudit'
        | 'showHops'
        | 'spreadLinks'
        | 'showLegend'
        | 'showLags'
        | 'showInterco'
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

/** Minuterie du projecteur de liaisons ; hors du magasin, car ce n'est pas un état. */
let minuterieProjecteur: ReturnType<typeof setTimeout> | undefined

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
  showFamilies: false,
  showLayerLabels: true,
  showIp: true,
  showVlans: true,
  showSpeeds: true,
  showAudit: true,
  showHops: true,
  spreadLinks: true,
  showLegend: false,
  showLags: true,
  showInterco: true,
  vueLogique: 'routage' as VueLogique,
  vlanFocus: null as string | null,
  projecteurLiens: [] as string[],
  dureeClignotement: lireDureeClignotement(),
  vlanPropagation: true,
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
  minimapOpen: lirePanneau('minicarte'),
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
    // Ce que le document dit déjà passe avant les valeurs vides, mais jamais avant un seed :
    // un import ou une duplication sait mieux que l'héritage ce qu'il veut poser.
    const herite = heritageNoeud(get().diagram, kind)
    const node: NetNode = {
      id,
      kind,
      name: `${deviceMeta(kind).label} ${count}`,
      x: Math.round(x),
      y: Math.round(y),
      ...herite,
      ...seed,
    }
    const repris = seed ? null : resumerHeritage(herite)
    set((state) => ({
      diagram: { ...state.diagram, nodes: [...state.diagram.nodes, node] },
      selectedNodes: [id],
      selectedLinks: [],
      toast: repris,
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
    const nature = fromNode && toNode ? suggestLinkKind(fromNode, toNode) : 'ethernet'
    // Les liaisons de même nature se ressemblent : débit, mode, VLAN et MTU se répètent d'un
    // câble à l'autre bien plus souvent qu'ils ne diffèrent.
    const heriteL = heritageLiaison(get().diagram, nature)
    const link: NetLink = {
      id: uid('l'),
      from,
      to,
      kind: nature,
      ...heriteL,
      ...seed,
    }
    set((state) => ({
      diagram: { ...state.diagram, links: [...state.diagram.links, link] },
      selectedLinks: [link.id],
      selectedNodes: [],
      toast: exists
        ? 'Liaison supplémentaire ajoutée entre ces deux équipements.'
        : (seed ? null : resumerHeritage(heriteL)),
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

  setClusterColor: (cluster, couleur) => {
    if (lockedStore()) return
    const nom = cluster.trim()
    if (!nom) return
    get().pushHistory()
    set((state) => {
      const couleurs = { ...(state.diagram.clusterColors ?? {}) }
      if (couleur) couleurs[nom] = couleur
      else delete couleurs[nom]
      // Une table vide ne part pas dans le fichier : un document sans couleur choisie reste
      // identique à ce qu'il était avant que ce réglage existe.
      const reste = Object.keys(couleurs).length > 0 ? couleurs : undefined
      return { diagram: { ...state.diagram, clusterColors: reste } }
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
    // La couleur est rangée sous le nom de la grappe : la renommer doit l'emmener avec elle,
    // sinon le choix de l'auteur disparaît au premier renommage.
    if (type === 'cluster') {
      set((state) => {
        const couleurs = state.diagram.clusterColors
        if (!couleurs?.[from]) return {}
        const suivant = { ...couleurs, [propre]: couleurs[from] }
        delete suivant[from]
        return { diagram: { ...state.diagram, clusterColors: suivant } }
      })
    }

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

  setLagPlacement: (ids, patch) => {
    if (lockedStore()) return
    const cibles = new Set(ids)
    set((state) => ({
      diagram: {
        ...state.diagram,
        links: state.diagram.links.map((link) => {
          if (!cibles.has(link.id)) return link
          const suite = { ...link }
          if (patch.shift !== undefined) suite.lagShift = patch.shift ?? undefined
          if (patch.offset !== undefined) suite.lagOffset = patch.offset ?? undefined
          return suite
        }),
      },
    }))
  },

  setLagHidden: (ids, hidden) => {
    if (lockedStore()) return
    const cibles = new Set(ids)
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        links: state.diagram.links.map((link) =>
          cibles.has(link.id) ? { ...link, lagHidden: hidden ? true : undefined } : link,
        ),
      },
    }))
  },

  renameLag: (ids, nom) => {
    if (lockedStore()) return
    const propre = nom.trim()
    const cibles = new Set(ids)
    get().pushHistory()
    set((state) => ({
      diagram: {
        ...state.diagram,
        links: state.diagram.links.map((link) =>
          cibles.has(link.id)
            ? { ...link, lag: propre || undefined, lagA: undefined, lagB: undefined }
            : link,
        ),
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

  importerVlans: (texte, mode) => {
    const lecture = analyserVlans(texte)
    if (lecture.vlans.length === 0) {
      return { ajoutes: 0, completes: 0, format: lecture.format, avertissements: lecture.avertissements }
    }
    if (lockedStore()) {
      return {
        ajoutes: 0,
        completes: 0,
        format: lecture.format,
        avertissements: ['Schéma verrouillé : déverrouillez-le pour importer.'],
      }
    }
    get().pushHistory()
    const existants = new Map((get().diagram.vlans ?? []).map((vlan) => [vlan.id, vlan]))
    let ajoutes = 0
    let completes = 0
    const resultat = mode === 'replace' ? new Map<string, VlanDef>() : existants
    for (const arrivant of lecture.vlans) {
      const present = resultat.get(arrivant.id)
      if (!present) {
        resultat.set(arrivant.id, arrivant)
        ajoutes += 1
        continue
      }
      // Une cellule vide ne dit rien : elle ne doit pas effacer ce qui était renseigné.
      const fusion: VlanDef = {
        ...present,
        name: arrivant.name ?? present.name,
        subnet: arrivant.subnet ?? present.subnet,
        gateway: arrivant.gateway ?? present.gateway,
        notes: arrivant.notes ?? present.notes,
        color: arrivant.color ?? present.color,
        usage: arrivant.usage ?? present.usage,
      }
      if (JSON.stringify(fusion) !== JSON.stringify(present)) completes += 1
      resultat.set(arrivant.id, fusion)
    }
    const vlans = [...resultat.values()].sort(
      (a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id),
    )
    set((state) => ({ diagram: { ...state.diagram, vlans } }))
    return { ajoutes, completes, format: lecture.format, avertissements: lecture.avertissements }
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

    const partiDeRien = etat.diagram.nodes.length === 0
    const placeur = placeurParCouches(
      etat.diagram.nodes,
      etat.layout.direction,
      operations.flatMap((operation) =>
        operation.type === 'noeud' && !parNom.has(operation.nom.trim().toLowerCase())
          ? [rankOf(operation.kind, operation.patch?.rank ?? null)]
          : [],
      ),
    )

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
      const position = placeur(rankOf(kind, patch?.rank ?? null))
      const id = uid('n')
      nodes.push({ id, kind, name: nom, x: position.x, y: position.y, ...nettoyer(patch ?? {}) })
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

    set((state) => {
      const diagram = { ...state.diagram, nodes, links }
      return {
        // Parti d'un plan vide, il n'y a rien à respecter : on range, tout simplement.
        diagram: partiDeRien && noeuds > 0 ? autoLayoutOf(diagram, state.layout) : diagram,
        selectedNodes: [],
        selectedLinks: [],
      }
    })
    if (partiDeRien && noeuds > 0) get().fitView()
    return { noeuds, liaisons }
  },

  setPanelOpen: (panneau, ouvert) => {
    ecrirePanneau(panneau, ouvert)
    if (panneau === 'palette') set({ paletteOpen: ouvert })
    else if (panneau === 'inspecteur') set({ inspectorOpen: ouvert })
    else set({ minimapOpen: ouvert })
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

  repriseOuverte: false,
  repriseChoix: [],
  ouvrirReprise: (choix = []) => set({ repriseOuverte: true, repriseChoix: choix }),
  fermerReprise: () => set({ repriseOuverte: false, repriseChoix: [] }),

  reprendreEquipements: (sources, noms, options = {}) => {
    const rien = { equipements: 0, liaisons: 0, dejaLa: [] as string[], introuvables: [] as string[] }
    // On prépare d'abord, sur la page telle qu'elle sera : une page neuve ne se crée que
    // s'il y a quelque chose à y mettre.
    const surPageNeuve = options.nouvellePage !== undefined
    if (!surPageNeuve && lockedStore()) return rien
    const cible = surPageNeuve ? emptyDiagram() : get().diagram
    const reprise = preparerReprise(sources, noms, cible, { liaisons: options.liaisons !== false })
    const bilan = { equipements: reprise.nodes.length, liaisons: reprise.links.length, dejaLa: reprise.dejaLa, introuvables: reprise.introuvables }
    if (reprise.nodes.length === 0) return bilan

    if (surPageNeuve) get().addPage(options.nouvellePage || undefined)
    else get().pushHistory()

    const page = get().diagram
    const partiDeRien = page.nodes.length === 0
    /*
      La disposition d'origine n'a de sens que sur une page vide, quand une même page portait
      tous les équipements. Dans une page déjà dessinée, chacun rejoint la rangée de ses
      pairs ; et sur une page vide sans disposition à reprendre, le placement automatique
      range l'ensemble.
    */
    const commeALOrigine = partiDeRien && reprise.dispositionOrigine && options.disposition !== 'auto'
    let nodes = reprise.nodes
    let links = reprise.links
    if (!commeALOrigine) {
      const placer = placeurParCouches(page.nodes, get().layout.direction, nodes.map((node) => rankOf(node.kind, node.rank ?? null)))
      nodes = nodes.map((node) => ({ ...node, ...placer(rankOf(node.kind, node.rank ?? null)) }))
      links = links.map(sansTrace)
    }
    set((state) => {
      const diagram: Diagram = {
        ...state.diagram,
        nodes: [...state.diagram.nodes, ...nodes],
        links: [...state.diagram.links, ...links],
        racks: reprise.racks.length > 0 ? [...(state.diagram.racks ?? []), ...reprise.racks] : state.diagram.racks,
        vlans: reprise.vlans.length > 0 ? [...(state.diagram.vlans ?? []), ...reprise.vlans] : state.diagram.vlans,
        clusterColors:
          Object.keys(reprise.clusterColors).length > 0
            ? { ...(state.diagram.clusterColors ?? {}), ...reprise.clusterColors }
            : state.diagram.clusterColors,
      }
      return {
        diagram: partiDeRien && !commeALOrigine ? autoLayoutOf(diagram, state.layout) : diagram,
        selectedNodes: nodes.map((node) => node.id),
        selectedLinks: [],
        appView: 'diagram' as const,
      }
    })
    get().fitView()
    return bilan
  },
  setVoiceOpen: (voiceOpen) => set({ voiceOpen }),

  /**
   * Exécute une commande dictée (ou tapée dans le panneau vocal). L'interprétation vit
   * dans `lib/voice.ts` ; ici on ne fait qu'appliquer l'intention et rendre compte.
   */
  dicteeVocale: null,
  attenteVocale: false,
  demandeEcoute: 0,
  basculerEcoute: () => set((state) => ({ voiceOpen: true, demandeEcoute: state.demandeEcoute + 1 })),

  poserArchitecture: (id) => {
    const architecture = ARCHITECTURES.find((item) => item.id === id)
    if (!architecture || lockedStore()) return { noeuds: 0, liaisons: 0 }
    const plan = analyserDescription(architecture.description, get().diagram)
    const fait = get().appliquerPlan(plan.etapes.flatMap((etape) => etape.operations))
    get().setAppView('diagram')
    get().notify(
      `${architecture.titre} : ${fait.noeuds} équipement(s) et ${fait.liaisons} liaison(s) posés. Complétez à la voix, à l’assistant ou depuis la palette.`,
    )
    return fait
  },

  runVoiceCommand: (transcript) => {
    const resultat = get().traiterPhraseVocale(transcript)
    // Le panneau montre ce que la conversation attend : il doit le savoir à chaque phrase.
    const attente = voix.attente !== null
    if (get().attenteVocale !== attente) set({ attenteVocale: attente })
    return resultat
  },

  /**
   * Une phrase dictée, de bout en bout.
   *
   * Quatre choses se décident ici, avant toute interprétation : la phrase est-elle la suite
   * d'une dictée, la réponse à une question posée, plusieurs commandes d'un souffle, ou une
   * commande seule. L'exécution proprement dite est dans `executerIntention`.
   */
  traiterPhraseVocale: (transcript) => {
    const brute = transcript.trim()
    if (!brute) return { ok: false, message: 'Rien entendu.' }
    const simple = normalizeSpeech(brute)

    // ── Dictée en cours : tout est du texte, sauf l'ordre d'y mettre fin ──────────────────
    if (voix.dictee) {
      const dictee = voix.dictee
      const fin =
        /^(?:fin|arrete|arreter|stop|termine|terminer|ferme|fermer|quitte|quitter)(?:\s+de)?(?:\s+la)?\s+(?:dict\w*|note)$|^(?:dict\w*|note)\s+termine\w*$|^(?:termine|fin|stop)$/.test(
          simple,
        )
      if (fin) {
        voix.dictee = null
        set({ dicteeVocale: null })
        if (dictee.noeud === null) {
          if (dictee.texte.length === 0) return { ok: true, message: 'Dictée fermée, rien n’a été noté.' }
          get().addAnnotation('note', { text: dictee.texte.join(' ') })
          return { ok: true, message: `Dictée fermée : note de ${dictee.texte.length} phrase(s) posée sur le plan.` }
        }
        return {
          ok: true,
          message:
            dictee.texte.length === 0
              ? 'Dictée fermée, rien n’a été noté.'
              : `Dictée fermée : ${dictee.texte.length} phrase(s) notée(s) sur ${dictee.nom}.`,
        }
      }
      const texte = phrase(brute)
      dictee.texte.push(texte)
      if (dictee.noeud !== null) {
        // Écrit au fil de l'eau : une dictée qu'on oublie de fermer ne perd rien.
        const cible = get().diagram.nodes.find((node) => node.id === dictee.noeud)
        if (!cible) {
          voix.dictee = null
          set({ dicteeVocale: null })
          return { ok: false, message: 'L’équipement de la dictée n’existe plus : dictée fermée.' }
        }
        get().updateNode(cible.id, { notes: cible.notes ? `${cible.notes}\n${texte}` : texte })
      }
      return { ok: true, message: `Noté : « ${texte} »` }
    }

    // ── Réponse à une confirmation demandée ───────────────────────────────────────────────
    if (voix.attente) {
      const attente = voix.attente
      voix.attente = null
      if (/^(?:oui|ouais|yes|ok|okay|d'accord|confirme|je confirme|vas y|vas-y|c'est ca|exact|affirmatif|absolument|bien sur|fais le)(?:\s|$)/.test(simple)) {
        return attente.executer()
      }
      if (/^(?:non|no|annule|abandonne|laisse|stop|surtout pas|ne fais rien)(?:\s|$)/.test(simple)) {
        return { ok: true, message: 'Abandonné : rien n’a été supprimé.' }
      }
      // Toute autre phrase vaut abandon : un « oui » dit plus tard ne doit plus rien supprimer.
    }

    // ── Une ou plusieurs commandes ────────────────────────────────────────────────────────
    const commandes = decouperCommandes(brute).flatMap(eclaterAjouts)
    if (commandes.length === 0) return { ok: false, message: `Commande non comprise : « ${brute} »` }

    const executerUne = (commande: string): { ok: boolean; message: string } => {
      const intent = interpret(commande)
      if (!intent) return { ok: false, message: `Commande non comprise : « ${commande} »` }
      // Lire, naviguer, interroger et exporter restent permis sur un schéma verrouillé ; le
      // modifier est refusé avec l'explication, plutôt que de ne rien faire en silence.
      if (lockedStore() && isEditingIntent(intent)) {
        return { ok: false, message: 'Schéma verrouillé : dites « déverrouille le schéma » pour le modifier.' }
      }
      voix.touches = []
      voix.liensTouches = []
      voix.erreur = null
      const resultat = get().executerIntention(intent)
      if (!resultat.ok) {
        // « introuvable » ne dit rien quand la vraie raison est connue : un type ambigu, un
        // pronom sans contexte. On rend la raison précise.
        if (voix.erreur && /introuvable/.test(resultat.message)) return { ok: false, message: voix.erreur }
        return resultat
      }
      memoriserContexte(intent)
      return resultat
    }

    /**
     * Une phrase, un cran d'annulation. Relier quatre switchs à deux cœurs pose huit
     * liaisons, et « ajoute un serveur, relie-le, mets-le en zone DMZ » fait trois choses :
     * « annule » doit défaire ce qu'on vient de dire, pas le dernier geste de l'application.
     */
    const enUneFois = <T,>(action: () => T): T => {
      const avant = get().past
      const repere = avant[avant.length - 1]
      const resultat = action()
      const apres = get().past
      const index = repere ? apres.lastIndexOf(repere) : -1
      const garder = index + 2
      if ((repere ? index >= 0 : true) && apres.length > garder) set({ past: apres.slice(0, garder) })
      return resultat
    }

    /** Ce dont on vient de parler devient ce que « le », « les », « cette liaison » désignent. */
    const memoriserContexte = (intent: VoiceIntent) => {
      if (intent.type === 'delete' || intent.type === 'linkDelete') {
        voix.liens = []
        if (intent.type === 'delete') voix.noeuds = []
        return
      }
      if (voix.liensTouches.length > 0) voix.liens = [...voix.liensTouches]
      if (voix.touches.length > 0) voix.noeuds = [...voix.touches]
    }

    const derouler = (): { ok: boolean; message: string } => {
      const messages: string[] = []
      for (const commande of commandes) {
        const resultat = executerUne(commande)
        if (!resultat.ok) {
          if (commandes.length === 1) return resultat
          // On s'arrête à la première qui échoue : celles qui suivent en dépendent presque
          // toujours, et les exécuter quand même ferait autre chose que ce qui était voulu.
          const fait = messages.length > 0 ? `${messages.join(' ')} ` : ''
          return { ok: false, message: `${fait}Arrêt à « ${commande} » : ${resultat.message}` }
        }
        messages.push(resultat.message)
        // Une question posée ou une dictée ouverte suspend la suite.
        if (voix.attente || voix.dictee) break
      }
      return { ok: true, message: messages.join(' ') }
    }
    // « Annule » et « rétablis » parcourent l'historique : ils n'y ajoutent pas un cran.
    const seule = commandes.length === 1 ? interpret(commandes[0]) : null
    return seule?.type === 'undo' || seule?.type === 'redo' ? derouler() : enUneFois(derouler)
  },

  executerIntention: (intent) => {
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
    /** Retrouve un équipement par son nom, tel que la dictée le rend. */
    const trouverParNom = (name: string, parmi?: NetNode[]): NetNode | undefined => {
      const needle = plain(name)
      if (!needle) return undefined
      const squeezed = needle.replace(/[\s-]/g, '')
      const nodes = parmi ?? get().diagram.nodes
      return (
        nodes.find((node) => plain(node.name) === needle) ??
        nodes.find((node) => plain(node.name).replace(/[\s-]/g, '') === squeezed) ??
        nodes.find((node) => plain(node.name).startsWith(needle)) ??
        (squeezed.length >= 3
          ? nodes.find((node) => plain(node.name).replace(/[\s-]/g, '').includes(squeezed))
          : undefined) ??
        bestMatch(name, nodes, (node) => node.name)?.item
      )
    }

    /**
     * Ce qu'une désignation dictée désigne vraiment.
     *
     * On ne nomme pas toujours : on dit « le », « les deux cœurs », « tous les switchs
     * d'accès », « SW-01 et SW-02 », « le routeur ». Chaque forme a sa règle, dans cet ordre :
     * le pronom d'abord, puis le nom exact — « Opérateur A et B » peut être un nom —, puis la
     * liste, puis le type. Quand le type désigne plusieurs équipements et que la phrase n'en
     * voulait qu'un, on ne choisit pas : on nomme les candidats.
     */
    const designer = (cible: string, parmi?: NetNode[]): { noeuds: NetNode[]; erreur?: string } => {
      // `parmi` : désigner ailleurs que sur la page — dans l'inventaire du document. Les
      // pronoms et la sélection n'y ont pas cours : ils parlent de ce qui est sur la page.
      const nodes = parmi ?? get().diagram.nodes
      const needle = plain(cible)
      if (!needle) return { noeuds: [], erreur: 'Aucun équipement désigné.' }

      if (!parmi && (needle === REPERE_PRONOM || /^(?:lui|eux|elles|celui ci|ceux ci)$/.test(needle))) {
        const contexte = nodes.filter((node) => voix.noeuds.includes(node.id))
        if (contexte.length > 0) return { noeuds: contexte }
        const selection = nodes.filter((node) => get().selectedNodes.includes(node.id))
        if (selection.length > 0) return { noeuds: selection }
        return {
          noeuds: [],
          erreur: 'Je ne sais pas de quel équipement vous parlez : nommez-le, ou faites d’abord une sélection.',
        }
      }
      if (!parmi && /^(?:la selection|selection|ca|cela|celles ci)$/.test(needle)) {
        const selection = nodes.filter((node) => get().selectedNodes.includes(node.id))
        return selection.length > 0 ? { noeuds: selection } : { noeuds: [], erreur: 'Rien n’est sélectionné.' }
      }

      const sansArticle = cible.trim().replace(/^(?:le|la|les|l'|l’|au|aux|du|des|de la|un|une)\s+/i, '')
      const direct = trouverParNom(cible, parmi) ?? trouverParNom(sansArticle, parmi)
      if (direct) return { noeuds: [direct] }

      // « A et B », « A, B et C ».
      const morceaux = cible
        .split(/\s*,\s*|\s+et\s+/i)
        .map((morceau) => morceau.trim())
        .filter(Boolean)
      if (morceaux.length > 1) {
        const tous: NetNode[] = []
        for (const morceau of morceaux) {
          const partie = designer(morceau, parmi)
          if (partie.erreur) return { noeuds: [], erreur: partie.erreur }
          for (const node of partie.noeuds) if (!tous.includes(node)) tous.push(node)
        }
        return { noeuds: tous }
      }

      // Par type : « tous les switchs d'accès », « les deux cœurs », « le routeur ».
      const parType = needle.match(
        /^(tous les |toutes les |tous |toutes )?(les |des |aux |ces |mes )?(\d+ |deux |trois |quatre |cinq |six )?(?:le |la |l'|au |du |un |une )?(.+)$/,
      )
      const typeDemande = parType?.[4]?.trim()
      const trouve = typeDemande ? findDeviceScored(typeDemande) : undefined
      if (trouve && trouve.score >= 0.8) {
        const candidats = nodes.filter((node) => node.kind === trouve.device.id)
        const libelle = trouve.device.label.toLowerCase()
        if (candidats.length === 0) {
          return { noeuds: [], erreur: parmi ? `Aucun ${libelle} à reprendre dans l’inventaire.` : `Aucun ${libelle} dans le schéma.` }
        }
        const pluriel = Boolean(parType?.[1] || parType?.[2] || parType?.[3])
        if (pluriel || candidats.length === 1) return { noeuds: candidats }
        return {
          noeuds: [],
          erreur: `Plusieurs équipements « ${trouve.device.label} » : ${candidats
            .slice(0, 6)
            .map((node) => node.name)
            .join(', ')}. Dites lequel, ou « les ${libelle} » pour tous.`,
        }
      }
      return { noeuds: [], erreur: `Équipement « ${cible} » introuvable.` }
    }

    /**
     * Garde à l'écran ce qui vient d'être posé. Celui qui dicte ne fait pas défiler : un
     * équipement ajouté hors du cadre est, pour lui, un équipement qui n'a pas été ajouté.
     * On ne recadre que si c'est nécessaire — changer de zoom à chaque commande fatigue.
     */
    const montrer = (noeuds: NetNode[]) => {
      const { view, canvasSize } = get()
      if (canvasSize.width <= 0 || canvasSize.height <= 0) return
      const masque = bandeMasquee(get())
      const visible = (node: NetNode) => {
        const x = node.x * view.zoom + view.tx
        const y = node.y * view.zoom + view.ty
        return x >= masque && y >= 0 && x + NODE_W * view.zoom <= canvasSize.width && y + NODE_H * view.zoom <= canvasSize.height
      }
      const courants = noeuds.flatMap((node) => get().diagram.nodes.find((item) => item.id === node.id) ?? [])
      if (courants.some((node) => !visible(node))) get().fitView()
    }

    /** Note ce qui vient d'être désigné : c'est ce dont on reparlera avec « le » ou « les ». */
    const retenir = (noeuds: NetNode[]) => {
      for (const node of noeuds) if (!voix.touches.includes(node.id)) voix.touches.push(node.id)
    }

    /** Cible d'une commande, quelle que soit la façon dont elle est dite. */
    const resolveTargets = (target: string): NetNode[] => {
      const resultat = designer(target)
      if (resultat.erreur) voix.erreur = resultat.erreur
      retenir(resultat.noeuds)
      return resultat.noeuds
    }

    /** Message d'échec parlant : la raison précise, plutôt qu'un « introuvable » uniforme. */
    const missMessage = (target: string): string =>
      designer(target).erreur ?? `Équipement « ${target} » introuvable.`

    /**
     * Un équipement, et un seul. La dictée rend rarement « SW-CORE-01 » à la lettre : on
     * accepte « sw core 01 », « swcore1 », le nom le plus proche — et aussi « le », « le
     * routeur » quand il n'y en a qu'un.
     */
    const findNode = (name: string): NetNode | undefined => {
      const resultat = designer(name)
      if (resultat.noeuds.length === 1) {
        retenir(resultat.noeuds)
        return resultat.noeuds[0]
      }
      voix.erreur =
        resultat.erreur ??
        `Cette commande ne prend qu’un équipement, et « ${name} » en désigne ${resultat.noeuds.length}.`
      return undefined
    }

    /** Liaisons entre deux équipements, dans un sens ou dans l'autre. */
    const liaisonsEntre = (a: string, b: string): NetLink[] =>
      get().diagram.links.filter(
        (item) => (item.from === a && item.to === b) || (item.from === b && item.to === a),
      )

    /** Ce qu'une modification de liaison a changé, dit en clair pour la réponse parlée. */
    const direPatch = (patch: Partial<NetLink>, port?: string): string => {
      const morceaux = [
        patch.kind ? LINKS[patch.kind]?.label?.toLowerCase() : null,
        patch.speed ?? null,
        patch.mode === 'trunk' ? 'trunk' : patch.mode === 'access' ? 'accès' : null,
        patch.vlans ? `VLAN ${patch.vlans}` : null,
        patch.lag ? `agrégat ${patch.lag}` : null,
        port ? `port ${port}` : null,
        patch.label ? `« ${patch.label} »` : null,
        patch.redundant ? 'secours' : null,
      ].filter(Boolean)
      return morceaux.join(', ')
    }

    switch (intent.type) {
      case 'add': {
        get().setAppView('diagram')

        // Un nom déjà pris : à la voix, deux équipements du même nom ne se distinguent plus.
        // On refuse, et on dit comment retrouver celui qui existe.
        let nomVoulu = intent.name
        if (nomVoulu && intent.descriptif) {
          // « Serveur web » dit deux fois : le second s'appelle « Serveur web 2 ».
          const pris = new Set(get().diagram.nodes.map((node) => node.name))
          if ([...pris].some((nom) => plain(nom) === plain(nomVoulu ?? ''))) nomVoulu = nextName(nomVoulu, pris)
        } else if (nomVoulu) {
          const homonyme = get().diagram.nodes.find((node) => plain(node.name) === plain(nomVoulu ?? ''))
          if (homonyme) {
            return {
              ok: false,
              message: `« ${homonyme.name} » existe déjà. Donnez un autre nom, ou dites « sélectionne ${homonyme.name} ».`,
            }
          }
        }

        /*
          Où poser le nouvel arrivant. « Sous SW-CORE-01 » le place à l'aplomb de son repère ;
          si la place est prise, il continue dans la même direction — sous un switch qui a
          déjà quelque chose dessous, on se range à la suite, on ne part pas sur le côté.
        */
        // Sans repère dicté : dans la rangée de ses pairs. Le centre de la vue, où il atterrissait
        // jusqu'ici, est le plus souvent le milieu du schéma — sur les liaisons des autres.
        // Sur un plan vide il n'y a pas de rangée : le centre de la vue fait l'affaire.
        const dejaLa = get().diagram.nodes
        let position =
          dejaLa.length === 0
            ? center()
            : placeurParCouches(dejaLa, get().layout.direction, [rankOf(intent.kind, null)])(rankOf(intent.kind, null))
        let voisinage = ''
        if (intent.near) {
          const repere = findNode(intent.near.target)
          if (!repere) return { ok: false, message: missMessage(intent.near.target) }
          const pas = {
            below: [0, NODE_H + 90],
            above: [0, -(NODE_H + 90)],
            right: [NODE_W + 70, 0],
            left: [-(NODE_W + 70), 0],
          }[intent.near.side]
          const libre = (x: number, y: number) =>
            !get().diagram.nodes.some(
              (node) => Math.abs(node.x - x) < NODE_W * 0.8 && Math.abs(node.y - y) < NODE_H * 1.2,
            )
          let [x, y] = [repere.x + pas[0], repere.y + pas[1]]
          for (let essai = 0; essai < 12 && !libre(x, y); essai += 1) {
            x += pas[0] === 0 ? 0 : Math.sign(pas[0]) * (NODE_W + 40)
            y += pas[1] === 0 ? 0 : Math.sign(pas[1]) * (NODE_H + 40)
          }
          position = { x, y }
          voisinage = { below: 'sous', above: 'au-dessus de', right: 'à droite de', left: 'à gauche de' }[intent.near.side]
          voisinage = `, ${voisinage} ${repere.name}`
          // Le repère a servi à placer : ce n'est pas de lui qu'on reparlera, c'est du nouveau.
          voix.touches = []
        }

        const seed: Partial<NetNode> = {
          // Sans nom dicté, la convention du schéma : « FW-02 » se redit, « Pare-feu 2 » non.
          name: nomVoulu ?? nomPropose(intent.kind, get().diagram),
        }
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
          const pairs = designer(intent.connectTo)
          if (pairs.noeuds.length > 0) {
            for (const peer of pairs.noeuds) get().addLink(id, peer.id)
            extras.push(`relié à ${pairs.noeuds.map((node) => node.name).join(' et ')}`)
          } else extras.push(pairs.erreur ?? `« ${intent.connectTo} » introuvable`)
        }

        get().select({ nodes: [id] })
        voix.touches = [id]
        const created = get().diagram.nodes.find((node) => node.id === id)
        if (created) montrer([created])
        return {
          ok: true,
          message: `${intent.label} « ${created?.name ?? intent.label} » ajouté${voisinage}${extras.length > 0 ? `, ${extras.join(', ')}` : ''}.`,
        }
      }

      case 'build': {
        const avant = new Set(get().diagram.nodes.map((node) => node.id))
        const plan = analyserDescription(intent.description, get().diagram, { raccorder: intent.raccorder })
        if (plan.noeuds === 0) {
          return { ok: false, message: `Je n’ai reconnu aucun équipement dans « ${intent.description} ».` }
        }
        get().setAppView('diagram')
        const fait = get().appliquerPlan(plan.etapes.flatMap((etape) => etape.operations))
        const crees = get().diagram.nodes.filter((node) => !avant.has(node.id))
        get().select({ nodes: crees.map((node) => node.id) })
        voix.touches = crees.map((node) => node.id)

        // Ce à quoi les nouveaux ont été raccordés dans le schéma existant : il faut le dire,
        // puisque personne ne l'a demandé mot pour mot.
        const nomsCrees = new Set(crees.map((node) => node.name))
        const amonts = new Set<string>()
        for (const operation of plan.etapes.flatMap((etape) => etape.operations)) {
          if (operation.type !== 'liaison') continue
          for (const nom of [operation.de, operation.vers]) if (!nomsCrees.has(nom)) amonts.add(nom)
        }
        const liste =
          crees.length <= 6
            ? crees.map((node) => node.name).join(', ')
            : `${crees.slice(0, 5).map((node) => node.name).join(', ')}… et ${crees.length - 5} autres`
        const raccord =
          fait.liaisons === 0
            ? ''
            : amonts.size > 0
              ? ` ${fait.liaisons} liaison(s) posée(s), reliés à ${[...amonts].join(' et ')}.`
              : ` ${fait.liaisons} liaison(s) posée(s) entre eux.`
        const ignore = plan.ignores.length > 0 ? ` Non compris : « ${plan.ignores.join(' », « ')} ».` : ''
        montrer(crees)
        const entete = intent.modele ? `${intent.modele} : ${crees.length} équipement(s) posé(s)` : `${crees.length} équipement(s) ajouté(s)`
        return { ok: true, message: `${entete} : ${liste}.${raccord}${ignore}` }
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
        let aSupprimer: NetLink[]
        let libelle: string
        if (!intent.from && !intent.to) {
          // « supprime cette liaison » : celle dont on vient de parler, à défaut la sélection.
          const contexte = get().diagram.links.filter((item) => voix.liens.includes(item.id))
          aSupprimer = contexte.length > 0 ? contexte : get().diagram.links.filter((item) => get().selectedLinks.includes(item.id))
          if (aSupprimer.length === 0) {
            return { ok: false, message: 'Je ne sais pas de quelle liaison vous parlez : dites « le lien entre A et B ».' }
          }
          libelle = aSupprimer.length === 1 ? 'Liaison supprimée.' : `${aSupprimer.length} liaisons supprimées.`
        } else {
          const from = findNode(intent.from)
          if (!from) return { ok: false, message: missMessage(intent.from) }
          const to = findNode(intent.to)
          if (!to) return { ok: false, message: missMessage(intent.to) }
          aSupprimer = liaisonsEntre(from.id, to.id)
          if (aSupprimer.length === 0) return { ok: false, message: `Aucune liaison entre ${from.name} et ${to.name}.` }
          libelle =
            aSupprimer.length === 1
              ? `Liaison ${from.name} – ${to.name} supprimée.`
              : `${aSupprimer.length} liaisons supprimées entre ${from.name} et ${to.name}.`
        }
        get().select({ links: aSupprimer.map((item) => item.id) })
        get().deleteSelection()
        return { ok: true, message: libelle }
      }

      case 'linkEdit': {
        let cibles: NetLink[]
        let entete: string
        let created = false
        const nomDe = (id: string) => get().diagram.nodes.find((node) => node.id === id)?.name ?? '?'

        if (!intent.from && !intent.to) {
          // « passe-la en fibre », « cette liaison est en 10 giga » : la liaison du contexte.
          const contexte = get().diagram.links.filter((item) => voix.liens.includes(item.id))
          cibles = contexte.length > 0 ? contexte : get().diagram.links.filter((item) => get().selectedLinks.includes(item.id))
          if (cibles.length === 0) {
            return { ok: false, message: 'Je ne sais pas de quelle liaison vous parlez : dites « le lien entre A et B ».' }
          }
          entete = cibles.length === 1 ? `Liaison ${nomDe(cibles[0].from)} – ${nomDe(cibles[0].to)}` : `${cibles.length} liaisons`
        } else {
          const from = findNode(intent.from)
          if (!from) return { ok: false, message: missMessage(intent.from) }
          const to = findNode(intent.to)
          if (!to) return { ok: false, message: missMessage(intent.to) }
          if (from.id === to.id) return { ok: false, message: 'Une liaison relie deux équipements différents.' }

          // « la liaison entre A et B est en fibre » vaut aussi bien pour une liaison qui
          // existe déjà que pour une qui reste à créer.
          let entre = liaisonsEntre(from.id, to.id)
          if (entre.length === 0) {
            get().addLink(from.id, to.id)
            entre = liaisonsEntre(from.id, to.id)
            created = true
          }
          if (entre.length === 0) return { ok: false, message: 'La liaison n’a pas pu être créée.' }
          cibles = intent.tous ? entre : [entre[0]]
          entete = `Liaison ${from.name} – ${to.name}`
          if (intent.tous && entre.length > 1) entete = `${entre.length} liaisons ${from.name} – ${to.name}`
        }

        // Le port se pose du côté de l'équipement qui le porte, quel que soit le sens dans
        // lequel la liaison a été tirée.
        const porteur = intent.port ? designer(intent.port.device).noeuds[0] : undefined
        for (const item of cibles) {
          const patch: Partial<NetLink> = { ...intent.patch }
          if (intent.port && porteur) {
            if (item.from === porteur.id) patch.portA = intent.port.name
            else if (item.to === porteur.id) patch.portB = intent.port.name
          }
          get().updateLink(item.id, patch)
        }
        get().select({ links: cibles.map((item) => item.id) })
        voix.liensTouches = cibles.map((item) => item.id)

        const quoi = direPatch(intent.patch, intent.port?.name)
        const conseil =
          intent.patch.lag && cibles.length === 1
            ? ' Un seul brin pour l’instant : dites « double le lien » pour former le faisceau.'
            : ''
        return {
          ok: true,
          message: `${entete}${created ? ' créée' : ''}${quoi ? ` : ${quoi}` : ' modifiée'}.${conseil}`,
        }
      }

      case 'selectKind': {
        const ids = get()
          .diagram.nodes.filter((node) => node.kind === intent.kind)
          .map((node) => node.id)
        if (ids.length === 0) return { ok: false, message: `Aucun ${intent.label.toLowerCase()} dans le schéma.` }
        get().setAppView('diagram')
        get().select({ nodes: ids })
        voix.touches = ids
        return {
          ok: true,
          message:
            ids.length === 1
              ? `1 équipement « ${intent.label} » sélectionné.`
              : `${ids.length} équipements « ${intent.label} » sélectionnés.`,
        }
      }
      case 'link': {
        // Les paires à relier. « Relie tous les switchs d'accès aux deux cœurs » en fait
        // autant qu'il y a de couples ; « relie-les entre eux » n'en fait qu'une.
        let paires: [NetNode, NetNode][]
        let sujets: NetNode[]
        if (intent.mutual) {
          const groupe = designer(intent.from)
          if (groupe.erreur) return { ok: false, message: groupe.erreur }
          if (groupe.noeuds.length !== 2) {
            return {
              ok: false,
              message: `« Entre eux » relie deux équipements, et ${groupe.noeuds.length} sont désignés. Nommez les deux à relier.`,
            }
          }
          paires = [[groupe.noeuds[0], groupe.noeuds[1]]]
          sujets = groupe.noeuds
        } else {
          const de = designer(intent.from)
          if (de.erreur) return { ok: false, message: de.erreur }
          const vers = designer(intent.to)
          if (vers.erreur) return { ok: false, message: vers.erreur }
          paires = []
          for (const a of de.noeuds) for (const b of vers.noeuds) if (a.id !== b.id) paires.push([a, b])
          sujets = de.noeuds
          if (paires.length === 0) return { ok: false, message: 'Une liaison relie deux équipements différents.' }
        }
        if (paires.length > 40) {
          return { ok: false, message: `Cela ferait ${paires.length} liaisons d’un coup : désignez moins d’équipements.` }
        }

        const posees: string[] = []
        let deja = 0
        for (const [a, b] of paires) {
          // « relie » dit deux fois ne pose pas deux câbles : un second brin se demande.
          if (!intent.extra && liaisonsEntre(a.id, b.id).length > 0) {
            deja += 1
            continue
          }
          const seed: Partial<NetLink> = {}
          if (intent.linkKind) seed.kind = intent.linkKind
          if (intent.speed) seed.speed = intent.speed
          get().addLink(a.id, b.id, Object.keys(seed).length > 0 ? seed : undefined)
          const cree = get().selectedLinks[0]
          if (cree) posees.push(cree)
        }
        // Le sujet reste le sujet : après « relie-le à A », « relie-le à B » parle du même.
        voix.touches = sujets.map((node) => node.id)
        voix.liensTouches = posees
        if (posees.length > 0) get().select({ links: posees })

        const [a, b] = paires[0]
        if (posees.length === 0) {
          return {
            ok: true,
            message:
              paires.length === 1
                ? `${a.name} et ${b.name} sont déjà reliés. Dites « double le lien » pour un second brin.`
                : 'Ces équipements sont déjà reliés entre eux.',
          }
        }
        const detail = [intent.linkKind ? LINKS[intent.linkKind]?.label?.toLowerCase() : null, intent.speed]
          .filter(Boolean)
          .join(', ')
        const suite = `${detail ? ` (${detail})` : ''}${deja > 0 ? ` ; ${deja} l’étaient déjà` : ''}`
        if (paires.length === 1) {
          return { ok: true, message: `${a.name} relié à ${b.name}${intent.extra ? ' par un second brin' : ''}${suite}.` }
        }
        const cibles = [...new Set(paires.map(([, vers]) => vers.name))]
        return {
          ok: true,
          message: `${posees.length} liaisons posées vers ${cibles.slice(0, 4).join(' et ')}${suite}.`,
        }
      }

      case 'rename': {
        const node = findNode(intent.target)
        if (!node) return { ok: false, message: missMessage(intent.target) }
        const nom = intent.name.trim()
        if (!nom) return { ok: false, message: 'Quel nom lui donner ?' }
        const homonyme = get().diagram.nodes.find((autre) => autre.id !== node.id && plain(autre.name) === plain(nom))
        if (homonyme) return { ok: false, message: `« ${homonyme.name} » existe déjà : choisissez un autre nom.` }
        get().updateNode(node.id, { name: nom })
        return { ok: true, message: `${node.name} renommé en ${nom}.` }
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

      case 'vlanRemove': {
        const vlan = (get().diagram.vlans ?? []).find((v) => v.id === intent.id)
        if (!vlan) return { ok: false, message: `Le VLAN ${intent.id} n’est pas au plan d’adressage.` }
        get().removeVlan(intent.id)
        return { ok: true, message: `VLAN ${intent.id} retiré du plan d’adressage.` }
      }

      // ── Déductions ────────────────────────────────────────────────────────
      case 'deduireHa': {
        const bilan = get().deduireMecanismesHa()
        if (bilan.grappes === 0) {
          return { ok: false, message: 'Aucun mécanisme n’a pu être déduit : les grappes ne portent pas assez d’indices.' }
        }
        return {
          ok: true,
          message: `${bilan.grappes} grappe(s) renseignée(s), ${bilan.equipements} équipement(s) mis à jour.`,
        }
      }
      case 'deduireVlans': {
        const combien = get().deduceVlansFromDiagram()
        return combien === 0
          ? { ok: false, message: 'Aucun VLAN à déduire : le schéma n’en mentionne pas.' }
          : { ok: true, message: `${combien} VLAN ajouté(s) au plan d’adressage.` }
      }

      // ── Mise en page d'une sélection ──────────────────────────────────────
      case 'align': {
        const ids = get().selectedNodes
        if (ids.length < 2) return { ok: false, message: 'Sélectionnez au moins deux équipements à aligner.' }
        get().alignNodes(ids, intent.mode)
        return { ok: true, message: `${ids.length} équipements alignés.` }
      }
      case 'distribute': {
        const ids = get().selectedNodes
        if (ids.length < 3) return { ok: false, message: 'Sélectionnez au moins trois équipements à répartir.' }
        get().distributeNodes(ids, intent.axis)
        return { ok: true, message: `${ids.length} équipements répartis.` }
      }

      // ── Grappes, agrégats, baies ──────────────────────────────────────────
      case 'clusterColor': {
        const grappes = new Set(get().diagram.nodes.map((n) => n.cluster).filter(Boolean) as string[])
        const trouvee = [...grappes].find((g) => g.toLowerCase() === intent.cluster.toLowerCase())
        if (!trouvee) return { ok: false, message: `Aucune grappe « ${intent.cluster} » sur le schéma.` }
        get().setClusterColor(trouvee, intent.couleur)
        return { ok: true, message: `Grappe ${trouvee} en ${intent.libelle.toLowerCase()}.` }
      }
      case 'lagRename': {
        const ids = get().selectedLinks
        if (ids.length === 0) return { ok: false, message: 'Sélectionnez d’abord une liaison de l’agrégat.' }
        get().renameLag(ids, intent.nom)
        return { ok: true, message: `Agrégat renommé « ${intent.nom} ».` }
      }
      case 'lagHidden': {
        const ids = get().diagram.links.map((l) => l.id)
        get().setLagHidden(ids, intent.hidden)
        return { ok: true, message: intent.hidden ? 'Anneaux d’agrégat masqués.' : 'Anneaux d’agrégat affichés.' }
      }
      case 'rackAdd': {
        const existe = (get().diagram.racks ?? []).some((r) => r.name.toLowerCase() === intent.name.toLowerCase())
        if (existe) return { ok: false, message: `La baie « ${intent.name} » existe déjà.` }
        get().addRack({ name: intent.name, units: intent.units ?? 42 })
        return { ok: true, message: `Baie ${intent.name} créée (${intent.units ?? 42} U).` }
      }
      case 'rackRemove': {
        const rack = (get().diagram.racks ?? []).find((r) => r.name.toLowerCase() === intent.name.toLowerCase())
        if (!rack) return { ok: false, message: `Aucune baie « ${intent.name} ».` }
        get().removeRack(rack.id)
        return { ok: true, message: `Baie ${rack.name} supprimée ; les équipements qu’elle portait restent au schéma.` }
      }

      // ── Affichage et cartouche ────────────────────────────────────────────
      case 'strictOsi':
        get().setStrictOsi(intent.strict)
        return { ok: true, message: intent.strict ? 'Lecture L3 stricte activée.' : 'Lecture L3 stricte désactivée.' }
      case 'titleBlock': {
        const champs: Record<typeof intent.champ, keyof TitleBlock> = {
          reference: 'reference',
          indice: 'version',
          auteur: 'author',
          organisation: 'organisation',
          diffusion: 'confidentiality',
        }
        get().setTitleBlock({ [champs[intent.champ]]: intent.valeur } as Partial<TitleBlock>)
        return { ok: true, message: `Cartouche : ${intent.champ} « ${intent.valeur} ».` }
      }

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
      case 'undo': {
        const voulues = intent.times ?? 1
        let faites = 0
        while (faites < voulues && get().past.length > 0) {
          get().undo()
          faites += 1
        }
        if (faites === 0) return { ok: false, message: 'Rien à annuler.' }
        return { ok: true, message: faites === 1 ? 'Annulé.' : `${faites} actions annulées.` }
      }
      case 'redo': {
        if (get().future.length === 0) {
          // « rétablis » se dit aussi d'une panne simulée : s'il n'y a rien à refaire et
          // qu'une simulation est en cours, c'est d'elle qu'on parle.
          const pannes = get().pannes
          if (pannes.nodes.length + pannes.links.length > 0) {
            get().clearPannes()
            return { ok: true, message: 'Simulation remise à zéro : réseau intact.' }
          }
          return { ok: false, message: 'Rien à rétablir.' }
        }
        get().redo()
        return { ok: true, message: 'Rétabli.' }
      }
      case 'delete': {
        /*
          Supprimer se rattrape — « annule » — mais pas toujours : celui qui dicte ne regarde
          pas forcément l'écran. Au-delà de trois équipements, ou pour tout le schéma, on
          annonce ce qui va partir et on attend un « oui ». Toute autre phrase abandonne.
        */
        const SEUIL_CONFIRMATION = 3
        if (intent.all) {
          const { nodes, links } = get().diagram
          const annotations = get().diagram.annotations ?? []
          if (nodes.length === 0 && annotations.length === 0) return { ok: false, message: 'Le schéma est déjà vide.' }
          voix.attente = {
            executer: () => {
              get().selectAll()
              get().deleteSelection()
              oublierVoix()
              return { ok: true, message: `Schéma vidé : ${nodes.length} équipement(s) supprimé(s). Dites « annule » pour revenir.` }
            },
          }
          return {
            ok: true,
            message: `Cela supprime tout le schéma : ${nodes.length} équipement(s) et ${links.length} liaison(s). Dites « oui » pour confirmer, « non » pour abandonner.`,
          }
        }
        if (intent.target) {
          const targets = resolveTargets(intent.target)
          if (targets.length === 0) return { ok: false, message: missMessage(intent.target) }
          const ids = targets.map((node) => node.id)
          const supprimer = () => {
            get().select({ nodes: ids })
            get().deleteSelection()
            return {
              ok: true,
              message:
                targets.length === 1 ? `${targets[0].name} supprimé.` : `${targets.length} équipements supprimés.`,
            }
          }
          if (targets.length <= SEUIL_CONFIRMATION) return supprimer()
          voix.attente = { executer: supprimer }
          const apercu = targets.slice(0, 5).map((node) => node.name).join(', ')
          return {
            ok: true,
            message: `Cela supprime ${targets.length} équipements : ${apercu}${targets.length > 5 ? '…' : ''}. Dites « oui » pour confirmer, « non » pour abandonner.`,
          }
        }
        const { selectedNodes, selectedLinks, selectedAnnotations } = get()
        const count = selectedNodes.length + selectedLinks.length + selectedAnnotations.length
        if (count === 0) {
          return { ok: false, message: 'Rien n’est sélectionné : dites « supprime NOM », ou sélectionnez d’abord.' }
        }
        const supprimer = () => {
          get().select({ nodes: selectedNodes, links: selectedLinks, annotations: selectedAnnotations })
          get().deleteSelection()
          return { ok: true, message: `${count} élément(s) supprimé(s).` }
        }
        if (selectedNodes.length <= SEUIL_CONFIRMATION) return supprimer()
        voix.attente = { executer: supprimer }
        return {
          ok: true,
          message: `Cela supprime ${selectedNodes.length} équipements sélectionnés. Dites « oui » pour confirmer, « non » pour abandonner.`,
        }
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
      case 'confirm':
        // Arrive ici seulement quand rien n'attendait de réponse.
        return { ok: false, message: 'Rien n’attend de confirmation.' }

      case 'note': {
        let cible: NetNode | undefined
        let texte = intent.text
        if (intent.libre !== undefined) {
          /*
            Sans deux-points, rien ne dit où finit le nom. On prend le plus long début de
            phrase qui est exactement un nom du schéma — puis, à défaut, un pronom ou un type
            seul de son espèce. Jamais d'à-peu-près ici : un texte libre ressemble à tout.
          */
          const mots = intent.libre.split(/\s+/)
          const exact = (nom: string) => {
            const cherche = plain(nom).replace(/[\s-]/g, '')
            return cherche ? get().diagram.nodes.find((node) => plain(node.name).replace(/[\s-]/g, '') === cherche) : undefined
          }
          for (let longueur = Math.min(mots.length - 1, 6); longueur >= 1 && !cible; longueur -= 1) {
            const trouve = exact(mots.slice(0, longueur).join(' '))
            if (trouve) {
              cible = trouve
              texte = phrase(mots.slice(longueur).join(' '))
            }
          }
          for (let longueur = Math.min(mots.length - 1, 4); longueur >= 1 && !cible; longueur -= 1) {
            const debut = mots.slice(0, longueur).join(' ')
            const parType = findDeviceScored(debut.replace(/^(?:le|la|l'|l’|du|au)\s*/i, ''))
            const estPronom = plain(debut) === REPERE_PRONOM
            if (!estPronom && !(parType && parType.score >= 0.9)) continue
            const designe = designer(debut)
            if (designe.noeuds.length === 1) {
              cible = designe.noeuds[0]
              texte = phrase(mots.slice(longueur).join(' '))
            }
          }
          if (!cible) {
            return {
              ok: false,
              message: `Je ne trouve pas l’équipement au début de « ${intent.libre} ». Dites « note sur NOM : texte ».`,
            }
          }
          retenir([cible])
        } else if (intent.target) {
          cible = findNode(intent.target)
          if (!cible) return { ok: false, message: missMessage(intent.target) }
        }
        if (!cible) return { ok: false, message: 'Dites sur quel équipement porte la note.' }
        if (!texte.trim()) return { ok: false, message: 'La note est vide.' }
        const actuelle = get().diagram.nodes.find((node) => node.id === cible.id)?.notes?.trim()
        const suite = intent.append && actuelle
        get().updateNode(cible.id, { notes: suite ? `${actuelle}\n${texte}` : texte })
        return {
          ok: true,
          message: suite ? `Ajouté à la note de ${cible.name} : « ${texte} »` : `Note de ${cible.name} : « ${texte} »`,
        }
      }

      case 'dictation': {
        if (intent.action === 'stop') return { ok: false, message: 'Aucune dictée en cours.' }
        let cible: NetNode | undefined
        if (intent.target) {
          cible = findNode(intent.target)
          if (!cible) return { ok: false, message: missMessage(intent.target) }
        } else {
          // Sans équipement désigné : celui dont on parle, s'il n'y en a qu'un ; sinon le plan.
          const contexte = get().diagram.nodes.filter((node) => voix.noeuds.includes(node.id))
          const selection = get().diagram.nodes.filter((node) => get().selectedNodes.includes(node.id))
          cible = contexte.length === 1 ? contexte[0] : selection.length === 1 ? selection[0] : undefined
          if (cible) retenir([cible])
        }
        voix.dictee = { noeud: cible?.id ?? null, nom: cible?.name ?? 'le plan', texte: [] }
        set({ dicteeVocale: cible?.name ?? 'une note du plan' })
        return {
          ok: true,
          message: cible
            ? `Dictée ouverte sur ${cible.name} : tout ce que vous dites s’ajoute à sa note. Dites « fin de dictée » pour reprendre les commandes.`
            : 'Dictée ouverte : tout ce que vous dites ira dans une note du plan. Dites « fin de dictée » pour reprendre les commandes.',
        }
      }

      case 'annotationRemove': {
        const annotations = get().diagram.annotations ?? []
        if (annotations.length === 0) return { ok: false, message: 'Aucune note sur le plan.' }
        if (intent.which === 'all') {
          get().select({ nodes: [], annotations: annotations.map((item) => item.id) })
          get().deleteSelection()
          return { ok: true, message: `${annotations.length} annotation(s) supprimée(s).` }
        }
        const derniere = annotations[annotations.length - 1]
        get().removeAnnotation(derniere.id)
        return { ok: true, message: `Dernière annotation supprimée${derniere.text ? ` : « ${derniere.text} »` : ''}.` }
      }

      case 'flow': {
        /*
          Une extrémité de flux est un équipement, une zone ou un site — ce que la matrice
          sait recouper avec le schéma. On reprend l'orthographe du schéma quand le nom dicté
          y correspond, pour que le contrôle des flux le reconnaisse.
        */
        const extremite = (dit: string): string => {
          const equipement = designer(dit)
          if (equipement.noeuds.length === 1) return equipement.noeuds[0].name
          // « la zone Bureaux » : la matrice attend le nom de la zone, sans le mot « zone ».
          const nom = dit.trim().replace(/^(?:la |le |l['’])?(?:zone|site)\s+/i, '')
          const groupes = new Set<string>()
          for (const node of get().diagram.nodes) {
            if (node.zone) groupes.add(node.zone)
            if (node.site) groupes.add(node.site)
          }
          return [...groupes].find((groupe) => plain(groupe) === plain(nom)) ?? phrase(nom)
        }
        const flux: FlowDef = {
          id: uid('f'),
          from: extremite(intent.from),
          to: extremite(intent.to),
          service: intent.service,
          action: intent.decision,
        }
        get().upsertFlow(flux)
        voix.touches = []
        return {
          ok: true,
          message: `Flux ${flux.service ? `${flux.service} ` : ''}${flux.from} → ${flux.to} ${
            intent.decision === 'refuse' ? 'refusé' : 'autorisé'
          }, inscrit dans la matrice.`,
        }
      }

      case 'reprise': {
        if (!intent.cible) {
          get().ouvrirReprise()
          return { ok: true, message: 'Inventaire ouvert : cochez les équipements à reprendre.' }
        }
        // L'inventaire, vu de cette page : ce que portent les autres pages et qu'elle n'a pas.
        const pages = get().pagesCompletes()
        const autres = pages.filter((_, index) => index !== get().activePage)
        const ici = new Set(get().diagram.nodes.map((node) => cleNom(node.name)))
        const inventaire = inventaireDuDocument(autres)
        const disponibles = inventaire.filter((item) => !ici.has(item.cle))
        if (inventaire.length === 0) {
          return {
            ok: false,
            message: 'Rien à reprendre : les autres pages du document sont vides. Depuis l’onglet Inventaire, sélectionnez des équipements puis « Créer un schéma avec la sélection ».',
          }
        }
        if (disponibles.length === 0) return { ok: false, message: 'Tout l’inventaire est déjà sur cette page.' }

        const dit = plain(intent.cible)
        let choisis: NetNode[] = []
        const groupe = dit.match(
          /^(?:tout |tous les equipements |les equipements |l'equipement |ceux )?(?:du |de la |de l'|des |d'|la |le |l')?(site|zone|page|grappe|cluster|baie) (.+)$/,
        )
        if (/^(?:tout|tout l'inventaire|l'inventaire|tous les equipements|tout le parc|le parc)$/.test(dit)) {
          choisis = disponibles.map((item) => item.node)
        } else if (groupe) {
          const valeur = groupe[2]
          const baies = new Map(autres.flatMap((page) => (page.racks ?? []).map((rack) => [rack.id, plain(rack.name)] as const)))
          choisis = disponibles
            .filter((item) => {
              const node = item.node
              if (groupe[1] === 'site') return plain(node.site ?? '') === valeur
              if (groupe[1] === 'zone') return plain(node.zone ?? '') === valeur
              if (groupe[1] === 'page') return item.pages.some((nom) => plain(nom) === valeur)
              if (groupe[1] === 'baie') return baies.get(node.rack ?? '') === valeur
              return plain(node.cluster ?? '') === valeur
            })
            .map((item) => item.node)
          if (choisis.length === 0) {
            return { ok: false, message: `Aucun équipement à reprendre pour « ${groupe[1]} ${groupe[2]} ».` }
          }
        } else {
          const designes = designer(intent.cible, disponibles.map((item) => item.node))
          if (designes.noeuds.length === 0) {
            const dejaIci = designer(intent.cible)
            if (dejaIci.noeuds.length > 0) {
              return { ok: false, message: `${dejaIci.noeuds.map((node) => node.name).join(', ')} : déjà sur cette page.` }
            }
            return { ok: false, message: (designes.erreur ?? '').replace(/introuvable\.$/, 'introuvable dans l’inventaire.') || 'Rien à reprendre.' }
          }
          choisis = designes.noeuds
        }

        const fait = get().reprendreEquipements(autres, choisis.map((node) => node.name))
        voix.touches = [...get().selectedNodes]
        const liste =
          choisis.length <= 6
            ? choisis.map((node) => node.name).join(', ')
            : `${choisis.slice(0, 5).map((node) => node.name).join(', ')}… et ${choisis.length - 5} autres`
        return {
          ok: true,
          message: `${fait.equipements} équipement(s) repris de l’inventaire : ${liste}.${
            fait.liaisons > 0 ? ` ${fait.liaisons} liaison(s) déjà tracée(s) reprise(s).` : ''
          }`,
        }
      }

      case 'pageDepuisSelection': {
        const selection = get().diagram.nodes.filter((node) => get().selectedNodes.includes(node.id))
        if (selection.length === 0) {
          return { ok: false, message: 'Rien n’est sélectionné : sélectionnez d’abord les équipements à emporter.' }
        }
        const origine = get().diagram.pageName ?? 'Schéma'
        const fait = get().reprendreEquipements([get().diagram], selection.map((node) => node.name), {
          nouvellePage: intent.name ?? '',
        })
        voix.touches = [...get().selectedNodes]
        return {
          ok: true,
          message: `Page « ${get().diagram.pageName} » créée avec ${fait.equipements} équipement(s) de « ${origine} »${
            fait.liaisons > 0 ? ` et ${fait.liaisons} liaison(s)` : ''
          }.`,
        }
      }

      case 'flowRemove': {
        const flux = get().diagram.flows ?? []
        if (flux.length === 0) return { ok: false, message: 'La matrice de flux est vide.' }
        const dire = (item: FlowDef) => `${item.service ? `${item.service} ` : ''}${item.from} → ${item.to}`
        if (intent.which === 'last') {
          const dernier = flux[flux.length - 1]
          get().removeFlow(dernier.id)
          return { ok: true, message: `Flux ${dire(dernier)} retiré de la matrice.` }
        }
        let vises = flux
        if (intent.which !== 'all') {
          // Même lecture des extrémités qu'à la création : sans « zone », sans casse ni accent.
          const cle = (texte: string) => plain(texte.replace(/^(?:la |le |l['’])?(?:zone|site)\s+/i, ''))
          const [de, vers] = [cle(intent.from ?? ''), cle(intent.to ?? '')]
          vises = flux.filter(
            (item) =>
              cle(item.from) === de &&
              cle(item.to) === vers &&
              (!intent.service || plain(item.service ?? '') === plain(intent.service)),
          )
          if (vises.length === 0) {
            return { ok: false, message: `Aucun flux de ${intent.from} vers ${intent.to} dans la matrice.` }
          }
        }
        for (const item of vises) get().removeFlow(item.id)
        return {
          ok: true,
          message: vises.length === 1 ? `Flux ${dire(vises[0])} retiré de la matrice.` : `${vises.length} flux retirés de la matrice.`,
        }
      }

      case 'annotationEdit': {
        const notes = (get().diagram.annotations ?? []).filter((item) => item.kind === 'note')
        const derniere = notes[notes.length - 1]
        if (!derniere) return { ok: false, message: 'Aucune note sur le plan : dites « note : … » pour en poser une.' }
        get().updateAnnotation(derniere.id, { text: intent.text })
        return { ok: true, message: `Note réécrite : « ${intent.text} »` }
      }

      case 'vlanPropagation': {
        get().setVlanPropagation(intent.on)
        return {
          ok: true,
          message: intent.on
            ? 'Les VLAN sont suivis le long des trunks.'
            : 'Les VLAN ne sont plus suivis : seul ce qui est écrit compte.',
        }
      }

      case 'pageMove': {
        const { activePage } = get()
        const combien = get().pagesCompletes().length
        const cible = activePage + intent.direction
        if (cible < 0 || cible >= combien) {
          return { ok: false, message: `La page est déjà ${intent.direction < 0 ? 'la première' : 'la dernière'}.` }
        }
        get().movePage(activePage, intent.direction)
        return { ok: true, message: `Page déplacée en position ${cible + 1} sur ${combien}.` }
      }

      case 'rackEdit': {
        const baies = get().diagram.racks ?? []
        const voulue = plain(intent.rack)
        const baie =
          baies.find((item) => plain(item.name) === voulue) ?? bestMatch(intent.rack, baies, (item) => item.name)?.item
        if (!baie) return { ok: false, message: `Aucune baie « ${intent.rack} ».` }
        if (intent.name) {
          if (baies.some((item) => item.id !== baie.id && plain(item.name) === plain(intent.name ?? ''))) {
            return { ok: false, message: `La baie « ${intent.name} » existe déjà.` }
          }
          get().updateRack(baie.id, { name: intent.name })
          return { ok: true, message: `Baie ${baie.name} renommée ${intent.name}.` }
        }
        const unites = intent.units ?? baie.units
        if (unites < 1 || unites > 60) return { ok: false, message: 'Une baie fait entre 1 et 60 U.' }
        // Rétrécir une baie sous un équipement implanté le laisserait hors de la baie.
        const plusHaut = Math.max(
          0,
          ...get()
            .diagram.nodes.filter((node) => node.rack === baie.id && node.rackUnit)
            .map((node) => (node.rackUnit ?? 0) + (node.heightU ?? 1) - 1),
        )
        if (unites < plusHaut) {
          return { ok: false, message: `La baie ${baie.name} est occupée jusqu’au U ${plusHaut} : elle ne peut pas descendre à ${unites} U.` }
        }
        get().updateRack(baie.id, { units: unites })
        return { ok: true, message: `Baie ${baie.name} : ${unites} U.` }
      }

      case 'panel': {
        get().setPanelOpen(intent.panel, intent.open)
        const noms = { palette: 'Palette', inspecteur: 'Inspecteur', minicarte: 'Mini-carte' }
        return { ok: true, message: `${noms[intent.panel]} ${intent.open ? 'affiché' : 'masqué'}${intent.panel === 'inspecteur' ? '' : 'e'}.` }
      }

      case 'path': {
        const depart = findNode(intent.from)
        if (!depart) return { ok: false, message: missMessage(intent.from) }
        const arrivee = findNode(intent.to)
        if (!arrivee) return { ok: false, message: missMessage(intent.to) }
        const rapport = cheminsEntre(get().diagram, depart.id, arrivee.id)
        const chemin = rapport.chemins[0]
        if (!chemin) return { ok: false, message: `Aucun chemin entre ${depart.name} et ${arrivee.name}.` }
        get().setAppView('diagram')
        get().montrerLiens(chemin.etapes.flatMap((etape) => (etape.link ? [etape.link.id] : [])))
        const trajet = chemin.etapes.map((etape) => etape.node.name).join(' → ')
        const secours = rapport.chemins.length > 1 ? ` ${rapport.chemins.length - 1} chemin(s) de secours.` : ' Pas de chemin de secours.'
        const goulot = chemin.goulot ? ` Goulot : ${chemin.goulot.debit}.` : ''
        return { ok: true, message: `${chemin.sauts} saut(s) : ${trajet}.${secours}${goulot}` }
      }

      case 'blink': {
        get().setDureeClignotement(intent.seconds)
        return { ok: true, message: `Les liaisons désignées clignotent ${get().dureeClignotement} secondes.` }
      }

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
    if (lockedStore()) return { nodes: 0, links: 0, vlans: 0, warnings: ['Schéma verrouillé.'] }
    const base = mode === 'merge' ? get().diagram : emptyDiagram()
    const result = parseQuickImport(text, base)
    if (result.nodes.length === 0 && result.links.length === 0 && result.vlans.length === 0) {
      return { nodes: 0, links: 0, vlans: 0, warnings: result.warnings }
    }
    get().pushHistory()
    const updated = new Map(result.updates.map((node) => [node.id, node]))
    // Un VLAN déjà décrit garde ce qu'il sait : une cellule vide ne l'efface pas.
    const plan = new Map((base.vlans ?? []).map((vlan) => [vlan.id, vlan]))
    let vlansAjoutes = 0
    for (const arrivant of result.vlans) {
      const present = plan.get(arrivant.id)
      if (!present) vlansAjoutes += 1
      plan.set(arrivant.id, {
        ...present,
        ...arrivant,
        name: arrivant.name ?? present?.name,
        subnet: arrivant.subnet ?? present?.subnet,
        gateway: arrivant.gateway ?? present?.gateway,
        notes: arrivant.notes ?? present?.notes,
      })
    }
    /*
      On repart du document complet : un import qui ne recopierait que les équipements et les
      liaisons emporterait avec lui le plan d'adressage, les baies, les annotations et le
      cartouche — tout ce que le collage ne mentionne pas.
    */
    const diagram: Diagram = {
      ...base,
      nodes: [...base.nodes.map((node) => updated.get(node.id) ?? node), ...result.nodes],
      links: [...base.links, ...result.links],
      vlans: [...plan.values()].sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id)),
    }
    set((state) => ({
      diagram: autoLayoutOf(diagram, state.layout),
      selectedNodes: [],
      selectedLinks: [],
    }))
    get().fitView()
    return {
      nodes: result.nodes.length,
      links: result.links.length,
      vlans: vlansAjoutes,
      warnings: result.warnings,
    }
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

  setVlanPropagation: (actif) => {
    set({ vlanPropagation: actif })
    get().notify(
      actif
        ? 'Les VLAN sont suivis le long des trunks : les vues logiques montrent leur portée réelle.'
        : 'Les VLAN ne sont plus suivis : seul ce qui est écrit sur les équipements et les liaisons compte.',
    )
  },

  setDureeClignotement: (secondes) => {
    const valeur = borner(secondes)
    try {
      localStorage.setItem(CLE_CLIGNOTEMENT, String(valeur))
    } catch {
      // Stockage indisponible : le réglage vaut pour la session, sans plus.
    }
    set({ dureeClignotement: valeur })
  },

  montrerLiens: (ids, duree) => {
    const millisecondes = duree ?? get().dureeClignotement * 1000
    set({ projecteurLiens: ids })
    if (minuterieProjecteur) clearTimeout(minuterieProjecteur)
    if (ids.length === 0) return
    minuterieProjecteur = setTimeout(() => {
      // On ne retire que ce qu'on a posé : si une autre désignation est arrivée entre-temps,
      // c'est elle qui tient, et sa propre minuterie s'en chargera.
      if (useDiagram.getState().projecteurLiens === ids) set({ projecteurLiens: [] })
    }, millisecondes)
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
    const { diagram, viewMode, vueLogique, layout, vlanPropagation } = get()
    return viewMode === 'logique'
      ? projectionLogique(diagram, vueLogique, layout, vlanPropagation)
      : diagram
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
    /*
      Les noms de couches s'écrivent dans la marge gauche, hors du nuage d'équipements. En
      vue « plan VLAN » ils portent le sous-réseau et la passerelle : les ignorer reviendrait
      à cadrer sur un schéma dont il manque la légende de chaque rail.
    */
    if (get().showLayerLabels) bounds.minX -= diagram.layerColors ? 230 : 120
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    // Panneau vocal ouvert : on cadre dans ce qu'il laisse voir.
    const masque = bandeMasquee(get())
    const largeur = canvasSize.width - masque
    const zoom = Math.min(
      2,
      Math.max(0.15, Math.min((largeur - padding * 2) / width, (canvasSize.height - padding * 2) / height)),
    )
    set({
      view: {
        zoom,
        tx: masque + largeur / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
        ty: canvasSize.height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
      },
    })
  },

  loadDiagram: (diagram) => {
    get().pushHistory()
    oublierVoix()
    set((state) => ({
      dicteeVocale: null,
      attenteVocale: false,
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
    // Un autre document : l'historique de l'ancien n'a plus de sens, la conversation non plus.
    oublierVoix()
    set({
      dicteeVocale: null,
      attenteVocale: false,
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
    oublierVoix()
    set({ diagram: emptyDiagram(), selectedNodes: [], selectedLinks: [], connectFrom: null, dicteeVocale: null, attenteVocale: false })
  },

  loadSample: () => {
    get().pushHistory()
    oublierVoix()
    set((state) => ({
      dicteeVocale: null,
      attenteVocale: false,
      diagram: autoLayoutOf(sampleDiagram(), state.layout),
      selectedNodes: [],
      selectedLinks: [],
      connectFrom: null,
    }))
    get().fitView()
  },

  notify: (toast) => set({ toast }),
}))

/**
 * Où poser un équipement qui arrive dans un schéma existant.
 *
 * On ne déplace rien de ce que l'utilisateur a disposé — mais on ne rejette pas non plus
 * l'arrivant tout en bas, ni au milieu de la vue, sur les liaisons des autres. Un switch
 * d'accès se pose au bout de la rangée des switchs d'accès ; une couche qui n'existait pas
 * encore s'intercale entre ses voisines s'il y a la place, sinon se range après la dernière.
 * Jamais sur un équipement déjà là.
 *
 * `rangsAVenir` annonce les couches des équipements à poser : les couches nouvelles sont
 * réservées dans l'ordre des rangs, quel que soit l'ordre dans lequel on les pose ensuite.
 * La fonction rendue se souvient de ce qu'elle a posé.
 */
function placeurParCouches(
  existants: NetNode[],
  direction: LayoutOptions['direction'],
  rangsAVenir: number[],
): (rang: number) => { x: number; y: number } {
  const vide = existants.length === 0
  const vertical = direction === 'TB'
  const pasTravers = vertical ? NODE_W + 60 : NODE_H + 50
  const pasCouche = vertical ? NODE_H + 90 : NODE_W + 110
  const bornes = diagramBounds(existants)
  const mediane = (valeurs: number[]) => [...valeurs].sort((a, b) => a - b)[Math.floor(valeurs.length / 2)]

  /** Par rang : la position de la couche, et le bout de la rangée. */
  const rangees = new Map<number, { couche: number; bout: number }>()
  const parRang = new Map<number, NetNode[]>()
  for (const node of existants) {
    const rang = rankOf(node.kind, node.rank ?? null)
    parRang.set(rang, [...(parRang.get(rang) ?? []), node])
  }
  for (const [rang, membres] of parRang) {
    rangees.set(rang, {
      couche: mediane(membres.map((node) => (vertical ? node.y : node.x))),
      bout: Math.max(...membres.map((node) => (vertical ? node.x : node.y))),
    })
  }

  // Les couches nouvelles, dans l'ordre des rangs : chacune se cale sur celle d'avant.
  const debutTravers = vide ? 0 : (vertical ? bornes.minX : bornes.minY) - pasTravers
  let apresTout = vide ? -pasCouche : vertical ? bornes.maxY : bornes.maxX
  const nouveaux = [...new Set(rangsAVenir)].filter((rang) => !rangees.has(rang)).sort((a, b) => a - b)
  for (const rang of nouveaux) {
    const connus = [...rangees.keys()].sort((a, b) => a - b)
    const avant = connus.filter((autre) => autre < rang).pop()
    const apres = connus.find((autre) => autre > rang)
    const coucheAvant = avant === undefined ? undefined : rangees.get(avant)?.couche
    const coucheApres = apres === undefined ? undefined : rangees.get(apres)?.couche
    let couche: number
    if (coucheAvant !== undefined && coucheApres !== undefined) {
      // Entre deux couches, s'il y a la place d'une rangée ; sinon après tout le reste.
      couche =
        coucheApres - coucheAvant >= pasCouche * 1.6
          ? Math.round((coucheAvant + coucheApres) / 2)
          : (apresTout += pasCouche)
    } else if (coucheAvant !== undefined) couche = coucheAvant + pasCouche
    else if (coucheApres !== undefined) couche = coucheApres - pasCouche
    else couche = apresTout += pasCouche
    apresTout = Math.max(apresTout, couche)
    rangees.set(rang, { couche, bout: debutTravers })
  }

  const occupes = existants.map((node) => ({ x: node.x, y: node.y }))
  const prise = (x: number, y: number) =>
    occupes.some((point) => Math.abs(point.x - x) < NODE_W * 0.8 && Math.abs(point.y - y) < NODE_H * 1.2)

  return (rang) => {
    const rangee = rangees.get(rang) ?? { couche: (apresTout += pasCouche), bout: debutTravers }
    rangees.set(rang, rangee)
    let travers = rangee.bout + pasTravers
    const ici = () => (vertical ? { x: travers, y: rangee.couche } : { x: rangee.couche, y: travers })
    for (let essai = 0; essai < 80 && prise(ici().x, ici().y); essai += 1) travers += pasTravers
    rangee.bout = travers
    const position = { x: Math.round(ici().x), y: Math.round(ici().y) }
    occupes.push(position)
    return position
  }
}

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
