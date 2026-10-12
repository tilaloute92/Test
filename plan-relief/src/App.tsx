import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import type { User } from './api';
import { Brand, Icon, useToast, type IconName } from './components/ui';
import { LoginScreen } from './components/LoginScreen';
import { PlansLibrary } from './components/PlansLibrary';
import { PlanView } from './components/PlanView';
import { SearchView } from './components/SearchView';
import { SettingsView } from './components/SettingsView';
import { UserContext } from './components/session';
import { RouteView } from './components/RouteView';
import { SavedRoutesView } from './components/SavedRoutesView';

/**
 * Navigation par l'ancre de l'adresse (#/plans, #/plan/<id>?eq=<id>, #/recherche…) :
 * le bouton Précédent du navigateur fonctionne, et un lien vers un équipement précis peut
 * être partagé avec un collègue (il devra être connecté pour l'ouvrir).
 */
export type Route =
  | { page: 'plans' }
  | { page: 'plan'; id: string; eq?: string }
  | { page: 'recherche'; q?: string }
  | { page: 'trace'; de?: string; a?: string; plus?: string; h?: string; m?: string; o?: string; w?: string; k?: string; r?: string }
  | { page: 'traces' }
  | { page: 'parametres' };

function parseHash(): Route {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const [a, b] = path.split('/');
  if (a === 'plan' && b) return { page: 'plan', id: b, eq: params.get('eq') || undefined };
  if (a === 'recherche') return { page: 'recherche', q: params.get('q') || undefined };
  if (a === 'parametres') return { page: 'parametres' };
  if (a === 'traces') return { page: 'traces' };
  if (a === 'trace') {
    const g = (k: string) => params.get(k) || undefined;
    return { page: 'trace', de: g('de'), a: g('a'), plus: g('plus'), h: g('h'), m: g('m'), o: g('o'), w: g('w'), k: g('k'), r: g('r') };
  }
  return { page: 'plans' };
}

export function hrefOf(r: Route): string {
  switch (r.page) {
    case 'plan': return `#/plan/${r.id}${r.eq ? `?eq=${encodeURIComponent(r.eq)}` : ''}`;
    case 'recherche': return `#/recherche${r.q ? `?q=${encodeURIComponent(r.q)}` : ''}`;
    case 'parametres': return '#/parametres';
    case 'traces': return '#/traces';
    case 'trace': {
      const { page: _p, ...rest } = r;
      const qs = new URLSearchParams(Object.entries(rest).filter(([, v]) => v) as [string, string][]).toString();
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

/** Numéro de version seul (1.1.0), sans la date de construction. */
const APP_SEMVER = __APP_VERSION__.split(' ')[0];

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
  // Poste qui affiche encore une ancienne version gardée en cache après une mise à jour du serveur.
  useEffect(() => {
    if (status === 'ready' && api.serverVersion && api.serverVersion !== APP_SEMVER) {
      toast(`Le serveur est en version ${api.serverVersion}, cette page en ${APP_SEMVER} : actualisez la page (Ctrl+F5).`, 'warn');
    }
  }, [status, toast]);
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
            <p className="small">Administrateur : vérifiez le service Windows <code>PlanReliefSvc</code> (ou la tâche planifiée « Plan Relief - Service » en installation sans NSSM) et le journal <code>service.err.log</code>.</p>
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
  const nav = (page: Route['page'], label: string, icon: IconName) => (
    <a href={hrefOf({ page } as Route)} aria-current={route.page === page || (page === 'plans' && route.page === 'plan') || (page === 'trace' && route.page === 'traces') ? 'page' : undefined}><Icon name={icon} /> {label}</a>
  );
  const display = user.name || user.username;
  const initials = display.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

  return (
    <UserContext.Provider value={user}>
    <div className="shell">
      <header className="topbar">
        <div className="brand-v">
          <Brand />
          <span className="version" title={`Plan Relief ${__APP_VERSION__}${api.serverVersion ? ` · service ${api.serverVersion}` : ''}`}>v{APP_SEMVER}</span>
        </div>
        <nav className="nav" aria-label="Navigation principale">
          {nav('plans', 'Plans', 'plans')}
          {nav('recherche', 'Recherche', 'search')}
          {nav('trace', 'Tracés', 'route')}
          {user.role === 'admin' && nav('parametres', 'Paramètres', 'settings')}
        </nav>
        <div className="spacer" />
        <div className="userbox">
          <button type="button" className="btn ghost icon-btn" onClick={cycle} title={theme === 'system' ? 'Thème : système (cliquer pour sombre)' : theme === 'dark' ? 'Thème : sombre (cliquer pour clair)' : 'Thème : clair (cliquer pour système)'} aria-label="Changer de thème">
            <Icon name={theme === 'system' ? 'auto' : theme === 'dark' ? 'moon' : 'sun'} size={18} />
          </button>
          <div className="who">
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span className="who-t">
              <span className="who-name">{display}</span>
              <span className="method">{[user.method && METHOD_LABELS[user.method], user.role === 'admin' ? 'administrateur' : 'lecteur'].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
          <button type="button" className="btn ghost icon-btn" onClick={doLogout} title="Se déconnecter" aria-label="Se déconnecter"><Icon name="logout" size={18} /></button>
        </div>
      </header>
      <main className={`content${route.page === 'plan' || route.page === 'trace' ? ' full' : ''}`}>
        {route.page === 'plans' && <PlansLibrary />}
        {route.page === 'plan' && <PlanView key={route.id} id={route.id} focusEq={route.eq} />}
        {route.page === 'recherche' && <SearchView initialQuery={route.q} />}
        {route.page === 'parametres' && (user.role === 'admin' ? <SettingsView /> : (
          <div className="page"><div className="notice">Les paramètres sont réservés aux administrateurs.</div></div>
        ))}
        {route.page === 'trace' && <RouteView key={navCount} de={route.de} a={route.a} plus={route.plus} opts={route} savedId={route.r} />}
        {route.page === 'traces' && <SavedRoutesView />}
      </main>
    </div>
    </UserContext.Provider>
  );
}
