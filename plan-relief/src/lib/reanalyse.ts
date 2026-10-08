import * as api from '../api';
import { detectLandmarks, drawingFactor, mergeExtracted, readDrawing, withIndications } from './drawing';
import { mergeOcr } from './indications';
import { OCR_TYPE, ocrPdfPage } from './ocr';
import { DEFAULT_SETTINGS, type Drawing, type Equipment, type PlanRecord } from './types';

export interface ReanalyseOptions {
  /** Lecture OCR des textes dessinés ou scannés (PDF uniquement). */
  ocr: boolean;
  /** OCR : relire aussi les textes écrits à la verticale (durée doublée). */
  vertical?: boolean;
}

export interface ReanalyseResult { list: Equipment[]; drawing: Drawing; texts: number; stairs: number; lifts: number; risers: number }

/**
 * Relit le fichier d'origine d'un plan avec les règles de lecture actuelles : blocs, textes,
 * OCR si demandé, escaliers / ascenseurs / gaines, rattachement des indications. Les
 * équipements ajoutés à la main sont conservés ; ceux lus dans le fichier sont remplacés.
 * Rien n'est enregistré ici.
 */
export async function reanalysePlan(plan: PlanRecord, buf: ArrayBuffer, opts: ReanalyseOptions, onStep: (step: string) => void = () => {}): Promise<ReanalyseResult> {
  const settings = { ...DEFAULT_SETTINGS, ...plan.settings };
  onStep('Lecture du fichier');
  const drawing = await readDrawing(buf, plan.file.format, settings.pdfPage);
  let extracted = drawing.equipment;
  if (opts.ocr && plan.file.format === 'pdf') {
    const read = await ocrPdfPage(buf, settings.pdfPage, (p) => onStep(`${p.step}… ${Math.round(p.ratio * 100)} %`), { vertical: opts.vertical });
    extracted = mergeOcr(extracted, read, 0.5 / drawingFactor('pdf', settings));
  } else if (plan.file.format === 'pdf') {
    // Sans nouvelle lecture OCR, les textes lus par OCR la fois précédente sont gardés : une
    // réanalyse rapide ne doit pas effacer plusieurs minutes de lecture.
    const previous = plan.equipment.filter((e) => e.kind === 'texte' && e.type === OCR_TYPE);
    extracted = mergeOcr(extracted, previous, 0.5 / drawingFactor('pdf', settings));
  }
  onStep('Repérage des escaliers, ascenseurs et gaines');
  const found = detectLandmarks(mergeExtracted(plan.equipment, extracted), drawing.groups, plan.file.format, settings);
  const list = withIndications(found.list, plan.file.format, settings);
  return { list, drawing, texts: list.filter((e) => e.kind === 'texte').length, stairs: found.stairs, lifts: found.lifts, risers: found.risers };
}

/**
 * Réanalyse et enregistre un plan déjà en stock (traitement par lot). Si un collègue a
 * modifié le plan pendant l'analyse, celle-ci est refaite sur sa version.
 */
export async function reanalyseAndSave(id: string, opts: ReanalyseOptions, onStep: (step: string) => void): Promise<ReanalyseResult> {
  for (let attempt = 0; ; attempt++) {
    onStep('Chargement du plan');
    const plan = await api.getPlan(id);
    const buf = await api.fetchPlanFile(id);
    const res = await reanalysePlan(plan, buf, opts, onStep);
    onStep('Enregistrement');
    try {
      await api.updatePlan(id, { equipment: res.list, version: plan.version });
      return res;
    } catch (err) {
      if ((err as api.ApiError).status === 409 && attempt === 0) continue;
      throw err;
    }
  }
}
