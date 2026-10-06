// Copie dans public/ocr/ les fichiers de la reconnaissance de caractères (OCR) : moteur
// WebAssembly, worker et modèle de langue française. Ils sont servis par le site lui-même
// (CSP : aucun CDN), et ne sont pas versionnés : régénérés à chaque `npm run dev` / `build`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'ocr');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const files = [
  [nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  // Variantes « LSTM seul » (moteur neuronal), avec et sans instructions SIMD : le worker
  // choisit selon le navigateur.
  [nm('tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [nm('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [nm('@tesseract.js-data', 'fra', '4.0.0_best_int', 'fra.traineddata.gz'), 'fra.traineddata.gz'],
];
fs.mkdirSync(out, { recursive: true });
for (const [src, name] of files) {
  if (!fs.existsSync(src)) throw new Error(`Fichier OCR introuvable : ${src}. Lancez npm install.`);
  fs.copyFileSync(src, path.join(out, name));
}
console.log(`OCR : ${files.length} fichiers copiés dans public/ocr/`);
