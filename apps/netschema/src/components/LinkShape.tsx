import { LINKS } from '../lib/catalog'
import { pathFrom, type LinkGeometry, type Point } from '../lib/routing'
import type { Crossing } from '../lib/crossings'
import type { ModeStyle } from '../lib/viewModes'
import type { NetLink } from '../types'

/** Étiquette déjà placée par le plan de travail : il est le seul à voir toutes les autres. */
export interface PlacedLabel {
  which: 'mid' | 'a' | 'b'
  lines: string[]
  x: number
  y: number
  width: number
  height: number
  size: number
  /** Point du tracé auquel elle se rattache : un trait de rappel y mène si elle en est loin. */
  anchor: Point
  /** Déplacée à la main. */
  manual: boolean
}

interface Props {
  link: NetLink
  /** Tracé déjà calculé par le plan de travail (il en a besoin pour les croisements). */
  geometry: LinkGeometry
  selected: boolean
  /** Étiquettes du milieu et des extrémités, positions comprises. */
  labels: PlacedLabel[]
  /** Croisements à enjamber sur cette liaison. */
  hops: Crossing[]
  /** Couleur de tracé (couleur du VLAN en vue niveau 2, sinon couleur du type). */
  color: string
  /** Hors de la couche regardée : conservée pour le contexte, mais estompée. */
  dimmed?: boolean
  /** Les poignées de tracé ne sont proposées que sur le schéma réel, pas sur une vue dérivée. */
  editable?: boolean
  style: ModeStyle
  onPointerDown: (event: React.PointerEvent<SVGPathElement>, link: NetLink, geometry: LinkGeometry) => void
  onLabelDown: (event: React.PointerEvent<SVGGElement>, link: NetLink, label: PlacedLabel) => void
  onLabelReset: (link: NetLink, label: PlacedLabel) => void
}

export function LinkShape({
  link,
  geometry,
  selected,
  labels,
  hops,
  color,
  dimmed,
  editable,
  style,
  onPointerDown,
  onLabelDown,
  onLabelReset,
}: Props) {
  const meta = LINKS[link.kind]
  const width = Math.max(1, meta.width * style.linkWidth)
  const { points } = geometry
  // Le tracé n'est reconstruit que s'il y a des ponts à poser : sinon celui du calcul suffit.
  const d = hops.length > 0 ? pathFrom(points, geometry.shape, hops) : geometry.d

  return (
    <g opacity={dimmed ? 0.16 : 1}>
      {selected && (
        <path data-export="false" d={d} fill="none" stroke="#bfdbfe" strokeWidth={width + 8} strokeLinecap="round" />
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeDasharray={link.redundant ? '8 6' : meta.dash}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        data-export="false"
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ cursor: editable ? 'grab' : 'pointer' }}
        onPointerDown={(event) => onPointerDown(event, link, geometry)}
      />

      {labels.map((label) => {
        const distance = Math.hypot(label.x - label.anchor.x, label.y - label.anchor.y)
        const lineHeight = label.size + 2.5
        return (
          <g key={label.which}>
            {/* Trait de rappel : une étiquette écartée dit encore à quelle liaison elle est. */}
            {distance > label.height / 2 + 14 && (
              <line
                x1={label.anchor.x}
                y1={label.anchor.y}
                x2={label.x}
                y2={label.y}
                stroke={color}
                strokeWidth={0.8}
                strokeDasharray="3 3"
                opacity={0.6}
              />
            )}
            <g
              transform={`translate(${label.x}, ${label.y})`}
              style={{ cursor: editable ? 'move' : 'default' }}
              onPointerDown={(event) => onLabelDown(event, link, label)}
              onDoubleClick={(event) => {
                event.stopPropagation()
                onLabelReset(link, label)
              }}
            >
              <title>
                {label.manual
                  ? 'Étiquette déplacée à la main — double-clic pour la replacer automatiquement'
                  : 'Glisser pour déplacer l’étiquette'}
              </title>
              <rect
                x={-label.width / 2}
                y={-label.height / 2}
                width={label.width}
                height={label.height}
                rx={label.which === 'mid' ? label.height / 2 : 3}
                fill="#ffffff"
                stroke={color}
                strokeWidth={label.manual ? 1.1 : 0.8}
                opacity={0.95}
              />
              {label.lines.map((line, index) => (
                <text
                  key={line}
                  textAnchor="middle"
                  y={-label.height / 2 + 2 + lineHeight * (index + 1) - lineHeight / 3.2}
                  fontSize={index === 0 ? label.size : label.size - 0.8}
                  fill={color}
                  fontWeight={index === 0 ? 600 : 500}
                >
                  {line}
                </text>
              ))}
            </g>
          </g>
        )
      })}
    </g>
  )
}
