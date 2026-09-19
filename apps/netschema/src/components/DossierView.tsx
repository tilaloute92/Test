import { useMemo, useRef, useState } from 'react'
import { Btn } from './ui'
import { capturerPages } from '../lib/capture'
import { dossierTechnique } from '../lib/dossier'
import { comparerDocuments, type RapportDiff } from '../lib/diff'
import { downloadBlob, slugify } from '../lib/exportImage'
import { versDrawio } from '../lib/drawioExport'
import { inventoryToCsv } from '../lib/inventory'
import { fluxVersCsv } from '../lib/flows'
import { controlerDossier, type GraviteQualite } from '../lib/quality'
import { readProjectFile } from '../lib/storage'
import { useDiagram } from '../store/useDiagram'

const COULEURS: Record<GraviteQualite, string> = {
  critique: '#dc2626',
  majeur: '#d97706',
  mineur: '#2563eb',
  info: '#64748b',
}

const SENS_COULEURS: Record<string, string> = {
  ajoute: '#059669',
  supprime: '#dc2626',
  modifie: '#d97706',
  deplace: '#94a3b8',
}

const SENS_LABELS: Record<string, string> = {
  ajoute: 'Ajouté',
  supprime: 'Supprimé',
  modifie: 'Modifié',
  deplace: 'Déplacé',
}

/**
 * Le dossier : ce qui transforme un schéma en pièce livrable.
 *
 * Trois choses y tiennent ensemble parce qu'elles répondent au même moment du travail —
 * celui où l'on remet le document : est-il complet ? à quoi ressemble-t-il une fois
 * imprimé ? et qu'est-ce qui a changé depuis la version précédente ?
 */
