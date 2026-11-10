import { VIEW_MODES } from './viewModes'
import { VUES_LOGIQUES, type VueLogique } from './vlanViews'
import type { ViewMode } from '../types'

/**
 * Ce qu'on met dans une page HTML exportée.
 *
 * L'export sortait tout, toujours : chaque page du document dans les quatre vues. Sur un
 * document de six pages, cela fait vingt-quatre schémas dans un fichier qu'on envoie à
 * quelqu'un qui n'en voulait qu'un. On choisit donc : quels onglets (les pages), quelles
 * vues, quels tableaux.
 *
 * Ce module ne fait que décrire et valider ce choix — sans navigateur, donc sans surprise.
 */

/** Une vue qu'on peut demander : un mode de visualisation, ou l'une des lectures logiques. */
export interface VueExportable {
  /** Identifiant stable, utilisé dans la page produite et dans le choix mémorisé. */
  id: string
  mode: ViewMode
  /** Laquelle des lectures logiques, quand le mode est « logique ». */
  logique?: VueLogique
  label: string
  hint: string
}

/**
 * Les vues exportables, dans l'ordre où l'application les présente.
 *
 * Le mode « Logique » n'est pas une vue mais trois — routage, plan VLAN, domaines de
 * diffusion. L'export n'en sortait qu'une, celle qui se trouvait affichée ; elles se
 * choisissent maintenant une à une.
 */
export function vuesExportables(): VueExportable[] {
  return VIEW_MODES.flatMap((definition): VueExportable[] =>
    definition.id === 'logique'
      ? VUES_LOGIQUES.map((vue) => ({
          id: `logique-${vue.value}`,
          mode: 'logique',
          logique: vue.value,
          label: `Logique — ${vue.label}`,
          hint: vue.hint,
        }))
      : [{ id: definition.id, mode: definition.id, label: definition.label, hint: definition.hint }],
  )
}

/** Les tableaux qui accompagnent le schéma dans la page. */
export type TableauExport = 'equipements' | 'liaisons' | 'flux'

export const TABLEAUX_EXPORT: { id: TableauExport; label: string; hint: string }[] = [
  { id: 'equipements', label: 'Équipements', hint: 'Nom, type, modèle, adresse, VLAN, n° de série, site, baie…' },
  { id: 'liaisons', label: 'Liaisons', hint: 'Extrémités, type, débit, ports, VLAN, routage…' },
  { id: 'flux', label: 'Flux', hint: 'La matrice de flux, si le document en a une.' },
]

export interface ChoixExport {
  /** Index des pages retenues, dans l'ordre du document. */
  pages: number[]
  /** Identifiants des vues retenues (voir `vuesExportables`). */
  vues: string[]
  tableaux: TableauExport[]
}

/**
 * Le choix proposé à l'ouverture : toutes les pages, et ce que l'export produisait jusqu'ici
 * — architecture, technique, la lecture logique affichée, présentation — avec les trois
 * tableaux. Ce qu'on a choisi la dernière fois pour les vues et les tableaux est repris ;
 * les pages, elles, changent d'un document à l'autre : on repart de toutes.
 */
export function choixParDefaut(
  nombreDePages: number,
  logiqueCourante: VueLogique,
  memorise?: { vues?: unknown; tableaux?: unknown } | null,
): ChoixExport {
  const connues = vuesExportables().map((vue) => vue.id)
  const tableauxConnus = TABLEAUX_EXPORT.map((tableau) => tableau.id)
  const liste = (valeur: unknown): string[] => (Array.isArray(valeur) ? valeur.filter((item): item is string => typeof item === 'string') : [])

  const vuesMemorisees = connues.filter((id) => liste(memorise?.vues).includes(id))
  const vues =
    vuesMemorisees.length > 0
      ? vuesMemorisees
      : connues.filter((id) => !id.startsWith('logique-') || id === `logique-${logiqueCourante}`)
  const tableaux = Array.isArray(memorise?.tableaux)
    ? tableauxConnus.filter((id) => liste(memorise?.tableaux).includes(id))
    : tableauxConnus
  return { pages: Array.from({ length: Math.max(0, nombreDePages) }, (_, index) => index), vues, tableaux }
}

/** Il faut au moins une page et une vue : une page HTML sans schéma n'est pas cet export. */
export function choixValide(choix: ChoixExport): boolean {
  return choix.pages.length > 0 && choix.vues.length > 0
}

/** Le choix remis dans l'ordre du document et des vues, sans doublon ni inconnu. */
export function choixNormalise(choix: ChoixExport, nombreDePages: number): ChoixExport {
  const connues = vuesExportables().map((vue) => vue.id)
  const tableauxConnus = TABLEAUX_EXPORT.map((tableau) => tableau.id)
  return {
    pages: [...new Set(choix.pages)].filter((index) => Number.isInteger(index) && index >= 0 && index < nombreDePages).sort((a, b) => a - b),
    vues: connues.filter((id) => choix.vues.includes(id)),
    tableaux: tableauxConnus.filter((id) => choix.tableaux.includes(id)),
  }
}

/** « 2 pages × 3 vues = 6 schémas, 2 tableaux » — ce que contiendra le fichier. */
export function resumeChoix(choix: ChoixExport): string {
  const pluriel = (nombre: number, mot: string, motPluriel = `${mot}s`) => `${nombre} ${nombre > 1 ? motPluriel : mot}`
  const schemas = choix.pages.length * choix.vues.length
  const detail =
    choix.pages.length > 1 && choix.vues.length > 1
      ? `${pluriel(choix.pages.length, 'page')} × ${pluriel(choix.vues.length, 'vue')} = ${pluriel(schemas, 'schéma')}`
      : `${pluriel(choix.pages.length, 'page')}, ${pluriel(choix.vues.length, 'vue')}`
  const tableaux = choix.tableaux.length === 0 ? 'aucun tableau' : pluriel(choix.tableaux.length, 'tableau', 'tableaux')
  return `${detail}, ${tableaux}`
}

const CLE_MEMOIRE = 'netschema:exportHtml'

/** Vues et tableaux choisis au dernier export, s'il y en a un et qu'il se relit. */
export function lireChoixMemorise(): { vues?: unknown; tableaux?: unknown } | null {
  try {
    const brut = localStorage.getItem(CLE_MEMOIRE)
    const lu: unknown = brut ? JSON.parse(brut) : null
    return lu && typeof lu === 'object' ? (lu as { vues?: unknown; tableaux?: unknown }) : null
  } catch {
    return null
  }
}

export function memoriserChoix(choix: ChoixExport) {
  try {
    localStorage.setItem(CLE_MEMOIRE, JSON.stringify({ vues: choix.vues, tableaux: choix.tableaux }))
  } catch {
    // Stockage indisponible : le choix vaut pour cet export, sans plus.
  }
}
