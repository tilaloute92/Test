import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { hrefOf } from '../App';
import { KIND_LABELS, type EquipmentKind, type PlanSummary, type SearchHit } from '../lib/types';
import { Highlight } from './ui';

const EXAMPLES = ['switch', 'baie', 'borne wifi', 'caméra', 'RJ45'];

export function SearchView({ initialQuery }: { initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery ?? '');
  const [site, setSite] = useState('');
  const [kind, setKind] = useState<'' | EquipmentKind>('');
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [res, setRes] = useState<{ total: number; results: SearchHit[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.listPlans().then(setPlans).catch(() => {}); inputRef.current?.focus(); }, []);
  const sites = useMemo(() => [...new Set(plans.map((p) => p.site).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [plans]);
  const totalEq = plans.reduce((n, p) => n + p.equipmentCount, 0);

  useEffect(() => {
    const query = q.trim();
    // La recherche reste dans l'adresse : Précédent depuis un plan ramène aux mêmes résultats.
    window.history.replaceState(null, '', hrefOf({ page: 'recherche', q: query || undefined }));
    if (!query) { setRes(null); setError(''); return; }
    const t = window.setTimeout(async () => {
      setBusy(true);
      try {
        setRes(await api.searchEquipment({ q: query, site, kind }));
        setError('');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, site, kind]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Rechercher un équipement</h1>
          <p>Dans les {plans.length} plan{plans.length > 1 ? 's' : ''} en stock, soit {totalEq.toLocaleString('fr-FR')} éléments : repères et attributs des blocs, indications écrites sur les plans (textes, étiquettes, commentaires, OCR), notes.</p>
        </div>
      </div>

      <div className="toolbar">
        <input
          ref={inputRef}
          id="search-q"
          className="input grow"
          type="search"
          placeholder="Ex. SW-B-01, switch bâtiment B, caméra parking…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Rechercher"
          style={{ fontSize: 15, padding: '10px 12px' }}
        />
        {sites.length > 0 && (
          <select id="search-site" className="select" style={{ width: 'auto' }} value={site} onChange={(e) => setSite(e.target.value)} aria-label="Site">
            <option value="">Tous les sites</option>
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select id="search-kind" className="select" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value as '' | EquipmentKind)} aria-label="Origine">
          <option value="">Toutes origines</option>
          {(Object.keys(KIND_LABELS) as EquipmentKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
      </div>

      {error && <div className="notice error">{error}</div>}

      {!q.trim() && (
        <div className="card">
          <div className="empty">
            <h3>Tapez un repère, un type ou un modèle</h3>
            <p>Les mots peuvent viser l'équipement ou la fiche du plan : « switch bât B » trouve les switchs des plans du bâtiment B. Accents, majuscules et tirets sont ignorés.</p>
            <div className="filters">{EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setQ(ex)}>{ex}</button>)}</div>
          </div>
        </div>
      )}

      {res && q.trim() && (
        <>
          <p className="muted small num" role="status">
            {busy ? 'Recherche…' : res.total === 0 ? 'Aucun équipement trouvé.' : `${res.total.toLocaleString('fr-FR')} résultat${res.total > 1 ? 's' : ''}${res.total > res.results.length ? ` (les ${res.results.length} plus pertinents affichés)` : ''}`}
          </p>
          {res.results.length > 0 && (
            <div className="tablewrap">
              <table className="data">
                <thead>
                  <tr><th>Équipement</th><th>Détails</th><th>Plan</th><th>Emplacement</th><th /></tr>
                </thead>
                <tbody>
                  {res.results.map((r) => {
                    const e = r.equipment;
                    const href = hrefOf({ page: 'plan', id: r.planId, eq: e.id });
                    return (
                      <tr key={`${r.planId}:${e.id}`} className="clickable" onClick={() => { window.location.hash = href; }}>
                        <td>
                          <div className="cell-title"><Highlight text={e.label || e.type} query={q} /></div>
                          <div className="cell-sub"><span className={`dot kind-${e.kind}`} /> {KIND_LABELS[e.kind]}{e.type && e.type !== e.label ? <> · <Highlight text={e.type} query={q} /></> : null}</div>
                        </td>
                        <td>
                          {e.attributes && (
                            <div className="attrs">
                              {Object.entries(e.attributes).slice(0, 6).map(([k, v]) => <span key={k}>{k} <b><Highlight text={v} query={q} /></b></span>)}
                            </div>
                          )}
                          {e.indications?.length ? (
                            <div className="cell-sub">Écrit à côté : {e.indications.slice(0, 4).map((t, i) => <span key={i}>{i ? ' · ' : ''}« <Highlight text={t} query={q} /> »</span>)}{e.indications.length > 4 ? ' …' : ''}</div>
                          ) : null}
                          {e.notes && <div className="cell-sub"><Highlight text={e.notes.slice(0, 120)} query={q} /></div>}
                          {e.layer && <div className="cell-sub mono">{e.layer}</div>}
                        </td>
                        <td><Highlight text={r.planName} query={q} /></td>
                        <td className="cell-sub">{[r.site, r.building && `Bât. ${r.building}`, r.floor].filter(Boolean).join(' · ') || '—'}</td>
                        <td><a className="btn sm" href={href} onClick={(ev) => ev.stopPropagation()}>Voir sur le plan</a></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
