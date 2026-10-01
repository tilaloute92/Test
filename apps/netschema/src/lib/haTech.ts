/**
 * Mécanismes de haute disponibilité, par type d'équipement et par constructeur.
 *
 * « Deux pare-feu en grappe » ne veut rien dire tant qu'on n'a pas dit lequel : un FGCP
 * Fortinet, un ClusterXL Check Point et un chassis cluster Juniper ne se câblent pas
 * pareil, ne basculent pas en même temps et ne tombent pas pour les mêmes raisons. Un
 * empilement Cisco et une paire VSX Aruba se ressemblent sur un schéma et n'ont rien à voir
 * en exploitation : le premier n'a qu'un plan de contrôle — une mise à jour logicielle
 * emporte les deux châssis — le second en a deux.
 *
 * Cette base sert à trois choses :
 *
 * 1. **proposer** le bon mécanisme d'après le constructeur, le type d'équipement et le type
 *    de lien déjà tracé entre les membres ;
 * 2. **contrôler** ce qui est déclaré : nombre de membres, lien de synchronisation attendu,
 *    témoin obligatoire, adresse virtuelle, rôles cohérents, mécanisme possible chez ce
 *    constructeur ;
 * 3. **documenter** : ce que le mécanisme implique réellement se retrouve dans l'info-bulle,
 *    dans l'analyse et dans le dossier technique.
 *
 * Les temps de bascule sont des ordres de grandeur admis, pas des engagements : ils
 * dépendent de la version logicielle, de la charge et du dimensionnement.
 */

import { vendorMark } from './vendorMarks'
import type { HaRole, LinkKind } from '../types'

export type FamilleHa =
  | 'chassis'
  | 'paire-l2'
  | 'passerelle'
  | 'pare-feu'
  | 'repartiteur'
  | 'calcul'
  | 'stockage'
  | 'sans-fil'
  | 'services'
  | 'wan'
  | 'energie'

export const FAMILLES_HA: Record<FamilleHa, string> = {
  chassis: 'Châssis virtuel / empilement',
  'paire-l2': 'Paire de châssis (niveau 2)',
  passerelle: 'Passerelle redondée (niveau 3)',
  'pare-feu': 'Grappe de pare-feu',
  repartiteur: 'Répartiteur de charge',
  calcul: 'Calcul et virtualisation',
  stockage: 'Stockage et données',
  'sans-fil': 'Contrôleurs Wi-Fi',
  services: 'Services réseau et applicatifs',
  wan: 'Accès opérateur et WAN',
  energie: 'Énergie',
}

/**
 * Qui traite le trafic en régime normal — l'axe que les rôles « actif » et « passif » ne
 * suffisent pas à décrire.
 *
 * Deux plans cohabitent dans toute grappe : celui qui **décide** (la configuration, les
 * protocoles, l'élection) et celui qui **achemine**. On ne les confond jamais dans un
 * dossier d'exploitation, et pourtant un schéma les confond toujours, parce qu'il n'écrit
 * qu'un rôle par équipement. Un châssis virtuel est « actif / passif » au plan de contrôle
 * et actif / actif au plan de données ; un pare-feu en actif/passif est passif des deux
 * côtés ; un FGCP en actif/actif ne répartit que l'inspection. Les trois se dessinent de la
 * même façon et ne se dimensionnent pas du tout pareil.
 *
 * D'où cet axe, posé une fois pour chaque mécanisme.
 */
export type PlanDeDonnees =
  /** Tous les membres acheminent en permanence. */
  | 'tous'
  /** Un seul achemine ; les autres ne voient passer aucun paquet avant la bascule. */
  | 'un-seul'
  /** Le mécanisme accepte les deux, et c'est la configuration qui tranche. */
  | 'selon-mode'
  /** Le mécanisme ne porte pas de trafic de production (sauvegarde…). */
  | 'sans-objet'

export const PLANS_DE_DONNEES: Record<
  PlanDeDonnees,
  { label: string; court: string; detail: string }
> = {
  tous: {
    label: 'Tous les membres acheminent',
    court: 'plan de données réparti',
    detail:
      "Aucun membre n'est en veille : la charge se répartit en permanence. La perte d'un membre reporte sa part sur les survivants — au-delà de 50 % de charge par membre sur une paire, l'incident sature le rescapé.",
  },
  'un-seul': {
    label: 'Un seul membre achemine',
    court: 'plan de données sur un seul membre',
    detail:
      "Le veilleur ne voit passer aucun paquet avant la bascule. Il doit donc être dimensionné comme l'actif, et sa capacité n'est éprouvée que le jour où elle sert : testez la bascule en charge, pas à vide.",
  },
  'selon-mode': {
    label: 'Selon le mode configuré',
    court: 'plan de données selon le mode',
    detail:
      "Ce mécanisme s'exploite en actif / passif ou en actif / actif, et le choix ne change pas que le dimensionnement : le câblage et les prérequis diffèrent. Déclarez le rôle des membres pour que le schéma le dise.",
  },
  'sans-objet': {
    label: 'Ne porte pas de trafic de production',
    court: 'hors plan de données',
    detail:
      "Ce mécanisme ne maintient pas un service en ligne : il permet de le reconstruire. Il ne se compte pas dans un calcul de disponibilité.",
  },
}

export interface MecanismeHa {
  /** Identifiant stable, enregistré dans le schéma. */
  id: string
  label: string
  famille: FamilleHa
  /** Constructeurs concernés (clés normalisées) ; vide = mécanisme normalisé, tous vendeurs. */
  vendors: string[]
  /** Types d'équipements du catalogue auxquels il s'applique. */
  kinds: string[]
  /** Nombre de membres attendu dans la grappe. */
  membres: { min: number; max?: number }
  /** Liaison attendue entre les membres, et son nom d'usage. */
  lien?: { kind: LinkKind[]; nom: string }
  /**
   * Autres liaisons du mécanisme.
   *
   * Plusieurs mécanismes n'ont pas un lien mais deux ou trois, de natures différentes :
   * chez Palo Alto, HA1 porte l'élection et la configuration, HA2 les sessions, HA3 les
   * paquets en actif/actif — les confondre sur un schéma, c'est promettre une bascule que
   * le câblage ne permet pas.
   */
  liensComplementaires?: { nom: string; obligatoire?: boolean; role?: string }[]
  /** Conditions à remplir pour que le mécanisme fonctionne (mêmes modèles, même version…). */
  prerequis?: string[]
  /** Ce que le mécanisme ne couvre pas : la question qu'on se pose toujours trop tard. */
  limites?: string[]
  /**
   * Vrai quand les membres ne forment qu'un seul plan de contrôle : la grappe protège du
   * matériel, pas du logiciel. C'est la nuance que le schéma ne montre jamais.
   */
  planDeControleCommun?: boolean
  /**
   * Qui traite le trafic en régime normal.
   *
   * La question se pose pour **tous** les mécanismes, pas seulement pour les châssis
   * virtuels : un FGCP en actif/passif laisse un pare-feu muet, un FGSP les fait travailler
   * les deux, un VRRP n'achemine que par son maître, une paire MLAG commute des deux côtés.
   * Le champ est obligatoire pour qu'aucun mécanisme n'entre dans la base sans y répondre.
   */
  planDeDonnees: PlanDeDonnees
  /** Ce que le plan de données fait de particulier ici : le détail qui change le dimensionnement. */
  noteDonnees?: string
  /** Témoin / quorum externe indispensable. */
  temoin?: boolean
  /** Adresse virtuelle attendue (VRRP, VIP de grappe…). */
  vip?: boolean
  /**
   * Gammes concernées, en expressions régulières testées sur le modèle.
   *
   * Le constructeur ne suffit pas : vPC est un mécanisme Nexus, pas Catalyst, et VSX
   * s'adresse aux CX 8000 et non aux CX 6000. C'est exactement la confusion qu'on retrouve
   * dans les dossiers repris d'une équipe à l'autre.
   */
  gammes?: string[]
  /** Rôles cohérents avec le mécanisme. */
  roles: HaRole[]
  /** Ordre de grandeur de la bascule. */
  bascule: string
  /** Ce qu'un architecte rappellerait en revue. */
  note: string
}

