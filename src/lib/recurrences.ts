import { toISODate } from './date';
import { formatDuree, formatHeure, PERIOD_RANGES, periodForHour } from './hours';
import type { Absence, Period, TimeEntry } from '../types';

/**
 * Les créneaux récurrents : ce qui revient chaque semaine à heure fixe et occupe tout le
 * monde, à commencer par la réunion d'équipe du vendredi.
 *
 * Ce n'est ni une tâche ni une absence, et c'est pour ça que ça existe à part :
 * - une TÂCHE devrait être ressaisie chaque semaine par chacun, traînerait indéfiniment
 *   dans la liste et remonterait dans les relances « sans heure saisie » ;
 * - une ABSENCE se compte par demi-journée et sortirait les gens de l'effectif présent —
 *   le service tomberait sous le seuil tous les vendredis après-midi alors que l'équipe
 *   est au complet, dans la même pièce.
 *
 * Une récurrence est donc une RÈGLE, pas un enregistrement : rien n'est écrit chaque
 * semaine, les heures sont déduites à l'affichage. Conséquence voulue : pas de doublon à
 * nettoyer, pas de rattrapage à faire sur les semaines passées quand on change l'horaire,
 * et supprimer la règle ne laisse aucune trace à ramasser.
 *
 * Deux façons de ne pas être compté, sans rien déclarer de plus :
 * - être déclaré absent sur la demi-journée (congé, formation…) ;
 * - avoir saisi son propre temps sur les tranches couvertes — qui travaille sur autre
 *   chose pendant la réunion le dit en saisissant ce qu'il a fait, et sa saisie l'emporte.
 */

export interface Recurrence {
  id: string;
  libelle: string;
  /** Jour de la semaine au sens de Date.getDay() : 1 = lundi … 5 = vendredi. */
  jour: number;
  /** Heure de début en décimal : 14,5 pour 14:30. */
  debut: number;
  /** Durée en heures : 1,5 pour une heure et demie. */
  duree: number;
  /** Identifiants des participants, ou null pour toute l'équipe — ce qui évite d'avoir à
   *  modifier la règle à chaque arrivée ou départ. */
  participants: string[] | null;
}

/** La réunion d'équipe du vendredi, telle qu'elle existe déjà dans le service. Sert tant
 *  que rien n'a été enregistré, et en mode autonome où il n'y a pas de serveur. */
export const RECURRENCES_DEFAUT: Recurrence[] = [
  { id: 'reunion-hebdo', libelle: "Réunion d'équipe", jour: 5, debut: 14.5, duree: 1.5, participants: null },
];

export const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

// Les deux mises en forme vivent dans hours.ts, avec le reste du découpage horaire ; on
// les re-expose ici parce que l'essentiel de leurs appels vient des créneaux.
export { formatDuree, formatHeure };

/** « 14:30 → 16:00 » */
export function formatPlage(r: Recurrence): string {
  return `${formatHeure(r.debut)} → ${formatHeure(r.debut + r.duree)}`;
}

export function concerne(r: Recurrence, memberId: string): boolean {
  return r.participants === null || r.participants.includes(memberId);
}

/** La demi-journée où tombe le créneau. Un créneau à cheval est rattaché à celle où il
 *  commence : il faut bien l'afficher quelque part, et c'est là qu'on le rejoint. */
export function periodeDe(r: Recurrence): Period {
  return periodForHour(Math.floor(r.debut)) ?? (r.debut < 12 ? 'matin' : 'apres_midi');
}

/** Les tranches d'une heure que le créneau recouvre, même partiellement : une réunion de
 *  14:30 à 16:00 occupe bel et bien le créneau de 14:00 — on ne peut pas y mettre autre
 *  chose. */
export function tranchesCouvertes(r: Recurrence): number[] {
  const periode = periodeDe(r);
  const { start, end } = PERIOD_RANGES[periode];
  const tranches: number[] = [];
  for (let h = Math.max(start, Math.floor(r.debut)); h < Math.min(end, Math.ceil(r.debut + r.duree)); h++) {
    tranches.push(h);
  }
  return tranches;
}

export function recurrencesDuJour(recurrences: Recurrence[], date: Date, memberId?: string): Recurrence[] {
  return recurrences.filter((r) => r.jour === date.getDay() && (!memberId || concerne(r, memberId)));
}

function absentSur(absences: Absence[], memberId: string, iso: string, periode: Period): boolean {
  return absences.some((a) => a.memberId === memberId && a.date === iso && (a.period === 'jour' || a.period === periode));
}

/** Ce que vaut un créneau récurrent pour une personne, un jour donné. */
export interface CreneauRetenu {
  recurrence: Recurrence;
  /** Heures comptées : les TRANCHES D'UNE HEURE que le créneau occupe (voir plus bas). */
  heures: number;
  /** Heures saisies par ailleurs sur la plage du créneau — information, pas déduction. */
  dejaSaisi: number;
  /** Renseigné quand rien n'est compté, pour pouvoir le dire à l'écran. */
  ecarte: 'absent' | null;
}