export function DossierView() {
  const classeur = useDiagram((s) => s.classeur)
  const pagesCompletes = useDiagram((s) => s.pagesCompletes)
  const diagram = useDiagram((s) => s.diagram)
  const notify = useDiagram((s) => s.notify)
  const select = useDiagram((s) => s.select)
  const setAppView = useDiagram((s) => s.setAppView)
  const fileRef = useRef<HTMLInputElement>(null)
  const [enCours, setEnCours] = useState(false)
  const [diff, setDiff] = useState<{ nom: string; rapport: RapportDiff } | null>(null)

  // `pagesCompletes` est une fonction stable : c'est le schéma ouvert qui dit quand relire.
  const pages = useMemo(() => {
    void diagram
    return pagesCompletes()
  }, [pagesCompletes, diagram])
  const rapport = useMemo(() => controlerDossier(pages, diagram.title), [pages, diagram.title])

  const exporterDossier = async () => {
    setEnCours(true)
    try {
      const capturees = await capturerPages()
      const html = dossierTechnique(
        diagram.title,
        capturees.map((page) => ({ nom: page.nom, diagram: page.diagram, svg: page.vues[0]?.svg ?? '' })),
      )
      downloadBlob(
        new Blob([html], { type: 'text/html;charset=utf-8' }),
        `${slugify(diagram.title)}-dossier-technique.html`,
      )
      notify('Dossier technique généré : ouvrez-le et imprimez-le en PDF.')
    } catch (error) {
      notify(error instanceof Error ? error.message : "L'export du dossier a échoué.")
    } finally {
      setEnCours(false)
    }
  }

  const exporterDrawio = () => {
    downloadBlob(
      new Blob([versDrawio(pages, diagram.title)], { type: 'application/xml' }),
      `${slugify(diagram.title)}.drawio`,
    )
    notify('Schéma exporté au format draw.io (une page par onglet).')
  }

  const comparer = async (file: File | undefined) => {
    if (!file) return
    try {
      const { classeur: ancien } = await readProjectFile(file)
      setDiff({ nom: file.name, rapport: comparerDocuments(ancien, classeur()) })
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Fichier illisible.')
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-slate-50 p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Dossier</h1>
          <p className="text-[12.5px] text-slate-500">
            Complétude du document, production du dossier technique et comparaison avec une
            version précédente.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Btn variant="primary" onClick={() => void exporterDossier()} disabled={enCours}>
            {enCours ? 'Génération…' : 'Dossier technique (imprimable)'}
          </Btn>
          <Btn onClick={exporterDrawio}>Exporter en draw.io</Btn>
          <Btn
            onClick={() =>
              downloadBlob(
                new Blob([inventoryToCsv(diagram, diagram.nodes)], {
                  type: 'text/csv;charset=utf-8',
                }),
                `${slugify(diagram.title)}-inventaire.csv`,
              )
            }
          >
            Inventaire (CSV)
          </Btn>
          <Btn
            onClick={() =>
              downloadBlob(
                new Blob([fluxVersCsv(diagram.flows ?? [])], { type: 'text/csv;charset=utf-8' }),
                `${slugify(diagram.title)}-matrice-flux.csv`,
              )
            }
            disabled={(diagram.flows ?? []).length === 0}
          >
            Matrice de flux (CSV)
          </Btn>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-end gap-3">
            <span className="text-4xl font-bold tabular-nums text-slate-800">{rapport.score}</span>
            <div className="pb-1">
              <p className="text-[13px] font-semibold text-slate-700">{rapport.niveau}</p>
              <p className="text-[11.5px] text-slate-500">Complétude du dossier sur 100</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['critique', 'majeur', 'mineur'] as GraviteQualite[]).map((gravite) => (
              <span
                key={gravite}
                className="flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-[11.5px] text-slate-600"
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COULEURS[gravite] }} />
                {rapport.compte[gravite]} {gravite}
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-2 pt-1">
            {rapport.completude.map((ligne) => {
              const part = ligne.total === 0 ? 0 : Math.round((ligne.renseignes / ligne.total) * 100)
              return (
                <div key={ligne.libelle}>
                  <div className="flex justify-between text-[11.5px] text-slate-600">
                    <span>{ligne.libelle}</span>
                    <span className="tabular-nums text-slate-400">
                      {ligne.renseignes}/{ligne.total}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${part}%`,
                        backgroundColor: part >= 80 ? '#059669' : part >= 40 ? '#d97706' : '#dc2626',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="pb-2 text-[13px] font-semibold text-slate-800">
            Ce qu’il reste à faire ({rapport.constats.length})
          </h2>
          {rapport.constats.length === 0 ? (
            <p className="text-[12.5px] text-emerald-600">
              Rien à signaler : le dossier est complet au regard des contrôles automatiques.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {rapport.constats.map((constat) => (
                <li key={constat.id} className="flex gap-2.5 py-2.5">
                  <span
                    className="mt-[6px] h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: COULEURS[constat.gravite] }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-slate-800">
                      {constat.titre}
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
                        {constat.categorie}
                      </span>
                      {constat.page && (
                        <span className="text-[10.5px] font-normal text-slate-400">{constat.page}</span>
                      )}
                    </p>
                    <p className="text-[12px] leading-snug text-slate-500">{constat.detail}</p>
                    <p className="text-[12px] leading-snug text-slate-600">
                      <b className="font-medium">À faire :</b> {constat.action}
                    </p>
                  </div>
                  {constat.cibles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        select({ nodes: constat.cibles })
                        setAppView('diagram')
                      }}
                      className="h-fit shrink-0 rounded-md border border-slate-200 px-2 py-1 text-[11.5px] text-slate-600 transition hover:bg-slate-50"
                    >
                      Montrer
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-[13px] font-semibold text-slate-800">Comparer avec une version</h2>
            <p className="text-[12px] text-slate-500">
              Ouvrez un projet <code className="rounded bg-slate-100 px-1">.json</code> enregistré
              précédemment : la comparaison porte sur les données, pas sur le dessin.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {diff && <Btn onClick={() => setDiff(null)}>Fermer</Btn>}
            <Btn variant="primary" onClick={() => fileRef.current?.click()}>
              Choisir une version…
            </Btn>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json,.drawio,.xml"
            className="hidden"
            onChange={(event) => {
              void comparer(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>

        {diff && (
          <div className="pt-3">
            <p className="pb-2 text-[12.5px] text-slate-600">
              Comparaison de <b>{diff.nom}</b> avec la version ouverte —{' '}
              {diff.rapport.identiques
                ? 'aucune différence de contenu.'
                : Object.entries(diff.rapport.compte)
                    .filter(([, total]) => total > 0)
                    .map(([sens, total]) => `${total} ${SENS_LABELS[sens].toLowerCase()}(s)`)
                    .join(' · ')}
            </p>
            {diff.rapport.differences.length > 0 && (
              <div className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-[12px]">
                  <thead className="sticky top-0 bg-slate-50 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Changement</th>
                      <th className="px-3 py-2">Élément</th>
                      <th className="px-3 py-2">Détail</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {diff.rapport.differences.map((difference, index) => (
                      <tr key={index} className="border-t border-slate-100 align-top">
                        <td className="whitespace-nowrap px-3 py-2">
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                            style={{ backgroundColor: SENS_COULEURS[difference.sens] }}
                          >
                            {SENS_LABELS[difference.sens]}
                          </span>
                          <span className="pl-2 text-[11px] text-slate-400">{difference.cible}</span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {difference.nom}
                          {difference.page && (
                            <span className="pl-1.5 text-[11px] text-slate-400">{difference.page}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {difference.champs.length === 0 ? (
                            '—'
                          ) : (
                            <ul className="flex flex-col gap-0.5">
                              {difference.champs.map((champ) => (
                                <li key={champ.champ}>
                                  <b className="font-medium text-slate-600">{champ.champ}</b> :{' '}
                                  <span className="text-red-600 line-through">{champ.avant || '—'}</span>{' '}
                                  → <span className="text-emerald-700">{champ.apres || '—'}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {difference.nodeIds.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                select({ nodes: difference.nodeIds })
                                setAppView('diagram')
                              }}
                              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50"
                            >
                              Montrer
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
