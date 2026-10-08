import { openPdf } from './pdf';
import { dedupeOcr, paragraphLabels, type OcrLabel, type OcrLine } from './ocrText';
import { collectPieces, groupLines, renderBatches, type TextLine } from './vectorText';
import * as pdfjsLib from 'pdfjs-dist';
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
 * Résolution de lecture : 400 dpi, quelle que soit la taille de la feuille. Sur un plan VDI
 * réel, 400 dpi lit un tiers de repères de plus que 300 dpi (petits repères de 1,5 à 2 mm) ;
 * à 200 dpi l'OCR n'en lit presque plus aucun. Une feuille A0 à cette résolution dépasse ce
 * qu'un navigateur accepte en une seule image : la page est lue par tuiles qui se
 * recouvrent, pour ne couper aucun repère.
 */
const SCALE = 400 / 72;
// Tuiles de 2000 pixels : sur une image plus grande et chargée, l'analyse de mise en page de
// Tesseract écarte des textes isolés (sigles de cabine « ASC », « MC » d'un plan réel).
const TILE = 2000;
const OVERLAP = 300;
const MIN_CONFIDENCE = 55;

export interface OcrOptions {
  /** Relire chaque zone tournée d'un quart de tour : textes écrits à la verticale (temps doublé). */
  vertical?: boolean;
}

export async function ocrPdfPage(buf: ArrayBuffer, pageNum: number, onProgress: (p: OcrProgress) => void, opts: OcrOptions = {}): Promise<Equipment[]> {
  onProgress({ step: 'Préparation de la page', ratio: 0.01 });
  const doc = await openPdf(buf);
  const canvas = document.createElement('canvas');
  const turned = document.createElement('canvas');
  try {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: SCALE });
    const W = Math.ceil(viewport.width), H = Math.ceil(viewport.height);
    const step = TILE - OVERLAP;
    const tiles: [number, number][] = [];
    for (let y = 0; y < H; y += step) { for (let x = 0; x < W; x += step) { tiles.push([x, y]); if (x + TILE >= W) break; } if (y + TILE >= H) break; }

    // 1. Textes dessinés en vectoriel : chaque ligne relue seule, droite et agrandie.
    onProgress({ step: 'Repérage des textes dessinés', ratio: 0.02 });
    const ol = await page.getOperatorList();
    const lines = groupLines(collectPieces(ol.fnArray, ol.argsArray as unknown[][], pdfjsLib.OPS as unknown as Record<string, number>));
    const vectorShare = lines.length >= 30 ? 0.4 : 0;
    const { createWorker, PSM } = await import('tesseract.js');
    let tileShare = 0, done = 0;
    let phase: 'vector' | 'tiles' = 'vector';
    const worker = await createWorker('fra', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/',
      langPath: '/ocr',
      gzip: true,
      // Worker chargé directement depuis le site (pas d'URL blob) : plus simple à autoriser.
      workerBlobURL: false,
      logger: (m) => {
        if (m.status === 'recognizing text' && phase === 'tiles') onProgress({ step: `Lecture de la page (zone ${done + 1} sur ${tiles.length})`, ratio: 0.05 + vectorShare + (0.95 - vectorShare) * (done + m.progress * tileShare) / tiles.length });
      },
    });
    try {
      // Texte épars : un plan n'est pas une page de livre, les indications sont dispersées.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
      const found: OcrLabel[] = [];
      if (vectorShare) {
        for (const l of await readVectorLines(worker, lines, (r) => onProgress({ step: `Lecture des textes dessinés (${Math.round(r * 100)} %)`, ratio: 0.05 + vectorShare * r }))) found.push(l);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
      }
      // 2. Lecture de l'image de la page par zones : textes scannés, images, et ce que la
      // passe vectorielle a manqué. Les deux lectures se complètent ; les doublons sont fusionnés.
      phase = 'tiles';
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error("le navigateur refuse de créer l'image de la page");
      for (const [x0, y0] of tiles) {
        canvas.width = Math.min(TILE, W - x0);
        canvas.height = Math.min(TILE, H - y0);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        tileShare = 0;
        onProgress({ step: `Lecture de la page (zone ${done + 1} sur ${tiles.length})`, ratio: 0.05 + vectorShare + (0.95 - vectorShare) * done / tiles.length });
        await page.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, -x0, -y0] }).promise;
        // Zone vide (marges, cour) : rien à lire, on gagne le temps de l'OCR.
        if (hasInk(ctx, canvas.width, canvas.height)) {
          tileShare = 1;
          const read = async (img: HTMLCanvasElement, toTile: (x: number, y: number) => [number, number]) => {
            const { data } = await worker.recognize(img, {}, { blocks: true, text: false });
            for (const block of data.blocks ?? []) {
              for (const para of block.paragraphs) {
                const lines: OcrLine[] = para.lines.map((l) => {
                  // Pixels de la tuile → coordonnées de la page PDF (rotation de page comprise).
                  const [tx0, ty0] = toTile(l.bbox.x0, l.bbox.y0), [tx1, ty1] = toTile(l.bbox.x1, l.bbox.y1);
                  const [ax, ay] = viewport.convertToPdfPoint(x0 + tx0, y0 + ty0);
                  const [bx, by] = viewport.convertToPdfPoint(x0 + tx1, y0 + ty1);
                  return { text: l.text, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by), confidence: l.confidence };
                });
                found.push(...paragraphLabels(lines, MIN_CONFIDENCE));
              }
            }
          };
          await read(canvas, (x, y) => [x, y]);
          if (opts.vertical) {
            // Quart de tour dans le sens inverse des aiguilles : un texte qui monte se lit à
            // l'horizontale. Pixel (x, y) de l'image tournée = pixel (W - y, x) de la tuile.
            const W = canvas.width;
            turned.width = canvas.height;
            turned.height = W;
            const tctx = turned.getContext('2d');
            if (tctx) {
              tctx.setTransform(0, -1, 1, 0, 0, W);
              tctx.drawImage(canvas, 0, 0);
              await read(turned, (x, y) => [W - y, x]);
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
    turned.width = 0; turned.height = 0;
    doc.destroy();
  }
}

