/** Modèle de données d'un schéma d'infrastructure réseau. */

/**
 * Identifiant de type d'équipement (« firewall », « k8s-cluster », un type maison…).
 * Volontairement une chaîne libre et non une énumération figée : le catalogue est
 * extensible par fichier de données, sans recompiler l'application.
 */
export type DeviceKind = string

export type LinkKind =
  | 'ethernet'
  | 'fiber'
  | 'trunk'
  | 'wan'
  | 'vpn'
  | 'wireless'
  | 'overlay'
  | 'heartbeat'
  | 'stack'
  | 'replication'
  | 'oob'
  | 'power'

/** Statut d'un actif, au sens d'un inventaire de parc. */
export type AssetStatus = 'production' | 'stock' | 'maintenance' | 'retire'

/** Couches du modèle OSI documentées par l'application. */
export type OsiLayer = 'l1' | 'l2' | 'l3'

/** Vue OSI courante : toutes les couches, ou une seule mise en avant. */
export type OsiView = 'all' | 'l1' | 'l2' | 'l3'

/** Mode d'un port de commutation. */
export type PortMode = 'access' | 'trunk'

/** Rôle spanning-tree d'un lien, tel qu'on le documente sur un schéma de niveau 2. */
export type StpRole = 'root' | 'designated' | 'alternate' | 'blocking' | 'edge'

export type RoutingProtocol = 'static' | 'ospf' | 'bgp' | 'eigrp' | 'is-is' | 'rip'

/**
 * Rôle d'un équipement au sein d'une grappe haute disponibilité.
 * `witness` désigne le témoin / quorum qui départage une grappe à deux nœuds.
 */
export type HaRole = 'standalone' | 'active' | 'passive' | 'active-active' | 'witness'

/**
 * Un équipement. `x`/`y` désignent le CENTRE de la boîte, en coordonnées « diagramme »
 * (indépendantes du zoom et du déplacement de la vue).
 */
export interface NetNode {
  id: string
  kind: DeviceKind
  name: string
  model?: string
  ip?: string
  vlan?: string
  /** Zone logique (DMZ, LAN siège, agence…) : sert au regroupement et au cadre en pointillés. */
  zone?: string
  /** Site physique (siège, site de secours, datacenter opérateur…). */
  site?: string
  /** Nom de la grappe HA à laquelle l'équipement appartient (FW-CLUSTER, CORE-MLAG…). */
  cluster?: string
  /** Rôle dans la grappe : actif, passif, actif/actif, témoin de quorum. */
  role?: HaRole
  /** Adresse virtuelle portée par la grappe (VRRP / HSRP / VIP de répartiteur). */
  vip?: string
  /**
   * Mécanisme de haute disponibilité mis en œuvre (voir `haTech.ts`) : « FGCP », « vPC »,
   * « vSphere HA »…
   *
   * Deux pare-feu « en grappe » ne disent rien de la façon dont ils basculent ; le
   * mécanisme, lui, dit ce qui est protégé, ce qui ne l'est pas, ce qu'il faut câbler et
   * combien de temps dure la bascule.
   */
  haTech?: string
  /** Double alimentation électrique (deux chaînes A/B). */
  dualPower?: boolean

  // ─── Inventaire ───────────────────────────────────────────────────────────
  /** Numéro de série constructeur. */
  serial?: string
  /** Constructeur / fournisseur. */
  vendor?: string
  /** Numéro d'immobilisation ou code interne. */
  assetTag?: string
  /** Date d'achat (AAAA-MM-JJ). */
  purchaseDate?: string
  /** Fin de garantie ou de contrat de support (AAAA-MM-JJ). */
  warrantyEnd?: string
  status?: AssetStatus
  /** Service ou personne responsable. */
  owner?: string

  // ─── Implantation physique ────────────────────────────────────────────────
  /** Identifiant de la baie qui héberge l'équipement. */
  rack?: string
  /** Position dans la baie : U de départ, 1 = unité la plus basse. */
  rackUnit?: number
  /** Hauteur occupée, en U (1 par défaut). */
  heightU?: number
  /** Puissance consommée, en watts. */
  powerW?: number
  notes?: string
  x: number
  y: number
  /** Un équipement épinglé n'est jamais déplacé par le placement automatique. */
  pinned?: boolean
  /** Couche forcée ; sinon la couche par défaut du type d'équipement est utilisée. */
  rank?: number | null
}

