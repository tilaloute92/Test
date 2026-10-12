import { useEffect, useMemo, useRef, useState } from 'react';
import type { Tab } from '../App';
import { useStore } from '../store/useStore';
import { ALL_TABS } from '../lib/navigation';

/**
 * Recherche globale (Ctrl + K).
 *
 * La recherche n'existait que dans l'onglet Tâches, et seulement sur le titre : retrouver
 * une initiative de la feuille de route ou une séance de COPIL supposait d'ouvrir le bon
 * onglet et de parcourir à l'œil. Avec cinquante tâches cela passe encore ; le jour où il
 * y en a deux cents, non.
 *
 * Elle cherche dans les quatre collections où l'on cherche réellement quelque chose —
 * tâches, feuille de route, COPIL, membres — plus les écrans eux-mêmes, qui sont ce qu'on
 * tape le plus souvent (« para » pour Paramètres).
 */

export type SearchKind = 'tache' | 'fdr' | 'copil' | 'personne' | 'ecran';

export interface SearchHit {
  id: string;
  kind: SearchKind;
  titre: string;
  detail: string;
  tab: Tab;
  /** Ce qui est comparé à la saisie : titre + tout ce qui aide à retrouver l'élément. */
  index: string;
}

const LIBELLE: Record<SearchKind, string> = {
  tache: 'Tâche',
  fdr: 'FDR',
  copil: 'COPIL',
  personne: 'Personne',
  ecran: 'Écran',
};

const COULEUR: Record<SearchKind, string> = {
  tache: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  fdr: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  copil: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  personne: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  ecran: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

const STATUT: Record<string, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  en_attente: 'En attente',
  termine: 'Terminé',
  idee: 'Idée',
  planifie: 'Planifié',
  tenu: 'Tenu',
  annule: 'Annulé',
};

/**
 * Normalisation : sans accents et sans casse. « référent » doit se trouver en tapant
 * « referent », faute de quoi la recherche échoue sur la moitié des titres français et
 * donne l'impression de ne pas fonctionner.
 */
