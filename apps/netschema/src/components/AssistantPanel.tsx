import { useMemo, useState } from 'react'
import { Btn } from './ui'
import {
  analyserDescription,
  EXEMPLE_ASSISTANT,
  suggestionsAssistant,
  type PlanAssistant,
  type Suggestion,
} from '../lib/assistant'
import { useDiagram } from '../store/useDiagram'

/**
 * Assistant de conception.
 *
 * Deux usages, deux onglets : décrire une architecture pour la faire construire, et laisser
 * l'assistant proposer les corrections qu'il sait appliquer sur le schéma ouvert.
 *
 * Rien n'est modifié avant acceptation : le plan est affiché étape par étape, avec ce qui n'a
 * pas été compris. C'est ce qui distingue un assistant utile d'une boîte noire — on voit ce
 * qu'il a compris avant qu'il n'y touche.
 */
export function AssistantPanel() {
  const open = useDiagram((s) => s.assistantOpen)
  const diagram = useDiagram((s) => s.diagram)
  const locked = useDiagram((s) => s.diagram.locked === true)
  const [onglet, setOnglet] = useState<'construire' | 'ameliorer'>('construire')
  const [texte, setTexte] = useState('')
  const [plan, setPlan] = useState<PlanAssistant | null>(null)
  const [appliquees, setAppliquees] = useState<string[]>([])
  // Liste figée pendant qu'on applique : sans cela chaque correction retire sa carte et les
  // suivantes remontent sous le curseur. On la dégèle avec « Réanalyser ».
  const [figees, setFigees] = useState<Suggestion[] | null>(null)

  const propositions = useMemo(
    () => (open ? suggestionsAssistant(diagram) : []),
    [open, diagram],
  )
  const affichees = figees ?? propositions
  const nouvelles = figees
    ? propositions.filter((suggestion) => !figees.some((gelee) => gelee.id === suggestion.id)).length
    : 0

  if (!open) return null

  const fermer = () => {
    useDiagram.getState().setAssistantOpen(false)
    setPlan(null)
    setFigees(null)
    setAppliquees([])
  }

  const analyser = () => setPlan(analyserDescription(texte, diagram))

  const appliquer = () => {
    if (!plan) return
    const operations = plan.etapes.flatMap((etape) => etape.operations)
    const { noeuds, liaisons } = useDiagram.getState().appliquerPlan(operations)
    useDiagram
      .getState()
      .notify(
        `${noeuds} équipement(s) et ${liaisons} liaison(s) ajoutés. « Placement auto » range l’ensemble.`,
      )
    setPlan(null)
    setTexte('')
    fermer()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-6"
      onPointerDown={fermer}
    >
      <div
        className="flex max-h-[85vh] w-[820px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-[15px] font-semibold text-slate-800">Assistant de conception</h2>
          <p className="text-[12px] leading-relaxed text-slate-500">
            Décrivez l’architecture en français, l’assistant la construit ; ou laissez-le
            proposer ce qu’il sait corriger sur le schéma ouvert. Il annonce toujours ce qu’il
            va faire avant de le faire, et <b>rien ne sort du poste</b> : il s’appuie sur le
            catalogue, les règles de liaison et les mécanismes de haute disponibilité de
            l’application, pas sur un service distant.
          </p>
        </header>

        <div className="flex gap-1 border-b border-slate-100 px-5 pt-3">
          {(
            [
              ['construire', 'Construire'],
              ['ameliorer', `Améliorer (${propositions.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setOnglet(id)}
              className={`rounded-t-lg px-3 py-1.5 text-[13px] font-medium transition ${
                onglet === id
                  ? 'bg-white text-slate-900 ring-1 ring-slate-200 ring-offset-0'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {onglet === 'construire' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
            <textarea
              value={texte}
              onChange={(event) => {
                setTexte(event.target.value)
                setPlan(null)
              }}
              spellCheck={false}
              placeholder={EXEMPLE_ASSISTANT}
              className="h-36 w-full resize-none rounded-lg border border-slate-200 p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Btn variant="primary" onClick={analyser} disabled={texte.trim().length < 3}>
                Analyser la demande
              </Btn>
              <Btn onClick={() => setTexte(EXEMPLE_ASSISTANT)}>Reprendre l’exemple</Btn>
              <span className="text-[11.5px] text-slate-400">
                Une ligne ou une virgule par groupe d’équipements. « deux pare-feu Fortinet en
                grappe actif/passif, zone DMZ »
              </span>
            </div>

            {plan && (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200">
                {plan.etapes.length === 0 ? (
                  <p className="p-4 text-[12.5px] text-slate-500">
                    Rien n’a été reconnu. Nommez les équipements comme dans la palette
                    (« switch cœur », « pare-feu », « hyperviseur », « onduleur »…), un groupe
                    par ligne.
                  </p>
                ) : (
                  <ol className="divide-y divide-slate-100">
                    {plan.etapes.map((etape, index) => (
                      <li key={index} className="flex gap-3 p-3">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-slate-800">{etape.titre}</p>
                          <p className="text-[12px] leading-snug text-slate-500">{etape.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                {plan.ignores.length > 0 && (
                  <p className="border-t border-slate-100 bg-amber-50 p-3 text-[12px] leading-snug text-amber-900">
                    Non compris, et donc ignoré : « {plan.ignores.join(' » · « ')} ».
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 py-4">
            {affichees.length === 0 ? (
              <p className="rounded-lg bg-emerald-50 p-3 text-[12.5px] text-emerald-700">
                Rien à proposer : l’assistant ne voit aucune correction à appliquer
                automatiquement. Le panneau <b>Haute dispo</b> et le module <b>Dossier</b>
                listent ce qui demande une décision de votre part.
              </p>
            ) : (
              affichees.map((suggestion) => {
                const faite = appliquees.includes(suggestion.id)
                return (
                  <article
                    key={suggestion.id}
                    className={`flex items-start gap-3 rounded-lg border p-3 ${
                      faite ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-slate-800">{suggestion.titre}</p>
                      <p className="text-[12px] leading-snug text-slate-500">{suggestion.detail}</p>
                      <p className="pt-0.5 text-[11px] text-slate-400">
                        {suggestion.operations.length} modification(s)
                      </p>
                    </div>
                    <Btn
                      onClick={() => {
                        setFigees(affichees)
                        const { noeuds, liaisons } = useDiagram
                          .getState()
                          .appliquerPlan(suggestion.operations)
                        setAppliquees([...appliquees, suggestion.id])
                        // Une proposition qui ne change que des champs n'ajoute ni nœud ni
                        // liaison : annoncer « 0 / 0 » donnerait l'impression d'un échec.
                        const ajouts = [
                          noeuds > 0 ? `${noeuds} équipement(s)` : '',
                          liaisons > 0 ? `${liaisons} liaison(s)` : '',
                        ].filter(Boolean)
                        useDiagram
                          .getState()
                          .notify(
                            `Appliqué : ${suggestion.titre.toLowerCase()}${
                              ajouts.length > 0
                                ? ` (${ajouts.join(', ')})`
                                : ` (${suggestion.operations.length} champ(s) mis à jour)`
                            }.`,
                          )
                      }}
                      disabled={locked || faite}
                    >
                      {faite ? 'Appliqué' : 'Appliquer'}
                    </Btn>
                  </article>
                )
              })
            )}
            {figees && (
              <div className="flex items-center gap-2 pt-1">
                <Btn onClick={() => { setFigees(null); setAppliquees([]) }}>Réanalyser le schéma</Btn>
                <span className="text-[11.5px] text-slate-400">
                  {nouvelles > 0
                    ? `${nouvelles} nouvelle(s) proposition(s) depuis vos corrections.`
                    : 'Liste figée pendant les corrections.'}
                </span>
              </div>
            )}
          </div>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <p className="text-[11.5px] text-slate-400">
            Un plan appliqué s’annule d’un seul <kbd className="rounded border border-slate-200 bg-slate-50 px-1">Ctrl+Z</kbd>.
          </p>
          <div className="flex gap-2">
            <Btn onClick={fermer}>Fermer</Btn>
            {onglet === 'construire' && (
              <Btn
                variant="primary"
                onClick={appliquer}
                disabled={locked || !plan || plan.etapes.length === 0}
              >
                {plan
                  ? `Appliquer (${plan.noeuds} équipement(s), ${plan.liaisons} liaison(s))`
                  : 'Appliquer'}
              </Btn>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