export interface NetLink {
  id: string
  from: string
  to: string
  kind: LinkKind
  label?: string
  speed?: string
  /** Liaison redondante / secours : tracée en pointillés. */
  redundant?: boolean

  // ─── Tracé ────────────────────────────────────────────────────────────────
  /** Points de passage imposés à la main ; vide = tracé automatique. */
  waypoints?: Waypoint[]
  /** Forme du tracé pour cette liaison seulement. */
  shape?: LinkShape
  /** Côté d'accroche au départ. */
  anchorA?: AnchorSide
  /** Côté d'accroche à l'arrivée. */
  anchorB?: AnchorSide
  /** Point d'accroche libre au départ — prioritaire sur le côté. */
  attachA?: Attach
  /** Point d'accroche libre à l'arrivée. */
  attachB?: Attach
  /** Étiquette du milieu déplacée à la main. */
  labelOffset?: LabelOffset
  /** Étiquette de l'extrémité de départ déplacée à la main. */
  labelOffsetA?: LabelOffset
  /** Étiquette de l'extrémité d'arrivée déplacée à la main. */
  labelOffsetB?: LabelOffset

  /**
   * Couches OSI documentées pour cette liaison. Absent = couches par défaut du type de
   * liaison (un câble cuivre porte L1 et L2, un tunnel VPN porte L3…).
   */
  layers?: OsiLayer[]

  // ─── Couche 1 : physique ──────────────────────────────────────────────────
  /** Interface côté départ (Gi1/0/1, xe-0/0/3…). */
  portA?: string
  /** Interface côté arrivée. */
  portB?: string

  // ─── Couche 2 : liaison ───────────────────────────────────────────────────
  /** VLAN transportés : « 20 » en accès, « 10,20,30-39 » en trunk. */
  vlans?: string
  mode?: PortMode
  /** VLAN natif d'un trunk (non étiqueté). */
  nativeVlan?: string
  /** Agrégat de liens : nom du port-channel / bundle LACP. */
  lag?: string
  /**
   * Protocole de négociation de l'agrégat, au sens 802.1AX : LACP actif, LACP passif, ou
   * statique (mode « on »). Deux extrémités passives ne forment jamais le bundle, et un
   * agrégat statique ne détecte pas un brin resté physiquement allumé mais muet.
   */
  lacp?: 'active' | 'passive' | 'static'
  stp?: StpRole

  /**
   * Configuration propre à chaque extrémité.
   *
   * Un câble relie deux équipements qui ne sont pas configurés pareil : le rôle
   * spanning-tree diffère presque toujours (racine d'un côté, désigné de l'autre), le nom du
   * port-channel est local à chaque châssis, et un trunk peut n'autoriser qu'un
   * sous-ensemble de VLAN d'un côté. Vide = la valeur commune ci-dessus s'applique.
   */
  modeA?: PortMode
  modeB?: PortMode
  vlansA?: string
  vlansB?: string
  nativeVlanA?: string
  nativeVlanB?: string
  stpA?: StpRole
  stpB?: StpRole
  lagA?: string
  lagB?: string
  /** MTU de la liaison (1500, 9000 pour le jumbo…). */
  mtu?: number

  // ─── Couche 3 : réseau ────────────────────────────────────────────────────
  /** Sous-réseau de la liaison, en notation CIDR (10.0.0.0/30). */
  subnet?: string
  /** Adresse de l'extrémité de départ. */
  ipA?: string
  /** Adresse de l'extrémité d'arrivée. */
  ipB?: string
  vrf?: string
  routing?: RoutingProtocol
}

/**
 * Un VLAN et, quand il est routé, le sous-réseau et la passerelle qui vont avec :
 * c'est la table qui fait le lien entre le schéma de niveau 2 et celui de niveau 3.
 */