/** Normalisation d'un nom de constructeur : sans accents, en minuscules. */
export function cleConstructeur(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const PARE_FEU = ['firewall', 'ngfw']
const CALCUL = ['hypervisor', 'hci', 'server', 'baremetal']
const STOCKAGE = ['storage', 'nvme-storage', 'object-storage']

export const MECANISMES_HA: MecanismeHa[] = [
  // ── Châssis virtuel et empilement : un seul plan de contrôle ──────────────
  {
    id: 'stackwise',
    label: 'StackWise / StackWise-480 (empilement)',
    famille: 'chassis',
    planDeDonnees: 'tous',
    vendors: ['cisco'],
    kinds: ['switch', 'access-switch', 'core-switch'],
    membres: { min: 2, max: 8 },
    lien: { kind: ['stack'], nom: 'câbles de pile StackWise' },
    planDeControleCommun: true,
    noteDonnees:
      "Tous les membres commutent en permanence : le rôle ne désigne que le porteur du plan de contrôle. Un agrégat réparti sur plusieurs membres utilise les ports de chacun.",
    gammes: ['catalyst (9[23]|29|38)', 'c9[23]\\d\\d'],
    roles: ['active', 'passive', 'standalone'],
    bascule: '< 1 s (SSO) après perte du membre actif',
    note: "L'empilement se voit et s'administre comme un seul switch : une mise à jour logicielle ou un bogue de l'IOS arrête toute la pile. Pour un équipement doublement attaché, préférez deux châssis distincts (StackWise Virtual ou vPC) plutôt qu'une pile.",
  },
  {
    id: 'stackwise-virtual',
    label: 'StackWise Virtual / VSS (châssis virtuel)',
    famille: 'chassis',
    planDeDonnees: 'tous',
    vendors: ['cisco'],
    kinds: ['core-switch', 'switch'],
    membres: { min: 2, max: 2 },
    lien: { kind: ['stack'], nom: 'lien SVL (StackWise Virtual Link)' },
    planDeControleCommun: true,
    noteDonnees:
      "Les deux châssis commutent en permanence : « actif / passif » ne décrit que le plan de contrôle (SSO). Un MEC réparti sur les deux utilise les ports des deux, et le trafic se répartit.",
    vip: true,
    gammes: ['catalyst (9[456])', 'c9[456]\\d\\d', 'catalyst (45|65)00'],
    roles: ['active', 'passive'],
    bascule: '< 1 s avec SSO/NSF',
    prerequis: [
      'Deux châssis de même famille et de même version IOS-XE',
      'Lien SVL redondé sur deux cartes ou deux ports différents',
    ],
    limites: [
      'Un seul plan de contrôle : une mise à jour ou un bogue emporte les deux châssis',
      'La perte du lien SVL provoque un double actif : prévoir le Dual-Active Detection',
    ],
    note: "Deux châssis vus comme un seul : l'agrégat d'un équipement raccordé peut être réparti sur les deux. Le plan de contrôle reste unique — prévoir la mise à jour par ISSU et un second chemin hors du châssis virtuel.",
  },
  {
    id: 'vsf',
    label: 'VSF (Virtual Switching Framework)',
    famille: 'chassis',
    planDeDonnees: 'tous',
    vendors: ['aruba', 'hpe'],
    kinds: ['switch', 'access-switch', 'core-switch'],
    membres: { min: 2, max: 10 },
    lien: { kind: ['stack'], nom: 'liens VSF' },
    planDeControleCommun: true,
    noteDonnees:
      "Les deux membres commutent en permanence : le rôle ne concerne que le plan de contrôle.",
    gammes: ['cx 6[0-9]', '6[12345]00'],
    roles: ['active', 'passive'],
    bascule: '1 à 2 s',
    note: 'Empilement Aruba CX : un seul plan de contrôle. Pour le cœur, VSX est préférable — il garde deux plans de contrôle indépendants.',
  },
  {
    id: 'irf',
    label: 'IRF (Intelligent Resilient Framework)',
    famille: 'chassis',
    planDeDonnees: 'tous',
    vendors: ['hpe', 'h3c'],
    kinds: ['core-switch', 'switch'],
    membres: { min: 2, max: 9 },
    lien: { kind: ['stack'], nom: 'ports IRF' },
    planDeControleCommun: true,
    noteDonnees:
      "Tous les membres commutent en permanence : le rôle ne désigne que le maître du plan de contrôle.",
    gammes: ['comware', 's1[25]', 's5[567]', 's6[89]', 'flexfabric', 'flexnetwork'],
    roles: ['active', 'passive'],
    bascule: '< 1 s',
    note: 'Châssis virtuel Comware. Pensez au MAD (Multi-Active Detection, par LACP ou BFD) : sans lui, la coupure du lien IRF donne deux piles actives avec la même identité.',
  },
  {
    id: 'virtual-chassis',
    label: 'Virtual Chassis',
    famille: 'chassis',
    planDeDonnees: 'tous',
    vendors: ['juniper', 'alcatel-lucent'],
    kinds: ['switch', 'access-switch', 'core-switch'],
    membres: { min: 2, max: 10 },
    lien: { kind: ['stack'], nom: 'ports VCP' },
    planDeControleCommun: true,
    noteDonnees:
      "Tous les membres commutent en permanence : « routing engine » maître et secours ne concernent que le plan de contrôle.",
    gammes: ['ex[234]', 'ex 4', 'omniswitch'],
    roles: ['active', 'passive'],
    bascule: '< 1 s avec NSSU/GRES',
    note: "Un seul Junos pour tout le châssis virtuel : la mise à jour se fait membre par membre (NSSU) ou toute la pile redémarre. Le membre « maître » porte le plan de contrôle.",
  },
  {
    id: 'summitstack',
    label: 'SummitStack',
    famille: 'chassis',
    planDeDonnees: 'tous',
    vendors: ['extreme networks'],
    kinds: ['switch', 'access-switch'],
    membres: { min: 2, max: 8 },
    lien: { kind: ['stack'], nom: 'ports d’empilement' },
    planDeControleCommun: true,
    noteDonnees:
      "Tous les membres commutent en permanence : le rôle ne désigne que le maître de la pile.",
    roles: ['active', 'passive'],
    bascule: '< 2 s',
    note: 'Empilement Extreme : plan de contrôle unique, mise à jour groupée de la pile.',
  },
  {
    id: 'istack-css',
    label: 'iStack / CSS',
    famille: 'chassis',
    planDeDonnees: 'tous',
    vendors: ['huawei'],
    kinds: ['switch', 'access-switch', 'core-switch'],
    membres: { min: 2, max: 9 },
    lien: { kind: ['stack'], nom: 'câbles de pile' },
    planDeControleCommun: true,
    noteDonnees:
      "Tous les membres commutent en permanence : le rôle ne désigne que le porteur du plan de contrôle.",
    roles: ['active', 'passive'],
    bascule: '< 1 s',
    note: 'Empilement Huawei (iStack pour les séries fixes, CSS pour les châssis). Activez la détection de double actif (DAD).',
  },

  // ── Paires de châssis à plans de contrôle distincts ───────────────────────
  {
    id: 'vpc',
    label: 'vPC (virtual PortChannel)',
    famille: 'paire-l2',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux Nexus commutent le trafic de l'agrégat en parallèle. La perte d'un membre reporte tout sur l'autre, et le peer-link doit alors écouler le trafic des ports orphelins : dimensionnez-le pour cela, pas pour la seule synchronisation.",
    vendors: ['cisco'],
    kinds: ['core-switch', 'leaf', 'spine', 'switch', 'access-switch'],
    membres: { min: 2, max: 2 },
    lien: { kind: ['stack', 'trunk'], nom: 'peer-link + peer-keepalive' },
    gammes: ['nexus', 'n[59]k'],
    roles: ['active-active'],
    bascule: 'Sans interruption pour un agrégat réparti (LACP)',
    liensComplementaires: [
      { nom: 'Peer-keepalive sur un chemin distinct du peer-link', obligatoire: true },
    ],
    prerequis: [
      'Même version NX-OS recommandée (mise à jour possible membre par membre)',
      'Domaine vPC, rôle et priorité déclarés des deux côtés',
    ],
    limites: [
      'Deux membres au maximum',
      'Un équipement raccordé à un seul des deux Nexus perd son chemin si ce Nexus tombe',
    ],
    note: "Deux Nexus gardent chacun leur plan de contrôle : une mise à jour se fait équipement par équipement. Le peer-keepalive doit emprunter un chemin distinct du peer-link, sinon la perte du peer-link fige le rôle secondaire.",
  },
  {
    id: 'vsx',
    label: 'VSX (Virtual Switching Extension)',
    famille: 'paire-l2',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux commutateurs acheminent en permanence ; l'ISL reprend le trafic des ports non doublés quand un membre tombe.",
    vendors: ['aruba', 'hpe'],
    kinds: ['core-switch', 'leaf', 'switch', 'access-switch'],
    membres: { min: 2, max: 2 },
    lien: { kind: ['stack', 'trunk'], nom: 'ISL + keepalive' },
    gammes: ['cx (8|9|10)', '8[0-9]00', '9300', '10000'],
    roles: ['active-active'],
    bascule: 'Sans interruption pour un agrégat réparti',
    liensComplementaires: [
      { nom: "Keepalive sur un chemin distinct de l'ISL", obligatoire: true },
    ],
    prerequis: [
      'Deux châssis de la même famille CX',
      'Configuration synchronisée par VSX sync',
    ],
    limites: [
      'Deux membres au maximum',
      'Les objets non synchronisés doivent être déclarés identiques des deux côtés',
    ],
    note: "Deux plans de contrôle et une synchronisation d'état : c'est le mécanisme à préférer à VSF pour un cœur, parce qu'une mise à jour logicielle ne touche qu'un membre à la fois (Live Upgrade).",
  },
  {
    id: 'mlag',
    label: 'MLAG (paire de châssis)',
    famille: 'paire-l2',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux châssis acheminent en parallèle. Le peer-link n'est pas un lien de secours : il porte le trafic des équipements raccordés à un seul côté.",
    vendors: [],
    kinds: ['core-switch', 'leaf', 'switch', 'access-switch'],
    membres: { min: 2, max: 2 },
    lien: { kind: ['stack', 'trunk'], nom: 'peer-link + peer-keepalive' },
    roles: ['active-active'],
    bascule: 'Sans interruption pour un agrégat réparti',
    note: "Terme générique (et nom exact chez Arista, Extreme ou MikroTik) : chaque châssis garde son plan de contrôle. Vérifiez que le peer-keepalive passe par un chemin indépendant du peer-link. Chez Cisco c'est vPC, chez Aruba VSX, chez Dell VLT, chez Juniper MC-LAG.",
  },
  {
    id: 'vlt',
    label: 'VLT (Virtual Link Trunking)',
    famille: 'paire-l2',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux châssis acheminent en parallèle ; le VLTi écoule en plus le trafic orphelin à la perte d'un uplink.",
    vendors: ['dell'],
    kinds: ['core-switch', 'leaf', 'switch', 'access-switch'],
    membres: { min: 2, max: 2 },
    lien: { kind: ['stack', 'trunk'], nom: 'VLTi' },
    roles: ['active-active'],
    bascule: 'Sans interruption pour un agrégat réparti',
    note: 'Équivalent Dell du MLAG, avec deux plans de contrôle. Le VLTi doit être dimensionné pour absorber le trafic orphelin en cas de perte d’un uplink.',
  },
  {
    id: 'mc-lag',
    label: 'MC-LAG (ICCP)',
    famille: 'paire-l2',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux équipements acheminent en parallèle ; ICCP ne porte que l'état.",
    vendors: ['juniper', 'nokia'],
    kinds: ['core-switch', 'leaf', 'switch', 'access-switch'],
    membres: { min: 2, max: 2 },
    lien: { kind: ['stack', 'trunk'], nom: 'ICL + ICCP' },
    roles: ['active-active'],
    bascule: 'Sans interruption pour un agrégat réparti',
    note: 'Deux équipements indépendants synchronisés par ICCP. Sur les fabrics récentes, EVPN multihoming (ESI-LAG) remplace avantageusement MC-LAG.',
  },
  {
    id: 'm-lag',
    label: 'M-LAG (DFS group)',
    famille: 'paire-l2',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux commutateurs acheminent en parallèle ; le peer-link porte l'état et le trafic orphelin.",
    vendors: ['huawei'],
    kinds: ['core-switch', 'leaf', 'switch', 'access-switch'],
    membres: { min: 2, max: 2 },
    lien: { kind: ['stack', 'trunk'], nom: 'peer-link + liaison de détection' },
    roles: ['active-active'],
    bascule: 'Sans interruption pour un agrégat réparti',
    note: 'Paire Huawei à plans de contrôle distincts, arbitrée par un DFS group.',
  },
  {
    id: 'evpn-esi',
    label: 'EVPN multihoming (ESI-LAG)',
    famille: 'paire-l2',
    planDeDonnees: 'tous',
    noteDonnees:
      "Tous les membres de l'ESI acheminent en parallèle, et la répartition se fait par hachage de flux. Sans peer-link, le trafic orphelin passe par la fabric.",
    vendors: [],
    kinds: ['leaf', 'spine', 'core-switch'],
    membres: { min: 2 },
    roles: ['active-active'],
    bascule: 'Convergence BGP, typiquement < 1 s avec BFD',
    note: "Multihoming normalisé par EVPN : pas de peer-link propriétaire, la synchronisation passe par BGP. C'est la solution à privilégier sur une fabric VXLAN neuve — elle accepte plus de deux membres.",
  },

  // ── Passerelles de niveau 3 ───────────────────────────────────────────────
  {
    id: 'vrrp',
    label: 'VRRP (RFC 5798)',
    famille: 'passerelle',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Un seul routeur achemine par groupe VRRP : le veilleur ne voit passer aucun paquet. On répartit en alternant le maître d'un VLAN à l'autre — il reste alors un seul actif par VLAN, et chacun doit pouvoir porter les deux.",
    vendors: [],
    kinds: ['router', 'core-switch', 'switch', 'firewall', 'ngfw', 'loadbalancer'],
    membres: { min: 2 },
    vip: true,
    roles: ['active', 'passive'],
    bascule: '1 à 3 s (3 annonces manquées), < 1 s avec BFD',
    prerequis: [
      'Même identifiant de groupe (VRID) et même adresse virtuelle des deux côtés',
      'Priorité et préemption documentées',
    ],
    limites: [
      "Protège la passerelle, pas le chemin au-delà : à compléter par un suivi d'interface ou de route",
      'Ne synchronise aucune session : un pare-feu en VRRP seul coupe les connexions à la bascule',
    ],
    note: "Standard et interopérable entre constructeurs. La priorité et le « preempt » décident du maître : documentez-les, faute de quoi la bascule inverse ne se fait pas là où on l'attend.",
  },
  {
    id: 'hsrp',
    label: 'HSRP',
    famille: 'passerelle',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Un seul routeur achemine par groupe HSRP. Répartir suppose plusieurs groupes avec des priorités croisées, chaque routeur devant absorber la totalité si l'autre tombe.",
    vendors: ['cisco'],
    kinds: ['router', 'core-switch', 'switch'],
    membres: { min: 2 },
    vip: true,
    roles: ['active', 'passive'],
    bascule: '3 à 10 s par défaut, < 1 s avec des minuteurs courts ou BFD',
    note: "Propriétaire Cisco. Les minuteurs par défaut (hello 3 s, hold 10 s) sont longs pour de la téléphonie ou du stockage : abaissez-les ou utilisez BFD, et suivez l'état HSRP en supervision.",
  },
  {
    id: 'glbp',
    label: 'GLBP',
    famille: 'passerelle',
    planDeDonnees: 'tous',
    noteDonnees:
      "Plusieurs passerelles répondent en parallèle, chacune pour une part des clients. La répartition suit la distribution des MAC virtuelles, pas la charge réelle : elle est approximative.",
    vendors: ['cisco'],
    kinds: ['router', 'core-switch'],
    membres: { min: 2, max: 4 },
    vip: true,
    roles: ['active-active'],
    bascule: '3 à 10 s',
    note: 'Répartit la charge entre plusieurs passerelles par distribution de MAC virtuelles. Moins utilisé aujourd’hui que VRRP/HSRP associés à une paire MLAG.',
  },
  {
    id: 'anycast-gateway',
    label: 'Passerelle anycast distribuée (EVPN)',
    famille: 'passerelle',
    planDeDonnees: 'tous',
    noteDonnees:
      "Chaque leaf route localement pour ses propres clients : il n'y a pas de passerelle centrale à saturer, et rien à basculer.",
    vendors: [],
    kinds: ['leaf', 'core-switch', 'spine'],
    membres: { min: 2 },
    vip: true,
    roles: ['active-active'],
    bascule: 'Aucune : la passerelle existe sur chaque leaf',
    note: "Tous les leafs portent la même adresse et la même MAC de passerelle : il n'y a plus de bascule à attendre. C'est la référence sur une fabric VXLAN/EVPN.",
  },

  // ── Pare-feu ──────────────────────────────────────────────────────────────
  {
    id: 'fgcp',
    label: 'FGCP (FortiGate Clustering Protocol)',
    famille: 'pare-feu',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "En actif/passif le veilleur ne traite aucun paquet. En actif/actif, le maître reçoit tout le trafic et ne délègue que l'inspection aux secondaires : le débit de session ne se répartit pas, seule la charge d'analyse le fait.",
    vendors: ['fortinet'],
    kinds: PARE_FEU,
    membres: { min: 2, max: 4 },
    lien: { kind: ['heartbeat'], nom: 'liens HA dédiés (heartbeat)' },
    vip: true,
    roles: ['active', 'passive', 'active-active'],
    bascule: '1 à 3 s, sessions synchronisées',
    liensComplementaires: [
      { nom: 'Second lien de heartbeat sur un port distinct', role: 'conseillé' },
    ],
    prerequis: [
      'Mêmes modèle, version FortiOS et jeu de licences',
      'Interfaces de heartbeat dédiées, hors des VLAN de production',
    ],
    limites: [
      "En actif/actif, seule l'inspection est répartie : le maître reste seul à router",
      'Les sessions non synchronisées (SSL profond, certaines sessions UDP) se rétablissent après bascule',
    ],
    note: "Doublez les liens de heartbeat sur deux ports distincts : leur perte simultanée donne deux pare-feu maîtres avec les mêmes adresses. En actif/actif, seule l'inspection est répartie — le trafic reste géré par le maître.",
  },
  {
    id: 'fgsp',
    label: 'FGSP (synchronisation de sessions)',
    famille: 'pare-feu',
    planDeDonnees: 'tous',
    noteDonnees:
      "Chaque pare-feu traite ses propres flux ; la table de sessions partagée sert à ce qu'un flux dérouté vers l'autre membre ne soit pas rejeté. C'est le routage qui répartit, pas la grappe.",
    vendors: ['fortinet'],
    kinds: PARE_FEU,
    membres: { min: 2, max: 16 },
    lien: { kind: ['heartbeat'], nom: 'liaison de synchronisation de sessions' },
    roles: ['active-active'],
    bascule: 'Sans perte de session si le routage bascule',
    note: 'Pour des pare-feu indépendants (souvent sur deux sites) qui partagent leurs tables de sessions : la bascule dépend alors du routage, pas du cluster.',
  },
  {
    id: 'pan-ha-ap',
    label: 'HA actif / passif (PAN-OS)',
    famille: 'pare-feu',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Le passif ne traite aucun paquet : ses interfaces sont configurées mais silencieuses. Il doit donc être dimensionné comme l'actif, et sa capacité n'est éprouvée qu'au jour de la bascule.",
    vendors: ['palo alto networks'],
    kinds: PARE_FEU,
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'HA2 — synchronisation des sessions' },
    liensComplementaires: [
      { nom: 'HA1 — contrôle : élection, hello, synchronisation de configuration', obligatoire: true },
      { nom: 'HA1-backup — second chemin de contrôle (MGT ou port dédié)', role: 'conseillé' },
      { nom: 'HA2-backup — second chemin de synchronisation', role: 'facultatif' },
    ],
    roles: ['active', 'passive'],
    bascule: '< 1 s avec les minuteurs recommandés ; 2 à 3 s si le contrôle de chemin déclenche',
    prerequis: [
      'Mêmes modèle, version PAN-OS et jeu de licences sur les deux boîtiers',
      'Même mode de déploiement des interfaces (L3, vwire, tap) et même configuration de slots sur PA-7000',
      'Priorité de périphérique et préemption réglées de façon cohérente des deux côtés',
    ],
    limites: [
      "Le passif ne traite aucun trafic : la paire ne double pas le débit, elle le sécurise",
      "Les sessions déchiffrées (SSL/TLS) ne sont pas synchronisées : elles se rétablissent après bascule",
      "La bascule ne protège pas d'une erreur de configuration — elle est justement synchronisée sur les deux",
    ],
    note: "En actif/passif, il n'y a pas d'adresse virtuelle : les deux boîtiers portent la même configuration d'interfaces et l'actif seul répond, le passif reprenant les adresses avec des ARP gratuits. Le point qui fait tomber les paires en production est l'absence de HA1-backup : un seul câble de contrôle coupé, et les deux se croient actifs.",
  },
  {
    id: 'pan-ha-aa',
    label: 'HA actif / actif (PAN-OS)',
    famille: 'pare-feu',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux membres traitent du trafic, mais chaque session appartient à un seul d'entre eux : HA3 transfère les paquets vers son propriétaire. Le débit ne double pas — dimensionnez chaque membre pour la totalité.",
    vendors: ['palo alto networks'],
    kinds: PARE_FEU,
    membres: { min: 2, max: 2 },
    gammes: ['pa-3[2456]', 'pa-5[245]', 'pa-7[05]', 'vm-series', 'vm-'],
    lien: { kind: ['heartbeat'], nom: 'HA2 — synchronisation des sessions' },
    liensComplementaires: [
      { nom: 'HA1 — contrôle : élection, hello, synchronisation de configuration', obligatoire: true },
      { nom: 'HA3 — réacheminement des paquets entre les deux membres (niveau 2)', obligatoire: true },
      { nom: 'HA1-backup — second chemin de contrôle', role: 'conseillé' },
    ],
    vip: true,
    roles: ['active-active'],
    bascule: 'Sans bascule pour les flux déjà pris en charge par le membre survivant',
    prerequis: [
      'Gammes PA-3400 et supérieures, ou VM-Series : les PA-400 et PA-800 ne font que de l’actif/passif',
      'Un identifiant de périphérique (device-id 0 ou 1) et une liaison HA3 dédiée, souvent un agrégat',
      'NAT, PBF et tunnels VPN liés explicitement à un device-id',
    ],
    limites: [
      "Ne double pas le débit : chaque session reste traitée par un seul membre (propriétaire de session)",
      'Le réacheminement HA3 consomme de la bande passante et de la ressource : à dimensionner',
      "Complexité de diagnostic bien supérieure à l'actif/passif, pour un gain limité hors routage asymétrique",
    ],
    note: "L'actif/actif ne sert pas à aller deux fois plus vite : il sert aux topologies asymétriques — deux opérateurs, deux chemins de retour — et aux adresses flottantes qui suivent le membre resté debout. Palo Alto recommande lui-même l'actif/passif quand l'asymétrie n'est pas imposée.",
  },
  {
    id: 'pan-ha-cluster',
    label: 'Grappe HA PAN-OS (HA4, jusqu’à 16)',
    famille: 'pare-feu',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "Le partage de la table de sessions permet à un membre de reprendre les connexions d'un autre, mais ne répartit pas le trafic de lui-même : c'est le routage ou l'équilibrage amont qui le fait.",
    vendors: ['palo alto networks'],
    kinds: PARE_FEU,
    membres: { min: 2, max: 16 },
    lien: { kind: ['heartbeat'], nom: 'HA4 — synchronisation d’état entre membres de la grappe' },
    roles: ['active', 'passive', 'active-active'],
    bascule: 'Reprise par un autre membre de la grappe, sans réapprentissage des sessions',
    prerequis: [
      'PAN-OS 10.2 ou plus récent, modèles compatibles et administration par Panorama',
      'Les paires HA classiques (HA1/HA2) restent en place : HA4 les complète, il ne les remplace pas',
    ],
    limites: [
      "Sert la continuité de session entre sites ou entre paires, pas la répartition de charge",
      'La synchronisation HA4 est asynchrone : quelques sessions récentes peuvent manquer',
    ],
    note: "Mécanisme de grappe étendue introduit avec PAN-OS 10.2 : jusqu'à seize pare-feu partagent leur table de sessions, ce qui permet à un site de reprendre le trafic d'un autre sans coupure des connexions longues.",
  },
  {
    id: 'panorama-ha',
    label: 'Panorama en actif / passif',
    famille: 'services',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Le secondaire n'administre rien avant la bascule — et aucun des deux ne porte de trafic de production.",
    vendors: ['palo alto networks'],
    kinds: ['siem', 'nms'],
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'liaison HA entre les deux Panorama' },
    roles: ['active', 'passive'],
    bascule: 'Administration indisponible quelques minutes : le trafic, lui, n’est pas affecté',
    prerequis: [
      'Deux Panorama de même modèle et de même version, avec le même mode (Panorama ou Management Only)',
      'Collecteurs de journaux dimensionnés indépendamment de la paire',
    ],
    limites: [
      "Panorama n'est pas dans le chemin du trafic : sa perte n'interrompt rien, elle bloque l'administration et la collecte",
      'Les journaux ne sont pas dupliqués par la paire : leur redondance relève des Log Collectors',
    ],
    note: "À documenter comme une redondance d'administration, pas de production : c'est la nuance qui évite de compter Panorama dans le calcul de disponibilité du réseau.",
  },
  {
    id: 'clusterxl',
    label: 'ClusterXL',
    famille: 'pare-feu',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "En High Availability, un seul membre filtre. En Load Sharing, tous filtrent — mais le mode unicast fait entrer tout le trafic par un membre pivot qui le redistribue, ce qui en fait le point de dimensionnement.",
    vendors: ['check point'],
    kinds: PARE_FEU,
    membres: { min: 2, max: 5 },
    lien: { kind: ['heartbeat'], nom: 'réseau de synchronisation dédié' },
    vip: true,
    roles: ['active', 'passive', 'active-active'],
    bascule: '< 3 s (High Availability), immédiate en Load Sharing',
    prerequis: [
      'Mêmes version et niveau de correctif sur tous les membres',
      'Réseau de synchronisation dédié, au même débit que la production',
    ],
    limites: [
      'Le mode Load Sharing exige un routage symétrique ou du sticky',
      "La synchronisation n'inclut pas toutes les connexions : les services très courts peuvent être exclus",
    ],
    note: 'Le réseau de synchronisation doit être dédié et de même débit que les interfaces de production : c’est lui qui porte la table de connexions.',
  },
  {
    id: 'srx-chassis-cluster',
    label: 'Chassis cluster SRX',
    famille: 'pare-feu',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "Avec les seuls RG0/RG1, un nœud traite tout. Avec plusieurs groupes de redondance répartis, chaque nœud est actif pour une part du trafic — mais un flux donné reste traité de bout en bout par un seul nœud.",
    vendors: ['juniper'],
    kinds: PARE_FEU,
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'control link + fabric link' },
    vip: true,
    roles: ['active', 'passive', 'active-active'],
    bascule: '< 2 s par groupe de redondance',
    prerequis: [
      'Mêmes modèle et version Junos',
      'Deux liaisons physiques distinctes : control link et fabric link',
    ],
    limites: [
      'Certaines fonctions restent liées à un nœud : à vérifier par groupe de redondance',
      'Le passage en cluster renumérote les interfaces (fe-0/0/0 devient ge-0/0/0 etc.)',
    ],
    note: 'Deux liens distincts sont obligatoires : le control link porte l’élection, le fabric link les sessions. Les groupes de redondance permettent de rendre chaque nœud actif pour une partie du trafic.',
  },
  {
    id: 'ftd-ha',
    label: 'Basculement (failover) Secure Firewall',
    famille: 'pare-feu',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "L'unité de secours ne traite aucun paquet avant la bascule. Pour faire travailler plusieurs unités en parallèle, il faut le clustering, qui est un autre mécanisme.",
    vendors: ['cisco'],
    kinds: PARE_FEU,
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'failover link + state link' },
    vip: true,
    roles: ['active', 'passive'],
    bascule: '< 3 s avec réplication d’état',
    liensComplementaires: [
      { nom: "Lien d'état (stateful failover) distinct du lien de bascule", role: 'conseillé' },
    ],
    prerequis: [
      'Mêmes modèle, version et licences',
      'Les deux unités gérées par le même FMC',
    ],
    limites: [
      'Le passif ne traite pas de trafic',
      'Au-delà de deux unités, il faut passer au clustering',
    ],
    note: 'Le lien d’état (stateful failover) doit être séparé du lien de bascule pour que les sessions survivent. Au-delà de deux unités, Cisco propose le clustering (jusqu’à 16 nœuds).',
  },
  {
    id: 'sns-ha',
    label: 'Haute disponibilité SNS',
    famille: 'pare-feu',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Le passif ne traite aucun paquet : il se contente de suivre l'état de l'actif.",
    vendors: ['stormshield'],
    kinds: PARE_FEU,
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'lien HA dédié' },
    vip: true,
    roles: ['active', 'passive'],
    bascule: '< 5 s, sessions et configuration synchronisées',
    note: 'Cluster actif/passif à deux nœuds, qualifié ANSSI dans cette configuration. Le lien HA doit être direct entre les deux boîtiers.',
  },
  {
    id: 'firecluster',
    label: 'FireCluster',
    famille: 'pare-feu',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "L'actif/actif répartit les connexions entre les deux boîtiers, mais exige un routage symétrique : un retour par l'autre membre fait tomber la session.",
    vendors: ['watchguard'],
    kinds: PARE_FEU,
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'interface de cluster dédiée' },
    roles: ['active', 'passive', 'active-active'],
    bascule: '< 5 s',
    note: 'Actif/passif ou actif/actif selon la licence ; l’actif/actif répartit les connexions mais exige un routage symétrique.',
  },
  {
    id: 'xgs-ha',
    label: 'HA Sophos XGS',
    famille: 'pare-feu',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "Le mode se choisit à la configuration de la paire ; en actif/passif le secondaire ne traite rien.",
    vendors: ['sophos'],
    kinds: PARE_FEU,
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'lien HA dédié' },
    vip: true,
    roles: ['active', 'passive', 'active-active'],
    bascule: '< 5 s',
    note: 'Les deux boîtiers doivent être de modèle et de version identiques ; la licence est portée par le nœud principal.',
  },

  {
    id: 'fw-ap',
    label: 'Grappe actif / passif (à préciser)',
    famille: 'pare-feu',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Le passif ne traite aucun paquet avant la bascule : dimensionnez-le comme l'actif.",
    vendors: [],
    kinds: PARE_FEU,
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'lien de synchronisation dédié' },
    vip: true,
    roles: ['active', 'passive'],
    bascule: '1 à 5 s selon le constructeur',
    note: "Mécanisme générique, à remplacer par celui du constructeur (FGCP, ClusterXL, HA PAN-OS, chassis cluster SRX, HA SNS…) : c'est lui qui dit ce qu'il faut câbler, combien de temps dure la bascule et ce que la grappe ne protège pas.",
  },
  {
    id: 'adc-ha',
    label: 'Paire de répartiteurs (VIP flottante)',
    famille: 'repartiteur',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "Une adresse virtuelle flottante n'est servie que par un membre. Répartir suppose plusieurs adresses virtuelles, réparties entre les membres — chacun devant pouvoir porter les autres.",
    vendors: [],
    kinds: ['loadbalancer', 'waf'],
    membres: { min: 2 },
    lien: { kind: ['heartbeat'], nom: 'réseau de synchronisation des sessions' },
    vip: true,
    roles: ['active', 'passive', 'active-active'],
    bascule: '< 5 s, sans coupure si les sessions sont répliquées',
    note: "Mécanisme générique : précisez celui du constructeur (DSC chez F5, paire HA NetScaler, VRRP chez Radware). Sans réplication de sessions, la bascule coupe les connexions en cours — acceptable pour du web, pas pour du transfert long.",
  },
  // ── Répartiteurs de charge ────────────────────────────────────────────────
  {
    id: 'f5-dsc',
    label: 'Device Service Clustering (traffic groups)',
    famille: 'repartiteur',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "Chaque traffic-group n'est actif que sur un équipement, mais plusieurs traffic-groups peuvent être répartis entre les équipements. Le dimensionnement se fait donc par équipement, pour la somme des traffic-groups qu'il peut reprendre.",
    vendors: ['f5'],
    kinds: ['loadbalancer', 'waf'],
    membres: { min: 2, max: 8 },
    lien: { kind: ['heartbeat'], nom: 'HA group (réseau de failover + mirroring)' },
    vip: true,
    roles: ['active', 'passive', 'active-active'],
    bascule: '< 5 s, immédiate si le mirroring de connexions est activé',
    note: 'Les adresses flottantes appartiennent à un traffic-group : c’est lui qui bascule, pas l’équipement entier. Le mirroring de connexions coûte de la mémoire, à réserver aux services qui l’exigent.',
  },
  {
    id: 'citrix-ha',
    label: 'Paire HA NetScaler',
    famille: 'repartiteur',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Le secondaire ne traite aucun trafic : il reçoit la configuration et attend.",
    vendors: ['citrix'],
    kinds: ['loadbalancer', 'waf'],
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'paquets HA sur les interfaces communes' },
    vip: true,
    roles: ['active', 'passive'],
    bascule: '< 3 s',
    note: 'Paire actif/passif : la configuration se propage du primaire vers le secondaire. En mode INC (réseaux distincts), les VIP ne migrent pas — le routage doit suivre.',
  },
  {
    id: 'keepalived',
    label: 'Keepalived / VRRP logiciel',
    famille: 'repartiteur',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "Une adresse virtuelle n'a qu'un maître. On répartit en déclarant plusieurs adresses virtuelles avec des priorités croisées, ce qui reste un seul maître par adresse.",
    vendors: [],
    kinds: ['loadbalancer', 'waf', 'server', 'ztna', 'api-gateway'],
    membres: { min: 2 },
    vip: true,
    roles: ['active', 'passive', 'active-active'],
    bascule: '1 à 3 s',
    note: 'Redondance logicielle par VRRP (HAProxy, NGINX…). Surveillez le service et pas seulement la machine : un HAProxy arrêté sur un nœud qui répond encore garde la VIP.',
  },

  // ── Calcul et virtualisation ──────────────────────────────────────────────
  {
    id: 'vsphere-ha',
    label: 'vSphere HA',
    famille: 'calcul',
    planDeDonnees: 'tous',
    noteDonnees:
      "Tous les hôtes exécutent des machines virtuelles en permanence. HA ne fait que redémarrer ailleurs celles de l'hôte perdu : réservez la capacité correspondante (admission control), sinon le redémarrage échoue faute de ressources.",
    vendors: ['vmware', 'dell', 'hpe', 'lenovo', 'cisco'],
    kinds: CALCUL,
    membres: { min: 2 },
    lien: { kind: ['heartbeat'], nom: 'réseau de gestion + heartbeat datastore' },
    temoin: true,
    roles: ['active-active', 'witness'],
    bascule: 'Redémarrage des machines virtuelles : 1 à 5 minutes',
    prerequis: [
      'Stockage partagé accessible par tous les hôtes',
      'Capacité de redémarrage réservée (admission control)',
      'Réseau de gestion redondé, ou deux datastores de heartbeat',
    ],
    limites: [
      'Les machines virtuelles redémarrent : la coupure est réelle',
      "Ne protège pas d'une corruption applicative ni d'un chiffrement malveillant",
    ],
    note: "vSphere HA redémarre les VM, il ne les maintient pas en vie : prévoyez la capacité de redémarrage (admission control) et acceptez la coupure. Pour du zéro-perte, c'est FT, limité en vCPU. Une grappe à deux hôtes demande un témoin (datastore de heartbeat ou nœud d'arbitrage).",
  },
  {
    id: 'vsan-stretched',
    label: 'vSAN étiré + témoin',
    famille: 'calcul',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux sites servent les lectures locales et écrivent en synchrone. La perte d'un site laisse l'autre porter toute la charge : dimensionnez chaque site pour la totalité.",
    vendors: ['vmware', 'dell', 'hpe', 'lenovo'],
    kinds: [...CALCUL, 'storage'],
    membres: { min: 3 },
    temoin: true,
    roles: ['active-active', 'witness'],
    bascule: 'Sans interruption si la tolérance de panne le permet',
    note: "Le témoin doit être sur un troisième site — posé dans l'une des deux salles, il ne départage rien. Surveillez la latence entre sites (5 ms au plus pour du synchrone).",
  },
  {
    id: 'nutanix-ha',
    label: 'Nutanix HA (RF2 / RF3)',
    famille: 'calcul',
    planDeDonnees: 'tous',
    noteDonnees:
      "Tous les nœuds exécutent des machines virtuelles et servent des entrées/sorties. Après la perte d'un nœud, les survivants portent sa charge en plus de la reconstruction des données.",
    vendors: ['nutanix', 'dell', 'hpe', 'lenovo'],
    kinds: ['hci', 'hypervisor'],
    membres: { min: 3 },
    roles: ['active-active'],
    bascule: 'Redémarrage des VM du nœud perdu : 1 à 5 minutes',
    prerequis: [
      'Trois nœuds au minimum pour RF2, cinq pour RF3',
      "Capacité restante suffisante pour reconstruire après la perte d'un nœud",
    ],
    limites: [
      'Les machines virtuelles du nœud perdu redémarrent',
      'La réplication interne ne remplace pas une sauvegarde hors cluster',
    ],
    note: "Trois nœuds au minimum pour RF2, cinq pour RF3 : en dessous, la perte d'un nœud interdit toute nouvelle écriture. Vérifiez que la capacité restante absorbe la reconstruction (n+1).",
  },
  {
    id: 'nutanix-metro',
    label: 'Nutanix Metro Availability + témoin',
    famille: 'calcul',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Un conteneur n'est actif que sur un site à la fois. On peut croiser la direction conteneur par conteneur, mais chaque conteneur n'a qu'un site actif.",
    vendors: ['nutanix'],
    kinds: ['hci'],
    membres: { min: 2 },
    temoin: true,
    roles: ['active', 'passive', 'witness'],
    bascule: 'Automatique avec témoin, manuelle sans',
    note: 'Réplication synchrone entre deux clusters. Sans machine témoin sur un troisième site, la bascule reste manuelle — c’est le point qui fait échouer les tests de PRA.',
  },
  {
    id: 'wsfc',
    label: 'Cluster de basculement Windows (WSFC)',
    famille: 'calcul',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "Un groupe de ressources n'est actif que sur un nœud ; plusieurs groupes peuvent être répartis entre les nœuds. Le dimensionnement se fait par nœud, pour tous les groupes qu'il peut reprendre.",
    vendors: ['microsoft', 'dell', 'hpe', 'lenovo'],
    kinds: [...CALCUL, 'managed-db'],
    membres: { min: 2 },
    temoin: true,
    vip: true,
    roles: ['active', 'passive', 'active-active', 'witness'],
    bascule: '30 s à 2 minutes selon le rôle',
    note: "Le quorum se configure explicitement : témoin disque, témoin de partage de fichiers ou témoin cloud. Une grappe à deux nœuds sans témoin s'arrête dès qu'un nœud tombe.",
  },
  {
    id: 'proxmox-ha',
    label: 'Proxmox HA (Corosync)',
    famille: 'calcul',
    planDeDonnees: 'tous',
    noteDonnees:
      "Tous les nœuds exécutent des machines virtuelles ; HA les redémarre ailleurs, avec coupure. Gardez la capacité d'un nœud libre.",
    vendors: ['proxmox'],
    kinds: CALCUL,
    membres: { min: 3 },
    lien: { kind: ['heartbeat'], nom: 'réseau Corosync dédié' },
    roles: ['active-active'],
    bascule: 'Redémarrage des VM : 1 à 3 minutes',
    note: "Trois nœuds au minimum pour le quorum (ou deux plus un QDevice). Corosync veut un réseau à faible latence, séparé du stockage : c'est la première cause d'instabilité d'un cluster Proxmox.",
  },
  {
    id: 'scale-ha',
    label: 'Scale Computing HC3 HA',
    famille: 'calcul',
    planDeDonnees: 'tous',
    noteDonnees:
      "Tous les nœuds exécutent des machines virtuelles et servent des entrées/sorties.",
    vendors: ['scale computing'],
    kinds: ['hci'],
    membres: { min: 3 },
    roles: ['active-active'],
    bascule: 'Redémarrage automatique des VM',
    note: 'Cluster à trois nœuds minimum, réplication par blocs intégrée.',
  },
  {
    id: 'pacemaker',
    label: 'Pacemaker / Corosync',
    famille: 'calcul',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "Une ressource primitive n'est active que sur un nœud ; une ressource clonée l'est sur tous. Le plan de données dépend donc de la nature des ressources, pas du cluster.",
    vendors: [],
    kinds: ['server', 'baremetal', 'managed-db', 'ipbx'],
    membres: { min: 2 },
    temoin: true,
    vip: true,
    roles: ['active', 'passive', 'active-active', 'witness'],
    bascule: '10 s à 2 minutes selon la ressource',
    note: "Prévoyez le fencing (STONITH) : sans lui, un nœud qui ne répond plus mais qui écrit encore corrompt les données partagées. Un cluster à deux nœuds demande un qdevice ou un quorum externe.",
  },

  // ── Stockage ──────────────────────────────────────────────────────────────
  {
    id: 'dual-controller',
    label: 'Baie à deux contrôleurs',
    famille: 'stockage',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux contrôleurs servent en permanence, mais chaque volume appartient à l'un des deux (ALUA) : la perte d'un contrôleur transfère ses volumes à l'autre, qui doit alors absorber toute la charge. Un contrôleur chargé à plus de 50 % promet une dégradation, pas une continuité.",
    vendors: [],
    kinds: STOCKAGE,
    membres: { min: 1, max: 1 },
    roles: ['standalone'],
    bascule: '< 10 s (basculement de contrôleur)',
    note: "Une baie à deux contrôleurs protège d'une panne de contrôleur, pas d'une panne de baie ni d'un incident de salle : ce n'est pas une grappe, c'est un châssis redondé. Raccordez chaque contrôleur à un switch SAN différent.",
  },
  {
    id: 'netapp-ha-pair',
    label: 'Paire HA (takeover / giveback)',
    famille: 'stockage',
    planDeDonnees: 'tous',
    noteDonnees:
      "Chaque contrôleur sert ses propres agrégats : les deux travaillent. Un takeover met toute la charge sur le survivant.",
    vendors: ['netapp'],
    kinds: STOCKAGE,
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'interconnexion HA' },
    roles: ['active-active'],
    bascule: '< 60 s (takeover), non disruptif pour NFS/SMB',
    prerequis: [
      'Deux contrôleurs du même modèle, interconnexion HA en place',
      'Chemins multiples (MPIO) configurés côté hôtes',
    ],
    limites: [
      'Ne couvre pas la perte du châssis, de la baie ni de la salle',
      'Le takeover interrompt brièvement les protocoles bloc',
    ],
    note: 'Les deux contrôleurs se reprennent mutuellement les agrégats. Le stockage reste dans le même châssis ou la même salle : pour couvrir la perte d’un site, il faut MetroCluster.',
  },
  {
    id: 'metrocluster',
    label: 'MetroCluster + médiateur',
    famille: 'stockage',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux sites servent leurs propres volumes en écriture synchrone ; chacun doit pouvoir porter les deux.",
    vendors: ['netapp'],
    kinds: STOCKAGE,
    membres: { min: 2 },
    temoin: true,
    roles: ['active-active', 'witness'],
    bascule: 'Automatique avec le médiateur (quelques dizaines de secondes)',
    prerequis: [
      'Liaisons inter-sites dédiées et médiateur sur un troisième site',
      'Latence maîtrisée entre les deux salles',
    ],
    limites: [
      'Sans médiateur, la bascule reste manuelle',
      "La réplication synchrone propage aussi les suppressions : ce n'est pas une sauvegarde",
    ],
    note: 'Réplication synchrone entre deux sites. Le médiateur (ou Tiebreaker) doit être hébergé sur un troisième site pour que la bascule soit automatique.',
  },
  {
    id: 'activecluster',
    label: 'ActiveCluster + médiateur',
    famille: 'stockage',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux baies servent le même volume en écriture : c'est un actif/actif réel, et non un actif/veilleur.",
    vendors: ['pure storage'],
    kinds: STOCKAGE,
    membres: { min: 2 },
    temoin: true,
    roles: ['active-active', 'witness'],
    bascule: 'Transparente pour les hôtes (actif/actif synchrone)',
    note: 'Deux baies actives sur le même volume ; le médiateur est fourni en SaaS ou déployable en local sur un troisième site. Latence inter-sites à surveiller (≤ 11 ms).',
  },
  {
    id: 'peer-persistence',
    label: 'Peer Persistence + témoin',
    famille: 'stockage',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Un volume est servi par une seule baie à la fois ; les chemins vers l'autre existent mais ne sont pas optimisés. On peut alterner le site primaire volume par volume.",
    vendors: ['hpe'],
    kinds: STOCKAGE,
    membres: { min: 2 },
    temoin: true,
    roles: ['active', 'passive', 'witness'],
    bascule: 'Automatique avec le Quorum Witness',
    note: 'Réplication synchrone Alletra/Nimble/Primera entre deux baies, bascule arbitrée par un témoin à déployer hors des deux salles.',
  },
  {
    id: 'powerstore-metro',
    label: 'Metro Volume / réplication synchrone',
    famille: 'stockage',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux appliances servent le même volume : les chemins des deux côtés sont utilisables en permanence.",
    vendors: ['dell'],
    kinds: STOCKAGE,
    membres: { min: 2 },
    temoin: true,
    roles: ['active-active', 'witness'],
    bascule: 'Transparente pour les hôtes',
    note: 'Volumes actifs sur deux appliances PowerStore ; le témoin externe évite le cerveau divisé lors d’une coupure inter-sites.',
  },
  {
    id: 'hypermetro',
    label: 'HyperMetro + serveur de quorum',
    famille: 'stockage',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux baies servent le même LUN ; les chemins des deux côtés sont actifs.",
    vendors: ['huawei'],
    kinds: STOCKAGE,
    membres: { min: 2 },
    temoin: true,
    roles: ['active-active', 'witness'],
    bascule: 'Transparente pour les hôtes',
    note: 'Actif/actif synchrone entre deux baies OceanStor, arbitré par un serveur de quorum sur un troisième site.',
  },
  {
    id: 'synology-sha',
    label: 'Synology High Availability (SHA)',
    famille: 'stockage',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Le passif ne sert aucun partage : la bascule interrompt les services le temps du démarrage.",
    vendors: ['synology'],
    kinds: STOCKAGE,
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'liaison Heartbeat dédiée' },
    vip: true,
    roles: ['active', 'passive'],
    bascule: '1 à 5 minutes (les services redémarrent)',
    note: 'Paire actif/passif de NAS identiques : la bascule interrompt les services le temps du démarrage. Ce n’est pas du stockage actif/actif.',
  },
  {
    id: 'backup-3-2-1',
    label: 'Sauvegarde 3-2-1-1-0 (copie immuable)',
    famille: 'stockage',
    planDeDonnees: 'sans-objet',
    vendors: [],
    kinds: ['backup', 'tape-backup'],
    membres: { min: 1 },
    roles: ['standalone', 'active'],
    bascule: 'Sans objet : restauration, pas bascule',
    note: "La redondance ne remplace pas la sauvegarde : trois copies, deux supports, une hors site, une hors ligne ou immuable, zéro erreur de restauration vérifiée. C'est le seul rempart contre un chiffrement malveillant, qui se réplique instantanément sur une baie miroir.",
  },

  // ── Contrôleurs Wi-Fi ─────────────────────────────────────────────────────
  {
    id: 'wlc-sso',
    label: 'HA SSO (paire de contrôleurs)',
    famille: 'sans-fil',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Le contrôleur de secours ne termine aucun tunnel avant la bascule ; il en garde l'état, ce qui évite la réassociation des bornes.",
    vendors: ['cisco'],
    kinds: ['wlan-controller'],
    membres: { min: 2, max: 2 },
    lien: { kind: ['heartbeat'], nom: 'Redundancy Port (RP)' },
    vip: true,
    roles: ['active', 'passive'],
    bascule: 'Sans réassociation des bornes ni des clients (AP SSO + Client SSO)',
    prerequis: [
      'Deux contrôleurs de même modèle et de même version',
      'Lien RP direct, latence inférieure à 80 ms',
    ],
    limites: [
      'Ne couvre pas la perte du site : prévoir un N+1 distant pour cela',
    ],
    note: 'Les deux contrôleurs partagent une adresse de gestion ; le lien RP doit être direct ou en L2 pur, avec moins de 80 ms de latence.',
  },
  {
    id: 'wlc-n1',
    label: 'Redondance N+1',
    famille: 'sans-fil',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Le contrôleur de secours ne porte aucune borne avant la bascule, et doit pouvoir absorber celles du contrôleur perdu.",
    vendors: ['cisco', 'aruba', 'huawei'],
    kinds: ['wlan-controller'],
    membres: { min: 2 },
    roles: ['active', 'passive'],
    bascule: 'Les bornes se réassocient : 30 s à 2 minutes',
    note: 'Un contrôleur de secours pour plusieurs contrôleurs actifs. La coupure Wi-Fi est réelle le temps de la réassociation des bornes : à réserver aux sites où elle est acceptable.',
  },
  {
    id: 'aruba-cluster',
    label: 'Cluster de contrôleurs',
    famille: 'sans-fil',
    planDeDonnees: 'tous',
    noteDonnees:
      "Bornes et clients sont répartis entre tous les membres : chaque membre doit pouvoir absorber la part d'un autre.",
    vendors: ['aruba'],
    kinds: ['wlan-controller'],
    membres: { min: 2, max: 12 },
    roles: ['active-active'],
    bascule: 'Transparente (AP et clients répartis, état répliqué)',
    note: 'Jusqu’à douze contrôleurs partagent bornes et clients ; prévoyez la capacité de reprise (chaque membre doit pouvoir absorber la charge d’un autre).',
  },
  {
    id: 'smartzone-cluster',
    label: 'Cluster SmartZone',
    famille: 'sans-fil',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les bornes sont réparties entre les nœuds du cluster.",
    vendors: ['ruckus'],
    kinds: ['wlan-controller'],
    membres: { min: 3, max: 4 },
    roles: ['active-active'],
    bascule: 'Transparente tant que le quorum est tenu',
    note: 'Trois nœuds au minimum pour le quorum ; en dessous, la perte d’un nœud arrête le cluster.',
  },

  // ── Services réseau et applicatifs ────────────────────────────────────────
  {
    id: 'dns-anycast',
    label: 'DNS/DHCP redondé (anycast ou paire)',
    famille: 'services',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "En anycast, tous les nœuds répondent et le routage choisit le plus proche. Une paire primaire/secondaire DNS répond aussi des deux côtés. Un failover DHCP, lui, partage les plages entre deux serveurs : ce n'est ni l'un ni l'autre.",
    vendors: ['infoblox', 'efficientip'],
    kinds: ['ddi'],
    membres: { min: 2 },
    vip: true,
    roles: ['active', 'passive', 'active-active'],
    bascule: 'Immédiate en anycast, quelques secondes en VRRP',
    note: "Le DHCP se redonde par failover (RFC 3074) avec des plages partagées ; le DNS par anycast ou par paire. Un service d'adressage indisponible arrête le réseau plus sûrement qu'une panne de switch.",
  },
  {
    id: 'ad-multi-dc',
    label: 'Annuaire multi-contrôleurs',
    famille: 'services',
    planDeDonnees: 'tous',
    noteDonnees:
      "Tous les contrôleurs traitent des authentifications ; les clients choisissent par site et par DNS.",
    vendors: ['microsoft'],
    kinds: ['idp'],
    membres: { min: 2 },
    roles: ['active-active'],
    bascule: 'Immédiate (les clients choisissent un autre contrôleur)',
    note: 'Au moins deux contrôleurs de domaine, idéalement sur deux sites, avec les rôles FSMO documentés et les serveurs DNS pointant sur les deux.',
  },
  {
    id: 'sql-ag',
    label: 'Groupe de disponibilité SQL Server',
    famille: 'services',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "Les écritures vont toujours au réplica primaire. Les secondaires ne traitent du trafic que si la lecture seule y est activée et que les applications s'y adressent explicitement.",
    vendors: ['microsoft'],
    kinds: ['managed-db', 'server'],
    membres: { min: 2 },
    temoin: true,
    vip: true,
    roles: ['active', 'passive', 'active-active'],
    bascule: '10 à 60 s (listener)',
    note: 'Repose sur WSFC : son quorum conditionne la bascule. Le listener doit être documenté comme point d’entrée applicatif, pas l’adresse d’un nœud.',
  },
  {
    id: 'ipbx-cluster',
    label: 'Grappe IPBX (survivabilité de site)',
    famille: 'services',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "Selon le montage : postes répartis entre les nœuds, ou nœud de secours inactif. La survivabilité locale, elle, ne s'active qu'à la coupure du lien central.",
    vendors: ['cisco', 'alcatel-lucent', 'mitel', '3cx'],
    kinds: ['ipbx', 'voice-gateway'],
    membres: { min: 2 },
    roles: ['active', 'passive', 'active-active'],
    bascule: 'Réenregistrement des postes : 30 s à 2 minutes',
    note: "Prévoyez la survivabilité locale (SRST ou équivalent) : si le lien vers le site central tombe, les postes doivent au moins pouvoir appeler les numéros d'urgence.",
  },

  // ── Accès opérateur et WAN ────────────────────────────────────────────────
  {
    id: 'bgp-multihoming',
    label: 'Multihoming BGP (deux opérateurs)',
    famille: 'wan',
    planDeDonnees: 'selon-mode',
    noteDonnees:
      "Deux accès réellement actifs, ou un accès rendu moins attractif (AS-path, MED, communautés) qui ne porte rien en régime normal. Dans les deux cas, vérifiez que l'accès restant absorbe la totalité du trafic.",
    vendors: [],
    kinds: ['router', 'ngfw', 'firewall', 'sdwan'],
    membres: { min: 2 },
    roles: ['active', 'active-active'],
    bascule: 'Convergence BGP : quelques secondes, < 1 s avec BFD',
    note: "Deux opérateurs ne suffisent pas s'ils empruntent le même fourreau ou le même NRO : demandez les chemins physiques et vérifiez qu'ils diffèrent réellement.",
  },
  {
    id: 'sdwan-dual-hub',
    label: 'SD-WAN à double concentrateur',
    famille: 'wan',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les tunnels vers les deux concentrateurs sont montés et utilisés en parallèle, le choix se faisant flux par flux sur la qualité mesurée.",
    vendors: [],
    kinds: ['sdwan', 'router', 'ngfw'],
    membres: { min: 2 },
    roles: ['active-active'],
    bascule: 'Bascule de tunnel guidée par la mesure de SLA : < 1 s',
    note: 'Deux concentrateurs sur deux sites, tunnels actifs en parallèle et bascule sur mesure de qualité. Vérifiez que les deux transports ne partagent pas le même accès physique.',
  },
  {
    id: 'lte-backup',
    label: 'Secours 4G/5G',
    famille: 'wan',
    planDeDonnees: 'un-seul',
    noteDonnees:
      "Le lien ne porte rien tant que l'accès principal fonctionne. Son débit n'a rien de comparable : décrivez le service réellement rendu en mode dégradé, pas la bande passante nominale.",
    vendors: [],
    kinds: ['router-5g', 'router', 'sdwan'],
    membres: { min: 1 },
    roles: ['passive'],
    bascule: '10 à 60 s (établissement du tunnel)',
    note: "Secours indépendant du génie civil, donc utile contre la pelleteuse. Testez-le périodiquement : un abonnement suspendu ou une antenne débranchée ne se voit qu'au moment où l'on en a besoin.",
  },

  // ── Énergie ───────────────────────────────────────────────────────────────
  {
    id: 'ups-2n',
    label: 'Double chaîne ondulée (2N)',
    famille: 'energie',
    planDeDonnees: 'tous',
    noteDonnees:
      "Les deux chaînes alimentent la charge en parallèle, chacune pour environ la moitié. Au-delà de 50 % par chaîne, la perte d'une chaîne fait disjoncter l'autre : c'est le piège classique du 2N, et il se vérifie sur les relevés, pas sur le schéma.",
    vendors: [],
    kinds: ['ups', 'pdu'],
    membres: { min: 2 },
    roles: ['active-active'],
    bascule: 'Aucune : les deux chaînes alimentent en parallèle',
    prerequis: [
      "Deux arrivées électriques et deux chaînes complètes, jusqu'aux prises",
      'Équipements à double alimentation, ou commutateur de transfert (STS)',
    ],
    limites: [
      'Un seul équipement mono-alimenté annule le bénéfice de la chaîne double',
      "L'autonomie batterie se dégrade avec le temps : à tester, pas à supposer",
    ],
    note: 'Deux chaînes complètes et indépendantes, jusqu’aux deux alimentations de chaque équipement. Un équipement mono-alimentation annule le bénéfice : repérez-le et posez un commutateur de transfert (STS).',
  },
  {
    id: 'ups-n1',
    label: 'Onduleurs en parallèle (N+1)',
    famille: 'energie',
    planDeDonnees: 'tous',
    noteDonnees:
      "Tous les modules débitent en parallèle. Le module supplémentaire n'est une réserve que si la charge reste sous la capacité de N modules.",
    vendors: [],
    kinds: ['ups'],
    membres: { min: 2 },
    roles: ['active-active'],
    bascule: 'Aucune : la charge se répartit',
    note: 'Un module de plus que nécessaire sur la même chaîne : protège d’une panne d’onduleur, pas d’un défaut d’arrivée électrique. Vérifiez l’autonomie batterie réelle et sa date de remplacement.',
  },
]

