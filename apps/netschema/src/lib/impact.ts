import { LINKS, rankOf } from './catalog'
import { linkEnd } from './osi'
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


// ── Couche 2 : VLAN, ports d'accès, trunks et spanning-tree ──────────────────

/** « 10,20,30-39 » → {10, 20, 30…39}. Une liste vide vaut « non documenté ». */
export function parseVlans(valeur: string | undefined): Set<number> {
  const resultat = new Set<number>()
  if (!valeur) return resultat
  for (const morceau of valeur.split(/[,;]/)) {
    const plage = morceau.trim().match(/^(\d{1,4})\s*-\s*(\d{1,4})$/)
    if (plage) {
      const debut = Number(plage[1])
      const fin = Number(plage[2])
      for (let id = Math.min(debut, fin); id <= Math.max(debut, fin) && id - debut < 4096; id += 1) {
        resultat.add(id)
      }
      continue
    }
    const simple = morceau.trim().match(/^(?:vlan\s*)?(\d{1,4})$/i)
    if (simple) resultat.add(Number(simple[1]))
  }
  return resultat
}

/**
 * VLAN transportés par une liaison, ou `null` quand rien n'est documenté — auquel cas on la
 * suppose transparente plutôt que de crier au loup sur un schéma incomplet.
 *
 * Un trunk ne transporte un VLAN que s'il est autorisé **aux deux bouts** : une liste
 * d'autorisation qui diverge est l'erreur de configuration la plus banale, et la plus
 * pénible à trouver le jour de la panne.
 */
export function vlansDuLien(link: NetLink): Set<number> | null {
  const cote = (bout: 'a' | 'b') => {
    const config = linkEnd(link, bout)
    const liste = parseVlans(config.vlans)
    const natif = parseVlans(config.nativeVlan)
    for (const id of natif) liste.add(id)
    return liste.size > 0 ? liste : null
  }
  const a = cote('a')
  const b = cote('b')
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  // L'intersection : ce qui passe réellement.
  const commun = new Set<number>()
  for (const id of a) if (b.has(id)) commun.add(id)
  return commun
}

/** VLAN d'appartenance d'un équipement, déduit de sa fiche ou de son port d'accès. */
export function vlansDuNoeud(node: NetNode, links: NetLink[]): Set<number> {
  const resultat = parseVlans(node.vlan)
  for (const link of links) {
    if (link.from !== node.id && link.to !== node.id) continue
    const bout = link.from === node.id ? 'a' : 'b'
    const config = linkEnd(link, bout)
    if (config.mode === 'access') for (const id of parseVlans(config.vlans)) resultat.add(id)
  }
  return resultat
}

/**
 * Lien en attente au sens spanning-tree : il ne transporte rien aujourd'hui, mais il prend le
 * relais après convergence. On l'écarte donc de l'état nominal et on le compte dans l'état
 * d'après-panne — ce qui est exactement le service qu'il rend.
 */
export function estBloqueParStp(link: NetLink): boolean {
  const role = (bout: 'a' | 'b') => linkEnd(link, bout).stp
  return ['alternate', 'blocking'].includes(role('a') ?? '') || ['alternate', 'blocking'].includes(role('b') ?? '')
}

export type GraviteConstat = 'critique' | 'majeur' | 'mineur' | 'info'

/** Un constat d'exploitation : ce que l'on voit, ce que cela implique, ce qu'il faut faire. */
export interface ConstatImpact {
  gravite: GraviteConstat
  titre: string
  detail: string
  action?: string
}

