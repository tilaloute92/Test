import { levelName } from './building';
import type { LoadedFloor } from './building';
import type { RouteResult } from './route';

/**
 * Fiche de tracé imprimable : un document par tracé (ou par tracé groupé), ouvert dans un
 * nouvel onglet puis imprimé ou enregistré en PDF par le navigateur (« Microsoft Print to
 * PDF » ou « Enregistrer au format PDF »). Rien n'est envoyé au serveur.
 */
export interface Lengths { horizontal: number; vertical: number; descents: number; total: number; withMargin: number }

export function routeLengths(route: RouteResult, floors: LoadedFloor[], height: 'plafond' | 'sol', margin: number): Lengths {
  let descents = 0;
  if (height === 'plafond') {
    const byId = new Map(floors.map((f) => [f.planId, f]));
    const legs = route.steps.flatMap((s) => (s.type === 'leg' ? [s.leg] : []));
    // Du faux plafond jusqu'à un équipement posé vers 1 m du sol, à chaque extrémité.
    const d = (id?: string) => { const f = id ? byId.get(id) : undefined; return f ? Math.max(0, (f.plan.settings.hWall ?? 2.5) - 0.15 - 1) : 0; };
    descents = d(legs[0]?.planId) + d(legs[legs.length - 1]?.planId);
  }
  const total = route.horizontal + route.vertical + descents;
  return { horizontal: route.horizontal, vertical: route.vertical, descents, total, withMargin: total * (1 + margin / 100) };
}

export interface SheetCable { label: string; floor: string; planName: string; route: RouteResult; lengths: Lengths }
export interface SheetInput {
  number: string;
  name?: string;
  ref?: string;
  site: string;
  building: string;
  from: { label: string; floor: string; planName: string };
  cables: SheetCable[];
  floors: LoadedFloor[];
  options: string;
  margin: number;
  user: string;
  version: string;
}

const COLORS = ['#e07b1a', '#2b6cb0', '#8e44ad', '#16a085', '#c0392b', '#7f8c8d', '#d4a017', '#2c3e50'];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const m = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;

/** Vue de dessus d'un étage : traits du plan en gris, câbles en couleur, extrémités. */
function floorImage(f: LoadedFloor, cables: SheetCable[], isStart: boolean): string {
  const b = f.bounds;
  const W = 1600;
  const s = W / Math.max(1, b.maxX - b.minX);
  const H = Math.round(Math.min(1400, (b.maxY - b.minY) * s));
  const sy = H / Math.max(1, b.maxY - b.minY);
  const k = Math.min(s, sy);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
  const X = (x: number) => (x - b.minX) * k, Y = (y: number) => H - (y - b.minY) * k;
  if (f.ink) {
    c.strokeStyle = '#b8bec6'; c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i + 3 < f.ink.length; i += 4) { c.moveTo(X(f.ink[i]), Y(f.ink[i + 1])); c.lineTo(X(f.ink[i + 2]), Y(f.ink[i + 3])); }
    c.stroke();
  }
  cables.forEach((cab, ci) => {
    const legs = cab.route.steps.flatMap((st) => (st.type === 'leg' && st.leg.planId === f.planId ? [st.leg] : []));
    c.strokeStyle = cables.length > 1 ? COLORS[ci % COLORS.length] : COLORS[0];
    c.lineWidth = 6; c.lineJoin = 'round'; c.lineCap = 'round';
    for (const leg of legs) {
      c.beginPath();
      leg.points.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
      c.stroke();
    }
    const all = cab.route.steps.flatMap((st) => (st.type === 'leg' ? [st.leg] : []));
    const first = all[0], last = all[all.length - 1];
    const dot = (x: number, y: number, color: string) => { c.fillStyle = color; c.beginPath(); c.arc(X(x), Y(y), 11, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 3; c.stroke(); };
    if (isStart && first?.planId === f.planId && ci === 0) dot(first.points[0][0], first.points[0][1], '#2e9e5b');
    if (last?.planId === f.planId) { const p = last.points[last.points.length - 1]; dot(p[0], p[1], '#d23c32'); }
  });
  return canvas.toDataURL('image/png');
}

