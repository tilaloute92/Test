import { LINKS } from '../lib/catalog'
import { linkGeometry, type LinkGeometry } from '../lib/routing'
import type { LinkStyle, NetLink, NetNode } from '../types'

interface Props {
  link: NetLink
  from: NetNode
  to: NetNode
  /** Tracé par défaut du schéma ; la liaison peut imposer le sien. */
  style: LinkStyle
  offset: number
  selected: boolean
  showDetails: boolean
  /** Libellé déjà adapté à la couche OSI regardée. */
  label: string
  /** Couleur de tracé (couleur du VLAN en vue niveau 2, sinon couleur du type). */
  color: string
  /** Hors de la couche regardée : conservée pour le contexte, mais estompée. */
  dimmed?: boolean
  /** Les poignées de tracé ne sont proposées que sur le schéma réel, pas sur une vue dérivée. */
  editable?: boolean
  onPointerDown: (event: React.PointerEvent<SVGPathElement>, link: NetLink, geometry: LinkGeometry) => void
}

export function LinkShape({
  link,
  from,
  to,
  style,
  offset,
  selected,
  showDetails,
  label,
  color,
  dimmed,
  editable,
  onPointerDown,
}: Props) {
  const meta = LINKS[link.kind]
  const geometry = linkGeometry(from, to, {
    style,
    shape: link.shape,
    offset,
    waypoints: link.waypoints,
    anchorA: link.anchorA,
    anchorB: link.anchorB,
  })
  const { d, mid } = geometry

  return (
    <g opacity={dimmed ? 0.16 : 1}>
      {selected && (
        <path data-export="false" d={d} fill="none" stroke="#bfdbfe" strokeWidth={meta.width + 8} strokeLinecap="round" />
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={meta.width}
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

      {showDetails && label && (
        <g transform={`translate(${mid.x}, ${mid.y})`} pointerEvents="none">
          <rect
            x={-(label.length * 3.1 + 6)}
            y={-8}
            width={label.length * 6.2 + 12}
            height={16}
            rx={8}
            fill="#ffffff"
            stroke={color}
            strokeWidth={0.8}
            opacity={0.95}
          />
          <text textAnchor="middle" y={3.5} fontSize={9.5} fill={color} fontWeight={600}>
            {label}
          </text>
        </g>
      )}
    </g>
  )
}
