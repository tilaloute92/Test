import type { Diagram, NetLink, NetNode } from '../types'

/**
 * Héritage des valeurs déjà saisies.
 *
 * Mesure faite sur le schéma d'exemple : vingt-neuf équipements et quarante-neuf liaisons
 * représentent 661 valeurs saisies, dont 490 ne sont que la ressaisie de 123 valeurs
 * distinctes. « Siège » est tapé vingt-trois fois, « production » vingt-trois fois, le MTU
 * 9000 quinze fois. Les trois quarts du temps passé à remplir des champs servent à répéter.
 *
 * Plutôt que d'ajouter un écran de préférences — qu'il faudrait renseigner, maintenir, et
 * qui ne vaudrait que pour le poste —, on lit ce que le document dit déjà. Le deuxième
 * équipement d'un schéma hérite du premier ; le trentième hérite des vingt-neuf précédents.
 * Rien à configurer, et la convention d'un document voyage avec lui.
 *
 * Deux garde-fous gouvernent le choix :
 *
 * L'héritage ne porte que sur ce qui se répète légitimement — le site, la zone, le
 * responsable, l'état du parc. Jamais sur ce qui identifie : ni nom, ni adresse IP, ni
 * numéro de série, ni appartenance à une grappe. Hériter d'une adresse serait une faute, et
 * hériter d'une grappe rattacherait un équipement à une redondance qu'il n'assure pas.
 *
 * Une valeur n'est reprise que si elle domine vraiment : portée par au moins deux
 * équipements, et par plus de la moitié de ceux qui renseignent ce champ. Sur un parc
 * hétérogène où rien ne domine, rien n'est proposé — ce qui vaut mieux qu'une suggestion
 * fausse, qu'il faudrait corriger à chaque fois et qui coûterait plus cher que la saisie.
 */

/** Champs repris de l'ensemble du document : ils décrivent un contexte, pas un équipement. */
const CHAMPS_COMMUNS = ['site', 'zone', 'owner', 'status'] as const

/**
 * Champs repris du seul même type d'équipement.
 *
 * Que la plupart des commutateurs soient des Cisco de 1 U n'apprend rien sur le prochain
 * serveur. Ces champs-là ne traversent pas la frontière du type.
 */
const CHAMPS_PAR_TYPE = ['vendor', 'rack', 'heightU', 'dualPower'] as const

/** Champs d'une liaison repris des liaisons de même nature. */
const CHAMPS_LIAISON = ['speed', 'mode', 'vlans', 'mtu', 'lacp'] as const

type ChampNoeud = (typeof CHAMPS_COMMUNS)[number] | (typeof CHAMPS_PAR_TYPE)[number]
type ChampLiaison = (typeof CHAMPS_LIAISON)[number]

/**
 * La valeur dominante d'un champ, ou rien.
 *
 * « Dominante » veut dire : la plus fréquente, portée par au moins deux éléments, et
 * représentant plus de la moitié de ceux qui renseignent ce champ. Le seuil écarte les
 * égalités — entre deux valeurs à parts égales, aucune n'est proposée.
 */
export function valeurDominante<T>(elements: T[], lire: (element: T) => unknown): unknown {
  const comptes = new Map<string, { valeur: unknown; n: number }>()
  let renseignes = 0
  for (const element of elements) {
    const valeur = lire(element)
    if (valeur === undefined || valeur === null || valeur === '') continue
    renseignes += 1
    const cle = JSON.stringify(valeur)
    const entree = comptes.get(cle)
    if (entree) entree.n += 1
    else comptes.set(cle, { valeur, n: 1 })
  }
  if (renseignes < 2) return undefined
  let meilleure: { valeur: unknown; n: number } | undefined
  for (const entree of comptes.values()) {
    if (!meilleure || entree.n > meilleure.n) meilleure = entree
  }
  if (!meilleure || meilleure.n < 2 || meilleure.n * 2 <= renseignes) return undefined
  return meilleure.valeur
}

/**
 * Ce qu'un nouvel équipement de ce type peut reprendre du document.
 *
 * Le résultat est un simple ensemble de valeurs proposées : il est appliqué à la création,
 * et reste modifiable comme n'importe quelle saisie. Rien n'est verrouillé.
 */
export function heritageNoeud(diagram: Diagram, kind: string): Partial<NetNode> {
  const herite: Record<string, unknown> = {}
  const tous = diagram.nodes
  if (tous.length === 0) return {}

  for (const champ of CHAMPS_COMMUNS) {
    const valeur = valeurDominante(tous, (n) => n[champ as keyof NetNode])
    if (valeur !== undefined) herite[champ] = valeur
  }
  const memeType = tous.filter((n) => n.kind === kind)
  for (const champ of CHAMPS_PAR_TYPE) {
    const valeur = valeurDominante(memeType, (n) => n[champ as keyof NetNode])
    if (valeur !== undefined) herite[champ] = valeur
  }
  return herite as Partial<NetNode>
}

/** Ce qu'une nouvelle liaison de cette nature peut reprendre des liaisons déjà tracées. */
export function heritageLiaison(diagram: Diagram, kind: string): Partial<NetLink> {
  const herite: Record<string, unknown> = {}
  const memeNature = diagram.links.filter((l) => l.kind === kind)
  for (const champ of CHAMPS_LIAISON) {
    const valeur = valeurDominante(memeNature, (l) => l[champ as keyof NetLink])
    if (valeur !== undefined) herite[champ] = valeur
  }
  return herite as Partial<NetLink>
}

/**
 * Les champs effectivement repris, pour pouvoir le dire à l'utilisateur.
 *
 * Un préremplissage silencieux est une mauvaise surprise : on croit avoir créé un équipement
 * vierge et il porte déjà un site. L'application annonce donc ce qu'elle a repris, et d'où.
 */
export function resumerHeritage(herite: Partial<NetNode> | Partial<NetLink>): string | null {
  const LIBELLES: Record<string, string> = {
    site: 'site', zone: 'zone', owner: 'responsable', status: 'état',
    vendor: 'constructeur', rack: 'baie', heightU: 'hauteur', dualPower: 'double alimentation',
    speed: 'débit', mode: 'mode', vlans: 'VLAN', mtu: 'MTU', lacp: 'LACP',
  }
  const champs = Object.entries(herite)
    .filter(([, valeur]) => valeur !== undefined)
    .map(([champ, valeur]) => {
      const nom = LIBELLES[champ] ?? champ
      if (valeur === true) return nom
      if (valeur === false) return null
      return `${nom} ${Array.isArray(valeur) ? valeur.join(', ') : String(valeur)}`
    })
    .filter((texte): texte is string => Boolean(texte))
  return champs.length === 0 ? null : `Repris du schéma : ${champs.join(' · ')}.`
}

export const CHAMPS_HERITES_NOEUD = [...CHAMPS_COMMUNS, ...CHAMPS_PAR_TYPE] as readonly ChampNoeud[]
export const CHAMPS_HERITES_LIAISON = CHAMPS_LIAISON as readonly ChampLiaison[]
