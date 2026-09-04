import type { Copil, CopilAction, CopilStatus, RoadmapItem, TeamMember } from '../types';
import { toISODate } from './date';

export const COPIL_STATUS_LABELS: Record<CopilStatus, string> = {
  planifie: 'Planifié',
  tenu: 'Tenu',
  annule: 'Annulé',
};

export const COPIL_ACTION_STATUS_LABELS: Record<CopilAction['status'], string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  en_attente: 'En attente',
  termine: 'Terminé',
};

/** Une action de COPIL est "ouverte" tant qu'elle n'est pas terminée — y compris "en attente". */
export function isActionOpen(action: CopilAction): boolean {
  return action.status !== 'termine';
}

export interface CopilActionRef {
  copil: Copil;
  action: CopilAction;
}

/** Toutes les actions de toutes les séances, à plat — base des vues transverses de suivi. */
export function allActions(copils: Copil[]): CopilActionRef[] {
  return copils.flatMap((copil) => copil.actions.map((action) => ({ copil, action })));
}

/** Actions encore ouvertes dont l'échéance est dépassée — le signal qui remonte en Vue d'ensemble. */
export function overdueActions(copils: Copil[], reference: Date = new Date()): CopilActionRef[] {
  const todayIso = toISODate(reference);
  return allActions(copils)
    .filter(({ action }) => isActionOpen(action) && action.dueDate && action.dueDate < todayIso)
    .sort((a, b) => (a.action.dueDate ?? '').localeCompare(b.action.dueDate ?? ''));
}

export function openActions(copils: Copil[]): CopilActionRef[] {
  return allActions(copils).filter(({ action }) => isActionOpen(action));
}

/** Prochaine séance planifiée (aujourd'hui inclus), la plus proche dans le temps. */
export function nextCopil(copils: Copil[], reference: Date = new Date()): Copil | undefined {
  const todayIso = toISODate(reference);
  return copils
    .filter((c) => c.status === 'planifie' && c.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

/** Séances passées ou tenues, de la plus récente à la plus ancienne. */
export function pastCopils(copils: Copil[], reference: Date = new Date()): Copil[] {
  const todayIso = toISODate(reference);
  return copils.filter((c) => c.date < todayIso || c.status === 'tenu').sort((a, b) => b.date.localeCompare(a.date));
}

export function daysUntil(dateIso: string, reference: Date = new Date()): number {
  const target = new Date(`${dateIso}T00:00:00`);
  const base = new Date(`${toISODate(reference)}T00:00:00`);
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

/**
 * Une séance dont la date approche mais dont l'ordre du jour est encore vide : signal utile
 * en Vue d'ensemble, parce qu'un COPIL se prépare avant la veille — et parce que c'est
 * exactement le genre d'oubli qui coûte une séance pour rien.
 */
export const COPIL_PREP_WINDOW_DAYS = 7;

export function copilsNeedingPrep(copils: Copil[], reference: Date = new Date()): Copil[] {
  const todayIso = toISODate(reference);
  return copils
    .filter(
      (c) =>
        c.status === 'planifie' &&
        c.date >= todayIso &&
        daysUntil(c.date, reference) <= COPIL_PREP_WINDOW_DAYS &&
        c.agenda.length === 0
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface CopilStats {
  total: number;
  byStatus: Record<CopilStatus, number>;
  openActions: number;
  overdueActions: number;
  next?: Copil;
}

export function computeCopilStats(copils: Copil[], reference: Date = new Date()): CopilStats {
  const byStatus: Record<CopilStatus, number> = { planifie: 0, tenu: 0, annule: 0 };
  for (const c of copils) byStatus[c.status]++;
  return {
    total: copils.length,
    byStatus,
    openActions: openActions(copils).length,
    overdueActions: overdueActions(copils, reference).length,
    next: nextCopil(copils, reference),
  };
}

export function memberNamesOf(ids: string[], members: TeamMember[]): string {
  const names = ids.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(', ') : 'Non attribué';
}

export function formatCopilDate(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Durée totale de l'ordre du jour (minutes) — undefined si aucun point n'est chiffré. */
export function agendaDuration(copil: Copil): number | undefined {
  const withDuration = copil.agenda.filter((a) => typeof a.durationMin === 'number');
  if (withDuration.length === 0) return undefined;
  return withDuration.reduce((sum, a) => sum + (a.durationMin ?? 0), 0);
}

/**
 * Compte-rendu au format Markdown, à coller dans un e-mail ou Teams. Comme le rapport
 * hebdomadaire, c'est un export à la demande : rien n'est envoyé automatiquement.
 */
export function buildCopilMarkdown(copil: Copil, members: TeamMember[], roadmapItems: RoadmapItem[]): string {
  const lines: string[] = [];
  lines.push(`# ${copil.title}`);
  lines.push('');
  lines.push(`**Date :** ${formatCopilDate(copil.date)}${copil.time ? ` à ${copil.time}` : ''}`);
  if (copil.location) lines.push(`**Lieu :** ${copil.location}`);
  lines.push(`**Statut :** ${COPIL_STATUS_LABELS[copil.status]}`);

  const internes = copil.participantIds
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter((n): n is string => Boolean(n));
  const participants = [...internes, ...copil.externalParticipants];
  if (participants.length > 0) lines.push(`**Participants :** ${participants.join(', ')}`);
  lines.push('');

  if (copil.agenda.length > 0) {
    lines.push('## Ordre du jour');
    for (const point of copil.agenda) {
      const presenter = point.presenterId ? members.find((m) => m.id === point.presenterId)?.name : undefined;
      const meta = [presenter, point.durationMin ? `${point.durationMin} min` : undefined].filter(Boolean).join(' · ');
      lines.push(`- ${point.label}${meta ? ` (${meta})` : ''}`);
    }
    lines.push('');
  }

  if (copil.roadmapItemIds.length > 0) {
    lines.push('## Feuille de route passée en revue');
    for (const id of copil.roadmapItemIds) {
      const item = roadmapItems.find((r) => r.id === id);
      if (item) lines.push(`- ${item.title} — ${item.domain}, ${item.quarter} ${item.year} · avancement ${item.progress}%`);
    }
    lines.push('');
  }

  if (copil.decisions.length > 0) {
    lines.push('## Décisions');
    for (const d of copil.decisions) {
      lines.push(`- **${d.label}**${d.detail ? ` — ${d.detail}` : ''}`);
    }
    lines.push('');
  }

  if (copil.actions.length > 0) {
    lines.push('## Relevé de décisions — actions');
    lines.push('');
    lines.push('| Action | Responsable(s) | Échéance | Statut |');
    lines.push('| --- | --- | --- | --- |');
    for (const a of copil.actions) {
      lines.push(`| ${a.label} | ${memberNamesOf(a.ownerIds, members)} | ${a.dueDate ?? '—'} | ${COPIL_ACTION_STATUS_LABELS[a.status]} |`);
    }
    lines.push('');
  }

  if (copil.notes) {
    lines.push('## Notes de séance');
    lines.push(copil.notes);
    lines.push('');
  }

  if (copil.nextDate) {
    lines.push(`**Prochaine séance :** ${formatCopilDate(copil.nextDate)}`);
    lines.push('');
  }

  lines.push(`_Compte-rendu généré depuis Suivi Infra & Réseau le ${new Date().toLocaleString('fr-FR')}._`);
  return lines.join('\n');
}
