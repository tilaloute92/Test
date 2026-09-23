import { autoLayout } from './layout'
import { deviceMeta } from './catalog'
import { linkInView, parseVlanList, usedVlans, vlanColor } from './osi'
import type { Diagram, LayoutOptions, NetLink, NetNode, VlanDef } from '../types'

/**
 * Vues logiques.
 *
 * Le schéma d'infrastructure répond à « qu'est-ce qui est branché où ». Il ne répond pas à
 * « qui parle à qui sans passer par un routeur », qui est la question des VLAN — et c'est
 * pourtant celle qu'on pose en exploitation, en sécurité et en migration.
 *
 * Trois lectures, trois dessins. Chacune est une **projection** du document : on n'y modifie
 * rien, on le regarde autrement. Elles sont construites comme des schémas ordinaires, avec
 * les couches, les cadres de zone et les liaisons de l'application — ce qui leur donne
 * gratuitement le placement automatique, les info-bulles, l'export et le dossier.
 */
export type VueLogique = 'routage' | 'rails' | 'domaines'

export const VUES_LOGIQUES: { value: VueLogique; label: string; hint: string }[] = [
  {
    value: 'routage',
    label: 'Routage (couche 3)',
    hint: 'Ce qui route et ce qui est routé : routeurs, pare-feu, commutateurs de niveau 3, et les réseaux qu’ils desservent. La commutation disparaît.',
  },
  {
    value: 'rails',
    label: 'Plan VLAN (un rail par VLAN)',
    hint: 'Un VLAN par ligne, les équipements accrochés dessus. La lecture d’un plan d’adressage : qui est dans quel domaine de diffusion.',
  },
  {
    value: 'domaines',
    label: 'Domaines de diffusion',
    hint: 'Un périmètre fermé par VLAN autour du point de routage. Chaque trait vers le centre est un franchissement de routeur.',
  },
]

/** Membres d'un VLAN : ce que le VLAN porte, équipements de transit compris. */
export interface MembresVlan {
  vlan: VlanDef
  couleur: string
  /** Équipements du domaine de diffusion, infrastructure d'abord. */
  membres: NetNode[]
  /** Équipement qui porte la passerelle, quand on sait le désigner. */
  passerelle?: NetNode
}

/**
 * Qui appartient à quel VLAN.
 *
 * Un équipement est dans le domaine de diffusion s'il le déclare, ou si l'une de ses
 * liaisons le transporte. Les commutateurs de transit en font donc partie : c'est la réalité
 * du domaine, et c'est ce qui permet de voir qu'un VLAN traverse un bâtiment qu'il ne devrait
 * pas traverser.
 */
export function membresParVlan(diagram: Diagram): MembresVlan[] {
  const parId = new Map(diagram.nodes.map((node) => [node.id, node]))
  const utilises = usedVlans(diagram)
  const declares = new Map((diagram.vlans ?? []).map((vlan) => [vlan.id, vlan]))

  const ids = [...new Set([...utilises.keys(), ...declares.keys()])].sort(
    (a, b) => (Number(a) || 0) - (Number(b) || 0),
  )

  return ids.map((id) => {
    const vlan = declares.get(id) ?? { id }
    const trouves = new Map<string, NetNode>()
    const usage = utilises.get(id)
    for (const nodeId of usage?.nodes ?? []) {
      const node = parId.get(nodeId)
      if (node) trouves.set(node.id, node)
    }
    for (const linkId of usage?.links ?? []) {
      const link = diagram.links.find((item) => item.id === linkId)
      if (!link) continue
      for (const extremite of [link.from, link.to]) {
        const node = parId.get(extremite)
        if (node) trouves.set(node.id, node)
      }
    }
    const membres = [...trouves.values()].sort((a, b) => {
      const ra = deviceMeta(a.kind).rank
      const rb = deviceMeta(b.kind).rank
      return ra - rb || a.name.localeCompare(b.name)
    })
    const passerelle = vlan.gateway
      ? diagram.nodes.find(
          (node) => node.ip?.trim() === vlan.gateway?.trim() || node.vip?.trim() === vlan.gateway?.trim(),
        )
      : undefined
    return { vlan, couleur: vlanColor(id, diagram.vlans), membres, passerelle }
  })
}

