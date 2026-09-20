import { uid } from './ids'
import { NODE_H, NODE_W, type Annotation, type Diagram, type NetLink, type NetNode } from '../types'

/**
 * Duplication d'une partie de schéma.
 *
 * Un schéma d'infrastructure est répétitif par nature : douze agences câblées pareil, quatre
 * baies identiques, deux salles jumelles. Refaire douze fois le même bloc à la main, c'est
 * douze occasions de se tromper — et la treizième modification ne sera reportée que sur onze.
 *
 * Le module ne duplique donc pas seulement des formes : il renomme, décale les adresses,
 * change le site et la zone, et sait recâbler les copies sur les mêmes voisins que l'original.
 * Tout est calculé ici, en fonctions pures, pour que le dialogue puisse en montrer l'aperçu
 * avant que quoi que ce soit ne soit écrit dans le document.
 */

/** Où poser les copies les unes par rapport aux autres. */
export type Disposition = 'droite' | 'bas' | 'grille'

export interface OptionsDuplication {
  /** Nombre de copies à produire, en plus de l'original. */
  copies: number
  disposition: Disposition
  /** Écart entre deux copies, en pixels de schéma. */
  ecart: number
  /**
   * Numéro de la première copie : ce que valent `#` et `@` dans les modèles de nom. Un bloc
   * « BAT-A » se duplique en « BAT-B » et « BAT-C » à partir de 2.
   */
  debut: number
  /** Renommage par remplacement : « remplacer BAT-A par BAT-@ ». */
  remplacer: string
  par: string
  /** Renommage par encadrement, quand il n'y a rien à remplacer. */
  prefixe: string
  suffixe: string
  /** Site, zone et grappe des copies ; vide = on garde ceux de l'original. */
  site: string
  zone: string
  cluster: string
  /** Pas d'incrémentation du troisième octet des IP et des VLAN, 0 pour ne rien toucher. */
  pasReseau: number
  /**
   * Vide aussi l'adressage des copies. Les numéros de série, immobilisations et places en
   * baie, eux, sont toujours vidés : ils désignent un exemplaire et un seul.
   */
  viderIdentifiants: boolean
  /** Recâble chaque copie sur les mêmes voisins extérieurs que l'original. */
  raccorder: boolean
}

export const OPTIONS_PAR_DEFAUT: OptionsDuplication = {
  copies: 1,
  disposition: 'droite',
  ecart: 80,
  debut: 2,
  remplacer: '',
  par: '',
  prefixe: '',
  suffixe: '',
  site: '',
  zone: '',
  cluster: '',
  pasReseau: 0,
  viderIdentifiants: false,
  raccorder: true,
}

export interface ResultatDuplication {
  nodes: NetNode[]
  links: NetLink[]
  annotations: Annotation[]
  /** Correspondance original → copies, dans l'ordre, pour l'aperçu. */
  noms: { source: string; copies: string[] }[]
  /** Ce que la duplication ne peut pas faire et que l'utilisateur doit savoir. */
  reserves: string[]
}

/** Lettre d'un rang : 1 → A, 2 → B, 27 → AA. Pour les blocs nommés BAT-A, BAT-B… */
export function lettre(rang: number): string {
  let reste = Math.max(1, Math.floor(rang))
  let sortie = ''
  while (reste > 0) {
    const index = (reste - 1) % 26
    sortie = String.fromCharCode(65 + index) + sortie
    reste = Math.floor((reste - 1) / 26)
  }
  return sortie
}

/** Remplace `#` par le numéro de copie et `@` par sa lettre. */
export function modele(gabarit: string, rang: number): string {
  return gabarit.replaceAll('#', String(rang)).replaceAll('@', lettre(rang))
}

/**
 * Nom d'une copie. Trois règles, dans l'ordre : le remplacement demandé, l'encadrement
 * demandé, et à défaut l'incrémentation du numéro terminal — « SW-ACC-01 » donne
 * « SW-ACC-02 ». Un nom déjà pris est décalé jusqu'à être libre : deux équipements de même
 * nom sur un schéma, c'est une ambiguïté qu'on ne veut jamais produire.
 */
export function nomDeCopie(
  source: string,
  rang: number,
  options: OptionsDuplication,
  pris: Set<string>,
): string {
  let candidat = source
  if (options.remplacer && source.includes(options.remplacer)) {
    candidat = source.replaceAll(options.remplacer, modele(options.par, rang))
  } else if (options.prefixe || options.suffixe) {
    candidat = `${modele(options.prefixe, rang)}${source}${modele(options.suffixe, rang)}`
  } else {
    candidat = incrementer(source, rang - 1)
  }
  let libre = candidat
  let secours = 2
  while (pris.has(libre.toLowerCase())) {
    libre = incrementer(candidat, secours - 1)
    if (libre === candidat) libre = `${candidat} ${secours}`
    secours += 1
  }
  return libre
}

