import { deviceMeta } from '../lib/catalog'
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
  onPointerDown: (event: React.PointerEvent<SVGGElement>, node: NetNode) => void
}

export function NodeShape({ node, selected, isConnectSource, showDetails, onPointerDown }: Props) {
  const meta = deviceMeta(node.kind)
  const details = [node.ip, node.vlan, node.model].filter(Boolean).join(' · ')

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
        stroke={meta.accent}
        strokeWidth={1.6}
      />
      <rect width={5} height={NODE_H} rx={2.5} fill={meta.accent} />

      <g transform={`translate(16, ${NODE_H / 2 - 12})`}>
        <DeviceIcon kind={node.kind} color={meta.accent} />
      </g>

      <text
        x={50}
        y={showDetails && details ? 28 : 34}
        fontSize={12.5}
        fontWeight={600}
        fill="#0f172a"
      >
        {truncate(node.name, 15)}
      </text>
      {showDetails && details && (
        <text x={50} y={43} fontSize={10} fill="#475569">
          {truncate(details, 18)}
        </text>
      )}
      {showDetails && node.zone && (
        <text x={50} y={55} fontSize={9} fill={meta.accent} fontWeight={600}>
          {truncate(node.zone, 20)}
        </text>
      )}

      {node.pinned && (
        <g transform={`translate(${NODE_W - 20}, 10)`} fill="none" stroke={meta.accent} strokeWidth={1.4}>
          <title>Position figée : ignoré par le placement automatique</title>
          <path d="M5 0v5M1.5 5h7l-1 3.5h-5Z" strokeLinejoin="round" />
          <path d="M5 8.5V12" />
        </g>
      )}
    </g>
  )
}
