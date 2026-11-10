import type {
  AppView,
  AssetStatus,
  DetailLevel,
  HaRole,
  LayoutDirection,
  LinkKind,
  LinkShape,
  LinkStyle,
  OsiView,
  ViewMode,
  ZOrder,
} from '../types'

/**
 * Socle de la commande vocale : les intentions, et les quelques outils que toutes les
 * règles partagent.
 *
 * Il est à part pour une raison pratique : les règles se répartissent maintenant sur deux
 * fichiers — les tournures d'origine dans `voice.ts`, la langue parlée dans `voiceParle.ts` —
 * et deux fichiers qui s'importent l'un l'autre finissent toujours par casser au chargement.
 * Tout ce dont les deux ont besoin vit donc ici, et ni l'un ni l'autre n'importe son voisin.
 */

/** Champs d'équipement modifiables à la voix. */
export type NodeField =
  | 'ip'
  | 'vlan'
  | 'zone'
  | 'site'
  | 'cluster'
  | 'owner'
  | 'serial'
  | 'model'
  | 'vip'
  | 'notes'
  | 'rackUnit'
  | 'heightU'
  | 'powerW'

export type VoiceIntent =
  // Édition
  | {
      type: 'add'
      kind: string
      label: string
      /** Nom dicté : « ajoute un switch cœur SW-CORE-03 ». */
      name?: string
      /** Le nom reprend la phrase (« Serveur web ») : un homonyme se numérote, il ne se refuse pas. */
      descriptif?: boolean
      /** Attributs dictés dans la même phrase (IP, zone, site, grappe, VLAN…). */
      props?: Partial<Record<NodeField, string>>
      /** Baie d'implantation dictée. */
      rack?: string
      /** Équipement auquel raccorder le nouvel arrivant. */
      connectTo?: string
      /** Position dictée par rapport à un équipement : « sous SW-CORE-01 ». */
      near?: { target: string; side: 'below' | 'above' | 'left' | 'right' }
    }
  /*
    Construire plusieurs équipements d'une phrase : « ajoute deux switchs cœur », « un
    routeur, un pare-feu et deux cœurs », « un cœur redondé ». La description part telle
    quelle à l'assistant de conception, qui sait compter, nommer et raccorder.
  */
  | { type: 'build'; description: string; raccorder: boolean; /** Architecture de départ demandée par son nom. */ modele?: string }
  | { type: 'setKind'; target: string; kind: string; label: string }
  | { type: 'move'; target: string; direction: 'left' | 'right' | 'up' | 'down'; amount: number }
  | {
      type: 'linkEdit'
      /** Extrémités ; vides quand on parle de « cette liaison », celle du contexte. */
      from: string
      to: string
      patch: LinkPatch
      /** Tous les brins entre les deux équipements, et non le premier : « agrège les liens ». */
      tous?: boolean
      /** Port dicté, avec l'équipement qui le porte : c'est lui qui décide du bon côté. */
      port?: { device: string; name: string }
    }
  | { type: 'linkDelete'; from: string; to: string }
  | { type: 'selectKind'; kind: string; label: string }
  | {
      type: 'link'
      from: string
      to: string
      linkKind?: LinkKind
      speed?: string
      /** Second brin : la liaison est créée même s'il en existe déjà une entre les deux. */
      extra?: boolean
      /** « relie-les entre eux » : les équipements désignés se relient deux à deux. */
      mutual?: boolean
    }
  | { type: 'rename'; target: string; name: string }
  | { type: 'setField'; target: string; field: NodeField; value: string }
  | { type: 'setRole'; target: string; role: HaRole }
  | { type: 'setStatus'; target: string; status: AssetStatus }
  | { type: 'setPinned'; target?: string; pinned: boolean }
  | { type: 'zorder'; target?: string; where: ZOrder }
  | { type: 'linkAttach'; target?: string; reset: true }
  | { type: 'lock'; what: 'diagram' | 'labels'; locked: boolean }
  | {
      type: 'impact'
      action: 'fail' | 'unplug' | 'reset' | 'open'
      target?: string
      to?: string
    }
  | {
      type: 'groupRename'
      what: 'site' | 'zone' | 'cluster' | 'layer'
      from: string
      to: string
    }
  | {
      type: 'page'
      action: 'add' | 'select' | 'next' | 'previous' | 'rename' | 'remove' | 'duplicate'
      /** Nom de la page visée, ou nouveau nom pour un renommage. */
      name?: string
      /** Numéro de page, à partir de 1. */
      number?: number
    }
  | { type: 'duplicate'; target?: string; copies?: number }
  /** Retirer des lignes de la matrice de flux : la dernière, toutes, ou celles d'un couple. */
  | { type: 'flowRemove'; which?: 'last' | 'all'; from?: string; to?: string; service?: string }
  /** Réécrire le texte de la dernière note posée sur le plan. */
  | { type: 'annotationEdit'; text: string }
  /** Suivre ou non les VLAN le long des trunks dans les vues logiques. */
  | { type: 'vlanPropagation'; on: boolean }
  /** Déplacer la page ouverte d'un rang parmi les onglets. */
  | { type: 'pageMove'; direction: -1 | 1 }
  /**
   * Reprendre sur la page des équipements enregistrés sur les autres pages du document.
   * Sans cible, le dialogue de choix s'ouvre.
   */
  | { type: 'reprise'; cible?: string }
  /** Une page neuve faite des équipements sélectionnés, avec les liaisons tracées entre eux. */
  | { type: 'pageDepuisSelection'; name?: string }
  /** Renommer une baie ou changer sa hauteur utile. */
  | { type: 'rackEdit'; rack: string; name?: string; units?: number }
  | { type: 'duplicateSeries' }
  | { type: 'clipboard'; action: 'copy' | 'cut' | 'paste' }
  | { type: 'delete'; target?: string; all?: boolean }
  | { type: 'selectAll' }
  | { type: 'clearSelection' }
  | { type: 'connect' }
  | { type: 'pattern'; query: string }
  // Navigation et lecture
  | { type: 'focus'; name: string }
  | { type: 'layout' }
  | { type: 'fit' }
  | { type: 'zoom'; direction: 'in' | 'out' }
  | { type: 'undo'; times?: number }
  | { type: 'redo' }
  | { type: 'osi'; layer: OsiView }
  | { type: 'detail'; level: DetailLevel }
  | { type: 'view'; view: AppView }
  | { type: 'assistant' }
  | { type: 'viewMode'; mode: ViewMode }
  | { type: 'vueLogique'; vue: 'routage' | 'rails' | 'domaines' }
  | { type: 'vlanFocus'; id: string | null }
  | { type: 'collapse'; label?: string }
  | { type: 'expand' }
  | { type: 'direction'; direction: LayoutDirection }
  | { type: 'linkStyle'; style: LinkStyle }
  | { type: 'route'; shape: LinkShape }
  | { type: 'toggle'; key: ToggleKey; value: boolean }
  // Déductions : l'application sait lire le schéma pour en tirer ce qu'on y a mis sans le
  // dire. Deux commandes, un travail d'une demi-heure à la main.
  | { type: 'deduireHa' }
  | { type: 'deduireVlans' }
  // Mise en page d'une sélection
  | { type: 'align'; mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' }
  | { type: 'distribute'; axis: 'x' | 'y' }
  // Grappes, agrégats, baies, plan d'adressage
  | { type: 'clusterColor'; cluster: string; couleur: string; libelle: string }
  | { type: 'vlanRemove'; id: string }
  | { type: 'rackAdd'; name: string; units?: number }
  | { type: 'rackRemove'; name: string }
  | { type: 'lagRename'; nom: string }
  | { type: 'lagHidden'; hidden: boolean }
  | { type: 'strictOsi'; strict: boolean }
  | { type: 'titleBlock'; champ: 'reference' | 'indice' | 'auteur' | 'organisation' | 'diffusion'; valeur: string }
  | { type: 'annotate'; kind: 'note' | 'zone' | 'arrow'; text?: string }
  // Projet
  | { type: 'export'; format: 'svg' | 'png' }
  | { type: 'project'; action: 'new' | 'sample' | 'save' }
  | { type: 'title'; title: string }
  | { type: 'import' }
  // Inventaire et baies
  | { type: 'rackAssign'; target: string; rack: string }
  | { type: 'rackDetach'; target: string }
  | { type: 'vlanAdd'; id: string; name?: string; subnet?: string }
  // Dicter du texte
  | {
      type: 'note'
      /** Équipement visé. Absent quand le nom et le texte arrivent d'un seul tenant. */
      target?: string
      text: string
      /** « ajoute à la note » : le texte s'ajoute au lieu de remplacer. */
      append: boolean
      /** Nom et texte non séparés : l'exécution cherche où finit le nom. */
      libre?: string
    }
  | { type: 'dictation'; action: 'start' | 'stop'; target?: string }
  | { type: 'annotationRemove'; which: 'last' | 'all' }
  // Réponse à une demande de confirmation
  | { type: 'confirm'; yes: boolean }
  // Ce que la voix n'atteignait pas
  | {
      type: 'flow'
      from: string
      to: string
      service?: string
      decision: 'autorise' | 'refuse'
    }
  | { type: 'panel'; panel: 'palette' | 'inspecteur' | 'minicarte'; open: boolean }
  | { type: 'path'; from: string; to: string }
  | { type: 'blink'; seconds: number }
  // Questions
  | { type: 'query'; question: QueryKind; argument?: string }
  | { type: 'help' }

/** Modifications applicables à une liaison désignée à la voix. */
export interface LinkPatch {
  kind?: LinkKind
  speed?: string
  label?: string
  redundant?: boolean
  vlans?: string
  subnet?: string
  mode?: 'access' | 'trunk'
  /** Nom d'agrégat : « Po1 ». */
  lag?: string
}

export type ToggleKey =
  | 'showGrid'
  | 'showZones'
  | 'showSites'
  | 'showClusters'
  | 'showIp'
  | 'showVlans'
  | 'showSpeeds'
  | 'showLayerLabels'
  | 'showAudit'
  | 'showHops'
  | 'spreadLinks'
  | 'snap'
  | 'showLegend'
  | 'showLags'

export type QueryKind = 'count' | 'countKind' | 'ha' | 'spof' | 'power' | 'freeUnits' | 'vlans' | 'racks'

/**
 * Normalisation d'une phrase dictée : sans accents, en minuscules, ponctuation de phrase
 * retirée. Les points entre chiffres sont conservés — sans quoi « 10.0.0.9 » deviendrait
 * « 10 0 0 9 ». Chaque remplacement garde la longueur du texte, ce qui permet de retrouver
 * la casse d'origine par simple index.
 */
export function normalizeSpeech(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[?!,;]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}


export const LINK_WORDS: Record<string, LinkKind> = {
  cuivre: 'ethernet',
  ethernet: 'ethernet',
  fibre: 'fiber',
  optique: 'fiber',
  trunk: 'trunk',
  lacp: 'trunk',
  agregat: 'trunk',
  stack: 'stack',
  mlag: 'stack',
  wan: 'wan',
  mpls: 'wan',
  vpn: 'vpn',
  tunnel: 'vpn',
  wifi: 'wireless',
  'sans fil': 'wireless',
  overlay: 'overlay',
  vxlan: 'overlay',
  heartbeat: 'heartbeat',
  'battement de coeur': 'heartbeat',
  replication: 'replication',
  electrique: 'power',
  alimentation: 'power',
}


/** Nettoie un nom dicté : « le switch cœur un » reste tel quel, la ponctuation part. */
export function cleanName(value: string): string {
  return value
    .replace(/^(le|la|les|l'|du|de la|des|un|une)\s+/i, '')
    .replace(/\s+(s'?il te plait|merci)$/i, '')
    .trim()
}


export type Rule = (text: string, raw: string) => VoiceIntent | null | undefined


/**
 * Récupère une valeur avec sa casse d'origine.
 *
 * Les règles travaillent sur le texte normalisé (sans accents ni majuscules) ; pour tout ce
 * qui sera écrit dans la fiche — un nom, un titre, une adresse — on relit la phrase brute
 * avec le même motif, insensible à la casse. Les mots-clés du motif sont sans accent, ils
 * correspondent donc des deux côtés.
 */
export function rawValue(raw: string, pattern: RegExp, group: number, fallback: string): string {
  const match = raw.match(pattern)
  const value = match?.[group]?.trim()
  return value ? cleanName(value) : fallback
}