/** « SW-ACC-01 » + 2 → « SW-ACC-03 » ; sans numéro terminal, on ajoute un suffixe. */
function incrementer(nom: string, pas: number): string {
  if (pas <= 0) return nom
  const match = nom.match(/^(.*?)(\d+)(\D*)$/)
  if (!match) return `${nom} ${pas + 1}`
  const largeur = match[2].length
  return `${match[1]}${String(Number(match[2]) + pas).padStart(largeur, '0')}${match[3]}`
}

/** Décale le troisième octet d'une IPv4 : 10.10.0.1 + 2 → 10.10.2.1. Le reste est laissé tel quel. */
export function decalerIp(ip: string | undefined, pas: number): string | undefined {
  if (!ip || pas === 0) return ip
  const match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/\d{1,2})?$/)
  if (!match) return ip
  const troisieme = Number(match[3]) + pas
  if (troisieme < 0 || troisieme > 255) return ip
  return `${match[1]}.${match[2]}.${troisieme}.${match[4]}${match[5] ?? ''}`
}

/** Décale un VLAN numérique ; une désignation textuelle est laissée telle quelle. */
export function decalerVlan(vlan: string | undefined, pas: number): string | undefined {
  if (!vlan || pas === 0) return vlan
  const match = vlan.match(/^(\d{1,4})$/)
  if (!match) return vlan
  const valeur = Number(match[1]) + pas
  return valeur >= 1 && valeur <= 4094 ? String(valeur) : vlan
}

