/**
 * Aide partagée pour la génération de fichiers PowerPoint (.pptx) côté navigateur, utilisée
 * par le rapport hebdomadaire et les flash reports projet.
 *
 * Sécurité — points vérifiés avant d'activer cette fonctionnalité (voir aussi le README,
 * section Sécurité) :
 * - Génération 100% côté navigateur (bibliothèque pptxgenjs, chargée à la demande via import
 *   dynamique) : aucune donnée n'est envoyée à un serveur, aucun serveur ne construit le
 *   fichier à notre place.
 * - Le format produit est `.pptx` (OOXML standard) — pptxgenjs ne sait pas écrire de macro
 *   VBA ni de format `.pptm` : le fichier généré ne peut techniquement pas contenir de macro.
 * - Aucun objet OLE, aucune image, aucun lien hypertexte externe n'est jamais inséré par ce
 *   code : uniquement du texte et des tableaux mis en forme.
 * - Le texte dynamique (titres de tâches, noms, descriptions...) est automatiquement échappé
 *   par pptxgenjs lors de l'écriture du XML interne du fichier — vérifié avec des titres
 *   contenant `<`, `&`, `"` : le fichier généré reste valide et le texte s'affiche tel quel,
 *   sans pouvoir casser la structure du document.
 * - Dépendance connue : pptxgenjs dépend de `image-size`, pour lequel `npm audit` remonte deux
 *   failles de déni de service (images ICNS/JXL/HEIF malformées) sans correctif publié à ce
 *   jour. Vérifié dans le code de pptxgenjs : ce module n'est jamais chargé dans un navigateur
 *   (chemin réservé à Node.js) et n'est de toute façon jamais invoqué puisque ce code n'insère
 *   jamais d'image — risque réel nul pour cette application, réévalué si un correctif sort.
 */

export const PPTX_ACCENT = '7C3AED';
export const PPTX_FONT = 'Arial';

export async function loadPptxGenJS() {
  const { default: PptxGenJS } = await import('pptxgenjs');
  return PptxGenJS;
}

export type Pptx = InstanceType<Awaited<ReturnType<typeof loadPptxGenJS>>>;

export function tableHeaderCells(labels: string[]) {
  return labels.map((text) => ({ text, options: { bold: true, color: 'FFFFFF', fill: { color: PPTX_ACCENT } } }));
}

/** Diapositive de titre commune (fond violet foncé, cohérente entre les différents exports). */
export function addTitleSlide(pptx: Pptx, opts: { title: string; subtitle: string; footer?: string }) {
  const slide = pptx.addSlide();
  slide.background = { color: '1E1B4B' };
  slide.addText(opts.title, { x: 0.6, y: 1.7, w: 11.4, h: 1, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: PPTX_FONT });
  slide.addText(opts.subtitle, { x: 0.6, y: 2.7, w: 11.4, h: 0.6, fontSize: 20, color: 'C4B5FD', fontFace: PPTX_FONT });
  slide.addText(opts.footer ?? `Généré le ${new Date().toLocaleDateString('fr-FR')}`, {
    x: 0.6,
    y: 3.25,
    w: 11.4,
    h: 0.4,
    fontSize: 12,
    color: 'A78BFA',
    fontFace: PPTX_FONT,
  });
  return slide;
}

export function addSectionTitle(slide: ReturnType<Pptx['addSlide']>, text: string) {
  slide.addText(text, { x: 0.4, y: 0.3, w: 12.5, h: 0.55, fontSize: 22, bold: true, color: '1E293B', fontFace: PPTX_FONT });
}
