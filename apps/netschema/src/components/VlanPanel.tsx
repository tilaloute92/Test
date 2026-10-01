import { useMemo, useState } from 'react'
import { Btn, Checkbox, Field, TextInput } from './ui'
import type { Severity } from '../lib/ha'
import { checkOsi, LAYER_LABELS_OSI, vlanColor } from '../lib/osi'
import { controlesCoherence } from '../lib/coherence'
import { porteeVlans, resumePortee } from '../lib/vlanReach'
import { USAGES_VLAN, usagesVlans, usageVlan } from '../lib/vlanUsage'
import { EXEMPLE_VLANS, vlansVersCsv } from '../lib/vlanImport'
import { downloadBlob, slugify } from '../lib/exportImage'
import { useDiagram } from '../store/useDiagram'
import type { OsiView, UsageVlan, VlanDef } from '../types'

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
  const importerVlans = useDiagram((s) => s.importerVlans)
  const deduce = useDiagram((s) => s.deduceVlansFromDiagram)
  const select = useDiagram((s) => s.select)
  const notify = useDiagram((s) => s.notify)

  const [draft, setDraft] = useState({ id: '', name: '', subnet: '', gateway: '' })
  const [importOuvert, setImportOuvert] = useState(false)
  const [colle, setColle] = useState('')
  const [rapport, setRapport] = useState<{ resume: string; avertissements: string[] } | null>(null)

  const appliquerImport = (mode: 'merge' | 'replace') => {
    const { ajoutes, completes, format, avertissements } = importerVlans(colle, mode)
    const parts = [
      ajoutes > 0 ? `${ajoutes} VLAN ajouté(s)` : '',
      completes > 0 ? `${completes} complété(s)` : '',
    ].filter(Boolean)
    const resume =
      parts.length > 0
        ? `${parts.join(', ')} — lu comme ${format}.`
        : `Rien d’ajouté : le plan connaissait déjà ces VLAN (lu comme ${format}).`
    setRapport({ resume, avertissements })
    if (ajoutes > 0 || completes > 0) {
      notify(resume)
      setColle('')
    }
  }

  const vlans = diagram.vlans ?? []
  const propagation = useDiagram((s) => s.vlanPropagation)
  const setPropagation = useDiagram((s) => s.setVlanPropagation)
  const portees = useMemo(() => porteeVlans(diagram, propagation), [diagram, propagation])
  const usages = useMemo(() => usagesVlans(diagram, propagation), [diagram, propagation])
  /*
    Deux familles de contrôles, une seule liste : « checkOsi » dit si le plan d'adressage est
    bien formé, « controlesCoherence » dit ce que la configuration produirait sur le terrain.
    L'exploitant ne fait pas la différence — il veut la liste de ce qui cloche, la plus grave
    en premier.
  */
  const findings = useMemo(() => {
    const tous = [...checkOsi(diagram, usages), ...controlesCoherence(diagram, { usages, propagation })]
    const ordre = { critique: 0, avertissement: 1, info: 2 } as const
    return tous.sort((a, b) => ordre[a.severity] - ordre[b.severity] || a.title.localeCompare(b.title))
  }, [diagram, usages, propagation])

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
        {/* Trois actions ne tiennent pas sur la ligne du titre dans un bandeau de 288 px :
            elles prennent leur propre rangée plutôt que de se couper en trois. */}
        <div className="flex flex-col gap-1 pb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Plan d’adressage ({vlans.length})
          </h2>
          <div className="flex items-baseline gap-3">
            <button
              type="button"
              onClick={() => setImportOuvert((ouvert) => !ouvert)}
              className="text-[11px] text-blue-600 hover:underline"
            >
              importer
            </button>
            <button
              type="button"
              disabled={vlans.length === 0}
              onClick={() => {
                downloadBlob(
                  new Blob([vlansVersCsv(vlans)], { type: 'text/csv;charset=utf-8' }),
                  `${slugify(diagram.title)}-vlans.csv`,
                )
                notify(`${vlans.length} VLAN exportés en CSV.`)
              }}
              className="text-[11px] text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
            >
              exporter
            </button>
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
        </div>

        {/*
          Import du plan d'adressage. Il existe presque toujours ailleurs — dans un tableur,
          dans un wiki, dans la sortie d'un « show vlan » — et le retaper est la meilleure
          façon d'y glisser une faute qui se propagera ensuite dans tout le document.
        */}
        {importOuvert && (
          <div className="mb-2 flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50/50 p-2.5">
            <p className="text-[11px] leading-snug text-slate-600">
              Collez un tableau (point-virgule, tabulation, virgule ou Markdown), avec ou sans
              ligne d’en-tête, ou la sortie brute d’un <code>show vlan</code>. Colonnes
              reconnues : numéro, nom, sous-réseau, passerelle, commentaire et usage
              (<i>service</i>, <i>transit</i>, <i>synchro</i> — ou les mots courants :
              interco, HA, heartbeat, prod…). Sans cette colonne, l’usage est déduit du schéma.
            </p>
            <textarea
              value={colle}
              onChange={(event) => setColle(event.target.value)}
              spellCheck={false}
              placeholder={EXEMPLE_VLANS}
              className="h-28 w-full resize-none rounded-md border border-slate-200 p-2 font-mono text-[11px] leading-snug outline-none focus:border-blue-500"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Btn
                variant="primary"
                disabled={colle.trim().length === 0}
                onClick={() => appliquerImport('merge')}
              >
                Compléter le plan
              </Btn>
              <Btn disabled={colle.trim().length === 0} onClick={() => appliquerImport('replace')}>
                Remplacer
              </Btn>
              <button
                type="button"
                onClick={() => setColle(EXEMPLE_VLANS)}
                className="text-[11px] text-blue-600 hover:underline"
              >
                exemple
              </button>
            </div>
            {rapport && (
              <div className="rounded-md bg-white p-2 text-[11px] leading-snug text-slate-600">
                <p className="font-medium text-slate-700">{rapport.resume}</p>
                {rapport.avertissements.slice(0, 5).map((avertissement) => (
                  <p key={avertissement} className="pt-0.5 text-amber-700">
                    ⚠ {avertissement}
                  </p>
                ))}
                {rapport.avertissements.length > 5 && (
                  <p className="pt-0.5 text-slate-400">
                    … et {rapport.avertissements.length - 5} autre(s).
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/*
          Un VLAN déclaré sur le cœur de réseau ne s'arrête pas au cœur : il atteint tout ce
          que les trunks desservent. C'est ce que compte la portée, et ce que montrent les
          vues logiques.
        */}
        <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-lg bg-slate-50 p-2 text-[11px] leading-snug text-slate-600">
          <input
            type="checkbox"
            checked={propagation}
            onChange={(event) => setPropagation(event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-blue-600"
          />
          <span>
            <b className="text-slate-700">Suivre les VLAN sur les trunks.</b> Un VLAN déclaré
            sur un commutateur atteint ses voisins par les liaisons en mode trunk, tant que la
            liste des VLAN autorisés ne l'en empêche pas. Décochez pour ne compter que ce qui
            est écrit.
          </span>
        </label>

        <ul className="flex flex-col gap-1.5">
          {vlans.map((vlan) => (
            <VlanRow
              key={vlan.id}
              vlan={vlan}
              portee={resumePortee(portees.get(vlan.id))}
              usage={usageVlan(vlan, diagram, portees.get(vlan.id))}
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
  portee,
  usage,
  onChange,
  onRemove,
}: {
  vlan: VlanDef
  portee: { equipements: number; liaisons: number; parTrunk: number }
  /** Nature retenue : celle qui est déclarée, ou celle que le schéma laisse déduire. */
  usage: UsageVlan
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
        {usage !== 'service' && (
          <span
            className="shrink-0 rounded bg-violet-50 px-1 text-[10px] font-medium text-violet-700"
            title={USAGES_VLAN[usage].detail}
          >
            {USAGES_VLAN[usage].court}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-slate-400">{vlan.subnet ?? '—'}</span>
        <span
          className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-500"
          title={`${portee.equipements} équipement(s) dans ce domaine de diffusion${
            portee.parTrunk > 0 ? `, dont ${portee.parTrunk} atteint(s) par trunk` : ''
          }`}
        >
          {portee.equipements}
        </span>
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
          {/*
            La nature du VLAN. Laissée sur « déduit », elle suit le schéma — c'est ce qu'on veut
            dans la quasi-totalité des cas. On la fige quand le schéma ne suffit pas à trancher,
            ou pour faire contrôler ce qui est attendu.
          */}
          <Field label="Usage">
            <select
              value={vlan.usage ?? ''}
              onChange={(event) =>
                onChange({ ...vlan, usage: (event.target.value || undefined) as UsageVlan | undefined })
              }
              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[12px] outline-none focus:border-blue-400"
            >
              <option value="">Déduit du schéma — {USAGES_VLAN[usage].label.toLowerCase()}</option>
              {(Object.keys(USAGES_VLAN) as UsageVlan[]).map((cle) => (
                <option key={cle} value={cle}>
                  {USAGES_VLAN[cle].label}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-[11px] leading-snug text-slate-500">{USAGES_VLAN[usage].detail}</p>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              {portee.equipements} équipement(s), {portee.liaisons} liaison(s)
              {portee.parTrunk > 0 ? ` — dont ${portee.parTrunk} atteint(s) par trunk` : ''}
            </span>
            <button type="button" onClick={onRemove} className="text-[11px] text-red-600 hover:underline">
              Supprimer
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
