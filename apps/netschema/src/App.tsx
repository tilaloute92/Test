import { Suspense, lazy, useEffect, useRef } from 'react'
import { AppTabs } from './components/AppTabs'
import { Canvas } from './components/Canvas'
import { VoicePanel } from './components/VoicePanel'
import { CommandPalette } from './components/CommandPalette'
import { QuickImportDialog } from './components/QuickImportDialog'
import { Inspector } from './components/Inspector'
import { Palette } from './components/Palette'
import { Toolbar } from './components/Toolbar'
import { LoginView } from './components/LoginView'
import { ProjectsDialog } from './components/ProjectsDialog'
import { useDiagram } from './store/useDiagram'
import { canEdit, useSession } from './store/useSession'

// Les modules secondaires ne sont chargés qu'à leur première ouverture : l'écran de départ
// — le schéma — n'a pas à transporter l'inventaire, les baies, la découverte ni le guide.
const InventoryView = lazy(() => import('./components/InventoryView').then((m) => ({ default: m.InventoryView })))
const RackView = lazy(() => import('./components/RackView').then((m) => ({ default: m.RackView })))
const DiscoveryView = lazy(() => import('./components/DiscoveryView').then((m) => ({ default: m.DiscoveryView })))
const GuideView = lazy(() => import('./components/GuideView').then((m) => ({ default: m.GuideView })))

function ModuleEnChargement() {
  return <div className="flex flex-1 items-center justify-center text-[13px] text-slate-500">Chargement du module…</div>
}

export default function App() {
  const svgRef = useRef<SVGSVGElement>(null)
  const toast = useDiagram((s) => s.toast)
  const appView = useDiagram((s) => s.appView)
  const sessionReady = useSession((s) => s.ready)
  const sessionMode = useSession((s) => s.mode)
  const user = useSession((s) => s.user)

  // Le mode — local ou serveur — se découvre au démarrage, en une seule requête.
  useEffect(() => {
    void useSession.getState().start()
  }, [])

  /**
   * Enregistrement automatique sur le serveur : quelques secondes après la dernière
   * modification, comme on l'attend d'une application partagée. La sauvegarde locale du
   * navigateur continue en parallèle, elle sert de filet.
   */
  useEffect(() => {
    if (sessionMode !== 'server' || !canEdit(user)) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = useDiagram.subscribe((state, previous) => {
      if (state.diagram === previous.diagram) return
      clearTimeout(timer)
      timer = setTimeout(() => void useSession.getState().save(), 2500)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [sessionMode, user])

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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (useSession.getState().mode === 'server') void useSession.getState().save()
        return
      }
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const store = useDiagram.getState()
      // Les raccourcis d'édition ne valent que dans le module schéma.
      if (store.appView !== 'diagram' && event.key !== 'Escape') return

      // Schéma verrouillé : seuls la recherche et l'échappement restent actifs.
      const readOnly = store.diagram.locked === true
      const editing = !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') && event.key !== 'Escape'
      if (readOnly && editing) {
        if (['Delete', 'Backspace', ']', '[', 'l', 'L'].includes(event.key) || event.ctrlKey || event.metaKey) {
          store.notify('Schéma verrouillé : déverrouillez-le pour le modifier.')
        }
        return
      }

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

  if (!sessionReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-100 text-[13px] text-slate-500">
        Chargement…
      </div>
    )
  }

  if (sessionMode === 'server' && !user) return <LoginView />

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-100 text-slate-900">
      <AppTabs />
      <ProjectsDialog />
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
      {appView !== 'diagram' && (
        <Suspense fallback={<ModuleEnChargement />}>
          {appView === 'inventory' && <InventoryView />}
          {appView === 'racks' && <RackView />}
          {appView === 'discovery' && <DiscoveryView />}
          {appView === 'guide' && <GuideView />}
        </Suspense>
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-[13px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
