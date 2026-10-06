import DxfParser from 'dxf-parser';
import { IDENTITY, apply, arcPoints, bulgePoints, mul, segBounds, wallScore, type Mat } from './geometry';
import { UNIT_FACTORS, type Drawing, type Equipment, type Group, type Role, type Unit } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any -- entités DXF non typées par dxf-parser */

const INSUNITS: Record<number, Unit> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
const OCS_TYPES = new Set(['ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE', 'INSERT', 'SOLID']);

/** Décode un DXF : UTF-8 (AutoCAD 2007+) ou, à défaut, Windows-1252 (versions antérieures). */
export function decodeDxf(buf: ArrayBuffer): string {
  const text = new TextDecoder('utf-8').decode(buf);
  return text.includes('\ufffd') ? new TextDecoder('windows-1252').decode(buf) : text;
}

function pushPolyline(g: Group, m: Mat, pts: number[], closed: boolean) {
  if (pts.length < 4) return;
  let [px, py] = apply(m, pts[0], pts[1]);
  const fx = px, fy = py;
  for (let i = 2; i < pts.length; i += 2) {
    const [x, y] = apply(m, pts[i], pts[i + 1]);
    g.segs.push(px, py, x, y);
    px = x; py = y;
  }
  if (closed && (px !== fx || py !== fy)) g.segs.push(px, py, fx, fy);
}

export function guessLayerRole(name: string): Role {
  const n = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/fen|win|vitr|glaz|baie vitr|chassis/.test(n)) return 'fenetre';
  if (/porte|door/.test(n)) return 'porte';
  if (/cot|dim|text|txt|hach|hatch|axe|grid|annot|cartouche|title|viewport|defpoint|legend|nomencl/.test(n)) return 'ignore';
  if (/mur|wall|cloison|macon|beton|voile|poteau|column|partition/.test(n)) return 'mur';
  return 'plan';
}

