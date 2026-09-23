import { debitEnMbps } from './paths'
import { NODE_H, NODE_W, type NetLink, type NetNode } from '../types'

/**
 * Agrégats de liens — port-channels, bundles, LAG.
 *
 * Sur un schéma, deux câbles entre les mêmes équipements et un port-channel de deux membres
 * se dessinent de la même façon : deux traits. Or ce n'est pas la même chose. Deux câbles
 * indépendants, ce sont deux chemins que le spanning-tree va arbitrer ; un port-channel,
 * c'est **un seul lien logique** qui additionne les débits et ne coupe pas quand un brin
 * tombe. La différence change la lecture du schéma, le calcul de bande passante et
 * l'analyse de panne.
 *
 * La convention de dessin est ancienne et universelle : on **encercle les brins d'un ovale**
 * portant le nom du bundle (Po1, ag1, bond0, LAG 12). C'est ce que fait ce module —
 * reconnaître les agrégats dans les données, et dire où poser l'ovale.
 *
 * Un port-channel appartient à un châssis : « Po1 » sur le cœur et « Po1 » sur l'hyperviseur
 * sont deux objets distincts qui se font face. Le regroupement se fait donc par couple
 * (équipement, nom du bundle), ce que le modèle permet avec `lagA` / `lagB`.
 */

/** Protocole de négociation du bundle, au sens 802.1AX. */
export type ModeLacp = 'active' | 'passive' | 'static'

export const MODES_LACP: { value: ModeLacp; label: string; court: string }[] = [
  { value: 'active', label: 'LACP actif (802.1AX)', court: 'LACP actif' },
  { value: 'passive', label: 'LACP passif (répond, ne sollicite pas)', court: 'LACP passif' },
  { value: 'static', label: 'Statique (mode « on », sans négociation)', court: 'statique' },
]

export interface Agregat {
  /** Clé stable, utilisable comme clé de rendu. */
  id: string
  /** Nom du bundle tel qu'il est configuré : Po1, ag1, bond0, LAG 12… */
  nom: string
  /** Équipement qui porte le port-channel. */
  proprietaire: string
  /** Équipements d'en face. Plusieurs = agrégat multi-châssis (vPC, MLAG, VSX, VLT…). */
  pairs: string[]
  membres: NetLink[]
  multiChassis: boolean
  /**
   * Où poser l'ovale : au milieu du faisceau quand les deux bouts sont les mêmes, près de
   * l'équipement propriétaire quand les brins divergent vers deux châssis.
   */
  position: 'milieu' | 'proche'
  /** Débit cumulé des membres, en Mb/s, quand tous les brins l'annoncent. */
  debitTotal: number | null
  /** Débit d'un brin, quand ils sont tous identiques — « 2 × 10 Gb/s ». */
  debitBrin: string | null
  mode: ModeLacp | null
  /** Incohérences relevées sur le bundle, affichées à la sélection et dans le dossier. */
  reserves: string[]
  /** Glissement de l'ovale le long du faisceau, posé à la main. */
  glissement: number
  /** Décalage de l'étiquette par rapport à l'ovale, posé à la main. */
  decalage: { dx: number; dy: number } | null
  /** Ovale masqué pour ce faisceau seulement. */
  masque: boolean
}

/** Nom du bundle côté `noeud` pour cette liaison, ou `undefined` s'il n'en porte pas. */
export function nomAgregat(link: NetLink, noeud: string): string | undefined {
  const propre = link.from === noeud ? link.lagA : link.to === noeud ? link.lagB : undefined
  const valeur = (propre ?? link.lag ?? '').trim()
  return valeur || undefined
}

/** Formate un débit cumulé : 20000 → « 20 Gb/s ». */
export function formaterDebit(mbps: number): string {
  return mbps >= 1000
    ? `${Number((mbps / 1000).toFixed(mbps % 1000 === 0 ? 0 : 1))} Gb/s`
    : `${Math.round(mbps)} Mb/s`
}

/**
 * Étiquette portée par l'ovale : « Po21 · 2 × 10 Gb/s ».
 *
 * Volontairement courte. Sur un plan, l'ovale dit le nom du bundle et ce qu'il transporte ;
 * le reste — débit cumulé, mode de négociation, nature multi-châssis — se lit au survol et
 * dans l'inspecteur, pas au milieu des câbles.
 */
export function libelleAgregat(agregat: Agregat, details = true): string {
  if (!details) return agregat.nom
  if (agregat.debitBrin) return `${agregat.nom} · ${agregat.membres.length} × ${agregat.debitBrin}`
  if (agregat.debitTotal) return `${agregat.nom} · ${formaterDebit(agregat.debitTotal)}`
  return `${agregat.nom} · ${agregat.membres.length} brins`
}