/** Libellé d'un VLAN, tel qu'il s'écrit sur un rail ou un cadre. */
export function titreVlan(vlan: VlanDef): string {
  const nom = vlan.name?.trim()
  const reseau = vlan.subnet?.trim()
  return `VLAN ${vlan.id}${nom ? ` — ${nom}` : ''}${reseau ? ` · ${reseau}` : ''}`
}

const noeud = (id: string, kind: string, name: string, extra: Partial<NetNode> = {}): NetNode => ({
  id,
  kind,
  name,
  x: 0,
  y: 0,
  ...extra,
})

const lien = (id: string, from: string, to: string, kind: NetLink['kind'], extra: Partial<NetLink> = {}): NetLink => ({
  id,
  from,
  to,
  kind,
  ...extra,
})

/**
 * Projection « un rail par VLAN ».
 *
 * Chaque VLAN devient une couche : l'application sait déjà dessiner une couche, la nommer sur
 * la gauche et y ranger des équipements côte à côte. Il n'y a pas de liaison — c'est le rail
 * qui relie, et c'est justement ce qu'on veut dire : dans un domaine de diffusion, tout le
 * monde se parle directement.
 */
function railsVlan(diagram: Diagram): Diagram {
  const groupes = membresParVlan(diagram).filter((groupe) => groupe.membres.length > 0)
  const nodes: NetNode[] = []
  const layerNames: Record<string, string> = {}
  const layerColors: Record<string, string> = {}

  groupes.forEach((groupe, rang) => {
    layerNames[String(rang)] = titreVlan(groupe.vlan)
    layerColors[String(rang)] = groupe.couleur
    /*
      Ni site, ni zone, ni grappe : sur un plan VLAN, ces regroupements-là n'ont rien à dire
      et leurs cadres traverseraient les rails. Seul compte le domaine de diffusion.
    */
    for (const membre of groupe.membres) {
      nodes.push(
        noeud(`vlan${groupe.vlan.id}~${membre.id}`, membre.kind, membre.name, {
          rank: rang,
          ip: membre.ip,
          vlan: groupe.vlan.id,
          model: membre.model,
          vendor: membre.vendor,
          notes: membre.notes,
        }),
      )
    }
  })

  return {
    title: diagram.title,
    nodes,
    links: [],
    vlans: diagram.vlans,
    layerNames,
    layerColors,
    locked: true,
  }
}

/**
 * Projection « domaines de diffusion ».
 *
 * Un cadre par VLAN — le cadre de zone existe déjà —, une passerelle par VLAN routé, et un
 * point de routage central. Ce qui ne rejoint pas le centre n'est pas routé : la lecture est
 * immédiate.
 */
