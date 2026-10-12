import { useEffect, useState } from 'react';
import * as api from '../api';
import { useIsAdmin } from './session';
import type { PlanRecord } from '../lib/types';
import { Icon } from './ui';

const ACTIONS = { ajout: 'a ajouté', modification: 'a modifié', suppression: 'a supprimé' } as const;
const META_LABELS: Record<string, string> = { name: 'nom', site: 'site', building: 'bâtiment', floor: 'étage', notes: 'notes', level: 'niveau', floorHeight: 'hauteur d’étage' };
const FIELD_LABELS: Record<string, string> = { label: 'repère', type: 'type', category: 'catégorie', notes: 'notes', passage: 'passage', position: 'position' };

const fmt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Journal d'un plan : qui a ajouté, modifié ou supprimé quoi, et quand. Un administrateur peut
 * remettre sur le plan un équipement supprimé.
 */
export function JournalTab({ planId, version, onRestored, onShow }: { planId: string; version: number; onRestored: (p: PlanRecord) => void; onShow: (eqId: string) => void }) {
  const [entries, setEntries] = useState<api.JournalEntry[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const isAdmin = useIsAdmin();
  useEffect(() => { api.getJournal(planId).then(setEntries).catch((e) => setError(e.message)); }, [planId, version]);

  const restore = async (entryId: string, itemId: string) => {
    setBusy(itemId);
    try { onRestored(await api.restoreEquipment(planId, entryId, itemId)); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };

  if (error) return <div className="sec"><div className="notice error">{error}</div></div>;
  if (!entries) return <div className="sec muted small">Chargement du journal…</div>;
  if (!entries.length) {
    return <div className="sec muted small">Aucune modification enregistrée depuis la mise à jour 1.1.0. Les prochains ajouts, modifications et suppressions apparaîtront ici.</div>;
  }
  return (
    <div className="journal">
      {entries.map((e) => (
        <div key={e.id} className="journal-entry">
          <div className="journal-h"><b>{e.user}</b><span className="muted small">{fmt(e.at)}</span></div>
          {e.summary && <div className="small">{e.summary}</div>}
          {e.meta && <div className="small">a modifié la fiche du plan ({e.meta.map((m) => META_LABELS[m] ?? m).join(', ')})</div>}
          {e.settings && <div className="small">a modifié les réglages de la maquette 3D</div>}
          {e.changes.slice(0, 12).map((c) => (
            <div key={`${c.type}-${c.id}`} className={`journal-c ${c.type}`}>
              <span className="small">{ACTIONS[c.type]} <b>{c.type === 'suppression' ? c.label : <button type="button" className="linkish" onClick={() => onShow(c.id)}>{c.label}</button>}</b>{c.fields?.length ? ` (${c.fields.map((f) => FIELD_LABELS[f] ?? f).join(', ')})` : ''}</span>
              {c.type === 'suppression' && isAdmin && e.restorable.includes(c.id) && (
                <button type="button" className="btn sm" disabled={!!busy} onClick={() => restore(e.id, c.id)}><Icon name="history" /> {busy === c.id ? 'Restauration…' : 'Restaurer'}</button>
              )}
            </div>
          ))}
          {e.changes.length > 12 && <div className="muted small">… et {e.changes.length - 12} autres</div>}
        </div>
      ))}
    </div>
  );
}
