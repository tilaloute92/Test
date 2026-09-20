import type { Annotation, NetLink, NetNode } from '../types'

/**
 * Presse-papiers du schéma.
 *
 * Dupliquer sur la même page ne suffit pas : on reprend un bloc d'une page pour le poser sur
 * une autre, d'un document pour le poser dans un autre, parfois d'une fenêtre à l'autre. Le
 * contenu est donc écrit dans le presse-papiers du système, au format JSON, en plus d'être
 * gardé en mémoire — la copie interne reste le repli quand le navigateur refuse l'accès au
 * presse-papiers (page non sécurisée, permission refusée).
 */
export interface PressePapier {
  /** Marqueur de format : on refuse de coller ce qui ne vient pas de l'application. */
  format: 'netschema/selection'
  version: 1
  /** Titre du document d'origine, affiché à la relecture (« collé depuis … »). */
  origine?: string
  /**
   * Bloc coupé, et non copié. Un déplacement conserve tout — numéros de série, places en
   * baie : c'est le même matériel qui change de page. Une copie, elle, repart sans ce qui
   * n'appartient qu'à un exemplaire.
   */
  coupe?: boolean
  nodes: NetNode[]
  links: NetLink[]
  annotations: Annotation[]
}

export function estPressePapier(valeur: unknown): valeur is PressePapier {
  if (!valeur || typeof valeur !== 'object') return false
  const objet = valeur as Partial<PressePapier>
  return (
    objet.format === 'netschema/selection' &&
    Array.isArray(objet.nodes) &&
    Array.isArray(objet.links)
  )
}

export function serialiser(presse: PressePapier): string {
  return JSON.stringify(presse, null, 0)
}

export function analyser(texte: string): PressePapier | null {
  try {
    const valeur: unknown = JSON.parse(texte)
    if (!estPressePapier(valeur)) return null
    return { ...valeur, annotations: valeur.annotations ?? [] }
  } catch {
    return null
  }
}

/** Écrit dans le presse-papiers du système, sans jamais faire échouer la copie interne. */
export async function ecrirePressePapier(presse: PressePapier): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(serialiser(presse))
    return true
  } catch {
    return false
  }
}

/** Lit le presse-papiers du système ; rend `null` si refusé ou si le contenu n'est pas du nôtre. */
export async function lirePressePapier(): Promise<PressePapier | null> {
  try {
    const texte = await navigator.clipboard?.readText()
    return texte ? analyser(texte) : null
  } catch {
    return null
  }
}
