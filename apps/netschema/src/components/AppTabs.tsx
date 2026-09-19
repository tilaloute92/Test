import { useDiagram } from '../store/useDiagram'
import { canEdit, useSession } from '../store/useSession'
import type { AppView } from '../types'

/**
 * Bandeau serveur : présent seulement quand l'application est servie par le service
 * NetSchema. Il dit l'essentiel — sous quel compte on travaille, quel schéma est ouvert, et
 * si le travail est enregistré.
 */
function ServerBar() {
  const mode = useSession((s) => s.mode)
  const user = useSession((s) => s.user)
  const saving = useSession((s) => s.saving)
  const savedAt = useSession((s) => s.savedAt)
  const conflict = useSession((s) => s.conflict)
  const currentId = useSession((s) => s.currentId)
  const save = useSession((s) => s.save)
  const signOut = useSession((s) => s.signOut)
  const setProjectsOpen = useSession((s) => s.setProjectsOpen)
  const setUsersOpen = useSession((s) => s.setUsersOpen)

  if (mode !== 'server' || !user) return null

  const label = conflict
    ? 'Conflit : rechargez'
    : saving
      ? 'Enregistrement…'
      : savedAt
        ? `Enregistré ${new Date(savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
        : 'Non enregistré'

  return (
    <div className="ml-auto flex items-center gap-2">
      <button
        type="button"
        onClick={() => setProjectsOpen(true)}
        className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-slate-300 transition hover:bg-white/10"
        title="Schémas du serveur"
      >
        Schémas
      </button>
      {user.role === 'admin' && (
        <button
          type="button"
          onClick={() => setUsersOpen(true)}
          className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-slate-300 transition hover:bg-white/10"
          title="Gérer les comptes"
        >
          Comptes
        </button>
      )}
      {canEdit(user) && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={!currentId || saving}
          className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium transition disabled:opacity-40 ${
            conflict ? 'bg-red-500/20 text-red-200 hover:bg-red-500/30' : 'text-slate-300 hover:bg-white/10'
          }`}
          title="Enregistrer sur le serveur (Ctrl+S)"
        >
          {label}
        </button>
      )}
      <span className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white">
        {user.displayName}
        <span className="text-slate-400">· {user.role}</span>
      </span>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-md px-2 py-1.5 text-[12px] text-slate-400 transition hover:bg-white/10 hover:text-white"
        title="Se déconnecter"
      >
        Quitter
      </button>
    </div>
  )
}

const TABS: { id: AppView; label: string; hint: string }[] = [
  { id: 'diagram', label: 'Schéma', hint: 'Cartographie et architecture' },
  { id: 'inventory', label: 'Inventaire', hint: 'Parc, garanties, responsables' },
  { id: 'racks', label: 'Baies', hint: 'Implantation physique en salle' },
  { id: 'flows', label: 'Flux', hint: 'Matrice de flux et traçage de chemin' },
  { id: 'discovery', label: 'Découverte', hint: 'Relevés réseau à interpréter' },
  { id: 'dossier', label: 'Dossier', hint: 'Complétude, dossier technique, comparaison de versions' },
  { id: 'guide', label: 'Guide', hint: "Mode d'emploi de l'application" },
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
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition ${
          voiceOpen ? 'bg-white text-slate-900' : 'text-slate-300 hover:bg-white/10'
        }`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
        </svg>
        Voix
      </button>
      <ServerBar />

      <span className="text-[11px] text-slate-400">
        {nodes} équipement(s) · {racks} baie(s)
      </span>
    </nav>
  )
}
