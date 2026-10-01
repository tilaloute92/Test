import { useMemo, useRef } from 'react'
import { deviceMeta } from '../lib/catalog'
import type { DisplayNode } from '../lib/derive'
import type { ViewState } from '../store/useDiagram'
import { NODE_H, NODE_W, type NetLink } from '../types'

/** Encombrement de la vignette à l'écran, marge intérieure comprise. */
const LARGEUR = 208
const HAUTEUR = 144
const MARGE = 8

interface Cadrage {
  echelle: number
  dx: number
  dy: number
}

/** Coordonnée du schéma vers coordonnée de la vignette. */
function projeter(cadrage: Cadrage, x: number, y: number) {
  return { x: x * cadrage.echelle + cadrage.dx, y: y * cadrage.echelle + cadrage.dy }
}

interface Props {
  nodes: DisplayNode[]
  links: NetLink[]
  selection: string[]
  view: ViewState
  canvasSize: { width: number; height: number }
  setView: (patch: Partial<ViewState>) => void
  onClose: () => void
}

/**
 * Minicarte : la vue d'ensemble d'un schéma plus grand que l'écran.
 *
 * Passé une trentaine d'équipements, on travaille à 40 % de zoom pour tout voir, ou bien
 * zoomé et perdu. La minicarte lève le dilemme : elle montre le plan entier en vignette,
 * encadre la portion visible, et se laisse cliquer pour s'y rendre. C'est l'outil de
 * navigation de tous les éditeurs de plans, et ce qui manquait le plus ici.
 *
 * Le cadre du champ visible suit la vue, donc bouge à chaque molette. La vignette, elle, ne
 * dépend que du schéma : on la mémoïse à part pour que le survol du cadre ne redessine pas
 * deux cents boîtes.
 */
