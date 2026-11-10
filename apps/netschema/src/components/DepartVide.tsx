import { ARCHITECTURES } from '../lib/architectures'
import { useDiagram } from '../store/useDiagram'
import { Btn } from './ui'

/**
 * Plan vide : par où commencer.
 *
 * Un plan vide n'affichait qu'une consigne — « glissez un équipement depuis la palette » —
 * et laissait poser les vingt premières boîtes une à une. Il propose maintenant ce qui va
 * plus vite : partir d'une architecture type, la décrire en une phrase, la dicter, ou
 * importer une liste. La palette reste là pour qui préfère dessiner.
 *
 * Le fond laisse passer la souris : on peut toujours glisser un équipement sur le plan,
 * y compris au-dessus de ce panneau.
 */
export function DepartVide() {
  const verrouille = useDiagram((s) => s.diagram.locked === true)
  const store = () => useDiagram.getState()

  if (verrouille) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <p className="max-w-sm rounded-xl border border-dashed border-slate-300 bg-white/80 p-6 text-center text-sm text-slate-500">
          Cette page est vide et verrouillée : déverrouillez-la pour y dessiner.
        </p>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-auto p-6">
      <section
        aria-label="Démarrer un schéma"
        className="pointer-events-auto flex max-h-full w-[760px] max-w-full flex-col gap-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-sm"
      >
        <header>
          <h2 className="text-[15px] font-semibold text-slate-800">Par où commencer ?</h2>
          <p className="text-[12.5px] leading-relaxed text-slate-500">
            Partez d’une architecture type : elle est posée, nommée et raccordée d’un clic, et se
            complète ensuite avec les mêmes mots — «&nbsp;ajoute deux switchs d’accès&nbsp;».
          </p>
        </header>

        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ARCHITECTURES.map((architecture) => (
            <li key={architecture.id}>
              <button
                type="button"
                onClick={() => store().poserArchitecture(architecture.id)}
                className="flex h-full w-full flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-blue-400 hover:bg-blue-50 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
              >
                <span className="text-[13px] font-medium text-slate-800">{architecture.titre}</span>
                <span className="text-[11.5px] leading-snug text-slate-500">{architecture.resume}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <Btn variant="primary" onClick={() => store().setAssistantOpen(true)} title="Décrire l’architecture en français (Ctrl+J)">
            Décrire mon réseau…
          </Btn>
          <Btn onClick={() => store().basculerEcoute()} title="Dicter le schéma à la voix (F2)">
            Dicter
          </Btn>
          <Btn onClick={() => store().setImportOpen(true)} title="Coller une liste d’équipements (Ctrl+I)">
            Importer une liste…
          </Btn>
          <Btn variant="ghost" onClick={() => store().loadSample()}>
            Voir l’exemple
          </Btn>
        </div>
        <p className="text-[11.5px] text-slate-500">
          Ou glissez un équipement depuis la palette de gauche, puis reliez en mode «&nbsp;Relier&nbsp;» (touche L).
        </p>
      </section>
    </div>
  )
}
