import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { journalDe, LIBELLE_NATURE, LONGUEUR_NOTE_MAX } from '../lib/journal';
import type { JournalEntry, JournalNature } from '../types';

/**
 * Le fil d'avancement d'une tâche, d'un incident ou d'un projet.
 *
 * Deux natures d'entrées s'y mêlent dans le même ordre chronologique : ce que les gens
 * écrivent, et les changements enregistrés tout seuls. C'est l'enchaînement qui a de la
 * valeur — « on a constaté ça, donc on est passé en critique, donc on l'a réaffectée » —
 * et le séparer en deux listes obligerait à les lire en parallèle pour le reconstituer.
 */

const REPERE: Record<JournalNature, { signe: string; couleur: string }> = {
  note: { signe: '✎', couleur: 'text-violet-500' },
  statut: { signe: '◆', couleur: 'text-sky-500' },
  priorite: { signe: '▲', couleur: 'text-amber-500' },
  echeance: { signe: '◷', couleur: 'text-amber-500' },
  assignation: { signe: '☗', couleur: 'text-emerald-500' },
  creation: { signe: '＋', couleur: 'text-slate-400' },
};

function ilYA(iso: string): string {
  const jours = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (jours <= 0) {
    const heures = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
    if (heures <= 0) return "à l'instant";
    return `il y a ${heures} h`;
  }
  if (jours === 1) return 'hier';
  return `il y a ${jours} jours`;
}

