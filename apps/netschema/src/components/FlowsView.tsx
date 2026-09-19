import { useMemo, useRef, useState } from 'react'
import { Btn } from './ui'
import { deviceMeta } from '../lib/catalog'
import { controlerMatrice, FLOW_ACTIONS, fluxDepuisCsv, fluxVersCsv } from '../lib/flows'
import { downloadBlob, slugify } from '../lib/exportImage'
import { uid } from '../lib/ids'
import { cheminsEntre, extremitesConnues } from '../lib/paths'
import { useDiagram } from '../store/useDiagram'
import type { FlowAction } from '../types'

const GRAVITE_COULEURS: Record<string, string> = {
  critique: '#dc2626',
  attention: '#d97706',
  info: '#2563eb',
}

/**
 * Matrice de flux et traçage de chemin.
 *
 * Deux questions qui reviennent à chaque revue d'architecture : « qui a le droit de parler
 * à qui, et pourquoi ? » et « par où ça passe ? ». La première se tient dans un tableau, la
 * seconde se calcule sur le schéma — les deux se répondent ici, au même endroit, sur les
 * mêmes données.
 */
export function FlowsView() {
  const diagram = useDiagram((s) => s.diagram)
  const upsertFlow = useDiagram((s) => s.upsertFlow)
  const removeFlow = useDiagram((s) => s.removeFlow)
  const notify = useDiagram((s) => s.notify)
  const locked = useDiagram((s) => s.diagram.locked === true)
  const fileRef = useRef<HTMLInputElement>(null)

  const rapport = useMemo(() => controlerMatrice(diagram), [diagram])
  const extremites = useMemo(() => extremitesConnues(diagram), [diagram])

  const ajouter = () => {
    const zones = [...new Set(diagram.nodes.map((node) => node.zone?.trim()).filter(Boolean))] as string[]
    upsertFlow({
      id: uid('f'),
      from: zones[0] ?? '',
      to: zones[1] ?? zones[0] ?? '',
      action: 'etudier',
    })
  }

  /**
   * Amorce la matrice à partir du schéma : une ligne « à étudier » par couple de zones
   * effectivement reliées. On ne décide rien à la place de l'architecte — on lui évite de
   * recopier à la main la liste de ce qui communique déjà.
   */
  const proposer = () => {
    const zones = [...new Set(diagram.nodes.map((node) => node.zone?.trim()).filter(Boolean))] as string[]
    const existants = new Set(
      (diagram.flows ?? []).map((flow) => `${flow.from.toLowerCase()}→${flow.to.toLowerCase()}`),
    )
    let ajoutes = 0
    for (const depart of zones) {
      for (const arrivee of zones) {
        if (depart === arrivee) continue
        if (existants.has(`${depart.toLowerCase()}→${arrivee.toLowerCase()}`)) continue
        const a = diagram.nodes.find((node) => node.zone?.trim() === depart)
        const b = diagram.nodes.find((node) => node.zone?.trim() === arrivee)
        if (!a || !b) continue
        if (cheminsEntre(diagram, a.id, b.id, 1).chemins.length === 0) continue
        upsertFlow({ id: uid('f'), from: depart, to: arrivee, action: 'etudier' })
        existants.add(`${depart.toLowerCase()}→${arrivee.toLowerCase()}`)
        ajoutes += 1
        if (ajoutes >= 40) break
      }
    }
    notify(
      ajoutes > 0
        ? `${ajoutes} flux inter-zones proposés, à qualifier et à justifier.`
        : 'Aucun nouveau couple de zones à proposer.',
    )
  }

  const exporter = () => {
    downloadBlob(
      new Blob([fluxVersCsv(diagram.flows ?? [])], { type: 'text/csv;charset=utf-8' }),
      `${slugify(diagram.title)}-matrice-flux.csv`,
    )
  }

  const importer = async (file: File | undefined) => {
    if (!file) return
    const { flows, warnings } = fluxDepuisCsv(await file.text())
    for (const flow of flows) upsertFlow(flow)
    notify(
      flows.length > 0
        ? `${flows.length} flux importés.${warnings.length > 0 ? ` ${warnings.length} ligne(s) ignorée(s).` : ''}`
        : (warnings[0] ?? 'Aucun flux lu.'),
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-slate-50 p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Matrice de flux</h1>
          <p className="text-[12.5px] text-slate-500">
            Qui a le droit de parler à qui, avec quel service et pourquoi — contrôlé contre le
            schéma : extrémités réelles, chemin filtré, exposition, VLAN.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Btn variant="primary" onClick={ajouter} disabled={locked}>
            Ajouter un flux
          </Btn>
          <Btn onClick={proposer} disabled={locked} title="Une ligne par couple de zones reliées">
            Proposer d’après le schéma
          </Btn>
          <Btn onClick={exporter} disabled={(diagram.flows ?? []).length === 0}>
            Exporter (CSV)
          </Btn>
          <Btn onClick={() => fileRef.current?.click()} disabled={locked}>
            Importer (CSV)
          </Btn>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              void importer(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {FLOW_ACTIONS.map((action) => (
          <Compteur
            key={action.value}
            couleur={action.couleur}
            valeur={rapport.parAction[action.value]}
            libelle={action.label}
          />
        ))}
        <Compteur couleur="#94a3b8" valeur={rapport.parAction.nonRenseigne} libelle="Sans décision" />
        <Compteur couleur="#dc2626" valeur={rapport.bloquants} libelle="À corriger" />
        <Compteur couleur="#d97706" valeur={rapport.avertissements} libelle="À compléter" />
      </div>

      <datalist id="netschema-extremites">
        {extremites.map((valeur) => (
          <option key={valeur} value={valeur} />
        ))}
      </datalist>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1100px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Destination</th>
              <th className="px-3 py-2">Service</th>
              <th className="px-3 py-2">Protocole / ports</th>
              <th className="px-3 py-2">Décision</th>
              <th className="px-3 py-2">Justification</th>
              <th className="px-3 py-2">Protection</th>
              <th className="px-3 py-2">Contrôles</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rapport.controles.map(({ flow, constats, chemins }) => {
              const critique = constats.some((constat) => constat.gravite === 'critique')
              return (
                <tr key={flow.id} className="border-b border-slate-100 align-top last:border-0">
                  <Cellule>
                    <Saisie
                      value={flow.from}
                      onChange={(from) => upsertFlow({ ...flow, from })}
                      liste
                      disabled={locked}
                      placeholder="Zone ou équipement"
                    />
                  </Cellule>
                  <Cellule>
                    <Saisie
                      value={flow.to}
                      onChange={(to) => upsertFlow({ ...flow, to })}
                      liste
                      disabled={locked}
                      placeholder="Zone ou équipement"
                    />
                  </Cellule>
                  <Cellule>
                    <Saisie
                      value={flow.service ?? ''}
                      onChange={(service) => upsertFlow({ ...flow, service })}
                      disabled={locked}
                      placeholder="—"
                    />
                  </Cellule>
                  <Cellule>
                    <Saisie
                      value={flow.protocol ?? ''}
                      onChange={(protocol) => upsertFlow({ ...flow, protocol })}
                      disabled={locked}
                      placeholder="—"
                    />
                  </Cellule>
                  <Cellule>
                    <select
                      value={flow.action ?? ''}
                      disabled={locked}
                      onChange={(event) =>
                        upsertFlow({ ...flow, action: (event.target.value || undefined) as FlowAction })
                      }
                      className="w-full rounded-md border border-slate-200 px-1.5 py-1 text-[12px] outline-none focus:border-blue-500"
                    >
                      <option value="">—</option>
                      {FLOW_ACTIONS.map((action) => (
                        <option key={action.value} value={action.value}>
                          {action.label}
                        </option>
                      ))}
                    </select>
                  </Cellule>
                  <Cellule>
                    <Saisie
                      value={flow.purpose ?? ''}
                      onChange={(purpose) => upsertFlow({ ...flow, purpose })}
                      disabled={locked}
                      placeholder="—"
                    />
                  </Cellule>
                  <Cellule>
                    <Saisie
                      value={flow.encryption ?? ''}
                      onChange={(encryption) => upsertFlow({ ...flow, encryption })}
                      disabled={locked}
                      placeholder="—"
                    />
                  </Cellule>
                  <td className="px-3 py-2">
                    {constats.length === 0 ? (
                      <span className="text-[11.5px] text-emerald-600">Rien à signaler</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {constats.map((constat, index) => (
                          <li key={index} className="flex gap-1.5 text-[11.5px] leading-snug">
                            <span
                              className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: GRAVITE_COULEURS[constat.gravite] }}
                            />
                            <span className={critique ? 'text-slate-700' : 'text-slate-500'}>
                              {constat.texte}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {chemins && chemins.chemins.length > 0 && (
                      <p className="pt-1 text-[11px] text-slate-400">
                        Chemin : {chemins.chemins[0].etapes.map((etape) => etape.node.name).join(' → ')}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => removeFlow(flow.id)}
                      title="Supprimer ce flux"
                      className="rounded-md px-2 py-1 text-[13px] text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
            {rapport.controles.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[12.5px] text-slate-400">
                  Aucun flux documenté. « Proposer d’après le schéma » établit une première
                  matrice à partir des zones reliées ; « Importer (CSV) » reprend une matrice
                  existante.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <TraceurDeChemin />
    </div>
  )
}

function Compteur({ couleur, valeur, libelle }: { couleur: string; valeur: number; libelle: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: couleur }} />
      <span className="text-[13px] font-semibold tabular-nums text-slate-800">{valeur}</span>
      <span className="text-[11.5px] text-slate-500">{libelle}</span>
    </div>
  )
}

function Cellule({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2">{children}</td>
}

function Saisie({
  value,
  onChange,
  placeholder,
  disabled,
  liste,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  liste?: boolean
}) {
  return (
    <input
      value={value}
      disabled={disabled}
      list={liste ? 'netschema-extremites' : undefined}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-transparent px-1.5 py-1 text-[12.5px] outline-none hover:border-slate-200 focus:border-blue-500 disabled:bg-transparent"
    />
  )
}

/**
 * Traçage de chemin : deux équipements, et ce que le schéma dit du trajet entre eux.
 *
 * Les chemins affichés sont indépendants les uns des autres — deux trajets qui partagent un
 * switch ne comptent que pour un, sans quoi la redondance affichée serait fictive.
 */
function TraceurDeChemin() {
  const diagram = useDiagram((s) => s.diagram)
  const selection = useDiagram((s) => s.selectedNodes)
  const select = useDiagram((s) => s.select)
  const setAppView = useDiagram((s) => s.setAppView)

  const noeuds = useMemo(
    () => [...diagram.nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [diagram.nodes],
  )
  const [de, setDe] = useState('')
  const [vers, setVers] = useState('')

  // La sélection du schéma sert de proposition : on arrive souvent ici après avoir cliqué
  // les deux équipements qui posent question.
  const depart = de || selection[0] || noeuds[0]?.id || ''
  const arrivee = vers || selection[1] || noeuds[noeuds.length - 1]?.id || ''

  const rapport = useMemo(
    () => (depart && arrivee && depart !== arrivee ? cheminsEntre(diagram, depart, arrivee, 3) : null),
    [diagram, depart, arrivee],
  )

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="pb-1 text-[13px] font-semibold text-slate-800">Tracer un chemin</h2>
      <p className="pb-3 text-[12px] text-slate-500">
        Par où passe un flux entre deux équipements, ce qu’il traverse, et ce qui l’empêche de
        passer. Sélectionner deux équipements sur le schéma remplit les deux listes.
      </p>

      <div className="flex flex-wrap items-center gap-2 pb-3">
        <select
          value={depart}
          onChange={(event) => setDe(event.target.value)}
          className="min-w-[200px] rounded-lg border border-slate-200 px-2 py-1.5 text-[12.5px] outline-none focus:border-blue-500"
        >
          {noeuds.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name} — {deviceMeta(node.kind).label}
            </option>
          ))}
        </select>
        <span className="text-slate-400">→</span>
        <select
          value={arrivee}
          onChange={(event) => setVers(event.target.value)}
          className="min-w-[200px] rounded-lg border border-slate-200 px-2 py-1.5 text-[12.5px] outline-none focus:border-blue-500"
        >
          {noeuds.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name} — {deviceMeta(node.kind).label}
            </option>
          ))}
        </select>
        {rapport && rapport.chemins.length > 0 && (
          <Btn
            onClick={() => {
              select({
                nodes: rapport.chemins[0].etapes.map((etape) => etape.node.id),
                links: rapport.chemins[0].etapes
                  .map((etape) => etape.link?.id)
                  .filter((id): id is string => !!id),
              })
              setAppView('diagram')
            }}
            title="Sélectionner ce chemin sur le schéma"
          >
            Montrer sur le schéma
          </Btn>
        )}
      </div>

      {rapport && (
        <div className="flex flex-col gap-3">
          {rapport.constats.map((constat, index) => (
            <p key={index} className="flex gap-2 text-[12.5px]">
              <span
                className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: GRAVITE_COULEURS[constat.gravite] }}
              />
              <span className="text-slate-600">{constat.texte}</span>
            </p>
          ))}

          {rapport.chemins.map((chemin, index) => (
            <article key={index} className="rounded-lg border border-slate-200 p-3">
              <header className="flex flex-wrap items-center gap-2 pb-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  {index === 0 ? 'Chemin principal' : `Chemin de secours ${index}`}
                </span>
                <span className="text-[11.5px] text-slate-500">{chemin.sauts} saut(s)</span>
                {chemin.filtrage.length > 0 && (
                  <span className="text-[11.5px] text-emerald-600">
                    Filtrage : {chemin.filtrage.map((node) => node.name).join(', ')}
                  </span>
                )}
                {chemin.goulot && (
                  <span className="text-[11.5px] text-amber-600">
                    Maillon le plus lent : {chemin.goulot.debit}
                  </span>
                )}
              </header>

              <ol className="flex flex-wrap items-center gap-1.5">
                {chemin.etapes.map((etape) => (
                  <li key={etape.node.id} className="flex items-center gap-1.5">
                    {etape.link && (
                      <span className="text-[11px] text-slate-400">
                        —{etape.link.speed ? ` ${etape.link.speed} ` : ' '}→
                      </span>
                    )}
                    <span
                      className="rounded-md px-2 py-0.5 text-[12px] font-medium"
                      style={{
                        backgroundColor: deviceMeta(etape.node.kind).fill,
                        color: deviceMeta(etape.node.kind).accent,
                      }}
                    >
                      {etape.node.name}
                    </span>
                  </li>
                ))}
              </ol>

              {chemin.constats.length > 0 && (
                <ul className="flex flex-col gap-1 pt-2">
                  {chemin.constats.map((constat, position) => (
                    <li key={position} className="flex gap-2 text-[12px]">
                      <span
                        className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: GRAVITE_COULEURS[constat.gravite] }}
                      />
                      <span className="text-slate-600">{constat.texte}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
