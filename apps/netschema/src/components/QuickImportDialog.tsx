import { useState } from 'react'
import { Btn } from './ui'
import { QUICK_IMPORT_EXAMPLE } from '../lib/quickImport'
import { useDiagram } from '../store/useDiagram'

/**
 * Import rapide : coller une liste d'équipements et de liaisons plutôt que de les poser
 * un par un. C'est le chemin le plus court entre un tableau d'inventaire et un schéma —
 * le placement automatique se charge ensuite de la mise en page.
 */
export function QuickImportDialog() {
  const open = useDiagram((s) => s.importOpen)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [warnings, setWarnings] = useState<string[]>([])

  if (!open) return null

  const close = () => {
    useDiagram.getState().setImportOpen(false)
    setWarnings([])
  }

  const run = () => {
    const result = useDiagram.getState().importText(text, mode)
    if (result.nodes === 0 && result.links === 0) {
      setWarnings(['Rien à importer : vérifiez le format des lignes.', ...result.warnings])
      return
    }
    useDiagram
      .getState()
      .notify(`${result.nodes} équipement(s) et ${result.links} liaison(s) importés.`)
    if (result.warnings.length > 0) {
      setWarnings(result.warnings)
      return
    }
    setText('')
    close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-6" onPointerDown={close}>
      <div
        className="flex max-h-[85vh] w-[760px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-[15px] font-semibold text-slate-800">Import rapide</h2>
          <p className="text-[12px] text-slate-500">
            Une ligne par équipement, une ligne par liaison. Le type accepte l’identifiant, le
            libellé ou un synonyme ; s’il manque, il est deviné d’après le nom.
          </p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            placeholder={QUICK_IMPORT_EXAMPLE}
            className="min-h-[240px] flex-1 resize-none rounded-lg border border-slate-200 p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />

          {warnings.length > 0 && (
            <ul className="max-h-24 overflow-y-auto rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">
              {warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} className="accent-blue-600" />
              Ajouter au schéma
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
              <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-blue-600" />
              Remplacer le schéma
            </label>
            <Btn onClick={() => setText(QUICK_IMPORT_EXAMPLE)}>Insérer un exemple</Btn>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Btn onClick={close}>Annuler</Btn>
          <Btn variant="primary" onClick={run} disabled={!text.trim()}>
            Importer
          </Btn>
        </footer>
      </div>
    </div>
  )
}
