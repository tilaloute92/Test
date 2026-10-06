import { openPdf } from './pdf';
import { dedupeOcr, paragraphLabels, type OcrLabel, type OcrLine } from './ocrText';
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

/**
 * Résolution de lecture : 300 dpi, quelle que soit la taille de la feuille. Un repère de
 * 2 mm de haut fait alors une vingtaine de pixels ; à 200 dpi l'OCR n'en lit presque plus
 * aucun. Une feuille A0 à 300 dpi dépasse ce qu'un navigateur accepte en une seule image :
 * la page est lue par tuiles qui se recouvrent, pour ne couper aucun repère.
 */
const SCALE = 300 / 72;
const TILE = 2400;
const OVERLAP = 240;
const MIN_CONFIDENCE = 55;

export async function ocrPdfPage(buf: ArrayBuffer, pageNum: number, onProgress: (p: OcrProgress) => void): Promise<Equipment[]> {
  onProgress({ step: 'Préparation de la page', ratio: 0.01 });
  const doc = await openPdf(buf);
  const canvas = document.createElement('canvas');
  try {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: SCALE });
    const W = Math.ceil(viewport.width), H = Math.ceil(viewport.height);
    const step = TILE - OVERLAP;
    const tiles: [number, number][] = [];
    for (let y = 0; y < H; y += step) { for (let x = 0; x < W; x += step) { tiles.push([x, y]); if (x + TILE >= W) break; } if (y + TILE >= H) break; }

    onProgress({ step: 'Chargement du moteur de lecture', ratio: 0.03 });
    const { createWorker, PSM } = await import('tesseract.js');
    let tileShare = 0, done = 0;
    const worker = await createWorker('fra', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/',
      langPath: '/ocr',
      gzip: true,
      // Worker chargé directement depuis le site (pas d'URL blob) : plus simple à autoriser.
      workerBlobURL: false,
      logger: (m) => {
        if (m.status === 'recognizing text') onProgress({ step: `Lecture des indications (zone ${done + 1} sur ${tiles.length})`, ratio: 0.05 + 0.95 * (done + m.progress * tileShare) / tiles.length });
      },
    });
    try {
      // Texte épars : un plan n'est pas une page de livre, les indications sont dispersées.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error("le navigateur refuse de créer l'image de la page");
      const found: OcrLabel[] = [];
      for (const [x0, y0] of tiles) {
        canvas.width = Math.min(TILE, W - x0);
        canvas.height = Math.min(TILE, H - y0);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        tileShare = 0;
        onProgress({ step: `Rendu de la zone ${done + 1} sur ${tiles.length}`, ratio: 0.05 + 0.95 * done / tiles.length });
        await page.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, -x0, -y0] }).promise;
        // Zone vide (marges, cour) : rien à lire, on gagne le temps de l'OCR.
        if (hasInk(ctx, canvas.width, canvas.height)) {
          tileShare = 1;
          const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
          for (const block of data.blocks ?? []) {
            for (const para of block.paragraphs) {
              const lines: OcrLine[] = para.lines.map((l) => {
                // Pixels de la tuile → coordonnées de la page PDF (rotation de page comprise).
                const [ax, ay] = viewport.convertToPdfPoint(x0 + l.bbox.x0, y0 + l.bbox.y0);
                const [bx, by] = viewport.convertToPdfPoint(x0 + l.bbox.x1, y0 + l.bbox.y1);
                return { text: l.text, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by), confidence: l.confidence };
              });
              found.push(...paragraphLabels(lines, MIN_CONFIDENCE));
            }
          }
        }
        done++;
      }
      onProgress({ step: 'Terminé', ratio: 1 });
      // Tolérances en points PDF : un texte de plan fait 2 à 3 mm sur la feuille.
      return dedupeOcr(found, 8, 4).map((o, i) => ({
        id: `o${i}`, kind: 'texte' as const, label: o.label, type: 'Lu par OCR', layer: '', x: o.x, y: o.y, attributes: { Fiabilité: `${o.confidence} %` },
      }));
    } finally {
      await worker.terminate();
    }
  } finally {
    canvas.width = 0; canvas.height = 0;
    doc.destroy();
  }
}

/** Au moins quelques pixels sombres (échantillonnage d'un pixel sur 16). */
function hasInk(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const px = ctx.getImageData(0, 0, w, h).data;
  let dark = 0;
  for (let i = 0; i < px.length; i += 64) if (px[i] + px[i + 1] + px[i + 2] < 600) dark++;
  return dark > 20;
}
