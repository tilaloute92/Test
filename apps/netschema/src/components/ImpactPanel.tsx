import { useMemo } from 'react'
import { Btn } from './ui'
import {
  analyseImpact,
  classementCriticite,
  COULEURS_IMPACT,
  type EtatImpact,
  type GraviteConstat,
} from '../lib/impact'
import { useDiagram } from '../store/useDiagram'

/**
 * Analyse d'impact : « que se passe-t-il si… ».
 *
 * On désigne ce qui tombe — un switch, un câble, une salle entière — et l'on lit ce que le
 * réseau perd. Rien n'est modifié : la simulation vit à côté du schéma et s'efface d'un clic.
 */

const GRAVITES: Record<GraviteConstat, { label: string; couleur: string; fond: string }> = {
  critique: { label: 'Critique', couleur: '#b91c1c', fond: '#fef2f2' },
  majeur: { label: 'Majeur', couleur: '#b45309', fond: '#fffbeb' },
  mineur: { label: 'Mineur', couleur: '#1d4ed8', fond: '#eff6ff' },
  info: { label: 'Information', couleur: '#475569', fond: '#f8fafc' },
}

function Pastille({ etat, valeur, titre }: { etat: EtatImpact; valeur: number; titre: string }) {
  return (
    <div className="flex-1 rounded-lg border border-slate-200 p-2 text-center">
      <p className="text-[17px] font-semibold tabular-nums" style={{ color: COULEURS_IMPACT[etat] }}>
        {valeur}
      </p>
      <p className="text-[10.5px] leading-tight text-slate-500">{titre}</p>
    </div>
  )
}