function dxfToGroups(dxf: any): Group[] {
  const layers: Record<string, any> = dxf.tables?.layer?.layers || {};
  const blocks: Record<string, any> = dxf.blocks || {};
  const map = new Map<string, Group>();
  const groupFor = (name: string) => {
    let g = map.get(name);
    if (!g) {
      g = { id: name, name, color: layers[name]?.color ?? 0x808080, kind: 'line', segs: [], fills: [], guess: 'plan' };
      map.set(name, g);
    }
    return g;
  };

  const walk = (entities: any[], m0: Mat, inherit: string | null, depth: number) => {
    if (depth > 10) return;
    for (const e of entities || []) {
      let layer: string = e.layer || '0';
      if (layer === '0' && inherit) layer = inherit;
      const m = OCS_TYPES.has(e.type) && e.extrusionDirection && e.extrusionDirection.z < 0 ? mul(m0, [-1, 0, 0, 1, 0, 0]) : m0;
      switch (e.type) {
        case 'LINE': {
          const [a, b] = e.vertices || [];
          if (a && b) pushPolyline(groupFor(layer), m, [a.x, a.y, b.x, b.y], false);
          break;
        }
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const v = (e.vertices || []).filter((p: any) => Number.isFinite(p.x));
          if (v.length < 2) break;
          const pts: number[] = [];
          const n = e.shape ? v.length : v.length - 1;
          for (let i = 0; i < n; i++) {
            const p = v[i], q = v[(i + 1) % v.length];
            const seg = bulgePoints(p.x, p.y, q.x, q.y, p.bulge || 0);
            if (i > 0) seg.splice(0, 2);
            pts.push(...seg);
          }
          pushPolyline(groupFor(layer), m, pts, false);
          break;
        }
        case 'ARC': {
          let sweep = e.endAngle - e.startAngle;
          while (sweep <= 0) sweep += Math.PI * 2;
          pushPolyline(groupFor(layer), m, arcPoints(e.center.x, e.center.y, e.radius, e.startAngle, sweep), false);
          break;
        }
        case 'CIRCLE':
          pushPolyline(groupFor(layer), m, arcPoints(e.center.x, e.center.y, e.radius, 0, Math.PI * 2), false);
          break;
        case 'ELLIPSE': {
          const c = e.center, M = e.majorAxisEndPoint, r = e.axisRatio ?? 1;
          const t0 = e.startAngle ?? 0;
          let t1 = e.endAngle ?? Math.PI * 2;
          while (t1 <= t0) t1 += Math.PI * 2;
          const n = Math.max(8, Math.ceil((t1 - t0) / (Math.PI / 18)));
          const pts: number[] = [];
          for (let k = 0; k <= n; k++) {
            const t = t0 + (t1 - t0) * k / n, ct = Math.cos(t), st = Math.sin(t) * r;
            pts.push(c.x + ct * M.x - st * M.y, c.y + ct * M.y + st * M.x);
          }
          pushPolyline(groupFor(layer), m, pts, false);
          break;
        }
        case 'SPLINE': {
          const src = e.fitPoints?.length ? e.fitPoints : e.controlPoints || [];
          pushPolyline(groupFor(layer), m, src.flatMap((p: any) => [p.x, p.y]), !!e.closed);
          break;
        }
        case 'SOLID': {
          const p = e.points || [];
          if (p.length < 3) break;
          const order = p.length === 4 ? [p[0], p[1], p[3], p[2]] : p;
          const outer = order.flatMap((q: any) => apply(m, q.x, q.y));
          const g = groupFor(layer);
          g.fills.push({ outer, holes: [] });
          pushPolyline(g, IDENTITY, outer, true);
          break;
        }
        case 'INSERT': {
          const blk = blocks[e.name];
          if (!blk) break;
          const base = blk.position || { x: 0, y: 0 };
          const pos = e.position || { x: 0, y: 0 };
          const rot = (e.rotation || 0) * Math.PI / 180;
          const sx = e.xScale ?? 1, sy = e.yScale ?? 1;
          const c = Math.cos(rot), s = Math.sin(rot);
          const mi = mul([c * sx, s * sx, -s * sy, c * sy, pos.x, pos.y], [1, 0, 0, 1, -base.x, -base.y]);
          walk(blk.entities, mul(m, mi), layer, depth + 1);
          break;
        }
        default:
          break; // TEXT, MTEXT, DIMENSION, HATCH… : pas de géométrie 3D
      }
    }
  };
  walk(dxf.entities, IDENTITY, null, 0);

  const groups = [...map.values()].filter((g) => g.segs.length > 0);
  for (const g of groups) {
    const info = layers[g.name];
    g.guess = info && (info.frozen || info.visible === false) ? 'ignore' : guessLayerRole(g.name);
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Nettoie les codes de mise en forme d'un MTEXT (\P, {\fArial|b0;…}, %%c…). */
export function cleanMtext(s: string): string {
  return s
    .replace(/\\[Pp]/g, ' ')
    .replace(/\\[ACcFfHhLlOoQqTtWwKkSs][^;\\{}]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Un texte vaut la peine d'être indexé s'il contient une lettre, ou un numéro entier de 3 chiffres ou plus (n° de local). */
export const isUsefulLabel = (s: string) => s.length >= 2 && (/\p{L}/u.test(s) || /^\d{3,}$/.test(s));

const PREFERRED_TAGS = ['REPERE', 'REP', 'REF', 'REFERENCE', 'NOM', 'NAME', 'ID', 'TAG', 'LABEL', 'ETIQUETTE', 'NUM', 'NUMERO', 'CODE', 'DESIGNATION'];

function blockLabel(attrs: Record<string, string>, name: string): string {
  for (const t of PREFERRED_TAGS) if (attrs[t]) return attrs[t];
  const values = Object.values(attrs).filter(Boolean);
  return values.length ? values.join(' · ') : name;
}

/**
 * Extrait les équipements d'un DXF : blocs insérés (avec leurs attributs : repère, modèle,
 * n° de série…) et textes. Lecture directe des codes de groupe de la section ENTITIES,
 * car dxf-parser ne lit pas les attributs (ATTRIB) des blocs, qui portent justement
 * l'identité des équipements. Seules les entités de premier niveau sont prises en compte :
 * un texte à l'intérieur d'un bloc est un élément de son symbole, pas un repère.
 */
export function extractDxfEquipment(text: string): Equipment[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: Equipment[] = [];
  let section = '';
  let expectSectionName = false;
  let cur: Record<string, any> | null = null;
  let insert: (Equipment & { attributes: Record<string, string> }) | null = null;
  let nb = 0, nt = 0;

  const closeInsert = () => {
    if (!insert) return;
    insert.label = blockLabel(insert.attributes, insert.type);
    if (!Object.keys(insert.attributes).length) delete (insert as Equipment).attributes;
    out.push(insert);
    insert = null;
  };
  const finish = (e: Record<string, any> | null) => {
    if (!e || section !== 'ENTITIES') return;
    const x = Number(e.x), y = Number(e.y);
    switch (e.type) {
      case 'INSERT':
        closeInsert();
        if (!e.name || e.name.startsWith('*') || !Number.isFinite(x) || !Number.isFinite(y)) return;
        insert = { id: `b${nb++}`, kind: 'bloc', label: '', type: e.name, layer: e.layer || '0', x, y, attributes: {} };
        if (!e.hasAttribs) closeInsert();
        return;
      case 'ATTRIB':
        if (insert && e.tag && e.text) insert.attributes[String(e.tag).toUpperCase()] = cleanMtext(e.text);
        return;
      case 'SEQEND':
        closeInsert();
        return;
      case 'TEXT':
      case 'MTEXT': {
        closeInsert();
        const label = cleanMtext((e.chunks ? e.chunks.join('') : '') + (e.text || ''));
        if (!isUsefulLabel(label) || !Number.isFinite(x) || !Number.isFinite(y)) return;
        out.push({ id: `t${nt++}`, kind: 'texte', label: label.slice(0, 200), type: '', layer: e.layer || '0', x, y });
        return;
      }
      case 'MULTILEADER':
      case 'MLEADER': {
        // Étiquette à flèche : le texte est en code 304, sa position en 12/22 (sinon le point
        // de base 10/20).
        closeInsert();
        const label = cleanMtext(e.mtext || '');
        const tx = Number.isFinite(e.tx) ? e.tx : x, ty = Number.isFinite(e.ty) ? e.ty : y;
        if (!isUsefulLabel(label) || !Number.isFinite(tx) || !Number.isFinite(ty)) return;
        out.push({ id: `t${nt++}`, kind: 'texte', label: label.slice(0, 200), type: 'Étiquette à flèche', layer: e.layer || '0', x: tx, y: ty });
        return;
      }
      case 'DIMENSION': {
        // Une cote dont le texte a été remplacé porte souvent une indication (« HSP 2,50 »,
        // « Passage gaine »). « <> » est la valeur mesurée : seul le texte ajouté compte.
        closeInsert();
        const label = cleanMtext(String(e.text || '').replace(/<>/g, ' '));
        if (!isUsefulLabel(label) || !Number.isFinite(e.tx) || !Number.isFinite(e.ty)) return;
        out.push({ id: `t${nt++}`, kind: 'texte', label: label.slice(0, 200), type: 'Cote annotée', layer: e.layer || '0', x: e.tx, y: e.ty });
        return;
      }
      default:
        closeInsert();
    }
  };

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    const value = lines[i + 1];
    if (code === 0) {
      finish(cur);
      cur = null;
      const v = value.trim();
      if (v === 'SECTION') { expectSectionName = true; continue; }
      if (v === 'ENDSEC') { closeInsert(); section = ''; continue; }
      if (v === 'EOF') break;
      if (section === 'ENTITIES') cur = { type: v };
      continue;
    }
    if (code === 2 && expectSectionName) { section = value.trim(); expectSectionName = false; continue; }
    if (!cur) continue;
    switch (code) {
      case 8: cur.layer = value.trim(); break;
      case 2: if (cur.type === 'INSERT') cur.name = value.trim(); else if (cur.type === 'ATTRIB') cur.tag = value.trim(); break;
      case 1: cur.text = value; break;
      // MTEXT long : les morceaux en code 3 précèdent le dernier morceau en code 1.
      case 3: (cur.chunks ||= []).push(value); break;
      // Première occurrence seulement : un MULTILEADER répète ces codes dans ses sous-objets.
      case 10: if (cur.x === undefined) cur.x = parseFloat(value); break;
      case 20: if (cur.y === undefined) cur.y = parseFloat(value); break;
      case 11: if (cur.type === 'DIMENSION' && cur.tx === undefined) cur.tx = parseFloat(value); break;
      case 21: if (cur.type === 'DIMENSION' && cur.ty === undefined) cur.ty = parseFloat(value); break;
      case 12: if (cur.tx === undefined) cur.tx = parseFloat(value); break;
      case 22: if (cur.ty === undefined) cur.ty = parseFloat(value); break;
      case 304: if (cur.mtext === undefined) cur.mtext = value; break;
      case 66: cur.hasAttribs = parseInt(value, 10) === 1; break;
      default: break;
    }
  }
  finish(cur);
  closeInsert();
  return out;
}

export function readDxf(buf: ArrayBuffer): Drawing {
  const text = decodeDxf(buf);
  const dxf = new DxfParser().parseSync(text) as any;
  if (!dxf) throw new Error('fichier DXF illisible');
  const groups = dxfToGroups(dxf);
  const equipment = extractDxfEquipment(text);
  const code = dxf.header?.$INSUNITS;
  let unit: Drawing['unit'];
  if (INSUNITS[code]) unit = { unit: INSUNITS[code], source: 'file' };
  else {
    const b = segBounds(groups.filter((g) => g.guess !== 'ignore').map((g) => g.segs));
    const size = b ? Math.max(b.maxX - b.minX, b.maxY - b.minY) : 0;
    unit = { unit: size > 2000 ? 'mm' : size > 200 ? 'cm' : 'm', source: 'guess' };
  }
  guessWallLayers(groups, UNIT_FACTORS[unit.unit]);
  return { format: 'dxf', groups, equipment, unit, pageCount: 1 };
}

/**
 * Aucun calque ne s'appelle « mur », « cloison »… : on retient le ou les calques qui forment
 * de longs murs en double trait (10 à 60 cm d'épaisseur, pans d'au moins 1 m).
 */
function guessWallLayers(groups: Group[], f: number) {
  if (groups.some((g) => g.guess === 'mur')) return;
  const cands = groups.filter((g) => g.guess === 'plan' && g.segs.length >= 16 && g.segs.length <= 400_000);
  const scores = cands.map((g) => wallScore(g.segs, 0.1 / f, 0.6 / f, 1 / f));
  const best = Math.max(0, ...scores);
  if (best > 0) cands.forEach((g, k) => { if (scores[k] >= best * 0.4) g.guess = 'mur'; });
}
