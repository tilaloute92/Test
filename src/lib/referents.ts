import { addDays, getWorkingDaysOfWeek, isWeekend, startOfWeek, toISODate } from './date';
import { ETIQUETTES_ABSENCE, TYPES_INDISPONIBLES } from './presence';
import type { Absence, ReferentJour, TeamMember } from '../types';

/**
 * Le référent du jour — le tour de garde quotidien.
 *
 * Une équipe d'infrastructure travaille sur deux rythmes incompatibles : les sujets de
 * fond, qui demandent des demi-journées sans interruption, et ce qui tombe — une demande
 * d'un service, un incident, un appel. Sans règle, l'interruption se répartit sur tout le
 * monde et personne n'avance. Désigner quelqu'un pour la journée, c'est protéger les
 * autres : ce n'est pas une punition, c'est un roulement.
 *
 * DEUX DÉCISIONS portées par ce module :
 *
 * 1. UN SEUL RÉFÉRENT PAR JOUR. À deux, chacun suppose que l'autre a pris. La date est
 *    donc la clé, et désigner quelqu'un remplace la désignation précédente.
 * 2. UNE PERSONNE ABSENTE NE PEUT PAS ÊTRE RÉFÉRENTE. Désigner quelqu'un en congé, c'est
 *    une journée sans personne qui se croit couverte — pire que pas de référent du tout,
 *    qui au moins se voit. La règle d'absence est celle de la présence du service
 *    (voir presence.ts) : le télétravail et l'astreinte NE SONT PAS des absences, la
 *    personne travaille et reste joignable ; le congé, la formation et « autre » le sont,
 *    y compris en demi-journée — on ne tient pas une permanence un après-midi sur deux.
 */

/** Part de la journée pendant laquelle la personne n'est pas disponible : 0, 0,5 ou 1. */
export function partIndisponible(absences: Absence[], memberId: string, iso: string): number {
  const duJour = absences.filter((a) => a.memberId === memberId && a.date === iso && TYPES_INDISPONIBLES.includes(a.type));
  if (duJour.length === 0) return 0;
  if (duJour.some((a) => a.period === 'jour')) return 1;
  return Math.min(1, new Set(duJour.map((a) => a.period)).size * 0.5);
}

export function estIndisponible(absences: Absence[], memberId: string, iso: string): boolean {
  return partIndisponible(absences, memberId, iso) > 0;
}

/** Le motif d'indisponibilité, pour l'écrire plutôt que de griser sans explication. */
export function motifIndisponibilite(absences: Absence[], memberId: string, iso: string): string | null {
  const a = absences.find(
    (x) => x.memberId === memberId && x.date === iso && TYPES_INDISPONIBLES.includes(x.type)
  );
  if (!a) return null;
  const quand = a.period === 'jour' ? '' : a.period === 'matin' ? ' (matin)' : ' (après-midi)';
  // Le libellé saisi s'il existe, sinon le nom de la nature — jamais le code brut
  // « conge », qui n'a de sens que pour qui a lu le modèle de données.
  return `${a.label || ETIQUETTES_ABSENCE[a.type]}${quand}`;
}

export function referentDuJour(referents: ReferentJour[], iso: string): ReferentJour | undefined {
  return referents.find((r) => r.date === iso);
}

/** Qui peut être désigné ce jour-là. L'ordre est celui de l'équipe, pas un classement. */
export function membresDesignables(members: TeamMember[], absences: Absence[], iso: string): TeamMember[] {
  return members.filter((m) => !estIndisponible(absences, m.id, iso));
}

/**
 * Les jours qui portent un tour de garde : du LUNDI AU VENDREDI.
 *
 * Le planning de l'équipe, lui, couvre les sept jours — elle travaille en horaires
 * décalés et getWorkingDaysOfWeek rend donc lundi → dimanche. La permanence, non : un
 * samedi « à désigner » serait un trou permanent dans l'écran et dans le rapport, qui
 * annoncerait deux jours non pourvus là où il y en a vraiment deux, et quatre sinon.
 * Si l'équipe veut couvrir le week-end, c'est un réglage à ajouter, pas un oubli.
 */
