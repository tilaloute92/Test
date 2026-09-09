import { Fragment, useEffect, useState } from 'react';
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
import { CopilView } from './components/CopilView';
import { clearLastRepairReport, getLastRepairReport } from './lib/repairIds';
import { useStore } from './store/useStore';
import { isAuthConfigured, signIn as msalLoginOnly, signInWithIdToken, trySilentAccount, signOut as msalSignOut } from './auth/msalClient';
import { backendAvailable, backendLogout, finalizeSsoSession, getBackendSession, loginLdap, loginLocal, type BackendUser } from './auth/backendAuth';
import { setSyncActive, onSyncError, setLinkState } from './lib/syncState';
import { getMode, recordProbe, switchToLocalMode } from './lib/serverMode';
import { useAppMode, useLinkState } from './hooks/useAppStatus';
import { initializeServer } from './lib/serverSync';
import { useServerSync } from './hooks/useServerSync';
import { useConfirm } from './components/ConfirmProvider';
import { countArchived, readLocalArchive } from './lib/localArchive';
import type { AccountInfo } from '@azure/msal-browser';

export type Tab = 'dashboard' | 'daily' | 'planning' | 'tasks' | 'time' | 'team' | 'api' | 'report' | 'roadmap' | 'copils' | 'settings';

type TabGroup = 'quotidien' | 'pilotage' | 'admin';

