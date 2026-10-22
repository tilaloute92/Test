import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { useConfirm } from './ConfirmProvider';
import { Avatar, Card } from './ui';
import { addDays, formatWeekRange, startOfWeek, toISODate } from '../lib/date';
import {
  etatSemaine,
  joursNonPourvus,
  membresDesignables,
  moisDe,
  motifIndisponibilite,
  rotation,
  semaineAPreparer,
  semaineDe,
} from '../lib/referents';

/**
 * La bande du référent du jour : cinq cases, une par jour ouvré.
 *
 * ELLE S'OUVRE SUR LA SEMAINE PROCHAINE, pas sur celle en cours. L'objectif est de
 * déclarer une semaine à l'avance ; ouvrir sur une semaine déjà jouée obligerait à
 * cliquer « suivante » à chaque fois, et c'est le clic qu'on oublie.
 *
 * Un jour sans personne est en pointillés ambre, jamais vide et silencieux : le trou est
 * l'information la plus utile de l'écran, c'est lui qu'on vient combler le vendredi.
 */
export function ReferentJourCard() {
  const { members, absences, referents, setReferentJour } = useStore();
  const confirm = useConfirm();
  const [lundi, setLundi] = useState<Date>(() => semaineAPreparer(new Date()));

  const jours = useMemo(() => semaineDe(lundi), [lundi]);
  const etat = useMemo(() => etatSemaine(jours, referents, members, absences), [jours, referents, members, absences]);
  const trous = joursNonPourvus(etat);
  const mois = useMemo(() => moisDe(lundi), [lundi]);
  const parts = useMemo(() => rotation(referents, members, mois.debut, mois.fin), [referents, members, mois]);

  const lundiCourant = toISODate(startOfWeek(new Date()));
  const ecart = Math.round((lundi.getTime() - new Date(`${lundiCourant}T12:00:00`).getTime()) / (7 * 86400000));
  const situation = ecart === 0 ? 'cette semaine' : ecart === 1 ? 'semaine prochaine' : ecart < 0 ? 'semaine passée' : `dans ${ecart} semaines`;

  const designer = async (iso: string, memberId: string) => {
    const avant = etat.find((j) => j.iso === iso);
    // Remplacer ou retirer une désignation touche une donnée existante : l'application
    // demande confirmation partout ailleurs dans ce cas, et désigner quelqu'un à la place
    // d'un collègue n'est pas anodin. Combler un jour vide est une création : pas de
    // question posée.
    if (avant?.membre) {
      const nom = memberId ? (members.find((m) => m.id === memberId)?.name ?? '') : null;
      const ok = await confirm({
        title: nom ? 'Changer le référent' : 'Retirer le référent',
        message: nom
          ? `${avant.membre.name} est déjà référent ce jour-là. Le remplacer par ${nom} ?`
          : `Retirer ${avant.membre.name} du référent de ce jour ? La journée n'aura plus personne.`,
      });
      if (!ok) return;
    }
    setReferentJour(iso, memberId || null);
  };

  if (members.length === 0) return null;

  return (
    <Card className="p-4 print:break-inside-avoid">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Référent du jour</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Qui prend les demandes et les incidents qui arrivent, pendant que les autres restent sur leur programme.
          </p>
        </div>
        <div className="flex items-center gap-1.5 print:hidden">
          <button
            onClick={() => setLundi((d) => addDays(d, -7))}
            aria-label="Semaine précédente"
            className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            ‹
          </button>
          <span className="min-w-[13rem] text-center text-xs text-slate-600 dark:text-slate-300">
            {formatWeekRange(jours)} <span className="text-slate-400">· {situation}</span>
          </span>
          <button
            onClick={() => setLundi((d) => addDays(d, 7))}
            aria-label="Semaine suivante"
            className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {etat.map((jour) => {
          const designables = membresDesignables(members, absences, jour.iso);
          const vide = !jour.membre;
          return (
            <div
              key={jour.iso}
              className={`rounded-xl border p-2.5 text-center ${
                jour.indisponible
                  ? 'border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10'
                  : vide
                    ? 'border-dashed border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10'
                    : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {jour.date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}
              </div>
              <div className="mt-1.5 flex justify-center">
                {jour.membre ? (
                  <Avatar name={jour.membre.name} color={jour.membre.color} initials={jour.membre.initials} size={28} />
                ) : (
                  <span aria-hidden className="h-7 w-7 rounded-full border border-dashed border-amber-400 dark:border-amber-500" />
                )}
              </div>
              <select
                value={jour.membre?.id ?? ''}
                onChange={(e) => void designer(jour.iso, e.target.value)}
                aria-label={`Référent du ${jour.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                className={`mt-1.5 w-full cursor-pointer truncate rounded-md border-0 bg-transparent text-center text-xs ${
                  vide ? 'italic text-amber-700 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                <option value="">à désigner</option>
                {/* La personne déjà désignée reste dans la liste même devenue indisponible :
                    sans elle, le champ afficherait « à désigner » alors que quelqu'un l'est,
                    et on ne saurait plus qui remplacer. */}
                {jour.membre && !designables.some((m) => m.id === jour.membre!.id) && (
                  <option value={jour.membre.id}>{jour.membre.name} (absent)</option>
                )}
                {designables.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              {jour.indisponible && (
                <p className="mt-0.5 text-[10px] leading-tight text-red-700 dark:text-red-300">
                  absent{jour.motif ? ` — ${jour.motif}` : ''} : à remplacer
                </p>
              )}
              {!jour.membre && designables.length === 0 && (
                <p className="mt-0.5 text-[10px] leading-tight text-amber-700 dark:text-amber-400">personne de disponible</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
        <span className={trous.length > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
          {trous.length === 0
            ? 'Les cinq jours ont un référent.'
            : `${trous.length} jour(s) sans référent : ${trous.map((j) => j.date.toLocaleDateString('fr-FR', { weekday: 'long' })).join(', ')}.`}
        </span>
        {/* La rotation du mois, parce que « qui en a fait le plus » est la vraie question
            d'un tour de garde — et que les personnes à zéro n'apparaissent nulle part
            ailleurs. */}
        <span className="min-w-0 text-slate-500 dark:text-slate-400">
          Ce mois-ci : {parts.map((p) => `${p.membre.name} ${p.jours} j`).join(' · ')}
        </span>
      </div>
    </Card>
  );
}

/** Le référent d'aujourd'hui, pour les écrans qui l'annoncent. */
function useReferentAujourdhui() {
  const { members, absences, referents } = useStore();
  const iso = toISODate(new Date());
  const r = referents.find((x) => x.date === iso);
  const membre = r ? (members.find((m) => m.id === r.memberId) ?? null) : null;
  return { membre, indisponible: Boolean(membre) && Boolean(motifIndisponibilite(absences, membre!.id, iso)) };
}

/**
 * Ce que « Ma journée » annonce du tour de garde.
 *
 * Trois états, et le troisième compte autant que les deux autres : quand personne n'est
 * désigné, l'écran le dit. Une journée sans référent qui ne se voit nulle part, c'est
 * une journée où chacun suppose que c'est quelqu'un d'autre.
 */
export function BandeauReferentDuJour({ memberId, onOuvrirPlanning }: { memberId: string; onOuvrirPlanning: () => void }) {
  const { membre, indisponible } = useReferentAujourdhui();

  if (membre && membre.id === memberId && !indisponible) {
    return (
      <Card className="flex items-center gap-3 border-violet-200 bg-violet-50 p-3 dark:border-violet-500/40 dark:bg-violet-500/10">
        <Avatar name={membre.name} color={membre.color} initials={membre.initials} size={32} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">Aujourd'hui, c'est vous le référent</p>
          <p className="text-xs text-violet-800/80 dark:text-violet-300/80">
            Les demandes et les incidents qui arrivent sont pour vous — les autres restent sur leur programme.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-wrap items-center gap-2 p-2.5 text-xs">
      {membre ? (
        <>
          <span className="text-slate-500 dark:text-slate-400">Référent du jour :</span>
          <Avatar name={membre.name} color={membre.color} initials={membre.initials} size={20} />
          <span className="font-medium text-slate-800 dark:text-slate-100">{membre.name}</span>
          {indisponible && <span className="text-red-700 dark:text-red-400">— absent aujourd'hui, à remplacer</span>}
        </>
      ) : (
        <span className="text-amber-700 dark:text-amber-400">Personne n'est référent aujourd'hui.</span>
      )}
      <button onClick={onOuvrirPlanning} className="ml-auto text-violet-600 hover:underline dark:text-violet-400">
        {membre ? 'Voir la semaine →' : 'Désigner →'}
      </button>
    </Card>
  );
}
