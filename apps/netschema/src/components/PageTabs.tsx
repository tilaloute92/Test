import { useEffect, useRef, useState } from 'react'
import { useDiagram } from '../store/useDiagram'
import { canEdit, useSession } from '../store/useSession'

/**
 * Onglets de pages, en bas de la fenêtre.
 *
 * Un dossier réseau tient rarement sur un seul schéma : le siège et l'agence, la vue logique
 * et la vue physique, l'avant et l'après d'une migration. Les garder dans un même document —
 * un même fichier, un même enregistrement serveur — évite cinq fichiers qui divergent.
 *
 * Chaque page porte son nom, son verrou et son contenu ; elle reste un schéma complet, qu'on
 * peut exporter seule.
 */

function Cadenas({ ferme }: { ferme: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2.2}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      {ferme ? <path d="M8 11V8a4 4 0 0 1 8 0v3" /> : <path d="M8 11V8a4 4 0 0 1 7.5-2" />}
    </svg>
  )
}

export function PageTabs() {
  const pages = useDiagram((s) => s.pages)
  const active = useDiagram((s) => s.activePage)
  // La page ouverte vit dans `diagram` : c'est là qu'il faut lire son compte d'équipements,
  // la copie rangée dans `pages` ne se met à jour qu'au changement d'onglet.
  const equipementsCourants = useDiagram((s) => s.diagram.nodes.length)
  const pageName = useDiagram((s) => s.diagram.pageName)
  const pageLocked = useDiagram((s) => s.diagram.locked === true)
  const user = useSession((s) => s.user)
  const sessionMode = useSession((s) => s.mode)
  const lecteur = sessionMode === 'server' && !canEdit(user)

  const [renomme, setRenomme] = useState<number | null>(null)
  const [brouillon, setBrouillon] = useState('')
  // Le menu est posé en position fixe : la barre d'onglets défile horizontalement, et un
  // menu enfermé dans un conteneur qui défile se retrouve rogné ou passe derrière le plan.
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null)
  const champRef = useRef<HTMLInputElement>(null)
  const store = useDiagram.getState

  useEffect(() => {
    if (renomme !== null) champRef.current?.select()
  }, [renomme])

  // Un clic ailleurs referme le menu : c'est ce qu'on attend d'un menu contextuel.
  useEffect(() => {
    if (!menu) return
    const fermer = () => setMenu(null)
    window.addEventListener('pointerdown', fermer)
    return () => window.removeEventListener('pointerdown', fermer)
  }, [menu])

  const valider = () => {
    if (renomme !== null) store().renamePage(renomme, brouillon)
    setRenomme(null)
  }

  return (
    <div
      data-export="false"
      className="flex h-9 flex-none items-center gap-1 overflow-x-auto border-t border-slate-200 bg-slate-100 px-2"
    >
      {pages.map((page, index) => {
        const courante = index === active
        const verrouillee = page.locked === true
        return (
          <div key={`${page.pageName}-${index}`} className="relative flex-none">
            {renomme === index ? (
              <input
                ref={champRef}
                value={brouillon}
                onChange={(event) => setBrouillon(event.target.value)}
                onBlur={valider}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') valider()
                  if (event.key === 'Escape') setRenomme(null)
                }}
                className="h-7 w-36 rounded-t-md border border-blue-500 px-2 text-[12.5px] outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => store().selectPage(index)}
                onDoubleClick={() => {
                  if (verrouillee || lecteur) return
                  setBrouillon(page.pageName ?? 'Schéma')
                  setRenomme(index)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  store().selectPage(index)
                  const rect = event.currentTarget.getBoundingClientRect()
                  setMenu({ index, x: rect.left, y: window.innerHeight - rect.top + 4 })
                }}
                title={
                  verrouillee
                    ? 'Page verrouillée — clic droit pour les options'
                    : 'Double-clic pour renommer · clic droit pour les options'
                }
                className={`flex h-7 items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-[12.5px] transition ${
                  courante
                    ? 'border-slate-300 bg-white font-semibold text-slate-900'
                    : 'border-transparent bg-slate-200/70 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {verrouillee && (
                  <span className="text-amber-600">
                    <Cadenas ferme />
                  </span>
                )}
                {page.pageName ?? `Schéma ${index + 1}`}
                <span className="text-[10.5px] text-slate-400">
                  {courante ? equipementsCourants : page.nodes.length}
                </span>
              </button>
            )}

            {menu?.index === index && (
              <div
                onPointerDown={(event) => event.stopPropagation()}
                style={{ left: menu.x, bottom: menu.y }}
                className="fixed z-[60] w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-[13px] shadow-xl"
              >
                <MenuItem
                  label="Renommer"
                  hint="Double-clic"
                  disabled={verrouillee || lecteur}
                  onClick={() => {
                    setBrouillon(page.pageName ?? 'Schéma')
                    setRenomme(index)
                    setMenu(null)
                  }}
                />
                <MenuItem
                  label={verrouillee ? 'Déverrouiller la page' : 'Verrouiller la page'}
                  disabled={lecteur}
                  onClick={() => {
                    store().setPageLocked(index, !verrouillee)
                    setMenu(null)
                  }}
                />
                <MenuItem
                  label="Dupliquer"
                  disabled={lecteur}
                  onClick={() => {
                    store().duplicatePage(index)
                    setMenu(null)
                  }}
                />
                <div className="my-1 border-t border-slate-100" />
                <MenuItem
                  label="Déplacer vers la gauche"
                  disabled={index === 0 || lecteur}
                  onClick={() => {
                    store().movePage(index, -1)
                    setMenu(null)
                  }}
                />
                <MenuItem
                  label="Déplacer vers la droite"
                  disabled={index === pages.length - 1 || lecteur}
                  onClick={() => {
                    store().movePage(index, 1)
                    setMenu(null)
                  }}
                />
                <div className="my-1 border-t border-slate-100" />
                <MenuItem
                  label="Supprimer la page"
                  danger
                  disabled={pages.length <= 1 || verrouillee || lecteur}
                  onClick={() => {
                    store().removePage(index)
                    setMenu(null)
                  }}
                />
              </div>
            )}
          </div>
        )
      })}

      <button
        type="button"
        onClick={() => store().addPage()}
        disabled={lecteur}
        title="Ajouter une page"
        className="ml-1 flex h-6 w-6 flex-none items-center justify-center rounded-md border border-slate-300 bg-white text-[15px] leading-none text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>

      <span className="ml-auto flex-none pr-1 text-[11.5px] text-slate-500">
        {pages.length} page{pages.length > 1 ? 's' : ''}
        {pageLocked && <span className="pl-2 text-amber-600">« {pageName} » verrouillée</span>}
      </span>
    </div>
  )
}

function MenuItem({
  label,
  hint,
  onClick,
  disabled,
  danger,
}: {
  label: string
  hint?: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-35 ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      {label}
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </button>
  )
}
