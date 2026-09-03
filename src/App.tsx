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
import { RoadmapView } from './components/RoadmapView';
import { useStore } from './store/useStore';
import { isAuthConfigured, signIn as msalLoginOnly, signInWithIdToken, trySilentAccount, signOut as msalSignOut } from './auth/msalClient';
import { backendAvailable, backendLogout, finalizeSsoSession, getBackendSession, loginLdap, loginLocal, type BackendUser } from './auth/backendAuth';
import type { AccountInfo } from '@azure/msal-browser';

type Tab = 'dashboard' | 'daily' | 'planning' | 'tasks' | 'time' | 'team' | 'api' | 'report' | 'roadmap' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: "Vue d'ensemble" },
  { id: 'daily', label: 'Activité du jour' },
  { id: 'planning', label: 'Planning' },
  { id: 'tasks', label: 'Tâches' },
  { id: 'time', label: 'Temps' },
  { id: 'team', label: 'Équipe' },
  { id: 'api', label: 'API' },
  { id: 'report', label: 'Rapport' },
  { id: 'roadmap', label: 'FDR' },
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
 * Porte d'authentification. Deux modes selon qu'un serveur d'authentification
 * (server/) est joignable ou non :
 *
 * - Backend joignable : c'est LUI qui décide qui est connecté (cookie de session
 *   httpOnly vérifié à chaque appel). Trois façons d'obtenir cette session :
 *   compte local, identifiants LDAP/Active Directory, ou connexion Microsoft
 *   (le jeton obtenu côté navigateur est envoyé au serveur, qui vérifie sa
 *   signature avant d'ouvrir la session — voir server/src/auth/ssoAuth.js).
 * - Pas de backend : on retombe sur le fonctionnement précédent (SSO Microsoft
 *   géré uniquement côté navigateur via MSAL) — l'application reste utilisable
 *   sans serveur, avec une seule méthode de connexion disponible.
 *
 * Dans les deux cas, la page Paramètres reste accessible depuis l'écran de
 * connexion pour ne jamais s'enfermer dehors avec une mauvaise configuration.
 */
function useAuthGate() {
  const { authSettings } = useStore();
  const [backendUp, setBackendUp] = useState(false);
  const [session, setSession] = useState<BackendUser | null>(null);
  const [msalAccount, setMsalAccount] = useState<AccountInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setChecking(true);
      const up = await backendAvailable();
      if (cancelled) return;
      setBackendUp(up);
      if (up) {
        const me = await getBackendSession();
        if (!cancelled) setSession(me);
      } else if (authSettings.requireLogin) {
        const acc = await trySilentAccount(authSettings).catch(() => null);
        if (!cancelled) setMsalAccount(acc);
      }
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authSettings]);

  const loginMicrosoft = async () => {
    setError(null);
    try {
      if (backendUp) {
        const { idToken } = await signInWithIdToken(authSettings);
        setSession(await finalizeSsoSession(idToken));
      } else {
        setMsalAccount(await msalLoginOnly(authSettings));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loginLocalAccount = async (username: string, password: string) => {
    setError(null);
    try {
      setSession(await loginLocal(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loginLdapAccount = async (username: string, password: string) => {
    setError(null);
    try {
      setSession(await loginLdap(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const logout = async () => {
    try {
      if (backendUp) await backendLogout();
      if (msalAccount) await msalSignOut(authSettings).catch(() => {});
    } finally {
      setSession(null);
      setMsalAccount(null);
    }
  };

  const isAuthenticated = backendUp ? Boolean(session) : Boolean(msalAccount);
  const displayName = session?.name ?? msalAccount?.name ?? msalAccount?.username ?? null;
  const locked = authSettings.requireLogin && !checking && !isAuthenticated;

  return { checking, locked, error, backendUp, displayName, loginMicrosoft, loginLocalAccount, loginLdapAccount, logout };
}

type AuthGate = ReturnType<typeof useAuthGate>;

function LockScreen({ authGate }: { authGate: AuthGate }) {
  const { authSettings } = useStore();
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<'local' | 'ldap' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

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

  const submit = async () => {
    if (!mode || !username || !password) return;
    setBusy(true);
    if (mode === 'local') await authGate.loginLocalAccount(username, password);
    else await authGate.loginLdapAccount(username, password);
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white">IT</div>
        <h1 className="text-base font-semibold text-slate-900 dark:text-white">Suivi Infra & Réseau</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Connexion requise pour accéder à l'application.</p>

        <button
          onClick={authGate.loginMicrosoft}
          disabled={!isAuthConfigured(authSettings)}
          className="mt-4 w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
        >
          Se connecter avec Microsoft
        </button>
        {!isAuthConfigured(authSettings) && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">La connexion SSO n'est pas encore configurée.</p>
        )}

        {authGate.backendUp && (
          <>
            <div className="my-4 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-300 dark:text-slate-600">
              <hr className="flex-1 border-slate-200 dark:border-slate-700" /> ou <hr className="flex-1 border-slate-200 dark:border-slate-700" />
            </div>
            <div className="flex gap-2">
              {(['local', 'ldap'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ${
                    mode === m ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {m === 'local' ? 'Compte local' : 'Identifiant Windows / LDAP'}
                </button>
              ))}
            </div>
            {mode && (
              <div className="mt-3 space-y-2 text-left">
                <input
                  placeholder="Identifiant"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input"
                  autoComplete="username"
                />
                <input
                  type="password"
                  placeholder="Mot de passe"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  className="input"
                  autoComplete="current-password"
                />
                <button
                  onClick={submit}
                  disabled={busy || !username || !password}
                  className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
                >
                  {busy ? 'Connexion…' : 'Se connecter'}
                </button>
              </div>
            )}
          </>
        )}

        {authGate.error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{authGate.error}</p>}
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
  const authGate = useAuthGate();

  const goToMember = () => setTab('planning');

  if (authGate.checking) return null;
  if (authGate.locked) return <LockScreen authGate={authGate} />;

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
          {authGate.displayName && (
            <div className="ml-auto hidden max-w-[160px] items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 md:flex">
              <span className="truncate" title={authGate.displayName}>
                {authGate.displayName.split(' ')[0]}
              </span>
              <button onClick={authGate.logout} className="shrink-0 text-slate-400 hover:text-violet-600 hover:underline dark:hover:text-violet-400">
                Déconnexion
              </button>
            </div>
          )}
          <button
            onClick={() => setDark((d) => !d)}
            className={`${authGate.displayName ? '' : 'ml-auto'} rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-700`}
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
        {tab === 'roadmap' && <RoadmapView />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

export default App;
