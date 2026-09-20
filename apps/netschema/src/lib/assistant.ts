/**
 * Assistant de conception : décrire une infrastructure en français, obtenir un schéma.
 *
 * Ce n'est pas un modèle de langage et cela ne prétend pas l'être : aucune donnée ne sort du
 * poste, rien n'est envoyé sur Internet, et deux fois la même phrase donne deux fois le même
 * schéma. C'est un analyseur de langage contraint, adossé à ce que l'application sait déjà —
 * le catalogue d'équipements et ses synonymes, les couches, les règles de liaison, les
 * mécanismes de haute disponibilité, la base constructeurs.
 *
 * Il fait trois choses qu'on fait autrement à la main :
 *
 * 1. **construire** : « deux pare-feu Fortinet en grappe, deux switches cœur en MLAG, quatre
 *    switches d'accès et trois hyperviseurs avec témoin » devient un schéma câblé, avec les
 *    grappes, les rôles, les mécanismes de bascule et les liaisons entre couches ;
 * 2. **raccorder** ce qu'il crée au schéma existant, en respectant l'ordre des couches ;
 * 3. **proposer** les corrections qu'il sait appliquer lui-même — lien de battement de cœur
 *    manquant, second attachement, témoin de quorum, sauvegarde absente, agrégat non déclaré.
 *
 * Il annonce toujours ce qu'il va faire avant de le faire : l'application ne modifie rien
 * tant que le plan n'est pas accepté.
 */

import { allDevices, deviceMeta, LAYER_LABELS, rankOf } from './catalog'
import { proposerMecanisme } from './haTech'
import { suggestLinkKind } from './linkRules'
import { prepareSpeech } from './speech'
import { vendorMark } from './vendorMarks'
import type { Diagram, LinkKind, NetLink, NetNode } from '../types'

// ─── Plan ────────────────────────────────────────────────────────────────────

export type OperationPlan =
  | { type: 'noeud'; nom: string; kind: string; patch?: Partial<NetNode> }
  | { type: 'liaison'; de: string; vers: string; kind: LinkKind; patch?: Partial<NetLink> }
  | { type: 'champs'; nom: string; patch: Partial<NetNode> }
  | { type: 'liaisonPatch'; de: string; vers: string; patch: Partial<NetLink> }

export interface EtapePlan {
  titre: string
  detail: string
  operations: OperationPlan[]
}

export interface PlanAssistant {
  etapes: EtapePlan[]
  /** Fragments de la demande qui n'ont pas été compris : on le dit plutôt que de deviner. */
  ignores: string[]
  noeuds: number
  liaisons: number
}

// ─── Conventions de nommage ──────────────────────────────────────────────────

/**
 * Préfixe de nom par type d'équipement. Un schéma se lit d'abord par ses noms : « SW-ACC-01 »
 * dit ce qu'il est et où il est, « Switch accès 1 » ne dit rien qu'on ne voie déjà.
 */
const PREFIXES: Record<string, string> = {
  router: 'RTR',
  sdwan: 'SDWAN',
  'router-5g': 'RTR-5G',
  modem: 'ONT',
  firewall: 'FW',
  ngfw: 'FW',
  waf: 'WAF',
  ips: 'IPS',
  'vpn-concentrator': 'VPN',
  loadbalancer: 'LB',
  'core-switch': 'SW-CORE',
  switch: 'SW-DIST',
  'access-switch': 'SW-ACC',
  spine: 'SPINE',
  leaf: 'LEAF',
  'san-switch': 'SW-SAN',
  'industrial-switch': 'SW-IND',
  'patch-panel': 'PP',
  'console-server': 'OOB',
  wifi: 'AP',
  wifi7: 'AP',
  'wlan-controller': 'WLC',
  'net-controller': 'CTRL',
  server: 'SRV',
  hypervisor: 'ESXi',
  hci: 'NODE',
  baremetal: 'SRV',
  'gpu-server': 'GPU',
  storage: 'SAN',
  'nvme-storage': 'NVME',
  'object-storage': 'S3',
  backup: 'BKP',
  'tape-backup': 'LTO',
  witness: 'QUORUM',
  ipbx: 'IPBX',
  'voice-gateway': 'GW-VOIX',
  ddi: 'DDI',
  idp: 'AD',
  nms: 'NMS',
  siem: 'SIEM',
  ups: 'UPS',
  pdu: 'PDU',
  workstation: 'PC',
  printer: 'IMP',
  phone: 'TEL',
  camera: 'CAM',
  wan: 'Opérateur',
  internet: 'Internet',
  cloud: 'Cloud',
}