export function ImpactPanel() {
  const diagram = useDiagram((s) => s.diagram)
  const pannes = useDiagram((s) => s.pannes)
  const store = useDiagram.getState

  const rapport = useMemo(() => analyseImpact(diagram, pannes), [diagram, pannes])
  // Le classement ne dépend pas de la simulation en cours : il répond à « par quoi commencer ».
  const classement = useMemo(() => classementCriticite(diagram, 6), [diagram])

  const nomDe = (id: string) => diagram.nodes.find((node) => node.id === id)?.name ?? id
  const enPanne = [...pannes.nodes.map((id) => ({ type: 'node' as const, id, nom: nomDe(id) })), ...pannes.links.map((id) => {
    const lien = diagram.links.find((link) => link.id === id)
    return {
      type: 'link' as const,
      id,
      nom: lien ? `${nomDe(lien.from)} ↔ ${nomDe(lien.to)}` : 'liaison',
    }
  })]

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Analyse d’impact</h3>
        <p className="pt-1 text-[12px] leading-relaxed text-slate-600">
          Cliquez un équipement ou une liaison pour le déclarer <b>hors service</b>. L’analyse
          tient compte des ports d’accès et des trunks, des VLAN autorisés de chaque côté et des
          liens en attente spanning-tree. Le schéma n’est pas modifié.
        </p>
      </div>

      <div className="flex gap-1.5">
        <Pastille etat="panne" valeur={rapport.compte.panne} titre="en panne" />
        <Pastille etat="isole" valeur={rapport.compte.isole} titre="isolés" />
        <Pastille etat="fragile" valeur={rapport.compte.fragile} titre="à un fil" />
        <Pastille etat="intact" valeur={rapport.disponibilite} titre="% joignable" />
      </div>

      {enPanne.length > 0 && (
        <div>
          <div className="flex items-center justify-between pb-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Hypothèse retenue
            </h4>
            <Btn variant="ghost" onClick={() => store().clearPannes()} title="Tout rétablir">
              Rétablir
            </Btn>
          </div>
          <ul className="flex flex-col gap-1">
            {enPanne.map((item) => (
              <li key={`${item.type}-${item.id}`} className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COULEURS_IMPACT.panne }} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">{item.nom}</span>
                <button
                  type="button"
                  onClick={() => store().togglePanne(item.type, item.id)}
                  className="shrink-0 text-[11px] text-slate-400 hover:text-slate-700"
                >
                  rétablir
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Constats rédigés : c'est ce qui se recopie dans un compte rendu d'incident. */}
      <div className="flex flex-col gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Constats</h4>
        {rapport.constats.map((constat, index) => {
          const gravite = GRAVITES[constat.gravite]
          return (
            <div
              key={`${constat.titre}-${index}`}
              className="rounded-lg border-l-[3px] px-2.5 py-2"
              style={{ borderColor: gravite.couleur, backgroundColor: gravite.fond }}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="shrink-0 text-[9.5px] font-bold uppercase tracking-wide"
                  style={{ color: gravite.couleur }}
                >
                  {gravite.label}
                </span>
                <p className="min-w-0 flex-1 text-[12.5px] font-semibold text-slate-800">{constat.titre}</p>
              </div>
              <p className="pt-1 text-[11.5px] leading-relaxed text-slate-600">{constat.detail}</p>
              {constat.action && (
                <p className="pt-1 text-[11.5px] leading-relaxed text-slate-700">
                  <span className="font-semibold">À faire : </span>
                  {constat.action}
                </p>
              )}
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => {
            const texte = [
              `Analyse d’impact — ${diagram.title}`,
              enPanne.length > 0 ? `Hypothèse : ${enPanne.map((item) => item.nom).join(', ')}` : 'Hypothèse : état nominal',
              `Disponibilité : ${rapport.disponibilite} % · ${rapport.compte.isole} isolé(s) · ${rapport.compte.fragile} sans redondance`,
              '',
              ...rapport.constats.map((constat) =>
                [
                  `[${GRAVITES[constat.gravite].label}] ${constat.titre}`,
                  constat.detail,
                  constat.action ? `À faire : ${constat.action}` : '',
                  '',
                ]
                  .filter(Boolean)
                  .join('\n'),
              ),
            ].join('\n')
            void navigator.clipboard?.writeText(texte)
            store().notify('Analyse copiée : à coller dans un ticket ou un compte rendu.')
          }}
          className="self-start text-[11.5px] text-blue-700 hover:underline"
        >
          Copier l’analyse
        </button>
      </div>

      {rapport.vlans.length > 0 && (
        <div>
          <h4 className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            VLAN touchés ({rapport.vlans.length})
          </h4>
          <ul className="flex flex-col gap-1">
            {rapport.vlans.map((vlan) => (
              <li key={vlan.id} className="rounded-lg bg-slate-50 px-2 py-1.5">
                <p className="text-[12px] font-medium text-slate-800">
                  VLAN {vlan.id}
                  {vlan.nom && <span className="font-normal text-slate-500"> — {vlan.nom}</span>}
                  <span className="float-right tabular-nums text-slate-500">
                    {vlan.perdus.length}/{vlan.membres}
                  </span>
                </p>
                <p className="text-[11px] leading-snug text-slate-600">{vlan.perdus.join(', ')}</p>
                {vlan.cheminSansVlan && (
                  <p className="pt-0.5 text-[11px] font-medium text-amber-700">
                    Chemin physique présent, VLAN non autorisé sur le trunk de secours.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rapport.isoles.length > 0 && (
        <div>
          <h4 className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Isolés ({rapport.isoles.length})
          </h4>
          <ul className="flex flex-col gap-0.5">
            {rapport.isoles.map((item) => (
              <li key={item.id} className="truncate text-[12px] text-slate-700">
                <span className="text-orange-600">●</span> {item.nom}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rapport.fragiles.length > 0 && (
        <div>
          <h4 className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Sans redondance restante ({rapport.fragiles.length})
          </h4>
          <ul className="flex flex-col gap-0.5">
            {rapport.fragiles.slice(0, 12).map((item) => (
              <li key={item.id} className="truncate text-[12px] text-slate-700">
                <span className="text-amber-600">●</span> {item.nom}
                {item.dependDe && <span className="text-slate-400"> — via {item.dependDe}</span>}
              </li>
            ))}
            {rapport.fragiles.length > 12 && (
              <li className="text-[11.5px] text-slate-400">et {rapport.fragiles.length - 12} autre(s)…</li>
            )}
          </ul>
        </div>
      )}

      <div>
        <h4 className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Par quoi commencer
        </h4>
        <p className="pb-1 text-[11.5px] leading-snug text-slate-500">
          Effet de l’arrêt de chaque équipement, pris un par un — le haut de la liste est ce
          qu’il faut doubler en premier.
        </p>
        <ul className="flex flex-col gap-0.5">
          {classement.length === 0 && <li className="text-[12px] text-slate-500">Aucun point de passage unique.</li>}
          {classement.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  store().clearPannes()
                  store().togglePanne('node', item.id)
                }}
                className="min-w-0 flex-1 truncate text-left text-[12px] text-slate-700 hover:text-blue-700"
                title="Simuler l’arrêt de cet équipement"
              >
                {item.nom}
              </button>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                {item.isoles > 0 && <span className="text-orange-600">{item.isoles} isolé(s)</span>}
                {item.isoles > 0 && item.fragiles > 0 && ' · '}
                {item.fragiles > 0 && <span className="text-amber-600">{item.fragiles} à un fil</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[11px] leading-relaxed text-slate-400">
        Méthode : joignabilité depuis les points de référence ({rapport.racines.length} équipement(s) —
        accès opérateur et périmètre), sur les liaisons de transport uniquement ; un VLAN n’est
        transporté que s’il est autorisé aux <b>deux</b> extrémités du trunk ; un lien en état
        alternatif ou bloqué ne compte qu’après convergence.
      </p>
    </div>
  )
}
