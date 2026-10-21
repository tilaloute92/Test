import { useEffect, useState } from 'react';
import { Card } from './ui';
import { fetchGlpiTickets, type GlpiBucket, type GlpiEtat, type GlpiRepartition } from '../lib/glpiApi';

/**
 * Le compteur de tickets GLPI, à côté de « Mon programme ».
 *
 * Ce qu'il montre, et pourquoi
 * ----------------------------
 * Le nombre seul ne fait rien faire. Ce sont les nouveaux et les en-attente qui
 * déclenchent une action en arrivant le matin : la répartition est donc affichée avec le
 * total, pas derrière un clic. Le nombre personnel est en dessous, parce que « combien
 * la file a-t-elle de tickets » et « combien en ai-je » sont deux questions et qu'on les
 * pose dans cet ordre.
 *
 * CE QU'IL NE FAIT JAMAIS : afficher 0 quand il ne sait pas. Un compteur tombé à zéro
 * parce que GLPI est injoignable annonce une file vide à une équipe qui en a quarante —
 * et personne ne va vérifier. Le dernier relevé connu est conservé, daté, et signalé
 * comme tel.
 *
 * Les quatre teintes sont une rampe ORDINALE d'une seule teinte, le sarcelle du MCO : les
 * états d'un ticket se suivent, ils ne sont pas quatre catégories indépendantes. Rampe
 * validée (clarté monotone, écarts visibles, extrémité claire au-dessus de 2:1 sur le
 * fond) sur fond clair comme sur fond sombre.
 */

const NUANCES: Record<keyof GlpiRepartition, string> = {
  nouveaux: 'var(--glpi-1)',
  enCours: 'var(--glpi-2)',
  enAttente: 'var(--glpi-3)',
  aClore: 'var(--glpi-4)',
};

/** Rampe sarcelle, claire → foncée sur fond clair, et son pendant pour le fond sombre. */
const RAMPE =
  '[--glpi-1:#14b8a6] [--glpi-2:#0d9488] [--glpi-3:#0f766e] [--glpi-4:#115e59] ' +
  'dark:[--glpi-1:#ccfbf1] dark:[--glpi-2:#5eead4] dark:[--glpi-3:#14b8a6] dark:[--glpi-4:#0f766e]';

function heure(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function quand(iso: string | null): string {
  if (!iso) return 'jamais';
  const d = new Date(iso);
  const aujourdhui = new Date().toDateString() === d.toDateString();
  return aujourdhui ? `relevé à ${heure(iso)}` : `relevé le ${d.toLocaleDateString('fr-FR')} à ${heure(iso)}`;
}

export function GlpiTicketsCard({ className = '' }: { className?: string }) {
  const [etat, setEtat] = useState<GlpiEtat | null>(null);

  useEffect(() => {
    let vivant = true;
    const charger = () =>
      fetchGlpiTickets()
        .then((e) => vivant && setEtat(e))
        // En mode autonome, ou si le serveur est momentanément indisponible, la tuile
        // disparaît au lieu d'afficher une erreur : ce n'est pas le sujet de l'écran.
        .catch(() => vivant && setEtat(null));
    void charger();
    // Le serveur sert un relevé mis en cache : ce sondage ne provoque pas une
    // interrogation de GLPI à chaque passage.
    const minuteur = setInterval(() => void charger(), 120_000);
    return () => {
      vivant = false;
      clearInterval(minuteur);
    };
  }, []);

  if (!etat?.actif) return null;

  const { total, parStatut, buckets, mien, mienInconnu, erreur, perime, releveLe, lien } = etat;
  const inconnu = total === null || parStatut === null;

  return (
    <Card className={`border-l-[3px] border-l-teal-600 p-4 dark:border-l-teal-500 ${RAMPE} ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-slate-600 dark:text-slate-300">Tickets GLPI ouverts</p>
        {perime && !inconnu && (
          <span className="shrink-0 text-[10px] font-medium text-amber-700 dark:text-amber-400">dernier relevé connu</span>
        )}
      </div>

      {inconnu ? (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Pas encore de relevé.
        </p>
      ) : (
        <>
          <div className="text-[40px] font-semibold leading-none tracking-tight text-slate-900 dark:text-white">{total}</div>
          <p className="mt-1 text-[11.5px] text-slate-600 dark:text-slate-300">
            {mienInconnu ? (
              <span className="text-slate-400">aucun compte GLPI ne correspond au vôtre</span>
            ) : mien === null ? (
              <span className="text-slate-400">part personnelle indisponible</span>
            ) : (
              <>
                dont <strong className="font-semibold text-slate-800 dark:text-slate-100">{mien}</strong> qui vous
                {mien > 1 ? ' sont affectés' : ' est affecté'}
              </>
            )}
          </p>

          <Repartition total={total} parStatut={parStatut} buckets={buckets} />
        </>
      )}

      {erreur && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          GLPI injoignable — {erreur}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[10.5px] text-slate-400 dark:border-slate-800">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-teal-600 dark:bg-teal-400" />
          MCO
        </span>
        <span className="truncate">
          {quand(releveLe)}
          {lien && (
            <>
              {' · '}
              <a href={lien} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-slate-600 dark:hover:text-slate-200">
                GLPI →
              </a>
            </>
          )}
        </span>
      </div>
    </Card>
  );
}

function Repartition({ total, parStatut, buckets }: { total: number; parStatut: GlpiRepartition; buckets: GlpiBucket[] }) {
  if (total === 0) {
    return <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">La file est vide.</p>;
  }
  const resume = buckets.map((b) => `${parStatut[b.cle]} ${b.libelle.toLowerCase()}`).join(', ');
  return (
    <>
      {/* Un filet de 2 px sépare les segments : sans lui, deux pas voisins de la rampe se
          touchent et la frontière disparaît. */}
      <div className="mt-3 flex h-3 gap-[2px] overflow-hidden rounded" role="img" aria-label={`Répartition : ${resume}`}>
        {buckets
          .filter((b) => parStatut[b.cle] > 0)
          .map((b) => (
            <div
              key={b.cle}
              title={`${b.libelle} : ${parStatut[b.cle]}`}
              style={{ flex: parStatut[b.cle], background: NUANCES[b.cle] }}
            />
          ))}
      </div>
      {/* La légende porte les valeurs : la couleur ne dit jamais rien seule. */}
      <dl className="mt-2.5 space-y-[3px]">
        {buckets.map((b) => (
          <div key={b.cle} className="flex items-center justify-between gap-3 text-[11.5px]">
            <dt className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
              <span aria-hidden className="h-[9px] w-[9px] shrink-0 rounded-sm" style={{ background: NUANCES[b.cle] }} />
              <span className="truncate">{b.libelle}</span>
            </dt>
            <dd className="shrink-0 font-medium tabular-nums text-slate-800 dark:text-slate-100">{parStatut[b.cle]}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
