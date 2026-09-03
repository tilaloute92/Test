/**
 * Export du rapport hebdomadaire en PowerPoint (.pptx) — voir src/lib/pptxCommon.ts pour les
 * points de sécurité vérifiés avant d'activer cette fonctionnalité (génération 100% locale,
 * pas de macro possible, texte échappé, pas d'image).
 */

import { addSectionTitle, addTitleSlide, loadPptxGenJS, tableHeaderCells, PPTX_FONT } from './pptxCommon';
import { formatWeekRange, formatDateLong, toISODate } from './date';
import { weatherMeta, type WeeklyReport } from './weeklyReport';
import { workloadColors } from './workload';
import type { RoadmapStatus, TeamMember } from '../types';

const ROADMAP_STATUSES: RoadmapStatus[] = ['idee', 'planifie', 'en_cours', 'termine', 'reporte', 'abandonne'];
const roadmapStatusLabels: Record<RoadmapStatus, string> = {
  idee: 'Idée',
  planifie: 'Planifié',
  en_cours: 'En cours',
  termine: 'Terminé',
  reporte: 'Reporté',
  abandonne: 'Abandonné',
};

export async function exportWeeklyReportPptx(params: { report: WeeklyReport; members: TeamMember[]; teamLabel: string }): Promise<void> {
  const { report, members, teamLabel } = params;
  const PptxGenJS = await loadPptxGenJS();
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = teamLabel;
  pptx.title = `Rapport hebdomadaire — ${formatWeekRange(report.weekDays)}`;

  const w = weatherMeta[report.weather];

  addTitleSlide(pptx, {
    title: 'Rapport hebdomadaire',
    subtitle: `${teamLabel} — Semaine du ${formatWeekRange(report.weekDays)}`,
    footer: `Météo : ${w.label} ${w.emoji} — généré le ${formatDateLong(new Date())}`,
  });

  // --- Météo & indicateurs clés ---
  const overview = pptx.addSlide();
  addSectionTitle(overview, `Météo de la semaine : ${w.label} ${w.emoji}`);
  overview.addText(report.weatherFactors.map((f) => `•  ${f}`).join('\n'), {
    x: 0.4,
    y: 1.0,
    w: 6.2,
    h: 2.5,
    fontSize: 13,
    color: '475569',
    fontFace: PPTX_FONT,
    valign: 'top',
  });
  const kpiRows = [
    tableHeaderCells(['Indicateur', 'Valeur']),
    [{ text: 'Charge moyenne équipe' }, { text: `${Math.round(report.avgWorkloadRatio * 100)}%` }],
    [{ text: 'Heures saisies' }, { text: `${report.totalHoursLogged}h / ${report.totalHoursTarget}h` }],
    [{ text: 'Tâches terminées' }, { text: String(report.tasksCompleted.length) }],
    [{ text: 'Incidents critiques/hauts ouverts' }, { text: String(report.openCriticalIncidents.length) }],
    [{ text: 'Tâches en retard' }, { text: String(report.overdueTasks.length) }],
  ];
  overview.addTable(kpiRows, {
    x: 7,
    y: 1.0,
    w: 5.5,
    colW: [3.7, 1.8],
    fontSize: 12,
    fontFace: PPTX_FONT,
    border: { type: 'solid', color: 'E2E8F0', pt: 1 },
    autoPage: false,
  });

  // --- Charge par personne ---
  const chargeSlide = pptx.addSlide();
  addSectionTitle(chargeSlide, 'Charge par personne');
  const chargeRows = [
    tableHeaderCells(['Membre', 'Charge', 'Niveau', 'Heures saisies', 'Terminées']),
    ...report.perMember.map((p) => [
      { text: p.member.name },
      { text: `${Math.round(p.workloadRatio * 100)}%` },
      { text: workloadColors[p.workloadLevel].label },
      { text: `${p.hoursLogged}h / ${p.hoursTarget}h` },
      { text: String(p.tasksCompleted.length) },
    ]),
  ];
  chargeSlide.addTable(chargeRows, {
    x: 0.4,
    y: 0.95,
    w: 12.5,
    colW: [3.7, 1.8, 2.2, 2.8, 2],
    fontSize: 12,
    fontFace: PPTX_FONT,
    border: { type: 'solid', color: 'E2E8F0', pt: 1 },
    autoPage: true,
  });

  // --- Faits marquants ---
  const factsSlide = pptx.addSlide();
  addSectionTitle(factsSlide, 'Faits marquants');
  const factColumn = (title: string, items: string[], x: number) => {
    factsSlide.addText(title, { x, y: 0.95, w: 4, h: 0.4, fontSize: 13, bold: true, color: '1E293B', fontFace: PPTX_FONT });
    const text = items.length > 0 ? items.map((i) => `•  ${i}`).join('\n') : 'Aucun';
    factsSlide.addText(text, { x, y: 1.4, w: 4, h: 5, fontSize: 10.5, color: '475569', fontFace: PPTX_FONT, valign: 'top' });
  };
  factColumn(
    `Incidents critiques/hauts ouverts (${report.openCriticalIncidents.length})`,
    report.openCriticalIncidents.map((t) => t.title),
    0.4
  );
  factColumn(
    `Terminé cette semaine (${report.tasksCompleted.length})`,
    report.tasksCompleted.map((t) => t.title),
    4.6
  );
  factColumn(
    `Tâches en retard (${report.overdueTasks.length})`,
    report.overdueTasks.map((t) => `${t.title} — éch. ${t.dueDate}`),
    8.8
  );

  // --- Feuille de route (FDR) ---
  const rm = report.roadmap;
  if (rm.total > 0) {
    const fdrSlide = pptx.addSlide();
    addSectionTitle(fdrSlide, `Feuille de route (FDR) — ${rm.year}`);
    const statusRows = [
      tableHeaderCells(['Statut', 'Nombre']),
      ...ROADMAP_STATUSES.filter((s) => rm.byStatus[s] > 0).map((s) => [{ text: roadmapStatusLabels[s] }, { text: String(rm.byStatus[s]) }]),
    ];
    fdrSlide.addTable(statusRows, {
      x: 0.4,
      y: 0.95,
      w: 4,
      colW: [2.7, 1.3],
      fontSize: 12,
      fontFace: PPTX_FONT,
      border: { type: 'solid', color: 'E2E8F0', pt: 1 },
      autoPage: false,
    });
    if (rm.inProgress.length > 0) {
      fdrSlide.addText('Initiatives en cours', { x: 5, y: 0.95, w: 7.9, h: 0.4, fontSize: 13, bold: true, color: '1E293B', fontFace: PPTX_FONT });
      const inProgressRows = [
        tableHeaderCells(['Initiative', 'Domaine', 'Avanc.']),
        ...rm.inProgress.map((r) => [{ text: r.title }, { text: r.domain }, { text: `${r.progress}%` }]),
      ];
      fdrSlide.addTable(inProgressRows, {
        x: 5,
        y: 1.4,
        w: 7.9,
        colW: [4.2, 2.2, 1.5],
        fontSize: 11,
        fontFace: PPTX_FONT,
        border: { type: 'solid', color: 'E2E8F0', pt: 1 },
        autoPage: true,
      });
    }
    if (rm.notStartedButDue.length > 0) {
      const y = 0.95 + statusRows.length * 0.4 + 0.5;
      fdrSlide.addText(
        `Pas encore démarrées alors que leur trimestre cible est atteint : ${rm.notStartedButDue.map((r) => r.title).join(', ')}`,
        { x: 0.4, y, w: 4, h: 2, fontSize: 10.5, color: 'B45309', fontFace: PPTX_FONT, valign: 'top' }
      );
    }
  }

  // --- Semaine prochaine ---
  const nextSlide = pptx.addSlide();
  addSectionTitle(nextSlide, 'Semaine prochaine');
  nextSlide.addText(`Planning déjà rempli à ${Math.round(report.nextWeekFillRatio * 100)}%`, {
    x: 0.4,
    y: 1.0,
    w: 10,
    h: 0.5,
    fontSize: 16,
    bold: true,
    color: '1E293B',
    fontFace: PPTX_FONT,
  });
  const absenceText =
    report.nextWeekAbsences.length > 0
      ? report.nextWeekAbsences
          .map((a) => {
            const m = members.find((mm) => mm.id === a.memberId);
            return `•  ${m?.name ?? '—'} — ${a.label ?? a.type} (${a.date})`;
          })
          .join('\n')
      : 'Aucune absence prévue.';
  nextSlide.addText(absenceText, { x: 0.4, y: 1.7, w: 11, h: 4.5, fontSize: 13, color: '475569', fontFace: PPTX_FONT, valign: 'top' });

  await pptx.writeFile({ fileName: `rapport_hebdo_${toISODate(report.weekDays[0])}.pptx` });
}
