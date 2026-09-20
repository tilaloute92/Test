import { useMemo } from 'react'
import { Btn } from './ui'
import { HA_PATTERNS } from '../lib/patterns'
import { useDiagram } from '../store/useDiagram'
import { useAudit } from '../store/useAudit'
import { mecanismeHa } from '../lib/haTech'
import type { Severity } from '../lib/ha'
import type { NetNode } from '../types'

const SEVERITY_STYLE: Record<Severity, { dot: string; text: string; label: string }> = {
  critique: { dot: '#dc2626', text: 'text-red-700', label: 'Critique' },
  avertissement: { dot: '#d97706', text: 'text-amber-700', label: 'À corriger' },
  info: { dot: '#2563eb', text: 'text-blue-700', label: 'Conseil' },
}

const LEVEL_COLOR: Record<string, string> = {
  Solide: '#059669',
  Perfectible: '#d97706',
  Fragile: '#dc2626',
}

/**
 * Analyse de haute disponibilité et bibliothèque de modèles : la partie « inspiration
 * infrastructures redondées » de l'application.
 */
export function HaPanel() {
  const report = useAudit()
  const select = useDiagram((s) => s.select)
  const insertPattern = useDiagram((s) => s.insertPattern)
  const showAudit = useDiagram((s) => s.showAudit)
  const setDisplay = useDiagram((s) => s.setDisplay)

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Robustesse</h2>
            <p className="text-[11px] text-slate-400">Analyse du schéma courant</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums" style={{ color: LEVEL_COLOR[report.level] }}>
              {report.score}
              <span className="text-sm font-medium text-slate-400">/100</span>
            </div>
            <div className="text-[11px] font-semibold" style={{ color: LEVEL_COLOR[report.level] }}>
              {report.level}
            </div>
          </div>
        </div>

        <div className="mt-2 flex gap-1.5">
          {(Object.keys(SEVERITY_STYLE) as Severity[]).map((severity) => (
            <span
              key={severity}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SEVERITY_STYLE[severity].dot }} />
              {report.counts[severity]} {SEVERITY_STYLE[severity].label.toLowerCase()}
            </span>
          ))}
        </div>

        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-slate-600">
          <input
            type="checkbox"
            checked={showAudit}
            onChange={(event) => setDisplay({ showAudit: event.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
          />
          Signaler les points critiques sur le schéma
        </label>
      </section>

      <GrappesSection />

      <section>
        <h2 className="pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Constats ({report.findings.length})
        </h2>
        {report.findings.length === 0 ? (
          <p className="rounded-lg bg-emerald-50 p-3 text-[12px] text-emerald-700">
            Aucun défaut détecté : pas de point de défaillance unique, grappes complètes et
            chemins redondants.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {report.findings.map((finding) => {
              const style = SEVERITY_STYLE[finding.severity]
              return (
                <li key={finding.id}>
                  <button
                    type="button"
                    onClick={() => finding.nodeIds.length > 0 && select({ nodes: finding.nodeIds })}
                    className="w-full rounded-lg border border-slate-200 p-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className="mt-1 h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: style.dot }}
                      />
                      <span>
                        <span className={`block text-[12px] font-semibold ${style.text}`}>{finding.title}</span>
                        <span className="block text-[11px] leading-snug text-slate-500">{finding.detail}</span>
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Modèles haute dispo</h2>
        <p className="pb-2 text-[11px] leading-snug text-slate-400">
          Blocs prêts à l'emploi, déjà décrits (grappe, rôles, VIP, battement de cœur).
          Ils arrivent au centre de la vue.
        </p>
        <ul className="flex flex-col gap-1.5">
          {HA_PATTERNS.map((pattern) => (
            <li key={pattern.id} className="rounded-lg border border-slate-200 p-2">
              <p className="text-[12px] font-semibold text-slate-700">{pattern.title}</p>
              <p className="pb-1.5 text-[11px] leading-snug text-slate-500">{pattern.summary}</p>
              <Btn onClick={() => insertPattern(pattern)}>Insérer</Btn>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-600">Ce que l'analyse vérifie</p>
        <p>
          Points de défaillance uniques (articulations du graphe), équipements critiques sans pair,
          simple attachement, grappes sans battement de cœur ni témoin de quorum, rôles et VIP
          manquants, adduction opérateur unique, chaîne électrique simple, site de secours et
          sauvegarde absents, liens parallèles non agrégés.
        </p>
      </section>
    </div>
  )
}

/**
 * Les grappes du schéma et leur mécanisme de bascule.
 *
 * C'est la lecture qui manquait : le schéma montre des paires, l'analyse montre des
 * constats, mais personne ne voyait d'un coup d'œil « quelles grappes existent, avec quel
 * mécanisme, et lesquelles ne le disent pas ».
 */
function GrappesSection() {
  const diagram = useDiagram((s) => s.diagram)
  const select = useDiagram((s) => s.select)
  const deduire = useDiagram((s) => s.deduireMecanismesHa)
  const notify = useDiagram((s) => s.notify)
  const locked = useDiagram((s) => s.diagram.locked === true)

  const grappes = useMemo(() => {
    const parNom = new Map<string, NetNode[]>()
    for (const node of diagram.nodes) {
      const nom = node.cluster?.trim()
      if (!nom) continue
      const liste = parNom.get(nom)
      if (liste) liste.push(node)
      else parNom.set(nom, [node])
    }
    return [...parNom.entries()]
      .map(([nom, membres]) => {
        const declares = [...new Set(membres.map((m) => m.haTech?.trim()).filter(Boolean))] as string[]
        return {
          nom,
          membres,
          mecanisme: declares.length === 1 ? mecanismeHa(declares[0]) : undefined,
          divergent: declares.length > 1,
          temoin: membres.find((m) => m.role === 'witness' || m.kind === 'witness'),
        }
      })
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
  }, [diagram.nodes])

  if (grappes.length === 0) return null
  const manquants = grappes.filter((grappe) => !grappe.mecanisme && !grappe.divergent).length

  return (
    <section>
      <div className="flex items-end justify-between pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Grappes ({grappes.length})
        </h2>
        {manquants > 0 && !locked && (
          <Btn
            onClick={() => {
              const { grappes: traitees, equipements } = deduire()
              notify(
                traitees > 0
                  ? `${traitees} grappe(s) documentée(s) : mécanisme proposé sur ${equipements} équipement(s), à vérifier.`
                  : 'Aucun mécanisme n’a pu être proposé : précisez le constructeur des membres.',
              )
            }}
          >
            Déduire ({manquants})
          </Btn>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {grappes.map((grappe) => (
          <li key={grappe.nom}>
            <button
              type="button"
              onClick={() => select({ nodes: grappe.membres.map((m) => m.id) })}
              className="w-full rounded-lg border border-slate-200 p-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-semibold text-slate-700">{grappe.nom}</span>
                <span className="text-[10.5px] text-slate-400">{grappe.membres.length} membres</span>
              </span>
              <span className="block text-[11px] leading-snug">
                {grappe.divergent ? (
                  <span className="text-amber-700">Mécanismes divergents entre les membres</span>
                ) : grappe.mecanisme ? (
                  <span className="text-slate-600">
                    {grappe.mecanisme.label}
                    {grappe.mecanisme.planDeControleCommun && (
                      <span className="text-amber-700"> · plan de contrôle commun</span>
                    )}
                    {grappe.mecanisme.temoin &&
                      (grappe.temoin ? (
                        <span className="text-emerald-700"> · témoin {grappe.temoin.name}</span>
                      ) : (
                        <span className="text-amber-700"> · témoin manquant</span>
                      ))}
                  </span>
                ) : (
                  <span className="text-slate-400">Mécanisme non documenté</span>
                )}
              </span>
              {grappe.mecanisme && (
                <span className="block text-[10.5px] text-slate-400">
                  Bascule : {grappe.mecanisme.bascule}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
