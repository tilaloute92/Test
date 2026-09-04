import { makeId } from './ids';

/**
 * Réparation des identifiants dupliqués créés par l'ancienne génération d'identifiants
 * (compteur en mémoire remis à zéro à chaque chargement — voir src/lib/ids.ts).
 *
 * Ce qu'on peut réparer : deux enregistrements qui portent le même identifiant. Le premier
 * garde le sien, les suivants en reçoivent un neuf. Les deux redeviennent alors
 * distinguables — cocher l'un ne coche plus l'autre.
 *
 * Ce qu'on ne peut PAS deviner : les données qui *référencent* un identifiant dupliqué
 * (une tâche assignée à "m1000" quand deux personnes portaient ce même id) sont
 * irrémédiablement ambiguës — l'information n'a jamais existé. Ces références restent donc
 * attachées au premier enregistrement, et c'est signalé à l'utilisateur plutôt que corrigé
 * en silence : à lui de vérifier les affectations concernées.
 */

interface WithId {
  id: string;
}

function dedupe<T extends WithId>(items: T[] | undefined, prefix: string): { items: T[]; renamed: number } {
  if (!Array.isArray(items)) return { items: items ?? [], renamed: 0 };
  const seen = new Set<string>();
  let renamed = 0;
  const next = items.map((item) => {
    if (!item || typeof item.id !== 'string') return item;
    if (!seen.has(item.id)) {
      seen.add(item.id);
      return item;
    }
    renamed++;
    const fresh = makeId(prefix);
    seen.add(fresh);
    return { ...item, id: fresh };
  });
  return { items: next, renamed };
}

/**
 * Dernière réparation effectuée au chargement, si elle a eu lieu. Conservée ici pour que
 * l'interface puisse en avertir l'utilisateur : une réparation silencieuse laisserait des
 * affectations potentiellement fausses sans que personne ne le sache.
 */
let lastReport: RepairReport | null = null;
export const getLastRepairReport = () => lastReport;
export const clearLastRepairReport = () => { lastReport = null; };

export interface RepairReport {
  /** Nombre total d'enregistrements ré-identifiés, par collection. */
  byCollection: Record<string, number>;
  total: number;
}

/** Collections à vérifier, avec le préfixe d'identifiant correspondant. */
const COLLECTIONS: { key: string; prefix: string }[] = [
  { key: 'members', prefix: 'm' },
  { key: 'tasks', prefix: 't' },
  { key: 'planningSlots', prefix: 's' },
  { key: 'timeEntries', prefix: 'te' },
  { key: 'absences', prefix: 'a' },
  { key: 'roadmapItems', prefix: 'r' },
  { key: 'copils', prefix: 'cp' },
  { key: 'apiConnections', prefix: 'c' },
];

/**
 * Renvoie un état corrigé si des doublons existaient, sinon `null` (aucune écriture inutile).
 * Fonction pure : ne touche ni au store ni au stockage, pour rester testable telle quelle.
 */
export function repairDuplicateIds<T extends Record<string, unknown>>(
  state: T
): { state: T; report: RepairReport } | null {
  const patch: Record<string, unknown> = {};
  const byCollection: Record<string, number> = {};
  let total = 0;

  for (const { key, prefix } of COLLECTIONS) {
    const { items, renamed } = dedupe(state[key] as WithId[] | undefined, prefix);
    if (renamed > 0) {
      patch[key] = items;
      byCollection[key] = renamed;
      total += renamed;
    }
  }

  // Les sous-éléments d'un COPIL (ordre du jour, décisions, actions) vivent dans leur
  // séance : leurs identifiants doivent être uniques à l'intérieur de celle-ci.
  const copils = (patch.copils ?? state.copils) as Record<string, unknown>[] | undefined;
  if (Array.isArray(copils)) {
    let nestedRenamed = 0;
    const nextCopils = copils.map((copil) => {
      const agenda = dedupe(copil.agenda as WithId[] | undefined, 'cpa');
      const decisions = dedupe(copil.decisions as WithId[] | undefined, 'cpd');
      const actions = dedupe(copil.actions as WithId[] | undefined, 'cpac');
      const renamed = agenda.renamed + decisions.renamed + actions.renamed;
      if (renamed === 0) return copil;
      nestedRenamed += renamed;
      return { ...copil, agenda: agenda.items, decisions: decisions.items, actions: actions.items };
    });
    if (nestedRenamed > 0) {
      patch.copils = nextCopils;
      byCollection.copilsDetail = nestedRenamed;
      total += nestedRenamed;
    }
  }

  if (total === 0) return null;
  lastReport = { byCollection, total };
  return { state: { ...state, ...patch }, report: lastReport };
}
