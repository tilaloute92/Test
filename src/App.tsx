import { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { DailyView } from './components/DailyView';
import { PlanningView } from './components/PlanningView';
import { TasksView } from './components/TasksView';
import { TimeTrackingView } from './components/TimeTrackingView';
import { TeamView } from './components/TeamView';
import { ApiConsoleView } from './components/ApiConsoleView';
import { SettingsView } from './components/SettingsView';
import { WeeklyReportView } from './components/WeeklyReportView';
import { useStore } from './store/useStore';
import { isAuthConfigured, signIn, trySilentAccount, signOut } from './auth/msalClient';
import type { AccountInfo } from '@azure/msal-browser';

type Tab = 'dashboard' | 'daily' | 'planning' | 'tasks' | 'time' | 'team' | 'api' | 'report' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: "Vue d'ensemble" },
  { id: 'daily', label: 'Activité du jour' },
  { id: 'planning', label: 'Planning' },
  { id: 'tasks', label: 'Tâches' },
  { id: 'time', label: 'Temps' },
  { id: 'team', label: 'Équipe' },
  { id: 'api', label: 'API' },
  { id: 'report', label: 'Rapport' },
  { id: 'settings', label: 'Paramètres' },
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

/**
 * Login gate: only active when the admin has enabled "Exiger la connexion" in
 * Paramètres. It first tries a silent check (an account cached from a previous
 * session — this is what makes return visits "automatic"), and only shows an
 * interactive sign-in screen if that fails. The gate always leaves a way to reach
 * Paramètres even while locked out, so a misconfigured tenant/client ID can never
 * lock the admin out of fixing it.
 */
function useAuthGate() {
  const { authSettings } = useStore();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authSettings.requireLogin) {
      setChecking(false);
      return;
    }
    setChecking(true);
    trySilentAccount(authSettings)
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setChecking(false));
  }, [authSettings]);

  const login = async () => {
    setError(null);
    try {
      const acc = await signIn(authSettings);
      setAccount(acc);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const logout = async () => {
    try {
      await signOut(authSettings);
    } finally {
      setAccount(null);
    }
  };

  const locked = authSettings.requireLogin && !checking && !account;
  return { account, checking, locked, error, login, logout };
}

function LockScreen({ error, onLogin }: { error: string | null; onLogin: () => void }) {
  const { authSettings } = useStore();
  const [showSettings, setShowSettings] = useState(false);

  if (showSettings) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <button onClick={() => setShowSettings(false)} className="mb-4 text-sm text-violet-600 hover:underline dark:text-violet-400">
          ← Retour à l'écran de connexion
        </button>
        <SettingsView />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white">IT</div>
        <h1 className="text-base font-semibold text-slate-900 dark:text-white">Suivi Infra & Réseau</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Connexion requise pour accéder à l'application.</p>
        <button
          onClick={onLogin}
          disabled={!isAuthConfigured(authSettings)}
          className="mt-4 w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
        >
          Se connecter avec Microsoft
        </button>
        {!isAuthConfigured(authSettings) && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">La connexion SSO n'est pas encore configurée.</p>
        )}
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <button onClick={() => setShowSettings(true)} className="mt-4 text-xs text-slate-400 hover:text-violet-600 dark:hover:text-violet-400">
          Paramètres de connexion
        </button>
      </div>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const { dark, setDark } = useTheme();
  const { account, checking, locked, error, login, logout } = useAuthGate();

  const goToMember = () => setTab('planning');

  if (checking) return null;
  if (locked) return <LockScreen error={error} onLogin={login} />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur print:hidden dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white">IT</div>
            <div>
              <div className="text-sm font-semibold leading-tight">Suivi Infra & Réseau</div>
              <div className="text-[11px] leading-tight text-slate-400">Activité d'équipe · 6 personnes</div>
            </div>
          </div>
          <nav className="ml-4 hidden flex-1 items-center gap-0.5 overflow-x-auto md:flex">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {account && (
            <div className="ml-auto hidden items-center gap-2 text-xs text-slate-500 dark:text-slate-400 md:flex">
              <span>{account.name ?? account.username}</span>
              <button onClick={logout} className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                Déconnexion
              </button>
            </div>
          )}
          <button
            onClick={() => setDark((d) => !d)}
            className={`${account ? '' : 'ml-auto'} rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-700`}
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

      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab === 'dashboard' && <Dashboard onSelectMember={goToMember} />}
        {tab === 'daily' && <DailyView />}
        {tab === 'planning' && <PlanningView />}
        {tab === 'tasks' && <TasksView />}
        {tab === 'time' && <TimeTrackingView />}
        {tab === 'team' && <TeamView />}
        {tab === 'api' && <ApiConsoleView />}
        {tab === 'report' && <WeeklyReportView />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

export default App;
