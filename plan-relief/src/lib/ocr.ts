import { openPdf } from './pdf';
import { isUsefulLabel } from './dxf';
import type { Equipment } from './types';

/**
 * Lecture par reconnaissance de caractères (OCR) des indications qu'un PDF ne contient pas
 * sous forme de texte : plan scanné, ou texte AutoCAD exporté en traits (polices SHX).
 *
 * Tout tourne dans le navigateur, avec des fichiers servis par le site (public/ocr/,
 * copiés par scripts/copy-ocr-assets.mjs) : moteur Tesseract en WebAssembly et modèle de
 * langue française. Aucun envoi à un service extérieur, aucun CDN.
 */

export interface OcrProgress { step: string; ratio: number }

/** Côté le plus long de l'image analysée, en pixels : assez fin pour un texte de 2 mm sur un A1. */
const TARGET_PX = 6000;
const MIN_CONFIDENCE = 55;

export async function ocrPdfPage(buf: ArrayBuffer, pageNum: number, onProgress: (p: OcrProgress) => void): Promise<Equipment[]> {
  onProgress({ step: 'Préparation de la page', ratio: 0.02 });
  const doc = await openPdf(buf);
  let canvas: HTMLCanvasElement | null = null;
  try {
    const page = await doc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(TARGET_PX / Math.max(base.width, base.height), 8);
    const viewport = page.getViewport({ scale });
    canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error("le navigateur refuse de créer l'image de la page");
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onProgress({ step: 'Rendu de la page', ratio: 0.08 });
    await page.render({ canvasContext: ctx, viewport }).promise;

    onProgress({ step: 'Chargement du moteur de lecture', ratio: 0.15 });
    const { createWorker, PSM } = await import('tesseract.js');
    const worker = await createWorker('fra', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/',
      langPath: '/ocr',
      gzip: true,
      // Worker chargé directement depuis le site (pas d'URL blob) : plus simple à autoriser.
      workerBlobURL: false,
      logger: (m) => {
        if (m.status === 'recognizing text') onProgress({ step: 'Lecture des indications', ratio: 0.2 + m.progress * 0.78 });
      },
    });
    try {
      // Texte épars : un plan n'est pas une page de livre, les indications sont dispersées.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
      const out: Equipment[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          const lines = para.lines.filter((l) => l.confidence >= MIN_CONFIDENCE);
          const label = lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
          if (!lines.length || !isUsefulLabel(label) || !/[\p{L}\d]{2,}/u.test(label)) continue;
          const x0 = Math.min(...lines.map((l) => l.bbox.x0)), x1 = Math.max(...lines.map((l) => l.bbox.x1));
          const y0 = Math.min(...lines.map((l) => l.bbox.y0)), y1 = Math.max(...lines.map((l) => l.bbox.y1));
          // Pixels de l'image → coordonnées de la page PDF (rotation de page comprise).
          const [x, y] = viewport.convertToPdfPoint((x0 + x1) / 2, (y0 + y1) / 2);
          const conf = Math.round(lines.reduce((n, l) => n + l.confidence, 0) / lines.length);
          out.push({ id: `o${out.length}`, kind: 'texte', label: label.slice(0, 200), type: 'Lu par OCR', layer: '', x, y, attributes: { Fiabilité: `${conf} %` } });
        }
      }
      onProgress({ step: 'Terminé', ratio: 1 });
      return out;
    } finally {
      await worker.terminate();
    }
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    doc.destroy();
  }
}
