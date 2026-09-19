/**
 * Chemins entre deux équipements, et ce qu'ils traversent.
 *
 * « Par où passe le flux du poste comptable vers le serveur de paie ? » est la question
 * que l'on pose devant un schéma, et celle à laquelle un schéma seul répond mal dès qu'il
 * dépasse trente boîtes. On la traite ici comme un problème de graphe : le plus court
 * chemin, puis les chemins de secours réellement distincts, et enfin ce que chacun
 * traverse — filtrage, VLAN, MTU, liens de service.
 *
 * Aucune sonde, aucune configuration lue : l'analyse ne dit pas ce que fait le réseau, elle
 * dit ce que le schéma documente. C'est déjà ce qu'on lui demande en revue.
 */

import { deviceMeta, LINKS } from './catalog'
import { estBloqueParStp, parseVlans, vlansDuLien } from './impact'
import type { Diagram, NetLink, NetNode } from '../types'

/** Équipements qui filtrent ou inspectent : leur traversée change la nature du flux. */
const FILTRAGE = new Set([
  'firewall',
  'ngfw',
  'waf',
  'ips',
  'swg',
  'ztna',
  'api-gateway',
  'sase-pop',
  'ddos-scrubbing',
  'email-security',
  'vpn-concentrator',
  'ot-gateway',
  'sbc',
])

/** Équipements qui routent : un flux qui en traverse un change de sous-réseau. */
const ROUTAGE = new Set([
  'router',
  'sdwan',
  'router-5g',
  'core-switch',
  'spine',
  'firewall',
  'ngfw',
  'loadbalancer',
  'wan',
  'vpn-concentrator',
  'modem',
])

export type GraviteChemin = 'info' | 'attention' | 'critique'

export interface ConstatChemin {
  gravite: GraviteChemin
  texte: string
}

export interface EtapeChemin {
  /** Équipement atteint à cette étape. */
  node: NetNode
  /** Liaison empruntée pour y arriver (absente pour le point de départ). */
  link?: NetLink
}

export interface CheminReseau {
  etapes: EtapeChemin[]
  /** Nombre de liaisons traversées. */
  sauts: number
  /** Équipements de filtrage rencontrés, dans l'ordre. */
  filtrage: NetNode[]
  /** Équipements routeurs rencontrés. */
  routage: NetNode[]
  constats: ConstatChemin[]
  /** Débit annoncé le plus faible du chemin, s'il est documenté partout. */
  goulot?: { link: NetLink; debit: string }
}

export interface RapportChemins {
  from?: NetNode
  to?: NetNode
  chemins: CheminReseau[]
  /** Constats qui portent sur l'ensemble, pas sur un chemin. */
  constats: ConstatChemin[]
}

/** Graphe non orienté des liaisons fournies. */
function adjacence(links: NetLink[]): Map<string, { voisin: string; link: NetLink }[]> {
  const carte = new Map<string, { voisin: string; link: NetLink }[]>()
  const pousser = (de: string, vers: string, link: NetLink) => {
    const liste = carte.get(de)
    if (liste) liste.push({ voisin: vers, link })
    else carte.set(de, [{ voisin: vers, link }])
  }
  for (const link of links) {
    pousser(link.from, link.to, link)
    pousser(link.to, link.from, link)
  }
  return carte
}

/** Plus court chemin en nombre de sauts, en évitant des équipements et des liaisons donnés. */
function plusCourt(
  graphe: Map<string, { voisin: string; link: NetLink }[]>,
  from: string,
  to: string,
  noeudsExclus: Set<string>,
  liensExclus: Set<string>,
): { noeuds: string[]; liens: NetLink[] } | null {
  if (from === to) return { noeuds: [from], liens: [] }
  const precedent = new Map<string, { de: string; link: NetLink }>()
  const vus = new Set<string>([from])
  const file: string[] = [from]
  while (file.length > 0) {
    const courant = file.shift() as string
    for (const { voisin, link } of graphe.get(courant) ?? []) {
      if (vus.has(voisin) || liensExclus.has(link.id)) continue
      if (voisin !== to && noeudsExclus.has(voisin)) continue
      vus.add(voisin)
      precedent.set(voisin, { de: courant, link })
      if (voisin === to) {
        const noeuds = [to]
        const liens: NetLink[] = []
        let curseur = to
        while (curseur !== from) {
          const pas = precedent.get(curseur)
          if (!pas) return null
          liens.unshift(pas.link)
          curseur = pas.de
          noeuds.unshift(curseur)
        }
        return { noeuds, liens }
      }
      file.push(voisin)
    }
  }
  return null
}

