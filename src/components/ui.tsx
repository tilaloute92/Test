import type { Priority, TaskStatus, TaskType } from '../types';
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

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {children}
    </div>
  );
}