/** Rectangle englobant d'une sélection, cadres des équipements compris. */
export function encombrement(
  nodes: NetNode[],
  annotations: Annotation[],
): { x: number; y: number; w: number; h: number } {
  const xs: number[] = []
  const ys: number[] = []
  for (const node of nodes) {
    xs.push(node.x - NODE_W / 2, node.x + NODE_W / 2)
    ys.push(node.y - NODE_H / 2, node.y + NODE_H / 2)
  }
  for (const annotation of annotations) {
    xs.push(annotation.x, annotation.x + annotation.w)
    ys.push(annotation.y, annotation.y + annotation.h)
  }
  if (xs.length === 0) return { x: 0, y: 0, w: NODE_W, h: NODE_H }
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Décalage d'une copie donnée, selon la disposition choisie. */
function decalage(
  rang: number,
  taille: { w: number; h: number },
  options: OptionsDuplication,
): { dx: number; dy: number } {
  const pasX = taille.w + options.ecart
  const pasY = taille.h + options.ecart
  if (options.disposition === 'droite') return { dx: pasX * rang, dy: 0 }
  if (options.disposition === 'bas') return { dx: 0, dy: pasY * rang }
  const colonnes = Math.max(1, Math.ceil(Math.sqrt(options.copies + 1)))
  return { dx: pasX * (rang % colonnes), dy: pasY * Math.floor(rang / colonnes) }
}

/**
 * Construit les copies. Rien n'est écrit dans le document : la fonction rend ce qu'il faudrait
 * y ajouter, à charge de l'appelant de le faire passer par une seule entrée d'historique.
 */
export function dupliquer(
  diagram: Diagram,
  idsNoeuds: string[],
  idsAnnotations: string[],
  options: OptionsDuplication,
): ResultatDuplication {
  const selection = new Set(idsNoeuds)
  const sources = diagram.nodes.filter((node) => selection.has(node.id))
  const annotationsSources = (diagram.annotations ?? []).filter((annotation) =>
    idsAnnotations.includes(annotation.id),
  )
  const vide: ResultatDuplication = { nodes: [], links: [], annotations: [], noms: [], reserves: [] }
  if (sources.length === 0 && annotationsSources.length === 0) return vide

  const copies = Math.max(1, Math.min(50, Math.floor(options.copies)))
  const taille = encombrement(sources, annotationsSources)
  const pris = new Set(diagram.nodes.map((node) => node.name.toLowerCase()))

  /*
    Grappes entièrement sélectionnées : leurs copies forment de nouvelles grappes, sinon on
    obtiendrait une grappe géante à huit membres. Mais quand une partie seulement d'une
    grappe est dupliquée, c'est qu'on l'agrandit — un troisième pare-feu dans la même paire —
    et le nom de grappe doit alors être conservé.
  */
  const effectifs = new Map<string, number>()
  for (const node of diagram.nodes) {
    const nom = node.cluster?.trim()
    if (nom) effectifs.set(nom, (effectifs.get(nom) ?? 0) + 1)
  }
  const grappesCompletes = new Set(
    [...effectifs.entries()]
      .filter(
        ([nom, total]) =>
          total > 1 && sources.filter((node) => node.cluster?.trim() === nom).length === total,
      )
      .map(([nom]) => nom),
  )

  const internes = diagram.links.filter((link) => selection.has(link.from) && selection.has(link.to))
  const externes = diagram.links.filter(
    (link) => selection.has(link.from) !== selection.has(link.to),
  )

  const nodes: NetNode[] = []
  const links: NetLink[] = []
  const annotations: Annotation[] = []
  const noms = sources.map((source) => ({ source: source.name, copies: [] as string[] }))

  for (let index = 0; index < copies; index += 1) {
    const rang = options.debut + index
    const { dx, dy } = decalage(index + 1, taille, options)
    const correspondance = new Map<string, string>()

    for (const [position, source] of sources.entries()) {
      const id = uid('n')
      correspondance.set(source.id, id)
      const nom = nomDeCopie(source.name, rang, options, pris)
      pris.add(nom.toLowerCase())
      noms[position].copies.push(nom)

      const copie: NetNode = {
        ...source,
        id,
        name: nom,
        x: source.x + dx,
        y: source.y + dy,
        pinned: false,
        ip: decalerIp(source.ip, options.pasReseau * (index + 1)),
        vlan: decalerVlan(source.vlan, options.pasReseau * (index + 1)),
        vip: decalerIp(source.vip, options.pasReseau * (index + 1)),
        // Un numéro de série, une immobilisation, une place en baie désignent un exemplaire
        // et un seul : les recopier ferait mentir l'inventaire et le plan des baies.
        serial: undefined,
        assetTag: undefined,
        rack: undefined,
        rackUnit: undefined,
      }
      if (options.site) copie.site = modele(options.site, rang)
      if (options.zone) copie.zone = modele(options.zone, rang)
      if (source.cluster && options.cluster) {
        copie.cluster = modele(options.cluster, rang)
      } else if (source.cluster && grappesCompletes.has(source.cluster.trim())) {
        copie.cluster = nomDeCopie(source.cluster, rang, options, new Set())
      }
      if (options.viderIdentifiants) {
        copie.ip = undefined
        copie.vip = undefined
      }
      nodes.push(copie)
    }

    for (const link of internes) {
      links.push({
        ...link,
        id: uid('l'),
        from: correspondance.get(link.from)!,
        to: correspondance.get(link.to)!,
      })
    }

    if (options.raccorder) {
      for (const link of externes) {
        const interne = selection.has(link.from) ? link.from : link.to
        const externe = selection.has(link.from) ? link.to : link.from
        const clone = correspondance.get(interne)
        if (!clone) continue
        links.push({
          ...link,
          id: uid('l'),
          from: selection.has(link.from) ? clone : externe,
          to: selection.has(link.from) ? externe : clone,
        })
      }
    }

    for (const annotation of annotationsSources) {
      annotations.push({
        ...annotation,
        id: uid('a'),
        x: annotation.x + dx,
        y: annotation.y + dy,
        text: reformuler(annotation.text, options, rang),
      })
    }
  }

  const reserves: string[] = []
  if (!options.raccorder && externes.length > 0) {
    reserves.push(
      `${externes.length} liaison(s) sortent de la sélection et ne seront pas reproduites : les copies resteront isolées du reste du schéma.`,
    )
  }
  const partielles = [
    ...new Set(
      sources
        .map((node) => node.cluster?.trim())
        .filter((nom): nom is string => !!nom && !grappesCompletes.has(nom)),
    ),
  ]
  if (partielles.length > 0 && !options.cluster) {
    reserves.push(
      `Grappe(s) ${partielles.join(', ')} dupliquée(s) en partie : les copies rejoignent la grappe d'origine, qui comptera donc plus de membres. Sélectionnez toute la grappe, ou nommez la grappe des copies.`,
    )
  }
  if (options.pasReseau === 0 && sources.some((node) => node.ip)) {
    reserves.push(
      'Les adresses IP sont recopiées à l’identique : renseignez un pas de réseau, ou videz les identifiants.',
    )
  }
  if (sources.some((node) => node.serial || node.rack)) {
    reserves.push(
      'Numéros de série, immobilisations et places en baie ne sont pas recopiés : ils désignent un exemplaire précis, à renseigner sur chaque copie.',
    )
  }
  return { nodes, links, annotations, noms, reserves }
}

/** Applique au texte d'une annotation le même remplacement qu'aux noms d'équipements. */
function reformuler(
  texte: string | undefined,
  options: OptionsDuplication,
  rang: number,
): string | undefined {
  if (!texte || !options.remplacer) return texte
  return texte.replaceAll(options.remplacer, modele(options.par, rang))
}
