import { mecanismeHa, planDeDonneesEffectif } from './haTech'
import { porteeVlans } from './vlanReach'
import type { PorteeVlan } from './vlanReach'
import type { Diagram, HaRole, NetLink, NetNode, UsageVlan, VlanDef } from '../types'

/**
 * Nature des VLAN : ce que la vue physique montre et ce que la vue logique doit taire.
 *
 * Sur un plan de câblage, un VLAN de synchronisation est un VLAN comme un autre : il a un
 * numéro, il est autorisé sur un trunk, il se voit sur le câble. Sur un plan logique, il n'a
 * rien à faire — il ne porte aucun utilisateur, il ne se route pas, et le dessiner en domaine
 * de diffusion donne à lire un réseau là où il n'y a qu'un cordon entre deux boîtiers.
 *
 * Le VLAN de transit pose la question inverse : il est routé, donc il appartient au plan de
 * niveau 3 — mais comme une **adjacence** entre deux routeurs, pas comme un réseau desservi.
 * Un /29 entre un pare-feu et un cœur n'est pas un domaine de diffusion à montrer, c'est le
 * trait qui les relie.
 *
 * D'où cet axe, déduit du schéma faute d'être déclaré : il départage ce qui se dessine
 * physiquement de ce qui se dessine logiquement.
 */

export const USAGES_VLAN: Record<UsageVlan, { label: string; court: string; detail: string }> = {
  service: {
    label: 'VLAN de service',
    court: 'service',
    detail:
      "Porte des équipements — serveurs, postes, bornes, imprimantes. C'est un domaine de diffusion à part entière : il veut un sous-réseau, une passerelle, et il apparaît dans toutes les vues.",
  },
  transit: {
    label: 'VLAN de transit',
    court: 'transit',
    detail:
      "Interconnexion routée entre deux équipements, sans hôte : /30 ou /29 entre un pare-feu et un cœur, entre deux routeurs. Il appartient au plan de niveau 3, mais comme une adjacence — le trait entre les deux —, pas comme un réseau desservi.",
  },
  synchro: {
    label: 'VLAN de synchronisation',
    court: 'interconnexion de grappe',
    detail:
      "Interconnexion d'une grappe : HA1/HA2 chez Palo Alto, peer-link et keepalive sur une paire de châssis, lien de pile. Il ne se route pas et ne doit jamais sortir de la grappe. Il se voit sur le plan de câblage et disparaît du plan logique.",
  },
}

/** Équipements qui décident d'un chemin — un VLAN qui ne relie qu'eux est un transit. */
const ROUTEURS = new Set([
  'router', 'sdwan', 'router-5g', 'firewall', 'ngfw', 'loadbalancer', 'waf', 'ztna', 'swg',
  'core-switch', 'spine', 'wan', 'internet', 'cloud', 'cloud-region', 'vpc',
  'cloud-interconnect', 'sase-pop', 'cdn', 'modem', 'vpn-concentrator', 'ot-gateway',
])

/** Types de liaison qui n'existent que pour tenir une grappe ensemble. */
export const LIENS_DE_GRAPPE = new Set<NetLink['kind']>(['heartbeat', 'stack', 'replication'])

/** Masque à partir duquel un réseau ne peut plus héberger grand-chose : /29 et au-delà. */
const MASQUE_TRANSIT = 29

/** Le préfixe d'un CIDR, quand il est lisible. */
function prefixe(subnet?: string): number | undefined {
  const trouve = subnet?.trim().match(/\/(\d{1,3})\s*$/)
  if (!trouve) return undefined
  const valeur = Number(trouve[1])
  return valeur >= 0 && valeur <= 128 ? valeur : undefined
}

/**
 * Nature déduite d'un VLAN.
 *
 * On lit ce qui est écrit avant de deviner : un usage déclaré dans le plan d'adressage
 * l'emporte toujours. Sinon, trois indices, dans cet ordre :
 *
 * 1. le VLAN ne circule que sur des liaisons de grappe (battement de cœur, pile, réplication)
 *    — c'est une synchronisation, et c'est le cas des VLAN HA1/HA2 ;
 * 2. il n'a pas de sous-réseau et ne touche que les membres d'une même grappe — même verdict ;
 * 3. son sous-réseau est un /29 ou plus étroit, ou bien il ne relie que des équipements qui
 *    routent — c'est un transit.
 *
 * Faute d'indice, c'est un VLAN de service : c'est le cas courant, et se tromper dans ce
 * sens-là ne coûte qu'une ligne de plus sur un plan logique.
 */