export interface ImpactVlan {
  id: number
  /** Nom du VLAN tel qu'il figure au plan d'adressage, s'il y est. */
  nom?: string
  /** Équipements de ce VLAN qui perdent leur chemin. */
  perdus: string[]
  /** Total d'équipements rattachés à ce VLAN. */
  membres: number
  /**
   * Vrai quand un chemin physique subsiste mais ne transporte pas ce VLAN : le secours existe,
   * sa liste d'autorisation est incomplète.
   */
  cheminSansVlan: boolean
}

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
  /** Constats rédigés : ce que l'on voit, ce que cela implique, ce qu'il faut faire. */
  constats: ConstatImpact[]
  /** Effet sur chaque VLAN documenté. */
  vlans: ImpactVlan[]
  /** Liens en attente qui prennent le relais après convergence spanning-tree. */
  reprises: { lien: string; detail: string }[]
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
  const disponibilite = Math.round(((total - compte.panne - compte.isole) / total) * 100)

  // ── Couche 2 : ce que les VLAN deviennent ────────────────────────────────
  const transport = transportLinks(diagram)
  const nomDeVlan = new Map<number, string>()
  for (const vlan of diagram.vlans ?? []) {
    const id = Number(vlan.id)
    if (Number.isFinite(id) && vlan.name) nomDeVlan.set(id, vlan.name)
  }

  const membresParVlan = new Map<number, NetNode[]>()
  for (const node of diagram.nodes) {
    for (const id of vlansDuNoeud(node, transport)) {
      const liste = membresParVlan.get(id)
      if (liste) liste.push(node)
      else membresParVlan.set(id, [node])
    }
  }

  /** Joignabilité restreinte aux liaisons qui transportent réellement un VLAN donné. */
  const joignablesVlan = (id: number, avecPannes: boolean) => {
    const adj = new Map<string, Set<string>>()
    const vivantsIci = avecPannes ? vivants : new Set(diagram.nodes.map((node) => node.id))
    for (const noeud of vivantsIci) adj.set(noeud, new Set())
    for (const link of transport) {
      if (avecPannes && liensCoupes.has(link.id)) continue
      // En nominal, un lien en attente STP ne transporte rien ; après panne, il reprend.
      if (!avecPannes && estBloqueParStp(link)) continue
      if (!vivantsIci.has(link.from) || !vivantsIci.has(link.to) || link.from === link.to) continue
      const portes = vlansDuLien(link)
      if (portes && !portes.has(id)) continue
      adj.get(link.from)?.add(link.to)
      adj.get(link.to)?.add(link.from)
    }
    const racinesIci = racinesDe(diagram.nodes.filter((node) => vivantsIci.has(node.id)))
    return joignables(racinesIci, adj, vivantsIci)
  }

  const vlansTouches: ImpactVlan[] = []
  if (enPanne.size > 0 || liensCoupes.size > 0) {
    for (const [id, membres] of membresParVlan) {
      const avant = joignablesVlan(id, false)
      const apres = joignablesVlan(id, true)
      const perdus = membres.filter((node) => avant.has(node.id) && !apres.has(node.id) && !enPanne.has(node.id))
      if (perdus.length === 0) continue
      // Le chemin physique subsiste mais le VLAN ne passe plus : liste d'autorisation à revoir.
      const cheminSansVlan = perdus.some((node) => atteints.has(node.id))
      vlansTouches.push({
        id,
        nom: nomDeVlan.get(id),
        perdus: perdus.map((node) => node.name),
        membres: membres.length,
        cheminSansVlan,
      })
    }
    vlansTouches.sort((a, b) => b.perdus.length - a.perdus.length || a.id - b.id)
  }

  // ── Reprises spanning-tree ───────────────────────────────────────────────
  /**
   * Un lien en attente n'est signalé que s'il porte réellement quelque chose depuis la panne :
   * on le retire à son tour du graphe et l'on regarde si quelqu'un perd son chemin. Signaler
   * tous les liens alternatifs du schéma n'apprendrait rien à personne.
   */
  const reprises: { lien: string; detail: string }[] = []
  for (const link of transport) {
    if (liensCoupes.has(link.id) || !estBloqueParStp(link)) continue
    if (!vivants.has(link.from) || !vivants.has(link.to)) continue

    const sansCeLien = new Map<string, Set<string>>()
    for (const id of vivants) sansCeLien.set(id, new Set())
    for (const autre of liensVivants) {
      if (autre.id === link.id || autre.from === autre.to) continue
      sansCeLien.get(autre.from)?.add(autre.to)
      sansCeLien.get(autre.to)?.add(autre.from)
    }
    const sans = joignables(racines, sansCeLien, vivants)
    const porte = [...atteints].some((id) => !sans.has(id))
    if (!porte) continue

    const de = noms.get(link.from) ?? '?'
    const vers = noms.get(link.to) ?? '?'
    reprises.push({
      lien: `${de} ↔ ${vers}`,
      detail:
        'Lien en attente (STP alternatif) désormais seul chemin : il passe désigné après convergence — ' +
        'de 1 à 3 s en RSTP/MSTP, jusqu’à 50 s en spanning-tree historique. Le trafic est interrompu ' +
        'pendant ce délai.',
    })
  }

  const constats = redigerConstats({
    diagram,
    enPanne,
    liensCoupes,
    noms,
    isoles,
    fragiles,
    vlans: vlansTouches,
    reprises,
    compte,
    disponibilite,
  })

  return {
    etats,
    liensCoupes,
    fragiles: fragiles.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    isoles: isoles.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    racines,
    compte,
    disponibilite,
    constats,
    vlans: vlansTouches,
    reprises,
  }
}

/**
 * Mise en mots du rapport.
 *
 * Un tableau de chiffres ne se transmet pas : ce que l'on met dans un compte rendu
 * d'exploitation, c'est un constat, sa conséquence, et ce qu'il faut faire. Chaque phrase
 * ci-dessous s'appuie sur le calcul, jamais sur une supposition.
 */
