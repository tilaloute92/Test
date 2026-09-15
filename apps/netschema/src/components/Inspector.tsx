import { Btn, Checkbox, Field, Select, Slider, TextInput } from './ui'
import { CatalogPanel } from './CatalogPanel'
import { ModelPicker } from './ModelPicker'
import { HaPanel } from './HaPanel'
import { VlanPanel } from './VlanPanel'
import { linkLayers } from '../lib/osi'
import { collapsibleGroups } from '../lib/derive'
import { allDevices, LAYER_LABELS, LINKS, ROLES, rankOf } from '../lib/catalog'
import { useDiagram } from '../store/useDiagram'
import { useAudit } from '../store/useAudit'
import type {
  AnchorSide,
  DetailLevel,
  HaRole,
  LinkShape,
  LinkKind,
  NetNode,
  OsiLayer,
  PortMode,
  RoutingProtocol,
  StpRole,
  ZOrder,
} from '../types'

function deviceOptions() {
  return allDevices()
    .sort((a, b) => a.family.localeCompare(b.family) || a.label.localeCompare(b.label))
    .map((device) => ({ value: device.id, label: `${device.label} — ${device.family}` }))
}

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
        {(
          [
            ['properties', 'Propriétés'],
            ['ha', 'HA'],
            ['osi', 'L2/L3'],
            ['catalog', 'Catalogue'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition ${
              panel === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
            {id === 'ha' && alerts > 0 && (
              <span
                className="rounded-full px-1 text-[9px] font-bold text-white"
                style={{ backgroundColor: report.counts.critique > 0 ? '#dc2626' : '#d97706' }}
              >
                {alerts}
              </span>
            )}
          </button>
        ))}
      </div>

      {panel === 'ha' && <HaPanel />}
      {panel === 'osi' && <VlanPanel />}
      {panel === 'catalog' && <CatalogPanel />}

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

      <ReadabilityForm />

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
        <p>Ctrl+K — recherche et commandes · Ctrl+I — import rapide</p>
        <p>L — mode Relier · Ctrl+D — dupliquer · Suppr — supprimer</p>
        <p>Ctrl+Z / Ctrl+Maj+Z — annuler / rétablir · Échap — annuler</p>
        <p>Molette — zoom · Glisser le fond — déplacer la vue</p>
        <p>Double-clic sur un bloc replié — l’ouvrir</p>
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
        <Select value={node.kind} onChange={(kind) => set({ kind })} options={deviceOptions()} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Adresse IP">
          <TextInput value={node.ip ?? ''} onChange={(ip) => set({ ip })} placeholder="10.0.0.1" />
        </Field>
        <Field label="VLAN">
          <TextInput value={node.vlan ?? ''} onChange={(vlan) => set({ vlan })} placeholder="VLAN 20" />
        </Field>
      </div>
      <Field label="Matériel (base constructeurs)">
        <ModelPicker node={node} onPick={set} alignKind />
      </Field>
      {node.vendor && <p className="-mt-1 text-[11px] text-slate-400">Constructeur : {node.vendor}</p>}
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
      <ZOrderRow ids={[node.id]} />
    </div>
  )
}

/**
 * Ordre d'empilement de la sélection.
 *
 * L'ordre de dessin est celui du tableau d'équipements : ce qui vient en dernier passe
 * devant. Ces quatre boutons sont le seul moyen de trancher quand deux boîtes se
 * chevauchent — un équipement posé sur un cadre, une grappe dense, un plan de salle serré.
 */
function ZOrderRow({ ids }: { ids: string[] }) {
  const reorderNodes = useDiagram((s) => s.reorderNodes)
  const buttons: { where: ZOrder; label: string; title: string }[] = [
    { where: 'front', label: 'Premier plan', title: 'Passer devant tout le reste (Ctrl+Maj+F)' },
    { where: 'forward', label: 'Avancer', title: 'Passer devant l’équipement suivant (])' },
    { where: 'backward', label: 'Reculer', title: 'Passer derrière l’équipement précédent ([)' },
    { where: 'back', label: 'Arrière-plan', title: 'Passer derrière tout le reste (Ctrl+Maj+B)' },
  ]
  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Plan d’affichage
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {buttons.map((button) => (
          <Btn key={button.where} title={button.title} onClick={() => reorderNodes(ids, button.where)}>
            {button.label}
          </Btn>
        ))}
      </div>
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
      <ZOrderRow ids={ids} />
    </div>
  )
}

const ANCHOR_OPTIONS = [
  { value: 'auto', label: 'Automatique' },
  { value: 'top', label: 'Dessus' },
  { value: 'bottom', label: 'Dessous' },
  { value: 'left', label: 'Gauche' },
  { value: 'right', label: 'Droite' },
]

