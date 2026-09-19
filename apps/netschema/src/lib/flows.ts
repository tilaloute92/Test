/**
 * Matrice de flux : contrôle des lignes déclarées contre le schéma qui les porte.
 *
 * Une matrice de flux vit d'habitude dans un tableur, à côté du schéma, et diverge dès la
 * première évolution : on ajoute une zone sans l'y reporter, on supprime un pare-feu sans
 * que personne ne rapproche les deux documents. La tenir ici permet de poser les questions
 * qu'une revue de sécurité pose vraiment : cette source existe-t-elle ? ce flux traverse-t-il
 * un point de contrôle ? passe-t-il en clair sur un lien opérateur ? pourquoi existe-t-il ?
 */

import { cheminsEntre, resoudreExtremite, type ConstatChemin, type RapportChemins } from './paths'
import { uid } from './ids'
import type { Diagram, FlowAction, FlowDef } from '../types'

export const FLOW_ACTIONS: { value: FlowAction; label: string; couleur: string }[] = [
  { value: 'autorise', label: 'Autorisé', couleur: '#059669' },
  { value: 'refuse', label: 'Refusé', couleur: '#dc2626' },
  { value: 'etudier', label: 'À étudier', couleur: '#d97706' },
]

/** Équipements dont la traversée expose le flux hors du périmètre maîtrisé. */
const EXPOSITION = new Set(['internet', 'wan', 'cloud', 'sase-pop', 'cdn', 'satellite', 'router-5g'])

export interface ControleFlux {
  flow: FlowDef
  /** Nombre d'équipements auxquels chaque extrémité correspond. */
  departs: number
  arrivees: number
  /** Chemins entre les deux représentants retenus (le premier de chaque extrémité). */
  chemins: RapportChemins | null
  constats: ConstatChemin[]
}

export interface RapportFlux {
  controles: ControleFlux[]
  /** Nombre de flux par décision. */
  parAction: Record<FlowAction | 'nonRenseigne', number>
  /** Flux portant au moins un constat critique. */
  bloquants: number
  /** Flux portant au moins un avertissement. */
  avertissements: number
}

/** Contrôle d'une ligne de la matrice. */
export function controlerFlux(diagram: Diagram, flow: FlowDef): ControleFlux {
  const constats: ConstatChemin[] = []
  const departs = resoudreExtremite(diagram, flow.from)
  const arrivees = resoudreExtremite(diagram, flow.to)

  if (departs.length === 0) {
    constats.push({ gravite: 'critique', texte: `Source « ${flow.from} » introuvable dans le schéma.` })
  }
  if (arrivees.length === 0) {
    constats.push({
      gravite: 'critique',
      texte: `Destination « ${flow.to} » introuvable dans le schéma.`,
    })
  }

  if (!flow.protocol?.trim()) {
    constats.push({ gravite: 'attention', texte: 'Protocole et ports non précisés.' })
  } else if (/\b(any|tout|all|\*)\b/i.test(flow.protocol)) {
    constats.push({
      gravite: 'attention',
      texte: 'Flux ouvert en « any » : à restreindre aux ports réellement nécessaires.',
    })
  }
  if (!flow.purpose?.trim()) {
    constats.push({
      gravite: 'attention',
      texte: 'Justification absente : c’est la première question posée en revue.',
    })
  }

  let chemins: RapportChemins | null = null
  if (departs.length > 0 && arrivees.length > 0 && departs[0].id !== arrivees[0].id) {
    chemins = cheminsEntre(diagram, departs[0].id, arrivees[0].id, 2)
    const principal = chemins.chemins[0]
    if (!principal) {
      constats.push({
        gravite: 'critique',
        texte: 'Aucun chemin dans le schéma entre ces deux extrémités : le flux déclaré n’est pas réalisable.',
      })
    } else {
      if (flow.action !== 'refuse' && principal.filtrage.length === 0) {
        constats.push({
          gravite: 'critique',
          texte: 'Le chemin ne traverse aucun équipement de filtrage : ce flux n’est contrôlé nulle part.',
        })
      }
      const exposition = principal.etapes.filter((etape) => EXPOSITION.has(etape.node.kind))
      if (exposition.length > 0 && !flow.encryption?.trim()) {
        constats.push({
          gravite: 'critique',
          texte: `Le flux traverse ${exposition.map((e) => e.node.name).join(', ')} sans protection déclarée : à chiffrer ou à justifier.`,
        })
      }
      // Les constats du chemin (VLAN, MTU, spanning-tree) valent pour le flux.
      for (const constat of principal.constats) {
        if (!constats.some((existant) => existant.texte === constat.texte)) constats.push(constat)
      }
    }
  }

  return { flow, departs: departs.length, arrivees: arrivees.length, chemins, constats }
}

/** Contrôle de toute la matrice, avec le décompte qui sert d'en-tête au panneau. */
export function controlerMatrice(diagram: Diagram): RapportFlux {
  const controles = (diagram.flows ?? []).map((flow) => controlerFlux(diagram, flow))
  const parAction: RapportFlux['parAction'] = {
    autorise: 0,
    refuse: 0,
    etudier: 0,
    nonRenseigne: 0,
  }
  for (const controle of controles) {
    const action = controle.flow.action
    if (action) parAction[action] += 1
    else parAction.nonRenseigne += 1
  }
  return {
    controles,
    parAction,
    bloquants: controles.filter((c) => c.constats.some((x) => x.gravite === 'critique')).length,
    avertissements: controles.filter(
      (c) => !c.constats.some((x) => x.gravite === 'critique') && c.constats.length > 0,
    ).length,
  }
}

