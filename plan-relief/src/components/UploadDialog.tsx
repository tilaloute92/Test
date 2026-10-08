import { useMemo, useState } from 'react';
import * as api from '../api';
import { detectLandmarks, drawingFactor, formatOf, readDrawing, withIndications } from '../lib/drawing';
import { mergeOcr } from '../lib/indications';
import { ocrPdfPage, type OcrProgress } from '../lib/ocr';
import { DEFAULT_SETTINGS, UNIT_NAMES, type Drawing, type PlanSummary } from '../lib/types';
import { Modal, fmtSize, useToast } from './ui';

export function UploadDialog({ sites, plans, onClose, onDone }: { sites: string[]; plans: PlanSummary[]; onClose: () => void; onDone: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [buf, setBuf] = useState<ArrayBuffer | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ name: '', site: '', building: '', floor: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'lecture' | 'ocr' | 'envoi'>('');
  const [ocr, setOcr] = useState(false);
  const [vertical, setVertical] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [over, setOver] = useState(false);
  const toast = useToast();

  const buildings = useMemo(() => [...new Set(plans.filter((p) => !meta.site || p.site === meta.site).map((p) => p.building).filter(Boolean))], [plans, meta.site]);

  const analyse = async (f: File, b: ArrayBuffer, p: number) => {
    setBusy('lecture');
    setError('');
    try {
      const d = await readDrawing(b, formatOf(f.name)!, p);
      setDrawing(d);
      // Peu de texte dans un PDF : plan scanné ou texte AutoCAD exporté en traits. La lecture
      // par OCR est alors proposée d'office.
      setOcr(d.format === 'pdf' && d.equipment.filter((e) => e.kind === 'texte').length < 10);
    } catch (err) {
      setDrawing(null);
      setError(`Lecture impossible : ${(err as Error).message}. Vérifiez qu'il s'agit d'un DXF (ASCII) ou d'un PDF vectoriel. (Application version ${__APP_VERSION__})`);
    } finally {
      setBusy('');
    }
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setDrawing(null);
    const fmt = formatOf(f.name);
    if (!fmt) {
      setFile(null);
      setError(/\.dwg$/i.test(f.name)
        ? 'Le format DWG est fermé et ne peut pas être lu. Enregistrez le plan en DXF depuis AutoCAD (Enregistrer sous → DXF), ou convertissez-le avec ODA File Converter (gratuit).'
        : 'Format non pris en charge. Importez un fichier .dxf ou .pdf.');
      return;
    }
    setFile(f);
    setPage(1);
    setMeta((m) => ({ ...m, name: m.name || f.name.replace(/\.[^.]+$/, '') }));
    const b = await f.arrayBuffer();
    setBuf(b);
    analyse(f, b, 1);
  };

  const submit = async () => {
    if (!file || !drawing || !buf) return;
    setError('');
    let phase: 'ocr' | 'envoi' = 'envoi';
    try {
      const settings = { ...DEFAULT_SETTINGS, unit: drawing.unit?.unit ?? 'm', pdfPage: page };
      let equipment = drawing.equipment;
      if (drawing.format === 'pdf' && ocr) {
        phase = 'ocr';
        setBusy('ocr');
        const read = await ocrPdfPage(buf, page, setProgress, { vertical });
        equipment = mergeOcr(equipment, read, 0.5 / drawingFactor('pdf', settings));
        toast(`${read.length.toLocaleString('fr-FR')} indications lues par OCR.`);
      }
      // Escaliers et ascenseurs repérés (marches dessinées, textes « ASC », « MC »…).
      equipment = withIndications(detectLandmarks(equipment, drawing.groups, drawing.format, settings).list, drawing.format, settings);
      phase = 'envoi';
      setBusy('envoi');
      const res = await api.uploadPlan(file, { ...meta, settings, equipment });
      if (res.duplicateOf) toast(`Plan ajouté. Le même fichier figurait déjà en stock sous le nom « ${res.duplicateOf.name} ».`, 'warn');
      else toast(`Plan « ${res.plan.name} » ajouté : ${res.plan.equipmentCount.toLocaleString('fr-FR')} équipements et indications indexés.`);
      onDone(res.plan.id);
    } catch (err) {
      setError(phase === 'ocr' ? `Lecture OCR impossible : ${(err as Error).message}. Décochez la lecture OCR pour mettre le plan en stock sans elle.` : (err as Error).message);
      setBusy('');
      setProgress(null);
    }
  };

  const counts = drawing ? {
    bloc: drawing.equipment.filter((e) => e.kind === 'bloc').length,
    texte: drawing.equipment.filter((e) => e.kind === 'texte' && !/PDF$/.test(e.type)).length,
    annot: drawing.equipment.filter((e) => /PDF$/.test(e.type)).length,
  } : null;

  return (
    <Modal
      title="Ajouter un plan"
      onClose={busy === 'envoi' || busy === 'ocr' ? () => {} : onClose}
      wide
      footer={<>
        <button type="button" className="btn" onClick={onClose} disabled={busy === 'envoi' || busy === 'ocr'}>Annuler</button>
        <button type="button" className="btn primary" onClick={submit} disabled={!drawing || !!busy || !meta.name.trim()}>
          {busy === 'ocr' ? 'Lecture des indications…' : busy === 'envoi' ? 'Envoi en cours…' : 'Mettre en stock'}
        </button>
      </>}
    >
      <label
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
      >
        <input id="upload-file" type="file" accept=".dxf,.pdf,.dwg" onChange={(e) => pick(e.target.files?.[0])} />
        <span className="big">{file ? file.name : 'Choisir un fichier'}</span>
        <span className="small">{file ? fmtSize(file.size) : 'DXF ou PDF vectoriel · glisser-déposer'}</span>
      </label>

      {busy === 'lecture' && <div className="notice">Lecture du plan et recherche des équipements…</div>}
      {error && <div className="notice error" role="alert">{error}</div>}

      {drawing && counts && (
        <div className="notice ok">
          <p><strong>{drawing.equipment.length.toLocaleString('fr-FR')} éléments recherchables</strong> : {counts.bloc.toLocaleString('fr-FR')} blocs d'équipement, {counts.texte.toLocaleString('fr-FR')} indications écrites{counts.annot ? <>, {counts.annot.toLocaleString('fr-FR')} commentaires PDF</> : null}, sur {drawing.groups.length} {drawing.format === 'pdf' ? 'groupes de traits' : 'calques'}.</p>
          <p className="small">Chaque indication est aussi rattachée au bloc d'équipement le plus proche (moins de 1,5 m) : chercher ce qui est écrit à côté d'un équipement le fait ressortir.</p>
          {drawing.unit && <p className="small">Unité {drawing.unit.source === 'file' ? 'lue dans le fichier' : 'déduite de la taille du dessin'} : {UNIT_NAMES[drawing.unit.unit]}. Modifiable ensuite dans l'onglet Maquette 3D.</p>}

        </div>
      )}

      {drawing?.format === 'pdf' && (
        <label className="check" htmlFor="upload-ocr" style={{ alignItems: 'flex-start' }}>
          <input id="upload-ocr" type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} disabled={!!busy} />
          <span>
            Lire aussi les indications dessinées ou scannées (reconnaissance de caractères)
            <span className="muted small" style={{ display: 'block' }}>
              {counts && counts.texte < 10 ? 'Recommandé : ce PDF contient peu de texte (plan scanné, ou texte AutoCAD exporté en traits). ' : 'Utile si une partie des indications est scannée ou dessinée en traits. '}
              Compter 1 à 3 minutes pour une grande feuille. La lecture se fait dans votre navigateur, rien n'est envoyé à l'extérieur.
            </span>
          </span>
        </label>
      )}
      {drawing?.format === 'pdf' && ocr && (
        <label className="check" htmlFor="upload-ocr-vertical" style={{ alignItems: 'flex-start', marginLeft: 24 }}>
          <input id="upload-ocr-vertical" type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} disabled={!!busy} />
          <span>Lire aussi les textes écrits à la verticale <span className="muted small">(durée doublée)</span></span>
        </label>
      )}
      {busy === 'ocr' && progress && (
        <div className="notice" role="status">
          <p>{progress.step}… {Math.round(progress.ratio * 100)} %</p>
          <progress max={1} value={progress.ratio} style={{ width: '100%' }} />
        </div>
      )}

      {drawing?.format === 'pdf' && drawing.pageCount > 1 && file && buf && (
        <label className="field">
          <span>Page du PDF à mettre en stock</span>
          <select id="upload-page" className="select" value={page} onChange={(e) => { const p = Number(e.target.value); setPage(p); analyse(file, buf, p); }}>
            {Array.from({ length: drawing.pageCount }, (_, i) => <option key={i} value={i + 1}>Page {i + 1} / {drawing.pageCount}</option>)}
          </select>
        </label>
      )}

      <div className="grid2">
        <label className="field wide">
          <span>Nom du plan</span>
          <input id="upload-name" className="input" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} maxLength={120} required />
        </label>
        <label className="field">
          <span>Site</span>
          <input id="upload-site" className="input" list="sites-list" value={meta.site} onChange={(e) => setMeta({ ...meta, site: e.target.value })} maxLength={120} placeholder="Siège, Entrepôt Nord…" />
          <datalist id="sites-list">{sites.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="field">
          <span>Bâtiment</span>
          <input id="upload-building" className="input" list="buildings-list" value={meta.building} onChange={(e) => setMeta({ ...meta, building: e.target.value })} maxLength={120} />
          <datalist id="buildings-list">{buildings.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="field">
          <span>Étage / niveau</span>
          <input id="upload-floor" className="input" value={meta.floor} onChange={(e) => setMeta({ ...meta, floor: e.target.value })} maxLength={60} placeholder="RDC, R+1, SS1…" />
        </label>
        <label className="field wide">
          <span>Notes</span>
          <textarea id="upload-notes" className="textarea" value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} maxLength={2000} placeholder="Indice de révision, origine du plan…" />
        </label>
      </div>
    </Modal>
  );
}
