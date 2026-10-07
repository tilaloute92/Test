import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import * as api from '../api';
import { hrefOf } from '../App';
import { buildingMembers, levelOf, loadBuilding, type LoadedFloor } from '../lib/building';
import { computeRoute, RouteError, type RouteResult } from '../lib/route';
import { PlanViewer } from '../lib/viewer';
import { DEFAULT_SETTINGS, KIND_LABELS, type Equipment, type PlanSummary } from '../lib/types';
import { fmtNum, Highlight, NavHint } from './ui';
import { decodeEndpoint, encodeEndpoint, writeDraft, type EndpointRef } from '../lib/traceLink';

interface Resolved extends EndpointRef { label: string; type: string; plan: PlanSummary; eq: Equipment }

type Height = 'plafond' | 'sol';

function useStageColors() {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    return { stage: cs.getPropertyValue('--stage').trim() || '#dde2e7', line: cs.getPropertyValue('--line').trim() || '#d3d9df' };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    const u = () => setC(read());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', u);
    const mo = new MutationObserver(u);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener('change', u); mo.disconnect(); };
  }, []);
  return c;
}

export function RouteView({ de, a }: { de?: string; a?: string }) {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [from, setFrom] = useState<Resolved | null>(null);
  const [to, setTo] = useState<Resolved | null>(null);
  const [allowWalls, setAllowWalls] = useState(false);
  const [orthogonal, setOrthogonal] = useState(true);
  const [height, setHeight] = useState<Height>('plafond');
  const [margin, setMargin] = useState(15);
  const [transparent, setTransparent] = useState(true);
  const [onlyRoute, setOnlyRoute] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ route: RouteResult; floors: LoadedFloor[]; height: Height } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PlanViewer | null>(null);
  const autoRun = useRef(Boolean(de && a));
  const colors = useStageColors();

  useEffect(() => {
    if (!containerRef.current) return;
    const v = new PlanViewer(containerRef.current);
    viewerRef.current = v;
    return () => { v.dispose(); viewerRef.current = null; };
  }, []);

  // Extrémités venues de l'adresse (lien partagé, ou boutons d'un plan).
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await api.listPlans().catch(() => []);
      if (!alive) return;
      setPlans(list);
      const resolve = async (ref: EndpointRef | null): Promise<Resolved | null> => {
        if (!ref) return null;
        const summary = list.find((p) => p.id === ref.planId);
        if (!summary) return null;
        const plan = await api.getPlan(ref.planId).catch(() => null);
        const eq = plan?.equipment.find((e) => e.id === ref.eqId);
        return eq ? { ...ref, label: eq.label || eq.type, type: eq.type, plan: summary, eq } : null;
      };
      const [f, t] = await Promise.all([resolve(decodeEndpoint(de)), resolve(decodeEndpoint(a))]);
      if (!alive) return;
      setFrom(f);
      setTo(t);
    })();
    return () => { alive = false; };
  }, [de, a]);

  useEffect(() => {
    const d = { de: from ? encodeEndpoint(from) : undefined, a: to ? encodeEndpoint(to) : undefined };
    writeDraft(d);
    window.history.replaceState(null, '', hrefOf({ page: 'trace', ...d }));
  }, [from, to]);

  const sameBuilding = useMemo(() => {
    if (!from || !to) return true;
    return buildingMembers(from.plan, plans).some((p) => p.id === to.planId);
  }, [from, to, plans]);

  const run = async () => {
    if (!from || !to) return;
    setError('');
    setResult(null);
    viewerRef.current?.setRoute(null);
    if (!sameBuilding) {
      setError("Le départ et l'arrivée ne sont pas dans le même bâtiment. Un bâtiment regroupe les plans qui ont le même site et le même bâtiment sur leur fiche.");
      return;
    }
    try {
      setBusy('Chargement des étages…');
      const all = await api.listPlans();
      const floors = await loadBuilding(buildingMembers(from.plan, all), setBusy);
      const pos = (r: Resolved) => {
        const f = floors.find((x) => x.planId === r.planId)!;
        const eq = f.plan.equipment.find((e) => e.id === r.eqId) ?? r.eq;
        return { planId: r.planId, x: eq.x * f.factor, y: eq.y * f.factor, label: r.label };
      };
      const route = await computeRoute(floors, pos(from), pos(to), { allowWalls, orthogonal }, setBusy);
      setResult({ route, floors, height });
    } catch (err) {
      setError(err instanceof RouteError ? err.message : `Calcul impossible : ${(err as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    if (autoRun.current && from && to) { autoRun.current = false; run(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  // Affichage : étages empilés + tracé.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.setBackground(colors.stage);
    if (!result) return;
    const { floors, route } = result;
    const involved = new Set(route.steps.flatMap((s) => (s.type === 'leg' ? [s.leg.planId] : [s.rise.fromPlan, s.rise.toPlan])));
    const shown = onlyRoute ? floors.filter((f) => involved.has(f.planId)) : floors;
    v.buildStack(shown.map((f) => ({
      input: { groups: f.drawing.groups, settings: { ...DEFAULT_SETTINGS, ...f.plan.settings }, factor: f.factor, center: [0, 0], showPlan: true },
      elevation: f.elevation, offset: f.offset, name: f.name,
    })), colors.line, transparent);
    const byId = new Map(floors.map((f) => [f.planId, f]));
    const hRoute = (f: LoadedFloor) => (result.height === 'plafond' ? Math.max(0.3, (f.plan.settings.hWall ?? 2.5) - 0.15) : 0.15);
    const world = (f: LoadedFloor, x: number, y: number) => new THREE.Vector3(x + f.offset[0], f.elevation + hRoute(f), -(y + f.offset[1]));
    const pts: THREE.Vector3[] = [];
    for (const s of route.steps) {
      if (s.type !== 'leg') continue;
      const f = byId.get(s.leg.planId)!;
      for (const [x, y] of s.leg.points) pts.push(world(f, x, y));
    }
    v.setRoute(pts);
    v.fit('3d');
  }, [result, transparent, onlyRoute, colors]);

  const descents = result && result.height === 'plafond'
    ? (() => {
      const byId = new Map(result.floors.map((f) => [f.planId, f]));
      const legs = result.route.steps.filter((s) => s.type === 'leg');
      const first = legs[0]?.type === 'leg' ? byId.get(legs[0].leg.planId) : undefined;
      const last = legs[legs.length - 1]?.type === 'leg' ? byId.get((legs[legs.length - 1] as { leg: { planId: string } }).leg.planId) : undefined;
      // Du faux plafond jusqu'à un équipement posé vers 1 m du sol, à chaque extrémité.
      const d = (f?: LoadedFloor) => (f ? Math.max(0, (f.plan.settings.hWall ?? 2.5) - 0.15 - 1) : 0);
      return d(first) + d(last);
    })()
    : 0;
  const total = result ? result.route.total + descents : 0;
  const floorName = (id: string) => result?.floors.find((f) => f.planId === id)?.name ?? '';

  return (
    <div className="planview">
      <div className="planhead">
        <h1>Tracé entre deux équipements</h1>
        <span className="muted small">Chemin le plus court par les ouvertures, d'un étage à l'autre par les passages verticaux (gaines, colonnes, escaliers).</span>
      </div>
      <div className="planbody">
        <aside className="side" aria-label="Paramètres du tracé">
          <div className="side-scroll">
            <div className="sec">
              <h3><span className="dot" style={{ background: '#2e9e5b' }} /> Départ</h3>
              <EndpointPicker id="de" value={from} onChange={setFrom} />
            </div>
            <div className="sec">
              <h3><span className="dot" style={{ background: '#d23c32' }} /> Arrivée</h3>
              <EndpointPicker id="a" value={to} onChange={setTo} />
              {from && to && (
                <button type="button" className="btn ghost sm" onClick={() => { setFrom(to); setTo(from); }}>Inverser départ et arrivée</button>
              )}
            </div>
            <div className="sec">
              <h3>Options</h3>
              <label className="field">
                <span>Cheminement</span>
                <select id="trace-height" className="select" value={height} onChange={(e) => setHeight(e.target.value as Height)}>
                  <option value="plafond">En faux plafond (descentes comptées aux extrémités)</option>
                  <option value="sol">Au sol / en plinthe</option>
                </select>
              </label>
              <label className="field">
                <span>Marge de longueur</span>
                <span className="inputwrap"><input id="trace-margin" type="number" min="0" max="100" step="5" value={margin} onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))} /><span className="unit">%</span></span>
              </label>
              <label className="check" htmlFor="trace-ortho" style={{ alignItems: 'flex-start' }}>
                <input id="trace-ortho" type="checkbox" checked={orthogonal} onChange={(e) => setOrthogonal(e.target.checked)} />
                <span>Angles droits<span className="muted small" style={{ display: 'block' }}>Le tracé suit les axes du bâtiment avec le moins de coudes possible, comme un chemin de câbles. Décoché : le plus court en lignes droites.</span></span>
              </label>
              <label className="check" htmlFor="trace-walls" style={{ alignItems: 'flex-start' }}>
                <input id="trace-walls" type="checkbox" checked={allowWalls} onChange={(e) => setAllowWalls(e.target.checked)} />
                <span>Autoriser la traversée des murs (carottage)<span className="muted small" style={{ display: 'block' }}>Sinon le tracé passe par les portes, et ne traverse un mur qu'en dernier recours, avec un avertissement.</span></span>
              </label>
              {!sameBuilding && <div className="notice warn small">Départ et arrivée dans deux bâtiments différents : un tracé reste à l'intérieur d'un bâtiment (même site et même bâtiment sur la fiche des plans).</div>}
              <button type="button" className="btn primary" disabled={!from || !to || !!busy} onClick={run}>{busy ? 'Calcul en cours…' : 'Tracer'}</button>
            </div>

            {error && <div className="sec"><div className="notice error" role="alert">{error}</div></div>}

            {result && (
              <div className="sec" role="status">
                <h3>Résultat</h3>
                <div className="detail">
                  <div className="muted small">Longueur à prévoir, marge de {margin} % comprise</div>
                  <div style={{ font: '700 28px/1.1 var(--font-display)' }} className="num">{fmtNum(total * (1 + margin / 100), 1)} m</div>
                  <dl className="kv num">
                    <dt>Horizontal</dt><dd>{fmtNum(result.route.horizontal, 1)} m</dd>
                    {result.route.vertical > 0 && <><dt>Entre étages</dt><dd>{fmtNum(result.route.vertical, 1)} m</dd></>}
                    {descents > 0 && <><dt>Descentes</dt><dd>{fmtNum(descents, 1)} m (faux plafond → équipement, aux deux bouts)</dd></>}
                    <dt>Tracé</dt><dd>{fmtNum(total, 1)} m</dd>
                  </dl>
                </div>
                {result.route.warnings.map((w) => <div key={w} className="notice warn small">{w}</div>)}
                <ol className="steps">
                  {result.route.steps.map((s, i) => (
                    <li key={i}>
                      {s.type === 'leg' ? (
                        <>
                          <b>{floorName(s.leg.planId)}</b> — de « {s.leg.from} » à « {s.leg.to} » : <span className="num">{fmtNum(s.leg.length, 1)} m</span>
                          {s.leg.wallCrossings > 0 && <span className="tag" style={{ marginLeft: 6 }}>{s.leg.wallCrossings} mur{s.leg.wallCrossings > 1 ? 's' : ''} traversé{s.leg.wallCrossings > 1 ? 's' : ''}</span>}
                        </>
                      ) : (
                        <>
                          <b>Passage {s.rise.label}</b> — {floorName(s.rise.fromPlan)} → {floorName(s.rise.toPlan)} : <span className="num">{fmtNum(s.rise.length, 1)} m</span>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
                <FloorsNote floors={result.floors} />
              </div>
            )}
            {!result && !error && (
              <div className="sec muted small">
                <p style={{ margin: 0 }}>Pour un tracé entre étages, chaque plan du bâtiment doit avoir le même site et le même bâtiment sur sa fiche, un niveau (déduit de l'étage : RDC, R+1, SS1…), et les gaines ou escaliers doivent être marqués « passage entre étages » avec le même nom sur chaque plan.</p>
              </div>
            )}
          </div>
        </aside>
        <section className="stage" aria-label="Vue 3D du bâtiment">
          <div className="viewport" ref={containerRef} />
          <NavHint />
          <div className="tools">
            <div className="seg" role="group" aria-label="Point de vue">
              <button type="button" onClick={() => viewerRef.current?.fit('3d')}>3D</button>
              <button type="button" onClick={() => viewerRef.current?.fit('top')}>Dessus</button>
            </div>
            <div className="seg">
              <label className="check" htmlFor="trace-only"><input id="trace-only" type="checkbox" checked={onlyRoute} onChange={(e) => setOnlyRoute(e.target.checked)} /> Étages du tracé seulement</label>
              <label className="check" htmlFor="trace-ghost"><input id="trace-ghost" type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Murs transparents</label>
            </div>
          </div>
          {result && (
            <div className="stats">
              <span className="pill"><b>{result.floors.length}</b> étage{result.floors.length > 1 ? 's' : ''} dans le bâtiment</span>
              <span className="pill">Tracé <b>{fmtNum(total, 1)} m</b></span>
            </div>
          )}
          {!result && !busy && <div className="busy" style={{ background: 'transparent' }}><span className="muted">Choisissez un départ et une arrivée, puis « Tracer ».</span></div>}
          {busy && <div className="busy">{busy}</div>}
        </section>
      </div>
    </div>
  );
}

function FloorsNote({ floors }: { floors: LoadedFloor[] }) {
  return (
    <details>
      <summary className="small muted">Étages du bâtiment ({floors.length})</summary>
      <table className="data small" style={{ marginTop: 6 }}>
        <thead><tr><th>Plan</th><th className="num">Niveau</th><th className="num">Altitude</th><th className="num">Passages</th></tr></thead>
        <tbody>
          {floors.map((f) => (
            <tr key={f.planId}>
              <td><a href={hrefOf({ page: 'plan', id: f.planId })}>{f.name}</a>{f.plan.level == null && <div className="cell-sub">niveau déduit de « {f.plan.floor || '—'} »</div>}</td>
              <td className="num">{levelOf(f.plan)}</td>
              <td className="num">{fmtNum(f.elevation, 1)} m</td>
              <td className="num">{f.passages.map((p) => p.label).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Choix d'un équipement : recherche dans toute la bibliothèque. */
function EndpointPicker({ id, value, onChange }: { id: string; value: Resolved | null; onChange: (r: Resolved | null) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<api.SearchHitList>([]);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  useEffect(() => { api.listPlans().then(setPlans).catch(() => {}); }, []);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = window.setTimeout(() => {
      api.searchEquipment({ q: q.trim() }).then((r) => setHits(r.results.slice(0, 12))).catch(() => setHits([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="detail">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <h4>{value.label}</h4>
            <div className="muted small">{[value.type !== value.label ? value.type : '', value.plan.name, value.plan.floor].filter(Boolean).join(' · ')}</div>
          </div>
          <button type="button" className="btn sm" onClick={() => onChange(null)}>Changer</button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input id={`pick-${id}`} className="input" type="search" placeholder="Repère, type, indication…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chercher un équipement" />
      {hits.length > 0 && (
        <div className="layers">
          {hits.map((h) => (
            <button
              key={`${h.planId}:${h.equipment.id}`}
              type="button"
              className="eqrow"
              onClick={() => {
                const plan = plans.find((p) => p.id === h.planId);
                if (plan) onChange({ planId: h.planId, eqId: h.equipment.id, label: h.equipment.label || h.equipment.type, type: h.equipment.type, plan, eq: h.equipment });
                setQ('');
              }}
            >
              <span className={`dot kind-${h.equipment.kind}`} />
              <span className="l">
                <span className="t"><Highlight text={h.equipment.label || h.equipment.type} query={q} /></span>
                <span className="s">{[KIND_LABELS[h.equipment.kind], h.planName, h.floor].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
