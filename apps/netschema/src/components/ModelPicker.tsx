import { useMemo, useRef, useState } from 'react'
import { deviceMeta } from '../lib/catalog'
import { searchModels, type HardwareModel } from '../lib/vendors'
import type { NetNode } from '../types'

interface Props {
  node: NetNode
  /** Applique le matériel choisi (constructeur, modèle, hauteur, puissance). */
  onPick: (patch: Partial<NetNode>) => void
  /** Vrai dans la table d'inventaire : champ compact, sans bordure au repos. */
  compact?: boolean
  /** Aligne aussi le type d'équipement sur celui du matériel choisi. */
  alignKind?: boolean
}

/**
 * Choix d'un matériel constructeur : on tape « r660 », « fortigate », « nutanix » et la
 * fiche se remplit — constructeur, modèle, hauteur en baie et consommation indicative.
 * La saisie libre reste possible : la base sert d'aide, pas de contrainte.
 */
export function ModelPicker({ node, onPick, compact, alignKind }: Props) {
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const text = query ?? node.model ?? ''
  const results = useMemo(() => (open ? searchModels(text, node.kind, 14) : []), [open, text, node.kind])

  const apply = (item: HardwareModel) => {
    clearTimeout(blurTimer.current)
    onPick({
      vendor: item.vendor,
      model: item.model,
      heightU: item.heightU ?? node.heightU,
      powerW: item.powerW ?? node.powerW,
      ...(alignKind && item.kind !== node.kind ? { kind: item.kind } : {}),
    })
    setQuery(null)
    setOpen(false)
  }

  return (
    <span className="relative block">
      <input
        value={text}
        placeholder="Modèle — tapez « r660 », « fortigate »…"
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          onPick({ model: event.target.value })
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => {
            setOpen(false)
            setQuery(null)
          }, 150)
        }}
        className={
          compact
            ? 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 outline-none hover:border-slate-200 focus:border-blue-500 focus:bg-white'
            : 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
        }
      />

      {open && results.length > 0 && (
        <ul className="absolute left-0 top-full z-30 mt-1 max-h-64 w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {results.map((item) => (
            <li key={`${item.vendor}-${item.model}`}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => apply(item)}
                className="flex w-full flex-col px-2.5 py-1.5 text-left hover:bg-blue-50"
              >
                <span className="text-[12px] text-slate-800">
                  <span className="font-semibold">{item.vendor}</span> — {item.model}
                </span>
                <span className="text-[10.5px] text-slate-400">
                  {[
                    deviceMeta(item.kind).label,
                    item.heightU ? `${item.heightU} U` : null,
                    item.powerW ? `${item.powerW} W` : null,
                    item.spec,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
