import { useRef } from 'react'
import { Btn } from './ui'
import { downloadBlob, downloadPng, downloadSvg, slugify } from '../lib/exportImage'
import { diagramFileContent, readDiagramFile } from '../lib/storage'
import { useDiagram } from '../store/useDiagram'
import type { DetailLevel, OsiView } from '../types'
import { useAudit } from '../store/useAudit'

export function Toolbar({ svgRef }: { svgRef: React.RefObject<SVGSVGElement | null> }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const title = useDiagram((s) => s.diagram.title)
  const mode = useDiagram((s) => s.mode)
  const zoom = useDiagram((s) => s.view.zoom)
  const canUndo = useDiagram((s) => s.past.length > 0)
  const canRedo = useDiagram((s) => s.future.length > 0)
  const hasSelection = useDiagram((s) => s.selectedNodes.length + s.selectedLinks.length > 0)
  const report = useAudit()
  const detail = useDiagram((s) => s.detail)
  const osi = useDiagram((s) => s.osi)

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

  const saveProject = () => {
    const diagram = store().diagram
    downloadBlob(
      new Blob([diagramFileContent(diagram)], { type: 'application/json' }),
      `${slugify(diagram.title)}.json`,
    )
  }

  const openProject = async (file: File | undefined) => {
    if (!file) return
    try {
      store().loadDiagram(await readDiagramFile(file))
      store().notify(`« ${file.name} » chargé.`)
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
        title="Relier deux équipements (L)"
      >
        Relier
      </Btn>
      <Btn variant="danger" onClick={() => store().deleteSelection()} disabled={!hasSelection} title="Supprimer (Suppr)">
        Supprimer
      </Btn>

      <Separator />

      <Btn variant="primary" onClick={() => store().applyAutoLayout()} title="Replacer automatiquement les équipements">
        Placement auto
      </Btn>
      <Btn onClick={() => store().fitView()} title="Ajuster à la fenêtre">Ajuster</Btn>
      <div className="flex items-center gap-1">
        <Btn variant="ghost" onClick={() => zoomFromCenter(0.85)} title="Dézoomer">−</Btn>
        <span className="w-11 text-center text-[12px] tabular-nums text-slate-500">
          {Math.round(zoom * 100)}%
        </span>
        <Btn variant="ghost" onClick={() => zoomFromCenter(1.18)} title="Zoomer">+</Btn>
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
        <Btn onClick={() => store().setImportOpen(true)} title="Importer une liste d'équipements (Ctrl+I)">
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
        <Btn onClick={() => fileRef.current?.click()} title="Ouvrir un projet (.json)">Ouvrir…</Btn>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            void openProject(event.target.files?.[0])
            event.target.value = ''
          }}
        />

        <Separator />

        <Btn onClick={() => void exportImage('svg')} title="Exporter en SVG vectoriel">SVG</Btn>
        <Btn onClick={() => void exportImage('png')} title="Exporter en PNG (×2)">PNG</Btn>
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
