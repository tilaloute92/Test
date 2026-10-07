import { isUsefulLabel } from './dxf';

/**
 * Mise en forme des lignes lues par l'OCR (sans dépendance au navigateur, pour être testée
 * seule). Une ligne = texte, rectangle en coordonnées de page PDF et fiabilité.
 */
export interface OcrLine { text: string; x0: number; y0: number; x1: number; y1: number; confidence: number }
export interface OcrLabel { label: string; x: number; y: number; confidence: number }

/** Repère d'équipement : un seul mot avec chiffres et séparateurs (G-3-05/03/007/4, SW-B-01), suffixe court permis. */
const REF = /^(?=[^ ]*\d)[\p{L}\d]+(?:[-/.][\p{L}\d]+)+(?: [\p{L}\d]{1,2})?$/u;
const REF_HEAD = /^(?=[^ ]*\d)[\p{L}\d]+(?:[-/.][\p{L}\d]+)+(?: [\p{L}\d]{1,2}(?= |$))?/u;

/**
 * Retire le bruit que l'OCR lit souvent devant un texte sur un plan (trait de cotation,
 * symbole, hachure : « = = G-3-05/03/005/2 R », « Es G-3-… », « © _G-3-… »).
 */
export function cleanOcrText(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  // Symboles en tête ou en queue.
  t = t.replace(/^[^\p{L}\d]+/u, '').replace(/[^\p{L}\d)\]%]+$/u, '');
  // Petits mots parasites (1 à 2 caractères) collés devant un repère.
  const words = t.split(' ');
  const strip = (x: string) => x.replace(/^[^\p{L}\d]+/u, '');
  for (let j = 1; j < words.length && words[j - 1].length <= 2; j++) {
    if (REF.test(strip(words.slice(j).join(' ')))) { t = strip(words.slice(j).join(' ')); break; }
  }
  // Bruit après un repère (« G-3-05/01/008/4 R ses ») : quelques lettres isolées.
  const head = REF_HEAD.exec(t);
  if (head && /^( [^ ]{1,3})+$/u.test(t.slice(head[0].length))) t = head[0];
  return t;
}

/**
 * Indications d'un paragraphe OCR : un bloc de texte (« Baie de brassage / B-12 / 42U ») ne
 * fait qu'une indication, mais une pile de repères (4 prises « G-3-05/03/005/1 R » à
 * « …/4 R ») en donne une par repère, chacune à sa place.
 */
export function paragraphLabels(lines: OcrLine[], minConfidence: number): OcrLabel[] {
  const ok = lines.map((l) => ({ ...l, text: cleanOcrText(l.text) })).filter((l) => l.confidence >= minConfidence && l.text);
  if (!ok.length) return [];
  const center = (ls: OcrLine[]) => ({
    x: (Math.min(...ls.map((l) => l.x0)) + Math.max(...ls.map((l) => l.x1))) / 2,
    y: (Math.min(...ls.map((l) => l.y0)) + Math.max(...ls.map((l) => l.y1))) / 2,
  });
  // Moins de 3 lettres ou chiffres : trop court pour être lu sûrement (« Se », « 5e », « Li »).
  // Sauf les sigles de cabine d'ascenseur (« MC » monte-charge, « MM » monte-malade), utiles au repérage.
  const keep = (label: string) => isUsefulLabel(label) && (label.replace(/[^\p{L}\d]/gu, '').length >= 3 || /^(MC|MM)$/.test(label));
  if (ok.length > 1 && ok.every((l) => REF.test(l.text))) {
    return ok.filter((l) => keep(l.text)).map((l) => ({ label: l.text.slice(0, 200), ...center([l]), confidence: Math.round(l.confidence) }));
  }
  const label = ok.map((l) => l.text).join(' ').slice(0, 200);
  if (!keep(label)) return [];
  return [{ label, ...center(ok), confidence: Math.round(ok.reduce((n, l) => n + l.confidence, 0) / ok.length) }];
}

const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Doublons des zones de recouvrement entre tuiles : même texte lu deux fois au même endroit,
 * ou repère coupé au bord d'une tuile (« G-3-05/02/0 ») à côté de sa lecture complète.
 */
export function dedupeOcr(items: OcrLabel[], tolerance: number, charWidth: number): OcrLabel[] {
  const sorted = [...items].sort((a, b) => key(b.label).length - key(a.label).length || b.confidence - a.confidence);
  const out: OcrLabel[] = [];
  for (const it of sorted) {
    const k = key(it.label);
    const dup = out.some((o) => {
      const ko = key(o.label);
      if (ko !== k && !(k.length >= 4 && ko.includes(k))) return false;
      // Un morceau de repère a son centre décalé de la moitié des caractères manquants.
      return Math.hypot(o.x - it.x, o.y - it.y) <= tolerance + charWidth * (ko.length - k.length);
    });
    if (!dup) out.push(it);
  }
  return out;
}
