import { useDiagram } from '../store/useDiagram'
import type { AppView } from '../types'

const TABS: { id: AppView; label: string; hint: string }[] = [
  { id: 'diagram', label: 'Schéma', hint: 'Cartographie et architecture' },
  { id: 'inventory', label: 'Inventaire', hint: 'Parc, garanties, responsables' },
  { id: 'racks', label: 'Baies', hint: 'Implantation physique en salle' },
  { id: 'discovery', label: 'Découverte', hint: 'Relevés réseau à interpréter' },
]

/** Barre de modules : le schéma n'est qu'une des vues du même jeu de données. */
export function AppTabs() {
  const appView = useDiagram((s) => s.appView)
  const setAppView = useDiagram((s) => s.setAppView)
  const nodes = useDiagram((s) => s.diagram.nodes.length)
  const racks = useDiagram((s) => s.diagram.racks?.length ?? 0)
  const voiceOpen = useDiagram((s) => s.voiceOpen)
  const setVoiceOpen = useDiagram((s) => s.setVoiceOpen)

  return (
    <nav className="flex items-center gap-3 border-b border-slate-200 bg-slate-900 px-3 py-1.5">
      <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-bold tracking-wide text-white">
        NETSCHEMA
      </span>
      <div className="flex gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            title={tab.hint}
            onClick={() => setAppView(tab.id)}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
              appView === tab.id ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setVoiceOpen(!voiceOpen)}
        title="Commande vocale"
        className={`ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition ${
          voiceOpen ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10'
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
        </svg>
        Voix
      </button>
      <span className="text-[11px] text-slate-400">
        {nodes} équipement(s) · {racks} baie(s)
      </span>
    </nav>
  )
}