function prefixeDe(kind: string): string {
  if (PREFIXES[kind]) return PREFIXES[kind]
  const label = deviceMeta(kind).label
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .slice(0, 8)
    .replace(/-$/, '')
}

/** Noms libres, numérotés à la suite de ce que le schéma contient déjà. */
function nommer(base: string, combien: number, pris: Set<string>): string[] {
  const noms: string[] = []
  if (combien === 1) {
    // Un équipement unique ne se numérote que s'il a déjà un homonyme.
    if (!pris.has(base.toLowerCase())) {
      pris.add(base.toLowerCase())
      return [base]
    }
  }
  let index = 1
  while (noms.length < combien) {
    const candidat = `${base}-${String(index).padStart(2, '0')}`
    index += 1
    if (pris.has(candidat.toLowerCase())) continue
    pris.add(candidat.toLowerCase())
    noms.push(candidat)
  }
  return noms
}

// ─── Analyse de la demande ───────────────────────────────────────────────────

interface Groupe {
  kind: string
  noms: string[]
  vendor?: string
  zone?: string
  site?: string
  cluster?: string
  haTech?: string
  roles?: NetNode['role'][]
  temoin?: boolean
  rang: number
  clause: string
}

/** Découpe la demande en propositions : une par groupe d'équipements. */
function clauses(texte: string): string[] {
  return texte
    .split(/[,;\n]+|\bpuis\b|\bavec ensuite\b/i)
    .map((morceau) => morceau.trim())
    .filter((morceau) => morceau.length > 2)
}

/** Quantité en tête de proposition : « 4 », « quatre », « une paire de », « un ». */
function quantite(normalise: string): number {
  const paire = /\b(paire|duo|couple)\b/.test(normalise)
  if (paire) return 2
  const trio = /\b(trio|triplet)\b/.test(normalise)
  if (trio) return 3
  const nombre = normalise.match(/(?:^|\s)(\d{1,3})(?=\s|$)/)
  if (nombre) {
    const valeur = Number(nombre[1])
    // Un nombre à trois chiffres est presque toujours un modèle (« PA-450 ») : on l'ignore.
    if (valeur >= 1 && valeur <= 60) return valeur
  }
  return 1
}

/** Mots qui qualifient la demande sans désigner un type d'équipement. */
const QUALIFICATIFS =
  /\b(en|une|un|des|de|du|la|le|les|avec|et|paire|duo|couple|trio|grappe|cluster|ha|haute|disponibilite|redonde|redondes|redondee|redondees|actif|passif|actifs|passifs|temoin|quorum|zone|site|par|pour|dans|sur|nommes?|nommees?|appeles?|appelees?)\b/g