export function Minimap({ nodes, links, selection, view, canvasSize, setView, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const glisse = useRef(false)

  /** Le champ visible, en coordonnées du schéma. */
  const champ = useMemo(
    () => ({
      x: -view.tx / view.zoom,
      y: -view.ty / view.zoom,
      w: canvasSize.width / view.zoom,
      h: canvasSize.height / view.zoom,
    }),
    [canvasSize.height, canvasSize.width, view.tx, view.ty, view.zoom],
  )

  /*
    Le cadrage ne dépend que du schéma, jamais de la vue. C'est ce qui rend la vignette
    gratuite au zoom : la faire dépendre du champ visible — pour englober aussi les
    déplacements hors du plan — la faisait redessiner ses deux cents boîtes à chaque cran de
    molette, soit une dizaine de millisecondes par image reprises à ce qu'on venait de gagner.
    Le cadre du champ visible est donc borné à la vignette (voir plus bas).
  */
  const cadrage = useMemo(() => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of nodes) {
      minX = Math.min(minX, node.x - NODE_W / 2)
      minY = Math.min(minY, node.y - NODE_H / 2)
      maxX = Math.max(maxX, node.x + NODE_W / 2)
      maxY = Math.max(maxY, node.y + NODE_H / 2)
    }
    if (!Number.isFinite(minX)) return { echelle: 1, dx: LARGEUR / 2, dy: HAUTEUR / 2 }
    const largeur = Math.max(1, maxX - minX)
    const hauteur = Math.max(1, maxY - minY)
    const echelle = Math.min((LARGEUR - MARGE * 2) / largeur, (HAUTEUR - MARGE * 2) / hauteur)
    return {
      echelle,
      // Décalage qui centre le contenu dans la vignette.
      dx: (LARGEUR - largeur * echelle) / 2 - minX * echelle,
      dy: (HAUTEUR - hauteur * echelle) / 2 - minY * echelle,
    }
  }, [nodes])

  /** Amener au centre de l'écran le point du schéma désigné dans la vignette. */
  const allerVers = (event: React.PointerEvent<SVGSVGElement>) => {
    const boite = svgRef.current?.getBoundingClientRect()
    if (!boite) return
    const monde = {
      x: (event.clientX - boite.x - cadrage.dx) / cadrage.echelle,
      y: (event.clientY - boite.y - cadrage.dy) / cadrage.echelle,
    }
    setView({
      tx: canvasSize.width / 2 - monde.x * view.zoom,
      ty: canvasSize.height / 2 - monde.y * view.zoom,
    })
  }

  const selectionnes = useMemo(() => new Set(selection), [selection])

  /*
    La vignette ne dépend pas de la vue : elle ne change que si le schéma change ou si le
    cadrage bouge. C'est ce qui permet de faire glisser le cadre sans redessiner le plan.
  */
  const vignette = useMemo(() => {
    const centres = new Map(nodes.map((node) => [node.id, projeter(cadrage, node.x, node.y)]))
    return (
      <>
        <g stroke="#94a3b8" strokeWidth={0.6} opacity={0.75}>
          {links.map((link) => {
            const de = centres.get(link.from)
            const vers = centres.get(link.to)
            if (!de || !vers) return null
            return <line key={link.id} x1={de.x} y1={de.y} x2={vers.x} y2={vers.y} />
          })}
        </g>
        {nodes.map((node) => {
          const meta = deviceMeta(node.kind)
          const coin = projeter(cadrage, node.x - NODE_W / 2, node.y - NODE_H / 2)
          const w = Math.max(2.5, NODE_W * cadrage.echelle)
          const h = Math.max(2, NODE_H * cadrage.echelle)
          const retenu = selectionnes.has(node.id)
          return (
            <rect
              key={node.id}
              x={coin.x}
              y={coin.y}
              width={w}
              height={h}
              rx={Math.min(1.5, w / 3)}
              fill={retenu ? '#2563eb' : meta.accent}
              opacity={retenu ? 1 : 0.85}
            />
          )
        })}
      </>
    )
  }, [nodes, links, cadrage, selectionnes])

  /*
    Le cadre du champ visible, ramené dans la vignette. Quand on s'est déplacé hors du nuage
    d'équipements, il s'aplatit contre le bord : il dit alors de quel côté l'on a dérivé, et
    un clic ramène sur le plan. Il se dessine en pointillé pour qu'on ne le lise pas comme une
    position exacte.
  */
  const cadreChamp = useMemo(() => {
    const a = projeter(cadrage, champ.x, champ.y)
    const b = projeter(cadrage, champ.x + champ.w, champ.y + champ.h)
    const x = Math.max(0, Math.min(LARGEUR - 4, a.x))
    const y = Math.max(0, Math.min(HAUTEUR - 4, a.y))
    return {
      x,
      y,
      w: Math.max(4, Math.min(LARGEUR, b.x) - x),
      h: Math.max(4, Math.min(HAUTEUR, b.y) - y),
      // Débordement : le champ visible sort de ce que la vignette couvre.
      partiel: a.x < -0.5 || a.y < -0.5 || b.x > LARGEUR + 0.5 || b.y > HAUTEUR + 0.5,
    }
  }, [cadrage, champ.h, champ.w, champ.x, champ.y])

  return (
    <div
      data-export="false"
      data-minicarte
      className="absolute bottom-4 left-4 overflow-hidden rounded-lg bg-white/95 shadow-md ring-1 ring-slate-200"
      style={{ width: LARGEUR }}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-2 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Vue d’ensemble</span>
        <button
          type="button"
          onClick={onClose}
          title="Masquer la minicarte"
          className="rounded px-1 text-[13px] leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          ×
        </button>
      </div>
      <svg
        ref={svgRef}
        width={LARGEUR}
        height={HAUTEUR}
        className="block cursor-pointer touch-none select-none bg-slate-50"
        onPointerDown={(event) => {
          glisse.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          allerVers(event)
        }}
        onPointerMove={(event) => {
          if (glisse.current) allerVers(event)
        }}
        onPointerUp={() => {
          glisse.current = false
        }}
        onPointerCancel={() => {
          glisse.current = false
        }}
      >
        {vignette}
        {/* Champ visible : ce que l'on a sous les yeux, à sa place dans l'ensemble. */}
        <rect
          x={cadreChamp.x}
          y={cadreChamp.y}
          width={cadreChamp.w}
          height={cadreChamp.h}
          rx={2}
          fill="#2563eb"
          fillOpacity={cadreChamp.partiel ? 0.04 : 0.08}
          stroke="#2563eb"
          strokeWidth={1.2}
          strokeDasharray={cadreChamp.partiel ? '3 2' : undefined}
          pointerEvents="none"
        />
      </svg>
    </div>
  )
}