const PAR_ID = new Map(MECANISMES_HA.map((mecanisme) => [mecanisme.id, mecanisme]))

/**
 * Identifiants abandonnés, redirigés vers leur remplaçant : un schéma enregistré avant la
 * séparation des modes Palo Alto doit continuer à s'ouvrir sans perdre son mécanisme.
 */
const ALIAS: Record<string, string> = {
  'pan-ha': 'pan-ha-ap',
}

/**
 * Retrouve un mécanisme d'après ce qu'on en dit : son identifiant, un alias, ou son libellé —
 * « stackwise-virtual », « vss », « StackWise Virtual ». Sert aux imports, où l'on écrit le
 * nom d'usage plutôt que l'identifiant interne.
 */
export function trouverMecanisme(valeur: string): MecanismeHa | undefined {
  const propre = valeur.trim()
  if (!propre) return undefined
  const direct = mecanismeHa(propre.toLowerCase())
  if (direct) return direct
  const simple = (texte: string) =>
    texte
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  const cherche = simple(propre)
  return (
    MECANISMES_HA.find((mecanisme) => simple(mecanisme.label) === cherche) ??
    MECANISMES_HA.find((mecanisme) => simple(mecanisme.label).includes(cherche) && cherche.length >= 3)
  )
}

export function mecanismeHa(id?: string): MecanismeHa | undefined {
  if (!id) return undefined
  return PAR_ID.get(id) ?? PAR_ID.get(ALIAS[id] ?? '')
}

