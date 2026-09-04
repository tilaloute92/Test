/**
 * Export d'une séance de COPIL en PowerPoint (.pptx) — le support qu'on projette en séance.
 * Voir src/lib/pptxCommon.ts pour les points de sécurité vérifiés avant d'activer les exports
 * PowerPoint (génération 100% locale, aucune macro possible, aucun objet OLE ni image).
 */

import { addSectionTitle, addTitleSlide, loadPptxGenJS, tableHeaderCells, PPTX_FONT } from './pptxCommon';
import { COPIL_ACTION_STATUS_LABELS, COPIL_STATUS_LABELS, formatCopilDate, memberNamesOf } from './copil';
import type { Copil, RoadmapItem, TeamMember } from '../types';

const ACTION_STATUS_COLORS: Record<string, string> = {
  a_faire: '64748B',
  en_cours: '2563EB',
  en_attente: 'D97706',
  termine: '059669',
};

export async function exportCopilPptx(params: {
  copil: Copil;
  members: TeamMember[];
  roadmapItems: RoadmapItem[];
  teamLabel?: string;
}): Promise<void> {
  const { copil, members, roadmapItems, teamLabel = 'Suivi Infra & Réseau' } = params;
  const PptxGenJS = await loadPptxGenJS();
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = teamLabel;
  pptx.title = copil.title;

  const participants = [
    ...copil.participantIds.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n)),
    ...copil.externalParticipants,
  ];

  addTitleSlide(pptx, {
    title: copil.title,
    subtitle: `${formatCopilDate(copil.date)}${copil.time ? ` — ${copil.time}` : ''}`,
    footer: `${teamLabel} · ${COPIL_STATUS_LABELS[copil.status]}${copil.location ? ` · ${copil.location}` : ''}`,
  });

  // --- Ordre du jour + participants ---
  if (copil.agenda.length > 0 || participants.length > 0) {
    const slide = pptx.addSlide();
    addSectionTitle(slide, 'Ordre du jour');
    if (copil.agenda.length > 0) {
      const rows = [
        tableHeaderCells(['Point', 'Présenté par', 'Durée']),
        ...copil.agenda.map((point) => [
          { text: point.label },
          { text: point.presenterId ? members.find((m) => m.id === point.presenterId)?.name ?? '—' : '—' },
          { text: point.durationMin ? `${point.durationMin} min` : '—' },
        ]),
      ];
      slide.addTable(rows, {
        x: 0.4,
        y: 1,
        w: 12.5,
        colW: [7.5, 3.2, 1.8],
        fontSize: 12,
        fontFace: PPTX_FONT,
        border: { type: 'solid', color: 'E2E8F0', pt: 1 },
        autoPage: false,
      });
    }
    if (participants.length > 0) {
      slide.addText(`Participants : ${participants.join(', ')}`, {
        x: 0.4,
        y: 6.4,
        w: 12.5,
        h: 0.6,
        fontSize: 11,
        color: '475569',
        fontFace: PPTX_FONT,
      });
    }
  }

  // --- Feuille de route passée en revue ---
  const reviewed = copil.roadmapItemIds
    .map((id) => roadmapItems.find((r) => r.id === id))
    .filter((r): r is RoadmapItem => Boolean(r));
  if (reviewed.length > 0) {
    const slide = pptx.addSlide();
    addSectionTitle(slide, 'Feuille de route passée en revue');
    const rows = [
      tableHeaderCells(['Initiative', 'Domaine', 'Période', 'Avancement']),
      ...reviewed.map((r) => [
        { text: r.title },
        { text: r.domain },
        { text: `${r.quarter} ${r.year}` },
        { text: `${r.progress}%` },
      ]),
    ];
    slide.addTable(rows, {
      x: 0.4,
      y: 1,
      w: 12.5,
      colW: [6.5, 2.6, 1.9, 1.5],
      fontSize: 12,
      fontFace: PPTX_FONT,
      border: { type: 'solid', color: 'E2E8F0', pt: 1 },
      autoPage: true,
    });
  }

  // --- Décisions ---
  if (copil.decisions.length > 0) {
    const slide = pptx.addSlide();
    addSectionTitle(slide, 'Décisions');
    slide.addText(
      copil.decisions.map((d) => `•  ${d.label}${d.detail ? `\n     ${d.detail}` : ''}`).join('\n\n'),
      { x: 0.4, y: 1.05, w: 12.5, h: 5.4, fontSize: 13, color: '1E293B', fontFace: PPTX_FONT, valign: 'top' }
    );
  }

  // --- Relevé de décisions (actions) ---
  if (copil.actions.length > 0) {
    const slide = pptx.addSlide();
    addSectionTitle(slide, 'Relevé de décisions — actions');
    const rows = [
      tableHeaderCells(['Action', 'Responsable(s)', 'Échéance', 'Statut']),
      ...copil.actions.map((a) => [
        { text: a.label },
        { text: memberNamesOf(a.ownerIds, members) },
        { text: a.dueDate ?? '—' },
        { text: COPIL_ACTION_STATUS_LABELS[a.status], options: { color: ACTION_STATUS_COLORS[a.status], bold: true } },
      ]),
    ];
    slide.addTable(rows, {
      x: 0.4,
      y: 1,
      w: 12.5,
      colW: [6.2, 3, 1.8, 1.5],
      fontSize: 12,
      fontFace: PPTX_FONT,
      border: { type: 'solid', color: 'E2E8F0', pt: 1 },
      autoPage: true,
    });
  }

  // --- Notes + prochaine séance ---
  if (copil.notes || copil.nextDate) {
    const slide = pptx.addSlide();
    addSectionTitle(slide, 'Notes de séance');
    if (copil.notes) {
      slide.addText(copil.notes, { x: 0.4, y: 1.05, w: 12.5, h: 4.5, fontSize: 13, color: '1E293B', fontFace: PPTX_FONT, valign: 'top' });
    }
    if (copil.nextDate) {
      slide.addText(`Prochaine séance : ${formatCopilDate(copil.nextDate)}`, {
        x: 0.4,
        y: 6,
        w: 12.5,
        h: 0.5,
        fontSize: 14,
        bold: true,
        color: '7C3AED',
        fontFace: PPTX_FONT,
      });
    }
  }

  const safeName = copil.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  await pptx.writeFile({ fileName: `copil_${safeName}_${copil.date}.pptx` });
}
