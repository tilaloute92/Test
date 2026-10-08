import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { hrefOf, navigate } from '../App';
import { detectLandmarks, drawingCenter, drawingFactor, mergeExtracted, newId, readDrawing, roleOf, withIndications } from '../lib/drawing';
import { reanalysePlan } from '../lib/reanalyse';
import { DEFAULT_FLOOR_HEIGHT, guessLevel, suggestPassage } from '../lib/building';
import { encodeEndpoint, readDraft } from '../lib/traceLink';
import { PlanViewer, type BuildStats } from '../lib/viewer';
import { CATEGORIES, DEFAULT_SETTINGS, KIND_LABELS, ROLE_LABELS, UNIT_NAMES, categoryOf, cssColor, type Category, type Drawing, type Equipment, type EquipmentKind, type PlanRecord, type PlanSettings, type Role, type Unit } from '../lib/types';
import { Highlight, Modal, downloadBlob, fmtDate, fmtNum, useConfirm, useToast, NavHint } from './ui';

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_./\\#]+/g, '');
const eqHay = (e: Equipment) => {
  const h = norm([e.label, e.type, e.layer, e.notes, categoryOf(e.category)?.label ?? '', ...(e.indications ?? []), ...(e.attributes ? Object.entries(e.attributes).flat() : [])].join(' '));
  // Même tolérance que le serveur aux espaces parasites de l'OCR (« CAM-0 7 »).
  return `${h} ${h.replace(/\s+/g, '')}`;
};
const MAX_ROWS = 400;

/** Pastille de couleur : catégorie de l'équipement, à défaut son origine. */
const EqDot = ({ e }: { e: Equipment }) => {
  const c = categoryOf(e.category);
  return c ? <span className="dot" style={{ background: cssColor(c.color) }} /> : <span className={`dot kind-${e.kind}`} />;
};

/** Repère suivant d'une catégorie sur ce plan : WIFI-01, WIFI-02… (après le plus grand numéro existant). */
function nextLabel(list: Equipment[], cat: Category): string {
  const prefix = categoryOf(cat)?.prefix ?? 'EQ';
  const re = new RegExp(`^${prefix}[-_ ]?(\\d+)$`, 'i');
  let max = 0;
  for (const e of list) { const m = re.exec(e.label.trim()); if (m) max = Math.max(max, Number(m[1])); }
  return `${prefix}-${String(max + 1).padStart(2, '0')}`;
}

/** Couleurs du thème lues dans les variables CSS, relues quand le thème change. */
function useStageColors() {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    return { stage: cs.getPropertyValue('--stage').trim() || '#dde2e7', line: cs.getPropertyValue('--line').trim() || '#d3d9df' };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const update = () => setColors(read());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener('change', update); mo.disconnect(); };
  }, []);
  return colors;
}

