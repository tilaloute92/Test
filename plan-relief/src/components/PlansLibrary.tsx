import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import { hrefOf, navigate } from '../App';
import type { PlanSummary } from '../lib/types';
import { UploadDialog } from './UploadDialog';
import { ReanalyseDialog } from './ReanalyseDialog';
import { useIsAdmin } from './session';
import { levelName, levelOf } from '../lib/building';
import { fmtDate, fmtSize, Highlight, Icon } from './ui';

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
    }).sort((a, b) => (a.site || '').localeCompare(b.site || '', 'fr') || (a.building || '').localeCompare(b.building || '', 'fr', { numeric: true }) || levelOf(b) - levelOf(a) || a.name.localeCompare(b.name, 'fr'));
  }, [plans, filter, site]);
  // Un groupe par bâtiment (site + bâtiment), étages du plus haut au plus bas, comme une coupe.
  const groups = useMemo(() => {
    const out: { key: string; site: string; building: string; plans: PlanSummary[] }[] = [];
    for (const p of shown) {
      const key = `${p.site}|${p.building}`;
      const g = out[out.length - 1];
      if (g && g.key === key) g.plans.push(p);
      else out.push({ key, site: p.site, building: p.building, plans: [p] });
    }
    return out;
  }, [shown]);
  const buildings = new Set((plans ?? []).map((p) => `${p.site}|${p.building}`)).size;
  const lastUpdate = (plans ?? []).reduce<PlanSummary | null>((m, p) => (!m || p.updatedAt > m.updatedAt ? p : m), null);
  const totalEq = (plans ?? []).reduce((n, p) => n + p.equipmentCount, 0);
  const allShown = shown.length > 0 && shown.every((p) => selected.includes(p.id));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleAll = () => setSelected((s) => (allShown ? s.filter((id) => !shown.some((p) => p.id === id)) : [...new Set([...s, ...shown.map((p) => p.id)])]));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Plans en stock</h1>
          <p>{plans ? 'Ouvrez un plan pour le voir en 3D, ou lancez une recherche dans tous les plans.' : 'Chargement…'}</p>
        </div>
        <div className="toolbar">
          <a className="btn" href={hrefOf({ page: 'recherche' })}><Icon name="search" /> Rechercher un équipement</a>
          {isAdmin && <button type="button" className="btn primary" onClick={() => setUploading(true)}><Icon name="plus" /> Ajouter un plan</button>}
        </div>
      </div>

      {plans && plans.length > 0 && (
        <div className="tiles">
          <div className="tile"><span className="tile-i"><Icon name="layers" size={18} /></span><div><b className="num">{plans.length.toLocaleString('fr-FR')}</b><span>plan{plans.length > 1 ? 's' : ''}</span></div></div>
          <div className="tile"><span className="tile-i"><Icon name="building" size={18} /></span><div><b className="num">{buildings.toLocaleString('fr-FR')}</b><span>bâtiment{buildings > 1 ? 's' : ''}</span></div></div>
          <div className="tile"><span className="tile-i"><Icon name="target" size={18} /></span><div><b className="num">{totalEq.toLocaleString('fr-FR')}</b><span>équipements recherchables</span></div></div>
          {lastUpdate && <div className="tile"><span className="tile-i"><Icon name="refresh" size={18} /></span><div><b>{fmtDate(lastUpdate.updatedAt)}</b><span>dernière mise à jour · {lastUpdate.updatedBy}</span></div></div>}
        </div>
      )}

      {error && <div className="notice error">Impossible de charger la bibliothèque : {error}</div>}

      {plans && plans.length > 0 && (
        <div className="toolbar">
          <input id="plans-filter" className="input grow" type="search" placeholder="Filtrer par nom, site, bâtiment, étage…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrer les plans" />
          {isAdmin && <button type="button" className="btn" disabled={!selected.length} onClick={() => setReanalysing((plans ?? []).filter((p) => selected.includes(p.id)))} title="Relire les plans cochés avec les règles de lecture actuelles">
            <Icon name="refresh" /> Réanalyser{selected.length ? ` (${selected.length})` : ''}
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
                <th style={{ width: 80 }}>Étage</th><th>Plan</th><th className="num">Équipements</th><th>Fichier</th><th>Mis à jour</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => [
                <tr key={`g-${g.key}`} className="group-row">
                  <td colSpan={isAdmin ? 6 : 5}>
                    <Icon name="building" /> <b><Highlight text={g.site || 'Site non renseigné'} query={filter} /></b>
                    {g.building && <> · Bâtiment <Highlight text={g.building} query={filter} /></>}
                    <span className="muted"> — {g.plans.length} étage{g.plans.length > 1 ? 's' : ''}</span>
                  </td>
                </tr>,
                ...g.plans.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate({ page: 'plan', id: p.id })}>
                  {isAdmin && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Cocher ${p.name}`} checked={selected.includes(p.id)} onChange={() => toggle(p.id)} /></td>}
                  <td><span className="lvl lvl-lg" title={p.floor ? `Étage : ${p.floor}` : 'Étage déduit du nom du plan'}>{levelName(levelOf(p))}</span></td>
                  <td>
                    <a href={hrefOf({ page: 'plan', id: p.id })} className="cell-title" style={{ color: 'inherit', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
                      <Highlight text={p.name} query={filter} />
                    </a>
                    {p.notes && <div className="cell-sub">{p.notes.slice(0, 90)}{p.notes.length > 90 ? '…' : ''}</div>}
                  </td>
                  <td className="num">
                    {p.equipmentCount.toLocaleString('fr-FR')}
                    {p.counts.manuel > 0 && <div className="cell-sub">dont {p.counts.manuel} ajouté{p.counts.manuel > 1 ? 's' : ''} à la main</div>}
                  </td>
                  <td><span className="tag">{p.file.format}</span> <span className="cell-sub">{fmtSize(p.file.size)}</span></td>
                  <td><div>{fmtDate(p.updatedAt)}</div><div className="cell-sub">{p.updatedBy}</div></td>
                </tr>
                )),
              ])}
              {shown.length === 0 && (
                <tr><td colSpan={isAdmin ? 6 : 5} className="muted">Aucun plan ne correspond à ce filtre.</td></tr>
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
