import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import { hrefOf, navigate } from '../App';
import type { PlanSummary } from '../lib/types';
import { UploadDialog } from './UploadDialog';
import { ReanalyseDialog } from './ReanalyseDialog';
import { useIsAdmin } from './session';
import { fmtDate, fmtSize, Highlight } from './ui';

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function PlansLibrary() {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [site, setSite] = useState('');
  const isAdmin = useIsAdmin();
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [reanalysing, setReanalysing] = useState<PlanSummary[] | null>(null);

  const load = () => api.listPlans().then((p) => { setPlans(p); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const sites = useMemo(() => [...new Set((plans ?? []).map((p) => p.site).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [plans]);
  const shown = useMemo(() => {
    const terms = norm(filter).split(/\s+/).filter(Boolean);
    return (plans ?? []).filter((p) => {
      if (site && p.site !== site) return false;
      const hay = norm([p.name, p.site, p.building, p.floor, p.file.name, p.notes].join(' '));
      return terms.every((t) => hay.includes(t));
    }).sort((a, b) => (a.site || '').localeCompare(b.site || '', 'fr') || (a.building || '').localeCompare(b.building || '', 'fr', { numeric: true }) || (a.floor || '').localeCompare(b.floor || '', 'fr', { numeric: true }) || a.name.localeCompare(b.name, 'fr'));
  }, [plans, filter, site]);
  const totalEq = (plans ?? []).reduce((n, p) => n + p.equipmentCount, 0);
  const allShown = shown.length > 0 && shown.every((p) => selected.includes(p.id));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleAll = () => setSelected((s) => (allShown ? s.filter((id) => !shown.some((p) => p.id === id)) : [...new Set([...s, ...shown.map((p) => p.id)])]));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Plans en stock</h1>
          <p>{plans ? `${plans.length} plan${plans.length > 1 ? 's' : ''} · ${totalEq.toLocaleString('fr-FR')} équipements indexés` : 'Chargement…'}</p>
        </div>
        <div className="toolbar">
          <a className="btn" href={hrefOf({ page: 'recherche' })}>Rechercher un équipement</a>
          {isAdmin && <button type="button" className="btn primary" onClick={() => setUploading(true)}>Ajouter un plan</button>}
        </div>
      </div>

      {error && <div className="notice error">Impossible de charger la bibliothèque : {error}</div>}

      {plans && plans.length > 0 && (
        <div className="toolbar">
          <input id="plans-filter" className="input grow" type="search" placeholder="Filtrer par nom, site, bâtiment, étage…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrer les plans" />
          {isAdmin && <button type="button" className="btn" disabled={!selected.length} onClick={() => setReanalysing((plans ?? []).filter((p) => selected.includes(p.id)))} title="Relire les plans cochés avec les règles de lecture actuelles">
            Réanalyser{selected.length ? ` (${selected.length})` : ''}
          </button>}
          {sites.length > 1 && (
            <select id="plans-site" className="select" style={{ width: 'auto' }} value={site} onChange={(e) => setSite(e.target.value)} aria-label="Site">
              <option value="">Tous les sites</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      )}

      {plans && plans.length === 0 && (
        <div className="card">
          <div className="empty">
            <h3>Aucun plan en stock</h3>
            {isAdmin ? (
              <>
                <p>Ajoutez un plan DXF ou PDF : il est conservé sur le serveur, et les équipements qu'il contient deviennent recherchables par toute l'équipe.</p>
                <button type="button" className="btn primary" onClick={() => setUploading(true)}>Ajouter le premier plan</button>
              </>
            ) : <p>Les plans sont ajoutés par les administrateurs de l'application.</p>}
          </div>
        </div>
      )}

      {plans && plans.length > 0 && (
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                {isAdmin && <th style={{ width: 32 }}><input type="checkbox" aria-label="Tout cocher" checked={allShown} onChange={toggleAll} /></th>}
                <th>Plan</th><th>Site</th><th>Bâtiment</th><th>Étage</th><th className="num">Équipements</th><th>Fichier</th><th>Mis à jour</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate({ page: 'plan', id: p.id })}>
                  {isAdmin && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Cocher ${p.name}`} checked={selected.includes(p.id)} onChange={() => toggle(p.id)} /></td>}
                  <td>
                    <a href={hrefOf({ page: 'plan', id: p.id })} className="cell-title" style={{ color: 'inherit', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
                      <Highlight text={p.name} query={filter} />
                    </a>
                    {p.notes && <div className="cell-sub">{p.notes.slice(0, 90)}{p.notes.length > 90 ? '…' : ''}</div>}
                  </td>
                  <td><Highlight text={p.site} query={filter} /></td>
                  <td><Highlight text={p.building} query={filter} /></td>
                  <td><Highlight text={p.floor} query={filter} /></td>
                  <td className="num">
                    {p.equipmentCount.toLocaleString('fr-FR')}
                    {p.counts.manuel > 0 && <div className="cell-sub">dont {p.counts.manuel} ajouté{p.counts.manuel > 1 ? 's' : ''} à la main</div>}
                  </td>
                  <td><span className="tag">{p.file.format}</span> <span className="cell-sub">{fmtSize(p.file.size)}</span></td>
                  <td><div>{fmtDate(p.updatedAt)}</div><div className="cell-sub">{p.updatedBy}</div></td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={isAdmin ? 8 : 7} className="muted">Aucun plan ne correspond à ce filtre.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {reanalysing && (
        <ReanalyseDialog plans={reanalysing} onClose={(changed) => { setReanalysing(null); if (changed) { setSelected([]); load(); } }} />
      )}
      {uploading && (
        <UploadDialog
          sites={sites}
          plans={plans ?? []}
          onClose={() => setUploading(false)}
          onDone={(id) => { setUploading(false); load(); navigate({ page: 'plan', id }); }}
        />
      )}
    </div>
  );
}
