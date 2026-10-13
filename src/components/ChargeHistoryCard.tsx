import { useMemo, useState } from 'react';
import { historiqueCharge, NATURES, totauxFenetre, type MoisCharge } from '../lib/chargeHistory';
import { COULEUR_NATURE } from '../lib/meetingReport';
import { Card } from './ui';
import type { Absence, ProjectTask, TeamMember, TimeEntry } from '../types';

/**
 * Historique de la charge sur 3, 6 ou 12 mois.
 *
 * Colonnes empilées par nature de travail, avec la capacité du mois en repère. Les trois
 * couleurs ne sont pas choisies à l'œil : elles passent les contrôles de clarté, de
 * saturation, de séparation pour les daltonismes et de contraste, avec les MÊMES valeurs
 * sur fond clair et sur fond sombre (voir COULEUR_NATURE). Les teintes des pastilles de la
 * liste des tâches échouaient ces contrôles — le gris du MCO ne se distingue pas assez et
 * l'écart Projet/Incident tombe à 4,1 en vision protan.
 *
 * Dessiné en HTML plutôt qu'en SVG : un premier essai en SVG étirait les noms de mois
 * horizontalement et faisait chevaucher les graduations avec la légende. Douze colonnes
 * empilées se dessinent très bien en CSS, sans déformation de texte et avec des zones de
 * survol natives.
 */

const HAUTEUR = 208;