export interface VlanDef {
  /** Identifiant 802.1Q (1–4094), gardé en chaîne pour accepter les saisies libres. */
  id: string
  name?: string
  /** Sous-réseau en notation CIDR. */
  subnet?: string
  gateway?: string
  /** Couleur d'affichage ; attribuée automatiquement si absente. */
  color?: string
  notes?: string
}

/**
 * Annotation posée sur le plan : ce que le schéma ne dit pas tout seul.
 *
 * Un schéma réseau se commente — « migration prévue T3 », « lien opérateur en cours de
 * commande », « ne pas rebrancher sans le prestataire ». Ces notes appartiennent au
 * document et non à un équipement : elles survivent au déplacement des boîtes et partent
 * dans les exports.
 */
export type AnnotationKind = 'note' | 'zone' | 'arrow'

export interface Annotation {
  id: string
  kind: AnnotationKind
  text?: string
  /** Coin haut-gauche (note, zone) ou point de départ (flèche). */
  x: number
  y: number
  /** Taille du cadre (note, zone) ou vecteur vers la pointe (flèche). */
  w: number
  h: number
  /** Couleur d'accent ; une couleur neutre par défaut. */
  color?: string
}

/**
 * Cartouche du document, au sens du dessin technique : qui a produit ce schéma, quand, dans
 * quelle version, et jusqu'où il peut circuler. Un schéma d'infrastructure qui sort d'une
 * équipe sans indice de révision ni mention de diffusion est un schéma que personne n'ose
 * utiliser.
 */
export interface TitleBlock {
  /** Cartouche affiché sur le plan et dans les exports. */
  show?: boolean
  organisation?: string
  author?: string
  /** Référence du document (DOC-RES-001, ticket, affaire…). */
  reference?: string
  /** Indice de révision (A, B, 1.2…). */
  version?: string
  /** Date d'établissement ou de dernière révision (AAAA-MM-JJ). */
  date?: string
  /** État du document : brouillon, pour revue, validé. */
  status?: string
  /** Mention de diffusion : interne, confidentiel, diffusion restreinte. */
  confidentiality?: string
  notes?: string
}

/** Décision appliquée à un flux dans la matrice. */
export type FlowAction = 'autorise' | 'refuse' | 'etudier'

/**
 * Une ligne de matrice de flux : qui parle à qui, avec quel service, et pourquoi.
 *
 * C'est la pièce qui accompagne tout schéma réseau sérieux — celle que réclament la revue
 * de sécurité, l'homologation et l'exploitation du pare-feu. Elle est tenue ici, à côté du
 * schéma qui la justifie, plutôt que dans un tableur qui diverge au bout de trois mois.
 */
export interface FlowDef {
  id: string
  /** Source : nom de zone, de site ou d'équipement du schéma. */
  from: string
  /** Destination, même principe. */
  to: string
  /** Service applicatif : HTTPS, SSH, SMB, LDAPS… */
  service?: string
  /** Transport et ports : « TCP 443 », « UDP 514 », « ICMP ». */
  protocol?: string
  action?: FlowAction
  /** Justification métier : ce qui sera demandé en revue. */
  purpose?: string
  /** Demandeur ou responsable du flux. */
  owner?: string
  /** Protection du flux : TLS 1.3, IPsec, aucun… */
  encryption?: string
  notes?: string
}

/** Une baie informatique, décrite comme dans un inventaire de parc. */
export interface RackDef {
  id: string
  name: string
  site?: string
  /** Local technique / salle. */
  room?: string
  /** Hauteur utile en U (42 par défaut). */
  units: number
  notes?: string
}

