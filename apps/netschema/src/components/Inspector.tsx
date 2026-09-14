import { Btn, Checkbox, Field, Select, Slider, TextInput } from './ui'
import { HaPanel } from './HaPanel'
import { DEVICES, LAYER_LABELS, LINKS, ROLES, rankOf } from '../lib/catalog'
import { useDiagram } from '../store/useDiagram'
import { useAudit } from '../store/useAudit'
import type { DeviceKind, HaRole, LinkKind, NetNode } from '../types'

const DEVICE_OPTIONS = (Object.keys(DEVICES) as DeviceKind[]).map((kind) => ({
  value: kind,
  label: DEVICES[kind].label,
}))

const LINK_OPTIONS = (Object.keys(LINKS) as LinkKind[]).map((kind) => ({
  value: kind,
  label: LINKS[kind].label,
}))

const ROLE_OPTIONS = (Object.keys(ROLES) as HaRole[]).map((role) => ({
  value: role,
  label: ROLES[role].label,
}))

const RANK_OPTIONS = [
  { value: 'auto', label: 'Automatique (selon le type)' },
  ...Object.entries(LAYER_LABELS).map(([rank, label]) => ({ value: rank, label: `${rank} — ${label}` })),
]

export function Inspector() {
  const diagram = useDiagram((s) => s.diagram)
  const selectedNodes = useDiagram((s) => s.selectedNodes)
  const selectedLinks = useDiagram((s) => s.selectedLinks)
  const panel = useDiagram((s) => s.panel)
  const setPanel = useDiagram((s) => s.setPanel)
  const report = useAudit()

  const nodes = diagram.nodes.filter((n) => selectedNodes.includes(n.id))
  const link = diagram.links.find((l) => selectedLinks.includes(l.id))

  const alerts = report.counts.critique + report.counts.avertissement

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-slate-200 bg-white p-4">
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setPanel('properties')}
          className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition ${
            panel === 'properties' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Propriétés
        </button>
        <button
          type="button"
          onClick={() => setPanel('ha')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium transition ${
            panel === 'ha' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Haute dispo
          {alerts > 0 && (
            <span
              className="rounded-full px-1.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: report.counts.critique > 0 ? '#dc2626' : '#d97706' }}
            >
              {alerts}
            </span>
          )}
        </button>
      </div>

      {panel === 'ha' && <HaPanel />}

      {panel === 'properties' && (
      <>
      <section>
        <SectionTitle>Sélection</SectionTitle>
        {nodes.length === 1 && <NodeForm node={nodes[0]} />}
        {nodes.length > 1 && <MultiNodeForm nodes={nodes} />}
        {nodes.length === 0 && link && <LinkForm linkId={link.id} />}
        {nodes.length === 0 && !link && (
          <p className="text-[12px] leading-relaxed text-slate-400">
            Sélectionnez un équipement ou une liaison pour en modifier les propriétés.
            Maj+clic pour une sélection multiple.
          </p>
        )}
      </section>

      <LayoutForm />

      <section>
        <SectionTitle>Schéma</SectionTitle>
        <dl className="grid grid-cols-2 gap-y-1 text-[12px] text-slate-600">
          <dt className="text-slate-400">Équipements</dt>
          <dd className="text-right font-medium">{diagram.nodes.length}</dd>
          <dt className="text-slate-400">Liaisons</dt>
          <dd className="text-right font-medium">{diagram.links.length}</dd>
          <dt className="text-slate-400">Zones</dt>
          <dd className="text-right font-medium">
            {new Set(diagram.nodes.map((n) => n.zone?.trim()).filter(Boolean)).size}
          </dd>
          <dt className="text-slate-400">Positions figées</dt>
          <dd className="text-right font-medium">{diagram.nodes.filter((n) => n.pinned).length}</dd>
        </dl>
      </section>

      </>
      )}

      <section className="mt-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-600">Raccourcis</p>
        <p>L — mode Relier · Suppr — supprimer · Échap — annuler</p>
        <p>Ctrl+Z / Ctrl+Maj+Z — annuler / rétablir</p>
        <p>Molette — zoom · Glisser le fond — déplacer la vue</p>
      </section>
    </aside>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h2>
}

function NodeForm({ node }: { node: NetNode }) {
  const update = useDiagram((s) => s.updateNode)
  const set = (patch: Partial<NetNode>) => update(node.id, patch)

  return (
    <div className="flex flex-col gap-2.5">
      <Field label="Nom">
        <TextInput value={node.name} onChange={(name) => set({ name })} />
      </Field>
      <Field label="Type d'équipement">
        <Select value={node.kind} onChange={(kind) => set({ kind: kind as DeviceKind })} options={DEVICE_OPTIONS} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Adresse IP">
          <TextInput value={node.ip ?? ''} onChange={(ip) => set({ ip })} placeholder="10.0.0.1" />
        </Field>
        <Field label="VLAN">
          <TextInput value={node.vlan ?? ''} onChange={(vlan) => set({ vlan })} placeholder="VLAN 20" />
        </Field>
      </div>
      <Field label="Modèle">
        <TextInput value={node.model ?? ''} onChange={(model) => set({ model })} placeholder="FortiGate 100F" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Zone">
          <TextInput value={node.zone ?? ''} onChange={(zone) => set({ zone })} placeholder="DMZ…" />
        </Field>
        <Field label="Site">
          <TextInput value={node.site ?? ''} onChange={(site) => set({ site })} placeholder="Siège" />
        </Field>
      </div>

      <div className="rounded-lg border border-pink-100 bg-pink-50/50 p-2.5">
        <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-pink-700">
          Haute disponibilité
        </p>
        <div className="flex flex-col gap-2">
          <Field label="Grappe (cluster)">
            <TextInput value={node.cluster ?? ''} onChange={(cluster) => set({ cluster })} placeholder="FW-HA" />
          </Field>
          <Field label="Rôle dans la grappe">
            <Select
              value={node.role ?? 'standalone'}
              onChange={(role) => set({ role: role as HaRole })}
              options={ROLE_OPTIONS}
            />
          </Field>
          <Field label="Adresse virtuelle (VRRP / HSRP / VIP)">
            <TextInput value={node.vip ?? ''} onChange={(vip) => set({ vip })} placeholder="10.0.0.254" />
          </Field>
          <Checkbox
            checked={node.dualPower === true}
            onChange={(dualPower) => set({ dualPower })}
            label="Double alimentation (chaînes A/B)"
          />
        </div>
      </div>
      <Field label="Couche pour le placement auto">
        <Select
          value={typeof node.rank === 'number' ? String(node.rank) : 'auto'}
          onChange={(value) => set({ rank: value === 'auto' ? null : Number(value) })}
          options={RANK_OPTIONS}
        />
      </Field>
      <p className="-mt-1 text-[11px] text-slate-400">
        Couche appliquée : {rankOf(node.kind, node.rank)} — {LAYER_LABELS[rankOf(node.kind, node.rank)]}
      </p>
      <Field label="Notes">
        <TextInput value={node.notes ?? ''} onChange={(notes) => set({ notes })} />
      </Field>
      <Checkbox
        checked={node.pinned === true}
        onChange={(pinned) => set({ pinned })}
        label="Figer la position (ignoré par le placement auto)"
      />
    </div>
  )
}

function MultiNodeForm({ nodes }: { nodes: NetNode[] }) {
  const updateNodes = useDiagram((s) => s.updateNodes)
  const ids = nodes.map((n) => n.id)
  const allPinned = nodes.every((n) => n.pinned)
  const shared = (pick: (node: NetNode) => string | undefined) =>
    nodes.every((n) => pick(n) === pick(nodes[0])) ? (pick(nodes[0]) ?? '') : ''
  const sharedZone = shared((n) => n.zone)
  const sharedSite = shared((n) => n.site)
  const sharedCluster = shared((n) => n.cluster)

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[13px] font-medium text-slate-700">{nodes.length} équipements sélectionnés</p>
      <Field label="Zone commune">
        <TextInput value={sharedZone} onChange={(zone) => updateNodes(ids, { zone })} placeholder="Bâtiment A" />
      </Field>
      <Field label="Site commun">
        <TextInput value={sharedSite} onChange={(site) => updateNodes(ids, { site })} placeholder="Siège" />
      </Field>
      <Field label="Grappe commune">
        <TextInput value={sharedCluster} onChange={(cluster) => updateNodes(ids, { cluster })} placeholder="FW-HA" />
      </Field>
      <Checkbox
        checked={nodes.every((n) => n.dualPower)}
        onChange={(dualPower) => updateNodes(ids, { dualPower })}
        label="Double alimentation (A/B)"
      />
      <Checkbox
        checked={allPinned}
        onChange={(pinned) => updateNodes(ids, { pinned })}
        label="Figer la position de la sélection"
      />
    </div>
  )
}

function LinkForm({ linkId }: { linkId: string }) {
  const link = useDiagram((s) => s.diagram.links.find((l) => l.id === linkId))
  const nodes = useDiagram((s) => s.diagram.nodes)
  const updateLink = useDiagram((s) => s.updateLink)
  if (!link) return null

  const nameOf = (id: string) => nodes.find((n) => n.id === id)?.name ?? '—'
  const set = (patch: Partial<typeof link>) => updateLink(link.id, patch)

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[13px] font-medium text-slate-700">
        {nameOf(link.from)} <span className="text-slate-400">→</span> {nameOf(link.to)}
      </p>
      <Field label="Type de liaison">
        <Select value={link.kind} onChange={(kind) => set({ kind: kind as LinkKind })} options={LINK_OPTIONS} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Libellé">
          <TextInput value={link.label ?? ''} onChange={(label) => set({ label })} placeholder="MLAG" />
        </Field>
        <Field label="Débit">
          <TextInput value={link.speed ?? ''} onChange={(speed) => set({ speed })} placeholder="10 Gb/s" />
        </Field>
      </div>
      <Checkbox
        checked={link.redundant === true}
        onChange={(redundant) => set({ redundant })}
        label="Liaison de secours (pointillés)"
      />
      <Btn onClick={() => set({ from: link.to, to: link.from })}>Inverser le sens</Btn>
    </div>
  )
}