const COLONNES = [
  'Source',
  'Destination',
  'Service',
  'Protocole et ports',
  'Décision',
  'Justification',
  'Demandeur',
  'Protection',
  'Commentaire',
]

function cellule(valeur: string | undefined): string {
  const texte = valeur ?? ''
  return /[";\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte
}

/**
 * Export CSV de la matrice, séparé par des points-virgules : c'est ce qu'Excel en français
 * ouvre sans poser de question, et la matrice finit toujours par circuler en tableur.
 */
export function fluxVersCsv(flows: FlowDef[]): string {
  const lignes = [COLONNES.join(';')]
  for (const flow of flows) {
    lignes.push(
      [
        cellule(flow.from),
        cellule(flow.to),
        cellule(flow.service),
        cellule(flow.protocol),
        cellule(FLOW_ACTIONS.find((item) => item.value === flow.action)?.label),
        cellule(flow.purpose),
        cellule(flow.owner),
        cellule(flow.encryption),
        cellule(flow.notes),
      ].join(';'),
    )
  }
  return `${lignes.join('\n')}\n`
}

/** Découpe une ligne CSV en tenant compte des guillemets. */
function decouper(ligne: string, separateur: string): string[] {
  const cellules: string[] = []
  let courante = ''
  let entreGuillemets = false
  for (let index = 0; index < ligne.length; index += 1) {
    const caractere = ligne[index]
    if (caractere === '"') {
      if (entreGuillemets && ligne[index + 1] === '"') {
        courante += '"'
        index += 1
      } else entreGuillemets = !entreGuillemets
    } else if (caractere === separateur && !entreGuillemets) {
      cellules.push(courante)
      courante = ''
    } else courante += caractere
  }
  cellules.push(courante)
  return cellules.map((valeur) => valeur.trim())
}

const ACTIONS_LUES: Record<string, FlowAction> = {
  autorise: 'autorise',
  autorisé: 'autorise',
  permit: 'autorise',
  allow: 'autorise',
  refuse: 'refuse',
  refusé: 'refuse',
  deny: 'refuse',
  bloque: 'refuse',
  bloqué: 'refuse',
  etudier: 'etudier',
  'à étudier': 'etudier',
  'a etudier': 'etudier',
}

/**
 * Import d'une matrice existante. On accepte le point-virgule comme la virgule, et des
 * en-têtes approximatifs : une matrice reçue d'un prestataire n'a jamais exactement les
 * colonnes attendues.
 */
export function fluxDepuisCsv(texte: string): { flows: FlowDef[]; warnings: string[] } {
  const lignes = texte.split(/\r?\n/).filter((ligne) => ligne.trim() !== '')
  if (lignes.length === 0) return { flows: [], warnings: ['Fichier vide.'] }

  const separateur = (lignes[0].match(/;/g)?.length ?? 0) >= (lignes[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const entetes = decouper(lignes[0], separateur).map((valeur) =>
    valeur
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase(),
  )
  const index = (...noms: string[]) => {
    for (const nom of noms) {
      const trouve = entetes.findIndex((entete) => entete.includes(nom))
      if (trouve >= 0) return trouve
    }
    return -1
  }
  const colonnes = {
    from: index('source', 'origine', 'de'),
    to: index('destination', 'cible', 'vers'),
    service: index('service', 'application'),
    protocol: index('protocole', 'port'),
    action: index('decision', 'action', 'regle'),
    purpose: index('justification', 'motif', 'besoin'),
    owner: index('demandeur', 'responsable', 'proprietaire'),
    encryption: index('protection', 'chiffrement'),
    notes: index('commentaire', 'note'),
  }

  const warnings: string[] = []
  if (colonnes.from < 0 || colonnes.to < 0) {
    return {
      flows: [],
      warnings: ['Colonnes « Source » et « Destination » introuvables dans l’en-tête.'],
    }
  }

  const flows: FlowDef[] = []
  for (let ligne = 1; ligne < lignes.length; ligne += 1) {
    const cellules = decouper(lignes[ligne], separateur)
    const lire = (position: number) => (position >= 0 ? cellules[position]?.trim() || undefined : undefined)
    const from = lire(colonnes.from)
    const to = lire(colonnes.to)
    if (!from || !to) {
      warnings.push(`Ligne ${ligne + 1} ignorée : source ou destination vide.`)
      continue
    }
    const actionLue = lire(colonnes.action)?.toLowerCase()
    flows.push({
      id: uid('f'),
      from,
      to,
      service: lire(colonnes.service),
      protocol: lire(colonnes.protocol),
      action: actionLue ? ACTIONS_LUES[actionLue] : undefined,
      purpose: lire(colonnes.purpose),
      owner: lire(colonnes.owner),
      encryption: lire(colonnes.encryption),
      notes: lire(colonnes.notes),
    })
  }
  return { flows, warnings }
}
