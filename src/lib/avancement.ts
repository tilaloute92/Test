import type { ProjectTask } from '../types';

/**
 * L'avancement d'une tâche et d'un projet, en un seul endroit.
 *
 * Il y en avait deux, qui ne donnaient pas le même chiffre pour le même projet : le
 * rapport de réunion comptait la part du BUDGET D'HEURES portée par les tâches terminées,
 * le bloc Flash reports comptait le NOMBRE de tâches terminées. Deux écrans, deux
 * pourcentages, et aucun moyen de savoir lequel croire — c'est le genre d'écart qui
 * décrédibilise tout le reste du tableau de bord.
 *
 * Désormais deux chiffres, nommés, calculés ici et nulle part ailleurs :
 *
 * - l'AVANCEMENT DÉCLARÉ : la moyenne des pourcentages saisis sur les tâches, pondérée
 *   par leurs heures estimées. C'est une appréciation humaine, et elle seule sait dire
 *   qu'une tâche de 40 h est à moitié faite ;
 * - les TÂCHES TERMINÉES : la part du budget d'heures effectivement bouclée. Celle-là ne
 *   dépend de l'avis de personne, et c'est pourquoi elle reste affichée à côté.
 *
 * Les afficher ensemble n'est pas de la redondance : un projet déclaré à 80 % dont 10 %
 * des heures sont terminées dit quelque chose qu'aucun des deux chiffres ne dit seul.
 */

/**
 * L'avancement d'une tâche, de 0 à 100.
 *
 * Une tâche terminée vaut 100, quoi qu'on ait saisi avant : le statut l'emporte sur
 * l'estimation, sans quoi un projet resterait à 85 % avec toutes ses tâches bouclées.
 * Une tâche sans estimation vaut 0 tant qu'elle n'est pas terminée — c'est le
 * comportement d'avant, pour que rien ne change sur les tâches jamais renseignées.
 */
export function avancementTache(t: ProjectTask): number {
  if (t.status === 'termine') return 100;
  const v = t.avancement;
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 0;
}

/** Vrai si quelqu'un a saisi un avancement sur cette tâche (et qu'elle n'est pas terminée). */
export function avancementSaisi(t: ProjectTask): boolean {
  return t.status !== 'termine' && typeof t.avancement === 'number' && t.avancement > 0;
}

export interface AvancementProjet {
  /** 0–100 : moyenne des avancements des tâches, pondérée par les heures estimées. */
  declare: number;
  /** 0–100 : part du budget d'heures portée par les tâches terminées. */
  termine: number;
  /** Faux quand aucune tâche n'est estimée : les deux chiffres sont alors de simples
   *  moyennes par tâche, ce que l'interface doit pouvoir dire. */
  pondere: boolean;
  /** Nombre de tâches portant un avancement saisi — pour distinguer « 0 % parce que rien
   *  n'a commencé » de « 0 % parce que personne n'a rempli ». */
  tachesRenseignees: number;
}

export function avancementProjet(taches: ProjectTask[]): AvancementProjet {
  if (taches.length === 0) return { declare: 0, termine: 0, pondere: false, tachesRenseignees: 0 };

  const budget = taches.reduce((s, t) => s + t.estimatedHours, 0);
  const tachesRenseignees = taches.filter(avancementSaisi).length;

  if (budget > 0) {
    const declare = taches.reduce((s, t) => s + t.estimatedHours * avancementTache(t), 0) / budget;
    const termine = taches.filter((t) => t.status === 'termine').reduce((s, t) => s + t.estimatedHours, 0) / budget;
    return { declare: Math.round(declare), termine: Math.round(termine * 100), pondere: true, tachesRenseignees };
  }

  // Aucune heure estimée — fréquent au début d'un projet : on retombe sur la moyenne
  // simple, en le signalant plutôt qu'en laissant croire à une pondération.
  const declare = taches.reduce((s, t) => s + avancementTache(t), 0) / taches.length;
  const termine = taches.filter((t) => t.status === 'termine').length / taches.length;
  return { declare: Math.round(declare), termine: Math.round(termine * 100), pondere: false, tachesRenseignees };
}
