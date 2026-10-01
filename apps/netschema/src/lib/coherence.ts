/**
 * Cohérence des niveaux 2 et 3.
 *
 * `osi.ts` contrôle le plan d'adressage : ce qui est écrit est-il bien formé, complet, sans
 * doublon. Ce module contrôle autre chose — ce que la configuration **produirait** sur le
 * terrain. Un trunk dont les deux bouts n'autorisent pas les mêmes VLAN est parfaitement bien
 * documenté et jette pourtant la moitié du trafic ; un VLAN natif discordant ouvre un passage
 * entre deux domaines qui ne devaient pas se parler ; un VLAN de 9000 octets qui traverse un
 * câble resté à 1500 ne se voit nulle part et casse les sauvegardes un soir sur deux.
 *
 * Ce sont les pannes qu'on diagnostique à trois heures du matin et qu'un schéma complet
 * aurait dû annoncer. Chaque règle ne se déclenche donc que sur des données réellement
 * saisies : mieux vaut taire un défaut que reprocher un champ vide — un contrôle qui crie
 * pour rien, on cesse de le lire.
 */

import {
  ipInSubnet,
  linkEnd,
  parseSubnet,
  parseVlanList,
  resumerVlans,
  subnetKey,
  usedVlans,
  type OsiFinding,
} from './osi'
import { estTrunk, porteeVlans, vlansDeclares, type PorteeVlan } from './vlanReach'
import type { Diagram, NetNode, UsageVlan } from '../types'

/**
 * Équipements qui relaient un VLAN d'un port à l'autre. Même liste que pour le calcul de
 * portée : un serveur ne commute rien, il n'étend aucun domaine.
 */
const RELAIS = new Set([
  'core-switch',
  'switch',
  'access-switch',
  'spine',
  'leaf',
  'industrial-switch',
  'din-switch',
  'network-tap',
  'wifi-bridge',
  'wlan-controller',
])

/**
 * Équipements qui routent entre VLAN. Un switch d'accès commute, il ne route pas : un VLAN
 * qui n'atteint que des switches d'accès n'a aucune passerelle, quoi qu'en dise la table.
 */
const ROUTE = new Set([
  'router',
  'router-5g',
  'sdwan',
  'firewall',
  'ngfw',
  'core-switch',
  'spine',
  'loadbalancer',
  'vpn-concentrator',
  'wan',
  'internet',
])

const ipVersEntier = (valeur: string): number | null => {
  const parts = valeur.trim().split('.')
  if (parts.length !== 4) return null
  let total = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    total = (total * 256 + octet) >>> 0
  }
  return total >>> 0
}

const nomDe = (node: NetNode | undefined) => node?.name ?? '?'

export interface OptionsCoherence {

  /** Nature déduite des VLAN : un VLAN de transit ne se juge pas comme un VLAN de service. */
  usages?: Map<string, UsageVlan>

  /** Propagation des VLAN le long des trunks (réglage du panneau L2/L3). */
  propagation?: boolean
}

/**
 * Contrôles de cohérence L2/L3, à concaténer aux constats de `checkOsi`.
 *
 * Rendu dans le même format : le panneau L2/L3 et le dossier technique les affichent sans
 * rien savoir de leur origine, et un clic sélectionne les équipements concernés.
 */
