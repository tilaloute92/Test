import { useRef, useState } from 'react';
import { reanalyseAndSave } from '../lib/reanalyse';
import type { PlanSummary } from '../lib/types';
import { Modal } from './ui';

type Status = { state: 'attente' } | { state: 'cours'; step: string } | { state: 'ok'; text: string } | { state: 'erreur'; text: string } | { state: 'annulé' };

/**
 * Réanalyse de plusieurs plans déjà en stock, l'un après l'autre, avec les règles de lecture
 * actuelles (et l'OCR si demandée). Tout se fait dans ce navigateur : la fenêtre doit rester
 * ouverte jusqu'à la fin.
 */
export function ReanalyseDialog({ plans, onClose }: { plans: PlanSummary[]; onClose: (changed: boolean) => void }) {
  const hasPdf = plans.some((p) => p.file.format === 'pdf');
  const [ocr, setOcr] = useState(hasPdf);
  const [vertical, setVertical] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<Record<string, Status>>(() => Object.fromEntries(plans.map((p) => [p.id, { state: 'attente' } as Status])));
  const stop = useRef(false);
  const set = (id: string, s: Status) => setStatus((cur) => ({ ...cur, [id]: s }));

  const run = async () => {
    setRunning(true);
    stop.current = false;
    for (const p of plans) {
      if (stop.current) { set(p.id, { state: 'annulé' }); continue; }
      set(p.id, { state: 'cours', step: 'Préparation' });
      try {
        const r = await reanalyseAndSave(p.id, { ocr, vertical }, (step) => set(p.id, { state: 'cours', step }));
        const extra = [r.stairs && `${r.stairs} escalier(s)`, r.lifts && `${r.lifts} ascenseur(s)`, r.risers && `${r.risers} gaine(s)`].filter(Boolean).join(', ');
        set(p.id, { state: 'ok', text: `${r.list.length.toLocaleString('fr-FR')} éléments, dont ${r.texts.toLocaleString('fr-FR')} indications${extra ? ` ; ${extra}` : ''}` });
      } catch (err) {
        set(p.id, { state: 'erreur', text: (err as Error).message });
      }
    }
    setRunning(false);
    setDone(true);
  };

  const counts = Object.values(status).reduce((n, s) => ({ ...n, [s.state]: (n[s.state] ?? 0) + 1 }), {} as Record<string, number>);
  return (
    <Modal
      title={`Réanalyser ${plans.length} plan${plans.length > 1 ? 's' : ''}`}
      wide
      onClose={() => { if (!running) onClose(done); }}
      footer={running ? (
        <button type="button" className="btn" onClick={() => { stop.current = true; }} disabled={stop.current}>Arrêter après le plan en cours</button>
      ) : done ? (
        <button type="button" className="btn primary" onClick={() => onClose(true)}>Fermer</button>
      ) : (
        <>
          <button type="button" className="btn" onClick={() => onClose(false)}>Annuler</button>
          <button type="button" className="btn primary" onClick={run}>Lancer la réanalyse</button>
        </>
      )}
    >
      {!running && !done && (
        <>
          <p style={{ margin: 0 }}>Chaque plan est relu depuis son fichier d'origine avec les règles de lecture actuelles : textes et blocs, escaliers, ascenseurs et gaines, rattachement des indications.</p>
          {hasPdf && (
            <label className="check" htmlFor="bulk-ocr" style={{ alignItems: 'flex-start' }}>
              <input id="bulk-ocr" type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
              <span>Refaire la lecture OCR des PDF (indications dessinées ou scannées)<span className="muted small" style={{ display: 'block' }}>Environ 3 à 4 minutes par grande feuille. Décoché : les textes déjà lus par OCR sont conservés.</span></span>
            </label>
          )}
          {hasPdf && ocr && (
            <label className="check" htmlFor="bulk-ocr-vertical" style={{ alignItems: 'flex-start', marginLeft: 24 }}>
              <input id="bulk-ocr-vertical" type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} />
              <span>Lire aussi les textes écrits à la verticale <span className="muted small">(durée doublée)</span></span>
            </label>
          )}
          <p className="notice warn small" style={{ margin: 0 }}>Les modifications faites sur les éléments lus dans les fichiers (nom, notes, catégorie) seront perdues. Les équipements ajoutés à la main sont conservés. Gardez cette fenêtre ouverte jusqu'à la fin : l'analyse se fait dans ce navigateur.</p>
        </>
      )}
      {(running || done) && (
        <p className="small" role="status" style={{ margin: 0 }}>
          {running ? 'Réanalyse en cours — gardez cette fenêtre ouverte. ' : 'Réanalyse terminée. '}
          {counts.ok ? `${counts.ok} réussi${counts.ok > 1 ? 's' : ''}` : ''}{counts.erreur ? ` · ${counts.erreur} en erreur` : ''}{counts.annulé ? ` · ${counts.annulé} non traité${counts.annulé > 1 ? 's' : ''}` : ''}
        </p>
      )}
      <div className="tablewrap" style={{ maxHeight: 360, overflow: 'auto' }}>
        <table className="data small">
          <thead><tr><th>Plan</th><th>Étage</th><th>État</th></tr></thead>
          <tbody>
            {plans.map((p) => {
              const s = status[p.id];
              return (
                <tr key={p.id}>
                  <td>{p.name}<div className="cell-sub">{p.file.format.toUpperCase()}</div></td>
                  <td>{[p.building && `Bât. ${p.building}`, p.floor].filter(Boolean).join(' · ') || '—'}</td>
                  <td>
                    {s.state === 'attente' && <span className="muted">En attente</span>}
                    {s.state === 'cours' && <b>{s.step}…</b>}
                    {s.state === 'ok' && <span>✔ {s.text}</span>}
                    {s.state === 'erreur' && <span className="err">✘ {s.text}</span>}
                    {s.state === 'annulé' && <span className="muted">Non traité (arrêt demandé)</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