type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

/**
 * Lit les lignes de texte vectoriel, rendues par lots (voir vectorText.ts). Une ligne
 * verticale est lue dans les deux sens ; on garde la lecture qui donne un repère, à défaut
 * la plus fiable. Fiabilité calculée par mot : un symbole collé au texte ne la fait pas chuter.
 */
async function readVectorLines(worker: OcrWorker, lines: TextLine[], progress: (r: number) => void): Promise<OcrLabel[]> {
  const { PSM } = await import('tesseract.js');
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, user_defined_dpi: '300' });
  const vertical = lines.filter((l) => l.dir === 'v');
  const jobs = [...renderBatches(lines), ...renderBatches(vertical, true)];
  const reads = new Map<TextLine, { text: string; conf: number }[]>();
  for (let b = 0; b < jobs.length; b++) {
    const job = jobs[b];
    const { data } = await worker.recognize(job.canvas, {}, { blocks: true, text: false });
    const got = (data.blocks ?? []).flatMap((bl) => bl.paragraphs.flatMap((p) => p.lines));
    for (const slot of job.slots) {
      const words = got.filter((l) => { const c = (l.bbox.y0 + l.bbox.y1) / 2; return c >= slot.top && c < slot.bottom; })
        .sort((x, y) => x.bbox.x0 - y.bbox.x0)
        .flatMap((l) => l.words)
        .filter((w) => /[\p{L}\d]/u.test(w.text) && w.confidence >= 30);
      if (!words.length) continue;
      const list = reads.get(slot.line) ?? [];
      list.push({ text: words.map((w) => w.text).join(' '), conf: words.reduce((n, w) => n + w.confidence, 0) / words.length });
      reads.set(slot.line, list);
    }
    job.canvas.width = 0; job.canvas.height = 0;
    progress((b + 1) / jobs.length);
  }
  const looksRef = /[A-Z]-?\d-?\d\d\/\d\d/;
  const out: OcrLabel[] = [];
  for (const [line, list] of reads) {
    const best = list.reduce((a, c) => ((c.conf + (looksRef.test(c.text) ? 40 : 0)) > (a.conf + (looksRef.test(a.text) ? 40 : 0)) ? c : a));
    out.push(...paragraphLabels([{ text: best.text, x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1, confidence: best.conf }], MIN_CONFIDENCE));
  }
  return out;
}

/** Au moins quelques pixels sombres (échantillonnage d'un pixel sur 16). */
function hasInk(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const px = ctx.getImageData(0, 0, w, h).data;
  let dark = 0;
  for (let i = 0; i < px.length; i += 64) if (px[i] + px[i + 1] + px[i + 2] < 600) dark++;
  return dark > 20;
}