export function controlesCoherence(diagram: Diagram, options: OptionsCoherence = {}): OsiFinding[] {
  const findings: OsiFinding[] = []
  const { usages, propagation = true } = options
  const parId = new Map(diagram.nodes.map((node) => [node.id, node]))
  const parLiaison = new Map(diagram.links.map((link) => [link.id, link]))
  const vlans = diagram.vlans ?? []
  const utilises = usedVlans(diagram)
  const portees = porteeVlans(diagram, propagation)
  const nature = (id: string): UsageVlan => usages?.get(id) ?? 'service'

  // ─── Niveau 2 : ce que les deux bouts d'un câble ne disent pas pareil ──────
  for (const link of diagram.links) {
    const a = linkEnd(link, 'a')
    const b = linkEnd(link, 'b')
    const label = `${nomDe(parId.get(link.from))} → ${nomDe(parId.get(link.to))}`

    /*
      VLAN natif discordant. C'est le défaut le plus dangereux d'un trunk : les trames non
      étiquetées entrantes d'un côté ressortent dans un autre VLAN de l'autre. Deux domaines
      de diffusion qui devaient rester séparés communiquent, et aucun filtrage ne le voit.
    */
    if (estTrunk(link) && a.nativeVlan && b.nativeVlan && a.nativeVlan !== b.nativeVlan) {
      findings.push({
        id: `natif-discordant:${link.id}`,
        severity: 'critique',
        title: `VLAN natif discordant sur le trunk ${label}`,
        detail: `Natif ${a.nativeVlan} au départ, ${b.nativeVlan} à l’arrivée : les trames non étiquetées changent de VLAN en traversant ce lien. Deux domaines de diffusion se rejoignent sans passer par aucun filtrage.`,
        nodeIds: [link.from, link.to],
        linkIds: [link.id],
      })
    }

    /*
      VLAN autorisés différents d'un bout à l'autre. Le lien fonctionne, les VLAN communs
      passent — et ceux qui ne sont permis que d'un côté disparaissent en silence. C'est la
      panne « ça marche sauf pour ce service-là », la plus longue à trouver.
    */
    if (estTrunk(link) && a.vlans && b.vlans) {
      const listeA = new Set(parseVlanList(a.vlans))
      const listeB = new Set(parseVlanList(b.vlans))
      const seulA = [...listeA].filter((id) => !listeB.has(id))
      const seulB = [...listeB].filter((id) => !listeA.has(id))
      if (seulA.length > 0 || seulB.length > 0) {
        const cotes = [
          seulA.length > 0 ? `${resumerVlans(seulA.join(','), 4)} au départ seulement` : '',
          seulB.length > 0 ? `${resumerVlans(seulB.join(','), 4)} à l’arrivée seulement` : '',
        ].filter(Boolean)
        findings.push({
          id: `trunk-asymetrique:${link.id}`,
          severity: 'avertissement',
          title: `VLAN autorisés asymétriques sur le trunk ${label}`,
          detail: `${cotes.join(', ')}. Un VLAN permis d’un seul côté ne traverse pas : le trafic est accepté puis jeté, sans message d’erreur.`,
          nodeIds: [link.from, link.to],
          linkIds: [link.id],
        })
      }
    }

    // Un bout en trunk, l'autre en accès : la liaison ne transporte qu'un VLAN, et les
    // trames étiquetées arrivant du trunk sont rejetées.
    if (a.mode && b.mode && a.mode !== b.mode && (a.mode === 'trunk' || b.mode === 'trunk')) {
      findings.push({
        id: `mode-discordant:${link.id}`,
        severity: 'critique',
        title: `Modes de port incompatibles (${label})`,
        detail: `${a.mode} au départ, ${b.mode} à l’arrivée. Un port d’accès rejette les trames étiquetées : seul le VLAN natif du trunk passera, les autres sont perdus.`,
        nodeIds: [link.from, link.to],
        linkIds: [link.id],
      })
    }

    // Port d'accès portant plusieurs VLAN : par définition il n'en porte qu'un.
    const bouts =
      a.mode === b.mode && a.vlans === b.vlans
        ? ([['les deux côtés', a]] as const) // Config commune : un seul constat, pas deux.
        : ([
            ['départ', a],
            ['arrivée', b],
          ] as const)
    for (const [bout, config] of bouts) {
      if (config.mode !== 'access') continue
      const liste = parseVlanList(config.vlans)
      if (liste.length > 1) {
        findings.push({
          id: `acces-multivlan:${link.id}:${bout}`,
          severity: 'avertissement',
          title: `Port d’accès déclaré sur plusieurs VLAN (${label})`,
          detail: `${bout === 'les deux côtés' ? 'Les deux côtés déclarent' : `Côté ${bout} :`} ${resumerVlans(liste.join(','), 4)}. Un port d’accès n’appartient qu’à un seul VLAN — s’il en faut plusieurs, c’est un trunk.`,
          nodeIds: [],
          linkIds: [link.id],
        })
      }
    }

    // Deux extrémités d'une même liaison à la même adresse : conflit garanti.
    if (link.ipA?.trim() && link.ipB?.trim() && link.ipA.trim() === link.ipB.trim()) {
      findings.push({
        id: `liaison-ip-identiques:${link.id}`,
        severity: 'critique',
        title: `Même adresse aux deux bouts de la liaison (${label})`,
        detail: `${link.ipA.trim()} est déclarée au départ et à l’arrivée : conflit d’adresse, ou erreur de saisie.`,
        nodeIds: [link.from, link.to],
        linkIds: [link.id],
      })
    }
  }

  /*
    VLAN natif resté à 1.
    Recommandation constante des constructeurs : le VLAN 1 existe partout par défaut, il n'est
    jamais déclaré, et le laisser comme natif revient à faire transiter le trafic non
    étiqueté dans le VLAN le plus exposé du réseau. On le signale une fois pour tout le
    schéma, pas une fois par trunk : la correction est globale.
  */
  const natifsUn = diagram.links.filter(
    (link) => estTrunk(link) && [linkEnd(link, 'a'), linkEnd(link, 'b')].some((bout) => bout.nativeVlan === '1'),
  )
  if (natifsUn.length > 0) {
    findings.push({
      id: 'natif-vlan-1',
      severity: 'info',
      title: `${natifsUn.length} trunk(s) avec le VLAN 1 en natif`,
      detail:
        'Le VLAN 1 est présent par défaut sur tout le parc et n’est administré nulle part. Les constructeurs recommandent de dédier au natif un VLAN inutilisé, sans équipement ni passerelle.',
      nodeIds: [],
      linkIds: natifsUn.map((link) => link.id),
    })
  }

  // ─── Niveau 2 : ce que la portée des VLAN révèle ───────────────────────────
  for (const vlan of vlans) {
    const portee = portees.get(vlan.id)
    const usage = nature(vlan.id)

    /*
      VLAN déclaré dans le plan d'adressage et porté nulle part.
      Soit il a été supprimé du réseau sans l'être du document — et l'on raisonne alors sur un
      plan d'adressage qui décrit un réseau qui n'existe plus —, soit il est bien en service et
      c'est le schéma qui est incomplet. Les deux méritent d'être tranchés.
    */
    if (!utilises.has(vlan.id)) {
      findings.push({
        id: `vlan-inutilise:${vlan.id}`,
        severity: 'info',
        title: `VLAN ${vlan.id}${vlan.name ? ` (${vlan.name})` : ''} déclaré mais présent nulle part`,
        detail:
          'Il figure dans le plan d’adressage et n’est porté par aucun équipement ni aucune liaison. Retirez-le du plan, ou complétez le schéma s’il est en service.',
        nodeIds: [],
        linkIds: [],
      })
      continue
    }

    /*
      VLAN discontinu : il existe de part et d'autre d'un trunk qui ne le laisse pas passer.
      Sur le papier le VLAN 30 est bien sur les deux switches ; dans les faits il forme deux
      réseaux séparés qui portent le même numéro et le même sous-réseau. Les équipements d'un
      îlot ne joignent pas ceux de l'autre, et la passerelle n'est accessible que d'un côté.
    */
    if (portee && usage === 'service' && porteSurPlusieursRelais(diagram, vlan.id, portee, parId)) {
      const ilots = decouperIlots(diagram, portee, parId)
      if (ilots.length > 1) {
        const tailles = ilots.map((ilot) => ilot.length).sort((x, y) => y - x)
        findings.push({
          id: `vlan-discontinu:${vlan.id}`,
          severity: 'avertissement',
          title: `VLAN ${vlan.id} coupé en ${ilots.length} domaines séparés`,
          detail: `Il est commuté sur ${tailles.reduce((somme, taille) => somme + taille, 0)} équipements répartis en ${ilots.length} groupes (${tailles.join(' + ')}) qu’aucun trunk ne relie. Même numéro, même sous-réseau, mais deux réseaux qui ne se joignent pas.`,
          nodeIds: ilots.flat(),
          linkIds: [],
        })
      }
    }

    /*
      Sous-réseau trop étroit pour ce qu'on y a déjà posé.

      Compté sur les seuls équipements documentés : s'ils ne tiennent déjà pas, le réseau réel
      tient encore moins. La règle ne se limite pas aux VLAN de service, au contraire — un /30
      déduit comme « transit » qui porte quatre postes est précisément la saisie qu'il faut
      relever, et le classement par nature l'aurait passée sous silence.
    */
    if (vlan.subnet?.trim()) {
      const plage = parseSubnet(vlan.subnet)
      const membres = diagram.nodes.filter((node) => vlansDeclares(node).includes(vlan.id))
      if (plage) {
        const capacite = plage.bits >= 31 ? 2 ** (32 - plage.bits) : 2 ** (32 - plage.bits) - 2
        if (membres.length > capacite) {
          findings.push({
            id: `subnet-etroit:${vlan.id}`,
            severity: 'avertissement',
            title: `Sous-réseau trop petit sur le VLAN ${vlan.id}`,
            detail: `${vlan.subnet} n’offre que ${capacite} adresse(s) utilisable(s) pour ${membres.length} équipement(s) déjà documentés dans ce VLAN. Soit le masque est faux, soit ces équipements ne sont pas dans ce VLAN.`,
            nodeIds: membres.map((node) => node.id),
            linkIds: [],
          })
        }
      }
    }

    // ─── Niveau 3 : le VLAN est-il routable, et par qui ? ────────────────────
    if (usage !== 'service') continue
    if (vlan.subnet?.trim() && !vlan.gateway?.trim()) {
      findings.push({
        id: `vlan-sans-passerelle:${vlan.id}`,
        severity: 'info',
        title: `VLAN ${vlan.id} adressé sans passerelle`,
        detail: `${vlan.subnet} est déclaré, mais aucune passerelle : ce VLAN reste isolé, ou sa passerelle n’est pas documentée. Le dépannage commence toujours par elle.`,
        nodeIds: [],
        linkIds: [],
      })
    }

    /*
      VLAN adressé dont la portée ne rencontre aucun équipement de routage. Le sous-réseau est
      bien déclaré, la passerelle aussi peut-être — mais rien, sur le chemin, ne sait router :
      le VLAN ne sort pas de lui-même.
    */
    if (vlan.subnet?.trim() && portee) {
      const routeurs = [...portee.nodes.keys()].filter((id) => {
        const node = parId.get(id)
        return node ? ROUTE.has(node.kind) : false
      })
      if (routeurs.length === 0 && portee.nodes.size > 0) {
        findings.push({
          id: `vlan-sans-routeur:${vlan.id}`,
          severity: 'avertissement',
          title: `VLAN ${vlan.id} adressé mais sans équipement de routage`,
          detail: `${vlan.subnet} n’atteint aucun routeur, pare-feu ni switch de cœur : ce sous-réseau ne communique avec aucun autre. Si c’est voulu, c’est un VLAN isolé ; sinon, il manque son interface de routage sur le schéma.`,
          nodeIds: [...portee.nodes.keys()],
          linkIds: [],
        })
      }
    }
  }

  /*
    MTU hétérogène sur le chemin d'un VLAN.
    Le plus petit MTU du chemin décide pour tout le monde. Un VLAN de stockage ou de
    sauvegarde réglé à 9000 qui traverse un lien resté à 1500 ne tombe pas en panne : il
    fonctionne mal, par intermittence, selon la taille des trames — le symptôme le plus
    trompeur qui soit.
    Le constat est groupé : une épine dorsale à deux MTU touche tous les VLAN qui la
    traversent, et vingt lignes disant la même chose sur vingt numéros différents ne décrivent
    jamais qu'un seul câble à corriger.
  */
  const mtuParVlan = new Map<string, { valeurs: number[]; liens: string[] }>()
  for (const vlan of vlans) {
    const portee = portees.get(vlan.id)
    if (!portee) continue
    const mtus = new Map<number, string[]>()
    for (const id of portee.links.keys()) {
      const link = parLiaison.get(id)
      if (!link?.mtu) continue
      const liste = mtus.get(link.mtu)
      if (liste) liste.push(id)
      else mtus.set(link.mtu, [id])
    }
    if (mtus.size > 1) {
      mtuParVlan.set(vlan.id, {
        valeurs: [...mtus.keys()].sort((x, y) => x - y),
        liens: [...mtus.values()].flat(),
      })
    }
  }
  if (mtuParVlan.size > 0) {
    const touches = [...mtuParVlan.keys()]
    const valeurs = [...new Set([...mtuParVlan.values()].flatMap((item) => item.valeurs))].sort((x, y) => x - y)
    findings.push({
      id: 'vlan-mtu',
      severity: 'avertissement',
      title:
        touches.length === 1
          ? `MTU hétérogènes sur le chemin du VLAN ${touches[0]}`
          : `MTU hétérogènes sur le chemin de ${touches.length} VLAN`,
      detail: `VLAN ${resumerVlans(touches.join(','), 6)} : ${valeurs.join(' et ')} octets selon les liaisons empruntées. Le plus petit s’impose à tout le domaine — les trames de ${valeurs[valeurs.length - 1]} octets seront fragmentées ou rejetées au passage du lien à ${valeurs[0]}.`,
      nodeIds: [],
      linkIds: [...new Set([...mtuParVlan.values()].flatMap((item) => item.liens))],
    })
  }

  // ─── Niveau 3 : les passerelles ────────────────────────────────────────────
  const parPasserelle = new Map<string, string[]>()
  for (const vlan of vlans) {
    const gw = vlan.gateway?.trim()
    if (!gw) continue
    const liste = parPasserelle.get(gw)
    if (liste) liste.push(vlan.id)
    else parPasserelle.set(gw, [vlan.id])

    /*
      Passerelle posée sur l'adresse de réseau ou de diffusion. C'est une adresse qui
      n'appartient à personne : la saisie est fausse, et le premier à s'en apercevoir est
      celui qui ne sort pas du VLAN.
    */
    const plage = vlan.subnet?.trim() ? parseSubnet(vlan.subnet) : null
    const valeur = ipVersEntier(gw)
    if (plage && valeur !== null && plage.bits <= 30 && ipInSubnet(gw, vlan.subnet ?? '') === true) {
      const diffusion = (plage.network + 2 ** (32 - plage.bits) - 1) >>> 0
      if (valeur === plage.network || valeur === diffusion) {
        findings.push({
          id: `passerelle-reservee:${vlan.id}`,
          severity: 'critique',
          title: `Passerelle sur une adresse réservée (VLAN ${vlan.id})`,
          detail: `${gw} est l’adresse ${valeur === plage.network ? 'de réseau' : 'de diffusion'} de ${vlan.subnet} : elle ne peut être attribuée à aucune interface.`,
          nodeIds: [],
          linkIds: [],
        })
      }
    }
  }
  for (const [gw, ids] of parPasserelle) {
    if (ids.length > 1) {
      findings.push({
        id: `passerelle-doublee:${gw}`,
        severity: 'avertissement',
        title: `Même passerelle sur les VLAN ${ids.join(', ')}`,
        detail: `${gw} est déclarée comme passerelle de plusieurs VLAN. Une interface ne porte qu’une adresse par sous-réseau : l’une des deux lignes est fausse.`,
        nodeIds: [],
        linkIds: [],
      })
    }
  }

  /*
    Sous-réseau d'une liaison qui recouvre celui d'un VLAN. `osi.ts` compare déjà les VLAN
    entre eux ; les liaisons de niveau 3 — interconnexions, transits — portent leur propre
    plan et sont oubliées de cette comparaison, alors qu'un /30 d'interco posé au milieu d'un
    /24 de production rend le routage ambigu des deux côtés.
  */
  const plagesVlan = vlans
    .map((vlan) => ({ vlan, plage: vlan.subnet?.trim() ? parseSubnet(vlan.subnet) : null }))
    .filter((item): item is { vlan: (typeof item)['vlan']; plage: NonNullable<(typeof item)['plage']> } => !!item.plage)
  const vus = new Set<string>()
  for (const link of diagram.links) {
    const cidr = link.subnet?.trim()
    if (!cidr) continue
    const plage = parseSubnet(cidr)
    if (!plage) continue
    for (const { vlan, plage: autre } of plagesVlan) {
      if (!recouvre(plage, autre)) continue

      /*
        Une liaison qui appartient au VLAN partage légitimement son plan : une interface de
        niveau 3 posée dans le 10.10.10.0/24 du VLAN 10 n'est pas un recouvrement, c'est
        l'adressage normal de ce VLAN. Seule une plage étrangère pose problème.
      */
      if (portees.get(vlan.id)?.links.has(link.id)) continue
      if (plage.network === autre.network && plage.bits === autre.bits) continue
      const cle = `${subnetKey(cidr)}|${vlan.id}`
      if (vus.has(cle)) continue
      vus.add(cle)
      findings.push({
        id: `liaison-recouvre-vlan:${link.id}:${vlan.id}`,
        severity: 'avertissement',
        title: `Le sous-réseau de liaison ${cidr} recouvre le VLAN ${vlan.id}`,
        detail: `${cidr} (${nomDe(parId.get(link.from))} → ${nomDe(parId.get(link.to))}) et ${vlan.subnet} partagent des adresses : le routage devient ambigu pour les machines concernées.`,
        nodeIds: [],
        linkIds: [link.id],
      })
    }
  }

  /*
    Interconnexion sur un masque large. Une liaison point à point consomme deux adresses ; lui
    donner un /24 n'est pas une faute, mais gaspille 250 adresses et brouille la lecture du
    plan — on cherche ensuite un équipement qui n'a jamais existé dans cette plage.
  */
  const plansVlan = new Set(
    vlans.map((vlan) => (vlan.subnet?.trim() ? subnetKey(vlan.subnet) : null)).filter(Boolean) as string[],
  )
  const larges = diagram.links.filter((link) => {
    const cidr = link.subnet?.trim()
    if (!cidr) return false
    const plage = parseSubnet(cidr)
    if (!plage || plage.bits >= 29) return false

    /*
      Une liaison dont le plan est celui d'un VLAN n'est pas une interconnexion point à point :
      c'est une interface dans un réseau desservi, et son /24 y est parfaitement normal. On ne
      garde que les liaisons qui relient deux équipements de routage sur un plan à elles.
    */
    if (plansVlan.has(subnetKey(cidr) ?? '')) return false
    return [link.from, link.to].every((id) => {
      const node = parId.get(id)
      return node ? ROUTE.has(node.kind) : false
    })
  })
  if (larges.length > 0) {
    findings.push({
      id: 'interco-masque-large',
      severity: 'info',
      title: `${larges.length} liaison(s) d’interconnexion sur un masque large`,
      detail: `${larges
        .slice(0, 4)
        .map((link) => link.subnet)
        .join(', ')}${larges.length > 4 ? '…' : ''} : une interconnexion point à point tient dans un /30, ou un /31 là où le matériel l’accepte.`,
      nodeIds: [],
      linkIds: larges.map((link) => link.id),
    })
  }
  const ordre: Record<OsiFinding['severity'], number> = { critique: 0, avertissement: 1, info: 2 }
  return findings.sort((a, b) => ordre[a.severity] - ordre[b.severity] || a.title.localeCompare(b.title))
}

