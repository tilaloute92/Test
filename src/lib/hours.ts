import type { Period, TaskType } from '../types';

/**
 * Découpage horaire de la journée, utilisé par l'onglet Planning pour afficher le matin et
 * l'après-midi par tranches d'une heure.
 *
 * ATTENTION — c'est un découpage d'AFFICHAGE uniquement : l'affectation d'une tâche reste
 * faite à la demi-journée (voir `PlanningSlot.period` dans src/types.ts). Une tranche d'une
 * heure n'est donc jamais stockée ; elle hérite de la tâche du créneau (matin ou après-midi)
 * qui la contient. Cliquer sur 09:00 revient à cliquer sur "Matin".
 */

/** Première heure affichée dans la grille (6h) — avant les horaires ouvrés, pour les horaires décalés. */
export const DAY_START_HOUR = 6;

/** Dernière borne affichée (19h) : la dernière tranche est donc 18:00 → 19:00. */
export const DAY_END_HOUR = 19;

/** Horaires ouvrés de chaque demi-journée. `end` est exclusif : 8→12 = 8h, 9h, 10h et 11h. */
export const PERIOD_RANGES: Record<Period, { start: number; end: number }> = {
  matin: { start: 8, end: 12 },
  apres_midi: { start: 14, end: 18 },
};

export const PERIOD_LABELS: Record<Period, string> = { matin: 'Matin', apres_midi: 'Après-midi' };

export interface HourSlot {
  /** Heure de début, 6 à 18. */
  hour: number;
  /** "08:00" */
  label: string;
  /** "08:00 → 09:00" */
  rangeLabel: string;
  /** Demi-journée à laquelle la tranche appartient, ou null si elle est hors horaires ouvrés. */
  period: Period | null;
}

/** « 14:30 » à partir d'une heure décimale (14,5). Les créneaux récurrents comme ceux
 *  posés sur une tâche commencent au quart d'heure, pas seulement à l'heure pile. */
export function formatHeure(h: number): string {
  const heures = Math.floor(h);
  const minutes = Math.round((h - heures) * 60);
  return `${String(heures).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** « 1 h 30 », « 45 min ». */
export function formatDuree(h: number): string {
  const heures = Math.floor(h);
  const minutes = Math.round((h - heures) * 60);
  if (heures === 0) return `${minutes} min`;
  return minutes === 0 ? `${heures} h` : `${heures} h ${String(minutes).padStart(2, '0')}`;
}

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** La demi-journée contenant cette heure, ou null hors horaires ouvrés (avant 8h, pause déjeuner, après 18h). */
export function periodForHour(hour: number): Period | null {
  for (const period of ['matin', 'apres_midi'] as Period[]) {
    const { start, end } = PERIOD_RANGES[period];
    if (hour >= start && hour < end) return period;
  }
  return null;
}

/** Toutes les tranches affichées, de 6h à 18h incluses (la dernière se termine à 19h). */
export function getHourSlots(): HourSlot[] {
  const slots: HourSlot[] = [];
  for (let hour = DAY_START_HOUR; hour < DAY_END_HOUR; hour++) {
    slots.push({
      hour,
      label: formatHour(hour),
      rangeLabel: `${formatHour(hour)} → ${formatHour(hour + 1)}`,
      period: periodForHour(hour),
    });
  }
  return slots;
}

/** "08:00 → 12:00" — l'amplitude ouvrée d'une demi-journée, pour l'afficher à côté de son nom. */
export function periodRangeLabel(period: Period): string {
  const { start, end } = PERIOD_RANGES[period];
  return `${formatHour(start)} → ${formatHour(end)}`;
}

/** Nombre d'heures ouvrées d'une demi-journée (4h le matin, 4h l'après-midi). */
export function periodHours(period: Period): number {
  const { start, end } = PERIOD_RANGES[period];
  return end - start;
}

/**
 * Quelles natures de travail peut-on affecter à quelle demi-journée.
 *
 * La règle d'équipe est « le matin le courant, l'après-midi les projets ». Les INCIDENTS
 * échappent aux deux : un incident ne s'arrête pas à midi. Il doit donc pouvoir être
 * affecté, et pointé heure par heure, l'après-midi comme le matin — sans quoi une panne
 * qui dure toute la journée disparaît du planning de 13 h, et les heures de l'après-midi
 * se retrouvent imputées à un projet auquel personne n'a touché.
 *
 * La règle vivait en double, écrite en dur dans l'onglet Activité du jour et dans
 * l'onglet Planning. Elle est ici, à un seul endroit : deux copies finissent toujours par
 * diverger, et on pouvait alors planifier une chose sur un écran et pas sur l'autre.
 */
export const NATURES_PAR_PERIODE: Record<Period, TaskType[]> = {
  matin: ['MCO', 'Demande', 'Incident'],
  apres_midi: ['Projet', 'Demande', 'Incident'],
};

/** « MCO » est un sigle : il ne prend pas la marque du pluriel. */
const PLURIEL: Record<TaskType, string> = { MCO: 'MCO', Incident: 'incidents', Projet: 'projets', Demande: 'demandes' };

/**
 * Libellé du créneau, DÉDUIT des natures qu'il accepte, pour qu'il ne puisse pas mentir.
 * Il était écrit en dur à côté de la règle : l'un des deux finit toujours par changer sans
 * l'autre, et un créneau intitulé « Projets » qui accepte les incidents fait douter de tout
 * le reste de l'écran.
 *
 * En minuscules, sauf le sigle MCO — pour s'insérer au fil d'une phrase. Voir
 * `periodNatureTitle` pour un titre.
 */
export function periodNatureLabel(period: Period): string {
  const mots = NATURES_PAR_PERIODE[period].map((t) => PLURIEL[t]);
  return mots.length === 1 ? mots[0] : `${mots.slice(0, -1).join(', ')} & ${mots[mots.length - 1]}`;
}

/** Le même, en tête de titre. Première lettre capitalisée, sigles préservés. */
export function periodNatureTitle(period: Period): string {
  const phrase = periodNatureLabel(period);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

export function accepteNature(period: Period, type: TaskType): boolean {
  return NATURES_PAR_PERIODE[period].includes(type);
}