/**
 * Agrégats d'un schéma. Seuls les bundles d'au moins deux brins sont rendus : un
 * port-channel à un membre existe en configuration, mais il n'y a rien à encercler — la
 * remarque est portée par les contrôles de qualité, pas par le dessin.
 */
export function agregats(diagram: { nodes: NetNode[]; links: NetLink[] }): Agregat[] {
  const parId = new Map(diagram.nodes.map((node) => [node.id, node]))
  const groupes = new Map<string, { noeud: string; nom: string; membres: NetLink[] }>()

  for (const link of diagram.links) {
    for (const noeud of [link.from, link.to]) {
      const nom = nomAgregat(link, noeud)
      if (!nom || !parId.has(noeud)) continue
      const cle = `${noeud}~${nom.toLowerCase()}`
      const groupe = groupes.get(cle)
      if (groupe) groupe.membres.push(link)
      else groupes.set(cle, { noeud, nom, membres: [link] })
    }
  }

  const sortie: Agregat[] = []
  const vus = new Set<string>()

  for (const [cle, groupe] of groupes) {
    if (groupe.membres.length < 2) continue
    const pairs = [
      ...new Set(groupe.membres.map((link) => (link.from === groupe.noeud ? link.to : link.from))),
    ]
    const multiChassis = pairs.length > 1

    /*
      Faisceau entre deux mêmes équipements : les deux châssis décrivent le même objet. On
      n'encercle qu'une fois, au milieu — c'est ainsi qu'on le dessine depuis toujours.
    */
    if (!multiChassis) {
      const pair = pairs[0]
      const jumeau = [groupe.noeud, pair].sort().join('~')
      const empreinte = `${jumeau}~${groupe.membres
        .map((link) => link.id)
        .sort()
        .join(',')}`
      if (vus.has(empreinte)) continue
      vus.add(empreinte)
    }

    sortie.push({
      id: cle,
      nom: groupe.nom,
      proprietaire: groupe.noeud,
      pairs,
      membres: groupe.membres,
      multiChassis,
      position: multiChassis ? 'proche' : 'milieu',
      // Le placement manuel est recopié sur tous les brins : n'importe lequel le rend.
      glissement: groupe.membres.find((link) => link.lagShift !== undefined)?.lagShift ?? 0,
      decalage: groupe.membres.find((link) => link.lagOffset)?.lagOffset ?? null,
      masque: groupe.membres.some((link) => link.lagHidden === true),
      ...mesurer(groupe.membres, groupe.noeud, parId, multiChassis),
    })
  }

  return sortie.sort((a, b) => a.nom.localeCompare(b.nom))
}