/** Les deux plages se recouvrent-elles ? La plus large contient-elle la plus étroite ? */
function recouvre(a: { network: number; bits: number }, b: { network: number; bits: number }): boolean {
  const grand = a.bits <= b.bits ? a : b
  const petit = grand === a ? b : a
  const masque = grand.bits === 0 ? 0 : (0xffffffff << (32 - grand.bits)) >>> 0
  return ((petit.network & masque) >>> 0) === grand.network
}

/**
 * Un VLAN est-il réellement commuté sur plusieurs équipements ?
 *
 * Garde-fou de la règle de continuité. Un VLAN cité comme natif sur deux trunks éloignés, ou
 * simplement posé sur un serveur, n'a pas de « domaine » à couper en deux : le dire reviendrait
 * à reprocher une coupure là où il n'y a jamais eu de tissu.
 */
function porteSurPlusieursRelais(
  diagram: Diagram,
  vlanId: string,
  portee: PorteeVlan,
  parId: Map<string, NetNode>,
): boolean {
  const relais = [...portee.nodes.keys()].filter((id) => {
    const node = parId.get(id)
    return node ? RELAIS.has(node.kind) : false
  })
  if (relais.length < 2) return false

  // Cité autrement que comme VLAN natif : un natif seul ne décrit pas un domaine porté.
  return diagram.links.some(
    (link) =>
      portee.links.has(link.id) &&
      [link.vlans, link.vlansA, link.vlansB].some((liste) => parseVlanList(liste).includes(vlanId)),
  )
}

