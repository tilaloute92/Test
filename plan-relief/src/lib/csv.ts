import { downloadBlob } from '../components/ui';

/**
 * Export tableur : CSV au format attendu par Excel en français (séparateur « ; », virgule
 * décimale, BOM UTF-8 pour que les accents s'affichent à l'ouverture par double-clic).
 */
export type Cell = string | number | null | undefined;

const cell = (v: Cell) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? v.toLocaleString('fr-FR', { useGrouping: false, maximumFractionDigits: 2 }) : String(v);
  // Une cellule qui commence par = + - @ serait lue comme une formule par Excel.
  const safe = /^[=+\-@]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(header: string[], rows: Cell[][]) {
  return [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
}

export function downloadCsv(name: string, header: string[], rows: Cell[][]) {
  downloadBlob(new Blob(['﻿', toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }), name.endsWith('.csv') ? name : `${name}.csv`);
}

/** Date du jour pour les noms de fichiers : 2026-10-12. */
export const today = () => new Date().toISOString().slice(0, 10);
