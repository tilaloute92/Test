import { deviceMeta, ROLES } from '../lib/catalog'
import { vendorMark } from '../lib/vendorMarks'
import { groupSummary, type DisplayNode } from '../lib/derive'
import { DeviceIcon } from '../lib/icons'
import type { ModeStyle } from '../lib/viewModes'
import { NODE_H, NODE_W } from '../types'

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

interface Props {
  node: DisplayNode
  selected: boolean
  isConnectSource: boolean
  showDetails: boolean
  /** Signalé par l'analyse de haute disponibilité comme point de défaillance critique. */
  flagged: boolean
  /** Hors de la couche OSI regardée : estompé plutôt que masqué. */
  dimmed?: boolean
  /** Habillage du mode de visualisation courant. */
  style: ModeStyle
  onPointerDown: (event: React.PointerEvent<SVGGElement>, node: DisplayNode) => void
  onDoubleClick?: () => void
  /** Survol : l'info-bulle de l'équipement. */
  onHover?: (node: DisplayNode | null, event?: React.PointerEvent<SVGGElement>) => void
}

export function NodeShape({
  node,
  selected,
  isConnectSource,
  showDetails,
  flagged,
  dimmed,
  style,
  onPointerDown,
  onDoubleClick,
  onHover,
}: Props) {
  const meta = deviceMeta(node.kind)
  const group = node.group
  // En mode technique, l'adressage et le matériel restent affichés : c'est ce qu'on vient y
  // chercher. En présentation, la boîte ne porte que son nom.
  const withDetails = style.details && showDetails
  const details = withDetails
    ? [node.ip, node.vlan, node.model, style.dense ? node.serial : undefined].filter(Boolean).join(' · ')
    : ''
  const context = withDetails
    ? [
        node.zone,
        node.cluster ? undefined : node.vip ? `VIP ${node.vip}` : undefined,
        style.dense && node.owner ? node.owner : undefined,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const role = node.role && node.role !== 'standalone' ? ROLES[node.role] : undefined
  // Marque du constructeur : un monogramme, dessiné par l'application (voir vendorMarks.ts).
  const marque = group ? null : vendorMark(node.vendor, node.model)
  const badgeWidth = role ? role.badge.length * 6 + 12 : 0

  return (
    <g
      data-noeud={node.id}
      transform={`translate(${node.x - NODE_W / 2}, ${node.y - NODE_H / 2})`}
      onPointerDown={(event) => onPointerDown(event, node)}
      onDoubleClick={onDoubleClick}
      onPointerEnter={(event) => onHover?.(node, event)}
      onPointerMove={(event) => onHover?.(node, event)}
      onPointerLeave={() => onHover?.(null)}
      opacity={dimmed ? 0.22 : 1}
      style={{ cursor: group ? 'pointer' : 'grab' }}
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

      {/* Bloc replié : un empilement de fiches suggère qu'il en contient plusieurs. */}
      {group && (
        <>
          <rect x={8} y={8} width={NODE_W} height={NODE_H} rx={style.radius} fill={meta.fill} stroke={meta.accent} strokeWidth={1.2} opacity={0.45} />
          <rect x={4} y={4} width={NODE_W} height={NODE_H} rx={style.radius} fill={meta.fill} stroke={meta.accent} strokeWidth={1.4} opacity={0.7} />
        </>
      )}

      {/* L'ombre portée n'existe qu'en présentation : dessinée en dur plutôt que par un
          filtre, elle survit à l'export comme au copier-coller dans un traitement de texte. */}
      {style.shadow && (
        <rect x={3} y={4} width={NODE_W} height={NODE_H} rx={style.radius} fill="#0f172a" opacity={0.1} />
      )}
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={style.radius}
        fill={style.fill === 'blanc' ? '#ffffff' : meta.fill}
        stroke={flagged ? '#dc2626' : meta.accent}
        strokeWidth={flagged ? Math.max(2.2, style.stroke) : style.stroke}
      />
      <rect width={5} height={NODE_H} rx={2.5} fill={meta.accent} />

      <g transform={`translate(16, ${NODE_H / 2 - 12})`}>
        <DeviceIcon icon={meta.icon} color={meta.accent} />
      </g>

      <text
        x={50}
        y={details || context || group ? 26 : 34 + (style.nameSize - 12.5) / 2}
        fontSize={style.nameSize}
        fontWeight={600}
        fill="#0f172a"
      >
        {truncate(node.name, role ? 12 : style.nameSize > 13 ? 13 : 15)}
      </text>

      {group ? (
        <>
          <text x={50} y={42} fontSize={9.5} fill="#475569">
            {truncate(groupSummary(group), 24)}
          </text>
          <text x={50} y={54} fontSize={9} fontWeight={600} fill={meta.accent}>
            Double-clic pour ouvrir
          </text>
          <g transform={`translate(${NODE_W - 30}, 8)`}>
            <rect width={22} height={15} rx={7.5} fill={meta.accent} />
            <text x={11} y={11} textAnchor="middle" fontSize={9} fontWeight={700} fill="#ffffff">
              {group.count}
            </text>
          </g>
        </>
      ) : (
        <>
          {details && (
            <text data-couche="details" x={50} y={41} fontSize={style.dense ? 9.5 : 10} fill="#475569">
              {truncate(details, style.dense ? 22 : 18)}
            </text>
          )}
          {context && (
            <text data-couche="details" x={50} y={53} fontSize={9} fill={meta.accent} fontWeight={600}>
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
        </>
      )}

      {marque && (
        <g transform="translate(9, 5)">
          <title>{marque.label}</title>
          <rect
            width={marque.code.length * 5.6 + 8}
            height={12}
            rx={3}
            fill={marque.color}
            opacity={0.14}
          />
          <text
            x={(marque.code.length * 5.6 + 8) / 2}
            y={8.8}
            textAnchor="middle"
            fontSize={7.6}
            fontWeight={700}
            letterSpacing="0.3"
            fill={marque.color}
          >
            {marque.code}
          </text>
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