/**
 * Plan de données réellement en vigueur dans une grappe.
 *
 * Quinze mécanismes sur soixante-cinq acceptent les deux modes : pour eux, la réponse n'est
 * pas dans la base, elle est dans ce qui a été déclaré. Un rôle « actif / actif » sur un
 * membre dit que tous acheminent ; un « passif » dit qu'un seul le fait. Tant que rien n'est
 * déclaré, la question reste ouverte — et c'est bien ce que la fonction renvoie, plutôt que
 * de trancher à la place de celui qui exploite.
 */
export function planDeDonneesEffectif(mecanisme: MecanismeHa, roles: HaRole[]): PlanDeDonnees {
  if (mecanisme.planDeDonnees !== 'selon-mode') return mecanisme.planDeDonnees
  if (roles.includes('active-active')) return 'tous'
  if (roles.includes('passive')) return 'un-seul'
  return 'selon-mode'
}

/**
 * Le rôle déclaré ne décrit-il que le plan de contrôle ?
 *
 * C'est le cas du châssis virtuel, et de lui seul : le mécanisme élit un actif et un
 * veilleur, et pourtant tous les membres acheminent. Partout ailleurs, « passif » veut bien
 * dire « ne traite rien ».
 */
export function roleDecritLeControleSeul(mecanisme: MecanismeHa): boolean {
  return mecanisme.planDeDonnees === 'tous' && mecanisme.roles.includes('passive')
}

