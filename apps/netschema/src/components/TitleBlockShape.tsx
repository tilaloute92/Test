import type { Diagram } from '../types'

/**
 * Cartouche du document, au sens du dessin technique.
 *
 * Un plan d'infrastructure circule : il est joint à un marché, envoyé à un prestataire,
 * ressorti deux ans plus tard pendant un incident. Sans indice de révision, sans date et
 * sans mention de diffusion, personne ne sait s'il a le bon, ni s'il a le droit de le
 * transmettre. Le cartouche est posé sous le schéma, dans le même repère : il suit le
 * cadrage et part dans tous les exports.
 */

const LARGEUR = 420
const LIGNE = 19

export interface TitleBlockShapeProps {
  diagram: Diagram
  /** Coin haut-gauche du cartouche, en coordonnées du schéma. */
  x: number
  y: number
}

export function TitleBlockShape({ diagram, x, y }: TitleBlockShapeProps) {
  const bloc = diagram.titleBlock ?? {}
  const lignes: [string, string][] = [
    ['Organisation', bloc.organisation ?? ''],
    ['Référence', bloc.reference ?? ''],
    ['Indice', bloc.version ?? ''],
    ['Date', bloc.date ?? ''],
    ['Établi par', bloc.author ?? ''],
    ['État', bloc.status ?? ''],
    ['Diffusion', bloc.confidentiality ?? ''],
  ].filter(([, valeur]) => valeur.trim() !== '') as [string, string][]

  // Deux colonnes dès que le cartouche est bien rempli : plus compact sous le schéma.
  const colonnes = lignes.length > 4 ? 2 : 1
  const parColonne = Math.ceil(lignes.length / colonnes)
  const hauteur = 34 + parColonne * LIGNE + (bloc.notes ? 22 : 0) + 8

  return (
    <g data-cartouche="1">
      <rect
        x={x}
        y={y}
        width={LARGEUR}
        height={hauteur}
        rx={8}
        fill="#ffffff"
        stroke="#94a3b8"
        strokeWidth={1.4}
      />
      <path d={`M ${x} ${y + 28} H ${x + LARGEUR}`} stroke="#cbd5e1" strokeWidth={1} />
      <text x={x + 12} y={y + 19} fontSize={13} fontWeight={700} fill="#0f172a">
        {diagram.title}
      </text>
      {diagram.pageName && (
        <text x={x + LARGEUR - 12} y={y + 19} fontSize={11} fill="#64748b" textAnchor="end">
          {diagram.pageName}
        </text>
      )}

      {lignes.map(([etiquette, valeur], index) => {
        const colonne = Math.floor(index / parColonne)
        const rang = index % parColonne
        const cx = x + 12 + colonne * (LARGEUR / colonnes)
        const cy = y + 45 + rang * LIGNE
        return (
          <g key={etiquette}>
            <text x={cx} y={cy} fontSize={10} fill="#94a3b8">
              {etiquette}
            </text>
            <text x={cx + 66} y={cy} fontSize={11} fontWeight={600} fill="#334155">
              {valeur}
            </text>
          </g>
        )
      })}

      {bloc.notes && (
        <text
          x={x + 12}
          y={y + hauteur - 10}
          fontSize={10.5}
          fill="#64748b"
        >
          {bloc.notes.slice(0, 92)}
        </text>
      )}
    </g>
  )
}

/** Hauteur occupée, pour placer ce qui vient à côté. */
export function titleBlockSize(diagram: Diagram): { width: number; height: number } {
  const bloc = diagram.titleBlock ?? {}
  const remplies = [
    bloc.organisation,
    bloc.reference,
    bloc.version,
    bloc.date,
    bloc.author,
    bloc.status,
    bloc.confidentiality,
  ].filter((valeur) => (valeur ?? '').trim() !== '').length
  const colonnes = remplies > 4 ? 2 : 1
  const parColonne = Math.ceil(remplies / colonnes)
  return { width: LARGEUR, height: 34 + parColonne * LIGNE + (bloc.notes ? 22 : 0) + 8 }
}
