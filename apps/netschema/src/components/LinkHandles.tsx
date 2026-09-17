import { linkGeometry, segmentMidpoints } from '../lib/routing'
import type { LinkStyle, NetLink, NetNode } from '../types'

interface Props {
  link: NetLink
  from: NetNode
  to: NetNode
  style: LinkStyle
  offset: number
  onWaypointDown: (event: React.PointerEvent<SVGCircleElement>, link: NetLink, index: number) => void
  onWaypointRemove: (link: NetLink, index: number) => void
  onInsertDown: (
    event: React.PointerEvent<SVGCircleElement>,
    link: NetLink,
    index: number,
    point: { x: number; y: number },
  ) => void
  /** Prise en main d'une extrémité : elle suit le pointeur jusqu'à l'équipement visé. */
  onEndpointDown: (event: React.PointerEvent<SVGRectElement>, link: NetLink, end: 'a' | 'b') => void
  /** Double-clic sur une extrémité : retour à l'accroche automatique. */
  onEndpointReset: (link: NetLink) => void
}

/**
 * Poignées de tracé de la liaison sélectionnée.
 *
 * Elles sont dessinées dans une couche placée au-dessus des équipements : un point de
 * passage posé sur une boîte doit rester attrapable, sinon on ne peut plus le déplacer.
 */
export function LinkHandles({
  link,
  from,
  to,
  style,
  offset,
  onWaypointDown,
  onWaypointRemove,
  onInsertDown,
  onEndpointDown,
  onEndpointReset,
}: Props) {
  const geometry = linkGeometry(from, to, {
    style,
    shape: link.shape,
    offset,
    waypoints: link.waypoints,
    anchorA: link.anchorA,
    anchorB: link.anchorB,
    attachA: link.attachA,
    attachB: link.attachB,
  })

  const endpoints: { end: 'a' | 'b'; point: { x: number; y: number }; free: boolean }[] = [
    { end: 'a', point: geometry.nodes[0], free: link.attachA !== undefined },
    { end: 'b', point: geometry.nodes[geometry.nodes.length - 1], free: link.attachB !== undefined },
  ]

  return (
    <g data-export="false">
      {/* Extrémités : à tirer sur l'équipement, à l'endroit exact où la liaison doit arriver. */}
      {endpoints.map(({ end, point, free }) => (
        <g key={`endpoint-${end}`}>
          {/* Zone de prise généreuse : la poignée se trouve sur le bord d'une boîte, là où se
              bousculent l'étiquette, le tracé et l'équipement lui-même. */}
          <rect
            data-handle={`endpoint-${end}`}
            x={point.x - 11}
            y={point.y - 11}
            width={22}
            height={22}
            fill="transparent"
            style={{ cursor: 'grab' }}
            onPointerDown={(event) => onEndpointDown(event, link, end)}
            onDoubleClick={(event) => {
              event.stopPropagation()
              onEndpointReset(link)
            }}
          >
            <title>
              Glisser sur un équipement pour choisir le point d’accroche, tout autour de la
              boîte · Alt pour se poser entre deux repères · double-clic : accroche automatique
            </title>
          </rect>
          <rect
            x={point.x - 6.5}
            y={point.y - 6.5}
            width={13}
            height={13}
            rx={3}
            fill={free ? '#059669' : '#ffffff'}
            stroke="#059669"
            strokeWidth={2.2}
            pointerEvents="none"
          />
          {free && (
            <rect
              x={point.x - 2}
              y={point.y - 2}
              width={4}
              height={4}
              rx={1}
              fill="#ffffff"
              pointerEvents="none"
            />
          )}
        </g>
      ))}
      {/* Milieu de segment : tirer ici crée un point de passage. */}
      {segmentMidpoints(geometry).map((handle) => (
        <circle
          key={`insert-${handle.index}`}
          cx={handle.point.x}
          cy={handle.point.y}
          r={4}
          fill="#ffffff"
          stroke="#60a5fa"
          strokeWidth={1.4}
          style={{ cursor: 'copy' }}
          onPointerDown={(event) => onInsertDown(event, link, handle.index, handle.point)}
        >
          <title>Tirer pour ajouter un point de passage</title>
        </circle>
      ))}

      {/* Points de passage posés à la main. */}
      {geometry.waypoints.map((point, index) => (
        <circle
          key={`waypoint-${index}`}
          data-handle="waypoint"
          cx={point.x}
          cy={point.y}
          r={5.5}
          fill="#2563eb"
          stroke="#ffffff"
          strokeWidth={1.6}
          style={{ cursor: 'move' }}
          onPointerDown={(event) => onWaypointDown(event, link, index)}
          onDoubleClick={(event) => {
            event.stopPropagation()
            onWaypointRemove(link, index)
          }}
        >
          <title>Glisser pour déplacer · double-clic pour supprimer</title>
        </circle>
      ))}
    </g>
  )
}
