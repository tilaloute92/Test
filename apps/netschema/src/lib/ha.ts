import { deviceMeta, LINKS, rankOf, ROLES } from './catalog'
import {
  concerneConstructeur,
  concerneGamme,
  constructeurDe,
  mecanismeDeLaGamme,
  mecanismeHa,
  proposerMecanisme,
} from './haTech'
import type { Diagram, LinkKind, NetLink, NetNode } from '../types'

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
export function articulationPoints(adj: Map<string, Set<string>>): Set<string> {
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
 * Contrôles du mécanisme de haute disponibilité déclaré sur une grappe.
 *
 * Le schéma montre deux boîtes et un trait ; le mécanisme dit ce que ce trait doit être, à
 * combien de membres il s'applique, s'il faut un témoin, et surtout ce que la grappe ne
 * protège pas — un empilement partage un plan de contrôle, et une mise à jour logicielle
 * emporte les deux châssis d'un coup.
 */
function controlerMecanisme(
  cluster: Cluster,
  diagram: Diagram,
  memberSet: Set<string>,
  witnesses: NetNode[],
  actives: NetNode[],
  add: (finding: Finding) => void,
) {
  const ids = cluster.members.map((m) => m.id)
  const declares = [...new Set(cluster.members.map((m) => trimmed(m.haTech)).filter(Boolean))]

  // Liaison réellement tracée entre les membres : elle sert à proposer et à contrôler.
  const interne = diagram.links.find((l) => memberSet.has(l.from) && memberSet.has(l.to))
  const lienInterne = interne?.kind as LinkKind | undefined

  if (declares.length === 0) {
    const reference = cluster.members.find((m) => m.role !== 'witness') ?? cluster.members[0]
    const propose = proposerMecanisme(
      reference.kind,
      constructeurDe(reference.vendor, reference.model),
      lienInterne,
      cluster.members.filter((m) => m.role !== 'witness').length,
      reference.model,
    )
    add({
      id: `hatech:${cluster.name}`,
      severity: 'info',
      title: `Mécanisme de bascule non documenté dans « ${cluster.name} »`,
      detail: propose
        ? `Deux équipements en grappe ne disent pas comment ils basculent. D'après le matériel et la liaison tracée, il s'agit probablement de « ${propose.label} » — à confirmer dans l'inspecteur.`
        : "Deux équipements en grappe ne disent pas comment ils basculent : précisez le mécanisme (VRRP, vPC, FGCP, vSphere HA…) dans l'inspecteur.",
      nodeIds: ids,
    })
    return
  }

  if (declares.length > 1) {
    add({
      id: `hatech-mix:${cluster.name}`,
      severity: 'avertissement',
      title: `Mécanismes divergents dans « ${cluster.name} »`,
      detail: `Les membres ne déclarent pas le même mécanisme (${declares
        .map((id) => mecanismeHa(id)?.label ?? id)
        .join(', ')}) : une grappe n'en a qu'un.`,
      nodeIds: ids,
    })
  }

  const mecanisme = mecanismeHa(declares[0])
  if (!mecanisme) return
  const membresActifs = cluster.members.filter((m) => m.role !== 'witness')

  // Constructeur : un vPC sur un Aruba ou un VSX sur un Nexus n'existe pas.
  /*
    Chaque membre est contrôlé contre le mécanisme qu'il déclare lui-même : quand la grappe
    en mélange deux, reprocher au second le mécanisme du premier n'aiderait personne.
  */
  const mecanismeDe = (m: NetNode) => mecanismeHa(trimmed(m.haTech)) ?? mecanisme
  const etranger = membresActifs.filter((m) => {
    const constructeur = constructeurDe(m.vendor, m.model)
    return !!constructeur && !concerneConstructeur(mecanismeDe(m), constructeur)
  })
  if (mecanisme.vendors.length > 0 && etranger.length > 0) {
    add({
      id: `hatech-vendor:${cluster.name}`,
      severity: 'avertissement',
      title: `« ${mecanisme.label} » ne correspond pas au matériel de « ${cluster.name} »`,
      detail: `Ce mécanisme est propre à ${mecanisme.vendors.join(', ')} ; ${etranger
        .map((m) => `${m.name} (${constructeurDe(m.vendor, m.model)})`)
        .join(', ')} ne le met pas en œuvre. Vérifiez le mécanisme ou le constructeur saisi.`,
      nodeIds: etranger.map((m) => m.id),
    })
  }

  // Gamme : le constructeur ne suffit pas, vPC est un mécanisme Nexus et non Catalyst.
  const horsGamme = membresActifs.filter((m) => concerneGamme(mecanismeDe(m), m.model) === false)
  if (horsGamme.length > 0) {
    const premier = horsGamme[0]
    const declare = mecanismeDe(premier)
    const attendu = mecanismeDeLaGamme(
      declare,
      premier.kind,
      constructeurDe(premier.vendor, premier.model),
      premier.model,
    )
    add({
      id: `hatech-gamme:${cluster.name}`,
      severity: 'avertissement',
      title: `« ${declare.label} » ne concerne pas la gamme de ${horsGamme.map((m) => m.name).join(', ')}`,
      detail: `${horsGamme
        .map((m) => `${m.name} (${m.model})`)
        .join(', ')} : ce mécanisme s'adresse à une autre gamme du même constructeur.${
        attendu ? ` Sur ce matériel, il s'agit plutôt de « ${attendu.label} ».` : ''
      }`,
      nodeIds: horsGamme.map((m) => m.id),
    })
  }

  // Type d'équipement : un mécanisme de stockage déclaré sur un switch.
  const horsType = membresActifs.filter((m) => !mecanisme.kinds.includes(m.kind))
  if (horsType.length > 0) {
    add({
      id: `hatech-kind:${cluster.name}`,
      severity: 'info',
      title: `« ${mecanisme.label} » inhabituel pour ${horsType.map((m) => m.name).join(', ')}`,
      detail: `Ce mécanisme s'applique d'ordinaire à : ${mecanisme.kinds
        .map((kind) => deviceMeta(kind).label.toLowerCase())
        .join(', ')}.`,
      nodeIds: horsType.map((m) => m.id),
    })
  }

  // Nombre de membres supporté.
  if (membresActifs.length < mecanisme.membres.min) {
    add({
      id: `hatech-min:${cluster.name}`,
      severity: 'avertissement',
      title: `« ${mecanisme.label} » demande au moins ${mecanisme.membres.min} membres`,
      detail: `La grappe « ${cluster.name} » n'en compte que ${membresActifs.length}. ${mecanisme.note}`,
      nodeIds: ids,
    })
  } else if (mecanisme.membres.max && membresActifs.length > mecanisme.membres.max) {
    add({
      id: `hatech-max:${cluster.name}`,
      severity: 'avertissement',
      title: `« ${mecanisme.label} » accepte ${mecanisme.membres.max} membres au plus`,
      detail: `La grappe « ${cluster.name} » en compte ${membresActifs.length} : vérifiez la topologie déclarée.`,
      nodeIds: ids,
    })
  }

  // Liaison de synchronisation attendue, nommée dans les termes du mécanisme.
  if (mecanisme.lien) {
    const correcte = diagram.links.some(
      (l) => memberSet.has(l.from) && memberSet.has(l.to) && mecanisme.lien!.kind.includes(l.kind),
    )
    if (!correcte) {
      add({
        id: `hatech-lien:${cluster.name}`,
        severity: 'avertissement',
        title: `« ${mecanisme.label} » : ${mecanisme.lien.nom} absent du schéma`,
        detail: `Tracez la liaison entre les membres de « ${cluster.name} » (type ${mecanisme.lien.kind
          .map((kind) => LINKS[kind]?.label ?? kind)
          .join(' ou ')}). Sans elle, la bascule ne peut ni s'arbitrer ni se documenter.`,
        nodeIds: ids,
      })
    }
  }

  /*
    Certains mécanismes n'ont pas une liaison mais deux ou trois, de natures différentes :
    chez Palo Alto, HA1 porte l'élection et la configuration, HA2 les sessions, HA3 les
    paquets en actif/actif. Les confondre sur un schéma, c'est promettre une bascule que le
    câblage ne permet pas.
  */
  const obligatoires = (mecanisme.liensComplementaires ?? []).filter((item) => item.obligatoire)
  if (obligatoires.length > 0) {
    const tracees = diagram.links.filter((l) => memberSet.has(l.from) && memberSet.has(l.to)).length
    const attendues = 1 + obligatoires.length
    if (tracees < attendues) {
      add({
        id: `hatech-liens:${cluster.name}`,
        severity: 'info',
        title: `« ${mecanisme.label} » demande ${attendues} liaisons entre les membres`,
        detail: `${tracees} tracée(s) dans « ${cluster.name} ». Outre ${mecanisme.lien?.nom ?? 'la liaison principale'}, il faut : ${obligatoires
          .map((item) => item.nom)
          .join(' ; ')}.`,
        nodeIds: ids,
      })
    }
  }

  // Témoin : c'est ce qui manque le plus souvent aux architectures étirées sur deux salles.
  if (mecanisme.temoin && witnesses.length === 0 && membresActifs.length <= 2) {
    add({
      id: `hatech-temoin:${cluster.name}`,
      severity: 'avertissement',
      title: `« ${mecanisme.label} » exige un témoin d'arbitrage`,
      detail:
        "Sans témoin sur un troisième emplacement, la coupure entre les deux membres laisse les deux côtés se croire seuls survivants (cerveau divisé), ou bloque la bascule automatique.",
      nodeIds: ids,
    })
  }

  // Adresse virtuelle attendue par le mécanisme.
  if (mecanisme.vip && !cluster.members.some((m) => trimmed(m.vip))) {
    add({
      id: `hatech-vip:${cluster.name}`,
      severity: 'info',
      title: `« ${mecanisme.label} » porte une adresse virtuelle`,
      detail: `Renseignez-la sur les membres de « ${cluster.name} » : c'est elle que les autres équipements utilisent, pas l'adresse d'un nœud.`,
      nodeIds: ids,
    })
  }

  // Rôles cohérents avec le mécanisme.
  const rolesIncoherents = membresActifs.filter(
    (m) => m.role && m.role !== 'standalone' && !mecanisme.roles.includes(m.role),
  )
  if (rolesIncoherents.length > 0) {
    add({
      id: `hatech-role:${cluster.name}`,
      severity: 'info',
      title: `Rôle inattendu pour « ${mecanisme.label} »`,
      detail: `${rolesIncoherents.map((m) => m.name).join(', ')} : ce mécanisme fonctionne en ${mecanisme.roles
        .map((role) => ROLES[role].label.toLowerCase())
        .join(' ou ')}.`,
      nodeIds: rolesIncoherents.map((m) => m.id),
    })
  }

  // Le point que le schéma ne montre jamais : un plan de contrôle commun.
  if (mecanisme.planDeControleCommun) {
    add({
      id: `hatech-controle:${cluster.name}`,
      severity: 'info',
      title: `« ${cluster.name} » ne forme qu'un seul plan de contrôle`,
      detail: `${mecanisme.label} : les membres se comportent comme un équipement unique. La grappe protège d'une panne matérielle, pas d'un bogue logiciel ni d'une mise à jour ratée — ${mecanisme.note}`,
      nodeIds: ids,
    })
  }

  // Un seul actif déclaré alors que le mécanisme répartit la charge (ou l'inverse).
  if (
    mecanisme.roles.includes('active-active') &&
    !mecanisme.roles.includes('active') &&
    actives.some((m) => m.role === 'active')
  ) {
    add({
      id: `hatech-aa:${cluster.name}`,
      severity: 'info',
      title: `« ${mecanisme.label} » fonctionne en actif / actif`,
      detail: `Déclarez les membres de « ${cluster.name} » en « Actif / actif » : aucun n'est en veille, la charge est répartie entre eux.`,
      nodeIds: ids,
    })
  }
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

    controlerMecanisme(cluster, diagram, memberSet, witnesses, actives, add)
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