export function usageVlan(vlan: VlanDef, diagram: Diagram, portee?: PorteeVlan): UsageVlan {
  if (vlan.usage) return vlan.usage

  const parLien = new Map(diagram.links.map((link) => [link.id, link]))
  const parNoeud = new Map(diagram.nodes.map((node) => [node.id, node]))
  const liens = [...(portee?.links.keys() ?? [])]
    .map((id) => parLien.get(id))
    .filter((link): link is NetLink => !!link)
  const noeuds = [...(portee?.nodes.keys() ?? [])]
    .map((id) => parNoeud.get(id))
    .filter((node): node is NetNode => !!node)

  /*
    1. Le VLAN emprunte une liaison de grappe.

    Confiné à ces liaisons, c'est une synchronisation — le cas normal. Mais s'il a débordé sur
    des trunks de production, il le reste : c'est justement le défaut qu'on veut signaler, et
    le reclasser en VLAN de service reviendrait à le taire, puis à lui réclamer un plan
    d'adressage. Un VLAN adressé qui circule partout, en revanche, n'est pas une
    synchronisation : le sous-réseau tranche.
  */
  const deGrappe = liens.filter((link) => LIENS_DE_GRAPPE.has(link.kind))
  if (deGrappe.length > 0 && (!vlan.subnet?.trim() || deGrappe.length === liens.length)) return 'synchro'

  // 2. Aucun adressage, et ne touche qu'une seule grappe.
  const grappes = new Set(noeuds.map((node) => node.cluster?.trim()).filter(Boolean))
  if (!vlan.subnet?.trim() && noeuds.length > 0 && grappes.size === 1 && noeuds.every((node) => node.cluster?.trim())) {
    return 'synchro'
  }

  // 3. Un réseau trop étroit pour héberger, ou qui ne relie que des équipements qui routent.
  const masque = prefixe(vlan.subnet)
  if (masque !== undefined && masque >= MASQUE_TRANSIT) return 'transit'
  if (vlan.subnet?.trim() && noeuds.length > 0 && noeuds.length <= 4 && noeuds.every((node) => ROUTEURS.has(node.kind))) {
    return 'transit'
  }

  return 'service'
}

/** Nature de chaque VLAN du document, en une passe. */
export function usagesVlans(diagram: Diagram, propager = true): Map<string, UsageVlan> {
  const portees = porteeVlans(diagram, propager)
  const usages = new Map<string, UsageVlan>()
  for (const vlan of diagram.vlans ?? []) {
    usages.set(vlan.id, usageVlan(vlan, diagram, portees.get(vlan.id)))
  }
  return usages
}

/** Un VLAN d'interconnexion ne porte pas d'utilisateur : transit ou synchronisation. */
export function estInterconnexion(usage: UsageVlan): boolean {
  return usage !== 'service'
}

/**
 * Les deux extrémités logiques d'un VLAN de transit.
 *
 * Une grappe compte pour une extrémité : un transit entre une paire de pare-feu et un châssis
 * virtuel relie deux équipements logiques, pas quatre boîtiers. Le représentant de chaque
 * extrémité est le membre actif, et les autres membres ne sont ajoutés que si le mécanisme
 * fait réellement acheminer tout le monde — ce que `planDeDonneesEffectif` sait dire.
 */
export function extremitesTransit(
  candidats: NetNode[],
): { principal: NetNode; secondaires: NetNode[] }[] {
  const parGrappe = new Map<string, NetNode[]>()
  for (const node of candidats) {
    const cle = node.cluster?.trim() || `seul:${node.id}`
    const liste = parGrappe.get(cle)
    if (liste) liste.push(node)
    else parGrappe.set(cle, [node])
  }

  return [...parGrappe.values()].map((membres) => {
    const actifs = membres.filter((node) => node.role !== 'witness')
    const principal =
      actifs.find((node) => node.role === 'active' || node.role === 'active-active') ?? actifs[0] ?? membres[0]
    const mecanisme = membres.map((node) => mecanismeHa(node.haTech)).find(Boolean)
    const roles = membres
      .map((node) => node.role)
      .filter((role): role is HaRole => !!role && role !== 'standalone')
    // Seul un mécanisme qui fait acheminer tous les membres justifie un second brin.
    const tousAcheminent = mecanisme ? planDeDonneesEffectif(mecanisme, roles) === 'tous' : false
    return {
      principal,
      secondaires: tousAcheminent ? actifs.filter((node) => node.id !== principal.id) : [],
    }
  })
}
