import { readDxf } from './dxf';
import { readPdf } from './pdf';
import { segBounds } from './geometry';
import { INDICATION_RADIUS_M, attachIndications } from './indications';
import { withLandmarks } from './landmarks';
import { PT_TO_M, UNIT_FACTORS, type Drawing, type Equipment, type Format, type Group, type PlanSettings, type Role } from './types';

export function formatOf(fileName: string): Format | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext === 'dxf' || ext === 'pdf' ? ext : null;
}

export async function readDrawing(buf: ArrayBuffer, format: Format, pdfPage = 1): Promise<Drawing> {
  return format === 'dxf' ? readDxf(buf) : readPdf(buf, pdfPage);
}

export const roleOf = (g: Group, settings: PlanSettings): Role => settings.roles[g.id] ?? g.guess;

/** Mètres par unité du dessin. */
export function drawingFactor(format: Format, settings: PlanSettings): number {
  return format === 'pdf' ? PT_TO_M * (settings.pdfScale > 0 ? settings.pdfScale : 100) : UNIT_FACTORS[settings.unit] || 1;
}

/** Centre du dessin : origine de la scène 3D, indépendant des rôles pour que les repères ne bougent pas. */
export function drawingCenter(groups: Group[]): [number, number] {
  const b = segBounds(groups.map((g) => g.segs));
  return b ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] : [0, 0];
}

/**
 * Remplace les équipements extraits du fichier par une nouvelle extraction (changement de
 * page d'un PDF), en conservant ceux ajoutés à la main.
 */
export function mergeExtracted(current: Equipment[], extracted: Equipment[]): Equipment[] {
  return [...extracted, ...current.filter((e) => e.kind === 'manuel')];
}

/** Rattache les indications aux équipements voisins, à l'échelle du plan (voir indications.ts). */
export function withIndications(list: Equipment[], format: Format, settings: PlanSettings): Equipment[] {
  return attachIndications(list, INDICATION_RADIUS_M / drawingFactor(format, settings));
}

export const newId = () => `m-${crypto.randomUUID().slice(0, 13)}`;

/** Repère escaliers et ascenseurs (voir landmarks.ts), à l'échelle du plan. */
export function detectLandmarks(list: Equipment[], groups: Group[], format: Format, settings: PlanSettings) {
  return withLandmarks(list, groups, settings, drawingFactor(format, settings));
}
