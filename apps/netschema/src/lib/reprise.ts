import { uid } from './ids'
import { parseVlanList } from './osi'
import { heightOf } from './racks'
import { vlansDeclares } from './vlanReach'
import type { Diagram, NetLink, NetNode, RackDef, VlanDef } from '../types'

/**
 * Repartir des équipements déjà enregistrés.
 *
 * Un équipement saisi une fois — son modèle, son numéro de série, son adresse, sa baie — ne
 * devrait pas se ressaisir pour figurer sur un second schéma. Ce module lit l'inventaire d'un
 * document, toutes pages confondues, et prépare ce qu'il faut ajouter à une page pour y
 * reprendre les équipements choisis : leurs fiches, les liaisons déjà tracées entre eux, les
 * baies où ils sont implantés, les lignes du plan d'adressage qu'ils citent.
 *
 * Tout est pur : des documents en entrée, une liste d'ajouts en sortie. Rien n'est modifié
 * ici — c'est le magasin qui applique, en un seul cran d'annulation.
 */

/** Deux noms désignent le même équipement à la casse et aux espaces de bord près. */
export function cleNom(nom: string): string {
  return nom.trim().toLowerCase()
}

export interface EquipementInventaire {
  cle: string
  /** La fiche retenue : la plus renseignée, quand l'équipement figure sur plusieurs pages. */
  node: NetNode
  /** Index de la page d'où vient la fiche retenue. */
  page: number
  /** Noms des pages où l'équipement figure. */
  pages: string[]
}

/** Ce qui fait la richesse d'une fiche d'inventaire. */
const CHAMPS_FICHE: (keyof NetNode)[] = [
  'model', 'vendor', 'serial', 'assetTag', 'ip', 'vlan', 'site', 'zone', 'rack', 'rackUnit',
  'owner', 'purchaseDate', 'warrantyEnd', 'powerW', 'notes', 'status', 'cluster', 'role', 'vip',
]

function richesse(node: NetNode): number {
  return CHAMPS_FICHE.filter((champ) => {
    const valeur = node[champ]
    return valeur !== undefined && valeur !== null && valeur !== ''
  }).length
}

const nomDePage = (page: Diagram, index: number) => page.pageName?.trim() || `Schéma ${index + 1}`

/**
 * L'inventaire d'un document : chaque équipement une fois, quelle que soit la page.
 *
 * Le même équipement figure souvent sur plusieurs pages — la vue d'ensemble et le détail
 * d'un site. On ne le propose qu'une fois, avec sa fiche la mieux renseignée, en disant sur
 * quelles pages il se trouve.
 */
export function inventaireDuDocument(pages: Diagram[]): EquipementInventaire[] {
  const parCle = new Map<string, EquipementInventaire>()
  for (const [index, page] of pages.entries()) {
    for (const node of page.nodes) {
      const cle = cleNom(node.name)
      if (!cle) continue
      const connu = parCle.get(cle)
      if (!connu) {
        parCle.set(cle, { cle, node, page: index, pages: [nomDePage(page, index)] })
        continue
      }
      const nom = nomDePage(page, index)
      if (!connu.pages.includes(nom)) connu.pages.push(nom)
      if (richesse(node) > richesse(connu.node)) {
        connu.node = node
        connu.page = index
      }
    }
  }
  return [...parCle.values()].sort((a, b) => a.node.name.localeCompare(b.node.name, 'fr', { numeric: true }))
}

export interface OptionsReprise {
  /** Reprendre aussi les liaisons tracées entre les équipements choisis. */
  liaisons: boolean
}

export interface Reprise {
  /** Équipements à ajouter, avec des identifiants neufs. */
  nodes: NetNode[]
  /**
   * Liaisons à ajouter : celles qui étaient tracées entre les équipements repris, et entre
   * eux et ceux que la page porte déjà.
   */
  links: NetLink[]
  /** Baies à créer sur la page cible, pour ceux qui étaient implantés. */
  racks: RackDef[]
  /** Lignes du plan d'adressage à créer : les VLAN cités, avec leur nom et leur sous-réseau. */
  vlans: VlanDef[]
  /** Couleurs de grappe à reporter. */
  clusterColors: Record<string, string>
  /** Noms déjà présents sur la page cible : laissés tels quels, non repris une seconde fois. */
  dejaLa: string[]
  /** Noms demandés qui ne figurent dans aucune page source. */
  introuvables: string[]
  /**
   * Vrai quand une même page porte tous les équipements repris : leur disposition d'origine
   * a alors un sens, et les coordonnées rendues sont celles de cette page.
   */
  dispositionOrigine: boolean
}

