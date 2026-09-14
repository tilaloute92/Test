import { deviceMeta, ROLES } from '../lib/catalog'
import { DeviceIcon } from '../lib/icons'
import { NODE_H, NODE_W, type NetNode } from '../types'

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

interface Props {
  node: NetNode
  selected: boolean
  isConnectSource: boolean
  showDetails: boolean
  /** Signalé par l'analyse de haute disponibilité comme point de défaillance critique. */
  flagged: boolean
  onPointerDown: (event: React.PointerEvent<SVGGElement>, node: NetNode) => void
}

export function NodeShape({ node, selected, isConnectSource, showDetails, flagged, onPointerDown }: Props) {
  const meta = deviceMeta(node.kind)
  const details = [node.ip, node.vlan, node.model].filter(Boolean).join(' · ')
  const context = [node.zone, node.cluster ? undefined : node.vip ? `VIP ${node.vip}` : undefined]
    .filter(Boolean)
    .join(' · ')
  const role = node.role && node.role !== 'standalone' ? ROLES[node.role] : undefined
  const badgeWidth = role ? role.badge.length * 6 + 12 : 0

  return (
    <g
      transform={`translate(${node.x - NODE_W / 2}, ${node.y - NODE_H / 2})`}
      onPointerDown={(event) => onPointerDown(event, node)}
      style={{ cursor: 'grab' }}
    >
      {(selected || isConnectSource) && (
        <rect
          data-export="false"
          x={-5}
          y={-5}
          width={NODE_W + 10}
          height={NODE_H + 10}
          rx={14}
          fill="none"
          stroke={isConnectSource ? '#059669' : '#2563eb'}
          strokeWidth={2}
          strokeDasharray={isConnectSource ? '5 4' : undefined}
        />
      )}

      <rect
        width={NODE_W}
        height={NODE_H}
        rx={10}
        fill={meta.fill}
        stroke={flagged ? '#dc2626' : meta.accent}
        strokeWidth={flagged ? 2.2 : 1.6}
      />
      <rect width={5} height={NODE_H} rx={2.5} fill={meta.accent} />

      <g transform={`translate(16, ${NODE_H / 2 - 12})`}>
        <DeviceIcon kind={node.kind} color={meta.accent} />
      </g>

      <text x={50} y={showDetails && (details || context) ? 26 : 34} fontSize={12.5} fontWeight={600} fill="#0f172a">
        {truncate(node.name, role ? 12 : 15)}
      </text>
      {showDetails && details && (
        <text x={50} y={41} fontSize={10} fill="#475569">
          {truncate(details, 18)}
        </text>
      )}
      {showDetails && context && (
        <text x={50} y={53} fontSize={9} fill={meta.accent} fontWeight={600}>
          {truncate(context, 20)}
        </text>
      )}

      {role && (
        <g transform={`translate(${NODE_W - badgeWidth - 7}, 6)`}>
          <rect width={badgeWidth} height={14} rx={7} fill={role.color} />
          <text x={badgeWidth / 2} y={10.2} textAnchor="middle" fontSize={8} fontWeight={700} fill="#ffffff">
            {role.badge}
          </text>
        </g>
      )}

      {node.dualPower && (
        <g transform={`translate(${NODE_W - 34}, ${NODE_H - 17})`}>
          <title>Double alimentation électrique (chaînes A et B)</title>
          <path d="M5 0 1.5 6h3L3.5 11 8 4.5H5Z" fill="#a16207" />
          <text x={10} y={9} fontSize={8} fontWeight={700} fill="#a16207">
            A/B
          </text>
        </g>
      )}

      {node.pinned && (
        <g transform={`translate(10, ${NODE_H - 18})`} fill="none" stroke={meta.accent} strokeWidth={1.4}>
          <title>Position figée : ignoré par le placement automatique</title>
          <path d="M5 0v5M1.5 5h7l-1 3.5h-5Z" strokeLinejoin="round" />
          <path d="M5 8.5V12" />
        </g>
      )}

      {flagged && (
        <g transform="translate(-8, -8)">
          <title>Point de défaillance unique — voir l’analyse haute disponibilité</title>
          <circle cx="8" cy="8" r="8" fill="#dc2626" />
          <path d="M8 4v5" stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" />
          <circle cx="8" cy="11.6" r="1" fill="#ffffff" />
        </g>
      )}
    </g>
  )
}