export function openRouteSheet(input: SheetInput) {
  const win = window.open('', '_blank');
  if (!win) throw new Error("Le navigateur a bloqué l'ouverture de la fiche : autorisez les fenêtres surgissantes pour ce site.");
  const group = input.cables.length > 1;
  const total = input.cables.reduce((n, c) => n + c.lengths.withMargin, 0);
  const startPlan = input.cables[0]?.route.steps.find((s) => s.type === 'leg');
  const startId = startPlan?.type === 'leg' ? startPlan.leg.planId : '';
  const used = input.floors.filter((f) => input.cables.some((c) => c.route.steps.some((s) => s.type === 'leg' && s.leg.planId === f.planId)));
  const views = used.map((f) => `<figure><figcaption>${esc(levelName(f.level))} — ${esc(f.plan.name)}</figcaption><img src="${floorImage(f, input.cables, f.planId === startId)}" alt=""></figure>`).join('');
  const floorName = (id: string) => { const f = input.floors.find((x) => x.planId === id); return f ? `${levelName(f.level)}` : ''; };

  const steps = (c: SheetCable) => c.route.steps.map((s, i) => s.type === 'leg'
    ? `<tr><td>${i + 1}</td><td>${esc(floorName(s.leg.planId))} — de ${esc(s.leg.from)} à ${esc(s.leg.to)}${s.leg.wallCrossings ? ` <b>(${s.leg.wallCrossings} mur(s) à traverser)</b>` : ''}</td><td class="n">${m(s.leg.length)}</td></tr>`
    : `<tr><td>${i + 1}</td><td>${s.rise.toPlan && input.floors.find((f) => f.planId === s.rise.toPlan)!.elevation >= input.floors.find((f) => f.planId === s.rise.fromPlan)!.elevation ? '↑ Montée' : '↓ Descente'} par ${esc(s.rise.label)} (${esc(floorName(s.rise.fromPlan))} → ${esc(floorName(s.rise.toPlan))})</td><td class="n">${m(s.rise.length)}</td></tr>`).join('');

  const body = group
    ? `<h2>Câbles (${input.cables.length})</h2>
       <table><thead><tr><th>Arrivée</th><th>Étage</th><th class="n">Horizontal</th><th class="n">Entre étages</th><th class="n">Descentes</th><th class="n">À prévoir</th></tr></thead><tbody>
       ${input.cables.map((c, i) => `<tr><td><span class="sw" style="background:${COLORS[i % COLORS.length]}"></span>${esc(c.label)}</td><td>${esc(c.floor)}</td><td class="n">${m(c.lengths.horizontal)}</td><td class="n">${m(c.lengths.vertical)}</td><td class="n">${m(c.lengths.descents)}</td><td class="n"><b>${m(c.lengths.withMargin)}</b></td></tr>`).join('')}
       <tr class="tot"><td>Total</td><td></td><td class="n">${m(input.cables.reduce((n, c) => n + c.lengths.horizontal, 0))}</td><td class="n">${m(input.cables.reduce((n, c) => n + c.lengths.vertical, 0))}</td><td class="n">${m(input.cables.reduce((n, c) => n + c.lengths.descents, 0))}</td><td class="n"><b>${m(total)}</b></td></tr></tbody></table>`
    : `<h2>Étapes</h2><table><thead><tr><th>#</th><th>Étape</th><th class="n">Longueur</th></tr></thead><tbody>${steps(input.cables[0])}
       ${input.cables[0].lengths.descents ? `<tr><td></td><td>Descentes aux extrémités (faux plafond → équipement)</td><td class="n">${m(input.cables[0].lengths.descents)}</td></tr>` : ''}
       <tr><td></td><td>Marge de ${input.margin} %</td><td class="n">${m(input.cables[0].lengths.withMargin - input.cables[0].lengths.total)}</td></tr>
       <tr class="tot"><td></td><td>Longueur à prévoir</td><td class="n"><b>${m(input.cables[0].lengths.withMargin)}</b></td></tr></tbody></table>`;

  const warnings = [...new Set(input.cables.flatMap((c) => c.route.warnings))];
  const floorsPath = input.cables[0] ? (() => {
    const lv: string[] = [];
    for (const s of input.cables[0].route.steps) {
      const id = s.type === 'leg' ? s.leg.planId : s.rise.toPlan;
      const n = floorName(id);
      if (n && lv[lv.length - 1] !== n) lv.push(n);
    }
    return lv.join(' → ');
  })() : '';

  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiche de tracé ${esc(input.number)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font: 12px/1.4 "Segoe UI", Arial, sans-serif; color: #111; margin: 0 auto; max-width: 190mm; padding: 12px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; }
  h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 16px 0 6px; }
  .big { font-size: 26px; font-weight: 700; white-space: nowrap; } .muted { color: #555; }
  table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: #555; } .n { text-align: right; white-space: nowrap; }
  .tot td { border-top: 2px solid #111; font-weight: 600; }
  .info th { width: 28%; text-transform: none; font-size: 12px; color: #111; }
  .views { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .views.one { grid-template-columns: 1fr; }
  figure { margin: 0; border: 1px solid #ccc; page-break-inside: avoid; } figcaption { font-weight: 700; padding: 4px 6px; background: #f2f4f7; } figure img { width: 100%; display: block; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
  .warn { background: #fff4dc; border: 1px solid #e8c77a; padding: 6px 8px; margin-top: 8px; }
  .sign { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-top: 18px; } .sign div { border: 1px solid #999; height: 60px; padding: 4px 6px; color: #555; }
  footer { margin-top: 14px; font-size: 10.5px; color: #666; display: flex; justify-content: space-between; }
  .noprint { position: sticky; top: 0; background: #2b45c4; color: #fff; padding: 8px 12px; margin: -12px -12px 12px; display: flex; justify-content: space-between; align-items: center; }
  .noprint button { font: inherit; padding: 6px 12px; border: 0; border-radius: 6px; cursor: pointer; }
  @media print { .noprint { display: none; } body { padding: 0; } }
</style></head><body>
<div class="noprint"><span>Fiche prête : imprimez-la ou choisissez « Enregistrer au format PDF » comme imprimante.</span><button onclick="print()">Imprimer / PDF</button></div>
<header><div><h1>${group ? 'Tracé groupé' : 'Fiche de tracé'} n° ${esc(input.number)}</h1>
<div class="muted">${esc([input.site, input.building && `Bâtiment ${input.building}`].filter(Boolean).join(' · '))} · éditée le ${new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} par ${esc(input.user)}</div>
${input.name ? `<div><b>${esc(input.name)}</b>${input.ref ? ` · Chantier ${esc(input.ref)}` : ''}</div>` : ''}</div>
<div class="big">${m(total)}</div></header>
<table class="info">
<tr><th>Départ</th><td><b>${esc(input.from.label)}</b> — ${esc(input.from.floor)}, ${esc(input.from.planName)}</td></tr>
${group ? `<tr><th>Arrivées</th><td>${input.cables.length} équipements</td></tr>` : `<tr><th>Arrivée</th><td><b>${esc(input.cables[0].label)}</b> — ${esc(input.cables[0].floor)}, ${esc(input.cables[0].planName)}</td></tr>`}
<tr><th>Cheminement</th><td>${esc(input.options)}</td></tr>
${floorsPath.includes('→') ? `<tr><th>Étages</th><td>${esc(floorsPath)}</td></tr>` : ''}
</table>
${warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('')}
<h2>Vue de dessus</h2><div class="views ${used.length === 1 ? 'one' : ''}">${views}</div>
${body}
<div class="sign"><div>Observations</div><div>Visa</div></div>
<footer><span>Plan Relief ${esc(input.version)}</span><span>Longueurs calculées sur les plans : à confirmer sur place.</span></footer>
<script>window.addEventListener('load', () => setTimeout(() => print(), 300));</script>
</body></html>`);
  win.document.close();
}
