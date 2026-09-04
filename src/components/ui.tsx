import type { Priority, RoadmapDomain, RoadmapStatus, TaskStatus, TaskType } from '../types';
import type { WorkloadLevel } from '../lib/workload';
import { workloadColors } from '../lib/workload';

/**
 * Convention de couleurs — pour que les mêmes couleurs veuillent toujours dire la même
 * chose dans toute l'application, quel que soit l'onglet :
 * - rouge   : danger/urgence uniquement (priorité critique, statut FDR "Rouge", surcharge,
 *             tâche en retard). Ne jamais l'utiliser pour une simple catégorie/étiquette.
 * - ambre   : attention/avertissement (priorité haute, statut FDR "Orange", "en attente",
 *             "reporté", charge élevée).
 * - émeraude: succès/terminé (statut FDR "Vert", "terminé", charge équilibrée).
 * - bleu/ciel: en cours / information neutre (statut "en cours", "planifié", sous-charge).
 * - ardoise : neutre/inactif (à faire, idée, abandonné, priorité basse).
 * Les étiquettes purement catégorielles (type de tâche, domaine FDR) évitent délibérément
 * ces cinq couleurs pour ne jamais se faire passer pour un signal de sévérité.
 */



export function Avatar({ name, color, initials, size = 36 }: { name: string; color: string; initials: string; size?: number }) {
  return (
    <div
      title={name}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ background: color, width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

const typeStyles: Record<TaskType, string> = {
  MCO: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  // Fuchsia plutôt que rouge : "Incident" est une catégorie de tâche, pas un niveau de
  // sévérité — le rouge reste réservé à la priorité "Critique" et aux vrais signaux
  // d'alerte, pour qu'une tâche Incident de priorité Basse ne s'affiche pas comme urgente.
  Incident: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300',
  Projet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
};

export function TaskTypeBadge({ type }: { type: TaskType }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeStyles[type]}`}>{type}</span>;
}

const statusLabels: Record<TaskStatus, string> = {
  a_faire: 'À faire',
  en_cours: 'En cours',
  en_attente: 'En attente',
  termine: 'Terminé',
};
const statusStyles: Record<TaskStatus, string> = {
  a_faire: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  en_cours: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  en_attente: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  termine: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[status]}`}>{statusLabels[status]}</span>;
}

const priorityLabels: Record<Priority, string> = {
  basse: 'Basse',
  normale: 'Normale',
  haute: 'Haute',
  critique: 'Critique',
};
const priorityDot: Record<Priority, string> = {
  basse: 'bg-slate-400',
  normale: 'bg-sky-500',
  haute: 'bg-amber-500',
  critique: 'bg-red-600',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
      <span className={`h-1.5 w-1.5 rounded-full ${priorityDot[priority]}`} />
      {priorityLabels[priority]}
    </span>
  );
}

export function WorkloadBar({ ratio, level, compact = false }: { ratio: number; level: WorkloadLevel; compact?: boolean }) {
  const c = workloadColors[level];
  const pct = Math.min(ratio * 100, 130);
  return (
    <div className={compact ? 'w-full' : 'w-full'}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full ${c.bar} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

export function WorkloadPill({ level }: { level: WorkloadLevel }) {
  const c = workloadColors[level];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
}

const roadmapStatusLabels: Record<RoadmapStatus, string> = {
  idee: 'Idée',
  planifie: 'Planifié',
  en_cours: 'En cours',
  termine: 'Terminé',
  reporte: 'Reporté',
  abandonne: 'Abandonné',
};
const roadmapStatusStyles: Record<RoadmapStatus, string> = {
  idee: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  planifie: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  en_cours: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  termine: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  reporte: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  // Ardoise plutôt que rouge/rose : "Abandonné" est un état clos et neutre (comme "À
  // faire"), pas une alerte à traiter — il ne doit pas rivaliser visuellement avec le
  // rouge réservé aux statuts qui demandent une action.
  abandonne: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
};

export function RoadmapStatusBadge({ status }: { status: RoadmapStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${roadmapStatusStyles[status]}`}>{roadmapStatusLabels[status]}</span>;
}

const roadmapDomainStyles: Record<RoadmapDomain, string> = {
  Infrastructure: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  Réseau: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  // Fuchsia plutôt que rouge : le domaine "Sécurité" est une catégorie, pas un signal
  // d'alerte — une initiative Sécurité au statut "Idée" ne doit pas sembler urgente.
  Sécurité: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300',
  Cloud: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  // Teal plutôt que vert/émeraude : évite qu'une initiative "Poste de travail" ait l'air
  // d'être déjà "en succès" simplement à cause de sa couleur de domaine.
  'Poste de travail': 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  Autre: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export function RoadmapDomainBadge({ domain }: { domain: RoadmapDomain }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${roadmapDomainStyles[domain]}`}>{domain}</span>;
}

/** Bouton d'impression/export PDF, identique sur chaque onglet — masqué lui-même à l'impression. */
export function PrintButton({ label = 'Imprimer / PDF' }: { label?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="btn-ghost print:hidden"
      title="Ouvre la boîte de dialogue d'impression du navigateur — choisissez « Enregistrer en PDF » pour exporter en fichier"
    >
      {label}
    </button>
  );
}

/**
 * En-tête visible uniquement à l'impression (l'en-tête habituel de l'application, avec le
 * logo et la navigation, est masqué via `print:hidden` sur le `<header>` — voir App.tsx) :
 * donne le contexte (nom de l'appli, onglet, date de génération) sur le document imprimé.
 */
export function PrintHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="hidden print:block">
      <div className="text-lg font-bold text-black">Suivi Infra & Réseau — {title}</div>
      {subtitle && <div className="text-sm text-slate-600">{subtitle}</div>}
      <div className="text-xs text-slate-500">Généré le {new Date().toLocaleString('fr-FR')}</div>
      <hr className="my-2 border-slate-300" />
    </div>
  );
}

const ragLabels: Record<'vert' | 'orange' | 'rouge', string> = { vert: 'Vert', orange: 'Orange', rouge: 'Rouge' };
const ragStyles: Record<'vert' | 'orange' | 'rouge', string> = {
  vert: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  orange: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  rouge: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
};

export function RagBadge({ rag }: { rag: 'vert' | 'orange' | 'rouge' }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ragStyles[rag]}`}>{ragLabels[rag]}</span>;
}

/** Sélecteur de mode d'affichage (Tableau/Kanban/..., Grille/Liste/...) — même style sur tous les onglets. */
export function ModeSwitcher<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 print:hidden">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1.5 transition-colors ${
            value === o.value
              ? 'bg-white text-violet-700 shadow-sm dark:bg-slate-900 dark:text-violet-300'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {children}
    </div>
  );
}
