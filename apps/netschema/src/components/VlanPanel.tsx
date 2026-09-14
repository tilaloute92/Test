import { useMemo, useState } from 'react'
import { Btn, Checkbox, Field, TextInput } from './ui'
import type { Severity } from '../lib/ha'
import { checkOsi, LAYER_LABELS_OSI, usedVlans, vlanColor } from '../lib/osi'
import { useDiagram } from '../store/useDiagram'
import type { OsiView, VlanDef } from '../types'

const SEVERITY_DOT: Record<Severity, string> = {
  critique: '#dc2626',
  avertissement: '#d97706',
  info: '#2563eb',
}

const VIEWS: { value: OsiView; label: string; hint: string }[] = [
  { value: 'all', label: 'Toutes', hint: 'Tout le schéma' },
  { value: 'l1', label: 'L1', hint: LAYER_LABELS_OSI.l1 },
  { value: 'l2', label: 'L2', hint: LAYER_LABELS_OSI.l2 },
  { value: 'l3', label: 'L3', hint: LAYER_LABELS_OSI.l3 },
]

/**
 * Niveaux 2 et 3 : la vue OSI affichée, le plan d'adressage (VLAN, sous-réseaux,
 * passerelles) et les contrôles de cohérence qui en découlent.
 */
export function VlanPanel() {
  const diagram = useDiagram((s) => s.diagram)
  const osi = useDiagram((s) => s.osi)
  const setOsi = useDiagram((s) => s.setOsi)
  const strictOsi = useDiagram((s) => s.strictOsi)
  const setStrictOsi = useDiagram((s) => s.setStrictOsi)
  const upsertVlan = useDiagram((s) => s.upsertVlan)
  const removeVlan = useDiagram((s) => s.removeVlan)
  const deduce = useDiagram((s) => s.deduceVlansFromDiagram)
  const select = useDiagram((s) => s.select)
  const notify = useDiagram((s) => s.notify)

  const [draft, setDraft] = useState({ id: '', name: '', subnet: '', gateway: '' })

  const vlans = diagram.vlans ?? []
  const usage = useMemo(() => usedVlans(diagram), [diagram])
  const findings = useMemo(() => checkOsi(diagram), [diagram])

  const add = () => {
    const id = draft.id.trim()
    if (!id) return
    upsertVlan({
      id,
      name: draft.name.trim() || undefined,
      subnet: draft.subnet.trim() || undefined,
      gateway: draft.gateway.trim() || undefined,
    })
    setDraft({ id: '', name: '', subnet: '', gateway: '' })
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Vue OSI</h2>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {VIEWS.map((view) => (
            <button
              key={view.value}
              type="button"
              title={view.hint}
              onClick={() => setOsi(view.value)}
              className={`flex-1 rounded-md px-1 py-1.5 text-[11px] font-medium transition ${
                osi === view.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>
        <p className="pt-1.5 text-[11px] leading-snug text-slate-400">
          {osi === 'all' ? 'Toutes les couches sont affichées.' : LAYER_LABELS_OSI[osi]} — les
          libellés des liaisons s’adaptent : ports et débits en L1, VLAN et agrégats en L2,
          sous-réseaux et routage en L3.
        </p>
        {osi !== 'all' && (
          <div className="pt-1.5">
            <Checkbox
              checked={strictOsi}
              onChange={setStrictOsi}
              label="Masquer ce qui n’est pas de cette couche"
            />
          </div>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between pb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Plan d’adressage ({vlans.length})
          </h2>
          <button
            type="button"
            onClick={() => {
              const added = deduce()
              notify(added > 0 ? `${added} VLAN ajouté(s) depuis le schéma.` : 'Aucun nouveau VLAN trouvé.')
            }}
            className="text-[11px] text-blue-600 hover:underline"
          >
            déduire du schéma
          </button>
        </div>

        <ul className="flex flex-col gap-1.5">
          {vlans.map((vlan) => (
            <VlanRow
              key={vlan.id}
              vlan={vlan}
              used={(usage.get(vlan.id)?.nodes.length ?? 0) + (usage.get(vlan.id)?.links.length ?? 0)}
              onChange={upsertVlan}
              onRemove={() => removeVlan(vlan.id)}
            />
          ))}
          {vlans.length === 0 && (
            <li className="rounded-lg bg-slate-50 p-2.5 text-[11px] leading-snug text-slate-500">
              Aucun VLAN déclaré. « Déduire du schéma » reprend ceux déjà cités sur les
              équipements et les liaisons.
            </li>
          )}
        </ul>

        <div className="mt-3 rounded-lg border border-slate-200 p-2.5">
          <p className="pb-1.5 text-[11px] font-semibold text-slate-500">Ajouter un VLAN</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="N° (802.1Q)">
              <TextInput value={draft.id} onChange={(id) => setDraft({ ...draft, id })} placeholder="20" />
            </Field>
            <Field label="Nom">
              <TextInput value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="Bureautique" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Field label="Sous-réseau">
              <TextInput value={draft.subnet} onChange={(subnet) => setDraft({ ...draft, subnet })} placeholder="10.10.20.0/24" />
            </Field>
            <Field label="Passerelle">
              <TextInput value={draft.gateway} onChange={(gateway) => setDraft({ ...draft, gateway })} placeholder="10.10.20.254" />
            </Field>
          </div>
          <div className="pt-2">
            <Btn variant="primary" onClick={add} disabled={!draft.id.trim()}>
              Ajouter
            </Btn>
          </div>
        </div>
      </section>

      <section>
        <h2 className="pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Contrôles L2 / L3 ({findings.length})
        </h2>
        {findings.length === 0 ? (
          <p className="rounded-lg bg-emerald-50 p-3 text-[12px] text-emerald-700">
            Plan d’adressage cohérent : VLAN déclarés, sous-réseaux valides et distincts,
            adresses dans leur sous-réseau.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {findings.map((finding) => (
              <li key={finding.id}>
                <button
                  type="button"
                  onClick={() => select({ nodes: finding.nodeIds, links: finding.linkIds })}
                  className="w-full rounded-lg border border-slate-200 p-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <span className="flex items-start gap-2">
                    <span
                      className="mt-1 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: SEVERITY_DOT[finding.severity] }}
                    />
                    <span>
                      <span className="block text-[12px] font-semibold text-slate-700">{finding.title}</span>
                      <span className="block text-[11px] leading-snug text-slate-500">{finding.detail}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function VlanRow({
  vlan,
  used,
  onChange,
  onRemove,
}: {
  vlan: VlanDef
  used: number
  onChange: (vlan: VlanDef) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const color = vlanColor(vlan.id, [vlan])

  return (
    <li className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">
          <span className="font-semibold">VLAN {vlan.id}</span>
          {vlan.name ? ` — ${vlan.name}` : ''}
        </span>
        <span className="shrink-0 text-[10px] text-slate-400">{vlan.subnet ?? '—'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-slate-100 p-2">
          <Field label="Nom">
            <TextInput value={vlan.name ?? ''} onChange={(name) => onChange({ ...vlan, name })} />
          </Field>
          <Field label="Sous-réseau (CIDR)">
            <TextInput value={vlan.subnet ?? ''} onChange={(subnet) => onChange({ ...vlan, subnet })} placeholder="10.10.20.0/24" />
          </Field>
          <Field label="Passerelle">
            <TextInput value={vlan.gateway ?? ''} onChange={(gateway) => onChange({ ...vlan, gateway })} />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">{used} utilisation(s) dans le schéma</span>
            <button type="button" onClick={onRemove} className="text-[11px] text-red-600 hover:underline">
              Supprimer
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