export interface Diagram {
  /** Titre du document. Toutes les pages d'un même document le partagent. */
  title: string
  /**
   * Nom de l'onglet. Une page reste un schéma complet : exportée seule, elle s'ouvre comme
   * n'importe quel autre fichier NetSchema.
   */
  pageName?: string
  nodes: NetNode[]
  links: NetLink[]
  /** Plan d'adressage : VLAN, sous-réseaux et passerelles. */
  vlans?: VlanDef[]
  /** Baies et locaux techniques. */
  racks?: RackDef[]
  /** Notes, cadres et flèches posés sur le plan. */
  annotations?: Annotation[]
  /** Matrice de flux : ce qui a le droit de parler à quoi. */
  flows?: FlowDef[]
  /** Cartouche : auteur, indice de révision, diffusion. */
  titleBlock?: TitleBlock
  /**
   * Schéma verrouillé : lecture seule. Les verrous appartiennent au document — un schéma
   * validé le reste pour qui l'ouvre, sur un autre poste comme après un export/import.
   */
  locked?: boolean
  /** Étiquettes de liaison figées à leur place actuelle. */
  labelsLocked?: boolean
  /**
   * Noms de couches propres au schéma, par rang : « Périmètre » devient « DMZ », « Accès »
   * devient « Étage 2 ». Absent = le nom par défaut de la couche.
   */
  layerNames?: Record<string, string>
  /**
   * Marge supplémentaire du cadre d'une couche, en pixels. Le cadre se dessine autour des
   * équipements de la couche ; cette marge permet de l'agrandir ou de le resserrer à la main.
   */
  layerPads?: Record<string, number>
}

/**
 * Document : une ou plusieurs pages, comme les onglets d'un classeur.
 *
 * Un même dossier réseau demande rarement un seul schéma — le siège, une agence, la vue
 * logique, la vue physique, l'avant et l'après d'une migration. Les garder dans un même
 * document évite de jongler avec cinq fichiers qui divergent.
 */
export interface Classeur {
  title: string
  pages: Diagram[]
  /** Index de la page ouverte à la réouverture du document. */
  activePage?: number
}

/** Module affiché : schéma, inventaire, baies, flux, découverte ou guide. */
export type AppView =
  | 'diagram'
  | 'inventory'
  | 'racks'
  | 'flows'
  | 'discovery'
  | 'dossier'
  | 'guide'

export type LayoutDirection = 'TB' | 'LR'

export interface LayoutOptions {
  /** TB = couches empilées de haut en bas, LR = de gauche à droite. */
  direction: LayoutDirection
  /** Espacement entre deux équipements d'une même couche. */
  nodeGap: number
  /** Espacement entre deux couches. */
  layerGap: number
  /** Regroupe les équipements d'une même zone côte à côte dans leur couche. */
  groupByZone: boolean
  /** Regroupe d'abord par site physique (siège, site de secours…). */
  groupBySite: boolean
}

export type LinkStyle = 'orthogonal' | 'straight'

/** Tracé d'une liaison : par défaut celui du schéma, ou imposé liaison par liaison. */
export type LinkShape = 'auto' | 'orthogonal' | 'straight' | 'curved'

/** Côté d'accroche d'une liaison sur un équipement. */
export type AnchorSide = 'auto' | 'top' | 'bottom' | 'left' | 'right'

/**
 * Point d'accroche libre sur la boîte d'un équipement.
 *
 * Exprimé en fraction de la taille de la boîte (-0,5 à 0,5 depuis son centre) : l'accroche
 * suit ainsi l'équipement quand on le déplace, et reste juste si la boîte change de taille.
 */
export interface Attach {
  dx: number
  dy: number
}

/**
 * Étiquette déplacée à la main : décalage, en coordonnées du schéma, depuis le point du
 * tracé auquel elle se rattache. Le décalage suit donc la liaison quand elle bouge.
 */
export interface LabelOffset {
  dx: number
  dy: number
}

/** Mode de visualisation : même schéma, trois lectures. */
export type ViewMode = 'architecture' | 'technique' | 'presentation' | 'logique'

/** Déplacement d'un équipement dans l'ordre d'empilement. */
export type ZOrder = 'front' | 'back' | 'forward' | 'backward'

/** Point de passage manuel d'une liaison, en coordonnées du schéma. */
export interface Waypoint {
  x: number
  y: number
}

/** Niveau de détail d'affichage, pour dégrossir un schéma complexe. */
export type DetailLevel = 'full' | 'no-endpoints' | 'summary'

export const NODE_W = 148
export const NODE_H = 64
