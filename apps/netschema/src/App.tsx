import { Suspense, lazy, useEffect, useRef } from 'react'
import { AppTabs } from './components/AppTabs'
import { Canvas } from './components/Canvas'
import { VoicePanel } from './components/VoicePanel'
import { CommandPalette } from './components/CommandPalette'
import { QuickImportDialog } from './components/QuickImportDialog'
import { Inspector } from './components/Inspector'
import { PageTabs } from './components/PageTabs'
import { Palette } from './components/Palette'
import { Toolbar } from './components/Toolbar'
import { LoginView } from './components/LoginView'
import { ProjectsDialog } from './components/ProjectsDialog'
import { UsersDialog } from './components/UsersDialog'
import { chargerLogos } from './lib/vendorLogos'
import { GRID, useDiagram } from './store/useDiagram'
import { canEdit, useSession } from './store/useSession'

// Les modules secondaires ne sont chargés qu'à leur première ouverture : l'écran de départ
// — le schéma — n'a pas à transporter l'inventaire, les baies, la découverte ni le guide.
const InventoryView = lazy(() => import('./components/InventoryView').then((m) => ({ default: m.InventoryView })))
const RackView = lazy(() => import('./components/RackView').then((m) => ({ default: m.RackView })))
const FlowsView = lazy(() => import('./components/FlowsView').then((m) => ({ default: m.FlowsView })))
const DossierView = lazy(() => import('./components/DossierView').then((m) => ({ default: m.DossierView })))
const DiscoveryView = lazy(() => import('./components/DiscoveryView').then((m) => ({ default: m.DiscoveryView })))
const GuideView = lazy(() => import('./components/GuideView').then((m) => ({ default: m.GuideView })))

/** Languette de réouverture d'un bandeau masqué. */
function Languette({ cote, onClick }: { cote: 'gauche' | 'droite'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Afficher le bandeau de ${cote}`}
      className={`flex w-4 flex-none items-center justify-center border-slate-200 bg-slate-100 text-[10px] text-slate-500 transition hover:bg-slate-200 ${
        cote === 'gauche' ? 'border-r' : 'border-l'
      }`}
    >
      {cote === 'gauche' ? '›' : '‹'}
    </button>
  )
}

function ModuleEnChargement() {
  return <div className="flex flex-1 items-center justify-center text-[13px] text-slate-500">Chargement du module…</div>
}

export default function App() {
  const svgRef = useRef<SVGSVGElement>(null)
  const toast = useDiagram((s) => s.toast)
  const appView = useDiagram((s) => s.appView)
  const paletteOpen = useDiagram((s) => s.paletteOpen)
  const inspectorOpen = useDiagram((s) => s.inspectorOpen)
  const sessionReady = useSession((s) => s.ready)
  const sessionMode = useSession((s) => s.mode)
  const user = useSession((s) => s.user)

  // Le mode — local ou serveur — se découvre au démarrage, en une seule requête.
  useEffect(() => {
    void useSession.getState().start()
    // Logos constructeurs déposés par l'installation : absents, on garde les monogrammes.
    void chargerLogos().then((nombre) => {
      if (nombre > 0) useDiagram.getState().bumpCatalog()
    })
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
      // Tout sélectionner : le réflexe de n'importe quel éditeur.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        store.selectAll()
        return
      }
      /*
        Flèches du clavier : déplacer la sélection au pas de la grille, d'un pixel avec Alt
        (le réglage fin), de cinq pas avec Maj. C'est ce qui manque le plus quand on range un
        schéma à la souris : la dernière correction se fait au clavier.
      */
      if (event.key.startsWith('Arrow') && store.selectedNodes.length > 0) {
        event.preventDefault()
        const pas = event.altKey ? 1 : event.shiftKey ? GRID * 5 : GRID
        const dx = event.key === 'ArrowLeft' ? -pas : event.key === 'ArrowRight' ? pas : 0
        const dy = event.key === 'ArrowUp' ? -pas : event.key === 'ArrowDown' ? pas : 0
        store.pushHistory()
        store.moveNodes(store.selectedNodes, dx, dy)
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
        return
      }
      // N comme note : le geste d'annoter revient souvent pendant une relecture.
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        store.addAnnotation('note')
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
      <UsersDialog />
      <CommandPalette svgRef={svgRef} />
      <QuickImportDialog />
      <VoicePanel />

      {appView === 'diagram' && (
        <>
          <Toolbar svgRef={svgRef} />
          <div className="flex min-h-0 flex-1">
            {paletteOpen && <Palette />}
            {/* Bandeau replié : une languette le ramène, sans avoir à retrouver le bouton. */}
            {!paletteOpen && (
              <Languette cote="gauche" onClick={() => useDiagram.getState().setPanelOpen('palette', true)} />
            )}
            <main className="min-w-0 flex-1">
              <Canvas svgRef={svgRef} />
            </main>
            {!inspectorOpen && (
              <Languette cote="droite" onClick={() => useDiagram.getState().setPanelOpen('inspecteur', true)} />
            )}
            {inspectorOpen && <Inspector />}
          </div>
          <PageTabs />
        </>
      )}
      {appView !== 'diagram' && (
        <Suspense fallback={<ModuleEnChargement />}>
          {appView === 'inventory' && <InventoryView />}
          {appView === 'racks' && <RackView />}
          {appView === 'flows' && <FlowsView />}
          {appView === 'discovery' && <DiscoveryView />}
          {appView === 'dossier' && <DossierView />}
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
