import { useEffect, useRef } from 'react'
import { AppTabs } from './components/AppTabs'
import { Canvas } from './components/Canvas'
import { DiscoveryView } from './components/DiscoveryView'
import { GuideView } from './components/GuideView'
import { InventoryView } from './components/InventoryView'
import { RackView } from './components/RackView'
import { VoicePanel } from './components/VoicePanel'
import { CommandPalette } from './components/CommandPalette'
import { QuickImportDialog } from './components/QuickImportDialog'
import { Inspector } from './components/Inspector'
import { Palette } from './components/Palette'
import { Toolbar } from './components/Toolbar'
import { useDiagram } from './store/useDiagram'

export default function App() {
  const svgRef = useRef<SVGSVGElement>(null)
  const toast = useDiagram((s) => s.toast)
  const appView = useDiagram((s) => s.appView)

  useEffect(() => {
    // Première ouverture : on cadre le schéma sur la fenêtre.
    const id = requestAnimationFrame(() => useDiagram.getState().fitView())
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => useDiagram.getState().notify(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const store = useDiagram.getState()
      // Les raccourcis d'édition ne valent que dans le module schéma.
      if (store.appView !== 'diagram' && event.key !== 'Escape') return

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        store.setCommandOpen(true)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        store.duplicateSelection()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        store.setImportOpen(true)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      // Plan d'affichage : mêmes touches que dans les outils de dessin.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        store.reorderNodes(store.selectedNodes, 'front')
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        store.reorderNodes(store.selectedNodes, 'back')
        return
      }
      if (!event.ctrlKey && !event.metaKey && (event.key === ']' || event.key === '[')) {
        event.preventDefault()
        store.reorderNodes(store.selectedNodes, event.key === ']' ? 'forward' : 'backward')
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        store.deleteSelection()
        return
      }
      if (event.key === 'Escape') {
        store.setCommandOpen(false)
        store.setImportOpen(false)
        store.setMode('select')
        store.clearSelection()
        return
      }
      if (event.key.toLowerCase() === 'l') {
        store.setMode(store.mode === 'connect' ? 'select' : 'connect')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-100 text-slate-900">
      <AppTabs />
      <CommandPalette svgRef={svgRef} />
      <QuickImportDialog />
      <VoicePanel />

      {appView === 'diagram' && (
        <>
          <Toolbar svgRef={svgRef} />
          <div className="flex min-h-0 flex-1">
            <Palette />
            <main className="min-w-0 flex-1">
              <Canvas svgRef={svgRef} />
            </main>
            <Inspector />
          </div>
        </>
      )}
      {appView === 'inventory' && <InventoryView />}
      {appView === 'racks' && <RackView />}
      {appView === 'discovery' && <DiscoveryView />}
      {appView === 'guide' && <GuideView />}

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-[13px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