/** Débit cumulé, mode négocié et incohérences du bundle. */
function mesurer(
  membres: NetLink[],
  proprietaire: string,
  parId: Map<string, NetNode>,
  multiChassis: boolean,
): Pick<Agregat, 'debitTotal' | 'debitBrin' | 'mode' | 'reserves'> {
  const reserves: string[] = []
  const debits = membres.map((link) => debitEnMbps(link.speed))
  const debitTotal = debits.every((valeur): valeur is number => valeur !== null)
    ? debits.reduce((somme, valeur) => somme + valeur, 0)
    : null
  // « 2 × 10 Gb/s » ne s'écrit que si les deux brins l'annoncent : un seul débit renseigné
  // ne permet pas d'affirmer celui de l'autre.
  const declarees = membres.map((link) => link.speed?.trim() ?? '')
  const vitesses = [...new Set(declarees.filter(Boolean))]
  const debitBrin = vitesses.length === 1 && declarees.every(Boolean) ? vitesses[0] : null

  // Un agrégat ne se forme pas entre brins de débits différents : la norme impose des
  // membres de même vitesse et même duplex.
  if (vitesses.length > 1) {
    reserves.push(`Brins de débits différents (${vitesses.join(', ')}) : un agrégat 802.1AX demande des membres identiques.`)
  }

  const modes = [...new Set(membres.map((link) => link.lacp).filter(Boolean))] as ModeLacp[]
  if (modes.length > 1) {
    reserves.push('Modes de négociation divergents entre les brins.')
  }
  const mode = modes.length === 1 ? modes[0] : null
  if (mode === 'passive') {
    reserves.push('Les deux extrémités en passif ne formeront jamais le bundle : il en faut une en actif.')
  }

  // Un membre d'agrégat n'est pas un lien de secours : les brins portent tous du trafic, et
  // rien ne les met en attente. Dessiné en pointillés, il se lirait comme un lien de repli.
  if (membres.some((link) => link.redundant)) {
    reserves.push(
      'Un brin est marqué « liaison de secours » : dans un agrégat, tous les membres sont actifs et se partagent la charge.',
    )
  }

  // Un agrégat est un seul port logique : le spanning-tree ne bloque pas l'un de ses brins.
  if (membres.some((link) => link.stp === 'alternate' || link.stpA === 'alternate' || link.stpB === 'alternate' || link.stp === 'blocking')) {
    reserves.push(
      'Un brin porte un rôle spanning-tree bloquant ou alternatif : un agrégat forme un seul port logique, dont aucun brin n’est mis en attente.',
    )
  }

  const mtus = [...new Set(membres.map((link) => link.mtu).filter((mtu): mtu is number => !!mtu))]
  if (mtus.length > 1) {
    reserves.push(`MTU divergents entre les brins (${mtus.join(', ')}).`)
  }

  const vlans = [...new Set(membres.map((link) => (link.vlans ?? '').trim()).filter(Boolean))]
  if (vlans.length > 1) {
    reserves.push('VLAN autorisés différents d’un brin à l’autre : le bundle est logiquement un seul port.')
  }

  /*
    Agrégat multi-châssis : il n'est tenable que si les deux châssis d'en face se présentent
    comme un seul — vPC, VSX, MLAG, VLT, IRF, pile. Sans ce mécanisme, la carte attend une
    seule machine et le réseau voit deux domaines de commutation.
  */
  if (multiChassis) {
    const peers = [...new Set(membres.map((link) => (link.from === proprietaire ? link.to : link.from)))]
      .map((id) => parId.get(id))
      .filter((node): node is NetNode => !!node)
    const mecanismes = [...new Set(peers.map((node) => node.haTech?.trim()).filter(Boolean))]
    const grappes = [...new Set(peers.map((node) => node.cluster?.trim()).filter(Boolean))]
    if (mecanismes.length === 0) {
      reserves.push(
        'Agrégat réparti sur deux châssis sans mécanisme déclaré côté réseau : il faut un vPC, un VSX, un MLAG, un VLT ou une pile pour que les deux se présentent comme un seul.',
      )
    } else if (grappes.length > 1) {
      reserves.push('Les châssis d’en face n’appartiennent pas à la même grappe.')
    }
  }

  return { debitTotal, debitBrin, mode, reserves }
}

/**
 * Point où poser l'ovale sur un brin, et direction du faisceau.
 *
 * On avance le long du tracé depuis l'extrémité du propriétaire : l'ovale se pose là où les
 * brins sont déjà écartés mais encore parallèles — c'est là qu'il se lit.
 */
export function pointSurTrace(
  points: { x: number; y: number }[],
  distance: number,
  depuisLaFin: boolean,
): { x: number; y: number } | null {
  if (points.length === 0) return null
  const suite = depuisLaFin ? [...points].reverse() : points
  let reste = distance
  for (let index = 1; index < suite.length; index += 1) {
    const a = suite[index - 1]
    const b = suite[index]
    const longueur = Math.hypot(b.x - a.x, b.y - a.y)
    if (longueur === 0) continue
    if (reste <= longueur) {
      const ratio = reste / longueur
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio }
    }
    reste -= longueur
  }
  return suite[suite.length - 1]
}

export interface PointPlan {
  x: number
  y: number
}

/** Ovale à dessiner autour d'un faisceau : centre, rayons, rotation et ancre d'étiquette. */
export interface OvaleAgregat {
  cx: number
  cy: number
  rx: number
  ry: number
  /** Rotation en degrés : l'axe long de l'ovale suit l'écartement des brins. */
  angle: number
  labelX: number
  labelY: number
}

/** Longueur cumulée d'une ligne brisée. */
function longueur(points: PointPlan[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  }
  return total
}

/** Distance à laquelle l'ovale se pose quand il doit rester près du châssis propriétaire. */
const DISTANCE_PROCHE = 46

/**
 * Où poser l'ovale d'un agrégat.
 *
 * Deux situations. Faisceau entre deux mêmes équipements : au milieu, là où les brins sont
 * bien parallèles. Faisceau qui diverge vers deux châssis (vPC, MLAG, VSX) : près du châssis
 * qui porte le port-channel, avant que les brins ne s'écartent — sinon l'ovale engloberait
 * la moitié du schéma.
 */