function LayoutForm() {
  const layout = useDiagram((s) => s.layout)
  const setLayout = useDiagram((s) => s.setLayout)
  const applyAutoLayout = useDiagram((s) => s.applyAutoLayout)
  const linkStyle = useDiagram((s) => s.linkStyle)
  const setDisplay = useDiagram((s) => s.setDisplay)
  const showGrid = useDiagram((s) => s.showGrid)
  const snap = useDiagram((s) => s.snap)
  const showZones = useDiagram((s) => s.showZones)
  const showSites = useDiagram((s) => s.showSites)
  const showClusters = useDiagram((s) => s.showClusters)
  const showLayerLabels = useDiagram((s) => s.showLayerLabels)
  const showDetails = useDiagram((s) => s.showDetails)

  return (
    <section>
      <SectionTitle>Mise en page</SectionTitle>
      <div className="flex flex-col gap-2.5">
        <Field label="Sens des couches">
          <Select
            value={layout.direction}
            onChange={(direction) => setLayout({ direction: direction as 'TB' | 'LR' })}
            options={[
              { value: 'TB', label: 'De haut en bas' },
              { value: 'LR', label: 'De gauche à droite' },
            ]}
          />
        </Field>
        <Field label={`Espacement dans la couche — ${layout.nodeGap} px`}>
          <Slider value={layout.nodeGap} min={16} max={140} step={4} onChange={(nodeGap) => setLayout({ nodeGap })} />
        </Field>
        <Field label={`Espacement entre couches — ${layout.layerGap} px`}>
          <Slider value={layout.layerGap} min={40} max={220} step={4} onChange={(layerGap) => setLayout({ layerGap })} />
        </Field>
        <Checkbox
          checked={layout.groupBySite}
          onChange={(groupBySite) => setLayout({ groupBySite })}
          label="Regrouper par site"
        />
        <Checkbox
          checked={layout.groupByZone}
          onChange={(groupByZone) => setLayout({ groupByZone })}
          label="Regrouper par zone"
        />
        <Btn variant="primary" onClick={applyAutoLayout}>Appliquer le placement auto</Btn>

        <Field label="Tracé des liaisons">
          <Select
            value={linkStyle}
            onChange={(value) => setDisplay({ linkStyle: value as 'orthogonal' | 'straight' })}
            options={[
              { value: 'orthogonal', label: 'Orthogonal (angles droits)' },
              { value: 'straight', label: 'Direct (ligne droite)' },
            ]}
          />
        </Field>
        <div className="flex flex-col gap-1.5 pt-1">
          <Checkbox checked={showDetails} onChange={(v) => setDisplay({ showDetails: v })} label="Afficher IP, VLAN, débits" />
          <Checkbox checked={showSites} onChange={(v) => setDisplay({ showSites: v })} label="Afficher les sites" />
          <Checkbox checked={showZones} onChange={(v) => setDisplay({ showZones: v })} label="Afficher les zones" />
          <Checkbox checked={showClusters} onChange={(v) => setDisplay({ showClusters: v })} label="Afficher les grappes HA" />
          <Checkbox checked={showLayerLabels} onChange={(v) => setDisplay({ showLayerLabels: v })} label="Afficher les noms de couches" />
          <Checkbox checked={showGrid} onChange={(v) => setDisplay({ showGrid: v })} label="Afficher la grille" />
          <Checkbox checked={snap} onChange={(v) => setDisplay({ snap: v })} label="Aimanter à la grille" />
        </div>
      </div>
    </section>
  )
}
