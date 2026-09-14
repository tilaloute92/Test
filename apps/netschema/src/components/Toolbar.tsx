import { useRef } from 'react'
import { Btn } from './ui'
import { downloadBlob, downloadPng, downloadSvg, slugify } from '../lib/exportImage'
import { diagramFileContent, readDiagramFile } from '../lib/storage'
import { useDiagram } from '../store/useDiagram'
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

      <div className="ml-auto flex items-center gap-2">
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