/** Le mécanisme concerne-t-il ce constructeur ? (liste vide = tous). */
export function concerneConstructeur(mecanisme: MecanismeHa, vendor?: string): boolean {
  if (mecanisme.vendors.length === 0) return true
  if (!vendor?.trim()) return false
  const cle = cleConstructeur(vendor)
  return mecanisme.vendors.some((connu) => cle.includes(connu) || connu.includes(cle))
}

/**
 * Constructeur d'un équipement, déduit du champ « Constructeur » ou, à défaut, du modèle.
 *
 * Beaucoup de parcs ne renseignent que le modèle (« FortiGate 100F ») : la reconnaissance
 * des gammes, déjà utilisée pour les monogrammes, sert ici à proposer les bons mécanismes.
 */
export function constructeurDe(vendor?: string, model?: string): string | undefined {
  if (vendor?.trim()) return vendor.trim()
  return vendorMark(vendor, model)?.label
}

/**
 * Mécanismes proposés pour un équipement, en trois groupes : ceux de son constructeur, les
 * mécanismes normalisés (VRRP, EVPN, sauvegarde…) et le reste de ce type d'équipement.
 *
 * On ne masque jamais les autres : un parc réel mélange les époques et les constructeurs,
 * et la liste doit rester une aide, pas une contrainte.
 */