// Regroupement purement visuel (un séparateur entre groupes dans la barre de navigation) —
// pensé pour distinguer l'usage au jour le jour du pilotage et de l'administration, sans
// complexifier le routage : chaque onglet reste indépendant, seul l'affichage groupe.
const TABS: { id: Tab; label: string; group: TabGroup }[] = [
  { id: 'dashboard', label: "Vue d'ensemble", group: 'quotidien' },
  { id: 'daily', label: 'Activité du jour', group: 'quotidien' },
  { id: 'planning', label: 'Planning', group: 'quotidien' },
  { id: 'tasks', label: 'Tâches', group: 'quotidien' },
  { id: 'time', label: 'Temps', group: 'quotidien' },
  { id: 'report', label: 'Rapport', group: 'pilotage' },
  { id: 'roadmap', label: 'FDR', group: 'pilotage' },
  { id: 'copils', label: 'COPIL', group: 'pilotage' },
  { id: 'team', label: 'Équipe', group: 'admin' },
  { id: 'api', label: 'API', group: 'admin' },
  { id: 'settings', label: 'Paramètres', group: 'admin' },
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

  // Le thème sombre imprime mal (texte clair sur fond sombre devient illisible sur papier
  // dès que l'imprimante/le navigateur n'imprime pas les couleurs de fond, ce qui est le
  // réglage par défaut le plus courant) : on bascule temporairement en clair pendant
  // l'impression, quel que soit l'onglet affiché, puis on restaure l'état choisi ensuite.
  useEffect(() => {
    const root = document.documentElement;
    const before = () => root.classList.remove('dark');
    const after = () => root.classList.toggle('dark', dark);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
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
  // Incrémenté par « Réessayer » sur l'écran d'indisponibilité, pour relancer la détection
  // sans recharger la page (et donc sans perdre la session en cours).
  const [probeTick, setProbeTick] = useState(0);
  const retryProbe = () => setProbeTick((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setChecking(true);
      const up = await backendAvailable();
      if (cancelled) return;
      // Mémorise l'architecture détectée : une fois qu'un navigateur a vu une installation
      // client/serveur, une panne du service ne le fait plus retomber en autonome — il
      // l'annonce et passe en lecture seule. Voir src/lib/serverMode.ts.
      const mode = recordProbe(up);
      setLinkState(mode === 'local' ? 'connecte' : up ? 'connecte' : 'indisponible');
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
  }, [authSettings, probeTick]);

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

  // Échanges de données actifs (voir src/lib/syncState.ts et src/hooks/useServerSync.ts) :
  // les données d'équipe ne circulent que si le serveur est joignable ET qu'une vraie session
  // serveur existe (compte local, LDAP ou SSO vérifié côté serveur) — pas juste une session
  // Microsoft gérée par le seul navigateur (msalAccount), qui n'a pas de cookie de session
  // côté serveur et à qui l'API refuserait donc tout (401).
  useEffect(() => {
    setSyncActive(backendUp && Boolean(session), session ? { username: session.username, name: session.name } : null);
  }, [backendUp, session]);

  const isAuthenticated = backendUp ? Boolean(session) : Boolean(msalAccount);
  const displayName = session?.name ?? msalAccount?.name ?? msalAccount?.username ?? null;
  // En mode client/serveur, la connexion n'est pas une option : les données vivent derrière
  // une API qui exige une session, et sans elle l'application n'aurait rien à afficher.
  // L'interrupteur « exiger la connexion » ne concerne donc que le mode autonome.
  const locked = (getMode() === 'serveur' || authSettings.requireLogin) && !checking && !isAuthenticated;

  return { checking, locked, error, backendUp, session, displayName, retryProbe, loginMicrosoft, loginLocalAccount, loginLdapAccount, logout };
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

/** Cadre commun aux écrans qui précèdent l'application (démarrage, panne, mise en service). */
function Gateway({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white">IT</div>
        {children}
      </div>
    </div>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <Gateway>
      <p className="text-center text-sm text-slate-500 dark:text-slate-400" role="status">
        {message}
      </p>
    </Gateway>
  );
}

/**
 * Serveur injoignable alors que ce navigateur sait qu'il s'agit d'une installation
 * client/serveur. On refuse d'afficher et de laisser saisir : les données sont sur le
 * serveur, et laisser travailler hors ligne produirait des modifications que personne ne
 * reverra. On propose donc de réessayer, et — explicitement, avec confirmation — de
 * basculer en autonome pour qui saurait que le serveur ne reviendra pas.
 */
function ServerUnavailableScreen({ onRetry, onSwitchLocal }: { onRetry: () => void; onSwitchLocal: () => void }) {
  return (
    <Gateway>
      <h1 className="text-center text-base font-semibold text-slate-900 dark:text-white">Serveur indisponible</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Cette installation fonctionne en <strong>mode client/serveur</strong> : les données de l'équipe sont sur le serveur, pas dans ce
        navigateur. Tant qu'il ne répond pas, l'application ne peut ni les afficher ni enregistrer de modification.
      </p>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Causes les plus fréquentes : le service <code>SuiviInfraAuth</code> est arrêté sur le serveur, ou le relais <code>/api</code> d'IIS
        ne répond plus. Prévenez l'administrateur si cela persiste.
      </p>
      <button onClick={onRetry} className="mt-4 w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
        Réessayer
      </button>
      <button onClick={onSwitchLocal} className="mt-3 w-full text-center text-xs text-slate-400 hover:text-violet-600 dark:hover:text-violet-400">
        Travailler en mode autonome sur ce poste
      </button>
    </Gateway>
  );
}

/**
 * Première utilisation : le serveur n'a jamais été mis en service. Deux départs possibles,
 * présentés côte à côte parce que le bon choix dépend de l'historique de l'équipe — et non
 * d'un défaut de l'un ou de l'autre.
 */
function FirstRunScreen({ onInitialized }: { onInitialized: () => void }) {
  const archive = readLocalArchive();
  const [busy, setBusy] = useState<'vide' | 'reprise' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const run = async (kind: 'vide' | 'reprise') => {
    if (
      !(await confirm({
        title: kind === 'vide' ? 'Démarrer avec un serveur vide' : 'Reprendre les données de ce poste',
        message:
          kind === 'vide'
            ? "Le serveur démarrera sans aucune donnée : vous créerez l'équipe depuis l'onglet Équipe. Cette mise en service n'a lieu qu'une fois — ensuite, le serveur refusera toute nouvelle initialisation pour protéger le travail de l'équipe."
            : `Les ${archive ? countArchived(archive) : 0} enregistrement(s) conservés sur ce poste deviendront les données de référence de toute l'équipe. À ne faire que depuis le poste qui détient les bonnes données. Cette mise en service n'a lieu qu'une fois.`,
        confirmLabel: kind === 'vide' ? 'Démarrer à vide' : 'Reprendre ces données',
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      await initializeServer(kind === 'reprise' && archive ? archive.data : undefined);
      onInitialized();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Gateway>
      <h1 className="text-center text-base font-semibold text-slate-900 dark:text-white">Mise en service du serveur</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Le serveur ne contient encore aucune donnée d'équipe. Choisissez son point de départ — <strong>une seule fois, par une seule
        personne</strong> : les autres postes basculeront dessus automatiquement.
      </p>

      <button
        onClick={() => run('vide')}
        disabled={busy !== null}
        className="mt-4 w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
      >
        {busy === 'vide' ? 'Mise en service…' : 'Démarrer avec un serveur vide'}
      </button>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">L'équipe et les tâches se saisissent ensuite dans l'application.</p>

      {archive && (
        <>
          <div className="my-4 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-300 dark:text-slate-600">
            <hr className="flex-1 border-slate-200 dark:border-slate-700" /> ou <hr className="flex-1 border-slate-200 dark:border-slate-700" />
          </div>
          <button
            onClick={() => run('reprise')}
            disabled={busy !== null}
            className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
          >
            {busy === 'reprise' ? 'Mise en service…' : `Reprendre les ${countArchived(archive)} enregistrement(s) de ce poste`}
          </button>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Ce poste utilisait l'application en autonome jusqu'au {new Date(archive.archivedAt).toLocaleDateString('fr-FR')}. Ses données
            ont été conservées et peuvent servir de point de départ commun.
          </p>
        </>
      )}

      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </Gateway>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const { dark, setDark } = useTheme();
  const authGate = useAuthGate();
  const sync = useServerSync();
  const mode = useAppMode();
  const link = useLinkState();
  const confirm = useConfirm();
  const memberCount = useStore((s) => s.members.length);

  const [syncError, setSyncError] = useState<string | null>(null);
  // Réparation d'identifiants dupliqués au chargement (voir src/lib/repairIds.ts) : on le
  // dit à l'utilisateur, parce que les affectations qui visaient un identifiant dupliqué
  // sont restées sur le premier enregistrement et méritent une relecture de sa part.
  const [repairReport, setRepairReport] = useState(() => getLastRepairReport());
  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onSyncError((message) => {
      setSyncError(message);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setSyncError(null), 8000);
    });
    return () => {
      unsubscribe();
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  const goToMember = () => setTab('planning');

  /**
   * Sortie volontaire du mode client/serveur. Confirmation obligatoire : ce n'est pas un
   * réglage d'affichage, c'est un changement de source de vérité, et la personne doit savoir
   * que ce qu'elle saisira ensuite ne rejoindra pas le serveur.
   */
  const switchLocal = async () => {
    if (
      await confirm({
        title: 'Passer en mode autonome sur ce poste',
        message:
          "L'application cessera de dialoguer avec le serveur et travaillera sur les données de CE navigateur uniquement. Ce que vous saisirez ensuite ne sera pas visible par l'équipe et ne rejoindra pas le serveur, même à son retour. À ne faire que si vous savez que le serveur ne reviendra pas.",
        confirmLabel: 'Passer en autonome',
        danger: true,
      })
    ) {
      switchToLocalMode();
      window.location.reload();
    }
  };

  // ------------------------------------------------------------------------------------
  // Écrans qui précèdent l'application, dans l'ordre où les questions se posent :
  // sait-on où sont les données ? le serveur répond-il ? qui êtes-vous ? les données
  // sont-elles arrivées ? le serveur a-t-il déjà été mis en service ?
  // ------------------------------------------------------------------------------------
  if (authGate.checking) return <LoadingScreen message="Démarrage…" />;

  if (mode === 'serveur' && (!authGate.backendUp || link === 'indisponible')) {
    // On refuse d'afficher l'application plutôt que de la laisser en lecture avec des
    // écritures qui échoueraient : une saisie perdue coûte plus cher qu'un écran d'attente.
    // Le sondage continue en arrière-plan, l'écran disparaît de lui-même au retour du serveur.
    return <ServerUnavailableScreen onRetry={authGate.retryProbe} onSwitchLocal={switchLocal} />;
  }

  if (authGate.locked) return <LockScreen authGate={authGate} />;

  if (mode === 'serveur') {
    if (!sync.hydrated) return <LoadingScreen message="Chargement des données de l'équipe…" />;
    if (sync.initialized === false) return <FirstRunScreen onInitialized={sync.refresh} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur print:hidden dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white">IT</div>
            <div>
              <div className="text-sm font-semibold leading-tight">Suivi Infra & Réseau</div>
              {/* L'effectif était écrit en dur (« 6 personnes ») : sur un serveur fraîchement
                  mis en service, l'en-tête annonçait donc une équipe qui n'existait pas encore. */}
              <div className="text-[11px] leading-tight text-slate-400">
                Activité d'équipe · {memberCount} personne{memberCount > 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <nav className="ml-4 hidden flex-1 items-center gap-0.5 overflow-x-auto md:flex">
            {TABS.map((t, i) => (
              <Fragment key={t.id}>
                {i > 0 && TABS[i - 1].group !== t.group && <span className="mx-1.5 h-5 w-px shrink-0 bg-slate-200 dark:bg-slate-700" aria-hidden="true" />}
                <button
                  onClick={() => setTab(t.id)}
                  className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    tab === t.id
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  {t.label}
                </button>
              </Fragment>
            ))}
          </nav>
          {authGate.displayName && (
            <div className="ml-auto hidden max-w-[220px] items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 md:flex">
              {/* Le mode n'est jamais implicite : un point vert = les données viennent du
                  serveur et y retournent ; pas de point = ce poste travaille seul. */}
              {mode === 'serveur' && authGate.session && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                  title="Mode client/serveur : les données de l'équipe sont sur le serveur, et vos modifications y sont enregistrées."
                  aria-hidden="true"
                />
              )}
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
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-slate-100 px-4 py-2 md:hidden dark:border-slate-800">
          {TABS.map((t, i) => (
            <Fragment key={t.id}>
              {i > 0 && TABS[i - 1].group !== t.group && <span className="mx-1 h-5 w-px shrink-0 bg-slate-200 dark:bg-slate-700" aria-hidden="true" />}
              <button
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                  tab === t.id ? 'bg-violet-600 text-white' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {t.label}
              </button>
            </Fragment>
          ))}
        </nav>
      </header>

      {repairReport && (
        <div className="mx-auto mt-3 max-w-7xl px-4 print:hidden">
          <div className="flex items-start justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            <span>
              <strong>{repairReport.total} enregistrement(s) portaient le même identifiant</strong> (anomalie d'une version précédente) et
              viennent d'être corrigés automatiquement au chargement. Les affectations qui pointaient vers un identifiant dupliqué sont
              restées sur le premier enregistrement : vérifiez les assignations des membres et tâches concernés.
            </span>
            <button
              onClick={() => {
                clearLastRepairReport();
                setRepairReport(null);
              }}
              className="shrink-0 hover:underline"
            >
              J'ai compris
            </button>
          </div>
        </div>
      )}

      {syncError && (
        <div className="mx-auto mt-3 max-w-7xl px-4 print:hidden">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            <span>{syncError}</span>
            <button onClick={() => setSyncError(null)} className="shrink-0 hover:underline">
              Fermer
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab === 'dashboard' && <Dashboard onSelectMember={goToMember} onNavigate={setTab} />}
        {tab === 'daily' && <DailyView />}
        {tab === 'planning' && <PlanningView />}
        {tab === 'tasks' && <TasksView />}
        {tab === 'time' && <TimeTrackingView />}
        {tab === 'team' && <TeamView />}
        {tab === 'api' && <ApiConsoleView />}
        {tab === 'report' && <WeeklyReportView />}
        {tab === 'roadmap' && <RoadmapView />}
        {tab === 'copils' && <CopilView />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

export default App;
