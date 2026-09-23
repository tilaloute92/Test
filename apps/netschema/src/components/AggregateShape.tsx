import type { Agregat, OvaleAgregat } from '../lib/aggregates'
import { formaterDebit, libelleAgregat, MODES_LACP } from '../lib/aggregates'

/**
 * Matérialisation d'un agrégat de liens.
 *
 * La convention de dessin réseau est constante depuis les premiers EtherChannel : les brins
 * membres sont **encerclés d'un ovale** portant le nom du bundle. C'est ce qui distingue, à
 * l'œil, deux câbles indépendants — que le spanning-tree arbitrera, donc un seul actif — d'un
 * port-channel, qui est un lien logique unique dont les débits s'additionnent.
 *
 * L'ovale est tracé en attributs de présentation, sans classe : il doit sortir intact dans
 * le SVG exporté.
 */
export function AggregateShape({
  agregat,
  ovale,
  surbrillance,
  details,
  editable,
  onSelect,
  onRingDown,
  onLabelDown,
  onReset,
  onRename,
}: {
  agregat: Agregat
  ovale: OvaleAgregat
  surbrillance: boolean
  /** Débit du faisceau sur l'étiquette, comme les autres débits du schéma. */
  details: boolean
  /** Faux sur un schéma verrouillé ou une projection : l'ovale se lit, il ne se manipule pas. */
  editable: boolean
  onSelect?: () => void
  /** Glisser l'anneau : l'ovale coulisse le long du faisceau. */
  onRingDown?: (event: React.PointerEvent<SVGEllipseElement>) => void
  /** Glisser l'étiquette : elle se pose où l'on veut autour de l'ovale. */
  onLabelDown?: (event: React.PointerEvent<SVGGElement>) => void
  /** Double-clic : retour au placement calculé. */
  onReset?: () => void
  /** Double-clic sur l'étiquette : renommer le port-channel. */
  onRename?: () => void
}) {
  const alerte = agregat.reserves.length > 0
  const couleur = alerte ? '#b45309' : surbrillance ? '#1d4ed8' : '#334155'
  const mode = MODES_LACP.find((item) => item.value === agregat.mode)

  const texte = libelleAgregat(agregat, details || surbrillance)
  const rotation = `rotate(${ovale.angle.toFixed(2)} ${ovale.cx.toFixed(2)} ${ovale.cy.toFixed(2)})`
  const largeur = texte.length * 5 + 12
  const hauteur = 14

  return (
    <g
      data-agregat={agregat.id}
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
      onPointerDown={(event) => {
        if (!onSelect) return
        // Sans cela, le fond du plan démarre un lasso et vide la sélection au relâchement.
        event.stopPropagation()
        onSelect()
      }}
    >
      <title>
        {`Agrégat ${agregat.nom} — ${agregat.membres.length} brins${
          agregat.debitTotal ? `, ${formaterDebit(agregat.debitTotal)} cumulés` : ''
        }${mode ? `, ${mode.court}` : ''}${agregat.multiChassis ? ', réparti sur deux châssis' : ''}${
          alerte ? `\n${agregat.reserves.join('\n')}` : ''
        }${
          editable
            ? '\n\nGlisser l’anneau pour le faire coulisser sur le faisceau, l’étiquette pour la déplacer.\nDouble-clic sur l’anneau : replacement automatique. Sur l’étiquette : renommer.'
            : ''
        }`}
      </title>
      {/*
        Un anneau d'un pixel et demi ne s'attrape pas à la souris : on double le tracé d'une
        piste transparente, comme pour les liaisons. Elle ne se voit pas et ne s'exporte pas —
        elle sert uniquement de prise.
      */}
      {editable && (
        <ellipse
          data-export="false"
          cx={ovale.cx}
          cy={ovale.cy}
          rx={ovale.rx}
          ry={ovale.ry}
          transform={rotation}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          // Le trait est invisible : sans cela le navigateur ne le considère pas comme
          // « peint » et ne le teste pas au pointeur.
          pointerEvents="stroke"
          style={{ cursor: 'grab' }}
          onPointerDown={onRingDown}
          onDoubleClick={(event) => {
            event.stopPropagation()
            onReset?.()
          }}
        />
      )}
      <ellipse
        cx={ovale.cx}
        cy={ovale.cy}
        rx={ovale.rx}
        ry={ovale.ry}
        transform={rotation}
        fill="none"
        stroke={couleur}
        strokeWidth={surbrillance ? 2 : 1.4}
        strokeDasharray={agregat.mode === 'static' ? '5 3' : undefined}
        pointerEvents="none"
      />
      <g
        transform={`translate(${ovale.labelX.toFixed(2)} ${ovale.labelY.toFixed(2)})`}
        style={{ cursor: editable ? 'move' : undefined }}
        onPointerDown={editable ? onLabelDown : undefined}
        onDoubleClick={
          editable
            ? (event) => {
                event.stopPropagation()
                onRename?.()
              }
            : undefined
        }
      >
        <rect
          x={-largeur / 2}
          y={-hauteur / 2}
          width={largeur}
          height={hauteur}
          rx={3}
          fill="#ffffff"
          stroke={couleur}
          strokeWidth={0.8}
          opacity={0.95}
        />
        <text textAnchor="middle" y={3.2} fontSize={9} fontWeight={700} fill={couleur}>
          {texte}
        </text>
      </g>
    </g>
  )
}