/**
 * Découpe le domaine commuté d'un VLAN en groupes réellement reliés entre eux.
 *
 * On ne raisonne que sur les équipements qui commutent. Un serveur ou un poste n'étend rien :
 * compté comme sommet, il formerait un îlot à lui tout seul dès que sa liaison d'accès ne
 * recopie pas le numéro de VLAN — ce qui est le cas général sur un schéma, et ferait crier la
 * règle sur tous les documents bien faits.
 */
function decouperIlots(diagram: Diagram, portee: PorteeVlan, parId: Map<string, NetNode>): string[][] {
  const dans = new Set(
    [...portee.nodes.keys()].filter((id) => {
      const node = parId.get(id)
      return node ? RELAIS.has(node.kind) : false
    }),
  )
  const voisins = new Map<string, string[]>()
  for (const id of dans) voisins.set(id, [])
  for (const link of diagram.links) {
    if (!portee.links.has(link.id)) continue
    if (!dans.has(link.from) || !dans.has(link.to)) continue
    voisins.get(link.from)?.push(link.to)
    voisins.get(link.to)?.push(link.from)
  }
  const vus = new Set<string>()
  const ilots: string[][] = []
  for (const depart of dans) {
    if (vus.has(depart)) continue
    const file = [depart]
    const groupe: string[] = []
    vus.add(depart)
    while (file.length > 0) {
      const courant = file.shift() as string
      groupe.push(courant)
      for (const voisin of voisins.get(courant) ?? []) {
        if (vus.has(voisin)) continue
        vus.add(voisin)
        file.push(voisin)
      }
    }
    ilots.push(groupe)
  }
  return ilots
}
