import { LINKS } from '../lib/catalog'
import { pathFrom, pointAlong, type LinkGeometry } from '../lib/routing'
import type { Crossing } from '../lib/crossings'
import type { ModeStyle } from '../lib/viewModes'
import type { NetLink } from '../types'

interface Props {
  link: NetLink
  /** Tracé déjà calculé par le plan de travail (il en a besoin pour les croisements). */
  geometry: LinkGeometry
  selected: boolean
  showDetails: boolean
  /** Libellé déjà adapté à la couche OSI regardée. */
  label: string
  /** Ce qui s'écrit à chaque extrémité : port, configuration de couche 2, adresse. */
  endLabels: { a?: string[]; b?: string[] }
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
}

/** Étiquette posée à la sortie d'un équipement : port branché, ou adresse d'interface. */
function EndLabel({
  points,
  fromEnd,
  lines,
  color,
  size,
}: {
  points: { x: number; y: number }[]
  fromEnd: boolean
  lines: string[]
  color: string
  size: number
}) {
  const spot = pointAlong(points, 30, fromEnd)
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const width = longest * size * 0.62 + 8
  const lineHeight = size + 2.5
  const height = lines.length * lineHeight + 4
  // Décalage perpendiculaire au trait : l'étiquette se pose à côté, jamais dessus.
  const offset = 6 + height / 2
  const x = spot.x - spot.dy * offset
  const y = spot.y + spot.dx * offset

  return (
    <g transform={`translate(${x}, ${y})`} pointerEvents="none">
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={3}
        fill="#ffffff"
        stroke={color}
        strokeWidth={0.7}
        opacity={0.92}
      />
      {lines.map((line, index) => (
        <text
          key={line}
          textAnchor="middle"
          y={-height / 2 + 3 + lineHeight * (index + 1) - lineHeight / 3.2}
          fontSize={index === 0 ? size : size - 0.8}
          fill={color}
          fontWeight={index === 0 ? 600 : 500}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

export function LinkShape({
  link,
  geometry,
  selected,
  showDetails,
  label,
  endLabels,
  hops,
  color,
  dimmed,
  editable,
  style,
  onPointerDown,
}: Props) {
  const meta = LINKS[link.kind]
  const width = Math.max(1, meta.width * style.linkWidth)
  const { mid, points } = geometry
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

      {showDetails && endLabels.a && endLabels.a.length > 0 && (
        <EndLabel points={points} fromEnd={false} lines={endLabels.a} color={color} size={style.labelSize - 1} />
      )}
      {showDetails && endLabels.b && endLabels.b.length > 0 && (
        <EndLabel points={points} fromEnd lines={endLabels.b} color={color} size={style.labelSize - 1} />
      )}

      {showDetails && label && (
        <g transform={`translate(${mid.x}, ${mid.y})`} pointerEvents="none">
          <rect
            x={-(label.length * style.labelSize * 0.33 + 6)}
            y={-style.labelSize / 2 - 3.5}
            width={label.length * style.labelSize * 0.66 + 12}
            height={style.labelSize + 7}
            rx={8}
            fill="#ffffff"
            stroke={color}
            strokeWidth={0.8}
            opacity={0.95}
          />
          <text textAnchor="middle" y={style.labelSize / 2 - 1.2} fontSize={style.labelSize} fill={color} fontWeight={600}>
            {label}
          </text>
        </g>
      )}
    </g>
  )
}