/** Débit annoncé, ramené en Mb/s quand on sait le lire (« 10 Gb/s », « 1 Gbps », « 100M »). */
export function debitEnMbps(valeur?: string): number | null {
  if (!valeur) return null
  const trouve = valeur.replace(',', '.').match(/([\d.]+)\s*(g|m|k)?/i)
  if (!trouve) return null
  const nombre = Number(trouve[1])
  if (!Number.isFinite(nombre)) return null
  const unite = (trouve[2] ?? 'm').toLowerCase()
  return unite === 'g' ? nombre * 1000 : unite === 'k' ? nombre / 1000 : nombre
}

/** Analyse d'un chemin : ce qu'il traverse et ce qui mérite d'être signalé. */
function analyserChemin(noeuds: NetNode[], liens: NetLink[]): CheminReseau {
  const constats: ConstatChemin[] = []
  const filtrage = noeuds.filter((node) => FILTRAGE.has(node.kind))
  const routage = noeuds.filter((node) => ROUTAGE.has(node.kind))

  // MTU : un jumbo interrompu au milieu du chemin fragmente ou casse le flux.
  const mtus = [...new Set(liens.map((link) => link.mtu).filter((mtu): mtu is number => !!mtu))]
  if (mtus.length > 1) {
    constats.push({
      gravite: 'attention',
      texte: `MTU hétérogène le long du chemin (${mtus.sort((a, b) => a - b).join(', ')}) : une trame au plus grand MTU sera fragmentée ou rejetée.`,
    })
  }

  // VLAN : si les deux extrémités annoncent le même VLAN, chaque trunk doit le porter.
  const vlanDepart = parseVlans(noeuds[0]?.vlan)
  const vlanArrivee = parseVlans(noeuds[noeuds.length - 1]?.vlan)
  const communs = [...vlanDepart].filter((id) => vlanArrivee.has(id))
  if (communs.length > 0) {
    const manquants = liens.filter((link) => {
      const portes = vlansDuLien(link)
      return portes !== null && !communs.some((id) => portes.has(id))
    })
    if (manquants.length > 0) {
      constats.push({
        gravite: 'critique',
        texte: `VLAN ${communs.join(', ')} absent de ${manquants.length} liaison(s) du chemin : le flux ne passe pas en l'état.`,
      })
    }
  }

  // Spanning-tree : une liaison bloquée n'achemine rien tant que la topologie ne change pas.
  const bloquees = liens.filter((link) => estBloqueParStp(link))
  if (bloquees.length > 0) {
    constats.push({
      gravite: 'attention',
      texte: `${bloquees.length} liaison(s) du chemin sont bloquées par spanning-tree : ce chemin n'est emprunté qu'après convergence.`,
    })
  }

  // Liens de service : une réplication ou un lien d'administration n'est pas un chemin de données.
  const service = liens.filter((link) => LINKS[link.kind]?.service)
  if (service.length > 0) {
    constats.push({
      gravite: 'attention',
      texte: `Le chemin emprunte ${service.length} liaison(s) de service (${[...new Set(service.map((l) => LINKS[l.kind].label))].join(', ')}) : à confirmer, ce n'est pas un chemin de production.`,
    })
  }

  // Filtrage : deux zones différentes reliées sans passer par un point de contrôle.
  const zoneA = noeuds[0]?.zone?.trim()
  const zoneB = noeuds[noeuds.length - 1]?.zone?.trim()
  if (filtrage.length === 0 && zoneA && zoneB && zoneA !== zoneB) {
    constats.push({
      gravite: 'critique',
      texte: `Aucun équipement de filtrage entre « ${zoneA} » et « ${zoneB} » : les deux zones communiquent à plat.`,
    })
  }

  // Goulot d'étranglement : le maillon le plus lent du chemin, quand les débits sont saisis.
  let goulot: CheminReseau['goulot']
  let minimum = Number.POSITIVE_INFINITY
  for (const link of liens) {
    const debit = debitEnMbps(link.speed)
    if (debit !== null && debit < minimum) {
      minimum = debit
      goulot = { link, debit: link.speed ?? '' }
    }
  }

  return {
    etapes: noeuds.map((node, index) => ({ node, link: index > 0 ? liens[index - 1] : undefined })),
    sauts: liens.length,
    filtrage,
    routage,
    constats,
    goulot,
  }
}

