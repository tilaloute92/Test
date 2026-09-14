import { LINKS } from '../lib/catalog'
import { linkGeometry } from '../lib/routing'
import type { LinkStyle, NetLink, NetNode } from '../types'

interface Props {
  link: NetLink
  from: NetNode
  to: NetNode
  style: LinkStyle
  offset: number
  selected: boolean
  showDetails: boolean
  onPointerDown: (event: React.PointerEvent<SVGPathElement>, link: NetLink) => void
}

export function LinkShape({ link, from, to, style, offset, selected, showDetails, onPointerDown }: Props) {
  const meta = LINKS[link.kind]
  const { d, mid } = linkGeometry(from, to, style, offset)
  const label = [link.label, link.speed].filter(Boolean).join(' · ')

  return (
    <g>
      {selected && (
        <path data-export="false" d={d} fill="none" stroke="#bfdbfe" strokeWidth={meta.width + 8} strokeLinecap="round" />
      )}
      <path
        d={d}
        fill="none"
        stroke={meta.color}
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
        style={{ cursor: 'pointer' }}
        onPointerDown={(event) => onPointerDown(event, link)}
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
            stroke={meta.color}
            strokeWidth={0.8}
            opacity={0.95}
          />
          <text textAnchor="middle" y={3.5} fontSize={9.5} fill={meta.color} fontWeight={600}>
            {label}
          </text>
        </g>
      )}
    </g>
  )
}
