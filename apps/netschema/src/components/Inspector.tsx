import { useMemo, useState } from 'react'
import { Btn, Checkbox, Field, Select, Slider, TextInput } from './ui'
import { CatalogPanel } from './CatalogPanel'
import { ModelPicker } from './ModelPicker'
import { HaPanel } from './HaPanel'
import { ImpactPanel } from './ImpactPanel'
import { VlanPanel } from './VlanPanel'
import { ANNOTATION_COLORS, annotationColors } from '../lib/annotations'
import { aujourdhui } from '../lib/storage'
import { constructeurDe, mecanismeHa, mecanismesPour } from '../lib/haTech'
import { linkLayers } from '../lib/osi'
import { VUES_LOGIQUES, type VueLogique } from '../lib/vlanViews'
import {
  agregats,
  formaterDebit,
  MODES_LACP,
  type Agregat,
  type ModeLacp,
} from '../lib/aggregates'
import { collapsibleGroups } from '../lib/derive'
import { modeDefinition, VIEW_MODES } from '../lib/viewModes'
import { allDevices, LAYER_LABELS, LINKS, ROLES, rankOf } from '../lib/catalog'
import { useDiagram } from '../store/useDiagram'
import { useAudit } from '../store/useAudit'
import type {
  AnchorSide,
  Annotation,
  DetailLevel,
  HaRole,
  LinkShape,
  LinkKind,
  NetLink,
  NetNode,
  OsiLayer,
  PortMode,
  RoutingProtocol,
  StpRole,
  ViewMode,
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
  const selectedAnnotations = useDiagram((s) => s.selectedAnnotations)
  const panel = useDiagram((s) => s.panel)
  const setPanel = useDiagram((s) => s.setPanel)
  const report = useAudit()

  const nodes = diagram.nodes.filter((n) => selectedNodes.includes(n.id))
  const link = diagram.links.find((l) => selectedLinks.includes(l.id))
  const annotation = (diagram.annotations ?? []).find((a) => selectedAnnotations.includes(a.id))

  const alerts = report.counts.critique + report.counts.avertissement

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-slate-200 bg-white p-4">
      {/* Cinq onglets ne tiennent pas sur une ligne dans un bandeau de 288 px : on les laisse
          passer à la ligne plutôt que de les rogner. */}
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {(
          [
            ['properties', 'Propriétés'],
            ['ha', 'HA'],
            ['osi', 'L2/L3'],
            ['catalog', 'Catalogue'],
            ['impact', 'Impact'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id)}
            className={`flex min-w-[52px] flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition ${
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
      {panel === 'impact' && <ImpactPanel />}

      {panel === 'properties' && (
      <>
      <section>
        <SectionTitle>Sélection</SectionTitle>
        {nodes.length === 1 && <NodeForm node={nodes[0]} />}
        {nodes.length > 1 && <MultiNodeForm nodes={nodes} />}
        {nodes.length === 0 && link && <LinkForm linkId={link.id} />}
        {nodes.length === 0 && !link && annotation && <AnnotationForm annotation={annotation} />}
        {nodes.length === 0 && !link && !annotation && (
          <p className="text-[12px] leading-relaxed text-slate-400">
            Sélectionnez un équipement ou une liaison pour en modifier les propriétés.
            Maj+clic pour une sélection multiple.
          </p>
        )}
      </section>

      <LayoutForm />

      <ReadabilityForm />

      <DocumentForm />

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
        <p>Ctrl+K — recherche et commandes · Ctrl+J — assistant · Ctrl+I — import</p>
        <p>L — mode Relier · N — poser une note · Suppr — supprimer</p>
        <p>Ctrl+D — dupliquer · Ctrl+Maj+D — en série · Alt + glisser — copier à la souris</p>
        <p>Ctrl+C / Ctrl+X / Ctrl+V — copier, couper, coller (même entre pages)</p>
        <p>Ctrl+Z / Ctrl+Maj+Z — annuler / rétablir · Ctrl+A — tout sélectionner</p>
        <p>Flèches — déplacer (Alt : au pixel, Maj : cinq pas) · Échap — annuler</p>
        <p>Maj + glisser sur le fond — sélection au lasso</p>
        <p>Molette — zoom · Glisser le fond — déplacer la vue</p>
        <p>Double-clic sur un bloc replié — l’ouvrir</p>
      </section>
    </aside>
  )
}

const ETATS = [
  { value: '', label: '—' },
  { value: 'Brouillon', label: 'Brouillon' },
  { value: 'Pour revue', label: 'Pour revue' },
  { value: 'Validé', label: 'Validé' },
  { value: 'Périmé', label: 'Périmé' },
]

const DIFFUSIONS = [
  { value: '', label: '—' },
  { value: 'Interne', label: 'Interne' },
  { value: 'Diffusion restreinte', label: 'Diffusion restreinte' },
  { value: 'Confidentiel', label: 'Confidentiel' },
  { value: 'Public', label: 'Public' },
]

/**
 * Cartouche et légende : ce qui fait d'un dessin un document.
 *
 * Les champs vides ne s'impriment pas — un cartouche à moitié rempli reste lisible, et on
 * peut commencer par les deux qui comptent vraiment : l'indice et la date.
 */
function DocumentForm() {
  const bloc = useDiagram((s) => s.diagram.titleBlock)
  const setTitleBlock = useDiagram((s) => s.setTitleBlock)
  const showLegend = useDiagram((s) => s.showLegend)
  const setDisplay = useDiagram((s) => s.setDisplay)
  const [ouvert, setOuvert] = useState(false)

  return (
    <section>
      <button
        type="button"
        onClick={() => setOuvert(!ouvert)}
        className="flex w-full items-center justify-between pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
      >
        Document
        <span className="text-slate-300">{ouvert ? '−' : '+'}</span>
      </button>

      <div className="flex flex-col gap-2">
        <Checkbox
          checked={bloc?.show === true}
          onChange={(show) => setTitleBlock({ show })}
          label="Cartouche sur le plan"
        />
        <Checkbox
          checked={showLegend}
          onChange={(value) => setDisplay({ showLegend: value })}
          label="Légende sous le schéma"
        />
      </div>

      {ouvert && (
        <div className="flex flex-col gap-2.5 pt-3">
          <Field label="Organisation">
            <TextInput
              value={bloc?.organisation ?? ''}
              onChange={(organisation) => setTitleBlock({ organisation })}
              placeholder="Direction des systèmes d’information"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Référence">
              <TextInput
                value={bloc?.reference ?? ''}
                onChange={(reference) => setTitleBlock({ reference })}
                placeholder="DOC-RES-001"
              />
            </Field>
            <Field label="Indice">
              <TextInput
                value={bloc?.version ?? ''}
                onChange={(version) => setTitleBlock({ version })}
                placeholder="B"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date">
              <TextInput
                value={bloc?.date ?? ''}
                onChange={(date) => setTitleBlock({ date })}
                placeholder="2026-09-19"
              />
            </Field>
            <Field label="Établi par">
              <TextInput
                value={bloc?.author ?? ''}
                onChange={(author) => setTitleBlock({ author })}
                placeholder="Prénom Nom"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="État">
              <Select
                value={bloc?.status ?? ''}
                onChange={(status) => setTitleBlock({ status })}
                options={ETATS}
              />
            </Field>
            <Field label="Diffusion">
              <Select
                value={bloc?.confidentiality ?? ''}
                onChange={(confidentiality) => setTitleBlock({ confidentiality })}
                options={DIFFUSIONS}
              />
            </Field>
          </div>
          <Field label="Mention libre">
            <TextInput
              value={bloc?.notes ?? ''}
              onChange={(notes) => setTitleBlock({ notes })}
              placeholder="Ne pas diffuser hors du service."
            />
          </Field>
          <Btn onClick={() => setTitleBlock({ date: aujourdhui(), show: true })}>
            Dater d’aujourd’hui
          </Btn>
        </div>
      )}
    </section>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h2>
}

const ANNOTATION_LABELS: Record<Annotation['kind'], string> = {
  note: 'Note',
  zone: 'Cadre de périmètre',
  arrow: 'Flèche de renvoi',
}

/** Fiche d'une annotation : son texte, sa couleur, sa taille. */
function AnnotationForm({ annotation }: { annotation: Annotation }) {
  const update = useDiagram((s) => s.updateAnnotation)
  const remove = useDiagram((s) => s.removeAnnotation)
  const actuelle = annotationColors(annotation)

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12px] font-medium text-slate-600">{ANNOTATION_LABELS[annotation.kind]}</p>
      <Field label={annotation.kind === 'note' ? 'Texte' : 'Libellé'}>
        <textarea
          value={annotation.text ?? ''}
          onChange={(event) => update(annotation.id, { text: event.target.value })}
          rows={annotation.kind === 'note' ? 4 : 2}
          placeholder={
            annotation.kind === 'note'
              ? 'Migration prévue au T3 — ne pas rebrancher sans le prestataire.'
              : 'Lot 2 — bâtiment B'
          }
          className="w-full resize-y rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] leading-snug outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </Field>
      <Field label="Couleur">
        <div className="flex flex-wrap gap-1.5">
          {ANNOTATION_COLORS.map((couleur) => (
            <button
              key={couleur.id}
              type="button"
              title={couleur.label}
              onClick={() => update(annotation.id, { color: couleur.id })}
              className={`h-6 w-6 rounded-md border-2 transition ${
                actuelle.accent.toLowerCase() === couleur.accent.toLowerCase()
                  ? 'border-slate-900'
                  : 'border-transparent hover:border-slate-300'
              }`}
              style={{ backgroundColor: couleur.accent }}
            />
          ))}
        </div>
      </Field>
      {annotation.kind !== 'arrow' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Largeur">
            <TextInput
              value={String(Math.round(annotation.w))}
              onChange={(value) => update(annotation.id, { w: Math.max(60, Number(value) || 60) })}
            />
          </Field>
          <Field label="Hauteur">
            <TextInput
              value={String(Math.round(annotation.h))}
              onChange={(value) => update(annotation.id, { h: Math.max(36, Number(value) || 36) })}
            />
          </Field>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-slate-400">
        Double-cliquez l’annotation sur le plan pour en saisir le texte ; la poignée du coin la
        redimensionne. Elle suit le document et part dans tous les exports.
      </p>
      <Btn variant="danger" onClick={() => remove(annotation.id)}>
        Supprimer l’annotation
      </Btn>
    </div>
  )
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
          <MecanismeHaField node={node} onChange={(haTech) => set({ haTech })} />
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

/**
 * Mécanisme de haute disponibilité : la liste est filtrée par le type d'équipement, et les
 * mécanismes du constructeur saisi remontent en tête.
 *
 * La note affichée sous la liste est ce qui fait la différence entre cocher une case et
 * documenter une architecture : elle rappelle ce que le mécanisme protège, ce qu'il ne
 * protège pas, et en combien de temps il bascule.
 */
function MecanismeHaField({ node, onChange }: { node: NetNode; onChange: (id: string) => void }) {
  const constructeur = constructeurDe(node.vendor, node.model)
  const { propres, normalises, autres } = useMemo(
    () => mecanismesPour(node.kind, constructeur),
    [node.kind, constructeur],
  )
  const choisi = mecanismeHa(node.haTech)
  if (propres.length + normalises.length + autres.length === 0 && !choisi) return null

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-slate-500">Mécanisme de bascule</span>
        <select
          value={node.haTech ?? ''}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        >
          <option value="">— non documenté —</option>
          {propres.length > 0 && (
            <optgroup label={`Chez ${constructeur}`}>
              {propres.map((mecanisme) => (
                <option key={mecanisme.id} value={mecanisme.id}>
                  {mecanisme.label}
                </option>
              ))}
            </optgroup>
          )}
          {normalises.length > 0 && (
            <optgroup label="Mécanismes normalisés">
              {normalises.map((mecanisme) => (
                <option key={mecanisme.id} value={mecanisme.id}>
                  {mecanisme.label}
                </option>
              ))}
            </optgroup>
          )}
          {autres.length > 0 && (
            <optgroup label="Autres constructeurs">
              {autres.map((mecanisme) => (
                <option key={mecanisme.id} value={mecanisme.id}>
                  {mecanisme.label}
                </option>
              ))}
            </optgroup>
          )}
          {choisi && ![...propres, ...normalises, ...autres].includes(choisi) && (
            <option value={choisi.id}>{choisi.label}</option>
          )}
        </select>
      </label>
      {choisi && (
        <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600">
          <p>
            <b className="font-semibold text-slate-700">Bascule :</b> {choisi.bascule}
          </p>
          {choisi.lien && (
            <p>
              <b className="font-semibold text-slate-700">À câbler :</b> {choisi.lien.nom}
            </p>
          )}
          {choisi.temoin && (
            <p className="text-amber-700">Témoin d’arbitrage indispensable (troisième emplacement).</p>
          )}
          {choisi.planDeControleCommun && (
            <p className="text-amber-700">
              Plan de contrôle commun : protège du matériel, pas d’un bogue logiciel.
            </p>
          )}
          {(choisi.liensComplementaires ?? []).length > 0 && (
            <ul className="list-disc pl-4 pt-1">
              {choisi.liensComplementaires?.map((lien) => (
                <li key={lien.nom}>
                  {lien.nom}
                  {lien.role ? ` (${lien.role})` : ''}
                </li>
              ))}
            </ul>
          )}
          <p className="pt-1">{choisi.note}</p>
          {(choisi.prerequis ?? []).length > 0 && (
            <>
              <p className="pt-1.5 font-semibold text-slate-700">Prérequis</p>
              <ul className="list-disc pl-4">
                {choisi.prerequis?.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {(choisi.limites ?? []).length > 0 && (
            <>
              <p className="pt-1.5 font-semibold text-slate-700">Ce que ce mécanisme ne couvre pas</p>
              <ul className="list-disc pl-4">
                {choisi.limites?.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
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
      <AlignRow ids={ids} />
      <ZOrderRow ids={ids} />
    </div>
  )
}

/**
 * Alignement et répartition.
 *
 * L'aimantation à la grille ne range pas tout : deux équipements peuvent être sur la grille
 * et décalés d'un pas, et une rangée de six switches se répartit mal à l'œil. Ce sont les
 * boutons qu'on cherche dans tout outil de dessin.
 */
function AlignRow({ ids }: { ids: string[] }) {
  const alignNodes = useDiagram((s) => s.alignNodes)
  const distributeNodes = useDiagram((s) => s.distributeNodes)
  const bouton =
    'flex-1 rounded-md border border-slate-200 bg-white px-1 py-1.5 text-[11px] text-slate-600 transition hover:bg-slate-50 disabled:opacity-40'

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-slate-500">Aligner</span>
      <div className="flex gap-1">
        <button type="button" className={bouton} title="Aligner à gauche" onClick={() => alignNodes(ids, 'left')}>
          ⇤
        </button>
        <button type="button" className={bouton} title="Centrer verticalement" onClick={() => alignNodes(ids, 'hcenter')}>
          ↔
        </button>
        <button type="button" className={bouton} title="Aligner à droite" onClick={() => alignNodes(ids, 'right')}>
          ⇥
        </button>
        <button type="button" className={bouton} title="Aligner en haut" onClick={() => alignNodes(ids, 'top')}>
          ⇧
        </button>
        <button type="button" className={bouton} title="Centrer horizontalement" onClick={() => alignNodes(ids, 'vcenter')}>
          ↕
        </button>
        <button type="button" className={bouton} title="Aligner en bas" onClick={() => alignNodes(ids, 'bottom')}>
          ⇩
        </button>
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          className={bouton}
          disabled={ids.length < 3}
          title="Répartir à intervalles égaux, horizontalement"
          onClick={() => distributeNodes(ids, 'x')}
        >
          Répartir ↔
        </button>
        <button
          type="button"
          className={bouton}
          disabled={ids.length < 3}
          title="Répartir à intervalles égaux, verticalement"
          onClick={() => distributeNodes(ids, 'y')}
        >
          Répartir ↕
        </button>
      </div>
    </div>
  )
}

const MODE_OPTIONS = [
  { value: '', label: 'Non précisé' },
  { value: 'access', label: 'Accès' },
  { value: 'trunk', label: 'Trunk' },
]

const STP_OPTIONS = [
  { value: '', label: 'Non précisé' },
  { value: 'root', label: 'Vers la racine' },
  { value: 'designated', label: 'Désigné' },
  { value: 'alternate', label: 'Alternatif' },
  { value: 'blocking', label: 'Bloquant' },
  { value: 'edge', label: 'Port d’extrémité' },
]

interface EndPatch {
  port?: string
  mode?: PortMode
  vlans?: string
  nativeVlan?: string
  lag?: string
  stp?: StpRole
}

/**
 * Configuration de couche 2 d'un côté de la liaison.
 *
 * Les champs laissés vides héritent de la valeur commune — affichée en filigrane — pour
 * qu'on ne saisisse que ce qui diffère réellement d'un équipement à l'autre : le rôle
 * spanning-tree, le nom du port-channel local, un trunk plus restreint d'un côté.
 */
function EndL2({
  title,
  common,
  port,
  mode,
  vlans,
  nativeVlan,
  lag,
  stp,
  onChange,
}: {
  title: string
  common: NetLink
  onChange: (patch: EndPatch) => void
} & EndPatch) {
  const current: EndPatch = { port, mode, vlans, nativeVlan, lag, stp }
  const patch = (next: EndPatch) => onChange({ ...current, ...next })
  const inherited = (value: string | undefined, fallback: string) => (value?.trim() ? `hérité : ${value}` : fallback)

  return (
    <div className="rounded-lg border border-cyan-200/70 bg-white p-2">
      <p className="pb-1 text-[11px] font-semibold text-cyan-800">{title}</p>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Port">
            <TextInput value={port ?? ''} onChange={(value) => patch({ port: value })} placeholder="Gi1/0/1" />
          </Field>
          <Field label="Mode">
            <Select
              value={mode ?? ''}
              onChange={(value) => patch({ mode: value ? (value as PortMode) : undefined })}
              options={[
                { value: '', label: common.mode ? `Comme la liaison (${common.mode})` : 'Non précisé' },
                ...MODE_OPTIONS.slice(1),
              ]}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="VLAN">
            <TextInput
              value={vlans ?? ''}
              onChange={(value) => patch({ vlans: value })}
              placeholder={inherited(common.vlans, '10,20')}
            />
          </Field>
          <Field label="VLAN natif">
            <TextInput
              value={nativeVlan ?? ''}
              onChange={(value) => patch({ nativeVlan: value })}
              placeholder={inherited(common.nativeVlan, '1')}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Agrégat (LACP)">
            <TextInput value={lag ?? ''} onChange={(value) => patch({ lag: value })} placeholder="Po1" />
          </Field>
          <Field label="Rôle spanning-tree">
            <Select
              value={stp ?? ''}
              onChange={(value) => patch({ stp: value ? (value as StpRole) : undefined })}
              options={STP_OPTIONS}
            />
          </Field>
        </div>
      </div>
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
              : 'Glissez une extrémité (carré vert) sur un équipement : seize repères apparaissent tout autour de la boîte — coins, milieux et quarts de chaque côté. Alt enfoncé pour se poser entre deux ; double-clic sur la poignée pour revenir à l’accroche automatique.'}
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
          <Field label={`Port ${nameOf(link.from)}`}>
            <TextInput value={link.portA ?? ''} onChange={(portA) => set({ portA })} placeholder="Gi1/0/1" />
          </Field>
          <Field label={`Port ${nameOf(link.to)}`}>
            <TextInput value={link.portB ?? ''} onChange={(portB) => set({ portB })} placeholder="Gi1/0/2" />
          </Field>
        </div>
      </div>

      <div className="rounded-lg border border-cyan-100 bg-cyan-50/50 p-2.5">
        <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-700">
          Niveau 2 — liaison
        </p>
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-snug text-cyan-800/70">
            Commun aux deux extrémités. Ce qui diffère d’un équipement à l’autre se renseigne
            juste en dessous, côté par côté.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Mode du port">
              <Select
                value={link.mode ?? ''}
                onChange={(mode) => set({ mode: mode ? (mode as PortMode) : undefined })}
                options={MODE_OPTIONS}
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
            <Field label="MTU">
              <TextInput
                value={link.mtu ? String(link.mtu) : ''}
                onChange={(value) => set({ mtu: value.trim() ? Number(value) : undefined })}
                placeholder="9000"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Agrégat (port-channel)">
              <TextInput value={link.lag ?? ''} onChange={(lag) => set({ lag })} placeholder="Po1" />
            </Field>
            <Field label="Négociation de l’agrégat">
              <Select
                value={link.lacp ?? ''}
                onChange={(lacp) => set({ lacp: lacp ? (lacp as ModeLacp) : undefined })}
                options={[
                  { value: '', label: 'Non précisée' },
                  ...MODES_LACP.map((item) => ({ value: item.value, label: item.label })),
                ]}
              />
            </Field>
          </div>
          <AgregatResume link={link} />

          <EndL2
            title={`Côté ${nameOf(link.from)}`}
            common={link}
            port={link.portA}
            mode={link.modeA}
            vlans={link.vlansA}
            nativeVlan={link.nativeVlanA}
            lag={link.lagA}
            stp={link.stpA}
            onChange={(patch) =>
              set({
                portA: patch.port,
                modeA: patch.mode,
                vlansA: patch.vlans,
                nativeVlanA: patch.nativeVlan,
                lagA: patch.lag,
                stpA: patch.stp,
              })
            }
          />
          <EndL2
            title={`Côté ${nameOf(link.to)}`}
            common={link}
            port={link.portB}
            mode={link.modeB}
            vlans={link.vlansB}
            nativeVlan={link.nativeVlanB}
            lag={link.lagB}
            stp={link.stpB}
            onChange={(patch) =>
              set({
                portB: patch.port,
                modeB: patch.mode,
                vlansB: patch.vlans,
                nativeVlanB: patch.nativeVlan,
                lagB: patch.lag,
                stpB: patch.stp,
              })
            }
          />
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
            <Field label={`IP ${nameOf(link.from)}`}>
              <TextInput value={link.ipA ?? ''} onChange={(ipA) => set({ ipA })} placeholder="10.0.0.1" />
            </Field>
            <Field label={`IP ${nameOf(link.to)}`}>
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

      <Btn
        onClick={() =>
          set({
            from: link.to,
            to: link.from,
            ipA: link.ipB,
            ipB: link.ipA,
            portA: link.portB,
            portB: link.portA,
            modeA: link.modeB,
            modeB: link.modeA,
            vlansA: link.vlansB,
            vlansB: link.vlansA,
            nativeVlanA: link.nativeVlanB,
            nativeVlanB: link.nativeVlanA,
            lagA: link.lagB,
            lagB: link.lagA,
            stpA: link.stpB,
            stpB: link.stpA,
          })
        }
      >
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
  const showHops = useDiagram((s) => s.showHops)
  const spreadLinks = useDiagram((s) => s.spreadLinks)
  const showLags = useDiagram((s) => s.showLags)
  const vueLogique = useDiagram((s) => s.vueLogique)
  const setVueLogique = useDiagram((s) => s.setVueLogique)
  const vlanFocus = useDiagram((s) => s.vlanFocus)
  const setVlanFocus = useDiagram((s) => s.setVlanFocus)
  const vlans = useDiagram((s) => s.diagram.vlans ?? [])
  const viewMode = useDiagram((s) => s.viewMode)
  const setViewMode = useDiagram((s) => s.setViewMode)

  return (
    <section>
      <SectionTitle>Mise en page</SectionTitle>
      <div className="flex flex-col gap-2.5">
        <Field label="Mode de visualisation">
          <Select
            value={viewMode}
            onChange={(value) => setViewMode(value as ViewMode)}
            options={VIEW_MODES.map((item) => ({ value: item.id, label: item.label }))}
          />
        </Field>
        <p className="-mt-1 text-[11px] leading-snug text-slate-400">{modeDefinition(viewMode).hint}</p>
        {viewMode === 'logique' && (
          <>
            <Field label="Lecture logique">
              <Select
                value={vueLogique}
                onChange={(value) => setVueLogique(value as VueLogique)}
                options={VUES_LOGIQUES.map((item) => ({ value: item.value, label: item.label }))}
              />
            </Field>
            <p className="-mt-1 text-[11px] leading-snug text-slate-400">
              {VUES_LOGIQUES.find((item) => item.value === vueLogique)?.hint}
            </p>
          </>
        )}
        {vlans.length > 0 && (
          <Field label="Projecteur VLAN">
            <Select
              value={vlanFocus ?? ''}
              onChange={(value) => setVlanFocus(value || null)}
              options={[
                { value: '', label: 'Tous les VLAN' },
                ...vlans.map((vlan) => ({
                  value: vlan.id,
                  label: vlan.name ? `VLAN ${vlan.id} — ${vlan.name}` : `VLAN ${vlan.id}`,
                })),
              ]}
            />
          </Field>
        )}
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
          <Checkbox
            checked={showLags}
            onChange={(v) => setDisplay({ showLags: v })}
            label="Encercler les agrégats (port-channels)"
          />
          <Checkbox checked={showLayerLabels} onChange={(v) => setDisplay({ showLayerLabels: v })} label="Afficher les noms de couches" />
          <Checkbox
            checked={spreadLinks}
            onChange={(v) => setDisplay({ spreadLinks: v })}
            label="Écarter les liaisons superposées"
          />
          <Checkbox
            checked={showHops}
            onChange={(v) => setDisplay({ showHops: v })}
            label="Enjamber les croisements de liaisons"
          />
          <Checkbox checked={showGrid} onChange={(v) => setDisplay({ showGrid: v })} label="Afficher la grille" />
          <Checkbox checked={snap} onChange={(v) => setDisplay({ snap: v })} label="Aimanter à la grille" />
        </div>
      </div>
    </section>
  )
}

/**
 * Ce que devient la liaison sélectionnée une fois le port-channel formé.
 *
 * Un nom de bundle saisi dans un champ ne dit rien tant qu'on ne voit pas le faisceau qu'il
 * constitue : combien de brins, quel débit cumulé, sur combien de châssis, et ce qui cloche.
 */
function AgregatResume({ link }: { link: NetLink }) {
  const diagram = useDiagram((s) => s.diagram)
  const concernes = useMemo<Agregat[]>(
    () => agregats(diagram).filter((agregat) => agregat.membres.some((membre) => membre.id === link.id)),
    [diagram, link.id],
  )
  if (concernes.length === 0) {
    const nom = (link.lag ?? link.lagA ?? link.lagB ?? '').trim()
    if (!nom) return null
    return (
      <p className="rounded-md bg-amber-50 p-2 text-[11px] leading-snug text-amber-900">
        « {nom} » ne compte qu’un seul brin : un agrégat d’un membre n’apporte ni débit ni
        secours. Donnez le même nom à la liaison parallèle pour former le faisceau.
      </p>
    )
  }
  return (
    <>
      {concernes.map((agregat) => (
        <div key={agregat.id} className="rounded-md bg-cyan-100/50 p-2 text-[11px] leading-snug text-cyan-900">
          <p className="font-semibold">
            {agregat.nom} — {agregat.membres.length} brins
            {agregat.debitTotal ? `, ${formaterDebit(agregat.debitTotal)} cumulés` : ''}
            {agregat.multiChassis ? ', réparti sur deux châssis' : ''}
          </p>
          <p className="pt-0.5">
            Un seul lien logique : l’ovale du schéma le matérialise, et la perte d’un brin ne
            coupe pas le lien.
          </p>
          {agregat.reserves.map((reserve) => (
            <p key={reserve} className="pt-1 text-amber-800">
              ⚠ {reserve}
            </p>
          ))}
        </div>
      ))}
    </>
  )
}