/**
 * Chemins entre deux équipements : le plus court, puis les secours qui n'empruntent aucun
 * équipement intermédiaire du précédent.
 *
 * Cette contrainte de disjonction est ce qui rend la réponse utile : deux chemins qui
 * partagent le même switch ne sont pas deux chemins, c'est un chemin et une illusion de
 * redondance.
 */
export function cheminsEntre(
  diagram: Diagram,
  fromId: string,
  toId: string,
  maximum = 3,
): RapportChemins {
  const parId = new Map(diagram.nodes.map((node) => [node.id, node]))
  const from = parId.get(fromId)
  const to = parId.get(toId)
  const constats: ConstatChemin[] = []
  if (!from || !to || from.id === to.id) {
    return { from, to, chemins: [], constats }
  }

  // On cherche d'abord sur les seules liaisons de transport : une alimentation ou un lien
  // d'administration relie bien deux équipements, mais aucun flux de production n'y passe.
  // Faute de chemin, on rouvre le graphe entier et on le dit.
  const transport = diagram.links.filter((link) => !LINKS[link.kind]?.service)
  let graphe = adjacence(transport)
  if (!plusCourt(graphe, fromId, toId, new Set(), new Set())) {
    graphe = adjacence(diagram.links)
    if (plusCourt(graphe, fromId, toId, new Set(), new Set())) {
      constats.push({
        gravite: 'attention',
        texte:
          'Aucun chemin de production : les deux équipements ne se rejoignent que par des liaisons de service (administration, réplication, alimentation).',
      })
    }
  }

  const chemins: CheminReseau[] = []
  const noeudsExclus = new Set<string>()

  for (let tentative = 0; tentative < maximum; tentative += 1) {
    const trouve = plusCourt(graphe, fromId, toId, noeudsExclus, new Set())
    if (!trouve) break
    const noeuds = trouve.noeuds.map((id) => parId.get(id)).filter((node): node is NetNode => !!node)
    chemins.push(analyserChemin(noeuds, trouve.liens))
    // Les équipements intermédiaires de ce chemin sont écartés pour la recherche suivante.
    for (const id of trouve.noeuds.slice(1, -1)) noeudsExclus.add(id)
    if (trouve.noeuds.length <= 2) break
  }

  if (chemins.length === 0) {
    constats.push({
      gravite: 'critique',
      texte: `Aucun chemin entre « ${from.name} » et « ${to.name} » : le schéma ne les relie pas.`,
    })
  } else if (chemins.length === 1) {
    constats.push({
      gravite: 'attention',
      texte: `Un seul chemin indépendant : toute coupure sur ce trajet interrompt le flux (${chemins[0].sauts} saut(s)).`,
    })
  } else {
    constats.push({
      gravite: 'info',
      texte: `${chemins.length} chemins indépendants : le flux survit à la perte de n'importe quel équipement intermédiaire.`,
    })
  }

  return { from, to, chemins, constats }
}

/**
 * Résout une extrémité de flux : un nom d'équipement, un nom de zone ou un nom de site.
 *
 * La matrice de flux se rédige avec les mots du réseau (« DMZ », « LAN siège »), pas avec
 * des identifiants d'équipements : on accepte les trois et on renvoie ce qui correspond.
 */
export function resoudreExtremite(diagram: Diagram, valeur: string): NetNode[] {
  const cible = valeur.trim().toLowerCase()
  if (!cible) return []
  const exact = diagram.nodes.filter((node) => node.name.toLowerCase() === cible)
  if (exact.length > 0) return exact
  const zone = diagram.nodes.filter((node) => node.zone?.trim().toLowerCase() === cible)
  if (zone.length > 0) return zone
  const site = diagram.nodes.filter((node) => node.site?.trim().toLowerCase() === cible)
  if (site.length > 0) return site
  const kind = diagram.nodes.filter(
    (node) => deviceMeta(node.kind).label.toLowerCase() === cible || node.kind === cible,
  )
  if (kind.length > 0) return kind
  return diagram.nodes.filter((node) => node.name.toLowerCase().includes(cible))
}

/** Noms d'extrémités proposés à la saisie : zones, sites puis équipements. */
export function extremitesConnues(diagram: Diagram): string[] {
  const zones = [...new Set(diagram.nodes.map((node) => node.zone?.trim()).filter(Boolean))] as string[]
  const sites = [...new Set(diagram.nodes.map((node) => node.site?.trim()).filter(Boolean))] as string[]
  const noms = diagram.nodes.map((node) => node.name)
  return [...zones.sort(), ...sites.sort(), ...noms.sort()]
}