function domainesVlan(diagram: Diagram): Diagram {
  const groupes = membresParVlan(diagram).filter((groupe) => groupe.membres.length > 0)
  const nodes: NetNode[] = []
  const links: NetLink[] = []
  const layerNames: Record<string, string> = { '0': 'Routage inter-VLAN' }
  const layerColors: Record<string, string> = {}

  // Le point de routage : les équipements qui portent réellement les passerelles, à défaut
  // le cœur de réseau. Nommer le matériel réel évite d'inventer une boîte abstraite.
  const porteursGw = [
    ...new Set(groupes.map((groupe) => groupe.passerelle?.name).filter((nom): nom is string => !!nom)),
  ]
  const coeur = diagram.nodes
    .filter((node) => ['core-switch', 'router', 'firewall', 'ngfw', 'spine'].includes(node.kind))
    .sort((a, b) => deviceMeta(a.kind).rank - deviceMeta(b.kind).rank)
    .slice(0, 2)
    .map((node) => node.name)
  const porte = (porteursGw.length > 0 ? porteursGw : coeur).join(' / ')

  nodes.push(
    noeud('routage', 'core-switch', 'Routage inter-VLAN', {
      rank: 0,
      notes: porte ? `Porté par ${porte}.` : undefined,
    }),
  )

  groupes.forEach((groupe, index) => {
    const rang = index + 1
    const zone = titreVlan(groupe.vlan)
    const routable = !!groupe.vlan.gateway?.trim()
    layerNames[String(rang)] = routable ? zone : `${zone} · non routé`
    layerColors[String(rang)] = groupe.couleur

    if (routable) {
      const idPasserelle = `gw~${groupe.vlan.id}`
      nodes.push(
        noeud(idPasserelle, 'router', `Passerelle ${groupe.vlan.gateway}`, {
          rank: rang,
          zone,
          ip: groupe.vlan.gateway,
          vlan: groupe.vlan.id,
        }),
      )
      /*
        Le seul trait de cette vue : il dit qu'on franchit un routeur. Un VLAN qui n'en a
        pas reste isolé sur son rang — et cela se voit tout de suite.
      */
      links.push(
        lien(`l~gw~${groupe.vlan.id}`, 'routage', idPasserelle, 'ethernet', {
          label: `VLAN ${groupe.vlan.id}`,
          vlans: groupe.vlan.id,
          subnet: groupe.vlan.subnet,
          layers: ['l3'],
        }),
      )
    }

    for (const membre of groupe.membres) {
      nodes.push(
        noeud(`vlan${groupe.vlan.id}~${membre.id}`, membre.kind, membre.name, {
          rank: rang,
          zone,
          ip: membre.ip,
          vlan: groupe.vlan.id,
          model: membre.model,
          vendor: membre.vendor,
          notes: routable ? membre.notes : 'VLAN non routé : ce domaine ne sort pas du niveau 2.',
        }),
      )
    }
  })

  return {
    title: diagram.title,
    nodes,
    links,
    vlans: diagram.vlans,
    layerNames,
    layerColors,
    locked: true,
  }
}

/**
 * Projection « routage ».
 *
 * On garde ce qui route et ce qui porte une adresse, et l'on remplace les chaînes de
 * commutation par les réseaux qu'elles desservent : un schéma de routage tient sur une page
 * et se lit comme un plan d'adressage.
 */
