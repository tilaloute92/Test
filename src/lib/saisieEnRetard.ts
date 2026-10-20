import { addDays, isWeekend, toISODate } from './date';
import { heuresRecurrentes, type Recurrence } from './recurrences';
import { hoursLoggedToday } from './selectors';
import { cibleDuJour } from './workload';
import type { Absence, TeamMember, TimeEntry } from '../types';

/**
 * Les journées passées qu'il reste à saisir.
 *
 * « Ma journée » ne regardait que le jour même : à minuit, les heures non saisies de la
 * veille disparaissaient de l'écran. Pour les retrouver il fallait ouvrir Activité du
 * jour et reculer jour par jour, en sachant déjà qu'il y avait quelque chose à rattraper
 * — autant dire ne jamais les saisir. Or personne ne remplit ses heures à la minute :
 * saisir la veille est le geste courant, pas l'exception.
 *
 * Ce qui est RETENU : un jour ouvré passé où il manque au moins une tranche entière par
 * rapport à la cible du jour, absences déduites. Une journée entière d'absence a une
 * cible nulle et n'apparaît donc jamais ; une demi-journée d'absence ramène la cible à
 * la moitié, et une demi-journée travaillée et saisie suffit alors à sortir de la liste.
 *
 * Le seuil d'une tranche évite de harceler pour un quart d'heure, sans masquer une
 * demi-journée oubliée. Les week-ends sont ignorés : quelqu'un peut y travailler, mais
 * signaler chaque samedi comme « incomplet » noierait le signal utile.
 */
export interface JourIncomplet {
  date: Date;
  iso: string;
  /** Heures saisies, créneaux récurrents compris. */
  saisi: number;
  /** Ce que la journée aurait dû porter, absences déduites. */
  cible: number;
  manque: number;
}

/** Au-delà, on ne rattrape plus : on reconstitue, et la liste devient un reproche. */
export const PROFONDEUR_RATTRAPAGE = 5;

export function joursIncomplets(opts: {
  member: TeamMember;
  timeEntries: TimeEntry[];
  absences: Absence[];
  recurrences: Recurrence[];
  /** Injectable pour les tests ; par défaut aujourd'hui. */
  aujourdhui?: Date;
  profondeur?: number;
}): JourIncomplet[] {
  const { member, timeEntries, absences, recurrences } = opts;
  const aujourdhui = opts.aujourdhui ?? new Date();
  const profondeur = opts.profondeur ?? PROFONDEUR_RATTRAPAGE;

  const trouves: JourIncomplet[] = [];
  let examines = 0;
  // On remonte à partir d'HIER : la journée en cours n'est pas en retard, elle est en
  // cours, et c'est la tuile « Heures à valider » qui s'en occupe.
  for (let recul = 1; examines < profondeur && recul <= profondeur * 3; recul += 1) {
    const date = addDays(aujourdhui, -recul);
    if (isWeekend(date)) continue;
    examines += 1;

    const cible = cibleDuJour(member, absences, date);
    if (cible <= 0) continue;

    const saisi =
      hoursLoggedToday(timeEntries, member.id, date) +
      heuresRecurrentes({ recurrences, date, memberId: member.id, absences, timeEntries });
    const manque = Math.round((cible - saisi) * 100) / 100;
    if (manque >= 1) trouves.push({ date, iso: toISODate(date), saisi: Math.round(saisi * 100) / 100, cible, manque });
  }
  return trouves;
}
