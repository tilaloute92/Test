import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import * as api from '../api';
import { hrefOf } from '../App';
import { buildingMembers, floorsCrossed, guessLevel, levelFromName, levelName, levelOf, loadBuilding, type CrossedFloor, type LoadedFloor } from '../lib/building';
import { computeRoute, RouteError, type PassageKind, type RouteResult } from '../lib/route';

const PASSAGE_KINDS: [PassageKind, string, string][] = [
  ['ascenseur', 'Monte-charges et ascenseurs', 'Le tracé monte ou descend par la cabine la plus proche, selon que l\'arrivée est au-dessus ou en dessous.'],
  ['gaine', 'Gaines et colonnes montantes', ''],
  ['escalier', 'Escaliers', ''],
  ['manuel', 'Passages nommés sur les plans', 'Équipements marqués « passage entre étages ».'],
];
const RISE_LABEL: Record<PassageKind, string> = { manuel: 'Passage', gaine: 'Gaine', escalier: 'Escalier', ascenseur: 'Monte-charge / ascenseur' };
import { PlanViewer } from '../lib/viewer';
import { DEFAULT_SETTINGS, KIND_LABELS, type Equipment, type PlanSummary, type SearchHit } from '../lib/types';
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
  // Changement d'étage par les monte-charges et ascenseurs (règle d'exploitation du site) ;
  // gaines, escaliers et passages nommés restent disponibles en option.
  const [kinds, setKinds] = useState<PassageKind[]>(['ascenseur']);
  const [height, setHeight] = useState<Height>('plafond');
  const [margin, setMargin] = useState(15);
  const [transparent, setTransparent] = useState(true);
  const [onlyRoute, setOnlyRoute] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ route: RouteResult; floors: LoadedFloor[]; height: Height } | null>(null);
  // Animation du trajet : arrêtée d'office si l'utilisateur a demandé moins d'animations.
  const [playing, setPlaying] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [follow, setFollow] = useState(false);
  const [curStep, setCurStep] = useState<number | null>(null);
  // Étages masqués dans la vue (identifiants de plan), pour ne garder que l'arrivée par exemple.
  const [hiddenFloors, setHiddenFloors] = useState<string[]>([]);
  const segStep = useRef<number[]>([]);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PlanViewer | null>(null);
  const autoRun = useRef(Boolean(de && a));
  const colors = useStageColors();

  useEffect(() => {
    if (!containerRef.current) return;
    const v = new PlanViewer(containerRef.current);
    viewerRef.current = v;
    v.onRouteProgress = (seg) => setCurStep(segStep.current[seg] ?? null);
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
      const route = await computeRoute(floors, pos(from), pos(to), { allowWalls, orthogonal, passageKinds: kinds }, setBusy);
      setResult({ route, floors, height });
      setHiddenFloors([]);
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
    // Étages du tracé : ceux des tronçons et ceux que traverse l'ascenseur entre les deux.
    const involved = new Set(floorsCrossed(route.steps, floors).flatMap((c) => (c.planId ? [c.planId] : [])));
    const shown = onlyRoute ? floors.filter((f) => involved.has(f.planId)) : floors;
    v.buildStack(shown.map((f) => ({
      input: { groups: f.drawing.groups, settings: { ...DEFAULT_SETTINGS, ...f.plan.settings }, factor: f.factor, center: [0, 0], showPlan: true },
      elevation: f.elevation, offset: f.offset, name: f.name, id: f.planId,
    })), colors.line, transparent);
    const byId = new Map(floors.map((f) => [f.planId, f]));
    const hRoute = (f: LoadedFloor) => (result.height === 'plafond' ? Math.max(0.3, (f.plan.settings.hWall ?? 2.5) - 0.15) : 0.15);
    const world = (f: LoadedFloor, x: number, y: number) => new THREE.Vector3(x + f.offset[0], f.elevation + hRoute(f), -(y + f.offset[1]));
    const pts: THREE.Vector3[] = [];
    const ptStep: number[] = [];
    route.steps.forEach((s, i) => {
      if (s.type !== 'leg') return;
      const f = byId.get(s.leg.planId)!;
      for (const [x, y] of s.leg.points) { pts.push(world(f, x, y)); ptStep.push(i); }
    });
    // Étape de chaque segment : celle du tronçon, ou la montée/descente entre deux tronçons.
    segStep.current = ptStep.slice(0, -1).map((st, i) => (ptStep[i + 1] === st ? st : st + 1));
    v.setRoute(pts);
    setCurStep(null);
    if (playingRef.current) v.playRoute();
    v.fit('3d');
  }, [result, transparent, onlyRoute, colors]);

  // Étages masqués et numéros d'étage incrustés (sans recadrer la vue).
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !result) return;
    const { floors, route } = result;
    v.setHiddenFloors(hiddenFloors);
    // Étages du tracé : ceux des tronçons et ceux que traverse l'ascenseur entre les deux.
    const involved = new Set(floorsCrossed(route.steps, floors).flatMap((c) => (c.planId ? [c.planId] : [])));
    const shown = onlyRoute ? floors.filter((f) => involved.has(f.planId)) : floors;
    const crossed = floorsCrossed(route.steps, floors);
    const onRoute = new Map(crossed.map((c, i) => [c.level, i === 0 ? 'start' : i === crossed.length - 1 ? 'end' : 'pass'] as const));
    const labels = new Map<number, Parameters<PlanViewer['setFloorLabels']>[0][number]>();
    for (const f of shown) labels.set(f.level, { text: levelName(f.level), elevation: f.elevation, state: onRoute.get(f.level) ?? 'other', slab: !hiddenFloors.includes(f.planId) });
    for (const c of crossed) if (!labels.has(c.level)) labels.set(c.level, { text: levelName(c.level), elevation: c.elevation, state: onRoute.get(c.level)!, slab: false });
    v.setFloorLabels([...labels.values()]);
  }, [result, transparent, onlyRoute, colors, hiddenFloors]);

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
  const levelOfPlan = (id: string) => result?.floors.find((f) => f.planId === id)?.level ?? 0;
  const crossed = result ? floorsCrossed(result.route.steps, result.floors) : [];
  // Étages présents dans la vue, du départ vers l'arrivée (puis les autres, de haut en bas).
  const legPlans = result ? result.route.steps.flatMap((st) => (st.type === 'leg' ? [st.leg.planId] : [])) : [];
  const firstPlan = legPlans[0], lastPlan = legPlans[legPlans.length - 1];
  const viewFloors = result
    ? (() => {
      const involved = new Set(crossed.flatMap((c) => (c.planId ? [c.planId] : [])));
      const inView = onlyRoute ? result.floors.filter((f) => involved.has(f.planId)) : result.floors;
      const order = new Map(crossed.map((c, i) => [c.planId, i]));
      return [...inView].sort((x, y) => (order.get(x.planId) ?? 1e9) - (order.get(y.planId) ?? 1e9) || y.level - x.level);
    })()
    : [];
  /** Étages parcourus par une montée ou une descente, dans le sens du tracé. */
  const riseFloors = (fromPlan: string, toPlan: string) => {
    const a = levelOfPlan(fromPlan), b = levelOfPlan(toPlan);
    const i = crossed.findIndex((c) => c.level === a), j = crossed.findIndex((c, k) => k > i && c.level === b);
    return i >= 0 && j > i ? crossed.slice(i, j + 1) : [];
  };
  const elevationOf = (id: string) => result?.floors.find((f) => f.planId === id)?.elevation ?? 0;

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
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <span>Changement d'étage par</span>
                {PASSAGE_KINDS.map(([k, label, hint]) => (
                  <label key={k} className="check" htmlFor={`trace-kind-${k}`} style={{ alignItems: 'flex-start' }}>
                    <input id={`trace-kind-${k}`} type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} />
                    <span>{label}{hint && <span className="muted small" style={{ display: 'block' }}>{hint}</span>}</span>
                  </label>
                ))}
              </fieldset>
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
                {crossed.length > 1 && (
                  <div className="floorpath-box">
                    <div className="muted small">Étages traversés, du départ à l'arrivée ({crossed.length})</div>
                    <FloorPath floors={crossed} ends />
                    {crossed.some((c) => !c.planId) && <div className="muted small">En pointillés : étage traversé dont le plan n'est pas dans l'application.</div>}
                  </div>
                )}
                {result.route.warnings.map((w) => <div key={w} className="notice warn small">{w}</div>)}
                <ol className="steps">
                  {result.route.steps.map((s, i) => (
                    <li key={i} className={curStep === i ? 'current' : undefined} aria-current={curStep === i ? 'step' : undefined}>
                      {s.type === 'leg' ? (
                        <>
                          <b>{floorName(s.leg.planId)}</b> — de « {s.leg.from} » à « {s.leg.to} » : <span className="num">{fmtNum(s.leg.length, 1)} m</span>
                          {s.leg.wallCrossings > 0 && <span className="tag" style={{ marginLeft: 6 }}>{s.leg.wallCrossings} mur{s.leg.wallCrossings > 1 ? 's' : ''} traversé{s.leg.wallCrossings > 1 ? 's' : ''}</span>}
                        </>
                      ) : (
                        <>
                          {elevationOf(s.rise.toPlan) >= elevationOf(s.rise.fromPlan) ? '↑ Montée' : '↓ Descente'} par <b>{s.rise.kind === 'manuel' ? `le passage ${s.rise.label}` : s.rise.label}</b> de {Math.abs(levelOfPlan(s.rise.toPlan) - levelOfPlan(s.rise.fromPlan))} étage{Math.abs(levelOfPlan(s.rise.toPlan) - levelOfPlan(s.rise.fromPlan)) > 1 ? 's' : ''} : <span className="num">{fmtNum(s.rise.length, 1)} m</span>
                          {s.rise.kind !== 'manuel' && <span className="tag" style={{ marginLeft: 6 }}>{RISE_LABEL[s.rise.kind].toLowerCase()}, relié automatiquement</span>}
                          <FloorPath floors={riseFloors(s.rise.fromPlan, s.rise.toPlan)} />
                          <div className="cell-sub">{floorName(s.rise.fromPlan)} → {floorName(s.rise.toPlan)}</div>
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
                <p style={{ margin: 0 }}>Tracé entre étages : chaque plan du bâtiment doit avoir le même site et le même bâtiment sur sa fiche, et un niveau (déduit de l'étage : RDC, R+1, SS1…). Le tracé change d'étage par les monte-charges et ascenseurs repérés sur les plans (bouton « Repérer escaliers, ascenseurs et gaines ») : chaque cabine est reliée automatiquement à celle qui se trouve au-dessus ou en dessous, et le tracé monte ou descend selon l'étage d'arrivée. Gaines, escaliers et passages nommés peuvent être autorisés dans les options.</p>
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
            {result && (
              <div className="seg" role="group" aria-label="Animation du trajet">
                <button type="button" aria-pressed={playing} onClick={() => { const v = viewerRef.current; if (!v) return; v.pauseRoute(playing); setPlaying(!playing); }}>{playing ? '⏸ Pause' : '▶ Animer le trajet'}</button>
                <button type="button" onClick={() => { viewerRef.current?.playRoute(); setPlaying(true); }}>↺ Rejouer</button>
                <label className="check" htmlFor="trace-follow"><input id="trace-follow" type="checkbox" checked={follow} onChange={(e) => { setFollow(e.target.checked); viewerRef.current?.setFollow(e.target.checked); }} /> Suivre la boule</label>
              </div>
            )}
            <div className="seg">
              <label className="check" htmlFor="trace-only"><input id="trace-only" type="checkbox" checked={onlyRoute} onChange={(e) => setOnlyRoute(e.target.checked)} /> Étages du tracé seulement</label>
              <label className="check" htmlFor="trace-ghost"><input id="trace-ghost" type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Murs transparents</label>
            </div>
          </div>
          {result && viewFloors.length > 1 && (
            <div className="floorpanel" role="group" aria-label="Étages affichés">
              <div className="floorpanel-h">Étages affichés</div>
              {viewFloors.map((f) => {
                const role = f.planId === firstPlan ? 'départ' : f.planId === lastPlan ? 'arrivée' : crossed.some((c) => c.planId === f.planId) ? 'traversé' : '';
                return (
                  <label key={f.planId} className="check" htmlFor={`floor-${f.planId}`} title={f.name}>
                    <input id={`floor-${f.planId}`} type="checkbox" checked={!hiddenFloors.includes(f.planId)} onChange={(e) => setHiddenFloors((h) => (e.target.checked ? h.filter((x) => x !== f.planId) : [...h, f.planId]))} />
                    <span className={`lvl${f.planId === firstPlan ? ' start' : f.planId === lastPlan ? ' end' : ''}`}>{levelName(f.level)}</span>
                    {role && <span className="muted small">{role}</span>}
                  </label>
                );
              })}
              <div className="floorpanel-b">
                <button type="button" className="btn sm" onClick={() => setHiddenFloors(viewFloors.filter((f) => f.planId !== lastPlan).map((f) => f.planId))}>Arrivée seule</button>
                <button type="button" className="btn sm" onClick={() => setHiddenFloors(viewFloors.filter((f) => f.planId !== lastPlan && f.planId !== firstPlan).map((f) => f.planId))}>Départ + arrivée</button>
                {hiddenFloors.length > 0 && <button type="button" className="btn sm ghost" onClick={() => setHiddenFloors([])}>Tout afficher</button>}
              </div>
            </div>
          )}
          {result && (
            <div className="stats">
              <span className="pill"><b>{result.floors.length}</b> étage{result.floors.length > 1 ? 's' : ''} dans le bâtiment</span>
              <span className="pill">Tracé <b>{fmtNum(total, 1)} m</b></span>
              {curStep !== null && result.route.steps[curStep] && (() => {
                const st = result.route.steps[curStep];
                return (
                  <span className="pill"><span className="dot" style={{ background: '#22c55e' }} />
                    {st.type === 'leg'
                      ? <>Étage <b>{levelName(levelOfPlan(st.leg.planId))}</b></>
                      : <>{levelOfPlan(st.rise.toPlan) >= levelOfPlan(st.rise.fromPlan) ? '↑' : '↓'} <b>{levelName(levelOfPlan(st.rise.fromPlan))} → {levelName(levelOfPlan(st.rise.toPlan))}</b></>}
                  </span>
                );
              })()}
              {crossed.length > 1 && <span className="pill">Étages <b>{crossed.map((c) => levelName(c.level)).join(' → ')}</b></span>}
            </div>
          )}
          {!result && !busy && <div className="busy" style={{ background: 'transparent' }}><span className="muted">Choisissez un départ et une arrivée, puis « Tracer ».</span></div>}
          {busy && <div className="busy">{busy}</div>}
        </section>
      </div>
    </div>
  );
}

/** Suite des numéros d'étage (R+3 → R+4 → R+5), départ en vert et arrivée en rouge si `ends`. */
function FloorPath({ floors, ends }: { floors: CrossedFloor[]; ends?: boolean }) {
  if (floors.length < 2) return null;
  return (
    <ol className="floorpath" aria-label={`Étages : ${floors.map((c) => levelName(c.level)).join(', ')}`}>
      {floors.map((c, i) => (
        <li key={`${c.level}-${i}`}>
          {i > 0 && <span className="arrow" aria-hidden="true">→</span>}
          <span
            className={`lvl${ends && i === 0 ? ' start' : ''}${ends && i === floors.length - 1 ? ' end' : ''}${c.planId ? '' : ' noplan'}`}
            title={c.name ?? "Étage traversé : pas de plan dans l'application"}
          >
            {levelName(c.level)}
          </span>
        </li>
      ))}
    </ol>
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
              <td><a href={hrefOf({ page: 'plan', id: f.planId })}>{f.name}</a>{f.plan.level == null && <div className="cell-sub">{guessLevel(f.plan.floor) != null ? `niveau déduit de « ${f.plan.floor} »` : levelFromName(f.plan.name) != null ? 'niveau déduit du nom du plan' : 'niveau inconnu : renseignez l’étage sur la fiche du plan'}</div>}</td>
              <td className="num">{levelOf(f.plan)}</td>
              <td className="num">{fmtNum(f.elevation, 1)} m</td>
              <td className="num">{f.passages.map((p) => p.label).join(', ') || '—'}{f.autos.length > 0 && <div className="cell-sub">{f.autos.length} escalier(s), ascenseur(s) ou gaine(s) repéré(s)</div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Choix d'un équipement : recherche dans toute la bibliothèque. */
/** Numéro d'étage d'un plan (R+3, RDC…), ou son champ étage tel quel s'il n'est pas reconnu. */
function floorTag(p: Pick<PlanSummary, 'level' | 'floor' | 'name'> | undefined) {
  if (!p) return '?';
  const l = p.level ?? guessLevel(p.floor) ?? levelFromName(p.name);
  return l == null ? (p.floor || '?') : levelName(l);
}

const LANDMARK_CATS = new Set(['ascenseur', 'escalier', 'gaine']);

/**
 * Résultats d'un sélecteur de départ ou d'arrivée : les escaliers, ascenseurs et gaines repérés
 * d'abord, puis le reste ; l'indication brute (« ASC » lu sur le plan) est retirée quand un
 * ascenseur repéré au même endroit la remplace. Regroupés par étage, du plus bas au plus haut.
 */
function arrangeHits(hits: api.SearchHitList, plans: PlanSummary[]) {
  const byPlan = new Map(plans.map((p) => [p.id, p]));
  const marks = hits.filter((h) => LANDMARK_CATS.has(h.equipment.category ?? ''));
  const kept = hits.filter((h) => !(h.equipment.kind === 'texte' && marks.some((m) => m.planId === h.planId
    && (m.equipment.indications ?? []).some((t) => t.toLowerCase() === (h.equipment.label || '').toLowerCase())
    && Math.hypot(m.equipment.x - h.equipment.x, m.equipment.y - h.equipment.y) < 0.5)));
  const level = (h: SearchHit) => { const p = byPlan.get(h.planId); return p ? levelOf(p) : 0; };
  const rank = (h: SearchHit) => (LANDMARK_CATS.has(h.equipment.category ?? '') ? 0 : h.equipment.kind === 'texte' ? 2 : 1);
  kept.sort((a, b) => level(a) - level(b) || a.planName.localeCompare(b.planName, 'fr') || rank(a) - rank(b)
    || (a.equipment.label || '').localeCompare(b.equipment.label || '', 'fr', { numeric: true }));
  const groups: { planId: string; plan?: PlanSummary; hits: SearchHit[] }[] = [];
  for (const h of kept) {
    const g = groups[groups.length - 1];
    if (g && g.planId === h.planId) g.hits.push(h);
    else groups.push({ planId: h.planId, plan: byPlan.get(h.planId), hits: [h] });
  }
  return groups;
}

function EndpointPicker({ id, value, onChange }: { id: string; value: Resolved | null; onChange: (r: Resolved | null) => void }) {
  const [q, setQ] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [hits, setHits] = useState<api.SearchHitList>([]);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  useEffect(() => { api.listPlans().then(setPlans).catch(() => {}); }, []);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = window.setTimeout(() => {
      api.searchEquipment({ q: q.trim(), plan: planFilter, limit: '80' }).then((r) => setHits(r.results)).catch(() => setHits([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, planFilter]);
  const groups = useMemo(() => arrangeHits(hits, plans), [hits, plans]);
  const sortedPlans = useMemo(() => [...plans].sort((a, b) => (a.site || '').localeCompare(b.site || '', 'fr') || (a.building || '').localeCompare(b.building || '', 'fr') || levelOf(a) - levelOf(b)), [plans]);

  if (value) {
    return (
      <div className="detail">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <h4><span className="lvl">{floorTag(value.plan)}</span> {value.label}</h4>
            <div className="muted small">{[value.type !== value.label ? value.type : '', value.plan.name].filter(Boolean).join(' · ')}</div>
            <a className="small" href={hrefOf({ page: 'plan', id: value.planId, eq: value.eqId })} target="_blank" rel="noopener">Voir sur le plan ↗</a>
          </div>
          <button type="button" className="btn sm" onClick={() => onChange(null)}>Changer</button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select id={`pick-${id}-plan`} className="select" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} aria-label="Étage">
        <option value="">Tous les étages</option>
        {sortedPlans.map((p) => <option key={p.id} value={p.id}>{floorTag(p)} — {p.name}{p.building ? ` (bât. ${p.building})` : ''}</option>)}
      </select>
      <input id={`pick-${id}`} className="input" type="search" placeholder="Repère, type, indication… (ex. ascenseur, MC)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chercher un équipement" />
      {groups.length > 0 && (
        <div className="layers pickgroups">
          {groups.map((g) => (
            <div key={g.planId} role="group" aria-label={`${floorTag(g.plan)} — ${g.plan?.name ?? g.hits[0].planName}`}>
              <div className="pickgroup-h"><span className="lvl">{floorTag(g.plan)}</span> <span className="muted">{g.plan?.name ?? g.hits[0].planName}</span></div>
              {g.hits.map((h) => (
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
                    <span className="s">{[h.equipment.type !== h.equipment.label ? h.equipment.type : '', KIND_LABELS[h.equipment.kind], ...(h.equipment.indications ?? []).slice(0, 2)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="lvl" title={h.planName}>{floorTag(g.plan)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {q.trim() && hits.length >= 80 && <div className="muted small">Plus de 80 résultats : précisez la recherche ou choisissez un étage.</div>}
    </div>
  );
}