function routageL3(diagram: Diagram): Diagram {
  /*
    Ne survit que ce qui décide d'un chemin : les routeurs, les pare-feu, les répartiteurs,
    le cœur de niveau 3, les extrémités WAN — et tout équipement qui porte une passerelle.
    Un serveur, même adressé, n'est pas un routeur : il est représenté par le réseau auquel
    il appartient, et c'est ce qui fait tenir la vue sur une page.
  */
  const ROUTE = new Set([
    'router', 'sdwan', 'router-5g', 'firewall', 'ngfw', 'loadbalancer', 'waf', 'ztna', 'swg',
    'core-switch', 'spine', 'wan', 'internet', 'cloud', 'cloud-region', 'vpc',
    'cloud-interconnect', 'sase-pop', 'cdn', 'modem', 'vpn-concentrator', 'ot-gateway',
  ])
  const passerelles = new Set(
    (diagram.vlans ?? []).map((vlan) => vlan.gateway?.trim()).filter(Boolean) as string[],
  )
  const garde = (node: NetNode) =>
    ROUTE.has(node.kind) ||
    (!!node.ip?.trim() && passerelles.has(node.ip.trim())) ||
    (!!node.vip?.trim() && passerelles.has(node.vip.trim()))

  const gardes = diagram.nodes.filter(garde)
  const ids = new Set(gardes.map((node) => node.id))
  const nodes: NetNode[] = gardes.map((node) => ({ ...node }))
  // Et seules les liaisons qui portent effectivement du niveau 3 : un agrégat entre deux
  // commutateurs est de la plomberie de niveau 2, il n'a rien à faire sur un plan de routage.
  const links: NetLink[] = diagram.links
    .filter((link) => ids.has(link.from) && ids.has(link.to))
    .filter((link) => linkInView(link, 'l3', diagram))
    .map((link) => ({ ...link, lag: undefined, lacp: undefined }))

  /*
    Les réseaux desservis. Chaque VLAN adressé devient un nuage, raccroché à l'équipement qui
    porte sa passerelle — ou, faute de mieux, au commutateur de niveau 3 le plus haut placé.
    Les onze commutateurs et les postes disparaissent : ils ne routent rien.
  */
  const rattachement =
    gardes.find((node) => node.kind === 'core-switch') ??
    gardes.find((node) => ['router', 'firewall', 'ngfw'].includes(node.kind))
  const rangReseaux =
    Math.max(0, ...nodes.map((node) => deviceMeta(node.kind).rank)) + 1

  for (const groupe of membresParVlan(diagram)) {
    const reseau = groupe.vlan.subnet?.trim()
    if (!reseau || groupe.membres.length === 0) continue
    const cible = groupe.passerelle && ids.has(groupe.passerelle.id) ? groupe.passerelle : rattachement
    if (!cible) continue
    const id = `net~${groupe.vlan.id}`
    nodes.push(
      noeud(id, 'cloud', titreVlan(groupe.vlan), {
        rank: rangReseaux,
        vlan: groupe.vlan.id,
        notes: `${groupe.membres.length} équipement(s) dans ce domaine de diffusion.`,
      }),
    )
    links.push(
      lien(`l~${id}`, cible.id, id, 'ethernet', {
        label: groupe.vlan.gateway ? `passerelle ${groupe.vlan.gateway}` : undefined,
        subnet: reseau,
        vlans: groupe.vlan.id,
        layers: ['l3'],
      }),
    )
  }

  return {
    title: diagram.title,
    nodes,
    links,
    vlans: diagram.vlans,
    annotations: [],
    layerNames: { [String(rangReseaux)]: 'Réseaux desservis' },
    locked: true,
  }
}

/*
  Le calcul est refait à chaque rendu du plan : on garde le dernier résultat, qui ne dépend que
  du document, de la vue et des options de placement.
*/
let cache: { diagram: Diagram; vue: VueLogique; layout: LayoutOptions; resultat: Diagram } | null = null

/** Projection logique du document, prête à être dessinée. */
export function projectionLogique(diagram: Diagram, vue: VueLogique, layout: LayoutOptions): Diagram {
  if (cache && cache.diagram === diagram && cache.vue === vue && cache.layout === layout) {
    return cache.resultat
  }
  const brut =
    vue === 'rails' ? railsVlan(diagram) : vue === 'domaines' ? domainesVlan(diagram) : routageL3(diagram)
  const resultat = { ...brut, nodes: autoLayout(brut, layout) }
  cache = { diagram, vue, layout, resultat }
  return resultat
}

/** Équipements et liaisons que porte un VLAN donné : le « projecteur » du plan. */
export function porteurs(diagram: Diagram, vlanId: string): { nodes: Set<string>; links: Set<string> } {
  const nodes = new Set<string>()
  const links = new Set<string>()
  for (const node of diagram.nodes) {
    if (parseVlanList(node.vlan?.replace(/vlan/gi, '')).includes(vlanId)) nodes.add(node.id)
  }
  for (const link of diagram.links) {
    const portes = parseVlanList(link.vlans)
    if (link.nativeVlan?.trim()) portes.push(link.nativeVlan.trim())
    if (!portes.includes(vlanId)) continue
    links.add(link.id)
    nodes.add(link.from)
    nodes.add(link.to)
  }
  return { nodes, links }
}