function redigerConstats(contexte: {
  diagram: Diagram
  enPanne: Set<string>
  liensCoupes: Set<string>
  noms: Map<string, string>
  isoles: ImpactNoeud[]
  fragiles: ImpactNoeud[]
  vlans: ImpactVlan[]
  reprises: { lien: string; detail: string }[]
  compte: { panne: number; isole: number; fragile: number; intact: number }
  disponibilite: number
}): ConstatImpact[] {
  const { diagram, enPanne, liensCoupes, noms, isoles, fragiles, vlans, reprises, compte, disponibilite } = contexte
  const constats: ConstatImpact[] = []
  const liste = (valeurs: string[], limite = 4) =>
    valeurs.length <= limite
      ? valeurs.join(', ')
      : `${valeurs.slice(0, limite).join(', ')} et ${valeurs.length - limite} autre(s)`

  if (enPanne.size === 0 && liensCoupes.size === 0) {
    constats.push({
      gravite: fragiles.length > 0 ? 'majeur' : 'info',
      titre: 'État nominal',
      detail:
        fragiles.length > 0
          ? `Le réseau est intact, mais ${fragiles.length} équipement(s) dépendent d'un chemin unique : ` +
            `${liste(fragiles.map((item) => item.nom))}. Une seule panne les coupe.`
          : 'Le réseau est intact et aucun équipement ne dépend d’un chemin unique.',
      action:
        fragiles.length > 0
          ? 'Doubler le raccordement de ces équipements, ou accepter formellement le risque dans le plan de continuité.'
          : undefined,
    })
  }

  if (isoles.length > 0) {
    const cause = [...enPanne].map((id) => noms.get(id) ?? id)
    constats.push({
      gravite: 'critique',
      titre: `${isoles.length} équipement(s) coupés du réseau`,
      detail:
        `${liste(isoles.map((item) => item.nom))} n’ont plus aucun chemin vers les points de référence` +
        (cause.length > 0 ? ` après l’arrêt de ${liste(cause)}.` : ' après la coupure simulée.') +
        ` Disponibilité mesurée : ${disponibilite} %.`,
      action:
        'Prévoir un second raccordement pour ce segment (lien vers le second cœur, agrégat réparti sur deux châssis), ' +
        'ou documenter le mode dégradé accepté pour ces équipements.',
    })
  }

  for (const vlan of vlans) {
    const nom = vlan.nom ? `VLAN ${vlan.id} (${vlan.nom})` : `VLAN ${vlan.id}`
    constats.push({
      gravite: vlan.cheminSansVlan ? 'majeur' : 'critique',
      titre: `${nom} interrompu pour ${vlan.perdus.length} équipement(s) sur ${vlan.membres}`,
      detail: vlan.cheminSansVlan
        ? `Un chemin physique subsiste vers ${liste(vlan.perdus)}, mais aucun trunk restant n’autorise le ` +
          `${nom} : la liste des VLAN autorisés du lien de secours est incomplète.`
        : `Plus aucune liaison ne transporte le ${nom} vers ${liste(vlan.perdus)}.`,
      action: vlan.cheminSansVlan
        ? `Ajouter le VLAN ${vlan.id} à la liste autorisée du trunk de secours (aux deux extrémités : une ` +
          `autorisation posée d’un seul côté ne transporte rien).`
        : `Prévoir un second chemin de niveau 2 pour le VLAN ${vlan.id}, ou router ce segment plutôt que l’étendre.`,
    })
  }

  for (const reprise of reprises) {
    constats.push({
      gravite: 'mineur',
      titre: `Reprise attendue par ${reprise.lien}`,
      detail: reprise.detail,
      action:
        'Vérifier que ce lien autorise les mêmes VLAN que le lien nominal et que la convergence rapide ' +
        '(RSTP/MSTP) est activée sur les deux équipements.',
    })
  }

  if (compte.fragile > 0 && (enPanne.size > 0 || liensCoupes.size > 0)) {
    constats.push({
      gravite: 'majeur',
      titre: `${compte.fragile} équipement(s) sans redondance restante`,
      detail:
        `Ils fonctionnent encore, mais par un chemin unique : ${liste(fragiles.map((item) => (item.dependDe ? `${item.nom} (via ${item.dependDe})` : item.nom)))}. ` +
        'Une seconde panne au même endroit les coupe.',
      action: 'Traiter ces équipements en priorité pendant l’incident : ce sont eux qui feront la prochaine coupure.',
    })
  }

  // Ports d'accès concernés : ce que l'on débranche physiquement au tableau.
  const portsTouches: string[] = []
  for (const link of diagram.links) {
    if (!liensCoupes.has(link.id)) continue
    for (const bout of ['a', 'b'] as const) {
      const config = linkEnd(link, bout)
      const equipement = noms.get(bout === 'a' ? link.from : link.to)
      if (config.port && equipement) {
        portsTouches.push(`${equipement} ${config.port}${config.mode === 'trunk' ? ' (trunk)' : config.mode === 'access' ? ' (accès)' : ''}`)
      }
    }
  }
  if (portsTouches.length > 0) {
    constats.push({
      gravite: 'info',
      titre: `${portsTouches.length} port(s) concernés`,
      detail: liste(portsTouches, 6),
      action: 'À reprendre tel quel dans le ticket ou la fiche d’intervention.',
    })
  }

  return constats
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
