import { deviceMeta, LINKS, ROLES } from '../lib/catalog'
import { mecanismeHa } from '../lib/haTech'
import type { AssetStatus, NetLink, NetNode } from '../types'

/**
 * Info-bulle d'un équipement.
 *
 * La boîte d'un schéma ne peut pas tout porter sans devenir illisible : elle montre le nom et,
 * selon le mode, l'adresse. Le reste — matériel, garantie, baie, responsable, et surtout ce à
 * quoi l'équipement est relié — s'obtient au survol, sans rien ouvrir ni déplacer.
 */

/** Jour courant, figé au chargement : une comparaison de dates n'a pas à être recalculée à
 *  chaque rendu, et le franchissement de minuit pendant une session ne change rien ici. */
const AUJOURDHUI = new Date().toISOString().slice(0, 10)

const STATUS_LABEL: Record<AssetStatus, string> = {
  production: 'En production',
  stock: 'En stock',
  maintenance: 'En maintenance',
  retire: 'Retiré du service',
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

/** Date au format français, en laissant passer ce qui n'est pas une date. */
function date(value?: string): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('fr-FR')
}

export function NodeTooltip({
  node,
  links,
  nodes,
  x,
  y,
  width,
  height,
}: {
  node: NetNode
  /** Liaisons du schéma : on n'en garde que celles qui touchent l'équipement. */
  links: NetLink[]
  nodes: NetNode[]
  /** Position du pointeur, en pixels dans le plan de travail. */
  x: number
  y: number
  width: number
  height: number
}) {
  const meta = deviceMeta(node.kind)
  const role = node.role && node.role !== 'standalone' ? ROLES[node.role] : undefined
  const voisins = links
    .filter((link) => link.from === node.id || link.to === node.id)
    .map((link) => {
      const autre = nodes.find((item) => item.id === (link.from === node.id ? link.to : link.from))
      const port = link.from === node.id ? link.portA : link.portB
      return {
        id: link.id,
        nom: autre?.name ?? '—',
        detail: [LINKS[link.kind].label, link.speed, port].filter(Boolean).join(' · '),
        couleur: LINKS[link.kind].color,
      }
    })

  const BOX = { w: 320, h: 300 }
  // La bulle bascule du côté où il reste de la place, et ne sort jamais du cadre.
  const left = x + 18 + BOX.w > width ? Math.max(8, x - 18 - BOX.w) : x + 18
  const top = Math.min(Math.max(8, y - 20), Math.max(8, height - BOX.h))

  const garantie = date(node.warrantyEnd)
  const perimee = node.warrantyEnd ? node.warrantyEnd.slice(0, 10) < AUJOURDHUI : false

  return (
    <div
      data-export="false"
      className="pointer-events-none absolute z-40 w-[320px] rounded-xl bg-white/98 p-3 shadow-xl ring-1 ring-slate-200"
      style={{ left, top }}
    >
      <div className="flex items-center gap-2 pb-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.accent }} />
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-900">{node.name}</p>
        {role && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
            style={{ backgroundColor: role.color }}
          >
            {role.badge}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 border-t border-slate-100 pt-1.5">
        <Row label="Type" value={meta.label} />
        <Row label="Adresse IP" value={node.ip} />
        <Row label="VLAN" value={node.vlan} />
        <Row label="Modèle" value={[node.vendor, node.model].filter(Boolean).join(' ')} />
        <Row label="N° de série" value={node.serial} />
        <Row label="Site" value={node.site} />
        <Row label="Zone" value={node.zone} />
        <Row label="Grappe" value={node.cluster ? `${node.cluster}${node.vip ? ` · VIP ${node.vip}` : ''}` : undefined} />
        <Row label="Bascule" value={mecanismeHa(node.haTech)?.label} />
        <Row
          label="Baie"
          value={node.rack ? `${node.rack}${node.rackUnit ? ` · U${node.rackUnit}` : ''}` : undefined}
        />
        <Row label="Responsable" value={node.owner} />
        <Row label="État" value={node.status ? STATUS_LABEL[node.status] : undefined} />
        <Row label="Puissance" value={node.powerW ? `${node.powerW} W` : undefined} />
        <Row label="Alimentation" value={node.dualPower ? 'Double chaîne A/B' : undefined} />
      </div>

      {garantie && (
        <p className={`pt-1 text-[11px] ${perimee ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
          {perimee ? 'Support expiré le ' : 'Support jusqu’au '}
          {garantie}
        </p>
      )}

      {node.notes && (
        <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900">
          {node.notes}
        </p>
      )}

      <div className="mt-2 border-t border-slate-100 pt-1.5">
        <p className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {voisins.length > 0 ? `Liaisons (${voisins.length})` : 'Aucune liaison'}
        </p>
        <div className="flex flex-col gap-0.5">
          {voisins.slice(0, 6).map((voisin) => (
            <div key={voisin.id} className="flex items-center gap-2 text-[11px] leading-snug">
              <span className="h-1.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: voisin.couleur }} />
              <span className="shrink-0 font-medium text-slate-800">{voisin.nom}</span>
              <span className="min-w-0 flex-1 truncate text-slate-500">{voisin.detail}</span>
            </div>
          ))}
          {voisins.length > 6 && (
            <p className="pt-0.5 text-[11px] text-slate-400">et {voisins.length - 6} autre(s)…</p>
          )}
        </div>
      </div>
    </div>
  )
}
