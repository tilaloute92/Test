import { annotationColors, wrapText } from '../lib/annotations'
import type { Annotation } from '../types'

/**
 * Annotations du plan : la note, le cadre commenté et la flèche.
 *
 * Un schéma d'infrastructure ne se limite jamais aux boîtes et aux traits — il porte des
 * réserves (« lien opérateur en cours de commande »), des périmètres de travaux et des
 * renvois. Faute de quoi ces informations finissent dans un courriel que plus personne ne
 * retrouve six mois plus tard.
 *
 * Tout est tracé en attributs de présentation : l'annotation part telle quelle dans le SVG,
 * le PNG et la page interactive.
 */

export interface AnnotationShapeProps {
  annotation: Annotation
  selected: boolean
  editable: boolean
  onPointerDown: (event: React.PointerEvent<SVGGElement>, annotation: Annotation) => void
  onHandleDown: (
    event: React.PointerEvent<SVGElement>,
    annotation: Annotation,
    poignee: 'taille' | 'depart' | 'arrivee',
  ) => void
  onDoubleClick: (annotation: Annotation, event: React.MouseEvent) => void
}

export function AnnotationShape({
  annotation,
  selected,
  editable,
  onPointerDown,
  onHandleDown,
  onDoubleClick,
}: AnnotationShapeProps) {
  const { accent, fill } = annotationColors(annotation)
  const commun = {
    'data-annotation': annotation.id,
    onPointerDown: (event: React.PointerEvent<SVGGElement>) => onPointerDown(event, annotation),
    onDoubleClick: (event: React.MouseEvent) => onDoubleClick(annotation, event),
    style: { cursor: editable ? 'move' : 'default' } as React.CSSProperties,
  }

  if (annotation.kind === 'arrow') {
    const x2 = annotation.x + annotation.w
    const y2 = annotation.y + annotation.h
    const angle = Math.atan2(y2 - annotation.y, x2 - annotation.x)
    // Pointe dessinée à la main plutôt qu'avec un marqueur SVG : certains visualiseurs et le
    // rendu PNG ignorent les marqueurs, le schéma exporté perdrait ses flèches.
    const taille = 13
    const p1 = { x: x2 - taille * Math.cos(angle - 0.42), y: y2 - taille * Math.sin(angle - 0.42) }
    const p2 = { x: x2 - taille * Math.cos(angle + 0.42), y: y2 - taille * Math.sin(angle + 0.42) }
    const milieu = { x: (annotation.x + x2) / 2, y: (annotation.y + y2) / 2 }
    return (
      <g {...commun}>
        {/* Trait épais invisible : une flèche fine reste difficile à attraper. */}
        <path
          d={`M ${annotation.x} ${annotation.y} L ${x2} ${y2}`}
          stroke="transparent"
          strokeWidth={16}
          fill="none"
        />
        <path
          d={`M ${annotation.x} ${annotation.y} L ${x2} ${y2}`}
          stroke={accent}
          strokeWidth={2.4}
          strokeLinecap="round"
          fill="none"
        />
        <path d={`M ${x2} ${y2} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} Z`} fill={accent} stroke="none" />
        {annotation.text && (
          <text
            x={milieu.x}
            y={milieu.y - 8}
            textAnchor="middle"
            fontSize={11.5}
            fontWeight={600}
            fill={accent}
            paintOrder="stroke"
            stroke="#ffffff"
            strokeWidth={3.4}
            strokeLinejoin="round"
          >
            {annotation.text}
          </text>
        )}
        {selected && editable && (
          <g data-export="false">
            <circle
              cx={annotation.x}
              cy={annotation.y}
              r={5}
              fill="#ffffff"
              stroke={accent}
              strokeWidth={2}
              style={{ cursor: 'crosshair' }}
              onPointerDown={(event) => onHandleDown(event, annotation, 'depart')}
            />
            <circle
              cx={x2}
              cy={y2}
              r={5}
              fill="#ffffff"
              stroke={accent}
              strokeWidth={2}
              style={{ cursor: 'crosshair' }}
              onPointerDown={(event) => onHandleDown(event, annotation, 'arrivee')}
            />
          </g>
        )}
      </g>
    )
  }

  const note = annotation.kind === 'note'
  const taille = note ? 12 : 12.5
  const lignes = wrapText(annotation.text ?? '', annotation.w - (note ? 26 : 24), taille)
  const hauteurLigne = taille * 1.35

  return (
    <g {...commun}>
      <rect
        x={annotation.x}
        y={annotation.y}
        width={annotation.w}
        height={annotation.h}
        rx={note ? 8 : 14}
        fill={note ? fill : accent}
        fillOpacity={note ? 1 : 0.05}
        stroke={accent}
        strokeWidth={note ? 1.2 : 1.8}
        strokeDasharray={note ? undefined : '10 7'}
      />
      {note && (
        // Bande de couleur à gauche : la note se repère au premier coup d'œil, même imprimée
        // en noir et blanc où la teinte de fond disparaît.
        <path
          d={`M ${annotation.x + 3.5} ${annotation.y + 3} L ${annotation.x + 3.5} ${annotation.y + annotation.h - 3}`}
          stroke={accent}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
      )}
      {note ? (
        <text fontSize={taille} fill="#1e293b">
          {lignes.slice(0, Math.max(1, Math.floor((annotation.h - 14) / hauteurLigne))).map((ligne, index) => (
            <tspan
              key={index}
              x={annotation.x + 15}
              y={annotation.y + 20 + index * hauteurLigne}
            >
              {ligne}
            </tspan>
          ))}
        </text>
      ) : (
        <>
          <rect
            x={annotation.x + 12}
            y={annotation.y - 9}
            width={Math.min(annotation.w - 24, Math.max(40, (annotation.text ?? '').length * 6.6 + 16))}
            height={18}
            rx={9}
            fill="#ffffff"
            stroke={accent}
            strokeWidth={1.2}
          />
          <text
            x={annotation.x + 20}
            y={annotation.y + 4}
            fontSize={11.5}
            fontWeight={600}
            fill={accent}
          >
            {annotation.text}
          </text>
        </>
      )}
      {selected && (
        <rect
          data-export="false"
          x={annotation.x - 3}
          y={annotation.y - 3}
          width={annotation.w + 6}
          height={annotation.h + 6}
          rx={note ? 10 : 16}
          fill="none"
          stroke="#2563eb"
          strokeWidth={1.6}
          strokeDasharray="5 4"
          pointerEvents="none"
        />
      )}
      {selected && editable && (
        <rect
          data-export="false"
          x={annotation.x + annotation.w - 6}
          y={annotation.y + annotation.h - 6}
          width={12}
          height={12}
          rx={3}
          fill="#ffffff"
          stroke="#2563eb"
          strokeWidth={1.8}
          style={{ cursor: 'nwse-resize' }}
          onPointerDown={(event) => onHandleDown(event, annotation, 'taille')}
        />
      )}
    </g>
  )
}