function LinkForm({ linkId }: { linkId: string }) {
  const link = useDiagram((s) => s.diagram.links.find((l) => l.id === linkId))
  const nodes = useDiagram((s) => s.diagram.nodes)
  const updateLink = useDiagram((s) => s.updateLink)
  const clearRoute = useDiagram((s) => s.clearLinkRoute)
  const clearAttach = useDiagram((s) => s.clearLinkAttach)
  if (!link) return null

  const nameOf = (id: string) => nodes.find((n) => n.id === id)?.name ?? '—'
  const set = (patch: Partial<typeof link>) => updateLink(link.id, patch)
  const layers = linkLayers(link)

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

      <div className="rounded-lg border border-slate-200 p-2.5">
        <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tracé</p>
        <div className="flex flex-col gap-2">
          <Field label="Forme">
            <Select
              value={link.shape ?? 'auto'}
              onChange={(shape) => set({ shape: shape === 'auto' ? undefined : (shape as LinkShape) })}
              options={[
                { value: 'auto', label: 'Comme le schéma' },
                { value: 'orthogonal', label: 'Orthogonal (angles droits)' },
                { value: 'straight', label: 'Direct (ligne droite)' },
                { value: 'curved', label: 'Courbe' },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Accroche au départ">
              <Select
                value={link.anchorA ?? 'auto'}
                onChange={(side) => set({ anchorA: side === 'auto' ? undefined : (side as AnchorSide) })}
                options={ANCHOR_OPTIONS}
              />
            </Field>
            <Field label="Accroche à l’arrivée">
              <Select
                value={link.anchorB ?? 'auto'}
                onChange={(side) => set({ anchorB: side === 'auto' ? undefined : (side as AnchorSide) })}
                options={ANCHOR_OPTIONS}
              />
            </Field>
          </div>
          <p className="text-[11px] leading-snug text-slate-400">
            {link.waypoints?.length
              ? `${link.waypoints.length} point(s) de passage. Glissez-les pour ajuster, double-cliquez pour en retirer un.`
              : 'Tirez le trait — ou une poignée claire au milieu d’un segment — pour poser un point de passage.'}
          </p>
          <p className="text-[11px] leading-snug text-slate-400">
            {link.attachA || link.attachB
              ? `Accroche libre ${link.attachA && link.attachB ? 'aux deux extrémités' : link.attachA ? 'au départ' : 'à l’arrivée'} : la liaison arrive à l’endroit choisi sur la boîte.`
              : 'Glissez une extrémité (carré vert) sur un équipement pour choisir l’endroit exact où la liaison s’y raccorde — ou pour la brancher ailleurs.'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Btn
              disabled={!link.attachA && !link.attachB}
              onClick={() => clearAttach(link.id)}
              title="Revenir à une accroche calculée aux deux extrémités"
            >
              Accroches auto
            </Btn>
            <Btn onClick={() => clearRoute(link.id)}>Tracé auto</Btn>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 p-2.5">
        <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Couches OSI documentées
        </p>
        <div className="flex gap-3">
          {(['l1', 'l2', 'l3'] as OsiLayer[]).map((layer) => (
            <label key={layer} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-700">
              <input
                type="checkbox"
                checked={layers.includes(layer)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...layers, layer]
                    : layers.filter((item) => item !== layer)
                  set({ layers: next.length > 0 ? (next as OsiLayer[]) : undefined })
                }}
                className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
              />
              {layer.toUpperCase()}
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
        <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Niveau 1 — physique
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Port départ">
            <TextInput value={link.portA ?? ''} onChange={(portA) => set({ portA })} placeholder="Gi1/0/1" />
          </Field>
          <Field label="Port arrivée">
            <TextInput value={link.portB ?? ''} onChange={(portB) => set({ portB })} placeholder="Gi1/0/2" />
          </Field>
        </div>
      </div>

      <div className="rounded-lg border border-cyan-100 bg-cyan-50/50 p-2.5">
        <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-700">
          Niveau 2 — liaison
        </p>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Mode du port">
              <Select
                value={link.mode ?? ''}
                onChange={(mode) => set({ mode: mode ? (mode as PortMode) : undefined })}
                options={[
                  { value: '', label: 'Non précisé' },
                  { value: 'access', label: 'Accès' },
                  { value: 'trunk', label: 'Trunk' },
                ]}
              />
            </Field>
            <Field label="VLAN (10,20,30-39)">
              <TextInput value={link.vlans ?? ''} onChange={(vlans) => set({ vlans })} placeholder="10,20" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="VLAN natif">
              <TextInput value={link.nativeVlan ?? ''} onChange={(nativeVlan) => set({ nativeVlan })} placeholder="1" />
            </Field>
            <Field label="Agrégat (LACP)">
              <TextInput value={link.lag ?? ''} onChange={(lag) => set({ lag })} placeholder="Po1" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Rôle spanning-tree">
              <Select
                value={link.stp ?? ''}
                onChange={(stp) => set({ stp: stp ? (stp as StpRole) : undefined })}
                options={[
                  { value: '', label: 'Non précisé' },
                  { value: 'root', label: 'Vers la racine' },
                  { value: 'designated', label: 'Désigné' },
                  { value: 'alternate', label: 'Alternatif' },
                  { value: 'blocking', label: 'Bloquant' },
                  { value: 'edge', label: 'Port d’extrémité' },
                ]}
              />
            </Field>
            <Field label="MTU">
              <TextInput
                value={link.mtu ? String(link.mtu) : ''}
                onChange={(value) => set({ mtu: value.trim() ? Number(value) : undefined })}
                placeholder="9000"
              />
            </Field>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-2.5">
        <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
          Niveau 3 — réseau
        </p>
        <div className="flex flex-col gap-2">
          <Field label="Sous-réseau (CIDR)">
            <TextInput value={link.subnet ?? ''} onChange={(subnet) => set({ subnet })} placeholder="10.0.0.0/30" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="IP départ">
              <TextInput value={link.ipA ?? ''} onChange={(ipA) => set({ ipA })} placeholder="10.0.0.1" />
            </Field>
            <Field label="IP arrivée">
              <TextInput value={link.ipB ?? ''} onChange={(ipB) => set({ ipB })} placeholder="10.0.0.2" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="VRF">
              <TextInput value={link.vrf ?? ''} onChange={(vrf) => set({ vrf })} placeholder="PROD" />
            </Field>
            <Field label="Routage">
              <Select
                value={link.routing ?? ''}
                onChange={(routing) => set({ routing: routing ? (routing as RoutingProtocol) : undefined })}
                options={[
                  { value: '', label: 'Non précisé' },
                  { value: 'static', label: 'Statique' },
                  { value: 'ospf', label: 'OSPF' },
                  { value: 'bgp', label: 'BGP' },
                  { value: 'eigrp', label: 'EIGRP' },
                  { value: 'is-is', label: 'IS-IS' },
                  { value: 'rip', label: 'RIP' },
                ]}
              />
            </Field>
          </div>
        </div>
      </div>

      <Btn onClick={() => set({ from: link.to, to: link.from, ipA: link.ipB, ipB: link.ipA, portA: link.portB, portB: link.portA })}>
        Inverser le sens
      </Btn>
    </div>
  )
}

/**
 * Lisibilité : les deux leviers qui font tenir une architecture complexe sur un écran —
 * le niveau de détail, et le repli des groupes en un bloc unique.
 */
function ReadabilityForm() {
  const diagram = useDiagram((s) => s.diagram)
  const detail = useDiagram((s) => s.detail)
  const setDetail = useDiagram((s) => s.setDetail)
  const collapsed = useDiagram((s) => s.collapsed)
  const toggleCollapse = useDiagram((s) => s.toggleCollapse)
  const setCollapsed = useDiagram((s) => s.setCollapsed)
  const groups = collapsibleGroups(diagram)

  const TYPE_LABEL = { site: 'Site', zone: 'Zone', cluster: 'Grappe' } as const

  return (
    <section>
      <SectionTitle>Lisibilité</SectionTitle>
      <div className="flex flex-col gap-2.5">
        <Field label="Niveau de détail">
          <Select
            value={detail}
            onChange={(value) => setDetail(value as DetailLevel)}
            options={[
              { value: 'full', label: 'Complet' },
              { value: 'no-endpoints', label: 'Sans les postes ni l’énergie' },
              { value: 'summary', label: 'Synthèse (jusqu’à la distribution)' },
            ]}
          />
        </Field>

        {groups.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between pb-1">
              <p className="text-[11px] font-medium text-slate-500">Replier un groupe</p>
              {collapsed.length > 0 && (
                <button type="button" onClick={() => setCollapsed([])} className="text-[11px] text-blue-600 hover:underline">
                  tout déplier
                </button>
              )}
            </div>
            <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto">
              {groups.map((group) => {
                const active = collapsed.includes(group.key)
                return (
                  <li key={group.key}>
                    <button
                      type="button"
                      onClick={() => toggleCollapse(group.key)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-[12px] transition ${
                        active
                          ? 'border-blue-300 bg-blue-50 text-blue-800'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        <span className="text-[10px] text-slate-400">{TYPE_LABEL[group.type]} · </span>
                        {group.label}
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-400">
                        {active ? 'replié' : group.count}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
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
