import { LINKS, rankOf } from './catalog'
import type { Diagram, NetLink, NetNode } from '../types'

/**
 * Analyse d'impact : « que se passe-t-il si… ».
 *
 * On coupe un équipement ou un câble, et l'on regarde ce que le réseau perd. C'est le geste
 * de base d'une revue d'architecture — et celui qu'on ne fait jamais faute d'outil, parce que
 * suivre les chemins à la main sur un schéma de trente boîtes est fastidieux et faux.
 *
 * Le calcul suit la pratique des réseaux :
 *
 * 1. On se donne des **points de référence** : ce à quoi les équipements doivent pouvoir
 *    parler. Par défaut, les accès opérateur et le périmètre — sinon le cœur de réseau.
 * 2. On enlève du graphe ce qui est en panne, et l'on regarde qui reste **joignable**.
 * 3. Parmi les joignables, on distingue ceux qui ne tiennent plus qu'à **un seul fil** : ils
 *    fonctionnent, mais la prochaine panne les emporte. C'est là que se cachent les mauvaises
 *    surprises d'un plan de reprise.
 *
 * Les liaisons de service (battement de cœur, réplication, administration hors bande,
 * alimentation) ne transportent pas le trafic : elles ne comptent pas pour la joignabilité.
 */

export type EtatImpact = 'panne' | 'isole' | 'fragile' | 'intact'

/** Couleurs des états, partagées par le plan de travail et le panneau. */
export const COULEURS_IMPACT: Record<EtatImpact, string> = {
  panne: '#dc2626',
  isole: '#ea580c',
  fragile: '#d97706',
  intact: '#059669',
}

export interface ImpactNoeud {
  id: string
  nom: string
  etat: EtatImpact
  /** Pour un équipement fragile : le point de passage unique dont il dépend désormais. */
  dependDe?: string
}

export interface RapportImpact {
  /** État de chaque équipement, par identifiant. */
  etats: Map<string, EtatImpact>
  /** Liaisons hors service : coupées directement, ou portées par un équipement en panne. */
  liensCoupes: Set<string>
  /** Équipements devenus fragiles, avec le point de passage dont ils dépendent. */
  fragiles: ImpactNoeud[]
  isoles: ImpactNoeud[]
  /** Points de référence retenus pour le calcul. */
  racines: string[]
  compte: { panne: number; isole: number; fragile: number; intact: number }
  /** Part des équipements encore joignables, en pourcentage. */
  disponibilite: number
}

export interface Pannes {
  nodes: string[]
  links: string[]
}

function transportLinks(diagram: Diagram): NetLink[] {
  return diagram.links.filter((link) => !LINKS[link.kind]?.service)
}

/**
 * Points de référence : les accès opérateur et le périmètre. Un schéma qui n'en a pas (un
 * plan de salle, un site isolé) se rabat sur sa couche la plus haute — souvent le cœur.
 */
function racinesDe(nodes: NetNode[]): string[] {
  const parRang = nodes.map((node) => ({ node, rang: rankOf(node.kind, node.rank) }))
  const hautes = parRang.filter((item) => item.rang <= 1)
  if (hautes.length > 0) return hautes.map((item) => item.node.id)
  if (parRang.length === 0) return []
  const rangMin = Math.min(...parRang.map((item) => item.rang))
  return parRang.filter((item) => item.rang === rangMin).map((item) => item.node.id)
}

/** Parcours en largeur depuis les racines, sur le graphe des équipements encore debout. */
function joignables(
  racines: string[],
  adjacence: Map<string, Set<string>>,
  vivants: Set<string>,
): Set<string> {
  const vus = new Set<string>()
  const file = racines.filter((id) => vivants.has(id))
  for (const id of file) vus.add(id)
  while (file.length > 0) {
    const courant = file.shift() as string
    for (const voisin of adjacence.get(courant) ?? []) {
      if (!vivants.has(voisin) || vus.has(voisin)) continue
      vus.add(voisin)
      file.push(voisin)
    }
  }
  return vus
}

/**
 * Impact d'un jeu de pannes.
 *
 * `pannes.nodes` : équipements arrêtés (coupure d'alimentation, panne matérielle, maintenance).
 * `pannes.links` : câbles débranchés ou liens coupés.
 */
