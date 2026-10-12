import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import { hrefOf } from '../App';
import type { PlanSummary } from '../lib/types';
import { encodeEndpoint } from '../lib/traceLink';
import { useIsAdmin } from './session';
import { useContext } from 'react';
import { UserContext } from './session';
import { fmtDate, fmtNum, Highlight, Icon, useConfirm, useToast } from './ui';
import { downloadCsv, today } from '../lib/csv';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Adresse qui rouvre un tracé enregistré dans la page Tracés, avec ses options, et le relance. */
export function savedRouteHref(r: api.SavedRoute) {
  const [first, ...rest] = r.targets;
  return hrefOf({
    page: 'trace',
    de: encodeEndpoint(r.from),
    a: encodeEndpoint(first),
    plus: rest.length ? rest.map(encodeEndpoint).join(',') : undefined,
    h: r.options.height, m: String(r.options.margin), o: r.options.orthogonal ? '1' : '0', w: r.options.allowWalls ? '1' : '0', k: r.options.kinds.join(','),
    r: r.id,
  });
}

/**
 * Tracés enregistrés par l'équipe. Le tracé n'est pas figé : à l'ouverture il est recalculé
 * sur les plans actuels. Si un plan a changé depuis l'enregistrement, la ligne le signale.
 */
export function SavedRoutesView() {
  const [routes, setRoutes] = useState<api.SavedRoute[] | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const isAdmin = useIsAdmin();
  const user = useContext(UserContext);
  const confirm = useConfirm();
  const toast = useToast();

  const load = () => Promise.all([api.listRoutes(), api.listPlans()]).then(([r, p]) => { setRoutes(r); setPlans(p); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const byId = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  const shown = useMemo(() => {
    const terms = norm(filter).split(/\s+/).filter(Boolean);
    return (routes ?? []).filter((r) => {
      const hay = norm([r.name, r.ref, r.from.label, ...r.targets.map((t) => t.label), r.createdBy, r.floors.join(' ')].join(' '));
      return terms.every((t) => hay.includes(t));
    });
  }, [routes, filter]);

  /** Plans modifiés ou retirés depuis l'enregistrement du tracé. */
  const staleness = (r: api.SavedRoute) => {
    const ids = [...new Set([r.from.planId, ...r.targets.map((t) => t.planId), ...Object.keys(r.planVersions)])];
    const gone = ids.filter((id) => !byId.has(id));
    const changed = Object.entries(r.planVersions).filter(([id, v]) => byId.has(id) && byId.get(id)!.version !== v).map(([id]) => byId.get(id)!);
    return { gone, changed };
  };
  const canEdit = (r: api.SavedRoute) => isAdmin || (!!user && r.ownerId.toLowerCase() === user.username.toLowerCase());

  const remove = async (r: api.SavedRoute) => {
    if (!(await confirm({ title: 'Supprimer le tracé enregistré', message: <p>« {r.name} » sera retiré de la liste de toute l'équipe. Les plans ne sont pas touchés.</p>, confirmLabel: 'Supprimer', danger: true }))) return;
    try { await api.deleteRoute(r.id); toast('Tracé supprimé.'); load(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const exportAll = () => downloadCsv(`traces_enregistres_${today()}`, ['Tracé', 'Chantier', 'Départ', 'Étage départ', 'Arrivée', 'Étage arrivée', 'À prévoir (m)', 'Étages', 'Enregistré le', 'Par'],
    shown.flatMap((r) => r.targets.map((t) => [r.name, r.ref, r.from.label, r.from.floor, t.label, t.floor, t.length, r.floors.join(' → '), fmtDate(r.updatedAt), r.updatedBy])));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tracés enregistrés</h1>
          <p>Toute l'équipe voit ces tracés. « Ouvrir » les recalcule sur les plans actuels et les affiche dans la vue 3D.</p>
        </div>
        <div className="toolbar">
          {shown.length > 0 && <button type="button" className="btn" onClick={exportAll}><Icon name="sheet" /> Exporter (Excel)</button>}
          <a className="btn primary" href={hrefOf({ page: 'trace' })}><Icon name="route" /> Nouveau tracé</a>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      {routes && routes.length > 0 && (
        <input id="routes-filter" className="input" type="search" placeholder="Filtrer : nom, équipement, chantier, auteur…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrer les tracés" />
      )}
      {routes && routes.length === 0 && (
        <div className="card"><div className="empty">
          <h3>Aucun tracé enregistré</h3>
          <p>Après un calcul dans la page Tracés, le bouton « Enregistrer le tracé » le range ici, avec un nom et une référence de chantier.</p>
          <a className="btn primary" href={hrefOf({ page: 'trace' })}>Faire un tracé</a>
        </div></div>
      )}
      {shown.length > 0 && (
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Tracé</th><th>Départ → arrivée</th><th>Étages</th><th className="num">À prévoir</th><th>Enregistré</th><th /></tr></thead>
            <tbody>
              {shown.map((r) => {
                const { gone, changed } = staleness(r);
                return (
                  <tr key={r.id} className="clickable" onClick={() => { window.location.hash = savedRouteHref(r); }}>
                    <td>
                      <div className="cell-title"><Highlight text={r.name} query={filter} /></div>
                      {r.ref && <div className="cell-sub">Chantier <Highlight text={r.ref} query={filter} /></div>}
                      {gone.length > 0 && <div className="notice error small tight">Un plan de ce tracé a été retiré du stock.</div>}
                      {!gone.length && changed.length > 0 && <div className="notice warn small tight">Plan {changed.map((p) => p.floor || p.name).join(', ')} modifié depuis l'enregistrement : longueur à vérifier (ouvrir, puis « Enregistrer… » pour la mettre à jour).</div>}
                    </td>
                    <td>
                      <Highlight text={r.from.label} query={filter} /> → {r.targets.length > 1 ? <b>{r.targets.length} arrivées</b> : <Highlight text={r.targets[0].label} query={filter} />}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.floors.length > 1 ? <><span className="lvl start">{r.floors[0]}</span> → <span className="lvl end">{r.floors[r.floors.length - 1]}</span></> : <span className="lvl">{r.floors[0] || r.from.floor || '?'}</span>}</td>
                    <td className="num"><b>{fmtNum(r.total, 1)} m</b></td>
                    <td>{fmtDate(r.updatedAt)}<div className="cell-sub">{r.updatedBy}</div></td>
                    <td className="actions-cell" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="btn sm" onClick={() => { window.location.hash = savedRouteHref(r); }}>Ouvrir</button>
                      {canEdit(r) && <button type="button" className="btn sm ghost danger" onClick={() => remove(r)} aria-label={`Supprimer ${r.name}`}><Icon name="trash" /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {routes && routes.length > 0 && shown.length === 0 && <div className="muted">Aucun tracé ne correspond à ce filtre.</div>}
    </div>
  );
}

