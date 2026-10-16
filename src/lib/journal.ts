import { makeId } from './ids';
import type { JournalEntry, JournalNature, ProjectTask, TeamMember } from '../types';

/**
 * Journal d'avancement d'une tâche, d'un incident ou d'un projet.
 *
 * Deux natures d'entrées dans un seul fil : ce que les gens écrivent, et les changements
 * enregistrés tout seuls. Les secondes ne sont pas un gadget — un journal qui ne contient
 * que les notes ne contient que ce que quelqu'un a pensé à écrire, et il manque précisément
 * « à quel moment c'est passé en critique » ou « qui l'a repoussée au 20 », qui sont les
 * questions qu'on pose six mois plus tard.
 */

/** Au-delà, ce n'est plus une note d'avancement mais un document : qu'il aille ailleurs. */
export const LONGUEUR_NOTE_MAX = 4000;

/** Jours sans la moindre entrée au-delà desquels une tâche en cours est signalée. */
export const JOURS_SANS_ACTIVITE = 14;

const LIBELLE_STATUT: Record<string, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  en_attente: 'En attente',
  termine: 'Terminé',
};

const LIBELLE_PRIORITE: Record<string, string> = {
  basse: 'Basse',
  normale: 'Normale',
  haute: 'Haute',
  critique: 'Critique',
};

export const LIBELLE_NATURE: Record<JournalNature, string> = {
  note: 'Note',
  statut: 'Statut',
  priorite: 'Priorité',
  echeance: 'Échéance',
  assignation: 'Assignation',
  avancement: 'Avancement',
  creation: 'Création',
};

function jolieDate(iso?: string): string {
  if (!iso) return 'aucune';
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

function nomsDe(ids: string[] | undefined, members: TeamMember[]): string {
  if (!ids || ids.length === 0) return 'personne';
  const noms = ids.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);
  return noms.length > 0 ? noms.join(', ') : 'personne';
}

function entree(taskId: string, nature: JournalNature, auteur: string, reste: Partial<JournalEntry>): JournalEntry {
  return { id: makeId('j'), taskId, nature, auteur, createdAt: new Date().toISOString(), ...reste };
}

export function entreeCreation(taskId: string, auteur: string): JournalEntry {
  return entree(taskId, 'creation', auteur, {});
}

export function entreeNote(taskId: string, texte: string, auteur: string): JournalEntry {
  return entree(taskId, 'note', auteur, { texte: texte.trim().slice(0, LONGUEUR_NOTE_MAX) });
}

/**
 * Les changements à enregistrer entre deux états d'une tâche.
 *
 * Seuls quatre champs sont suivis : statut, priorité, échéance, assignation. Pas le titre
 * ni la description — les voir défiler en entier dans le fil le rendrait illisible, et une
 * correction de faute d'orthographe n'est pas un événement d'avancement. Pas la charge
 * estimée non plus : elle bouge au fil des affinages, sans que ça raconte quoi que ce soit.
 */
export function entreesDeChangement(
  avant: ProjectTask,
  patch: Partial<ProjectTask>,
  auteur: string,
  members: TeamMember[]
): JournalEntry[] {
  const out: JournalEntry[] = [];

  if (patch.status !== undefined && patch.status !== avant.status) {
    out.push(
      entree(avant.id, 'statut', auteur, {
        de: LIBELLE_STATUT[avant.status] ?? avant.status,
        vers: LIBELLE_STATUT[patch.status] ?? patch.status,
      })
    );
  }
  if (patch.priority !== undefined && patch.priority !== avant.priority) {
    out.push(
      entree(avant.id, 'priorite', auteur, {
        de: LIBELLE_PRIORITE[avant.priority] ?? avant.priority,
        vers: LIBELLE_PRIORITE[patch.priority] ?? patch.priority,
      })
    );
  }
  if (patch.dueDate !== undefined && (patch.dueDate || '') !== (avant.dueDate || '')) {
    out.push(entree(avant.id, 'echeance', auteur, { de: jolieDate(avant.dueDate), vers: jolieDate(patch.dueDate) }));
  }
  // L'avancement est une appréciation : savoir qui l'a portée de 25 à 70 %, et quand, est
  // le seul moyen de la relire plus tard autrement que comme un chiffre tombé du ciel.
  if (patch.avancement !== undefined && (patch.avancement ?? 0) !== (avant.avancement ?? 0)) {
    out.push(entree(avant.id, 'avancement', auteur, { de: `${avant.avancement ?? 0} %`, vers: `${patch.avancement ?? 0} %` }));
  }
  if (patch.assigneeIds !== undefined) {
    const a = [...avant.assigneeIds].sort().join(',');
    const b = [...patch.assigneeIds].sort().join(',');
    if (a !== b) {
      out.push(
        entree(avant.id, 'assignation', auteur, {
          de: nomsDe(avant.assigneeIds, members),
          vers: nomsDe(patch.assigneeIds, members),
        })
      );
    }
  }

  return out;
}

export interface ActiviteTache {
  /** Date ISO de la dernière entrée, toutes natures confondues. */
  derniere?: string;
  /** Nombre de notes écrites à la main. */
  notes: number;
  /** Jours écoulés depuis la dernière entrée. null si le fil est vide. */
  jours: number | null;
  /** Tâche en cours dont le fil ne bouge plus. Ce n'est pas un reproche : c'est en général
   *  le signe qu'elle attend quelque chose que personne n'a noté. */
  endormie: boolean;
}

export function activiteParTache(
  entries: JournalEntry[],
  tasks: ProjectTask[],
  maintenant = new Date()
): Map<string, ActiviteTache> {
  const parTache = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    const liste = parTache.get(e.taskId);
    if (liste) liste.push(e);
    else parTache.set(e.taskId, [e]);
  }

  const out = new Map<string, ActiviteTache>();
  for (const t of tasks) {
    const liste = parTache.get(t.id) ?? [];
    const derniere = liste.map((e) => e.createdAt).sort().at(-1);
    const jours = derniere ? Math.floor((maintenant.getTime() - Date.parse(derniere)) / 86_400_000) : null;
    out.set(t.id, {
      derniere,
      notes: liste.filter((e) => e.nature === 'note').length,
      jours,
      endormie: t.status !== 'termine' && jours !== null && jours >= JOURS_SANS_ACTIVITE,
    });
  }
  return out;
}

/** Les entrées d'une tâche, de la plus ancienne à la plus récente — l'ordre d'une histoire. */
export function journalDe(entries: JournalEntry[], taskId: string): JournalEntry[] {
  return entries.filter((e) => e.taskId === taskId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Dernière note écrite à la main, pour l'afficher dans la liste des tâches. */
export function derniereNote(entries: JournalEntry[], taskId: string): JournalEntry | undefined {
  return journalDe(entries, taskId)
    .filter((e) => e.nature === 'note')
    .at(-1);
}
