import { PERIOD_HOURS, toISODate } from './date';
import type { Absence, ProjectTask, TaskType, TeamMember, TimeEntry } from '../types';

/**
 * Historique de la charge, mois par mois.
 *
 * L'onglet Temps répondait à « qu'avons-nous fait cette semaine, ce trimestre ? ». Il ne
 * répondait pas à « est-ce qu'on absorbe plus de MCO qu'il y a six mois ? », ni à « est-ce
 * que la part projet se réduit ? » — les deux questions qu'on pose en COPIL pour demander
 * un poste ou arbitrer un arrêt.
 *
 * Les heures sont toujours présentées FACE À LA CAPACITÉ du mois. Un volume d'heures seul
 * ne dit rien : 420 h est excellent ou catastrophique selon que l'équipe en avait 480 ou
 * 350 de disponibles ce mois-là.
 */

export const NATURES: TaskType[] = ['Projet', 'Incident', 'MCO'];

export interface MoisCharge {
  /** Premier jour du mois, pour trier et pour les libellés. */
  debut: Date;
  /** « nov. 25 » — court, c'est une étiquette d'axe. */
  label: string;
  /** Heures saisies par nature de travail. */
  heures: Record<TaskType, number>;
  /** Heures saisies sur une tâche qui n'existe plus : comptées, jamais attribuées. */
  heuresSansTache: number;
  total: number;
  /** Capacité de l'équipe sur le mois, absences déduites. */
  capacite: number;
}

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function cleMois(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Capacité d'un mois : le volume hebdomadaire de chaque personne ramené au nombre de jours
 * du mois, moins les demi-journées d'absence.
 *
 * Volontairement calé sur le même modèle que la charge hebdomadaire (voir workload.ts) :
 * `weeklyHours` couvre une semaine de sept jours, ce qui permet les horaires décalés sans
 * fausser le calcul. Prendre « jours ouvrés × 7 h » donnerait un autre chiffre que l'onglet
 * Vue d'ensemble pour la même équipe, et personne ne saurait lequel croire.
 */
function capaciteDuMois(annee: number, mois: number, members: TeamMember[], absences: Absence[]): number {
  const jours = new Date(annee, mois + 1, 0).getDate();
  const prefixe = `${annee}-${String(mois + 1).padStart(2, '0')}`;
  let capacite = 0;
  for (const m of members) {
    capacite += (m.weeklyHours * jours) / 7;
  }
  for (const a of absences) {
    if (!a.date.startsWith(prefixe)) continue;
    if (!members.some((m) => m.id === a.memberId)) continue;
    capacite -= a.period === 'jour' ? PERIOD_HOURS * 2 : PERIOD_HOURS;
  }
  return Math.max(0, Math.round(capacite));
}

/**
 * Les `nbMois` derniers mois, le mois courant compris.
 *
 * Les mois sans la moindre saisie sont conservés : les retirer ferait d'un trou dans la
 * saisie une absence de travail, et le graphique mentirait en cachant précisément ce qu'on
 * voudrait voir.
 */
export function historiqueCharge(opts: {
  nbMois: number;
  timeEntries: TimeEntry[];
  tasks: ProjectTask[];
  members: TeamMember[];
  absences: Absence[];
  /** Injectable pour les tests ; par défaut aujourd'hui. */
  maintenant?: Date;
}): MoisCharge[] {
  const { nbMois, timeEntries, tasks, members, absences } = opts;
  const maintenant = opts.maintenant ?? new Date();

  const mois: MoisCharge[] = [];
  const index = new Map<string, MoisCharge>();
  for (let i = nbMois - 1; i >= 0; i--) {
    const debut = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    const m: MoisCharge = {
      debut,
      label: `${MOIS_COURTS[debut.getMonth()]} ${String(debut.getFullYear()).slice(2)}`,
      heures: { Projet: 0, Incident: 0, MCO: 0, Demande: 0 },
      heuresSansTache: 0,
      total: 0,
      capacite: capaciteDuMois(debut.getFullYear(), debut.getMonth(), members, absences),
    };
    mois.push(m);
    index.set(cleMois(toISODate(debut)), m);
  }

  for (const e of timeEntries) {
    const m = index.get(cleMois(e.date));
    if (!m) continue;
    const t = tasks.find((x) => x.id === e.taskId);
    if (t) m.heures[t.type] += e.hours;
    else m.heuresSansTache += e.hours;
    m.total += e.hours;
  }

  for (const m of mois) {
    for (const n of NATURES) m.heures[n] = Math.round(m.heures[n] * 10) / 10;
    m.heuresSansTache = Math.round(m.heuresSansTache * 10) / 10;
    m.total = Math.round(m.total * 10) / 10;
  }

  return mois;
}

/** Totaux de la fenêtre, pour la phrase de lecture sous le graphique. */
export function totauxFenetre(mois: MoisCharge[]): {
  total: number;
  capacite: number;
  parNature: Record<TaskType, number>;
  /** Part de chaque nature, en %, arrondie — la somme peut faire 99 ou 101. */
  partParNature: Record<TaskType, number>;
} {
  const parNature = { Projet: 0, Incident: 0, MCO: 0 } as Record<TaskType, number>;
  let total = 0;
  let capacite = 0;
  for (const m of mois) {
    for (const n of NATURES) parNature[n] += m.heures[n];
    total += m.total;
    capacite += m.capacite;
  }
  const partParNature = { Projet: 0, Incident: 0, MCO: 0 } as Record<TaskType, number>;
  for (const n of NATURES) partParNature[n] = total > 0 ? Math.round((parNature[n] / total) * 100) : 0;
  return {
    total: Math.round(total),
    capacite: Math.round(capacite),
    parNature,
    partParNature,
  };
}
