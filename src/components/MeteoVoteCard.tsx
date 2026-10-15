import { useEffect, useState } from 'react';
import { Card } from './ui';
import { useMeteoVote } from '../hooks/useMeteoVote';
import { cleSemaine, depouiller, MOT_MAX, NIVEAUX, VOIX_MINIMUM, type AgregatMeteo } from '../lib/meteoVote';
import { weatherMeta, type WeatherLevel } from '../lib/weeklyReport';
import { startOfWeek } from '../lib/date';

/**
 * La tuile de vote, dans « Ma journée ».
 *
 * Elle n'apparaît que du jeudi à la clôture du vendredi : une tuile présente toute la
 * semaine serait ignorée les trois premiers jours, puis ignorée le jeudi par habitude.
 * Elle disparaît le lendemain de la réunion — ce qui est voté est voté.
 *
 * Elle ne montre JAMAIS le détail des voix tant que le vote est ouvert, seulement leur
 * nombre : voir la répartition se remplir pendant que les gens votent reviendrait à
 * attribuer chaque voix à mesure.
 */

const COULEUR: Record<WeatherLevel, string> = {
  ensoleille: '#16a34a',
  eclaircies: '#65a30d',
  nuageux: '#f59e0b',
  orageux: '#dc2626',
};

function heureCourte(iso: string): string {
  const d = new Date(iso);
  return d.getMinutes() === 0 ? `${d.getHours()} h` : `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
}

function memeJour(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function MeteoVoteCard() {
  const semaine = cleSemaine(startOfWeek(new Date()));
  const { agregat, chargement, erreur, disponible, voix, envoyer } = useMeteoVote(semaine);
  const [choix, setChoix] = useState<WeatherLevel | null>(null);
  const [mot, setMot] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [confirme, setConfirme] = useState(false);

  // Une voix déjà déposée depuis ce navigateur : on réaffiche ce qui a été envoyé. Sans
  // cela, la personne revenue sur la page verrait « votre voix est enregistrée » sans
  // pouvoir lire laquelle, et « modifier » obligerait à tout ressaisir.
  useEffect(() => {
    if (!voix) return;
    setChoix(voix.niveau);
    setMot(voix.mot);
    setConfirme(true);
  }, [voix]);

  if (!disponible || chargement || !agregat) return null;
  if (agregat.etat === 'a-venir') return null;
  if (agregat.etat === 'clos' && !memeJour(new Date(agregat.clotureIso), new Date())) return null;

  if (agregat.etat === 'clos') return <Resultat agregat={agregat} />;

  const deja = agregat.aVote;
  const modifiable = Boolean(voix);
  const verrouille = deja && !modifiable;

  const valider = async () => {
    if (!choix) return;
    setEnvoi(true);
    try {
      await envoyer(choix, mot.trim());
      setConfirme(true);
    } catch {
      // Message affiché par le hook ; la voix n'a pas été prise en compte.
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Météo de la semaine — votre voix</h3>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          fermeture vendredi {heureCourte(agregat.clotureIso)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Comment avez-vous vécu cette semaine ? Le vote est anonyme : ni vos collègues, ni le responsable, ni
        l'administrateur ne peuvent savoir qui a voté quoi.
      </p>

      {verrouille ? (
        <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Votre voix a été déposée depuis un autre poste ou un autre navigateur. Elle est comptée, mais elle ne peut plus
          être modifiée d'ici : pour que le serveur ignore qui a voté quoi, seul le navigateur qui a déposé la voix sait
          laquelle est la vôtre.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {NIVEAUX.map((n) => {
              const actif = choix === n;
              return (
                <button
                  key={n}
                  onClick={() => {
                    setChoix(n);
                    setConfirme(false);
                  }}
                  className={`rounded-lg border px-2 py-3 text-center transition ${
                    actif
                      ? 'border-transparent text-white shadow'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                  }`}
                  style={actif ? { background: COULEUR[n] } : undefined}
                >
                  <span className="block text-2xl leading-none">{weatherMeta[n].emoji}</span>
                  <span className={`mt-1 block text-xs font-medium ${actif ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                    {weatherMeta[n].label}
                  </span>
                </button>
              );
            })}
          </div>

          <input
            value={mot}
            maxLength={MOT_MAX}
            onChange={(e) => setMot(e.target.value)}
            placeholder="Un mot, si vous voulez (facultatif)"
            className="input mt-3 w-full text-xs"
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>Publié tel quel dans le rapport, jamais signé — {MOT_MAX} caractères.</span>
            <span>
              {agregat.total} voix sur {agregat.effectif} déjà déposée{agregat.total > 1 ? 's' : ''}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void valider()}
              disabled={!choix || envoi}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
            >
              {envoi ? 'Enregistrement…' : deja ? 'Modifier ma voix' : 'Déposer ma voix'}
            </button>
            {confirme && !envoi && (
              <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                ✓ Votre voix est enregistrée. Vous pouvez la changer jusqu'à vendredi {heureCourte(agregat.clotureIso)}.
              </span>
            )}
          </div>
        </>
      )}

      {erreur && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{erreur}</p>
      )}
    </Card>
  );
}

/** Après la clôture, le vendredi : ce qu'a donné le vote, sans avoir à ouvrir le rapport. */
function Resultat({ agregat }: { agregat: AgregatMeteo }) {
  const minimum = Math.min(VOIX_MINIMUM, agregat.effectif);
  const retenu = agregat.total >= minimum ? depouiller(agregat.voix) : null;
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Météo de la semaine — vote clos</h3>
      {retenu ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="text-3xl leading-none">{weatherMeta[retenu].emoji}</span>
          <div>
            <div className="text-base font-semibold text-slate-900 dark:text-white">{weatherMeta[retenu].label}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {agregat.total} voix sur {agregat.effectif} ·{' '}
              {NIVEAUX.filter((n) => agregat.voix[n] > 0)
                .map((n) => `${agregat.voix[n]} ${weatherMeta[n].label.toLowerCase()}`)
                .join(' · ')}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {agregat.total} voix sur {agregat.effectif} : trop peu pour publier une météo d'équipe ({minimum} minimum).
          Le rapport garde la météo calculée.
        </p>
      )}
    </Card>
  );
}