export function ChargeHistoryCard({
  timeEntries,
  tasks,
  members,
  absences,
}: {
  timeEntries: TimeEntry[];
  tasks: ProjectTask[];
  members: TeamMember[];
  absences: Absence[];
}) {
  const [nbMois, setNbMois] = useState<3 | 6 | 12>(6);
  const [tableau, setTableau] = useState(false);
  const [survol, setSurvol] = useState<number | null>(null);

  const mois = useMemo(
    () => historiqueCharge({ nbMois, timeEntries, tasks, members, absences }),
    [nbMois, timeEntries, tasks, members, absences]
  );
  const totaux = useMemo(() => totauxFenetre(mois), [mois]);

  // Juste ce qu'il faut pour que la plus haute colonne tienne : arrondir au cran supérieur
  // AVEC marge ajoutait un palier entier de vide en haut, dont la graduation venait se
  // poser dans la légende.
  const plafond = Math.max(1, ...mois.map((m) => Math.max(m.total, m.capacite)));
  const pas = plafond > 600 ? 200 : plafond > 300 ? 100 : plafond > 120 ? 50 : 10;
  const max = Math.max(pas, Math.ceil(plafond / pas) * pas);
  const graduations: number[] = [];
  for (let t = 0; t <= max; t += pas) graduations.push(t);

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Historique de la charge</h3>
          <p className="text-xs text-slate-400">Heures saisies mois par mois, réparties par nature de travail</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-slate-800">
            {([3, 6, 12] as const).map((n) => (
              <button
                key={n}
                onClick={() => setNbMois(n)}
                className={`rounded-md px-2.5 py-1 ${
                  nbMois === n
                    ? 'bg-white font-medium text-violet-700 shadow-sm dark:bg-slate-900 dark:text-violet-300'
                    : 'text-slate-500'
                }`}
              >
                {n} mois
              </button>
            ))}
          </div>
          <button
            onClick={() => setTableau((t) => !t)}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {tableau ? 'Voir le graphique' : 'Voir le tableau'}
          </button>
        </div>
      </div>

      {/* Légende toujours présente dès deux séries : l'identité ne doit jamais reposer sur
          la seule couleur. Inutile en vue tableau, où les colonnes sont nommées. */}
      <div className={`mb-3 flex-wrap items-center gap-x-4 gap-y-1 text-xs ${tableau ? 'hidden' : 'flex'}`}>
        {NATURES.map((n) => (
          <span key={n} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: COULEUR_NATURE[n] }} />
            {n}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <span aria-hidden className="h-0.5 w-4 bg-slate-400" />
          Capacité du mois
        </span>
      </div>

      {tableau ? (
        <TableauCharge mois={mois} />
      ) : (
        <div className="flex gap-2">
          {/* Graduations dans leur propre colonne : posées en surimpression, elles
              chevauchaient la légende. */}
          <div className="relative w-10 shrink-0" style={{ height: HAUTEUR }}>
            {/* translate-y-1/2 et non -translate-y-1/2 : l'étiquette est posée par son bord
                BAS sur la graduation ; la décaler vers le haut la laissait flotter d'une
                demi-hauteur au-dessus de son trait. */}
            {graduations.map((t) => (
              <span
                key={t}
                className="absolute right-0 translate-y-1/2 text-[10px] tabular-nums text-slate-400"
                style={{ bottom: `${(t / max) * 100}%` }}
              >
                {t}h
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div className="relative" style={{ height: HAUTEUR }} onMouseLeave={() => setSurvol(null)}>
              {graduations.map((t) => (
                <span
                  key={t}
                  aria-hidden
                  className="absolute inset-x-0 h-px bg-slate-100 dark:bg-slate-800"
                  style={{ bottom: `${(t / max) * 100}%` }}
                />
              ))}

              <div className="absolute inset-0 flex items-end">
                {mois.map((m, i) => (
                  <div
                    key={m.label}
                    onMouseEnter={() => setSurvol(i)}
                    onFocus={() => setSurvol(i)}
                    tabIndex={0}
                    className="relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800"
                    aria-label={`${m.label} : ${m.total} heures saisies sur ${m.capacite} de capacité`}
                  >
                    {/* Bande de survol sur toute la hauteur : viser une barre de 24 px à la
                        souris est pénible, au doigt impossible. */}
                    <span className={`absolute inset-0 ${survol === i ? 'bg-slate-50 dark:bg-slate-800/40' : ''}`} aria-hidden />
                    <div className="relative flex w-full max-w-[24px] flex-col justify-end" style={{ height: '100%' }}>
                      {/* Projet est la base de la pile, donc rendu en dernier dans le DOM. */}
                      {[...NATURES].reverse().map((n, idx) => (
                        <div
                          key={n}
                          style={{
                            height: `${(m.heures[n] / max) * 100}%`,
                            background: COULEUR_NATURE[n],
                            // 2 px de fond entre segments : c'est le fond qui sépare, jamais
                            // un contour, qui ajouterait de l'encre sans donnée.
                            marginBottom: idx === NATURES.length - 1 ? 0 : 2,
                            borderTopLeftRadius: idx === 0 ? 4 : 0,
                            borderTopRightRadius: idx === 0 ? 4 : 0,
                          }}
                        />
                      ))}
                    </div>
                    {/* Capacité : un repère, pas une série — filet gris, jamais une couleur
                        de données. */}
                    <span
                      aria-hidden
                      className="absolute h-0.5 bg-slate-400"
                      style={{ bottom: `${Math.min(100, (m.capacite / max) * 100)}%`, width: 30 }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex">
              {mois.map((m, i) => (
                <span
                  key={m.label}
                  className={`min-w-0 flex-1 truncate pt-1.5 text-center text-[10px] ${
                    survol === i ? 'font-medium text-slate-600 dark:text-slate-300' : 'text-slate-400'
                  }`}
                >
                  {m.label}
                </span>
              ))}
            </div>

            {/* Détail du mois survolé SOUS le graphique plutôt qu'en infobulle flottante :
                la bulle recouvrait les colonnes voisines, qu'on voulait justement comparer. */}
            <div className="mt-2 min-h-[2.25rem] rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-800/60">
              {survol === null || !mois[survol] ? (
                <span className="text-slate-400">
                  Survolez un mois pour en voir le détail. Sur la fenêtre : {totaux.total} h saisies sur {totaux.capacite} h de
                  capacité
                  {totaux.total > 0 && (
                    <>
                      {' '}
                      — {NATURES.map((n) => `${n} ${totaux.partParNature[n]} %`).join(', ')}
                    </>
                  )}
                  .
                </span>
              ) : (
                <DetailMois m={mois[survol]} />
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function DetailMois({ m }: { m: MoisCharge }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="font-medium text-slate-800 dark:text-slate-100">{m.label}</span>
      {NATURES.map((n) => (
        <span key={n} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
          <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: COULEUR_NATURE[n] }} />
          {n} <span className="tabular-nums">{m.heures[n]}h</span>
        </span>
      ))}
      {m.heuresSansTache > 0 && (
        <span className="text-slate-500 dark:text-slate-400">
          tâches supprimées <span className="tabular-nums">{m.heuresSansTache}h</span>
        </span>
      )}
      <span className="text-slate-500 dark:text-slate-400">
        Total <strong className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{m.total}h</strong>
        <span className="text-slate-400"> / {m.capacite}h de capacité</span>
      </span>
    </div>
  );
}

/** Vue tableau : les mêmes chiffres en clair, lisibles au lecteur d'écran et copiables. */
function TableauCharge({ mois }: { mois: MoisCharge[] }) {
  const avecSupprimees = mois.some((m) => m.heuresSansTache > 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-400 dark:border-slate-800">
            <th className="py-1.5 pr-3 font-medium">Mois</th>
            {NATURES.map((n) => (
              <th key={n} className="py-1.5 pr-3 text-right font-medium">
                {n}
              </th>
            ))}
            {avecSupprimees && <th className="py-1.5 pr-3 text-right font-medium">Tâches supprimées</th>}
            <th className="py-1.5 pr-3 text-right font-medium">Total</th>
            <th className="py-1.5 text-right font-medium">Capacité</th>
          </tr>
        </thead>
        <tbody>
          {mois.map((m) => (
            <tr key={m.label} className="border-b border-slate-50 last:border-0 dark:border-slate-800/60">
              <td className="py-1.5 pr-3 text-slate-700 dark:text-slate-200">{m.label}</td>
              {NATURES.map((n) => (
                <td key={n} className="py-1.5 pr-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                  {m.heures[n]} h
                </td>
              ))}
              {avecSupprimees && (
                <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">{m.heuresSansTache} h</td>
              )}
              <td className="py-1.5 pr-3 text-right font-medium tabular-nums text-slate-800 dark:text-slate-100">{m.total} h</td>
              <td className="py-1.5 text-right tabular-nums text-slate-400">{m.capacite} h</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

