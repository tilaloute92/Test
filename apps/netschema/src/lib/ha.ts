import { deviceMeta, LINKS, rankOf } from './catalog'
import type { Diagram, NetLink, NetNode } from '../types'

export type Severity = 'critique' | 'avertissement' | 'info'

export interface Finding {
  id: string
  severity: Severity
  title: string
  detail: string
  nodeIds: string[]
}

export interface HaReport {
  findings: Finding[]
  /** Note de robustesse 0–100, dérivée des constats. */
  score: number
  level: 'Solide' | 'Perfectible' | 'Fragile'
  counts: Record<Severity, number>
  /** Équipements dont la panne coupe le réseau en deux (points d'articulation). */
  spof: string[]
}

const SEVERITY_WEIGHT: Record<Severity, number> = { critique: 12, avertissement: 5, info: 2 }

/** Familles pour lesquelles un témoin de quorum a un sens (cluster de calcul ou de données). */
const QUORUM_KINDS = new Set<string>(['hypervisor', 'storage', 'server', 'backup', 'witness'])
const SEVERITY_ORDER: Record<Severity, number> = { critique: 0, avertissement: 1, info: 2 }

const trimmed = (value?: string) => value?.trim() ?? ''

/** Liaisons qui transportent réellement le trafic (hors battement de cœur, réplication, OOB, énergie). */
function transportLinks(diagram: Diagram): NetLink[] {
  return diagram.links.filter((link) => !LINKS[link.kind]?.service)
}

function adjacencyOf(links: NetLink[], allowed: Set<string>): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  for (const id of allowed) adj.set(id, new Set())
  for (const link of links) {
    if (!allowed.has(link.from) || !allowed.has(link.to) || link.from === link.to) continue
    adj.get(link.from)!.add(link.to)
    adj.get(link.to)!.add(link.from)
  }
  return adj
}

/**
 * Points d'articulation du graphe (algorithme de Tarjan) : les sommets dont la disparition
 * scinde le réseau en plusieurs morceaux. C'est la définition même d'un point de défaillance
 * unique dans une architecture réseau.
 */
function articulationPoints(adj: Map<string, Set<string>>): Set<string> {
  const disc = new Map<string, number>()
  const low = new Map<string, number>()
  const parent = new Map<string, string | null>()
  const cuts = new Set<string>()
  let timer = 0

  for (const start of adj.keys()) {
    if (disc.has(start)) continue
    parent.set(start, null)
    disc.set(start, timer)
    low.set(start, timer)
    timer += 1
    let rootChildren = 0

    // Parcours en profondeur itératif : pas de limite de pile sur les grands schémas.
    const stack: { node: string; iterator: Iterator<string> }[] = [
      { node: start, iterator: adj.get(start)!.values() },
    ]

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const next = frame.iterator.next()

      if (!next.done) {
        const neighbour = next.value
        if (!disc.has(neighbour)) {
          parent.set(neighbour, frame.node)
          if (frame.node === start) rootChildren += 1
          disc.set(neighbour, timer)
          low.set(neighbour, timer)
          timer += 1
          stack.push({ node: neighbour, iterator: (adj.get(neighbour) ?? new Set()).values() })
        } else if (neighbour !== parent.get(frame.node)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, disc.get(neighbour)!))
        }
        continue
      }

      stack.pop()
      const up = parent.get(frame.node)
      if (up != null) {
        low.set(up, Math.min(low.get(up)!, low.get(frame.node)!))
        // Un sommet non racine est un point d'articulation dès qu'un de ses fils ne peut
        // pas remonter au-dessus de lui sans repasser par lui.
        if (up !== start && low.get(frame.node)! >= disc.get(up)!) cuts.add(up)
      }
    }

    // La racine n'est un point d'articulation que si elle porte au moins deux sous-arbres.
    if (rootChildren > 1) cuts.add(start)
  }

  return cuts
}

interface Cluster {
  name: string
  members: NetNode[]
}

