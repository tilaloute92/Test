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
}

/**
 * Poignées de tracé de la liaison sélectionnée.
 *
 * Elles sont dessinées dans une couche placée au-dessus des équipements : un point de
 * passage posé sur une boîte doit rester attrapable, sinon on ne peut plus le déplacer.
 */
export function LinkHandles({ link, from, to, style, offset, onWaypointDown, onWaypointRemove, onInsertDown }: Props) {
  const geometry = linkGeometry(from, to, {
    style,
    shape: link.shape,
    offset,
    waypoints: link.waypoints,
    anchorA: link.anchorA,
    anchorB: link.anchorB,
  })

  return (
    <g data-export="false">
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
