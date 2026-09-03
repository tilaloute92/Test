/**
 * Export du flash report projet en PowerPoint (.pptx) — voir src/lib/pptxCommon.ts pour les
 * points de sécurité vérifiés avant d'activer cette fonctionnalité.
 */

import { addSectionTitle, addTitleSlide, loadPptxGenJS, tableHeaderCells, PPTX_FONT } from './pptxCommon';
import { formatDateLong } from './date';
import { ragLabels, type FlashReport } from './flashReport';
import type { ProjectTask, TeamMember } from '../types';

const RAG_COLORS: Record<FlashReport['rag'], string> = { vert: '059669', orange: 'D97706', rouge: 'DC2626' };

function assigneeNames(task: ProjectTask, members: TeamMember[]): string {
  const names = task.assigneeIds.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(', ') : 'Non assigné';
}

export async function exportFlashReportPptx(params: { report: FlashReport; members: TeamMember[]; teamLabel?: string }): Promise<void> {
  const { report, members, teamLabel = 'Suivi Infra & Réseau' } = params;
  const PptxGenJS = await loadPptxGenJS();
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = teamLabel;
  pptx.title = `Flash report — ${report.project}`;

  addTitleSlide(pptx, {
    title: `Flash report — ${report.project}`,
    subtitle: `${teamLabel} — Statut : ${ragLabels[report.rag]}`,
    footer: `Généré le ${formatDateLong(new Date(report.generatedAt))}`,
  });

  const slide = pptx.addSlide();
  addSectionTitle(slide, report.project);

  // Bandeau de statut RAG
  slide.addShape('rect', { x: 0.4, y: 0.95, w: 12.5, h: 0.55, fill: { color: RAG_COLORS[report.rag] }, line: { type: 'none' } });
  slide.addText(`Statut : ${ragLabels[report.rag]}  —  ${report.ragReasons.join(' · ')}`, {
    x: 0.55,
    y: 0.95,
    w: 12.2,
    h: 0.55,
    fontSize: 12,
    bold: true,
    color: 'FFFFFF',
    fontFace: PPTX_FONT,
    valign: 'middle',
  });

  // KPIs
  const kpiRows = [
    tableHeaderCells(['Indicateur', 'Valeur']),
    [{ text: 'Tâches terminées' }, { text: `${report.completedTasks.length} / ${report.totalTasks} (${Math.round(report.completionRatio * 100)}%)` }],
    [{ text: 'En cours / à faire / en attente' }, { text: `${report.inProgressTasks.length} / ${report.todoTasks.length} / ${report.waitingTasks.length}` }],
    [{ text: 'Charge (passé / estimé)' }, { text: `${report.spentHours}h / ${report.estimatedHours}h` }],
    [{ text: 'Équipe' }, { text: report.team.map((m) => m.name).join(', ') || 'Non attribuée' }],
  ];
  slide.addTable(kpiRows, {
    x: 0.4,
    y: 1.7,
    w: 6,
    colW: [3.2, 2.8],
    fontSize: 11,
    fontFace: PPTX_FONT,
    border: { type: 'solid', color: 'E2E8F0', pt: 1 },
    autoPage: false,
  });

  const listColumn = (title: string, items: string[], x: number, y: number) => {
    slide.addText(title, { x, y, w: 6, h: 0.35, fontSize: 12, bold: true, color: '1E293B', fontFace: PPTX_FONT });
    slide.addText(items.length > 0 ? items.map((i) => `•  ${i}`).join('\n') : 'Aucun', {
      x,
      y: y + 0.4,
      w: 6,
      h: 1.7,
      fontSize: 10,
      color: '475569',
      fontFace: PPTX_FONT,
      valign: 'top',
    });
  };

  listColumn(
    'Réalisé récemment',
    report.recentlyCompleted.map((t) => t.title),
    6.9,
    1.7
  );
  listColumn(
    'Échéances à venir',
    report.upcoming.map((t) => `${t.title} (${t.dueDate})`),
    6.9,
    3.9
  );
  listColumn(
    'En retard',
    report.overdueTasks.map((t) => `${t.title} (${t.dueDate}) — ${assigneeNames(t, members)}`),
    0.4,
    4.3
  );
  listColumn(
    'En attente / bloquées',
    report.waitingTasks.map((t) => `${t.title} — ${assigneeNames(t, members)}`),
    3.65,
    4.3
  );

  await pptx.writeFile({ fileName: `flash_report_${report.project.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.pptx` });
}