export function PlanView({ id, focusEq }: { id: string; focusEq?: string }) {
  const [plan, setPlan] = useState<PlanRecord | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [settings, setSettings] = useState<PlanSettings>(DEFAULT_SETTINGS);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState('Chargement du plan…');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'eq' | 'model'>('eq');
  const [selected, setSelected] = useState<string | null>(focusEq ?? null);
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<Record<EquipmentKind, boolean>>({ bloc: true, texte: true, manuel: true });
  const [showPlan, setShowPlan] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [placeCat, setPlaceCat] = useState<Category>('autre');
  const [hiddenCats, setHiddenCats] = useState<string[]>([]);
  const [draft, setDraft] = useState<Equipment | null>(null);
  const [editMeta, setEditMeta] = useState(false);
  const [stats, setStats] = useState<BuildStats | null>(null);
  const [labelPos, setLabelPos] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [rereadOpen, setRereadOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PlanViewer | null>(null);
  const bufRef = useRef<ArrayBuffer | null>(null);
  const focusRef = useRef<string | null>(focusEq ?? null);
  const colors = useStageColors();
  const confirm = useConfirm();
  const toast = useToast();

  // --- Chargement : fiche + fichier d'origine, puis lecture dans le navigateur -----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, buf] = await Promise.all([api.getPlan(id), api.fetchPlanFile(id)]);
        if (!alive) return;
        setLoading('Lecture du plan…');
        const d = await readDrawing(buf, p.file.format, p.settings.pdfPage);
        if (!alive) return;
        bufRef.current = buf;
        setPlan(p);
        setSettings({ ...DEFAULT_SETTINGS, ...p.settings });
        setDrawing(d);
        setLoading('');
      } catch (err) {
        if (alive) { setError((err as Error).message); setLoading(''); }
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // --- Scène 3D --------------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const v = new PlanViewer(containerRef.current);
    viewerRef.current = v;
    v.onLabelMove = setLabelPos;
    return () => { v.dispose(); viewerRef.current = null; };
  }, []);

  const select = useCallback((eqId: string | null) => {
    setSelected(eqId);
    // Met à jour l'adresse sans recharger : le lien copié mène directement à l'équipement.
    window.history.replaceState(null, '', hrefOf({ page: 'plan', id, eq: eqId ?? undefined }));
  }, [id]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.onPick = (eqId) => { select(eqId); if (eqId) setTab('eq'); };
  }, [select]);

  const geometry = useMemo(() => {
    if (!drawing) return null;
    return { factor: drawingFactor(drawing.format, settings), center: drawingCenter(drawing.groups) };
  }, [drawing, settings]);

  const fittedRef = useRef(false);
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !drawing || !geometry) return;
    const t = window.setTimeout(() => {
      v.setBackground(colors.stage);
      setStats(v.build({ groups: drawing.groups, settings, factor: geometry.factor, center: geometry.center, showPlan }, colors.line));
      if (!fittedRef.current) { v.fit('3d'); fittedRef.current = true; }
    }, 80);
    return () => window.clearTimeout(t);
  }, [drawing, settings, geometry, showPlan, colors]);

  const equipment = useMemo(() => plan?.equipment ?? [], [plan]);
  const filtered = useMemo(() => {
    const terms = norm(query).split(/\s+/).filter(Boolean);
    return equipment.filter((e) => kinds[e.kind] && !hiddenCats.includes(e.category ?? '') && (!terms.length || terms.every((t) => eqHay(e).includes(t))));
  }, [equipment, query, kinds, hiddenCats]);
  const presentCats = useMemo(() => CATEGORIES.filter((c) => equipment.some((e) => e.category === c.id)), [equipment]);

  useEffect(() => {
    viewerRef.current?.setMarkers(filtered, showMarkers);
    viewerRef.current?.setLandmarks(filtered.filter((e) => e.footprint), showMarkers);
  }, [filtered, showMarkers, stats]);

  const selectedEq = equipment.find((e) => e.id === selected) ?? null;
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !stats) return;
    const focus = focusRef.current !== null && selectedEq?.id === focusRef.current;
    v.select(selectedEq, focus);
    if (focus) focusRef.current = null;
  }, [selectedEq, stats]);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    v.setPlacing(placing);
    v.onPlace = placing ? (x, y) => {
      setPlacing(false);
      const cat = categoryOf(placeCat);
      setDraft({ id: newId(), kind: 'manuel', label: nextLabel(equipment, placeCat), type: cat && cat.id !== 'autre' ? cat.label : '', category: placeCat, layer: '', x, y });
    } : null;
  }, [placing, placeCat, equipment]);
  const startPlacing = (cat: Category) => { setPlaceCat(cat); setPlacing(true); select(null); };

  const focusOn = (e: Equipment) => {
    select(e.id);
    viewerRef.current?.select(e, true);
  };

  // --- Enregistrements -------------------------------------------------------------------
  const save = async (patch: Partial<PlanRecord>, okMessage: string): Promise<boolean> => {
    if (!plan) return false;
    setSaving(true);
    try {
      const next = await api.updatePlan(plan.id, { ...patch, version: plan.version });
      setPlan(next);
      toast(okMessage);
      return true;
    } catch (err) {
      const e = err as api.ApiError;
      if (e.status === 409 && e.body.current) {
        const cur = e.body.current as PlanRecord;
        setPlan(cur);
        setSettings({ ...DEFAULT_SETTINGS, ...cur.settings });
        setDirty(false);
      }
      toast(e.message, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveEquipment = (list: Equipment[], msg: string) => save({ equipment: list }, msg);

  const changeSetting = <K extends keyof PlanSettings>(key: K, value: PlanSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setDirty(true);
  };
  const setRole = (groupId: string, role: Role) => {
    setSettings((s) => ({ ...s, roles: { ...s.roles, [groupId]: role } }));
    setDirty(true);
  };

  const changePage = async (page: number) => {
    if (!plan || !bufRef.current) return;
    const ok = await confirm({
      title: 'Changer de page',
      message: <p>Les équipements détectés sur la page {settings.pdfPage} seront remplacés par ceux de la page {page}. Les équipements ajoutés à la main sont conservés.</p>,
      confirmLabel: 'Changer de page',
    });
    if (!ok) return;
    setLoading('Lecture de la page…');
    try {
      const d = await readDrawing(bufRef.current, 'pdf', page);
      const nextSettings = { ...settings, pdfPage: page };
      const found = detectLandmarks(mergeExtracted(plan.equipment, d.equipment), d.groups, 'pdf', nextSettings);
      if (await save({ settings: nextSettings, equipment: withIndications(found.list, 'pdf', nextSettings) }, `Page ${page} enregistrée.`)) {
        setDrawing(d);
        setSettings(nextSettings);
        setDirty(false);
        select(null);
      }
    } catch (err) {
      toast(`Lecture de la page impossible : ${(err as Error).message}`, 'error');
    } finally {
      setLoading('');
    }
  };

  const removeEq = async (e: Equipment) => {
    const ok = await confirm({ title: 'Supprimer cet équipement', message: <p>« {e.label || e.type} » ne sera plus proposé dans les recherches.</p>, confirmLabel: 'Supprimer', danger: true });
    if (ok && plan && await saveEquipment(withIndications(plan.equipment.filter((x) => x.id !== e.id), plan.file.format, settings), 'Équipement supprimé.')) select(null);
  };

  /**
   * Relit le fichier d'origine : nouvelles règles de lecture des indications pour un plan
   * mis en stock avant elles, ou lecture OCR demandée après coup.
   */
  const reread = async (withOcr: boolean, vertical = false) => {
    if (!plan || !bufRef.current) return;
    setRereadOpen(false);
    try {
      setLoading('Relecture du plan…');
      const res = await reanalysePlan({ ...plan, settings }, bufRef.current, { ocr: withOcr, vertical }, (step) => setLoading(`${step}…`));
      if (await saveEquipment(res.list, `Plan relu : ${res.list.length.toLocaleString('fr-FR')} éléments recherchables, dont ${res.texts.toLocaleString('fr-FR')} indications.`)) select(null);
    } catch (err) {
      toast(`Relecture impossible : ${(err as Error).message}`, 'error');
    } finally {
      setLoading('');
    }
  };


  /** Repérage seul, sur les textes déjà connus du plan (y compris ceux lus par OCR). */
  const findLandmarks = async () => {
    if (!plan || !drawing) return;
    const found = detectLandmarks(plan.equipment, drawing.groups, plan.file.format, settings);
    const msg = found.stairs + found.lifts + found.risers
      ? `${found.stairs} escalier(s), ${found.lifts} ascenseur(s) et ${found.risers} gaine(s) repérés : ils servent aussi de passages entre étages pour les tracés.`
      : plan.file.format === 'pdf' && !plan.equipment.some((e) => e.kind === 'texte')
        ? 'Aucun escalier ni ascenseur repéré. Les ascenseurs se reconnaissent à leur texte (ASC, MC…) : lancez d\'abord « Relire les indications du plan » avec la lecture OCR.'
        : 'Aucun escalier ni ascenseur repéré sur ce plan. Vous pouvez les ajouter à la main (catégories Escalier et Ascenseur).';
    if (await saveEquipment(withIndications(found.list, plan.file.format, settings), msg)) {
      if (found.stairs + found.lifts + found.risers) setHiddenCats([]);
    }
  };

  const saveDraft = async (e: Equipment, again = false) => {
    if (!plan) return;
    const exists = plan.equipment.some((x) => x.id === e.id);
    // Un équipement ajouté à la main récupère lui aussi les indications écrites à côté de lui.
    const list = withIndications(exists ? plan.equipment.map((x) => (x.id === e.id ? e : x)) : [...plan.equipment, e], plan.file.format, settings);
    if (await saveEquipment(list, exists ? 'Équipement modifié.' : `« ${e.label} » ajouté au plan.`)) {
      setDraft(null);
      // Pose en série : on enchaîne sur le suivant de la même catégorie.
      if (again && !exists) startPlacing(e.category ?? 'autre');
      else select(e.id);
    }
  };

  const deletePlan = async () => {
    if (!plan) return;
    const ok = await confirm({
      title: 'Retirer ce plan du stock',
      message: <><p>« {plan.name} » et ses {plan.equipment.length.toLocaleString('fr-FR')} équipements disparaîtront de la bibliothèque et des recherches.</p><p className="muted small">Le plan est déplacé dans la corbeille du serveur : un administrateur peut le récupérer.</p></>,
      confirmLabel: 'Retirer du stock',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePlan(plan.id);
      toast(`« ${plan.name} » retiré du stock.`);
      navigate({ page: 'plans' });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const doExport = async (fmt: 'glb' | 'obj' | 'stl') => {
    const v = viewerRef.current;
    if (!v || !plan) return;
    try {
      downloadBlob(await v.export(fmt), `${plan.name.replace(/[\\/:*?"<>|]+/g, '_')}-3d.${fmt}`);
    } catch (err) {
      toast(`Export ${fmt.toUpperCase()} impossible : ${(err as Error).message}`, 'error');
    }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast('Lien copié.'); }
    catch { toast('Copie impossible : copiez l’adresse depuis la barre du navigateur.', 'warn'); }
  };

  if (error) {
    return (
      <div className="page">
        <div className="notice error"><p><strong>Impossible d'ouvrir ce plan.</strong></p><p>{error}</p></div>
        <div><a className="btn" href={hrefOf({ page: 'plans' })}>Retour aux plans</a></div>
      </div>
    );
  }

  const types = [...new Set(equipment.map((e) => e.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')).slice(0, 300);

  return (
    <div className="planview">
      <div className="planhead">
        <a className="btn ghost sm" href={hrefOf({ page: 'plans' })}>← Plans</a>
        <h1>{plan?.name ?? 'Plan'}</h1>
        {plan && (
          <div className="meta">
            {plan.site && <span className="chip">{plan.site}</span>}
            {plan.building && <span className="chip">Bât. {plan.building}</span>}
            {plan.floor && <span className="chip">{plan.floor}</span>}
            <span className="chip"><span className="tag">{plan.file.format}</span> {plan.file.name}</span>
          </div>
        )}
        {plan && (
          <div className="actions">
            <button type="button" className="btn sm" onClick={() => setEditMeta(true)}>Modifier la fiche</button>
            <button type="button" className="btn sm" onClick={() => bufRef.current && downloadBlob(new Blob([bufRef.current]), plan.file.name)}>Télécharger l'original</button>
            <button type="button" className="btn sm danger" onClick={deletePlan}>Retirer du stock</button>
          </div>
        )}
      </div>

      <div className="planbody">
        <aside className="side" aria-label="Équipements et réglages">
          <div className="side-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'eq'} onClick={() => setTab('eq')}>Équipements {plan ? `(${equipment.length.toLocaleString('fr-FR')})` : ''}</button>
            <button type="button" role="tab" aria-selected={tab === 'model'} onClick={() => setTab('model')}>Maquette 3D{dirty ? ' •' : ''}</button>
          </div>
          <div className="side-scroll">
            {tab === 'eq' && plan && (
              <>
                <div className="sec">
                  <input id="eq-filter" className="input" type="search" placeholder="Chercher dans ce plan : repère, modèle, local…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Chercher un équipement dans ce plan" />
                  <div className="filters" role="group" aria-label="Origine">
                    {(Object.keys(KIND_LABELS) as EquipmentKind[]).map((k) => (
                      <button key={k} type="button" aria-pressed={kinds[k]} onClick={() => setKinds({ ...kinds, [k]: !kinds[k] })}>
                        <span className={`dot kind-${k}`} />{KIND_LABELS[k]} <span className="muted num">{equipment.filter((e) => e.kind === k).length}</span>
                      </button>
                    ))}
                  </div>
                  {presentCats.length > 0 && (
                    <div className="filters" role="group" aria-label="Catégories">
                      {presentCats.map((c) => (
                        <button key={c.id} type="button" aria-pressed={!hiddenCats.includes(c.id)} onClick={() => setHiddenCats((h) => (h.includes(c.id) ? h.filter((x) => x !== c.id) : [...h, c.id]))}>
                          <span className="dot" style={{ background: cssColor(c.color) }} />{c.label} <span className="muted num">{equipment.filter((e) => e.category === c.id).length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="addbox">
                    <span className="muted small">Ajouter sur le plan :</span>
                    <div className="addcats" role="group" aria-label="Ajouter un équipement">
                      {CATEGORIES.map((c) => (
                        <button key={c.id} type="button" className="btn sm" title={c.hint} disabled={placing || saving} aria-pressed={placing && placeCat === c.id} onClick={() => startPlacing(c.id)}>
                          <span className="dot" style={{ background: cssColor(c.color) }} />{c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button type="button" className="btn ghost sm" onClick={() => setRereadOpen(true)} disabled={saving || !!loading}>Relire les indications du plan</button>
                  <button type="button" className="btn ghost sm" onClick={findLandmarks} disabled={saving || !!loading || !drawing}>Repérer escaliers, ascenseurs et gaines</button>
                </div>

                {selectedEq && (
                  <div className="sec">
                    <div className="detail">
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="chip"><span className={`dot kind-${selectedEq.kind}`} />{KIND_LABELS[selectedEq.kind]}</span>
                        {categoryOf(selectedEq.category) && <span className="chip"><EqDot e={selectedEq} />{categoryOf(selectedEq.category)!.label}</span>}
                        {selectedEq.type && selectedEq.type !== categoryOf(selectedEq.category)?.label && <span className="chip mono">{selectedEq.type}</span>}
                        {selectedEq.passage && <span className="chip">Passage entre étages : <b>{selectedEq.passage}</b></span>}
                      </div>
                      <h4>{selectedEq.label || selectedEq.type}</h4>
                      <dl className="kv">
                        {selectedEq.layer && <><dt>Calque</dt><dd>{selectedEq.layer}</dd></>}
                        {selectedEq.attributes && Object.entries(selectedEq.attributes).map(([k, v]) => <FragmentKV key={k} k={k} v={v} />)}
                        {selectedEq.notes && <><dt>Notes</dt><dd>{selectedEq.notes}</dd></>}
                        {selectedEq.indications?.length ? <><dt>Écrit à côté</dt><dd>{selectedEq.indications.map((t, i) => <div key={i}><Highlight text={t} query={query} /></div>)}</dd></> : null}
                      </dl>
                      <div className="toolbar">
                        <button type="button" className="btn sm" onClick={() => focusOn(selectedEq)}>Centrer la vue</button>
                        <button type="button" className="btn sm" onClick={() => setDraft(selectedEq)}>Modifier</button>
                        <button type="button" className="btn sm" onClick={copyLink}>Copier le lien</button>
                        <a className="btn sm" href={hrefOf({ page: 'trace', de: encodeEndpoint({ planId: id, eqId: selectedEq.id }), a: readDraft().a })}>Tracé depuis ici</a>
                        <a className="btn sm" href={hrefOf({ page: 'trace', de: readDraft().de, a: encodeEndpoint({ planId: id, eqId: selectedEq.id }) })}>Tracé jusqu'ici</a>
                        <button type="button" className="btn sm danger" onClick={() => removeEq(selectedEq)}>Supprimer</button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="eqlist" role="list">
                  {filtered.slice(0, MAX_ROWS).map((e) => (
                    <button key={e.id} type="button" role="listitem" className="eqrow" aria-current={e.id === selected} onClick={() => focusOn(e)}>
                      <EqDot e={e} />
                      <span className="l">
                        <span className="t"><Highlight text={e.label || e.type} query={query} /></span>
                        <span className="s">{[e.type !== e.label ? e.type : '', e.layer].filter(Boolean).join(' · ') || categoryOf(e.category)?.label || KIND_LABELS[e.kind]}</span>
                      </span>
                      {e.passage
                        ? <span className="tag" title="Passage entre étages">⇅ {e.passage}</span>
                        : e.indications?.length
                        ? <span className="tag" title={e.indications.join(' · ')}>{e.indications.length} ind.</span>
                        : e.attributes && <span className="tag">{Object.keys(e.attributes).length} attr.</span>}
                    </button>
                  ))}
                  {filtered.length > MAX_ROWS && <div className="sec muted small">{(filtered.length - MAX_ROWS).toLocaleString('fr-FR')} autres résultats : précisez la recherche.</div>}
                  {filtered.length === 0 && (
                    <div className="empty small">
                      {equipment.length === 0
                        ? <>Aucun équipement détecté dans ce fichier. Ajoutez-les sur le plan avec les boutons ci-dessus.</>
                        : <>Aucun équipement ne correspond.</>}
                    </div>
                  )}
                </div>
              </>
            )}

            {tab === 'model' && drawing && plan && (
              <ModelSettings
                drawing={drawing}
                settings={settings}
                onChange={changeSetting}
                onRole={setRole}
                onPage={changePage}
                onExport={doExport}
              />
            )}
          </div>
          {tab === 'model' && dirty && (
            <div className="savebar">
              <span>Réglages modifiés</span>
              <span className="toolbar">
                <button type="button" className="btn sm" onClick={() => { if (plan) { setSettings({ ...DEFAULT_SETTINGS, ...plan.settings }); setDirty(false); } }}>Annuler</button>
                <button type="button" className="btn sm primary" disabled={saving} onClick={async () => { if (await save({ settings }, 'Réglages enregistrés pour toute l’équipe.')) setDirty(false); }}>Enregistrer</button>
              </span>
            </div>
          )}
        </aside>

        <section className="stage" aria-label="Vue 3D">
          <div className="viewport" ref={containerRef} />
          <NavHint />
          <div className="tools">
            <div className="seg" role="group" aria-label="Point de vue">
              <button type="button" onClick={() => viewerRef.current?.fit('3d')}>3D</button>
              <button type="button" onClick={() => viewerRef.current?.fit('top')}>Dessus</button>
            </div>
            <div className="seg">
              <label className="check" htmlFor="show-plan"><input id="show-plan" type="checkbox" checked={showPlan} onChange={(e) => setShowPlan(e.target.checked)} /> Plan au sol</label>
              <label className="check" htmlFor="show-markers"><input id="show-markers" type="checkbox" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)} /> Repères</label>
            </div>
          </div>
          {placing && (
            <div className="placing" role="status">
              Cliquez à l'emplacement : {categoryOf(placeCat)?.label.toLowerCase()} {nextLabel(equipment, placeCat)}
              <button type="button" onClick={() => setPlacing(false)}>{equipment.some((e) => e.category === placeCat) ? 'Terminer' : 'Annuler'}</button>
            </div>
          )}
          {selectedEq && labelPos && (
            <div className="eq-label" style={{ left: labelPos.x, top: labelPos.y }}>
              <b>{selectedEq.label || selectedEq.type}</b>
              {selectedEq.type && selectedEq.type !== selectedEq.label && <span>{selectedEq.type}</span>}
            </div>
          )}
          {stats && (
            <div className="stats">
              <span className="pill"><b>{stats.walls}</b> murs</span>
              <span className="pill"><b>{stats.windows}</b> fenêtres</span>
              <span className="pill"><span className="dot kind-bloc" /><b>{filtered.length.toLocaleString('fr-FR')}</b> repères</span>
              {stats.width > 0 && <span className="pill">Emprise <b>{fmtNum(stats.width)} × {fmtNum(stats.depth)} m</b></span>}
              {plan && <span className="pill">Mis à jour le {fmtDate(plan.updatedAt)} par {plan.updatedBy}</span>}
            </div>
          )}
          {loading && <div className="busy">{loading}</div>}
        </section>
      </div>

      {draft && (
        <EquipmentDialog
          value={draft}
          types={types}
          isNew={!equipment.some((e) => e.id === draft.id)}
          autoLabel={(cat) => nextLabel(equipment, cat)}
          saving={saving}
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}
      {rereadOpen && plan && (
        <RereadDialog format={plan.file.format} onCancel={() => setRereadOpen(false)} onConfirm={reread} />
      )}
      {editMeta && plan && (
        <MetaDialog
          plan={plan}
          saving={saving}
          onCancel={() => setEditMeta(false)}
          onSave={async (m) => { if (await save(m, 'Fiche du plan enregistrée.')) setEditMeta(false); }}
        />
      )}
    </div>
  );
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

function ModelSettings({ drawing, settings, onChange, onRole, onPage, onExport }: {
  drawing: Drawing;
  settings: PlanSettings;
  onChange: <K extends keyof PlanSettings>(k: K, v: PlanSettings[K]) => void;
  onRole: (id: string, r: Role) => void;
  onPage: (p: number) => void;
  onExport: (f: 'glb' | 'obj' | 'stl') => void;
}) {
  const num = (key: 'hWall' | 'tWall' | 'tMax' | 'sill' | 'hWin', label: string, step = 0.05) => (
    <label className="field">
      <span>{label}</span>
      <span className="inputwrap">
        <input id={`set-${key}`} type="number" min="0" step={step} value={settings[key]} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v) && v >= 0) onChange(key, v); }} />
        <span className="unit">m</span>
      </span>
    </label>
  );
  const noWall = !drawing.groups.some((g) => roleOf(g, settings) === 'mur');
  return (
    <>
      <div className="sec">
        <h3>Échelle</h3>
        {drawing.format === 'dxf' ? (
          <label className="field">
            <span>Unité du dessin</span>
            <select id="set-unit" className="select" value={settings.unit} onChange={(e) => onChange('unit', e.target.value as Unit)}>
              {(Object.keys(UNIT_NAMES) as Unit[]).map((u) => <option key={u} value={u}>{UNIT_NAMES[u][0].toUpperCase() + UNIT_NAMES[u].slice(1)}</option>)}
            </select>
          </label>
        ) : (
          <div className="grid2">
            <label className="field">
              <span>Échelle du plan</span>
              <span className="inputwrap"><span className="pre">1 :</span><input id="set-scale" type="number" min="1" step="1" value={settings.pdfScale} onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) onChange('pdfScale', v); }} /></span>
            </label>
            {drawing.pageCount > 1 && (
              <label className="field">
                <span>Page</span>
                <select id="set-page" className="select" value={settings.pdfPage} onChange={(e) => onPage(Number(e.target.value))}>
                  {Array.from({ length: drawing.pageCount }, (_, i) => <option key={i} value={i + 1}>Page {i + 1} / {drawing.pageCount}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        {drawing.format === 'dxf' && drawing.unit && (
          <p className="muted small">{drawing.unit.source === 'file' ? `Unité indiquée dans le fichier : ${UNIT_NAMES[drawing.unit.unit]}.` : `Le fichier n'indique pas son unité ; ${UNIT_NAMES[drawing.unit.unit]} d'après la taille du dessin.`}</p>
        )}
        {drawing.format === 'pdf' && <p className="muted small">L'échelle imprimée dans le cartouche. À 1:100, 1 cm sur la feuille vaut 1 m.</p>}
      </div>

      <div className="sec">
        <h3>{drawing.format === 'pdf' ? 'Groupes de traits' : 'Calques'} <span className="count">{drawing.groups.length}</span></h3>
        {noWall
          ? <p className="notice warn small">Aucun calque n'est affecté aux murs : choisissez « Murs » sur celui qui les contient pour obtenir un volume.</p>
          : <p className="muted small">Les murs sont montés en hauteur, les fenêtres reçoivent allège, vitrage et linteau, le reste est tracé au sol.</p>}
        {Object.keys(settings.roles).length > 0 && (
          <div className="notice small">
            <p>{Object.keys(settings.roles).length} groupe(s) réglé(s) à la main : ils ne suivent pas la détection automatique.</p>
            <button type="button" className="btn sm" onClick={() => onChange('roles', {})}>Rétablir la détection automatique</button>
          </div>
        )}
        <div className="layers">
          {drawing.groups.map((g, i) => {
            const role = roleOf(g, settings);
            const n = g.kind === 'fill' ? g.fills.length : g.segs.length / 4;
            return (
              <div key={g.id} className="layer" data-role={role}>
                <span className="sw" style={{ background: `#${g.color.toString(16).padStart(6, '0')}` }} />
                <span className="meta">
                  <span className="lname" title={g.name}>{g.name}</span>
                  <span className="lcount">{n.toLocaleString('fr-FR')} {g.kind === 'fill' ? 'surface(s) pleine(s)' : 'trait(s)'}</span>
                </span>
                <select id={`role-${i}`} aria-label={`Rôle de ${g.name}`} value={role} onChange={(e) => onRole(g.id, e.target.value as Role)}>
                  {ROLE_LABELS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sec">
        <h3>Dimensions</h3>
        <div className="grid2">
          {num('hWall', 'Hauteur des murs')}
          {num('tWall', 'Murs en trait simple', 0.01)}
          {num('sill', 'Allège des fenêtres')}
          {num('hWin', 'Hauteur des fenêtres')}
          <div className="wide">{num('tMax', "Épaisseur max. d'un mur en double trait")}</div>
          <label className="check wide" htmlFor="set-slab"><input id="set-slab" type="checkbox" checked={settings.slab} onChange={(e) => onChange('slab', e.target.checked)} /> Dalle de sol</label>
        </div>
      </div>

      <div className="sec">
        <h3>Exporter la maquette</h3>
        <div className="exports">
          <button type="button" className="btn" onClick={() => onExport('glb')}><span className="fmt">GLB</span><span className="use">Blender, web</span></button>
          <button type="button" className="btn" onClick={() => onExport('obj')}><span className="fmt">OBJ</span><span className="use">SketchUp…</span></button>
          <button type="button" className="btn" onClick={() => onExport('stl')}><span className="fmt">STL</span><span className="use">Impression 3D</span></button>
        </div>
        <p className="muted small">Coordonnées en mètres. Le STL est orienté Z vers le haut.</p>
      </div>
    </>
  );
}

function EquipmentDialog({ value, types, isNew, autoLabel, saving, onCancel, onSave }: { value: Equipment; types: string[]; isNew: boolean; autoLabel: (c: Category) => string; saving: boolean; onCancel: () => void; onSave: (e: Equipment, again: boolean) => void }) {
  const [e, setE] = useState(value);
  const [again, setAgain] = useState(isNew && !!value.category && value.category !== 'autre');
  const valid = e.label.trim() || e.type.trim();
  // Changer de catégorie met à jour le repère et le type proposés, s'ils n'ont pas été retouchés.
  const changeCategory = (cat: Category | undefined) => {
    const prev = categoryOf(e.category), next = categoryOf(cat);
    const label = isNew && prev && e.label === autoLabel(prev.id) && next ? autoLabel(next.id) : e.label;
    const type = (!e.type || (prev && e.type === prev.label)) ? (next && next.id !== 'autre' ? next.label : '') : e.type;
    setE({ ...e, category: cat, label, type });
  };
  const submit = () => onSave({ ...e, label: e.label.trim(), type: e.type.trim(), notes: e.notes?.trim() || undefined, passage: e.passage?.trim() || undefined }, again);
  return (
    <Modal
      title={isNew ? 'Nouvel équipement' : 'Modifier l’équipement'}
      onClose={onCancel}
      footer={<>
        <button type="button" className="btn" onClick={onCancel}>Annuler</button>
        <button type="button" className="btn primary" disabled={!valid || saving} onClick={submit}>{saving ? 'Enregistrement…' : again ? 'Enregistrer et placer le suivant' : 'Enregistrer'}</button>
      </>}
    >
      <form className="grid2" onSubmit={(ev) => { ev.preventDefault(); if (valid && !saving) submit(); }}>
        <label className="field wide">
          <span>Catégorie</span>
          <select id="eq-category" className="select" value={e.category ?? ''} onChange={(ev) => changeCategory((ev.target.value || undefined) as Category | undefined)}>
            <option value="">Sans catégorie</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label} — {c.hint}</option>)}
          </select>
        </label>
        <label className="field wide">
          <span>Repère / nom</span>
          <input id="eq-label" className="input" value={e.label} maxLength={200} onChange={(ev) => setE({ ...e, label: ev.target.value })} placeholder="WIFI-12, TEL-204, SW-B-01…" autoFocus={isNew} />
        </label>
        <label className="field wide">
          <span>Type</span>
          <input id="eq-type" className="input" list="eq-types" value={e.type} maxLength={120} onChange={(ev) => setE({ ...e, type: ev.target.value })} placeholder="Switch, Baie, Caméra, Prise RJ45…" />
          <datalist id="eq-types">{types.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <div className="field wide">
          <label className="check" htmlFor="eq-is-passage">
            <input id="eq-is-passage" type="checkbox" checked={e.passage !== undefined} onChange={(ev) => setE({ ...e, passage: ev.target.checked ? (suggestPassage(e) || e.label) : undefined })} />
            Passage entre étages (gaine technique, colonne montante, escalier, ascenseur…)
          </label>
          {e.passage !== undefined && (
            <input id="eq-passage" className="input" value={e.passage} maxLength={60} onChange={(ev) => setE({ ...e, passage: ev.target.value })} placeholder="GT-3" aria-label="Nom du passage" />
          )}
          {e.passage !== undefined && <span className="muted small">Donnez le même nom à ce passage sur chaque plan du bâtiment : les tracés changeront d'étage par là.</span>}
        </div>
        <label className="field wide">
          <span>Notes</span>
          <textarea id="eq-notes" className="textarea" value={e.notes ?? ''} maxLength={2000} onChange={(ev) => setE({ ...e, notes: ev.target.value })} placeholder="Modèle, n° de série, adresse IP, n° de poste, port de brassage…" />
        </label>
        {isNew && (
          <label className="check wide" htmlFor="eq-again">
            <input id="eq-again" type="checkbox" checked={again} onChange={(ev) => setAgain(ev.target.checked)} /> Placer ensuite un autre équipement de cette catégorie (numéro suivant)
          </label>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      {!isNew && value.kind !== 'manuel' && <p className="muted small">Équipement lu dans le fichier : vos modifications sont conservées tant que la page du plan ne change pas.</p>}
    </Modal>
  );
}

function MetaDialog({ plan, saving, onCancel, onSave }: { plan: PlanRecord; saving: boolean; onCancel: () => void; onSave: (m: Partial<PlanRecord>) => void }) {
  const [m, setM] = useState({ name: plan.name, site: plan.site, building: plan.building, floor: plan.floor, notes: plan.notes });
  const [level, setLevel] = useState(plan.level == null ? '' : String(plan.level));
  const [height, setHeight] = useState(plan.floorHeight == null ? '' : String(plan.floorHeight));
  const guessed = guessLevel(m.floor);
  return (
    <Modal
      title="Fiche du plan"
      onClose={onCancel}
      footer={<>
        <button type="button" className="btn" onClick={onCancel}>Annuler</button>
        <button type="button" className="btn primary" disabled={!m.name.trim() || saving} onClick={() => onSave({ ...m, level: level === '' ? null : Number(level), floorHeight: height === '' ? null : Number(height) })}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </>}
    >
      <div className="grid2">
        <label className="field wide"><span>Nom du plan</span><input id="meta-name" className="input" value={m.name} maxLength={120} onChange={(e) => setM({ ...m, name: e.target.value })} /></label>
        <label className="field"><span>Site</span><input id="meta-site" className="input" value={m.site} maxLength={120} onChange={(e) => setM({ ...m, site: e.target.value })} /></label>
        <label className="field"><span>Bâtiment</span><input id="meta-building" className="input" value={m.building} maxLength={120} onChange={(e) => setM({ ...m, building: e.target.value })} /></label>
        <label className="field"><span>Étage / niveau</span><input id="meta-floor" className="input" value={m.floor} maxLength={60} onChange={(e) => setM({ ...m, floor: e.target.value })} /></label>
        <label className="field">
          <span>Niveau (ordre des étages)</span>
          <input id="meta-level" className="input num" type="number" step="1" value={level} onChange={(e) => setLevel(e.target.value)} placeholder={guessed == null ? '0 = RDC' : `${guessed} (déduit de l'étage)`} />
        </label>
        <label className="field">
          <span>Hauteur d'étage (sol à sol)</span>
          <span className="inputwrap"><input id="meta-height" type="number" step="0.05" min="1" value={height} onChange={(e) => setHeight(e.target.value)} placeholder={String(DEFAULT_FLOOR_HEIGHT)} /><span className="unit">m</span></span>
        </label>
        <p className="muted small wide" style={{ margin: 0 }}>Les plans d'un même site et d'un même bâtiment forment un bâtiment pour les tracés. Le niveau se déduit de l'étage (RDC, R+1, SS1…) s'il n'est pas saisi.</p>
        <label className="field wide"><span>Notes</span><textarea id="meta-notes" className="textarea" value={m.notes} maxLength={2000} onChange={(e) => setM({ ...m, notes: e.target.value })} /></label>
      </div>
      <p className="muted small">Ajouté le {fmtDate(plan.createdAt)} par {plan.createdBy}.</p>
    </Modal>
  );
}

function RereadDialog({ format, onCancel, onConfirm }: { format: 'dxf' | 'pdf'; onCancel: () => void; onConfirm: (ocr: boolean, vertical: boolean) => void }) {
  const [ocr, setOcr] = useState(format === 'pdf');
  const [vertical, setVertical] = useState(false);
  return (
    <Modal
      title="Relire les indications du plan"
      onClose={onCancel}
      footer={<>
        <button type="button" className="btn" onClick={onCancel}>Annuler</button>
        <button type="button" className="btn primary" onClick={() => onConfirm(ocr, ocr && vertical)}>Relire le plan</button>
      </>}
    >
      <p style={{ margin: 0 }}>Le fichier d'origine est relu : blocs, textes{format === 'dxf' ? ', étiquettes à flèche et cotes annotées' : ' et commentaires PDF'}. Chaque indication est rattachée à l'équipement le plus proche.</p>
      {format === 'pdf' && (
        <label className="check" htmlFor="reread-ocr" style={{ alignItems: 'flex-start' }}>
          <input id="reread-ocr" type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
          <span>Refaire la lecture OCR des indications dessinées ou scannées (1 à 3 minutes pour une grande feuille ; décoché, les textes déjà lus par OCR sont conservés)</span>
        </label>
      )}
      {format === 'pdf' && ocr && (
        <label className="check" htmlFor="reread-ocr-vertical" style={{ alignItems: 'flex-start', marginLeft: 24 }}>
          <input id="reread-ocr-vertical" type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} />
          <span>Lire aussi les textes écrits à la verticale <span className="muted small">(durée doublée)</span></span>
        </label>
      )}
      <p className="notice warn small" style={{ margin: 0 }}>Les modifications faites sur les éléments lus dans le fichier (nom, notes) seront perdues. Les équipements ajoutés à la main sont conservés.</p>
    </Modal>
  );
}