export function mecanismesPour(kind: string, vendor?: string): {
  propres: MecanismeHa[]
  normalises: MecanismeHa[]
  autres: MecanismeHa[]
} {
  const duType = MECANISMES_HA.filter((mecanisme) => mecanisme.kinds.includes(kind))
  const propres = duType.filter(
    (mecanisme) => mecanisme.vendors.length > 0 && concerneConstructeur(mecanisme, vendor),
  )
  const normalises = duType.filter((mecanisme) => mecanisme.vendors.length === 0)
  const autres = duType.filter(
    (mecanisme) => !propres.includes(mecanisme) && !normalises.includes(mecanisme),
  )
  return { propres, normalises, autres }
}

/**
 * Le mécanisme correspond-il à la gamme du modèle saisi ?
 *
 * Renvoie `null` quand la question ne se pose pas : pas de modèle renseigné, ou mécanisme
 * qui ne vise aucune gamme particulière.
 */
export function concerneGamme(mecanisme: MecanismeHa, model?: string): boolean | null {
  if (!mecanisme.gammes || mecanisme.gammes.length === 0) return null
  const modele = model?.trim()
  if (!modele) return null
  const cible = cleConstructeur(modele)
  return mecanisme.gammes.some((motif) => new RegExp(motif, 'i').test(cible))
}

