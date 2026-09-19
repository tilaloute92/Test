/**
 * Annotations du plan : couleurs proposées et découpe du texte.
 *
 * Séparé du composant qui les dessine : la mise en page du texte sert aussi aux exports,
 * et une constante partagée n'a rien à faire dans un fichier de composants.
 */

import type { Annotation } from '../types'

/** Couleurs proposées : lisibles à l'écran comme à l'impression, y compris en noir et blanc. */
export const ANNOTATION_COLORS: { id: string; label: string; accent: string; fill: string }[] = [
  { id: '#f59e0b', label: 'Ambre', accent: '#f59e0b', fill: '#fffbeb' },
  { id: '#dc2626', label: 'Rouge', accent: '#dc2626', fill: '#fef2f2' },
  { id: '#2563eb', label: 'Bleu', accent: '#2563eb', fill: '#eff6ff' },
  { id: '#059669', label: 'Vert', accent: '#059669', fill: '#ecfdf5' },
  { id: '#7c3aed', label: 'Violet', accent: '#7c3aed', fill: '#f5f3ff' },
  { id: '#475569', label: 'Ardoise', accent: '#475569', fill: '#f8fafc' },
]

const DEFAUTS: Record<Annotation['kind'], string> = {
  note: '#f59e0b',
  zone: '#7c3aed',
  arrow: '#dc2626',
}

export function annotationColors(annotation: Annotation): { accent: string; fill: string } {
  const id = annotation.color ?? DEFAUTS[annotation.kind]
  const trouve = ANNOTATION_COLORS.find((item) => item.id.toLowerCase() === id.toLowerCase())
  return trouve ?? { accent: id, fill: '#f8fafc' }
}

/**
 * Découpe un texte en lignes qui tiennent dans la largeur donnée.
 *
 * Le SVG ne sait pas revenir à la ligne tout seul : on coupe aux espaces, avec une largeur
 * de caractère moyenne. C'est une approximation, mais elle suffit pour une note.
 */
export function wrapText(texte: string, largeurPx: number, taille: number): string[] {
  const parCaractere = taille * 0.54
  const max = Math.max(6, Math.floor(largeurPx / parCaractere))
  const lignes: string[] = []
  for (const paragraphe of texte.split('\n')) {
    if (paragraphe.trim() === '') {
      lignes.push('')
      continue
    }
    let courante = ''
    for (const mot of paragraphe.split(/\s+/)) {
      const essai = courante ? `${courante} ${mot}` : mot
      if (essai.length <= max) {
        courante = essai
        continue
      }
      if (courante) lignes.push(courante)
      // Un mot plus long que la ligne (une URL, un nom d'interface) est coupé net.
      courante = mot
      while (courante.length > max) {
        lignes.push(courante.slice(0, max))
        courante = courante.slice(max)
      }
    }
    if (courante) lignes.push(courante)
  }
  return lignes
}
