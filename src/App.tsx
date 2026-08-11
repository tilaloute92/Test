import { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { DailyView } from './components/DailyView';
import { PlanningView } from './components/PlanningView';
import { TasksView } from './components/TasksView';
import { TimeTrackingView } from './components/TimeTrackingView';
import { TeamView } from './components/TeamView';

type Tab = 'dashboard' | 'daily' | 'planning' | 'tasks' | 'time' | 'team';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: "Vue d'ensemble" },
  { id: 'daily', label: 'Activité du jour' },
  { id: 'planning', label: 'Planning 3 semaines' },
  { id: 'tasks', label: 'Tâches & incidents' },
  { id: 'time', label: 'Temps' },
  { id: 'team', label: 'Équipe' },
];

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return { dark, setDark };
}

function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const { dark, setDark } = useTheme();

  const goToMember = () => setTab('planning');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white">IT</div>
            <div>
              <div className="text-sm font-semibold leading-tight">Suivi Infra & Réseau</div>
              <div className="text-[11px] leading-tight text-slate-400">Activité d'équipe · 6 personnes</div>
            </div>
          </div>
          <nav className="ml-4 hidden flex-1 items-center gap-1 overflow-x-auto md:flex">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <button
            onClick={() => setDark((d) => !d)}
            className="ml-auto rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-700"
            title="Basculer le thème"
          >
            {dark ? '☀️' : '🌙'}
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-2 md:hidden dark:border-slate-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                tab === t.id ? 'bg-violet-600 text-white' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === 'dashboard' && <Dashboard onSelectMember={goToMember} />}
        {tab === 'daily' && <DailyView />}
        {tab === 'planning' && <PlanningView />}
        {tab === 'tasks' && <TasksView />}
        {tab === 'time' && <TimeTrackingView />}
        {tab === 'team' && <TeamView />}
      </main>
    </div>
  );
}

export default App;