/** Normalisation commune au catalogue : ligature, accents, casse. */
function normaliser(valeur: string): string {
  return valeur
    .replace(/[œŒ]/g, 'oe')
    .replace(/[æÆ]/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Pluriels retirés mot à mot : « switches d'accès » doit rencontrer « Switch accès ». */
function sansPluriel(valeur: string): string {
  return valeur.replace(/(\w{3,}?)(?:es|s|x)\b/g, '$1')
}

/** Mots significatifs d'un libellé ou d'une demande. */
function mots(valeur: string): string[] {
  return sansPluriel(normaliser(valeur))
    .split(/[^a-z0-9]+/)
    .filter((mot) => mot.length > 1)
}

/**
 * Qualité du rapprochement entre une demande et un type du catalogue.
 *
 * On compte les mots communs plutôt que d'accepter le premier candidat venu : « switches
 * d'accès » partage ses deux mots avec « Switch accès » et un seul avec « Switch
 * distribution », alors que les deux contiennent « switch ». Les mots du libellé restés sans
 * correspondance pèsent en sens inverse, sans quoi un type au nom long gagnerait toujours.
 */
function scoreType(
  device: { label: string; id: string; aliases?: string[] },
  demande: string[],
): number {
  if (demande.length === 0) return 0
  let meilleur = 0
  for (const brut of [device.label, device.id, ...(device.aliases ?? [])]) {
    const cible = mots(brut)
    if (cible.length === 0) continue
    const communs = cible.filter((mot) =>
      demande.some((attendu) => attendu === mot || attendu.startsWith(mot) || mot.startsWith(attendu)),
    ).length
    if (communs === 0) continue
    const score = communs * 10 - (cible.length - communs) * 3 - (demande.length - communs)
    meilleur = Math.max(meilleur, score)
  }
  return meilleur
}

/** Type du catalogue qui correspond le mieux à la demande, ou rien. */
function chercherType(requete: string): string | undefined {
  const demande = mots(requete)
  if (demande.length === 0) return undefined
  let gagnant: { id: string; score: number } | undefined
  for (const device of allDevices()) {
    if (device.unknown) continue
    const score = scoreType(device, demande)
    if (score > 0 && (!gagnant || score > gagnant.score)) gagnant = { id: device.id, score }
  }
  return gagnant?.id
}

/**
 * Type d'équipement d'une proposition.
 *
 * On retire d'abord les qualificatifs — sans quoi « deux pare-feu en grappe » se cherche
 * tout entier dans le catalogue — puis on interroge le catalogue, qui connaît déjà les
 * libellés, les identifiants et les synonymes. En dernier recours seulement, mot à mot.
 */
function typeDemande(brut: string): string | undefined {
  // Double normalisation : la dictée écrit les nombres en lettres, la frappe garde les
  // accents. Les deux doivent aboutir au même texte avant d'interroger le catalogue.
  const sansChiffres = normaliser(brut).replace(/\b\d+\b/g, ' ')
  const epure = sansChiffres.replace(QUALIFICATIFS, ' ').replace(/\s+/g, ' ').trim()
  for (const candidat of [epure, sansChiffres.trim()]) {
    const trouve = chercherType(candidat)
    if (trouve) return trouve
  }
  const mots = epure.split(/\s+/).filter((mot) => mot.length > 2)
  // Les groupes de deux mots d'abord (« switch coeur »), puis les mots seuls.
  for (let taille = Math.min(3, mots.length); taille >= 1; taille -= 1) {
    for (let debut = 0; debut + taille <= mots.length; debut += 1) {
      const trouve = chercherType(mots.slice(debut, debut + taille).join(' '))
      if (trouve) return trouve
    }
  }
  return undefined
}

/** Valeur qui suit un mot-clé, en gardant la casse d'origine. */
function valeurApres(brut: string, motif: RegExp): string | undefined {
  const trouve = brut.match(motif)
  return trouve?.[1]?.trim().replace(/^["'«»\s]+|["'«»\s.]+$/g, '') || undefined
}

/**
 * Une proposition qui ne désigne aucun équipement mais précise le groupe précédent :
 * « zone DMZ », « site de secours », « en actif/passif ». Renvoie ce qu'elle apporte.
 */
function qualificatifSeul(clause: string):
  | { zone?: string; site?: string; roles?: 'active-active' | 'active-passive' }
  | null {
  const normalise = prepareSpeech(clause)
  /*
    Le signal fiable est la tête de proposition : « zone DMZ » commence par « zone », et
    cela suffit à savoir que ce n'est pas un équipement — sans quoi « dmz », synonyme de la
    passerelle industrielle, ferait apparaître une passerelle.
  */
  const entete = /^\s*(en|zone|site|dans|sur|pour|avec)\b/i.test(clause)
  if (!entete && typeDemande(normalise)) return null
  const zone = valeurApres(clause, /\bzone\s+(.+)$/i)
  const site = valeurApres(clause, /\bsite\s+(.+)$/i)
  const actifActif = /\bactif[\s/-]*actif\b/.test(normalise)
  const actifPassif = /\bactif[\s/-]*passif\b/.test(normalise)
  if (!zone && !site && !actifActif && !actifPassif) return null
  return {
    zone,
    site,
    roles: actifActif ? 'active-active' : actifPassif ? 'active-passive' : undefined,
  }
}

function analyserClause(
  clause: string,
  pris: Set<string>,
  grappesPrises: Set<string>,
): Groupe | null {
  const normalise = prepareSpeech(clause)
  const kind = typeDemande(normalise)
  if (!kind) return null

  const combien = quantite(normalise)
  const vendor = vendorMark(undefined, clause)?.label
  const zone = valeurApres(clause, /\bzone\s+([^,;]+)/i)
  const site = valeurApres(clause, /\bsite\s+([^,;]+)/i)
  const nomDemande = valeurApres(clause, /\b(?:nomm[ée]s?|appel[ée]s?|nom)\s+([^,;]+)/i)

  const groupe = /\b(grappe|cluster|ha|haute disponibilite|redond)/.test(normalise) && combien > 1
  const actifActif = /\bactif[\s/-]*actif\b|\bactifs?\b(?!\s*[/-]?\s*passif)/.test(normalise)
  const actifPassif = /\bactif[\s/-]*passif\b/.test(normalise)
  const temoin = /\bt[ée]moin\b|\bquorum\b|\barbitre\b/.test(prepareSpeech(clause)) ||
    /\bt[ée]moin\b|\bquorum\b/i.test(clause)

  const base = nomDemande ?? prefixeDe(kind)
  const noms = nommer(base, combien, pris)

  const roles = groupe
    ? noms.map((_, position) =>
        actifPassif
          ? position === 0
            ? ('active' as const)
            : ('passive' as const)
          : actifActif || combien > 2
            ? ('active-active' as const)
            : position === 0
              ? ('active' as const)
              : ('passive' as const),
      )
    : undefined

  let cluster: string | undefined
  if (groupe) {
    const base = `${prefixeDe(kind)}-HA`
    cluster = base
    let suffixe = 2
    while (grappesPrises.has(cluster.toLowerCase())) {
      cluster = `${base}-${suffixe}`
      suffixe += 1
    }
    grappesPrises.add(cluster.toLowerCase())
  }

  return {
    kind,
    noms,
    vendor,
    zone,
    site,
    cluster,
    roles,
    temoin,
    rang: rankOf(kind, null),
    clause: clause.trim(),
  }
}

// ─── Construction du plan ────────────────────────────────────────────────────

/** Liaison de synchronisation d'une grappe, selon ce que ses membres sont. */
function lienDeGrappe(kind: string): LinkKind {
  const commutation = ['core-switch', 'switch', 'access-switch', 'spine', 'leaf']
  return commutation.includes(kind) ? 'stack' : 'heartbeat'
}

/**
 * Transforme une description en plan.
 *
 * Le schéma existant sert de contexte : les noms déjà pris ne sont pas réutilisés, et le
 * premier groupe créé se raccroche à ce qui le précède dans les couches — ajouter « quatre
 * switches d'accès » à un schéma qui a déjà une distribution les y raccorde.
 */
export function analyserDescription(texte: string, diagram: Diagram): PlanAssistant {
  const pris = new Set(diagram.nodes.map((node) => node.name.trim().toLowerCase()))
  const grappesPrises = new Set(
    diagram.nodes.map((node) => node.cluster?.trim().toLowerCase()).filter(Boolean) as string[],
  )
  const groupes: Groupe[] = []
  const ignores: string[] = []

  for (const clause of clauses(texte)) {
    // « …, zone DMZ » n'est pas un équipement : c'est la suite de la proposition précédente,
    // que la virgule a coupée. On la rattache plutôt que d'inventer un équipement.
    const complement = qualificatifSeul(clause)
    if (complement && groupes.length > 0) {
      const precedent = groupes[groupes.length - 1]
      precedent.zone = complement.zone ?? precedent.zone
      precedent.site = complement.site ?? precedent.site
      if (complement.roles && precedent.noms.length > 1) {
        precedent.roles = precedent.noms.map((_, position) =>
          complement.roles === 'active-active'
            ? ('active-active' as const)
            : position === 0
              ? ('active' as const)
              : ('passive' as const),
        )
      }
      continue
    }
    const groupe = analyserClause(clause, pris, grappesPrises)
    if (groupe) groupes.push(groupe)
    else ignores.push(clause.trim())
  }

  if (groupes.length === 0) return { etapes: [], ignores, noeuds: 0, liaisons: 0 }

  // Les groupes se raccordent dans l'ordre des couches, pas dans l'ordre de la phrase.
  const ordonnes = [...groupes].sort((a, b) => a.rang - b.rang)
  const etapes: EtapePlan[] = []
  let noeuds = 0
  let liaisons = 0

  for (const groupe of ordonnes) {
    const operations: OperationPlan[] = []
    const meta = deviceMeta(groupe.kind)
    const modele = groupe.vendor ? { vendor: groupe.vendor } : {}

    for (const [position, nom] of groupe.noms.entries()) {
      operations.push({
        type: 'noeud',
        nom,
        kind: groupe.kind,
        patch: {
          ...modele,
          zone: groupe.zone,
          site: groupe.site,
          cluster: groupe.cluster,
          role: groupe.roles?.[position],
          dualPower: doubleAlimentable(groupe.kind) ? true : undefined,
        },
      })
      noeuds += 1
    }

    // Lien de synchronisation et mécanisme de bascule de la grappe.
    if (groupe.cluster && groupe.noms.length > 1) {
      const kindLien = lienDeGrappe(groupe.kind)
      for (let index = 1; index < groupe.noms.length; index += 1) {
        operations.push({
          type: 'liaison',
          de: groupe.noms[index - 1],
          vers: groupe.noms[index],
          kind: kindLien,
          patch: { label: kindLien === 'stack' ? 'Lien de pile' : 'Synchro HA' },
        })
        liaisons += 1
      }
      const mecanisme = proposerMecanisme(
        groupe.kind,
        groupe.vendor,
        kindLien,
        groupe.noms.length,
      )
      if (mecanisme) {
        for (const nom of groupe.noms) {
          operations.push({ type: 'champs', nom, patch: { haTech: mecanisme.id } })
        }
      }
      groupe.haTech = mecanisme?.id
    }

    // Témoin de quorum demandé explicitement.
    if (groupe.temoin && groupe.cluster) {
      const nomTemoin = nommer('QUORUM', 1, pris)[0]
      operations.push({
        type: 'noeud',
        nom: nomTemoin,
        kind: 'witness',
        patch: { cluster: groupe.cluster, role: 'witness', site: groupe.site },
      })
      noeuds += 1
      for (const nom of groupe.noms.slice(0, 2)) {
        operations.push({ type: 'liaison', de: nomTemoin, vers: nom, kind: 'oob', patch: { label: 'Quorum' } })
        liaisons += 1
      }
    }

    etapes.push({
      titre: `${groupe.noms.length} × ${meta.label}${groupe.vendor ? ` ${groupe.vendor}` : ''}`,
      detail: [
        groupe.noms.join(', '),
        groupe.cluster ? `grappe ${groupe.cluster}` : '',
        groupe.haTech ? `mécanisme proposé` : '',
        groupe.zone ? `zone ${groupe.zone}` : '',
        groupe.site ? `site ${groupe.site}` : '',
        `couche ${LAYER_LABELS[groupe.rang] ?? groupe.rang}`,
      ]
        .filter(Boolean)
        .join(' · '),
      operations,
    })
  }

  // ── Raccordement entre couches ────────────────────────────────────────────
  const raccords: OperationPlan[] = []
  const detailRaccords: string[] = []

  /** Équipements déjà présents, par couche, pour accrocher le nouveau bloc au schéma. */
  const existantsParRang = new Map<number, NetNode[]>()
  for (const node of diagram.nodes) {
    const rang = rankOf(node.kind, node.rank)
    const liste = existantsParRang.get(rang)
    if (liste) liste.push(node)
    else existantsParRang.set(rang, [node])
  }

  const relier = (bas: Groupe, hautNoms: string[], hautKind: string) => {
    if (hautNoms.length === 0) return
    for (const [index, nom] of bas.noms.entries()) {
      // Deux équipements en face : double attachement. Au-delà, on répartit.
      const cibles =
        hautNoms.length <= 2 ? hautNoms : [hautNoms[index % hautNoms.length]]
      for (const [position, cible] of cibles.entries()) {
        const kind = suggestLinkKind(
          { id: '', kind: bas.kind, name: nom, x: 0, y: 0, cluster: bas.cluster },
          { id: '', kind: hautKind, name: cible, x: 0, y: 0 },
        )
        raccords.push({
          type: 'liaison',
          de: cible,
          vers: nom,
          kind,
          patch: position > 0 ? { redundant: true } : undefined,
        })
        liaisons += 1
      }
    }
    detailRaccords.push(`${bas.noms.length} × ${deviceMeta(bas.kind).label} → ${hautNoms.join(', ')}`)
  }

  /** Commutation, du plus central au plus proche des postes : l'ordre de raccordement. */
  const PRIORITE_AMONT = ['core-switch', 'spine', 'leaf', 'switch', 'access-switch']

  /**
   * Groupe auquel raccorder celui-ci.
   *
   * Le rang seul ne suffit pas : un serveur se raccorde au cœur ou à la distribution, pas au
   * switch d'accès du bâtiment, même si celui-ci est juste au-dessus de lui dans les couches.
   */
  const amontDe = (groupe: Groupe, position: number): Groupe | undefined => {
    const superieurs = ordonnes.slice(0, position).filter((autre) => autre.rang < groupe.rang)
    if (superieurs.length === 0) return undefined
    if (groupe.rang >= 6) {
      for (const kind of PRIORITE_AMONT) {
        const trouve = superieurs.find((autre) => autre.kind === kind)
        if (trouve) return trouve
      }
    }
    return superieurs[superieurs.length - 1]
  }

  for (const [index, groupe] of ordonnes.entries()) {
    // L'énergie ne se raccorde pas comme le reste : elle alimente, elle ne transporte pas.
    if (groupe.rang >= 8) {
      const pdu = ordonnes.find((autre) => autre.kind === 'pdu' && autre !== groupe)
      const critiques = ordonnes.filter(
        (autre) => autre.rang < 8 && deviceMeta(autre.kind).critical,
      )
      const cibles = groupe.kind === 'ups' && pdu ? pdu.noms : critiques.flatMap((autre) => autre.noms).slice(0, 4)
      for (const [position, nom] of groupe.noms.entries()) {
        const cible = cibles[position % Math.max(1, cibles.length)]
        if (!cible) continue
        raccords.push({
          type: 'liaison',
          de: nom,
          vers: cible,
          kind: 'power',
          patch: { label: `Chaîne ${String.fromCharCode(65 + position)}` },
        })
        liaisons += 1
      }
      if (cibles.length > 0) detailRaccords.push(`${groupe.noms.length} × ${deviceMeta(groupe.kind).label} → alimentation`)
      continue
    }

    const precedent = amontDe(groupe, index)
    if (precedent) {
      relier(groupe, precedent.noms, precedent.kind)
      continue
    }
    if (index > 0) continue
    // Premier groupe : on l'accroche à ce que le schéma contient déjà au-dessus.
    const rangsSuperieurs = [...existantsParRang.keys()].filter((rang) => rang < groupe.rang).sort((a, b) => b - a)
    const voisins = rangsSuperieurs.length > 0 ? (existantsParRang.get(rangsSuperieurs[0]) ?? []) : []
    if (voisins.length > 0) {
      relier(groupe, voisins.slice(0, 2).map((node) => node.name), voisins[0].kind)
    }
  }

  if (raccords.length > 0) {
    etapes.push({
      titre: `${raccords.length} liaison(s) entre les couches`,
      detail: detailRaccords.join(' · '),
      operations: raccords,
    })
  }

  return { etapes, ignores, noeuds, liaisons }
}

// ─── Suggestions applicables ─────────────────────────────────────────────────

export interface Suggestion {
  id: string
  titre: string
  detail: string
  /** Ce que l'application changera, à afficher avant d'appliquer. */
  operations: OperationPlan[]
}

const KINDS_CALCUL = new Set(['hypervisor', 'hci', 'server', 'storage', 'nvme-storage', 'backup'])

/**
 * Corrections que l'assistant sait appliquer lui-même.
 *
 * L'analyse de haute disponibilité et le contrôle de dossier disent déjà ce qui manque ; ici
 * on ne retient que ce qui se corrige sans décision humaine — ajouter un lien de battement
 * de cœur ne se discute pas, choisir une zone si.
 */
export function suggestionsAssistant(diagram: Diagram): Suggestion[] {
  const suggestions: Suggestion[] = []
  const parId = new Map(diagram.nodes.map((node) => [node.id, node]))
  const nom = (id: string) => parId.get(id)?.name ?? id

  // Grappes : lien de synchronisation et témoin.
  const grappes = new Map<string, NetNode[]>()
  for (const node of diagram.nodes) {
    const cluster = node.cluster?.trim()
    if (!cluster) continue
    const liste = grappes.get(cluster)
    if (liste) liste.push(node)
    else grappes.set(cluster, [node])
  }

  for (const [cluster, membres] of grappes) {
    if (membres.length < 2) continue
    const ids = new Set(membres.map((membre) => membre.id))
    const synchro = diagram.links.some(
      (link) =>
        ids.has(link.from) && ids.has(link.to) && (link.kind === 'heartbeat' || link.kind === 'stack'),
    )
    if (!synchro) {
      const kind = lienDeGrappe(membres[0].kind)
      suggestions.push({
        id: `hb:${cluster}`,
        titre: `Relier les membres de « ${cluster} »`,
        detail: `Aucune liaison de synchronisation entre ${membres[0].name} et ${membres[1].name} : sans elle, la bascule ne s'arbitre pas.`,
        operations: [
          {
            type: 'liaison',
            de: membres[0].name,
            vers: membres[1].name,
            kind,
            patch: { label: kind === 'stack' ? 'Lien de pile' : 'Synchro HA' },
          },
        ],
      })
    }

    const besoinTemoin =
      membres.length === 2 && membres.some((membre) => KINDS_CALCUL.has(membre.kind))
    const temoin = membres.some((membre) => membre.role === 'witness' || membre.kind === 'witness')
    if (besoinTemoin && !temoin) {
      const pris = new Set(diagram.nodes.map((node) => node.name.toLowerCase()))
      const nomTemoin = nommer('QUORUM', 1, pris)[0]
      suggestions.push({
        id: `temoin:${cluster}`,
        titre: `Ajouter un témoin de quorum à « ${cluster} »`,
        detail:
          'Une grappe de calcul ou de données à deux nœuds peut partir en cerveau divisé : le témoin départage.',
        operations: [
          {
            type: 'noeud',
            nom: nomTemoin,
            kind: 'witness',
            patch: { cluster, role: 'witness', site: membres[0].site },
          },
          { type: 'liaison', de: nomTemoin, vers: membres[0].name, kind: 'oob', patch: { label: 'Quorum' } },
          { type: 'liaison', de: nomTemoin, vers: membres[1].name, kind: 'oob', patch: { label: 'Quorum' } },
        ],
      })
    }
  }

  // Double attachement : un équipement d'infrastructure relié à un seul équipement amont.
  const transport = diagram.links.filter((link) => link.kind !== 'power' && link.kind !== 'oob')
  for (const node of diagram.nodes) {
    const meta = deviceMeta(node.kind)
    if (!meta.infrastructure || meta.rank <= 1 || meta.rank > 5) continue
    const amonts = transport
      .filter((link) => link.from === node.id || link.to === node.id)
      .map((link) => (link.from === node.id ? link.to : link.from))
      .map((id) => parId.get(id))
      .filter((voisin): voisin is NetNode => !!voisin && rankOf(voisin.kind, voisin.rank) < meta.rank)
    if (amonts.length !== 1) continue
    const amont = amonts[0]
    // Un second amont de même nature : le pair de la grappe, ou un équipement du même rang.
    const second = diagram.nodes.find(
      (candidat) =>
        candidat.id !== amont.id &&
        candidat.kind === amont.kind &&
        !transport.some(
          (link) =>
            (link.from === node.id && link.to === candidat.id) ||
            (link.to === node.id && link.from === candidat.id),
        ),
    )
    if (!second) continue
    suggestions.push({
      id: `double:${node.id}`,
      titre: `Doubler le raccordement de ${node.name}`,
      detail: `Un seul lien montant, vers ${amont.name} : un second vers ${second.name} supprime le point de défaillance.`,
      operations: [
        {
          type: 'liaison',
          de: second.name,
          vers: node.name,
          kind: suggestLinkKind(second, node),
          patch: { redundant: true },
        },
      ],
    })
  }

  // Liens parallèles non déclarés en agrégat.
  const paires = new Map<string, NetLink[]>()
  for (const link of transport) {
    const cle = [link.from, link.to].sort().join('~')
    const liste = paires.get(cle)
    if (liste) liste.push(link)
    else paires.set(cle, [link])
  }
  for (const [cle, groupe] of paires) {
    if (groupe.length < 2) continue
    if (groupe.some((link) => link.kind === 'trunk' || link.kind === 'stack')) continue
    const [a, b] = cle.split('~')
    suggestions.push({
      id: `lacp:${cle}`,
      titre: `Déclarer l'agrégat entre ${nom(a)} et ${nom(b)}`,
      detail: `${groupe.length} liens parallèles : en agrégat LACP, ils forment un seul lien logique et se partagent la charge.`,
      operations: groupe.map((link) => ({
        type: 'liaisonPatch' as const,
        de: nom(link.from),
        vers: nom(link.to),
        patch: { kind: 'trunk' as LinkKind, lag: 'Po1' },
      })),
    })
  }

  // Double alimentation des équipements critiques, dès qu'une chaîne double existe.
  const onduleurs = diagram.nodes.filter((node) => node.kind === 'ups')
  if (onduleurs.length >= 2) {
    const nus = diagram.nodes.filter(
      (node) => doubleAlimentable(node.kind) && node.kind !== 'ups' && !node.dualPower,
    )
    if (nus.length > 0) {
      suggestions.push({
        id: 'dualpower',
        titre: `Déclarer la double alimentation de ${nus.length} équipement(s)`,
        detail: `Deux chaînes ondulées existent : ${nus
          .slice(0, 4)
          .map((node) => node.name)
          .join(', ')}${nus.length > 4 ? '…' : ''} sont pourtant déclarés mono-alimentés.`,
        operations: nus.map((node) => ({
          type: 'champs' as const,
          nom: node.name,
          patch: { dualPower: true },
        })),
      })
    }
  }

  // Sauvegarde absente alors que des données sont représentées.
  const donnees = diagram.nodes.filter((node) =>
    ['storage', 'nvme-storage', 'hci', 'hypervisor', 'managed-db'].includes(node.kind),
  )
  const sauvegarde = diagram.nodes.some((node) => ['backup', 'tape-backup'].includes(node.kind))
  if (donnees.length > 0 && !sauvegarde) {
    const coeur = diagram.nodes.find((node) => node.kind === 'core-switch') ?? donnees[0]
    const pris = new Set(diagram.nodes.map((node) => node.name.toLowerCase()))
    const nomBkp = nommer('BKP', 1, pris)[0]
    suggestions.push({
      id: 'backup',
      titre: 'Ajouter la chaîne de sauvegarde',
      detail:
        'Du stockage ou de la virtualisation sans sauvegarde au schéma : la redondance ne protège pas d’une suppression ni d’un chiffrement malveillant.',
      operations: [
        {
          type: 'noeud',
          nom: nomBkp,
          kind: 'backup',
          patch: { zone: donnees[0].zone, site: donnees[0].site },
        },
        { type: 'liaison', de: coeur.name, vers: nomBkp, kind: 'ethernet' },
        {
          type: 'liaison',
          de: donnees[0].name,
          vers: nomBkp,
          kind: 'replication',
          patch: { label: 'Sauvegarde' },
        },
      ],
    })
  }

  return suggestions
}

/**
 * Équipements dont la double alimentation a un sens : un châssis, dans nos murs, raccordé à notre
 * énergie. Un lien opérateur, une région cloud ou un service logiciel n'ont pas de prises à doubler.
 */
const KINDS_SANS_ALIMENTATION = new Set([
  'ddi',
  'idp',
  'k8s-cluster',
  'k8s-control-plane',
  'managed-db',
  'ztna',
])

function doubleAlimentable(kind: string): boolean {
  const meta = deviceMeta(kind)
  return meta.critical === true && meta.rank >= 1 && !KINDS_SANS_ALIMENTATION.has(kind)
}

/** Exemple affiché dans l'assistant : il doit produire un schéma complet et crédible. */
export const EXEMPLE_ASSISTANT = `deux liens opérateur
deux routeurs de périmètre en grappe
deux pare-feu Fortinet en grappe actif/passif, zone DMZ
deux switches cœur en grappe, zone Datacenter
quatre switches d'accès
trois hyperviseurs en grappe avec témoin
une baie de stockage
deux onduleurs`
