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
    <div className="center-screen">
      <div className="login">
        <Brand />
        <h1>Plans et équipements de vos bâtiments</h1>
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
      </div>
    </div>
  );
}
