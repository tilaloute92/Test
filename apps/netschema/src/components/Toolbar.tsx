import { useRef } from 'react'
import { Btn } from './ui'
import { downloadBlob, downloadPng, downloadSvg, slugify } from '../lib/exportImage'
import { pageInteractive, type PageExportee } from '../lib/exportHtml'
import { capturerPages } from '../lib/capture'
import { diagramFileContent, readProjectFile } from '../lib/storage'
import { useDiagram } from '../store/useDiagram'
import { modeDefinition, VIEW_MODES } from '../lib/viewModes'
import type { DetailLevel, OsiView, ViewMode } from '../types'
import { useAudit } from '../store/useAudit'

export function Toolbar({ svgRef }: { svgRef: React.RefObject<SVGSVGElement | null> }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const title = useDiagram((s) => s.diagram.title)
  const mode = useDiagram((s) => s.mode)
  const zoom = useDiagram((s) => s.view.zoom)
  const canUndo = useDiagram((s) => s.past.length > 0)
  const canRedo = useDiagram((s) => s.future.length > 0)
  const hasSelection = useDiagram(
    (s) => s.selectedNodes.length + s.selectedLinks.length + s.selectedAnnotations.length > 0,
  )
  const report = useAudit()
  const detail = useDiagram((s) => s.detail)
  const osi = useDiagram((s) => s.osi)
  const viewMode = useDiagram((s) => s.viewMode)
  const locked = useDiagram((s) => s.diagram.locked === true)
  const paletteOpen = useDiagram((s) => s.paletteOpen)
  const inspectorOpen = useDiagram((s) => s.inspectorOpen)
  const labelsLocked = useDiagram((s) => s.diagram.labelsLocked === true)

  const store = useDiagram.getState

  const exportImage = async (format: 'svg' | 'png') => {
    const svg = svgRef.current
    if (!svg) return
    const filename = `${slugify(store().diagram.title)}.${format}`
    try {
      if (format === 'svg') downloadSvg(svg, filename)
      else await downloadPng(svg, filename, 2)
      store().notify(`Export ${format.toUpperCase()} généré.`)
    } catch (error) {
      store().notify(error instanceof Error ? error.message : "L'export a échoué.")
    }
  }

  /**
   * Export « page interactive » : toutes les pages, chacune dans ses quatre vues.
   *
   * La capture est faite par le module commun (`capturerPages`) : c'est le rendu réel de
   * l'application, page après page et mode après mode, avec remise en place de ce qui était
   * ouvert — y compris l'historique d'annulation, que la bascule de page vide.
   */
  const exportPage = async () => {
    try {
      const capturees = await capturerPages(VIEW_MODES.map((definition) => definition.id))
      const pagesExportees: PageExportee[] = capturees.map((page) => ({
        nom: page.nom,
        diagram: page.diagram,
        vues: page.vues.map((vue) => {
          const definition = modeDefinition(vue.mode)
          return { id: vue.mode, label: definition.label, hint: definition.hint, svg: vue.svg }
        }),
      }))
      const html = pageInteractive(store().diagram.title, pagesExportees)
      downloadBlob(
        new Blob([html], { type: 'text/html;charset=utf-8' }),
        `${slugify(store().diagram.title)}.html`,
      )
      store().notify(
        pagesExportees.length > 1
          ? `Page interactive générée : ${pagesExportees.length} pages × ${VIEW_MODES.length} vues dans un seul fichier.`
          : `Page interactive générée : les ${VIEW_MODES.length} vues dans un seul fichier.`,
      )
    } catch (error) {
      store().notify(error instanceof Error ? error.message : "L'export a échoué.")
    }
  }

  const saveProject = () => {
    // Le fichier porte le document entier : toutes les pages, pas seulement celle affichée.
    downloadBlob(
      new Blob([diagramFileContent(store().classeur())], { type: 'application/json' }),
      `${slugify(store().diagram.title)}.json`,
    )
  }

  const openProject = async (file: File | undefined) => {
    if (!file) return
    try {
      const { classeur, warnings } = await readProjectFile(file)
      store().loadClasseur(classeur)
      const equipements = classeur.pages.reduce((total, page) => total + page.nodes.length, 0)
      const liaisons = classeur.pages.reduce((total, page) => total + page.links.length, 0)
      store().notify(
        `« ${file.name} » chargé : ${equipements} équipement(s), ${liaisons} liaison(s), ` +
          `${classeur.pages.length} page(s).` +
          (warnings.length > 0 ? ` ${warnings[0]}` : ''),
      )
    } catch (error) {
      store().notify(error instanceof Error ? error.message : 'Fichier illisible.')
    }
  }

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-2 pr-2">
        <span className="rounded-md bg-slate-900 px-2 py-1 text-[11px] font-bold tracking-wide text-white">
          NETSCHEMA
        </span>
        <input
          value={title}
          onChange={(event) => store().setTitle(event.target.value)}
          className="w-56 rounded-lg border border-transparent px-2 py-1 text-[15px] font-semibold text-slate-800 outline-none hover:border-slate-200 focus:border-blue-500"
        />
      </div>

      <Separator />

      <Btn onClick={() => store().undo()} disabled={!canUndo} title="Annuler (Ctrl+Z)">↶</Btn>
      <Btn onClick={() => store().redo()} disabled={!canRedo} title="Rétablir (Ctrl+Maj+Z)">↷</Btn>

      <Separator />

      <button
        type="button"
        onClick={() => store().setCommandOpen(true)}
        title="Palette de commandes (Ctrl+K)"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-500 transition hover:bg-slate-50"
      >
        Rechercher
        <kbd className="rounded border border-slate-200 bg-slate-50 px-1 text-[10px] text-slate-400">Ctrl K</kbd>
      </button>

      <Separator />

      <Btn
        variant={mode === 'connect' ? 'active' : 'default'}
        onClick={() => store().setMode(mode === 'connect' ? 'select' : 'connect')}
        disabled={locked}
        title="Relier deux équipements (L)"
      >
        Relier
      </Btn>
      <Btn variant="danger" onClick={() => store().deleteSelection()} disabled={locked || !hasSelection} title="Supprimer (Suppr)">
        Supprimer
      </Btn>

      {/*
        Annoter : ce qu'un schéma ne peut pas dire avec des boîtes et des traits — une
        réserve, un périmètre de travaux, un renvoi.
      */}
      <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
        <button
          type="button"
          disabled={locked}
          onClick={() => store().addAnnotation('note')}
          title="Poser une note sur le plan (double-clic pour en saisir le texte)"
          className="rounded-md px-2 py-1 text-[12.5px] font-medium text-slate-600 transition hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ✎ Note
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => store().addAnnotation('zone')}
          title="Encadrer un périmètre (lot de travaux, phase de migration…)"
          className="rounded-md px-2 py-1 text-[12.5px] font-medium text-slate-600 transition hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ▭ Cadre
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => store().addAnnotation('arrow')}
          title="Poser une flèche de renvoi"
          className="rounded-md px-2 py-1 text-[12.5px] font-medium text-slate-600 transition hover:bg-white hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↗ Flèche
        </button>
      </div>

      <Separator />

      {/* Verrous : celui du schéma protège tout le document, celui des étiquettes fige leur place. */}
      <button
        type="button"
        onClick={() => store().setLocked(!locked)}
        title={
          locked
            ? 'Schéma verrouillé (lecture seule) — cliquer pour déverrouiller'
            : 'Verrouiller le schéma : plus aucune modification possible'
        }
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition ${
          locked
            ? 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          {locked ? <path d="M8 11V7a4 4 0 0 1 8 0v4" /> : <path d="M8 11V7a4 4 0 0 1 7.5-2" />}
        </svg>
        {locked ? 'Verrouillé' : 'Verrouiller'}
      </button>
      <button
        type="button"
        onClick={() => store().setLabelsLocked(!labelsLocked, labelsLocked ? undefined : store().labelPlacements())}
        disabled={locked}
        title={
          labelsLocked
            ? 'Étiquettes figées à leur place — cliquer pour les libérer'
            : 'Figer les étiquettes de liaison à leur place actuelle'
        }
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
          labelsLocked
            ? 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" />
        </svg>
        Étiquettes
      </button>

      <Separator />

      <Btn
        variant="primary"
        onClick={() => store().applyAutoLayout()}
        disabled={locked}
        title="Replacer automatiquement les équipements"
      >
        Placement auto
      </Btn>
      <Btn onClick={() => store().fitView()} title="Ajuster à la fenêtre">Ajuster</Btn>

      {/* Bandeaux latéraux : sur un portable, les masquer double la surface de travail. */}
      <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
        <button
          type="button"
          title={paletteOpen ? 'Masquer la palette (bandeau de gauche)' : 'Afficher la palette'}
          onClick={() => store().setPanelOpen('palette', !paletteOpen)}
          className={`rounded-md px-2 py-1 text-[12.5px] font-medium transition ${
            paletteOpen ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          ▤ Palette
        </button>
        <button
          type="button"
          title={inspectorOpen ? 'Masquer l’inspecteur (bandeau de droite)' : 'Afficher l’inspecteur'}
          onClick={() => store().setPanelOpen('inspecteur', !inspectorOpen)}
          className={`rounded-md px-2 py-1 text-[12.5px] font-medium transition ${
            inspectorOpen ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          Inspecteur ▤
        </button>
      </div>
      <div className="flex items-center gap-1">
        <Btn variant="ghost" onClick={() => zoomFromCenter(0.85)} title="Dézoomer">−</Btn>
        <span className="w-11 text-center text-[12px] tabular-nums text-slate-500">
          {Math.round(zoom * 100)}%
        </span>
        <Btn variant="ghost" onClick={() => zoomFromCenter(1.18)} title="Zoomer">+</Btn>
      </div>

      {/* Mode de visualisation : trois lectures du même schéma. */}
      <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
        {VIEW_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.hint}
            onClick={() => store().setViewMode(item.id as ViewMode)}
            className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium transition ${
              viewMode === item.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <select
        value={osi}
        onChange={(event) => store().setOsi(event.target.value as OsiView)}
        title="Couche du modèle OSI mise en avant"
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-700 outline-none"
      >
        <option value="all">Toutes couches</option>
        <option value="l1">L1 — physique</option>
        <option value="l2">L2 — liaison</option>
        <option value="l3">L3 — réseau</option>
      </select>

      <select
        value={detail}
        onChange={(event) => store().setDetail(event.target.value as DetailLevel)}
        title="Niveau de détail affiché"
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-700 outline-none"
      >
        <option value="full">Détail complet</option>
        <option value="no-endpoints">Sans les postes</option>
        <option value="summary">Synthèse</option>
      </select>

      <div className="ml-auto flex items-center gap-2">
        <Btn
          variant="primary"
          onClick={() => store().setAssistantOpen(true)}
          disabled={locked}
          title="Assistant de conception : décrire une architecture, ou faire proposer des corrections (Ctrl+J)"
        >
          ✦ Assistant
        </Btn>
        <Btn onClick={() => store().setImportOpen(true)} disabled={locked} title="Importer une liste d'équipements (Ctrl+I)">
          Import rapide
        </Btn>
        <button
          type="button"
          onClick={() => store().setPanel('ha')}
          title="Ouvrir l'analyse de haute disponibilité"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor:
                report.counts.critique > 0 ? '#dc2626' : report.counts.avertissement > 0 ? '#d97706' : '#059669',
            }}
          />
          Haute dispo
          <span className="tabular-nums text-slate-400">{report.score}</span>
        </button>

        <Separator />

        <Btn onClick={() => store().loadSample()} title="Charger le schéma d'exemple">Exemple</Btn>
        <Btn onClick={() => store().newDiagram()} title="Repartir d'un schéma vide">Nouveau</Btn>

        <Separator />

        <Btn onClick={saveProject} title="Enregistrer le projet (.json)">Enregistrer</Btn>
        <Btn onClick={() => fileRef.current?.click()} title="Ouvrir un projet .json ou un schéma draw.io (.drawio, .xml)">
          Ouvrir…
        </Btn>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json,.drawio,.xml"
          className="hidden"
          onChange={(event) => {
            void openProject(event.target.files?.[0])
            event.target.value = ''
          }}
        />

        <Separator />

        <Btn onClick={() => void exportImage('svg')} title="Exporter en SVG vectoriel">SVG</Btn>
        <Btn onClick={() => void exportImage('png')} title="Exporter en PNG (×2)">PNG</Btn>
        <Btn
          onClick={() => void exportPage()}
          title="Page HTML autonome : les quatre vues, toutes les informations, navigation et options d’affichage"
        >
          HTML
        </Btn>
      </div>
    </header>
  )
}

function zoomFromCenter(factor: number) {
  const { canvasSize, zoomAt } = useDiagram.getState()
  zoomAt(factor, canvasSize.width / 2, canvasSize.height / 2)
}

function Separator() {
  return <span className="h-6 w-px bg-slate-200" />
}