export function joursDeGarde(jours: Date[]): Date[] {
  return jours.filter((j) => !isWeekend(j));
}

/** Les cinq jours ouvrés de la semaine qui contient `date`. */
export function semaineDe(date: Date): Date[] {
  return joursDeGarde(getWorkingDaysOfWeek(startOfWeek(date)));
}

/**
 * La semaine sur laquelle l'écran s'ouvre : la SUIVANTE.
 *
 * L'objectif est de déclarer une semaine à l'avance. Ouvrir sur la semaine en cours —
 * déjà jouée, et qu'on ne peut plus organiser — obligerait à cliquer « semaine suivante »
 * à chaque fois, et c'est précisément le clic qu'on oublie.
 */
export function semaineAPreparer(aujourdhui: Date): Date {
  return startOfWeek(addDays(aujourdhui, 7));
}

export interface JourReferent {
  date: Date;
  iso: string;
  membre: TeamMember | null;
  /** Désigné, mais absent ce jour-là : la journée n'est pas couverte pour autant. */
  indisponible: boolean;
  motif: string | null;
}

/**
 * L'état d'une semaine, jour par jour. `membre` à null = personne n'est désigné.
 *
 * Le cas « désigné PUIS mis en congé » est traité ici et non en effaçant la désignation :
 * on ne supprime pas en silence ce que quelqu'un a saisi. Le jour est signalé comme non
 * couvert, avec le nom de la personne et le motif, pour qu'on sache qui remplacer.
 */
export function etatSemaine(
  jours: Date[],
  referents: ReferentJour[],
  members: TeamMember[],
  absences: Absence[]
): JourReferent[] {
  return jours.map((date) => {
    const iso = toISODate(date);
    const r = referentDuJour(referents, iso);
    const membre = r ? (members.find((m) => m.id === r.memberId) ?? null) : null;
    const indisponible = Boolean(membre) && estIndisponible(absences, membre!.id, iso);
    return { date, iso, membre, indisponible, motif: membre ? motifIndisponibilite(absences, membre.id, iso) : null };
  });
}

/** Les jours sans référent utilisable : ni désigné, ou désigné mais absent. */
export function joursNonPourvus(etat: JourReferent[]): JourReferent[] {
  return etat.filter((j) => !j.membre || j.indisponible);
}

export interface PartRotation {
  membre: TeamMember;
  jours: number;
}

/**
 * Combien de jours chacun a pris sur une période. Classé du plus au moins sollicité :
 * « qui en a fait le plus » est la question qu'on pose, et elle se lit dans l'ordre.
 *
 * Les personnes à zéro FIGURENT dans la liste. C'est tout l'intérêt : un tour de garde
 * qui repose sur trois personnes sur cinq ne se voit que si les deux autres apparaissent.
 */
export function rotation(
  referents: ReferentJour[],
  members: TeamMember[],
  debutIso: string,
  finIso: string
): PartRotation[] {
  const compte = new Map<string, number>();
  for (const r of referents) {
    if (r.date < debutIso || r.date > finIso) continue;
    compte.set(r.memberId, (compte.get(r.memberId) ?? 0) + 1);
  }
  return members
    .map((membre) => ({ membre, jours: compte.get(membre.id) ?? 0 }))
    .sort((a, b) => b.jours - a.jours || a.membre.name.localeCompare(b.membre.name));
}

/** Premier et dernier jour du mois de `date`, au format ISO — la fenêtre de la rotation. */
export function moisDe(date: Date): { debut: string; fin: string } {
  const debut = new Date(date.getFullYear(), date.getMonth(), 1);
  const fin = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { debut: toISODate(debut), fin: toISODate(fin) };
}
