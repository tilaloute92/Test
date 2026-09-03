/**
 * Export de la feuille de route (FDR) en PowerPoint (.pptx), pour partager en comité de
 * pilotage sans dépendre de captures d'écran. Génération entièrement côté navigateur
 * (bibliothèque pptxgenjs, chargée à la demande via import dynamique pour ne pas alourdir
 * le chargement initial de l'application) — comme le reste de l'app, rien n'est envoyé à
 * un serveur : le fichier est construit et téléchargé localement.
 */

import type PptxGenJS from 'pptxgenjs';
import type { Priority, RoadmapDomain, RoadmapItem, RoadmapQuarter, RoadmapStatus, TeamMember } from '../types';

const QUARTER_ORDER: RoadmapQuarter[] = ['T1', 'T2', 'T3', 'T4', 'annee'];
const QUARTER_LABELS: Record<RoadmapQuarter, string> = {
  T1: 'T1 — janvier à mars',
  T2: 'T2 — avril à juin',
  T3: 'T3 — juillet à septembre',
  T4: 'T4 — octobre à décembre',
  annee: "Toute l'année",
};

const STATUS_ORDER: RoadmapStatus[] = ['idee', 'planifie', 'en_cours', 'termine', 'reporte', 'abandonne'];
const STATUS_LABELS: Record<RoadmapStatus, string> = {
  idee: 'Idée',
  planifie: 'Planifié',
  en_cours: 'En cours',
  termine: 'Terminé',
  reporte: 'Reporté',
  abandonne: 'Abandonné',
};
const STATUS_COLORS: Record<RoadmapStatus, string> = {
  idee: '64748B',
  planifie: '0284C7',
  en_cours: '2563EB',
  termine: '059669',
  reporte: 'D97706',
  abandonne: 'E11D48',
};

const DOMAIN_COLORS: Record<RoadmapDomain, string> = {
  Infrastructure: '4F46E5',
  Réseau: '0284C7',
  Sécurité: 'DC2626',
  Cloud: 'EA580C',
  'Poste de travail': '16A34A',
  Autre: '64748B',
};

const PRIORITY_LABELS: Record<Priority, string> = { basse: 'Basse', normale: 'Normale', haute: 'Haute', critique: 'Critique' };

const ACCENT = '7C3AED';
const FONT = 'Arial';

function ownerNames(item: RoadmapItem, members: TeamMember[]): string {
  const names = item.ownerIds.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(', ') : 'Non attribué';
}

export async function exportRoadmapPptx(params: { year: number; items: RoadmapItem[]; members: TeamMember[]; teamLabel?: string }): Promise<void> {
  const { year, items, members, teamLabel = 'Suivi Infra & Réseau' } = params;
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = teamLabel;
  pptx.title = `Feuille de route ${year}`;

  // --- Slide de titre ---
  const title = pptx.addSlide();
  title.background = { color: '1E1B4B' };
  title.addText('Feuille de route (FDR)', { x: 0.6, y: 1.7, w: 11.4, h: 1, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: FONT });
  title.addText(`${teamLabel} — Année ${year}`, { x: 0.6, y: 2.7, w: 11.4, h: 0.6, fontSize: 20, color: 'C4B5FD', fontFace: FONT });
  title.addText(`Généré le ${new Date().toLocaleDateString('fr-FR')}`, { x: 0.6, y: 3.25, w: 11.4, h: 0.4, fontSize: 12, color: 'A78BFA', fontFace: FONT });

  // --- Slide vue d'ensemble ---
  const overview = pptx.addSlide();
  overview.addText(`Vue d'ensemble — ${year}`, { x: 0.5, y: 0.35, w: 12, h: 0.6, fontSize: 26, bold: true, color: '1E293B', fontFace: FONT });
  overview.addText(`${items.length} initiative(s)`, { x: 0.5, y: 0.95, w: 12, h: 0.35, fontSize: 14, color: '64748B', fontFace: FONT });

  const byStatus = STATUS_ORDER.filter((s) => items.some((i) => i.status === s));
  const statusRows: PptxGenJS.TableRow[] = [
    [
      { text: 'Statut', options: { bold: true, color: 'FFFFFF', fill: { color: ACCENT } } },
      { text: 'Nombre', options: { bold: true, color: 'FFFFFF', fill: { color: ACCENT } } },
    ],
    ...byStatus.map((s) => [{ text: STATUS_LABELS[s] }, { text: String(items.filter((i) => i.status === s).length) }] as PptxGenJS.TableRow),
  ];
  overview.addTable(statusRows, {
    x: 0.5,
    y: 1.5,
    w: 5,
    colW: [3.5, 1.5],
    fontSize: 13,
    fontFace: FONT,
    border: { type: 'solid', color: 'E2E8F0', pt: 1 },
    autoPage: false,
  });

  const budgetTotal = items.reduce((sum, i) => sum + (i.budgetEstimate ?? 0), 0);
  if (budgetTotal > 0) {
    overview.addText(`Budget prévisionnel cumulé : ${budgetTotal.toLocaleString('fr-FR')} €`, {
      x: 0.5,
      y: 1.5 + (statusRows.length + 1) * 0.35,
      w: 8,
      h: 0.4,
      fontSize: 14,
      bold: true,
      color: '1E293B',
      fontFace: FONT,
    });
  }

  // --- Une slide par trimestre ayant au moins une initiative ---
  for (const q of QUARTER_ORDER) {
    const qItems = items.filter((i) => i.quarter === q);
    if (qItems.length === 0) continue;

    const slide = pptx.addSlide();
    slide.addText(`${QUARTER_LABELS[q]} — ${year}`, { x: 0.4, y: 0.3, w: 12.5, h: 0.55, fontSize: 22, bold: true, color: '1E293B', fontFace: FONT });

    const header: PptxGenJS.TableRow = ['Initiative', 'Domaine', 'Statut', 'Priorité', 'Avanc.', 'Porteur(s)', 'Budget'].map((t) => ({
      text: t,
      options: { bold: true, color: 'FFFFFF', fill: { color: ACCENT } },
    }));
    const rows: PptxGenJS.TableRow[] = [
      header,
      ...qItems.map(
        (item) =>
          [
            { text: item.title },
            { text: item.domain, options: { color: DOMAIN_COLORS[item.domain] } },
            { text: STATUS_LABELS[item.status], options: { color: STATUS_COLORS[item.status] } },
            { text: PRIORITY_LABELS[item.priority] },
            { text: `${item.progress}%` },
            { text: ownerNames(item, members) },
            { text: item.budgetEstimate != null ? `${item.budgetEstimate.toLocaleString('fr-FR')} €` : '—' },
          ] as PptxGenJS.TableRow
      ),
    ];
    slide.addTable(rows, {
      x: 0.4,
      y: 0.95,
      w: 12.5,
      colW: [3.3, 1.7, 1.4, 1.2, 0.9, 2.6, 1.4],
      fontSize: 10,
      fontFace: FONT,
      border: { type: 'solid', color: 'E2E8F0', pt: 1 },
      autoPage: true,
    });
  }

  await pptx.writeFile({ fileName: `fdr_${year}.pptx` });
}
