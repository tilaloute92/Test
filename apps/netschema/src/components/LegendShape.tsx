import { deviceMeta, LINKS } from '../lib/catalog'
import { DeviceIcon } from '../lib/icons'
import { LARGEUR_LEGENDE } from '../lib/layoutBlocks'
import type { Diagram, LinkKind } from '../types'

/**
 * Légende du schéma, construite à partir de ce que le schéma contient réellement.
 *
 * Une légende figée mentirait vite : elle énumérerait des types de liaison absents et
 * tairait ceux qu'on vient d'ajouter. Celle-ci relève les types de liaison et les familles
 * d'équipements présents sur la page, et rien d'autre. Elle est posée dans le repère du
 * schéma : elle part donc dans le SVG, le PNG et la page interactive.
 */

const LARGEUR = LARGEUR_LEGENDE
const LIGNE = 17

export interface LegendShapeProps {
  diagram: Diagram
  x: number
  y: number
}

/** Familles présentes et nombre d'équipements, les plus fournies d'abord. */
function familles(diagram: Diagram): { famille: string; icon: string; couleur: string; total: number }[] {
  const compte = new Map<string, { icon: string; couleur: string; total: number }>()
  for (const node of diagram.nodes) {
    const meta = deviceMeta(node.kind)
    const courant = compte.get(meta.family)
    if (courant) courant.total += 1
    else compte.set(meta.family, { icon: meta.icon, couleur: meta.accent, total: 1 })
  }
  return [...compte.entries()]
    .map(([famille, reste]) => ({ famille, ...reste }))
    .sort((a, b) => b.total - a.total || a.famille.localeCompare(b.famille))
}

export function LegendShape({ diagram, x, y }: LegendShapeProps) {
  const kinds = [...new Set(diagram.links.map((link) => link.kind))].filter(
    (kind): kind is LinkKind => kind in LINKS,
  )
  const groupes = familles(diagram)
  const separateur = kinds.length > 0 && groupes.length > 0 ? 14 : 0
  const hauteur = 30 + (kinds.length + groupes.length) * LIGNE + separateur + 10
  const yLiaisons = y + 40
  const yFamilles = yLiaisons + kinds.length * LIGNE + separateur

  return (
    <g data-legende="1">
      <rect
        x={x}
        y={y}
        width={LARGEUR}
        height={hauteur}
        rx={8}
        fill="#ffffff"
        stroke="#cbd5e1"
        strokeWidth={1.2}
      />
      <text x={x + 12} y={y + 19} fontSize={11.5} fontWeight={700} fill="#334155">
        Légende
      </text>
      <path d={`M ${x} ${y + 27} H ${x + LARGEUR}`} stroke="#e2e8f0" strokeWidth={1} />

      {kinds.map((kind, index) => {
        const meta = LINKS[kind]
        const cy = yLiaisons + index * LIGNE
        const total = diagram.links.filter((link) => link.kind === kind).length
        return (
          <g key={kind}>
            <line
              x1={x + 12}
              y1={cy - 4}
              x2={x + 44}
              y2={cy - 4}
              stroke={meta.color}
              strokeWidth={meta.width}
              strokeDasharray={meta.dash}
              strokeLinecap="round"
            />
            <text x={x + 52} y={cy} fontSize={10.5} fill="#475569">
              {meta.label}
            </text>
            <text x={x + LARGEUR - 12} y={cy} fontSize={10} fill="#94a3b8" textAnchor="end">
              {total}
            </text>
          </g>
        )
      })}

      {separateur > 0 && (
        <path
          d={`M ${x + 12} ${yLiaisons + kinds.length * LIGNE} H ${x + LARGEUR - 12}`}
          stroke="#e2e8f0"
          strokeWidth={1}
        />
      )}

      {groupes.map((groupe, index) => {
        const cy = yFamilles + index * LIGNE
        return (
          <g key={groupe.famille}>
            <g transform={`translate(${x + 12}, ${cy - 13}) scale(0.5)`}>
              <DeviceIcon icon={groupe.icon} color={groupe.couleur} />
            </g>
            <text x={x + 30} y={cy} fontSize={10.5} fill="#475569">
              {groupe.famille}
            </text>
            <text x={x + LARGEUR - 12} y={cy} fontSize={10} fill="#94a3b8" textAnchor="end">
              {groupe.total}
            </text>
          </g>
        )
      })}
    </g>
  )
}