/** Réglages de tracé qui n'ont de sens que si les équipements gardent leur place. */
const GEOMETRIE: (keyof NetLink)[] = [
  'waypoints', 'attachA', 'attachB', 'anchorA', 'anchorB', 'labelOffset', 'labelOffsetA', 'labelOffsetB', 'lagShift', 'lagOffset',
]

/** La même liaison, sans ce qui a été posé à la main sur son tracé. */
export function sansTrace(link: NetLink): NetLink {
  const nue = { ...link }
  for (const champ of GEOMETRIE) delete nue[champ]
  return nue
}

/**
 * Prépare la reprise d'équipements de `sources` vers `cible`.
 *
 * `cles` désigne les équipements par leur nom (voir `cleNom`). La page cible n'est pas
 * modifiée ; un équipement qui y figure déjà n'est pas repris une seconde fois.
 */
export function preparerReprise(
  sources: Diagram[],
  cles: string[],
  cible: Diagram,
  options: OptionsReprise = { liaisons: true },
): Reprise {
  const inventaire = new Map(inventaireDuDocument(sources).map((item) => [item.cle, item]))
  const surLaCible = new Set(cible.nodes.map((node) => cleNom(node.name)))
  const dejaLa: string[] = []
  const introuvables: string[] = []
  const retenus: EquipementInventaire[] = []
  for (const cle of [...new Set(cles.map(cleNom))]) {
    const item = inventaire.get(cle)
    if (!item) introuvables.push(cle)
    else if (surLaCible.has(cle)) dejaLa.push(item.node.name)
    else retenus.push(item)
  }

  // Une page qui les porte tous : c'est d'elle qu'on tient la disposition.
  const choisis = new Set(retenus.map((item) => item.cle))
  const pageCommune = sources.findIndex((page) => {
    const noms = new Set(page.nodes.map((node) => cleNom(node.name)))
    return [...choisis].every((cle) => noms.has(cle))
  })
  const dispositionOrigine = retenus.length > 0 && pageCommune >= 0
  const placeSurLaPageCommune = new Map(
    dispositionOrigine ? sources[pageCommune].nodes.map((node) => [cleNom(node.name), node] as const) : [],
  )

  // ── Baies ──────────────────────────────────────────────────────────────────
  const baiesCible = new Map((cible.racks ?? []).map((rack) => [cleNom(rack.name), rack]))
  const racks: RackDef[] = []
  /** Unités déjà prises, par baie de la page cible. */
  const occupation = new Map<string, Set<number>>()
  for (const node of cible.nodes) {
    if (!node.rack || !node.rackUnit) continue
    const prises = occupation.get(node.rack) ?? new Set<number>()
    for (let unite = node.rackUnit; unite < node.rackUnit + heightOf(node); unite += 1) prises.add(unite)
    occupation.set(node.rack, prises)
  }

  const ids = new Map<string, string>()
  const nodes: NetNode[] = retenus.map((item) => {
    const id = uid('n')
    ids.set(item.cle, id)
    const place = placeSurLaPageCommune.get(item.cle)
    const node: NetNode = { ...item.node, id, x: place?.x ?? item.node.x, y: place?.y ?? item.node.y }

    if (node.rack) {
      const origine = (sources[item.page].racks ?? []).find((rack) => rack.id === node.rack)
      if (!origine) {
        // Une implantation qui ne renvoie à aucune baie : on ne la propage pas.
        delete node.rack
        delete node.rackUnit
      } else {
        let baie = baiesCible.get(cleNom(origine.name))
        if (!baie) {
          baie = { ...origine, id: uid('r') }
          baiesCible.set(cleNom(origine.name), baie)
          racks.push(baie)
        }
        node.rack = baie.id
        // L'emplacement n'est gardé que s'il est libre et tient dans la baie : sinon
        // l'équipement reste dans la baie, à placer, plutôt que posé sur un autre.
        if (node.rackUnit) {
          const prises = occupation.get(baie.id) ?? new Set<number>()
          const unites = Array.from({ length: heightOf(node) }, (_, rang) => (node.rackUnit ?? 0) + rang)
          if (unites.some((unite) => prises.has(unite) || unite > baie.units)) delete node.rackUnit
          else for (const unite of unites) prises.add(unite)
          occupation.set(baie.id, prises)
        }
      }
    }
    return node
  })

  // ── Liaisons ───────────────────────────────────────────────────────────────
  const links: NetLink[] = []
  if (options.liaisons) {
    /*
      La même liaison est souvent tracée sur plusieurs pages. Pour chaque couple, on la reprend
      d'une seule page — la première qui la porte, la page commune d'abord — avec tous ses
      brins : deux brins d'un agrégat restent deux brins, mais ne deviennent pas quatre.
    */
    const ordre = sources.map((_, index) => index)
    if (dispositionOrigine) ordre.sort((a, b) => (a === pageCommune ? -1 : b === pageCommune ? 1 : a - b))
    /*
      Une liaison suit dès qu'une de ses extrémités est reprise et que l'autre l'est aussi —
      ou se trouve déjà sur la page. Reprendre les routeurs sur une page qui porte déjà les
      pare-feu doit les y raccorder : sinon on retrace à la main ce qui était déjà tracé.
      Entre deux équipements déjà reliés sur la page, on n'ajoute rien.
    */
    const idsCible = new Map(cible.nodes.map((node) => [cleNom(node.name), node.id]))
    const cleCible = new Map(cible.nodes.map((node) => [node.id, cleNom(node.name)]))
    const couple = (a: string, b: string) => [a, b].sort().join('\u0000')
    const couplesFaits = new Set<string>()
    for (const link of cible.links) {
      const [de, vers] = [cleCible.get(link.from), cleCible.get(link.to)]
      if (de && vers) couplesFaits.add(couple(de, vers))
    }
    for (const index of ordre) {
      const page = sources[index]
      const cleParId = new Map(page.nodes.map((node) => [node.id, cleNom(node.name)]))
      const couplesDeLaPage = new Set<string>()
      for (const link of page.links) {
        const [de, vers] = [cleParId.get(link.from), cleParId.get(link.to)]
        if (!de || !vers || de === vers) continue
        if (!ids.has(de) && !ids.has(vers)) continue
        const [idDe, idVers] = [ids.get(de) ?? idsCible.get(de), ids.get(vers) ?? idsCible.get(vers)]
        if (!idDe || !idVers) continue
        if (couplesFaits.has(couple(de, vers))) continue
        couplesDeLaPage.add(couple(de, vers))
        const repris: NetLink = { ...link, id: uid('l'), from: idDe, to: idVers }
        // Hors de sa page, un tracé posé à la main ne mène plus nulle part.
        if (!(dispositionOrigine && index === pageCommune)) for (const champ of GEOMETRIE) delete repris[champ]
        links.push(repris)
      }
      for (const fait of couplesDeLaPage) couplesFaits.add(fait)
    }
  }

  // ── Plan d'adressage ───────────────────────────────────────────────────────
  const vlansCible = new Set((cible.vlans ?? []).map((vlan) => vlan.id))
  const cites = new Set<string>()
  for (const node of nodes) for (const id of vlansDeclares(node)) cites.add(id)
  for (const link of links) {
    for (const id of parseVlanList(link.vlans)) cites.add(id)
    if (link.nativeVlan) cites.add(link.nativeVlan.trim())
  }
  const vlans: VlanDef[] = []
  for (const id of cites) {
    if (vlansCible.has(id)) continue
    const definition = sources.flatMap((page) => page.vlans ?? []).find((vlan) => vlan.id === id)
    if (definition) vlans.push({ ...definition })
  }

  // ── Couleurs de grappe ─────────────────────────────────────────────────────
  const clusterColors: Record<string, string> = {}
  for (const item of retenus) {
    const grappe = item.node.cluster
    const couleur = grappe ? sources[item.page].clusterColors?.[grappe] : undefined
    if (grappe && couleur && !cible.clusterColors?.[grappe]) clusterColors[grappe] = couleur
  }

  return { nodes, links, racks, vlans, clusterColors, dejaLa, introuvables, dispositionOrigine }
}

/** Ce qu'on cherche dans une fiche : tout ce par quoi on désigne un équipement. */
export function texteDeRecherche(item: EquipementInventaire, libelleType: string, synonymes: string[] = []): string {
  const { node } = item
  return [
    node.name, node.ip, node.model, node.vendor, node.serial, node.assetTag, node.site, node.zone,
    node.cluster, node.owner, libelleType, ...synonymes, ...item.pages,
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}
