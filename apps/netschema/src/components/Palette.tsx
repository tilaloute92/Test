import { useMemo, useState } from 'react'
import { deviceMeta, familyGroups, LINKS, searchDevices, type DeviceMeta } from '../lib/catalog'
import { DRAG_MIME } from '../lib/dnd'
import { DeviceIcon } from '../lib/icons'
import { GRID, useDiagram } from '../store/useDiagram'
import type { DeviceKind, LinkKind } from '../types'

/** Familles ouvertes par défaut : les plus utilisées en premier. */
const OPEN_BY_DEFAULT = 4

export function Palette() {
  const addNode = useDiagram((s) => s.addNode)
  const catalogRevision = useDiagram((s) => s.catalogRevision)
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    void catalogRevision
    return familyGroups()
  }, [catalogRevision])

  const results = useMemo(() => {
    void catalogRevision
    return query.trim() ? searchDevices(query).slice(0, 40) : null
  }, [query, catalogRevision])

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

  const toggle = (title: string) =>
    setClosed((current) => {
      const next = new Set(current)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })

  const isOpen = (title: string, index: number) =>
    query.trim() ? true : !closed.has(title) && (index < OPEN_BY_DEFAULT || closed.has(`!${title}`) === false)

  const total = groups.reduce((acc, group) => acc + group.devices.length, 0)

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white">
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-3 pt-3 pb-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher : k8s, waf, sd-wan…"
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
        <p className="pt-1.5 text-[11px] leading-snug text-slate-400">
          {query.trim()
            ? `${results?.length ?? 0} type(s) trouvé(s)`
            : `${total} types — glissez sur le plan ou cliquez`}
        </p>
      </div>

      {results ? (
        <div className="flex flex-col gap-1 px-3 py-2">
          {results.map((device) => (
            <DeviceButton key={device.id} device={device} onAdd={addAtViewportCenter} showFamily />
          ))}
          {results.length === 0 && (
            <p className="px-1 py-3 text-[12px] text-slate-400">
              Aucun type ne correspond. Vous pouvez en créer un dans l’onglet Catalogue.
            </p>
          )}
        </div>
      ) : (
        groups.map((group, index) => {
          const open = isOpen(group.title, index) && !closed.has(group.title)
          return (
            <section key={group.title} className="px-3 pt-2">
              <button
                type="button"
                onClick={() => toggle(group.title)}
                className="flex w-full items-center justify-between px-1 py-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600"
              >
                {group.title}
                <span className="text-slate-300">{open ? '−' : `+${group.devices.length}`}</span>
              </button>
              {open && (
                <div className="flex flex-col gap-1 pb-1">
                  {group.devices.map((device) => (
                    <DeviceButton key={device.id} device={device} onAdd={addAtViewportCenter} />
                  ))}
                </div>
              )}
            </section>
          )
        })
      )}

      <section className="mt-4 border-t border-slate-100 px-4 py-4">
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
        <h3 className="pt-3 pb-1.5 text-[11px] font-semibold text-slate-400">Conventions HA</h3>
        <ul className="flex flex-col gap-1 text-[11px] leading-snug text-slate-500">
          <li>
            <span className="font-semibold text-emerald-700">ACTIF</span> /{' '}
            <span className="font-semibold text-slate-600">PASSIF</span> /{' '}
            <span className="font-semibold text-blue-700">A/A</span> /{' '}
            <span className="font-semibold text-yellow-700">QUORUM</span> — rôle dans la grappe
          </li>
          <li>
            <span className="font-semibold text-yellow-700">⚡ A/B</span> — double alimentation électrique
          </li>
          <li>Cadre rose — grappe HA et son adresse virtuelle</li>
          <li>Pastille rouge — point de défaillance unique détecté</li>
        </ul>
      </section>
    </aside>
  )
}

function DeviceButton({
  device,
  onAdd,
  showFamily,
}: {
  device: DeviceMeta
  onAdd: (kind: DeviceKind) => void
  showFamily?: boolean
}) {
  const meta = deviceMeta(device.id)
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_MIME, device.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => onAdd(device.id)}
      title={[device.label, ...(device.aliases ?? [])].join(' · ')}
      className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-[13px] text-slate-700 hover:border-slate-200 hover:bg-slate-50 active:cursor-grabbing"
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: meta.fill, border: `1px solid ${meta.accent}33` }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24">
          <DeviceIcon icon={meta.icon} color={meta.accent} />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block truncate">{device.label}</span>
        {showFamily && <span className="block truncate text-[10px] text-slate-400">{device.family}</span>}
      </span>
    </button>
  )
}
