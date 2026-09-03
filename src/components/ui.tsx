import type { Priority, RoadmapDomain, RoadmapStatus, TaskStatus, TaskType } from '../types';
import type { WorkloadLevel } from '../lib/workload';
import { workloadColors } from '../lib/workload';

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
  Incident: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
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
  abandonne: 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300',
};

export function RoadmapStatusBadge({ status }: { status: RoadmapStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${roadmapStatusStyles[status]}`}>{roadmapStatusLabels[status]}</span>;
}

const roadmapDomainStyles: Record<RoadmapDomain, string> = {
  Infrastructure: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  Réseau: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  Sécurité: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  Cloud: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  'Poste de travail': 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
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

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {children}
    </div>
  );
}
