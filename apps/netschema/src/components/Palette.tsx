import { DEVICES, LINKS, PALETTE_GROUPS } from '../lib/catalog'
import { DRAG_MIME } from '../lib/dnd'
import { DeviceIcon } from '../lib/icons'
import { GRID, useDiagram } from '../store/useDiagram'
import type { DeviceKind, LinkKind } from '../types'

export function Palette() {
  const addNode = useDiagram((s) => s.addNode)

  /** Ajout au clic : l'équipement apparaît au centre de la zone visible. */
  const addAtViewportCenter = (kind: DeviceKind) => {
    const { view, canvasSize, snap } = useDiagram.getState()
    const raw = {
      x: (canvasSize.width / 2 - view.tx) / view.zoom,
      y: (canvasSize.height / 2 - view.ty) / view.zoom,
    }
    const x = snap ? Math.round(raw.x / GRID) * GRID : Math.round(raw.x)
    const y = snap ? Math.round(raw.y / GRID) * GRID : Math.round(raw.y)
    addNode(kind, x, y)
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">
      <div className="px-4 pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Équipements</h2>
        <p className="mt-1 text-[11px] leading-snug text-slate-400">
          Glissez sur le plan ou cliquez pour ajouter au centre.
        </p>
      </div>

      {PALETTE_GROUPS.map((group) => (
        <section key={group.title} className="px-3 pt-4">
          <h3 className="px-1 pb-1.5 text-[11px] font-semibold text-slate-400">{group.title}</h3>
          <div className="flex flex-col gap-1">
            {group.kinds.map((kind) => {
              const meta = DEVICES[kind]
              return (
                <button
                  key={kind}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_MIME, kind)
                    event.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => addAtViewportCenter(kind)}
                  className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-[13px] text-slate-700 hover:border-slate-200 hover:bg-slate-50 active:cursor-grabbing"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: meta.fill, border: `1px solid ${meta.accent}33` }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24">
                      <DeviceIcon kind={kind} color={meta.accent} />
                    </svg>
                  </span>
                  {meta.label}
                </button>
              )
            })}
          </div>
        </section>
      ))}

      <section className="mt-5 border-t border-slate-100 px-4 py-4">
        <h3 className="pb-2 text-[11px] font-semibold text-slate-400">Légende des liaisons</h3>
        <ul className="flex flex-col gap-1.5">
          {(Object.keys(LINKS) as LinkKind[]).map((kind) => {
            const meta = LINKS[kind]
            return (
              <li key={kind} className="flex items-center gap-2 text-[11px] text-slate-600">
                <svg width="28" height="8" aria-hidden>
                  <line
                    x1="1"
                    y1="4"
                    x2="27"
                    y2="4"
                    stroke={meta.color}
                    strokeWidth={meta.width}
                    strokeDasharray={meta.dash}
                    strokeLinecap="round"
                  />
                </svg>
                {meta.label}
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-[11px] leading-snug text-slate-400">
          Pointillés larges = liaison de secours.
        </p>
      </section>
    </aside>
  )
}
