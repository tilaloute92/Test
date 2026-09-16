import { LINKS } from '../lib/catalog'
import { linkEnd, linkLayers } from '../lib/osi'
import type { NetLink, NetNode, PortMode, StpRole } from '../types'

/**
 * Info-bulle d'une liaison.
 *
 * Le schéma n'affiche qu'une partie de ce qu'une liaison documente — c'est ce qui le rend
 * lisible. L'info-bulle donne le reste au survol, sans rien déplacer ni ouvrir : type, débit,
 * couches, et la configuration de chaque extrémité côte à côte, qui est la façon dont on lit
 * un lien quand on le dépanne.
 */

const MODE_LABEL: Record<PortMode, string> = { access: 'Accès', trunk: 'Trunk' }

const STP_LABEL: Record<StpRole, string> = {
  root: 'vers la racine',
  designated: 'désigné',
  alternate: 'alternatif',
  blocking: 'bloquant',
  edge: 'port d’extrémité',
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-2 text-[11.5px] leading-snug">
      <span className="w-24 shrink-0 text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 break-words font-medium text-slate-800">{value}</span>
    </div>
  )
}

function EndColumn({ title, link, end }: { title: string; link: NetLink; end: 'a' | 'b' }) {
  const config = linkEnd(link, end)
  const vlans = config.vlans
  const mode = config.mode ? MODE_LABEL[config.mode] : undefined
  return (
    <div className="min-w-0 flex-1 rounded-lg bg-slate-50 p-2">
      <p className="truncate pb-1 text-[11px] font-semibold text-slate-700">{title}</p>
      <div className="flex flex-col gap-0.5 text-[11px] leading-snug text-slate-600">
        {config.port && (
          <p>
            <span className="text-slate-400">Port </span>
            <span className="font-medium text-slate-800">{config.port}</span>
          </p>
        )}
        {(mode || vlans) && <p>{[mode, vlans ? `VLAN ${vlans}` : null].filter(Boolean).join(' · ')}</p>}
        {config.nativeVlan && <p>VLAN natif {config.nativeVlan}</p>}
        {config.lag && <p>Agrégat {config.lag}</p>}
        {config.stp && <p>STP {STP_LABEL[config.stp]}</p>}
        {config.ip && <p>IP {config.ip}</p>}
        {!config.port && !mode && !vlans && !config.lag && !config.stp && !config.ip && (
          <p className="text-slate-400">non documenté</p>
        )}
      </div>
    </div>
  )
}

export function LinkTooltip({
  link,
  from,
  to,
  x,
  y,
  width,
  height,
}: {
  link: NetLink
  from?: NetNode
  to?: NetNode
  /** Position du pointeur, en pixels dans le plan de travail. */
  x: number
  y: number
  /** Taille du plan de travail, pour que la bulle reste à l'intérieur. */
  width: number
  height: number
}) {
  const meta = LINKS[link.kind]
  const layers = linkLayers(link)
  const BOX = { w: 340, h: 250 }
  // La bulle bascule du côté où il reste de la place, et ne sort jamais du cadre.
  const left = x + 16 + BOX.w > width ? Math.max(8, x - 16 - BOX.w) : x + 16
  const top = Math.min(Math.max(8, y - 20), Math.max(8, height - BOX.h))

  return (
    <div
      data-export="false"
      className="pointer-events-none absolute z-40 w-[340px] rounded-xl bg-white/98 p-3 shadow-xl ring-1 ring-slate-200"
      style={{ left, top }}
    >
      <div className="flex items-center gap-2 pb-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-900">
          {from?.name ?? '?'} <span className="text-slate-400">→</span> {to?.name ?? '?'}
        </p>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {layers.map((layer) => layer.toUpperCase()).join(' ')}
        </span>
      </div>

      <div className="flex flex-col gap-0.5 border-t border-slate-100 pt-1.5">
        <Row label="Type" value={meta.label} />
        <Row label="Débit" value={link.speed} />
        <Row label="Libellé" value={link.label} />
        <Row label="Sous-réseau" value={link.subnet} />
        <Row label="VRF" value={link.vrf} />
        <Row label="Routage" value={link.routing?.toUpperCase()} />
        <Row label="MTU" value={link.mtu ? String(link.mtu) : undefined} />
        <Row label="Secours" value={link.redundant ? 'liaison de secours' : undefined} />
      </div>

      <div className="flex gap-2 pt-2">
        <EndColumn title={from?.name ?? 'Départ'} link={link} end="a" />
        <EndColumn title={to?.name ?? 'Arrivée'} link={link} end="b" />
      </div>
    </div>
  )
}
