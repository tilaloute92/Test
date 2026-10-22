import { isWeekend, toISODate } from './date';
import type { Absence, AbsenceType, TeamMember } from '../types';

/**
 * Taux de présence du service, jour par jour et sur la semaine.
 *
 * Le service doit rester tenu : en dessous d'un certain effectif présent, il n'y a plus
 * personne pour prendre un incident pendant qu'un autre est déjà dessus. Le seuil n'est
 * donc pas une statistique de confort, c'est une condition de fonctionnement — d'où le
 * signalement visuel plutôt qu'une ligne de plus dans un tableau.
 *
 * À ne pas confondre avec la CHARGE (voir workload.ts) : la charge dit si les gens
 * présents ont trop à faire, la présence dit s'il y a quelqu'un. Une équipe à 40 % de
 * présence et 30 % de charge est en danger, et aucun indicateur de charge ne le montre.
 */

/** Valeur de départ, utilisée tant que rien n'a été enregistré côté serveur. */
export const SEUIL_PRESENCE_DEFAUT = 0.5;

/**
 * Les absences qui retirent réellement quelqu'un du service.
 *
 * Le télétravail et l'astreinte n'en sont PAS : la personne travaille et reste joignable.
 * Les compter comme absentes ferait tomber le taux un jour où tout le monde est au poste,
 * et l'alerte serait ignorée au bout de deux semaines. La formation, elle, rend
 * indisponible : on ne sort pas quelqu'un d'une salle de formation pour un incident.
 */
export const TYPES_INDISPONIBLES: AbsenceType[] = ['conge', 'formation', 'autre'];

/**
 * Les libellés des natures d'absence. Ils vivent ICI, à côté de la règle qui dit
 * lesquelles retirent quelqu'un du service : écrire « conge » à l'écran parce que le
 * libellé habitait un autre module est une faute qu'on ne voit qu'une fois en production.
 */
export const ETIQUETTES_ABSENCE: Record<AbsenceType, string> = {
  conge: 'Congés',
  formation: 'Formation',
  teletravail: 'Télétravail',
  astreinte: 'Astreinte',
  autre: 'Absence',
};

export interface PresenceJour {
  date: Date;
  iso: string;
  /** Jour de week-end : compté, mais jamais signalé (voir `aSignaler`). */
  weekend: boolean;
  /** Personnes présentes, en comptant 0,5 par demi-journée d'absence. */
  presentes: number;
  effectif: number;
  /** 0 → 1. Vaut 1 si l'équipe est vide, faute de mieux : on n'alerte pas sur rien. */
  taux: number;
  /** Sous le seuil ET jour ouvré : c'est ce qui déclenche le signalement. */
  aSignaler: boolean;
  /** Qui manque, pour pouvoir le dire plutôt que d'afficher un pourcentage nu. */
  indisponibles: string[];
}

function partIndisponible(absences: Absence[], memberId: string, iso: string): number {
  const dansLeJour = absences.filter(
    (a) => a.memberId === memberId && a.date === iso && TYPES_INDISPONIBLES.includes(a.type)
  );
  if (dansLeJour.length === 0) return 0;
  if (dansLeJour.some((a) => a.period === 'jour')) return 1;
  // Deux demi-journées déclarées séparément valent une journée entière.
  const demiJournees = new Set(dansLeJour.map((a) => a.period));
  return Math.min(1, demiJournees.size * 0.5);
}

export function presenceJour(opts: {
  date: Date;
  members: TeamMember[];
  absences: Absence[];
  seuil?: number;
}): PresenceJour {
  const { date, members, absences, seuil = SEUIL_PRESENCE_DEFAUT } = opts;
  const iso = toISODate(date);
  const weekend = isWeekend(date);

  let presentes = 0;
  const indisponibles: string[] = [];
  for (const m of members) {
    const part = partIndisponible(absences, m.id, iso);
    presentes += 1 - part;
    if (part > 0) indisponibles.push(part === 1 ? m.name : `${m.name} (½ journée)`);
  }

  const effectif = members.length;
  const taux = effectif > 0 ? presentes / effectif : 1;
  return {
    date,
    iso,
    weekend,
    presentes: Math.round(presentes * 10) / 10,
    effectif,
    taux,
    // Le week-end n'est jamais signalé : l'équipe n'y est pas censée être au complet, et
    // une alerte qui se déclenche tous les samedis n'est plus lue le lundi.
    aSignaler: !weekend && effectif > 0 && taux < seuil,
    indisponibles,
  };
}

export function presenceJours(opts: {
  jours: Date[];
  members: TeamMember[];
  absences: Absence[];
  seuil?: number;
}): PresenceJour[] {
  return opts.jours.map((date) => presenceJour({ ...opts, date }));
}

/** Moyenne sur les jours OUVRÉS seulement : inclure le week-end, où personne n'est déclaré
 *  absent, remonterait mécaniquement la semaine et masquerait un creux du mardi. */
export function tauxSemaine(jours: PresenceJour[]): number {
  const ouvres = jours.filter((j) => !j.weekend);
  if (ouvres.length === 0) return 1;
  return ouvres.reduce((s, j) => s + j.taux, 0) / ouvres.length;
}

/**
 * Combien de demi-journées représentent ces absences.
 *
 * Une absence « jour » en vaut DEUX. Le compte se faisait auparavant sur le nombre
 * d'enregistrements, si bien qu'une journée entière de congé s'affichait « 1
 * demi-journée(s) » dans la charge — un chiffre faux doublé d'un libellé faux.
 */
export function demiJourneesAbsence(absences: Absence[]): number {
  return absences.reduce((total, a) => total + (a.period === 'jour' ? 2 : 1), 0);
}

/**
 * « ½ journée », « 1 journée », « 1 journée ½ », « 3 journées ».
 *
 * On compte en journées et non en demi-journées : c'est ainsi qu'on pose ses congés et
 * qu'on en parle. La demi-journée restante s'écrit « ½ », qui se lit d'un coup d'œil dans
 * un tableau, plutôt que « 3,5 journées », qui se calcule.
 */
export function formatDureeAbsence(demiJournees: number): string {
  if (demiJournees <= 0) return '—';
  const jours = Math.floor(demiJournees / 2);
  const demi = demiJournees % 2 === 1;
  if (jours === 0) return '½ journée';
  return `${jours} journée${jours > 1 ? 's' : ''}${demi ? ' ½' : ''}`;
}

/** Libellé court d'un jour, pour les messages d'alerte : « mer 21 ». */
export function jourCourt(d: Date): string {
  return `${['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'][d.getDay()]} ${d.getDate()}`;
}

export function pourcent(taux: number): string {
  return `${Math.round(taux * 100)} %`;
}