/** Intersection, en heures, entre deux plages horaires. */
function chevauchement(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/**
 * Les créneaux récurrents de la journée, avec ce qu'ils comptent réellement.
 *
 * Un créneau compte LES TRANCHES D'UNE HEURE QU'IL OCCUPE, et non sa durée exacte : la
 * réunion de 14:30 à 16:00 prend les tranches de 14 h et de 15 h, elle compte donc 2 h et
 * non 1 h 30. C'est la réalité d'une demi-journée — la demi-heure qui précède une réunion
 * ne sert à rien d'autre — et c'est aussi ce que montre la grille, qui ne sait afficher
 * que des tranches entières. Compter 1 h 30 là où la grille en bloque 2 laissait un écart
 * inexplicable entre ce qu'on voit et ce qui est compté.
 *
 * Deux règles écartées en chemin, et pourquoi :
 * - tout ou rien (une saisie sur l'une des heures faisait sauter le créneau entier) :
 *   valider son 14:00 effaçait la réunion sans rien dire ;
 * - au prorata (durée moins le temps déjà saisi sur la plage) : exact à la minute, mais
 *   une réunion d'1 h 30 finissait comptée 1 h, ce qui la sous-estime plus encore.
 *
 * Reste l'absence, qui écarte toujours le créneau en entier : on n'était pas là.
 */
export function creneauxRecurrents(opts: {
  recurrences: Recurrence[];
  date: Date;
  memberId: string;
  absences: Absence[];
  timeEntries: TimeEntry[];
}): CreneauRetenu[] {
  const { recurrences, date, memberId, absences, timeEntries } = opts;
  const iso = toISODate(date);
  const duJour = timeEntries.filter((e) => e.memberId === memberId && e.date === iso && e.hour !== undefined);

  return recurrencesDuJour(recurrences, date, memberId).map((recurrence) => {
    const fin = recurrence.debut + recurrence.duree;
    if (absentSur(absences, memberId, iso, periodeDe(recurrence))) {
      return { recurrence, heures: 0, dejaSaisi: 0, ecarte: 'absent' as const };
    }
    // Les saisies flottantes (sans heure d'ancrage) ne disent pas à quel moment le temps a
    // été passé : les supposer sur la réunion serait une invention.
    const dejaSaisi =
      Math.round(duJour.reduce((s, e) => s + chevauchement(e.hour!, e.hour! + e.hours, recurrence.debut, fin), 0) * 100) / 100;
    return { recurrence, heures: tranchesCouvertes(recurrence).length, dejaSaisi, ecarte: null };
  });
}

/** Total en heures des créneaux récurrents — ce qui s'ajoute aux heures saisies. */
export function heuresRecurrentes(opts: Parameters<typeof creneauxRecurrents>[0]): number {
  return Math.round(creneauxRecurrents(opts).reduce((s, c) => s + c.heures, 0) * 100) / 100;
}

/**
 * Les mêmes heures sur une suite de jours, pour la semaine du rapport.
 *
 * Les jours à VENIR sont exclus : un créneau qui n'a pas encore eu lieu n'est pas du temps
 * passé. Sans cette règle, le rapport ouvert un lundi compterait déjà la réunion du
 * vendredi suivant dans les heures de la semaine, et l'équipe apparaîtrait en avance sur
 * un travail qu'elle n'a pas fait.
 */
export function heuresRecurrentesSur(opts: {
  recurrences: Recurrence[];
  jours: Date[];
  memberId: string;
  absences: Absence[];
  timeEntries: TimeEntry[];
  /** Injectable pour les tests ; par défaut aujourd'hui. */
  aujourdhui?: Date;
}): number {
  const { jours, aujourdhui = new Date(), ...reste } = opts;
  const limite = toISODate(aujourdhui);
  return jours
    .filter((date) => toISODate(date) <= limite)
    .reduce((s, date) => s + heuresRecurrentes({ ...reste, date }), 0);
}

/** Contrôle d'une règle saisie dans Paramètres. Renvoie le message d'erreur, ou null. */
export function verifierRecurrence(r: Recurrence): string | null {
  if (!r.libelle.trim()) return 'Donnez un libellé au créneau.';
  if (!Number.isInteger(r.jour) || r.jour < 1 || r.jour > 5) return 'Le jour doit être un jour ouvré.';
  if (!(r.debut >= 6 && r.debut < 20)) return 'L’heure de début doit être comprise entre 6 h et 20 h.';
  if (!(r.duree > 0 && r.duree <= 8)) return 'La durée doit être comprise entre 15 minutes et 8 heures.';
  if (r.participants !== null && r.participants.length === 0) return 'Choisissez au moins un participant.';
  return null;
}
