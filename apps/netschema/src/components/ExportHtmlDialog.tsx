import { useMemo, useState } from 'react'
import {
  choixParDefaut,
  choixValide,
  lireChoixMemorise,
  resumeChoix,
  TABLEAUX_EXPORT,
  vuesExportables,
  type ChoixExport,
  type TableauExport,
} from '../lib/exportChoix'
import { exporterPageHtml } from '../lib/exportPageHtml'
import { useDiagram } from '../store/useDiagram'
import { Btn } from './ui'

/**
 * Export en page HTML : choisir ce qu'on y met.
 *
 * Jusqu'ici l'export sortait tout — chaque page du document dans les quatre vues. On coche
 * maintenant les onglets (les pages), les vues et les tableaux voulus ; le pied dit ce que
 * contiendra le fichier avant qu'on le produise. Les vues et les tableaux choisis sont
 * retenus pour la fois suivante.
 */
export function ExportHtmlDialog() {
  const ouvert = useDiagram((s) => s.exportHtmlOuvert)
  // Monté à l'ouverture seulement : chaque ouverture repart du document tel qu'il est.
  return ouvert ? <Dialogue /> : null
}

function Dialogue() {
  const diagram = useDiagram((s) => s.diagram)
  const pagesStockees = useDiagram((s) => s.pages)
  const pageActive = useDiagram((s) => s.activePage)
  const logiqueCourante = useDiagram((s) => s.vueLogique)
  const pages = useMemo(
    () => pagesStockees.map((page, index) => (index === pageActive ? diagram : page)),
    [pagesStockees, pageActive, diagram],
  )
  const vues = useMemo(() => vuesExportables(), [])

  const [choix, setChoix] = useState<ChoixExport>(() => choixParDefaut(pages.length, logiqueCourante, lireChoixMemorise()))
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const fermer = () => useDiagram.getState().setExportHtmlOuvert(false)

  const basculer = <T,>(liste: T[], valeur: T): T[] =>
    liste.includes(valeur) ? liste.filter((item) => item !== valeur) : [...liste, valeur]

  const fluxPresents = choix.pages.some((index) => (pages[index]?.flows ?? []).length > 0)
  const valide = choixValide(choix)

  const exporter = async () => {
    if (!valide || enCours) return
    setEnCours(true)
    setErreur(null)
    try {
      const fait = await exporterPageHtml(choix)
      useDiagram
        .getState()
        .notify(`Page HTML générée : ${fait.pages} page(s) × ${fait.vues} vue(s) dans « ${fait.fichier} ».`)
      fermer()
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : 'L’export a échoué.')
      setEnCours(false)
    }
  }

  const titreDeSection = 'pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500'
  const ligne = 'flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 hover:bg-slate-50'
  const caseACocher = 'mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-blue-600'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-6" onPointerDown={enCours ? undefined : fermer}>
      <div
        role="dialog"
        aria-label="Exporter en page HTML"
        className="flex max-h-[88vh] w-[760px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-[15px] font-semibold text-slate-800">Exporter en page HTML</h2>
          <p className="text-[12px] leading-relaxed text-slate-500">
            Un seul fichier, qui s’ouvre d’un double-clic sans NetSchema ni connexion. Cochez ce qu’il doit
            contenir : les onglets (les pages du document), les vues de chaque page, et les tableaux.
          </p>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-x-6 gap-y-4 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          <section aria-label="Pages à exporter">
            <div className="flex items-baseline gap-2">
              <h3 className={titreDeSection}>Onglets (pages)</h3>
              <span className="ml-auto flex gap-2 whitespace-nowrap text-[11.5px]">
                <button type="button" className="text-blue-700 hover:underline" onClick={() => setChoix((c) => ({ ...c, pages: pages.map((_, index) => index) }))}>
                  Toutes
                </button>
                <button type="button" className="text-blue-700 hover:underline" onClick={() => setChoix((c) => ({ ...c, pages: [pageActive] }))}>
                  Page ouverte
                </button>
                <button type="button" className="text-blue-700 hover:underline" onClick={() => setChoix((c) => ({ ...c, pages: [] }))}>
                  Aucune
                </button>
              </span>
            </div>
            <ul className="flex flex-col">
              {pages.map((page, index) => (
                <li key={index}>
                  <label className={ligne}>
                    <input
                      type="checkbox"
                      className={caseACocher}
                      checked={choix.pages.includes(index)}
                      onChange={() => setChoix((c) => ({ ...c, pages: basculer(c.pages, index) }))}
                    />
                    <span className="min-w-0 text-[13px] text-slate-800">
                      {page.pageName ?? `Schéma ${index + 1}`}
                      <span className="pl-1.5 text-[11.5px] text-slate-500">
                        {page.nodes.length} équipement(s){index === pageActive ? ' · ouverte' : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <h3 className={`${titreDeSection} pt-4`}>Tableaux joints</h3>
            <ul className="flex flex-col">
              {TABLEAUX_EXPORT.map((tableau) => {
                const sansObjet = tableau.id === 'flux' && !fluxPresents
                return (
                  <li key={tableau.id}>
                    <label className={`${ligne} ${sansObjet ? 'cursor-default text-slate-500' : ''}`}>
                      <input
                        type="checkbox"
                        className={caseACocher}
                        disabled={sansObjet}
                        checked={!sansObjet && choix.tableaux.includes(tableau.id)}
                        onChange={() => setChoix((c) => ({ ...c, tableaux: basculer<TableauExport>(c.tableaux, tableau.id) }))}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] text-slate-800">{tableau.label}</span>
                        <span className="block text-[11.5px] leading-snug text-slate-500">
                          {sansObjet ? 'Aucun flux dans les pages choisies.' : tableau.hint}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </section>

          <section aria-label="Vues à exporter">
            <div className="flex items-baseline gap-2">
              <h3 className={titreDeSection}>Vues de chaque page</h3>
              <span className="ml-auto flex gap-2 text-[11.5px]">
                <button type="button" className="text-blue-700 hover:underline" onClick={() => setChoix((c) => ({ ...c, vues: vues.map((vue) => vue.id) }))}>
                  Toutes
                </button>
                <button type="button" className="text-blue-700 hover:underline" onClick={() => setChoix((c) => ({ ...c, vues: [] }))}>
                  Aucune
                </button>
              </span>
            </div>
            <ul className="flex flex-col">
              {vues.map((vue) => (
                <li key={vue.id}>
                  <label className={ligne}>
                    <input
                      type="checkbox"
                      className={caseACocher}
                      checked={choix.vues.includes(vue.id)}
                      onChange={() => setChoix((c) => ({ ...c, vues: basculer(c.vues, vue.id) }))}
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] text-slate-800">{vue.label}</span>
                      <span className="block text-[11.5px] leading-snug text-slate-500">{vue.hint}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {erreur && <p className="border-t border-amber-100 bg-amber-50 px-5 py-2 text-[12px] text-amber-800">{erreur}</p>}

        <footer className="flex items-center gap-3 border-t border-slate-100 px-5 py-3">
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-slate-600" aria-live="polite">
            {valide ? (
              <>
                Le fichier contiendra <b>{resumeChoix({ ...choix, tableaux: choix.tableaux.filter((id) => id !== 'flux' || fluxPresents) })}</b>.
              </>
            ) : (
              'Cochez au moins une page et une vue.'
            )}
          </p>
          <Btn onClick={fermer} disabled={enCours}>
            Annuler
          </Btn>
          <Btn variant="primary" onClick={() => void exporter()} disabled={!valide || enCours}>
            {enCours ? 'Export en cours…' : 'Exporter'}
          </Btn>
        </footer>
      </div>
    </div>
  )
}
