import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import type { User } from './api';
import { Brand, useToast } from './components/ui';
import { LoginScreen } from './components/LoginScreen';
import { PlansLibrary } from './components/PlansLibrary';
import { PlanView } from './components/PlanView';
import { SearchView } from './components/SearchView';
import { SettingsView } from './components/SettingsView';
import { RouteView } from './components/RouteView';

/**
 * Navigation par l'ancre de l'adresse (#/plans, #/plan/<id>?eq=<id>, #/recherche…) :
 * le bouton Précédent du navigateur fonctionne, et un lien vers un équipement précis peut
 * être partagé avec un collègue (il devra être connecté pour l'ouvrir).
 */
export type Route =
  | { page: 'plans' }
  | { page: 'plan'; id: string; eq?: string }
  | { page: 'recherche'; q?: string }
  | { page: 'trace'; de?: string; a?: string }
  | { page: 'parametres' };

function parseHash(): Route {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const [a, b] = path.split('/');
  if (a === 'plan' && b) return { page: 'plan', id: b, eq: params.get('eq') || undefined };
  if (a === 'recherche') return { page: 'recherche', q: params.get('q') || undefined };
  if (a === 'parametres') return { page: 'parametres' };
  if (a === 'trace') return { page: 'trace', de: params.get('de') || undefined, a: params.get('a') || undefined };
  return { page: 'plans' };
}

export function hrefOf(r: Route): string {
  switch (r.page) {
    case 'plan': return `#/plan/${r.id}${r.eq ? `?eq=${encodeURIComponent(r.eq)}` : ''}`;
    case 'recherche': return `#/recherche${r.q ? `?q=${encodeURIComponent(r.q)}` : ''}`;
    case 'parametres': return '#/parametres';
    case 'trace': {
      const qs = new URLSearchParams(Object.entries({ de: r.de, a: r.a }).filter(([, v]) => v) as [string, string][]).toString();
      return `#/trace${qs ? `?${qs}` : ''}`;
    }
    default: return '#/plans';
  }
}
export const navigate = (r: Route) => { window.location.hash = hrefOf(r); };

type Theme = 'system' | 'light' | 'dark';
function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('plan-relief:theme') as Theme) || 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try { localStorage.setItem('plan-relief:theme', theme); } catch { /* stockage indisponible */ }
  }, [theme]);
  return { theme, cycle: () => setTheme((t) => (t === 'system' ? 'dark' : t === 'dark' ? 'light' : 'system')) };
}

const METHOD_LABELS = { local: 'compte local', ldap: 'Active Directory', sso: 'Microsoft' } as const;

export default function App() {
  const [status, setStatus] = useState<'checking' | 'down' | 'login' | 'ready'>('checking');
  const [user, setUser] = useState<User | null>(null);
  const [route, setRoute] = useState<Route>(parseHash);
  const [navCount, setNavCount] = useState(0);
  const { theme, cycle } = useTheme();
  const toast = useToast();

  const check = useCallback(async () => {
    setStatus('checking');
    if (!(await api.health())) { setStatus('down'); return; }
    const u = await api.getSession();
    setUser(u);
    setStatus(u ? 'ready' : 'login');
  }, []);

  useEffect(() => { check(); }, [check]);
  useEffect(() => {
    // Chaque navigation compte, même vers une adresse identique : un lien de tracé rouvert
    // après des changements faits sur la page doit recalculer le tracé du lien.
    const onHash = () => { setNavCount((n) => n + 1); setRoute(parseHash()); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      setUser(null);
      setStatus('login');
      toast('Votre session a expiré. Reconnectez-vous pour continuer.', 'warn');
    });
  }, [toast]);

  if (status === 'checking') {
    return <div className="center-screen"><div className="muted mono">Connexion au serveur…</div></div>;
  }
  if (status === 'down') {
    return (
      <div className="center-screen">
        <div className="login">
          <Brand />
          <div className="notice error">
            <p><strong>Serveur indisponible.</strong></p>
            <p>Le service Plan Relief ne répond pas. Les plans sont stockés sur le serveur : rien ne peut être consulté ni modifié tant qu'il n'est pas joignable.</p>
            <p className="small">Administrateur : vérifiez le service Windows <code>PlanReliefSvc</code> et son journal <code>service.err.log</code>.</p>
          </div>
          <button type="button" className="btn primary" onClick={check}>Réessayer</button>
        </div>
      </div>
    );
  }
  if (status === 'login' || !user) {
    return <LoginScreen onLogin={(u) => { setUser(u); setStatus('ready'); }} />;
  }

  const doLogout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setStatus('login');
  };
  const nav = (page: Route['page'], label: string) => (
    <a href={hrefOf({ page } as Route)} aria-current={route.page === page || (page === 'plans' && route.page === 'plan') ? 'page' : undefined}>{label}</a>
  );

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <nav className="nav" aria-label="Navigation principale">
          {nav('plans', 'Plans')}
          {nav('recherche', 'Recherche')}
          {nav('trace', 'Tracés')}
          {nav('parametres', 'Paramètres')}
        </nav>
        <div className="spacer" />
        <div className="userbox">
          <button type="button" className="btn ghost sm" onClick={cycle} title="Changer de thème">
            {theme === 'system' ? 'Thème : système' : theme === 'dark' ? 'Thème : sombre' : 'Thème : clair'}
          </button>
          <div className="who">
            <span>{user.name || user.username}</span>
            {user.method && <span className="method">{METHOD_LABELS[user.method]}</span>}
          </div>
          <button type="button" className="btn sm" onClick={doLogout}>Se déconnecter</button>
        </div>
      </header>
      <main className={`content${route.page === 'plan' || route.page === 'trace' ? ' full' : ''}`}>
        {route.page === 'plans' && <PlansLibrary />}
        {route.page === 'plan' && <PlanView key={route.id} id={route.id} focusEq={route.eq} />}
        {route.page === 'recherche' && <SearchView initialQuery={route.q} />}
        {route.page === 'parametres' && <SettingsView />}
        {route.page === 'trace' && <RouteView key={navCount} de={route.de} a={route.a} />}
      </main>
    </div>
  );
}
