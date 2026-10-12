import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../api';
import { microsoftIdToken } from '../auth/msal';
import { Brand } from './ui';

export function LoginScreen({ onLogin }: { onLogin: (u: api.User) => void }) {
  const [methods, setMethods] = useState<api.LoginMethods | null>(null);
  const [mode, setMode] = useState<'local' | 'ldap'>('local');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getMethods().then(setMethods).catch(() => setMethods({ local: true, ldap: false, sso: null }));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      onLogin(mode === 'ldap' ? await api.loginLdap(username.trim(), password) : await api.loginLocal(username.trim(), password));
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const microsoft = async () => {
    if (!methods?.sso) return;
    setError('');
    setBusy(true);
    try {
      const idToken = await microsoftIdToken(methods.sso.tenantId, methods.sso.clientId);
      onLogin(await api.loginSso(idToken));
    } catch (err) {
      const msg = (err as Error).message || '';
      setError(/user_cancelled|popup_window/i.test(msg) ? 'Connexion Microsoft annulée.' : `Connexion Microsoft impossible : ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen login-screen">
      <div className="login-wrap">
      <aside className="login-hero" aria-hidden="true">
        <HeroArt />
        <div className="login-hero-t">
          <h2>Vos bâtiments, étage par étage.</h2>
          <ul>
            <li>Les plans DXF et PDF en maquette 3D</li>
            <li>Chaque équipement retrouvé en quelques lettres</li>
            <li>Le tracé de câble d'un point à l'autre, ascenseurs compris</li>
          </ul>
        </div>
      </aside>
      <div className="login">
        <Brand />
        <h1>Connexion</h1>
        {methods?.ldap && (
          <div className="seg" role="group" aria-label="Type de compte" style={{ alignSelf: 'center' }}>
            <button type="button" aria-pressed={mode === 'local'} onClick={() => setMode('local')}>Compte local</button>
            <button type="button" aria-pressed={mode === 'ldap'} onClick={() => setMode('ldap')}>Active Directory</button>
          </div>
        )}
        <form onSubmit={submit}>
          <label className="field">
            <span>{mode === 'ldap' ? 'Identifiant Windows' : 'Identifiant'}</span>
            <input id="login-user" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label className="field">
            <span>Mot de passe</span>
            <input id="login-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="notice error" role="alert">{error}</div>}
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        </form>
        {methods?.sso && (
          <>
            <div className="divider">ou</div>
            <button type="button" className="btn" onClick={microsoft} disabled={busy}>Se connecter avec Microsoft</button>
          </>
        )}
        <p className="muted small mono" style={{ textAlign: 'center', margin: 0 }}>Version {__APP_VERSION__}</p>
      </div>
      </div>
    </div>
  );
}

/** Illustration de l'écran de connexion : trois étages empilés et un tracé qui les relie. */
function HeroArt() {
  const floor = (y: number, o: number) => (
    <g transform={`translate(0 ${y})`} opacity={o}>
      <path d="M40 80 L160 20 L280 80 L160 140 Z" fill="rgba(255,255,255,.10)" stroke="rgba(255,255,255,.55)" strokeWidth="1.5" />
      <path d="M90 80 L160 45 L230 80 M125 98 L195 62 M160 116 L230 80" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" />
    </g>
  );
  return (
    <svg className="login-art" viewBox="0 0 320 300">
      {floor(150, 0.55)}
      {floor(80, 0.75)}
      {floor(10, 1)}
      <path d="M110 245 L110 200 L160 175 L160 105 L200 85 L200 60" fill="none" stroke="#ffb547" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="110" cy="245" r="7" fill="#34d27b" stroke="#fff" strokeWidth="2" />
      <circle cx="200" cy="60" r="7" fill="#ff6b5e" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}
