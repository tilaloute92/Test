/**
 * Versionnement + sauvegarde/restauration des données métier (membres, tâches, planning,
 * temps saisi, absences, connexions API, paramètres de connexion).
 *
 * Deux mécanismes complémentaires, l'un ne remplaçant pas l'autre :
 *
 * 1. Historique automatique — après chaque modification, un point de restauration est
 *    enregistré tout seul dans ce navigateur (localStorage, comme le reste des données).
 *    Pratique pour annuler rapidement une mauvaise manipulation, mais propre à CE
 *    navigateur : il disparaît si le stockage local est vidé, et n'existe pas sur un
 *    autre appareil.
 * 2. Sauvegarde manuelle (fichier .json) — la seule des deux qui survit à un vidage du
 *    stockage local ou à un changement d'appareil. À déclencher soi-même : rien n'est
 *    envoyé ni sauvegardé automatiquement quelque part.
 *
 * Comme pour le reste de l'application, rien n'est centralisé sur un serveur : tout reste
 * dans le navigateur de la personne qui l'utilise, jusqu'à export manuel du fichier.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useStore, type StoreState } from '../store/useStore';

export interface BackupPayload {
  members: StoreState['members'];
  tasks: StoreState['tasks'];
  planningSlots: StoreState['planningSlots'];
  timeEntries: StoreState['timeEntries'];
  absences: StoreState['absences'];
  apiConnections: StoreState['apiConnections'];
  requestHistory: StoreState['requestHistory'];
  authSettings: StoreState['authSettings'];
  roadmapItems: StoreState['roadmapItems'];
}

const DATA_KEYS = [
  'members',
  'tasks',
  'planningSlots',
  'timeEntries',
  'absences',
  'apiConnections',
  'requestHistory',
  'authSettings',
  'roadmapItems',
] as const;

function extractPayload(state: StoreState): BackupPayload {
  // Aller-retour JSON : coupe toute référence partagée avec le store courant, pour qu'une
  // modification ultérieure des données ne touche pas un instantané déjà enregistré.
  const picked: Record<string, unknown> = {};
  for (const key of DATA_KEYS) picked[key] = state[key];
  return JSON.parse(JSON.stringify(picked)) as BackupPayload;
}

function isBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== 'object') return false;
  return DATA_KEYS.every((key) => key in (value as Record<string, unknown>));
}

export interface Snapshot {
  id: string;
  createdAt: string;
  label: string;
  data: BackupPayload;
}

const MAX_SNAPSHOTS = 30;
// Garde-fou en octets (approximatif, via la longueur JSON) : au-delà, on élague les plus
// anciens points même sous la limite de nombre, pour ne jamais saturer le quota
// localStorage (généralement 5 à 10 Mo par origine) avec un historique qui grossirait
// indéfiniment sur plusieurs mois d'utilisation.
const MAX_HISTORY_BYTES = 4_000_000;

interface BackupHistoryState {
  snapshots: Snapshot[];
  push: (data: BackupPayload, label: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

let snapshotIdCounter = 1;
const nextSnapshotId = () => `snap-${Date.now()}-${snapshotIdCounter++}`;

export const useBackupStore = create<BackupHistoryState>()(
  persist(
    (set) => ({
      snapshots: [],
      push: (data, label) =>
        set((s) => {
          const snapshot: Snapshot = { id: nextSnapshotId(), createdAt: new Date().toISOString(), label, data };
          const next = [snapshot, ...s.snapshots].slice(0, MAX_SNAPSHOTS);
          while (next.length > 1 && JSON.stringify(next).length > MAX_HISTORY_BYTES) next.pop();
          return { snapshots: next };
        }),
      remove: (id) => set((s) => ({ snapshots: s.snapshots.filter((sn) => sn.id !== id) })),
      clear: () => set({ snapshots: [] }),
    }),
    { name: 'infra-team-tracker-history' }
  )
);

function summarize(data: BackupPayload): string {
  const planned = data.planningSlots.filter((s) => s.taskId).length;
  return `${data.members.length} membres · ${data.tasks.length} tâches · ${planned} créneaux planifiés · ${data.absences.length} absences · ${data.roadmapItems.length} initiative(s) FDR`;
}

function pushSnapshotFromCurrentState(label: string) {
  try {
    useBackupStore.getState().push(extractPayload(useStore.getState()), label);
  } catch {
    // Quota localStorage dépassé ou navigateur en mode privé restrictif : on renonce
    // silencieusement à ce point d'historique plutôt que de casser l'application — la
    // sauvegarde manuelle (export fichier) reste disponible dans tous les cas.
  }
}

// ---------------------------------------------------------------------------------------
// Capture automatique : un point de restauration après chaque modification des données
// métier (regroupée avec un court délai pour éviter un point par frappe/étape lors d'un
// enchaînement rapide de changements), plus un point initial au premier chargement pour
// avoir une base à laquelle revenir même avant toute modification de la session en cours.
// ---------------------------------------------------------------------------------------
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoSnapshot() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    pushSnapshotFromCurrentState(summarize(extractPayload(useStore.getState())));
  }, 800);
}

function seedInitialSnapshotIfNeeded() {
  if (useBackupStore.getState().snapshots.length === 0) {
    pushSnapshotFromCurrentState(`État initial — ${summarize(extractPayload(useStore.getState()))}`);
  }
}

if (useStore.persist.hasHydrated()) {
  seedInitialSnapshotIfNeeded();
} else {
  useStore.persist.onFinishHydration(seedInitialSnapshotIfNeeded);
}
useStore.subscribe(() => scheduleAutoSnapshot());

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------------------
// Restauration — qu'elle vienne de l'historique automatique ou d'un fichier importé, on
// enregistre d'abord un point "avant restauration" : annuler une restauration reste donc
// toujours possible, exactement comme n'importe quelle autre modification.
// ---------------------------------------------------------------------------------------
export function restoreSnapshot(id: string) {
  const snapshot = useBackupStore.getState().snapshots.find((s) => s.id === id);
  if (!snapshot) return;
  pushSnapshotFromCurrentState(`Avant restauration du ${formatTimestamp(snapshot.createdAt)}`);
  useStore.setState(snapshot.data);
}

// ---------------------------------------------------------------------------------------
// Sauvegarde manuelle (fichier .json) — la seule des deux méthodes qui survit à un
// vidage du stockage local du navigateur ou à un changement d'appareil.
// ---------------------------------------------------------------------------------------
const BACKUP_FILE_VERSION = 1;

export function exportBackupFile() {
  const payload = extractPayload(useStore.getState());
  const wrapper = { app: 'suivi-infra-reseau', version: BACKUP_FILE_VERSION, exportedAt: new Date().toISOString(), data: payload };
  const blob = new Blob([JSON.stringify(wrapper, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sauvegarde_suivi-infra_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseBackupFile(text: string): BackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Fichier invalide : ce n'est pas un fichier JSON valide.");
  }
  const data =
    parsed && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)
      ? (parsed as Record<string, unknown>).data
      : parsed;
  if (!isBackupPayload(data)) {
    throw new Error('Fichier invalide : ce ne semble pas être une sauvegarde de cette application (champs attendus manquants).');
  }
  return data;
}

export function importBackupPayload(data: BackupPayload) {
  pushSnapshotFromCurrentState(`Avant import du ${formatTimestamp(new Date().toISOString())}`);
  useStore.setState(data);
}