export function ovaleAgregat(
  membres: { points: PointPlan[]; depuisLaFin: boolean }[],
  position: 'milieu' | 'proche',
  /** Équipements à éviter : une étiquette cachée derrière une boîte ne sert à rien. */
  obstacles: PointPlan[] = [],
  /** Placement posé à la main : glissement le long du faisceau, décalage de l'étiquette. */
  main: { glissement?: number; decalage?: { dx: number; dy: number } | null } = {},
): OvaleAgregat | null {
  const echantillons: { point: PointPlan; tangente: PointPlan }[] = []
  for (const membre of membres) {
    if (membre.points.length < 2) continue
    const total = longueur(membre.points)
    // Un peer-link entre deux châssis voisins fait quelques dizaines de pixels : il a droit
    // à son ovale comme les autres, sinon le faisceau le plus important du schéma est le
    // seul à ne pas être matérialisé.
    if (total < 8) continue
    const defaut =
      position === 'milieu'
        ? total / 2
        : Math.min(DISTANCE_PROCHE, Math.max(total * 0.3, Math.min(18, total / 2)))
    // Glisser l'ovale, c'est le faire coulisser sur les câbles : il reste sur le faisceau,
    // simplement plus près ou plus loin de l'équipement qui porte le port-channel.
    const distance = Math.min(total - 4, Math.max(4, defaut + (main.glissement ?? 0)))
    const point = pointSurTrace(membre.points, distance, membre.depuisLaFin)
    const ecartTangente = Math.min(14, Math.max(4, total / 3))
    const suivant = pointSurTrace(
      membre.points,
      Math.min(total, distance + ecartTangente),
      membre.depuisLaFin,
    )
    if (!point || !suivant) continue
    const dx = suivant.x - point.x
    const dy = suivant.y - point.y
    const norme = Math.hypot(dx, dy)
    if (norme < 0.5) continue
    echantillons.push({ point, tangente: { x: dx / norme, y: dy / norme } })
  }
  if (echantillons.length < 2) return null

  // Les brins d'un même faisceau vont dans le même sens : on aligne les tangentes sur la
  // première avant de les moyenner, sinon deux vecteurs opposés s'annuleraient.
  const reference = echantillons[0].tangente
  let ux = 0
  let uy = 0
  for (const { tangente } of echantillons) {
    const sens = tangente.x * reference.x + tangente.y * reference.y < 0 ? -1 : 1
    ux += tangente.x * sens
    uy += tangente.y * sens
  }
  const normeU = Math.hypot(ux, uy) || 1
  const u = { x: ux / normeU, y: uy / normeU }
  const v = { x: -u.y, y: u.x }

  const cx = echantillons.reduce((somme, item) => somme + item.point.x, 0) / echantillons.length
  const cy = echantillons.reduce((somme, item) => somme + item.point.y, 0) / echantillons.length
  const projections = echantillons.map((item) => (item.point.x - cx) * v.x + (item.point.y - cy) * v.y)
  const ecart = Math.max(...projections) - Math.min(...projections)

  const rx = Math.max(22, ecart / 2 + 16)
  const ry = 15

  /*
    Où poser l'étiquette. Près du châssis propriétaire, on la pousse le long des brins, du
    côté qui s'en éloigne : c'est le dégagement naturel. Au milieu d'un faisceau court — un
    peer-link entre deux châssis voisins — il n'y a pas de place dans cette direction, les
    équipements y sont ; on la sort alors sur le flanc du faisceau.
  */
  const axe = position === 'milieu' ? v : u
  const sens =
    position === 'milieu'
      ? Math.abs(axe.y) > Math.abs(axe.x)
        ? axe.y > 0
          ? -1
          : 1
        : axe.x > 0
          ? 1
          : -1
      : 1
  const base = (position === 'milieu' ? rx : ry) + 20

  /*
    Un faisceau court vit dans l'espace laissé entre deux châssis voisins — un peer-link,
    typiquement. L'étiquette n'y tient pas : on l'écarte pas à pas, du côté choisi puis de
    l'autre, jusqu'à ce qu'elle sorte des boîtes.
  */
  const libre = (x: number, y: number) =>
    obstacles.every(
      (centre) =>
        Math.abs(x - centre.x) > NODE_W / 2 + 10 || Math.abs(y - centre.y) > NODE_H / 2 + 10,
    )
  let labelX = cx + axe.x * sens * base
  let labelY = cy + axe.y * sens * base
  for (const signe of [sens, -sens]) {
    let trouve = false
    for (let pas = 0; pas < 5; pas += 1) {
      const distance = base + pas * 26
      const x = cx + axe.x * signe * distance
      const y = cy + axe.y * signe * distance
      if (libre(x, y)) {
        labelX = x
        labelY = y
        trouve = true
        break
      }
    }
    if (trouve) break
  }

  if (main.decalage) {
    labelX = cx + main.decalage.dx
    labelY = cy + main.decalage.dy
  }

  return {
    cx,
    cy,
    rx,
    ry,
    angle: (Math.atan2(v.y, v.x) * 180) / Math.PI,
    labelX,
    labelY,
  }
}