/**
 * Mécanisme le plus probable pour une grappe, d'après le type d'équipement, le constructeur
 * et le type de liaison déjà tracé entre les membres.
 *
 * C'est une proposition, pas une déduction : elle fait gagner la saisie sur les cas
 * évidents (deux FortiGate reliés par un battement de cœur, deux Nexus par un lien de pile)
 * et laisse le reste à l'architecte.
 */
export function proposerMecanisme(
  kind: string,
  vendor: string | undefined,
  lien: LinkKind | undefined,
  membres: number,
  model?: string,
): MecanismeHa | undefined {
  const { propres, normalises, autres } = mecanismesPour(kind, vendor)
  // Un mécanisme du constructeur est toujours plus précis qu'un mécanisme normalisé, et la
  // gamme du modèle tranche entre deux mécanismes du même constructeur.
  const deLaGamme = propres.filter((mecanisme) => concerneGamme(mecanisme, model) === true)
  const candidats =
    deLaGamme.length > 0
      ? deLaGamme
      : propres.length > 0
        ? propres.filter((mecanisme) => concerneGamme(mecanisme, model) !== false)
        : normalises.length > 0
          ? normalises
          : autres

  const compatibles = candidats.filter((mecanisme) => {
    if (membres < mecanisme.membres.min) return false
    if (mecanisme.membres.max && membres > mecanisme.membres.max) return false
    if (lien && mecanisme.lien && !mecanisme.lien.kind.includes(lien)) return false
    return true
  })
  const liste = compatibles.length > 0 ? compatibles : candidats

  // Le lien tracé tranche entre deux mécanismes d'un même constructeur : un lien de pile
  // désigne un châssis virtuel, un battement de cœur une grappe à deux plans de contrôle.
  if (lien === 'stack') {
    const parLien = liste.find((mecanisme) => mecanisme.famille === 'paire-l2') ??
      liste.find((mecanisme) => mecanisme.famille === 'chassis')
    if (parLien) return parLien
  }
  if (lien === 'heartbeat') {
    const parLien = liste.find((mecanisme) => mecanisme.lien?.kind.includes('heartbeat'))
    if (parLien) return parLien
  }
  return liste[0]
}

/**
 * Mécanisme de la même famille qui, lui, correspond à la gamme du modèle : ce qu'il faut
 * proposer quand on signale une confusion (« sur un Catalyst 9500, c'est StackWise Virtual »).
 */
export function mecanismeDeLaGamme(
  reference: MecanismeHa,
  kind: string,
  vendor: string | undefined,
  model: string | undefined,
): MecanismeHa | undefined {
  if (!model?.trim()) return undefined
  const { propres } = mecanismesPour(kind, vendor)
  return propres.find(
    (candidat) => candidat.id !== reference.id && concerneGamme(candidat, model) === true,
  )
}

/** Regroupement par famille, pour les listes déroulantes et la documentation. */
export function mecanismesParFamille(): { famille: FamilleHa; titre: string; mecanismes: MecanismeHa[] }[] {
  return (Object.keys(FAMILLES_HA) as FamilleHa[]).map((famille) => ({
    famille,
    titre: FAMILLES_HA[famille],
    mecanismes: MECANISMES_HA.filter((mecanisme) => mecanisme.famille === famille),
  }))
}
