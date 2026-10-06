import { useMemo, useState } from 'react';
import * as api from '../api';
import { formatOf, readDrawing } from '../lib/drawing';
import { DEFAULT_SETTINGS, UNIT_NAMES, type Drawing, type PlanSummary } from '../lib/types';
import { Modal, fmtSize, useToast } from './ui';

export function UploadDialog({ sites, plans, onClose, onDone }: { sites: string[]; plans: PlanSummary[]; onClose: () => void; onDone: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [buf, setBuf] = useState<ArrayBuffer | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ name: '', site: '', building: '', floor: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'lecture' | 'envoi'>('');
  const [over, setOver] = useState(false);
  const toast = useToast();

  const buildings = useMemo(() => [...new Set(plans.filter((p) => !meta.site || p.site === meta.site).map((p) => p.building).filter(Boolean))], [plans, meta.site]);

  const analyse = async (f: File, b: ArrayBuffer, p: number) => {
    setBusy('lecture');
    setError('');
    try {
      const d = await readDrawing(b, formatOf(f.name)!, p);
      setDrawing(d);
    } catch (err) {
      setDrawing(null);
      setError(`Lecture impossible : ${(err as Error).message}. Vérifiez qu'il s'agit d'un DXF (ASCII) ou d'un PDF vectoriel.`);
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
    if (!file || !drawing) return;
    setBusy('envoi');
    setError('');
    try {
      const settings = { ...DEFAULT_SETTINGS, unit: drawing.unit?.unit ?? 'm', pdfPage: page };
      const res = await api.uploadPlan(file, { ...meta, settings, equipment: drawing.equipment });
      if (res.duplicateOf) toast(`Plan ajouté. Le même fichier figurait déjà en stock sous le nom « ${res.duplicateOf.name} ».`, 'warn');
      else toast(`Plan « ${res.plan.name} » ajouté : ${res.plan.equipmentCount.toLocaleString('fr-FR')} équipements indexés.`);
      onDone(res.plan.id);
    } catch (err) {
      setError((err as Error).message);
      setBusy('');
    }
  };

  const counts = drawing ? { bloc: drawing.equipment.filter((e) => e.kind === 'bloc').length, texte: drawing.equipment.filter((e) => e.kind === 'texte').length } : null;

  return (
    <Modal
      title="Ajouter un plan"
      onClose={busy === 'envoi' ? () => {} : onClose}
      wide
      footer={<>
        <button type="button" className="btn" onClick={onClose} disabled={busy === 'envoi'}>Annuler</button>
        <button type="button" className="btn primary" onClick={submit} disabled={!drawing || !!busy || !meta.name.trim()}>
          {busy === 'envoi' ? 'Envoi en cours…' : 'Mettre en stock'}
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
          <p><strong>{drawing.equipment.length.toLocaleString('fr-FR')} équipements détectés</strong> : {counts.bloc.toLocaleString('fr-FR')} blocs et {counts.texte.toLocaleString('fr-FR')} textes, sur {drawing.groups.length} {drawing.format === 'pdf' ? 'groupes de traits' : 'calques'}.</p>
          {drawing.unit && <p className="small">Unité {drawing.unit.source === 'file' ? 'lue dans le fichier' : 'déduite de la taille du dessin'} : {UNIT_NAMES[drawing.unit.unit]}. Modifiable ensuite dans l'onglet Maquette 3D.</p>}
          {drawing.format === 'pdf' && drawing.equipment.length === 0 && <p className="small">Aucun texte trouvé : s'il s'agit d'un plan scanné, vous pourrez placer les équipements à la main.</p>}
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