export function analyseImpact(diagram: Diagram, pannes: Pannes): RapportImpact {
  const enPanne = new Set(pannes.nodes)
  const liensCoupes = new Set(pannes.links)
  for (const link of diagram.links) {
    if (enPanne.has(link.from) || enPanne.has(link.to)) liensCoupes.add(link.id)
  }

  const noms = new Map(diagram.nodes.map((node) => [node.id, node.name]))

  /**
   * Un onduleur, un PDU ou un témoin de quorum ne porte que des liaisons de service : il n'est
   * pas « isolé » du réseau, il n'y a jamais été. Seuls les équipements qui avaient un chemin
   * de données avant la panne entrent dans le verdict.
   */
  const dansLeFlux = new Set<string>()
  for (const link of transportLinks(diagram)) {
    dansLeFlux.add(link.from)
    dansLeFlux.add(link.to)
  }
  const vivants = new Set(diagram.nodes.filter((node) => !enPanne.has(node.id)).map((node) => node.id))

  const liensVivants = transportLinks(diagram).filter(
    (link) => !liensCoupes.has(link.id) && vivants.has(link.from) && vivants.has(link.to),
  )
  const adjacence = new Map<string, Set<string>>()
  for (const id of vivants) adjacence.set(id, new Set())
  for (const link of liensVivants) {
    if (link.from === link.to) continue
    adjacence.get(link.from)?.add(link.to)
    adjacence.get(link.to)?.add(link.from)
  }

  const racines = racinesDe(diagram.nodes.filter((node) => vivants.has(node.id)))
  const atteints = joignables(racines, adjacence, vivants)

  /**
   * Fragilité : on retire à son tour chaque équipement encore debout et l'on regarde qui
   * cesse d'être joignable. C'est exactement la question « et si celui-là tombe aussi ? »,
   * et c'est ce qui fait ressortir les points de passage uniques d'un réseau déjà entamé.
   */
  const dependances = new Map<string, string>()
  for (const candidat of vivants) {
    if (racines.includes(candidat)) continue
    const sans = new Set(vivants)
    sans.delete(candidat)
    const encore = joignables(racines, adjacence, sans)
    for (const id of atteints) {
      if (id === candidat || encore.has(id) || dependances.has(id)) continue
      dependances.set(id, candidat)
    }
  }

  const etats = new Map<string, EtatImpact>()
  const isoles: ImpactNoeud[] = []
  const fragiles: ImpactNoeud[] = []
  for (const node of diagram.nodes) {
    if (enPanne.has(node.id)) {
      etats.set(node.id, 'panne')
      continue
    }
    if (!dansLeFlux.has(node.id)) {
      etats.set(node.id, 'intact')
      continue
    }
    if (!atteints.has(node.id)) {
      etats.set(node.id, 'isole')
      isoles.push({ id: node.id, nom: node.name, etat: 'isole' })
      continue
    }
    const depend = dependances.get(node.id)
    if (depend) {
      etats.set(node.id, 'fragile')
      fragiles.push({ id: node.id, nom: node.name, etat: 'fragile', dependDe: noms.get(depend) })
      continue
    }
    etats.set(node.id, 'intact')
  }

  const compte = { panne: 0, isole: 0, fragile: 0, intact: 0 }
  for (const etat of etats.values()) compte[etat] += 1
  // La disponibilité se mesure sur les équipements du chemin de données : compter les PDU
  // ferait monter le score sans rien dire du réseau.
  const total = Math.max(1, dansLeFlux.size)

  return {
    etats,
    liensCoupes,
    fragiles: fragiles.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    isoles: isoles.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    racines,
    compte,
    disponibilite: Math.round(((total - compte.panne - compte.isole) / total) * 100),
  }
}

/**
 * Classement des équipements par gravité de leur panne, chacun pris isolément.
 *
 * C'est la question « par quoi commencer ? » : l'équipement dont l'arrêt coupe le plus de
 * monde est celui qu'il faut doubler en premier. On ne simule qu'un arrêt à la fois — c'est
 * l'hypothèse de travail habituelle d'un plan de continuité.
 */
export interface Classement {
  id: string
  nom: string
  /** Nombre d'équipements isolés par l'arrêt de celui-ci, lui-même non compris. */
  isoles: number
  /** Nombre d'équipements qui ne tiendraient plus qu'à un fil. */
  fragiles: number
}

export function classementCriticite(diagram: Diagram, limite = 10): Classement[] {
  const resultats: Classement[] = []
  for (const node of diagram.nodes) {
    const rapport = analyseImpact(diagram, { nodes: [node.id], links: [] })
    resultats.push({
      id: node.id,
      nom: node.name,
      isoles: rapport.compte.isole,
      fragiles: rapport.compte.fragile,
    })
  }
  return resultats
    .filter((item) => item.isoles > 0 || item.fragiles > 0)
    .sort((a, b) => b.isoles - a.isoles || b.fragiles - a.fragiles || a.nom.localeCompare(b.nom, 'fr'))
    .slice(0, limite)
}