function normalise(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function useSearchIndex(): SearchHit[] {
  const { tasks, roadmapItems, copils, members } = useStore();

  return useMemo(() => {
    const nom = (id: string) => members.find((m) => m.id === id)?.name ?? '';
    const hits: SearchHit[] = [];

    for (const t of tasks) {
      const gens = t.assigneeIds.map(nom).filter(Boolean);
      hits.push({
        id: `t:${t.id}`,
        kind: 'tache',
        titre: t.title,
        detail: [t.type, STATUT[t.status] ?? t.status, t.project, gens.join(', ') || 'Non assigné'].filter(Boolean).join(' · '),
        tab: 'tasks',
        index: [t.title, t.project, t.description, t.type, gens.join(' ')].filter(Boolean).join(' '),
      });
    }

    for (const r of roadmapItems) {
      const gens = r.ownerIds.map(nom).filter(Boolean);
      hits.push({
        id: `r:${r.id}`,
        kind: 'fdr',
        titre: r.title,
        detail: [r.domain, `${r.quarter} ${r.year}`, STATUT[r.status] ?? r.status, gens.join(', ')].filter(Boolean).join(' · '),
        tab: 'roadmap',
        index: [r.title, r.description, r.domain, r.quarter, String(r.year), gens.join(' ')].filter(Boolean).join(' '),
      });
    }

    for (const c of copils) {
      // Les points d'ordre du jour et les actions sont indexés sans être affichés : on
      // cherche souvent une séance par ce qui s'y est dit, pas par son titre — qui est le
      // même pour toutes.
      const pointsEtActions = [...c.agenda.map((a) => a.label), ...c.actions.map((a) => a.label)];
      hits.push({
        id: `c:${c.id}`,
        kind: 'copil',
        titre: c.title,
        detail: [c.date, c.location, STATUT[c.status] ?? c.status, `${c.actions.length} action(s)`].filter(Boolean).join(' · '),
        tab: 'copils',
        index: [c.title, c.date, c.location, ...pointsEtActions, ...c.externalParticipants].filter(Boolean).join(' '),
      });
    }

    for (const m of members) {
      hits.push({
        id: `m:${m.id}`,
        kind: 'personne',
        titre: m.name,
        detail: [m.role, m.skills.join(', '), m.email].filter(Boolean).join(' · '),
        tab: 'team',
        index: [m.name, m.role, m.skills.join(' '), m.email, m.initials].filter(Boolean).join(' '),
      });
    }

    for (const e of ALL_TABS) {
      hits.push({ id: `e:${e.id}`, kind: 'ecran', titre: e.label, detail: e.description, tab: e.id, index: `${e.label} ${e.description}` });
    }

    return hits;
  }, [tasks, roadmapItems, copils, members]);
}

/**
 * Chaque mot saisi doit se retrouver, pas la chaîne entière : « dupont vlan » doit sortir
 * la tâche VLAN portée par Dupont, alors qu'aucun champ ne contient cette suite exacte.
 */
function filtre(hits: SearchHit[], q: string): SearchHit[] {
  const mots = normalise(q).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return [];
  const resultats = hits.filter((h) => {
    const index = normalise(`${h.titre} ${h.detail} ${h.index}`);
    return mots.every((m) => index.includes(m));
  });
  // Ce dont le titre commence par la saisie d'abord : c'est presque toujours ce qu'on
  // cherchait, et le voir en troisième position donne l'impression d'un tri au hasard.
  const debut = normalise(q);
  return resultats
    .map((h) => ({ h, score: normalise(h.titre).startsWith(debut) ? 0 : normalise(h.titre).includes(debut) ? 1 : 2 }))
    .sort((a, b) => a.score - b.score)
    .map((x) => x.h)
    .slice(0, 30);
}

export function SearchPalette({ onClose, onNavigate }: { onClose: () => void; onNavigate: (t: Tab) => void }) {
  const hits = useSearchIndex();
  const [q, setQ] = useState('');
  const [curseur, setCurseur] = useState(0);
  const champ = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLDivElement>(null);

  const resultats = useMemo(() => filtre(hits, q), [hits, q]);

  useEffect(() => {
    champ.current?.focus();
  }, []);
  useEffect(() => {
    setCurseur(0);
  }, [q]);

  // Le résultat visé suit les flèches : sans cela, on sélectionne à l'aveugle dès que la
  // liste dépasse la hauteur visible.
  useEffect(() => {
    liste.current?.querySelector('[data-actif="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [curseur]);

  const ouvrir = (h: SearchHit | undefined) => {
    if (!h) return;
    onNavigate(h.tab);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Recherche globale"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
          <span className="text-slate-400" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={champ}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCurseur((c) => Math.min(c + 1, resultats.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCurseur((c) => Math.max(c - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                ouvrir(resultats[curseur]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Tâche, initiative, COPIL, personne, écran…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 dark:text-white"
          />
          <kbd className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 dark:border-slate-700">Échap</kbd>
        </div>

        <div ref={liste} className="max-h-[50vh] overflow-y-auto p-1">
          {q.trim() === '' && (
            <p className="px-2 py-6 text-center text-sm text-slate-400">
              Tapez pour chercher dans les tâches, la feuille de route, les COPIL, l'équipe et les écrans.
              <span className="mt-1 block text-xs">Les accents sont ignorés, et plusieurs mots se cumulent.</span>
            </p>
          )}
          {q.trim() !== '' && resultats.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-slate-400">Aucun résultat pour « {q} ».</p>
          )}
          {resultats.map((h, i) => (
            <button
              key={h.id}
              data-actif={i === curseur}
              onMouseEnter={() => setCurseur(i)}
              onClick={() => ouvrir(h)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                i === curseur ? 'bg-slate-100 dark:bg-slate-800' : ''
              }`}
            >
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${COULEUR[h.kind]}`}>{LIBELLE[h.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{h.titre}</span>
                <span className="block truncate text-xs text-slate-400">{h.detail}</span>
              </span>
              {i === curseur && (
                <span className="shrink-0 text-xs text-slate-300 dark:text-slate-600" aria-hidden="true">
                  ↵
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400 dark:border-slate-800">
          <span>↑ ↓ pour parcourir · ↵ pour ouvrir</span>
          <span>{resultats.length > 0 ? `${resultats.length} résultat(s)` : ''}</span>
        </div>
      </div>
    </div>
  );
}
