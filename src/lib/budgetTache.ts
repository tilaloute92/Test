import { PERIOD_HOURS } from './date';
import { periodeDuCreneau } from './creneaux';
import type { PlanningSlot, ProjectTask, TimeEntry } from '../types';

/**
 * Le budget d'une tâche : sa charge estimée face à ce qui a déjà été consommé.
 *
 * Sert à ne plus PROPOSER une tâche dont le budget est atteint dans les listes
 * d'affectation — celles qui réservent une demi-journée à quelqu'un. Programmer encore du
 * travail sur un budget épuisé, c'est soit se tromper de tâche, soit avoir sous-estimé :
 * dans les deux cas, mieux vaut s'en apercevoir au moment de planifier qu'à la fin du
 * mois.
 *
 * DEUX COMPTEURS, ET LE PLUS CONTRAIGNANT DES DEUX l'emporte :
 *
 * - le TEMPS SAISI, ce qui a réellement été passé ;
 * - le TEMPS RÉSERVÉ, les demi-journées déjà bloquées dans le planning.
 *
 * Le second compte, même sans une heure saisie : six demi-journées réservées sur une
 * tâche estimée à une journée, c'est déjà un dépassement décidé, simplement pas encore
 * constaté. On prend le maximum et non la somme — une demi-journée réservée PUIS saisie
 * est la même demi-journée, l'additionner compterait deux fois le même travail.
 *
 * CE QUE CE MODULE NE FAIT PAS : masquer la tâche dans la saisie du temps. C'est là qu'on
 * déclare ce qui s'est réellement passé ; l'en retirer rendrait le dépassement invisible
 * et ferait atterrir les heures sur une autre tâche, ce qui fausserait tout le reste.
 *
 * SANS ESTIMATION, PAS DE BUDGET : une tâche à 0 h estimée n'est jamais masquée. Une
 * estimation vide veut dire « on ne sait pas », pas « zéro heure ».
 */

export interface BudgetTache {
  /** La charge estimée. 0 = aucune estimation, donc aucun budget à atteindre. */
  estime: number;
  /** Heures réellement saisies sur la tâche. */
  saisi: number;
  /** Heures déjà réservées : demi-journées de planning et créneaux horaires. */
  planifie: number;
  /** Le plus contraignant des deux. */
  consomme: number;
  /** Ce qu'il reste avant d'atteindre l'estimation ; 0 si elle est dépassée. */
  reste: number;
  /** Budget atteint ou dépassé — et une estimation existe. */
  atteint: boolean;
}

export function budgetTache(task: ProjectTask, timeEntries: TimeEntry[], planningSlots: PlanningSlot[]): BudgetTache {
  const estime = Number(task.estimatedHours) || 0;

  let saisi = 0;
  for (const e of timeEntries) if (e.taskId === task.id) saisi += e.hours;

  // Les demi-journées réservées à la tâche. Quatre heures chacune : c'est la convention
  // de toute l'application pour la charge planifiée (voir workload.ts).
  const demiJournees = planningSlots.filter((s) => s.taskId === task.id);
  let planifie = demiJournees.length * PERIOD_HOURS;

  // Un créneau horaire réserve en général la demi-journée qui le porte — elle est alors
  // déjà comptée ci-dessus. On n'ajoute que ceux qui tombent sur une demi-journée non
  // réservée, sans quoi une intervention d'une heure en ferait compter cinq.
  const reservees = new Set(demiJournees.map((s) => `${s.memberId}|${s.date}|${s.period}`));
  for (const c of task.creneaux ?? []) {
    if (reservees.has(`${c.memberId}|${c.date}|${periodeDuCreneau(c)}`)) continue;
    planifie += c.duree;
  }

  const consomme = Math.max(saisi, planifie);
  return {
    estime,
    saisi: Math.round(saisi * 10) / 10,
    planifie: Math.round(planifie * 10) / 10,
    consomme: Math.round(consomme * 10) / 10,
    reste: estime > 0 ? Math.max(0, Math.round((estime - consomme) * 10) / 10) : 0,
    atteint: estime > 0 && consomme >= estime,
  };
}

/**
 * Les tâches à proposer dans une liste d'AFFECTATION, et celles qui en sont retirées.
 *
 * `gardee` reste proposée même si son budget est atteint : c'est la tâche déjà affectée
 * au créneau qu'on modifie. L'en retirer viderait la liste déroulante de sa propre valeur
 * et donnerait à croire que le créneau n'a rien.
 */
export function filtrerBudgetAtteint(
  taches: ProjectTask[],
  timeEntries: TimeEntry[],
  planningSlots: PlanningSlot[],
  gardee?: string | null
): { proposees: ProjectTask[]; masquees: ProjectTask[] } {
  const proposees: ProjectTask[] = [];
  const masquees: ProjectTask[] = [];
  for (const t of taches) {
    if (t.id === gardee || !budgetTache(t, timeEntries, planningSlots).atteint) proposees.push(t);
    else masquees.push(t);
  }
  return { proposees, masquees };
}
