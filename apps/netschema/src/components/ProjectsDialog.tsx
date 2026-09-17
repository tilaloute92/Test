import { useState } from 'react'
import { canEdit, useSession } from '../store/useSession'

/** Date lisible : « aujourd'hui 14:32 » dit plus qu'un horodatage complet. */
function when(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? `aujourd’hui ${time}` : `${date.toLocaleDateString('fr-FR')} ${time}`
}

/**
 * Schémas du serveur : ouvrir, créer, supprimer.
 *
 * Sur un serveur partagé, le schéma n'est plus un fichier qu'on se transmet mais un document
 * que plusieurs personnes ouvrent. La liste indique donc qui a enregistré en dernier et
 * quand — c'est ce qu'on regarde avant de modifier quelque chose à deux.
 */
export function ProjectsDialog() {
  const open = useSession((s) => s.projectsOpen)
  const setOpen = useSession((s) => s.setProjectsOpen)
  const projects = useSession((s) => s.projects)
  const currentId = useSession((s) => s.currentId)
  const user = useSession((s) => s.user)
  const openProject = useSession((s) => s.open)
  const createProject = useSession((s) => s.createProject)
  const removeProject = useSession((s) => s.removeProject)
  const [title, setTitle] = useState('')
  const [reprendre, setReprendre] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-6 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-[14px] font-semibold text-slate-800">Schémas du serveur</h2>
          <span className="text-[12px] text-slate-400">{projects.length} document(s)</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto rounded px-2 text-[18px] leading-none text-slate-400 hover:bg-slate-100"
            title="Fermer"
          >
            ×
          </button>
        </header>

        <ul className="max-h-[50vh] overflow-y-auto">
          {projects.length === 0 && (
            <li className="px-4 py-6 text-center text-[13px] text-slate-400">
              Aucun schéma pour l’instant. Créez-en un ci-dessous.
            </li>
          )}
          {projects.map((project) => (
            <li
              key={project.id}
              className={`flex items-center gap-3 border-b border-slate-50 px-4 py-2.5 last:border-0 ${
                project.id === currentId ? 'bg-blue-50/60' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  void openProject(project.id)
                  setOpen(false)
                }}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-[13px] font-medium text-slate-800">
                  {project.title}
                  {project.locked && <span className="pl-2 text-[11px] text-amber-700">verrouillé</span>}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {project.pages && project.pages > 1 ? `${project.pages} pages · ` : ''}
                  {project.nodes} équipement(s) · {project.links} liaison(s) — {project.updatedBy}, {when(project.updatedAt)}
                </p>
              </button>
              {user?.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => setConfirm(confirm === project.id ? null : project.id)}
                  className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-red-600 hover:bg-red-50"
                >
                  {confirm === project.id ? 'Annuler' : 'Supprimer'}
                </button>
              )}
              {confirm === project.id && (
                <button
                  type="button"
                  onClick={() => {
                    void removeProject(project.id)
                    setConfirm(null)
                  }}
                  className="shrink-0 rounded-lg bg-red-600 px-2 py-1 text-[12px] font-medium text-white hover:bg-red-500"
                >
                  Confirmer
                </button>
              )}
            </li>
          ))}
        </ul>

        {canEdit(user) && (
          <form
            className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (!title.trim()) return
              void createProject(title.trim(), reprendre ? 'current' : 'empty')
              setTitle('')
              setOpen(false)
            }}
          >
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Nom du nouveau schéma"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="submit"
              disabled={!title.trim()}
              className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Créer
            </button>
            {/* Sans ce choix, on ne sait pas si « Créer » part de zéro ou publie l'écran courant. */}
            <label className="flex w-full items-center gap-2 text-[12px] text-slate-500">
              <input
                type="checkbox"
                checked={reprendre}
                onChange={(event) => setReprendre(event.target.checked)}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              Partir du schéma actuellement ouvert (sinon, le nouveau schéma est vide)
            </label>
          </form>
        )}
      </div>
    </div>
  )
}