export function TaskJournal({ taskId, auteur }: { taskId: string; auteur: string }) {
  const { journalEntries, addJournalNote, updateJournalNote, removeJournalEntry } = useStore();
  const [texte, setTexte] = useState('');
  const [filtre, setFiltre] = useState<'tout' | 'notes'>('tout');
  const [enEdition, setEnEdition] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState('');

  const entrees = useMemo(() => journalDe(journalEntries, taskId), [journalEntries, taskId]);
  const notes = entrees.filter((e) => e.nature === 'note');
  const visibles = filtre === 'notes' ? notes : entrees;

  const ajouter = () => {
    if (!texte.trim()) return;
    addJournalNote(taskId, texte, auteur || 'Inconnu');
    setTexte('');
  };

  return (
    <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
          Journal
          <span className="ml-1.5 font-normal text-slate-400">
            {entrees.length} entrée{entrees.length > 1 ? 's' : ''}
            {notes.length > 0 ? `, dont ${notes.length} note${notes.length > 1 ? 's' : ''}` : ''}
          </span>
        </h4>
        {entrees.length > 0 && (
          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-slate-800">
            {(['tout', 'notes'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFiltre(f)}
                className={`rounded-md px-2 py-0.5 ${
                  filtre === f ? 'bg-white font-medium text-violet-700 shadow-sm dark:bg-slate-900 dark:text-violet-300' : 'text-slate-500'
                }`}
              >
                {f === 'tout' ? 'Tout' : 'Notes seules'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Le composeur est EN HAUT du fil : sur une tâche suivie depuis trois mois, un
          composeur en bas oblige à faire défiler tout l'historique avant d'écrire. */}
      <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
        <textarea
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          maxLength={LONGUEUR_NOTE_MAX}
          rows={2}
          placeholder="Où en est ce sujet ? Ce que vous écrivez ici reste attaché à la tâche."
          className="w-full resize-y bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            {auteur ? `Signé ${auteur}, horodaté.` : "Personne n'est identifié sur ce poste : la note sera signée « Inconnu »."}
          </span>
          <button
            type="button"
            onClick={ajouter}
            disabled={!texte.trim()}
            className="rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          >
            Ajouter au journal
          </button>
        </div>
      </div>

      {visibles.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">
          {filtre === 'notes' ? 'Aucune note écrite pour l’instant.' : 'Rien pour l’instant.'}
        </p>
      ) : (
        <ol className="mt-3 space-y-0">
          {/* Du plus récent au plus ancien, sous le composeur : la note qu'on vient
              d'écrire apparaît juste en dessous, au lieu d'atterrir tout en bas d'un fil
              de trois mois qu'il faudrait dérouler pour la relire. L'horodatage de chaque
              entrée suffit à reconstituer la chronologie quand on la cherche. */}
          {[...visibles].reverse().map((e) => (
            <li key={e.id} className="relative flex gap-2.5 pb-3 last:pb-0">
              {/* Filet vertical reliant les repères : sans lui, les entrées flottent et on
                  ne lit plus une chronologie mais une liste. */}
              <span aria-hidden className="absolute bottom-0 left-[9px] top-5 w-px bg-slate-100 last:hidden dark:bg-slate-800" />
              <span
                aria-hidden
                className={`relative z-10 mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] dark:border-slate-700 dark:bg-slate-900 ${REPERE[e.nature].couleur}`}
              >
                {REPERE[e.nature].signe}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{e.auteur || 'Inconnu'}</span>
                  <span className="text-slate-400" title={new Date(e.createdAt).toLocaleString('fr-FR')}>
                    {ilYA(e.createdAt)}
                  </span>
                  {e.nature !== 'note' && <span className="text-slate-400">· {LIBELLE_NATURE[e.nature]}</span>}
                  {e.editedAt && <span className="text-slate-400">· modifiée</span>}
                </div>
                {enEdition === e.id ? (
                  <div className="mt-1">
                    <textarea
                      value={brouillon}
                      onChange={(ev) => setBrouillon(ev.target.value)}
                      rows={2}
                      maxLength={LONGUEUR_NOTE_MAX}
                      className="input w-full resize-y text-sm"
                    />
                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          updateJournalNote(e.id, brouillon);
                          setEnEdition(null);
                        }}
                        className="rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-medium text-white"
                      >
                        Enregistrer
                      </button>
                      <button type="button" onClick={() => setEnEdition(null)} className="text-xs text-slate-500">
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <Corps e={e} />
                )}
                {e.nature === 'note' && enEdition !== e.id && estAuteur(e, auteur) && (
                  <div className="mt-0.5 flex gap-3 text-xs text-slate-400">
                    <button
                      type="button"
                      onClick={() => {
                        setEnEdition(e.id);
                        setBrouillon(e.texte ?? '');
                      }}
                      className="hover:text-violet-600 hover:underline dark:hover:text-violet-400"
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => removeJournalEntry(e.id)}
                      className="hover:text-red-600 hover:underline dark:hover:text-red-400"
                    >
                      Supprimer
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-3 text-xs text-slate-400">
        <strong className="font-medium text-slate-500 dark:text-slate-300">Les changements s'inscrivent tout seuls.</strong>{' '}
        Statut, priorité, échéance et assignation rejoignent ce fil : sans cela, le journal ne contiendrait que ce que les
        gens pensent à écrire, et il manquerait précisément ce qu'on cherche six mois plus tard.
      </p>
    </div>
  );
}

/**
 * Qui peut retoucher une note. Le rapprochement se fait sur le NOM AFFICHÉ, faute de lien
 * entre les comptes et les fiches d'équipe : c'est un garde-fou d'interface contre la
 * modification par inadvertance, pas une protection — quiconque sait appeler l'API peut
 * modifier n'importe quelle note, et c'est assumé pour un journal d'équipe interne.
 */
function estAuteur(e: JournalEntry, auteur: string): boolean {
  return Boolean(auteur) && e.auteur === auteur;
}

function Corps({ e }: { e: JournalEntry }) {
  if (e.nature === 'note') {
    return <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{e.texte}</p>;
  }
  if (e.nature === 'creation') {
    return <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">Tâche créée</p>;
  }
  return (
    <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">
      <span className="text-slate-400 line-through">{e.de}</span> → {e.vers}
    </p>
  );
}