function clustersOf(nodes: NetNode[]): Cluster[] {
  const buckets = new Map<string, NetNode[]>()
  for (const node of nodes) {
    const name = trimmed(node.cluster)
    if (!name) continue
    const bucket = buckets.get(name)
    if (bucket) bucket.push(node)
    else buckets.set(name, [node])
  }
  return [...buckets.entries()].map(([name, members]) => ({ name, members }))
}

/**
 * Analyse de haute disponibilité : reprend les règles de l'art des infrastructures
 * redondées — pas de point de défaillance unique, double attachement, grappes avec
 * battement de cœur et quorum, double adduction opérateur, double chaîne électrique,
 * second site pour le plan de reprise, sauvegarde.
 */
export function auditDiagram(diagram: Diagram): HaReport {
  const findings: Finding[] = []
  const add = (finding: Finding) => findings.push(finding)
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]))
  const transport = transportLinks(diagram)
  const clusters = clustersOf(diagram.nodes)
  const clusterOfNode = new Map<string, Cluster>()
  for (const cluster of clusters) for (const member of cluster.members) clusterOfNode.set(member.id, cluster)

  const infrastructure = diagram.nodes.filter((n) => deviceMeta(n.kind).infrastructure)
  const infraIds = new Set(infrastructure.map((n) => n.id))
  const infraAdj = adjacencyOf(transport, infraIds)
  const cuts = articulationPoints(infraAdj)

  // 1. Points de défaillance uniques
  for (const id of cuts) {
    const node = byId.get(id)
    if (!node) continue
    const meta = deviceMeta(node.kind)
    const clustered = (clusterOfNode.get(id)?.members.length ?? 0) > 1
    add({
      id: `spof:${id}`,
      severity: meta.critical && !clustered ? 'critique' : 'avertissement',
      title: `Point de défaillance unique : ${node.name}`,
      detail: `La panne de cet équipement coupe le réseau en deux. ${
        clustered
          ? "La grappe existe mais aucun chemin ne contourne l'équipement."
          : 'Prévoyez un pair redondant et un second chemin.'
      }`,
      nodeIds: [id],
    })
  }

  // 2. Équipements critiques sans pair
  for (const node of diagram.nodes) {
    const meta = deviceMeta(node.kind)
    if (!meta.critical) continue
    const cluster = clusterOfNode.get(node.id)
    if (cluster && cluster.members.length > 1) continue
    const peers = diagram.nodes.filter((n) => n.id !== node.id && n.kind === node.kind)
    if (peers.length > 0) continue
    add({
      id: `nopeer:${node.id}`,
      severity: 'avertissement',
      title: `${node.name} n'a aucun équipement de secours`,
      detail: `Aucun autre ${meta.label.toLowerCase()} dans le schéma : la fonction repose sur un seul équipement.`,
      nodeIds: [node.id],
    })
  }

  // 3. Simple attachement : un seul lien montant vers la couche inférieure
  for (const node of infrastructure) {
    const rank = rankOf(node.kind, node.rank)
    if (rank <= 1) continue
    const uplinks = new Set(
      transport
        .filter((l) => l.from === node.id || l.to === node.id)
        .map((l) => (l.from === node.id ? l.to : l.from))
        .filter((id) => {
          const peer = byId.get(id)
          return peer ? rankOf(peer.kind, peer.rank) < rank : false
        }),
    )
    if (uplinks.size === 0) {
      // Un équipement peut aussi être raccordé latéralement (interconnexion inter-sites,
      // lien entre deux cœurs de réseau) : ce n'est pas une anomalie.
      const lateral = transport
        .filter((l) => l.from === node.id || l.to === node.id)
        .map((l) => (l.from === node.id ? l.to : l.from))
        .some((id) => {
          const peer = byId.get(id)
          return peer ? rankOf(peer.kind, peer.rank) === rank && trimmed(peer.cluster) !== trimmed(node.cluster) : false
        })
      if (!lateral) {
        add({
          id: `nouplink:${node.id}`,
          severity: 'avertissement',
          title: `${node.name} n'a aucun raccordement amont`,
          detail: "L'équipement n'est relié à aucune couche supérieure : vérifiez le schéma.",
          nodeIds: [node.id],
        })
      }
    } else if (uplinks.size === 1) {
      // Le double attachement est la règle pour le cœur et la distribution ; en couche
      // d'accès il reste un conseil, rarement appliqué à chaque prise.
      add({
        id: `single:${node.id}`,
        severity: rank <= 4 ? 'avertissement' : 'info',
        title: `${node.name} est en simple attachement`,
        detail: 'Un seul lien montant : à doubler vers un second équipement (double attachement).',
        nodeIds: [node.id],
      })
    }
  }

  // 4 à 7. Contrôles des grappes
  for (const cluster of clusters) {
    const ids = cluster.members.map((m) => m.id)
    const memberSet = new Set(ids)
    const witnesses = cluster.members.filter((m) => m.role === 'witness' || m.kind === 'witness')
    const actives = cluster.members.filter((m) => m.role === 'active' || m.role === 'active-active')
    const heartbeat = diagram.links.some(
      (l) => (l.kind === 'heartbeat' || l.kind === 'stack') && memberSet.has(l.from) && memberSet.has(l.to),
    )

    if (cluster.members.length < 2) {
      add({
        id: `lonely:${cluster.name}`,
        severity: 'avertissement',
        title: `La grappe « ${cluster.name} » n'a qu'un membre`,
        detail: 'Une grappe à un seul nœud n\'apporte aucune disponibilité supplémentaire.',
        nodeIds: ids,
      })
      continue
    }

    if (!heartbeat) {
      add({
        id: `hb:${cluster.name}`,
        severity: 'avertissement',
        title: `Aucun lien de battement de cœur dans « ${cluster.name} »`,
        detail:
          'Reliez les membres par une liaison « Battement de cœur (HA) » ou « Stack / MLAG » : sans elle, la bascule ne peut pas être arbitrée.',
        nodeIds: ids,
      })
    }

    // Le quorum concerne les grappes de calcul et de données ; VRRP/HSRP et MLAG
    // s'arbitrent par priorité et par lien de pile, sans témoin.
    const needsQuorum = cluster.members.some((m) => QUORUM_KINDS.has(m.kind))
    if (needsQuorum && cluster.members.length === 2 && witnesses.length === 0) {
      add({
        id: `quorum:${cluster.name}`,
        severity: 'avertissement',
        title: `La grappe « ${cluster.name} » n'a pas de témoin de quorum`,
        detail:
          'Une grappe à deux nœuds peut partir en cerveau divisé (split-brain). Ajoutez un témoin, un troisième nœud ou un quorum externe.',
        nodeIds: ids,
      })
    }

    if (actives.length === 0) {
      add({
        id: `role:${cluster.name}`,
        severity: 'info',
        title: `Aucun rôle actif déclaré dans « ${cluster.name} »`,
        detail: 'Précisez le rôle de chaque membre (actif, passif, actif/actif) pour documenter la bascule.',
        nodeIds: ids,
      })
    } else if (actives.length > 1 && actives.some((m) => m.role === 'active')) {
      add({
        id: `roleconflict:${cluster.name}`,
        severity: 'info',
        title: `Rôles ambigus dans « ${cluster.name} »`,
        detail: 'Plusieurs membres actifs : utilisez « Actif / actif » si la charge est répartie, sinon un seul actif.',
        nodeIds: actives.map((m) => m.id),
      })
    }

    if (!cluster.members.some((m) => trimmed(m.vip))) {
      add({
        id: `vip:${cluster.name}`,
        severity: 'info',
        title: `Pas d'adresse virtuelle pour « ${cluster.name} »`,
        detail: 'Renseignez la VIP (VRRP / HSRP / VIP de répartiteur) portée par la grappe.',
        nodeIds: ids,
      })
    }
  }

  // 8. Double adduction opérateur
  const outsides = diagram.nodes.filter((n) => n.kind === 'wan' || n.kind === 'internet')
  if (outsides.length === 1) {
    add({
      id: 'wan:single',
      severity: 'avertissement',
      title: 'Une seule adduction vers l’extérieur',
      detail: 'Un seul accès opérateur : prévoyez un second lien, idéalement chez un autre opérateur et sur un autre chemin physique.',
      nodeIds: outsides.map((n) => n.id),
    })
  }

  // 9. Chaîne électrique
  const upsList = diagram.nodes.filter((n) => n.kind === 'ups')
  // Les accès opérateur ne sont pas alimentés par nos chaînes électriques : hors périmètre.
  const criticalNodes = diagram.nodes.filter(
    (n) => deviceMeta(n.kind).critical && n.kind !== 'ups' && rankOf(n.kind, n.rank) > 0,
  )
  const unprotected = criticalNodes.filter((n) => !n.dualPower)
  if (upsList.length === 1) {
    add({
      id: 'power:singleups',
      severity: 'avertissement',
      title: 'Une seule chaîne électrique ondulée',
      detail: 'Un onduleur unique redevient le point de défaillance : doublez la chaîne (A/B) sur deux arrivées distinctes.',
      nodeIds: upsList.map((n) => n.id),
    })
  } else if (upsList.length === 0 && criticalNodes.length > 0) {
    add({
      id: 'power:noups',
      severity: 'info',
      title: 'Aucune alimentation secourue représentée',
      detail: 'Ajoutez les onduleurs et bandeaux PDU : la disponibilité électrique fait partie de la disponibilité du réseau.',
      nodeIds: [],
    })
  }
  if (unprotected.length > 0 && upsList.length > 0) {
    add({
      id: 'power:single',
      severity: 'info',
      title: `${unprotected.length} équipement(s) critique(s) sans double alimentation`,
      detail: 'Cochez « Double alimentation (A/B) » sur les équipements raccordés aux deux chaînes électriques.',
      nodeIds: unprotected.map((n) => n.id),
    })
  }

  // 10. Second site et sauvegarde
  const sites = new Set(diagram.nodes.map((n) => trimmed(n.site)).filter(Boolean))
  if (sites.size <= 1 && diagram.nodes.length > 4) {
    add({
      id: 'site:single',
      severity: 'info',
      title: 'Un seul site représenté',
      detail: 'Aucun site de repli : un plan de reprise d’activité suppose un second site et une réplication des données.',
      nodeIds: [],
    })
  }
  if (diagram.nodes.length > 4 && !diagram.nodes.some((n) => n.kind === 'backup')) {
    add({
      id: 'backup:none',
      severity: 'info',
      title: 'Aucune sauvegarde représentée',
      detail: 'La redondance ne remplace pas la sauvegarde : ajoutez le serveur de sauvegarde et sa liaison de réplication.',
      nodeIds: [],
    })
  }

  // 11. Liens parallèles non déclarés en agrégat
  const pairs = new Map<string, NetLink[]>()
  for (const link of transport) {
    const key = [link.from, link.to].sort().join('~')
    const bucket = pairs.get(key)
    if (bucket) bucket.push(link)
    else pairs.set(key, [link])
  }
  for (const [key, group] of pairs) {
    if (group.length < 2) continue
    if (group.some((l) => l.kind === 'trunk' || l.kind === 'stack')) continue
    const [a, b] = key.split('~')
    add({
      id: `lacp:${key}`,
      severity: 'info',
      title: `Liens parallèles non agrégés entre ${byId.get(a)?.name ?? '?'} et ${byId.get(b)?.name ?? '?'}`,
      detail: 'Deux liens entre les mêmes équipements : déclarez-les en agrégat LACP (type « Trunk / agrégat »).',
      nodeIds: [a, b],
    })
  }

  findings.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.title.localeCompare(b.title),
  )

  const counts: Record<Severity, number> = { critique: 0, avertissement: 0, info: 0 }
  let penalty = 0
  for (const finding of findings) {
    counts[finding.severity] += 1
    penalty += SEVERITY_WEIGHT[finding.severity]
  }
  const score = diagram.nodes.length === 0 ? 100 : Math.max(0, Math.min(100, 100 - penalty))

  return {
    findings,
    score,
    level: counts.critique > 0 || score < 50 ? 'Fragile' : score < 80 ? 'Perfectible' : 'Solide',
    counts,
    spof: [...cuts],
  }
}
