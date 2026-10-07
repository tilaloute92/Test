import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../api';
import { useConfirm, useToast } from './ui';

/**
 * Paramètres de connexion : mêmes réglages que Suivi Infra & Réseau (comptes locaux,
 * LDAP/Active Directory, SSO Microsoft), enregistrés par le service sur le serveur.
 */
export function SettingsView() {
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>Paramètres</h1>
          <p>Connexion à l'application. Ces réglages s'appliquent à toute l'équipe.</p>
        </div>
      </div>
      <LocalUsers />
      <Ldap />
      <Sso />
      <About />
    </div>
  );
}

function LocalUsers() {
  const [users, setUsers] = useState<{ username: string; name: string }[] | null>(null);
  const [form, setForm] = useState({ username: '', name: '', password: '' });
  const [error, setError] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  const load = () => api.listLocalUsers().then(setUsers).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const exists = users?.some((u) => u.username.toLowerCase() === form.username.trim().toLowerCase());
    if (exists && !(await confirm({ title: 'Remplacer le compte', message: <p>Le compte « {form.username} » existe déjà : son nom et son mot de passe seront remplacés.</p>, confirmLabel: 'Remplacer' }))) return;
    try {
      await api.createLocalUser(form.username.trim(), form.password, form.name.trim());
      toast(exists ? 'Compte mis à jour.' : 'Compte créé.');
      setForm({ username: '', name: '', password: '' });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async (username: string) => {
    if (users && users.length <= 1) { setError('Impossible de supprimer le dernier compte local : vous ne pourriez plus vous connecter si LDAP et Microsoft sont indisponibles.'); return; }
    if (!(await confirm({ title: 'Supprimer le compte', message: <p>« {username} » ne pourra plus se connecter avec ce compte local.</p>, confirmLabel: 'Supprimer', danger: true }))) return;
    try { await api.deleteLocalUser(username); toast('Compte supprimé.'); load(); } catch (err) { setError((err as Error).message); }
  };

  return (
    <section className="card">
      <div className="card-h"><h2>Comptes locaux</h2></div>
      <div className="card-b">
        <p className="muted small">Mots de passe stockés hachés (bcrypt) sur le serveur, jamais en clair. 10 tentatives de connexion par quart d'heure et par poste.</p>
        {error && <div className="notice error">{error}</div>}
        {users && (
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>Identifiant</th><th>Nom</th><th /></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.username}>
                    <td className="mono">{u.username}</td>
                    <td>{u.name}</td>
                    <td style={{ textAlign: 'right' }}><button type="button" className="btn sm danger" onClick={() => remove(u.username)}>Supprimer</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className="grid2" onSubmit={add}>
          <label className="field"><span>Identifiant</span><input id="user-login" className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" /></label>
          <label className="field"><span>Nom affiché</span><input id="user-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Mot de passe (8 caractères minimum)</span><input id="user-password" className="input" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" /></label>
          <div className="field" style={{ justifyContent: 'flex-end' }}><button type="submit" className="btn primary">Créer ou mettre à jour</button></div>
        </form>
      </div>
    </section>
  );
}

function Ldap() {
  const [cfg, setCfg] = useState<api.LdapConfig | null>(null);
  const [error, setError] = useState('');
  const toast = useToast();
  useEffect(() => { api.getLdapConfig().then(setCfg).catch((e) => setError(e.message)); }, []);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!cfg) return;
    try { setCfg(await api.saveLdapConfig(cfg)); toast('Configuration LDAP enregistrée.'); setError(''); } catch (err) { setError((err as Error).message); }
  };
  return (
    <section className="card">
      <div className="card-h"><h2>Active Directory / LDAP</h2>{cfg && <span className={`chip`}>{cfg.enabled ? 'Activé' : 'Désactivé'}</span>}</div>
      <div className="card-b">
        <p className="muted small">Le mot de passe saisi est vérifié directement par le contrôleur de domaine (« bind » LDAP) : le service ne le conserve jamais. Préférez <code>ldaps://</code> (port 636) pour qu'il ne circule pas en clair sur le réseau.</p>
        {error && <div className="notice error">{error}</div>}
        {cfg && (
          <form className="grid2" onSubmit={save}>
            <label className="check wide" htmlFor="ldap-enabled"><input id="ldap-enabled" type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Proposer la connexion Active Directory</label>
            <label className="field wide"><span>Serveur</span><input id="ldap-url" className="input mono" value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder="ldaps://dc01.monentreprise.local:636" /></label>
            <label className="field wide"><span>Modèle d'identifiant ({'{username}'} = ce que tape l'utilisateur)</span><input id="ldap-pattern" className="input mono" value={cfg.userDnPattern} onChange={(e) => setCfg({ ...cfg, userDnPattern: e.target.value })} placeholder="{username}@monentreprise.local" /></label>
            <div className="wide"><button type="submit" className="btn primary">Enregistrer</button></div>
          </form>
        )}
      </div>
    </section>
  );
}

function Sso() {
  const [methods, setMethods] = useState<api.LoginMethods | null>(null);
  useEffect(() => { api.getMethods().then(setMethods).catch(() => {}); }, []);
  const redirect = `${window.location.origin}/auth-redirect.html`;
  return (
    <section className="card">
      <div className="card-h"><h2>Microsoft Entra ID (SSO)</h2>{methods && <span className="chip">{methods.sso ? 'Configuré' : 'Non configuré'}</span>}</div>
      <div className="card-b">
        {methods?.sso ? (
          <dl className="kv">
            <dt>ID d'annuaire</dt><dd className="mono">{methods.sso.tenantId}</dd>
            <dt>ID d'application</dt><dd className="mono">{methods.sso.clientId}</dd>
            <dt>URI de redirection</dt><dd className="mono">{redirect}</dd>
          </dl>
        ) : (
          <p className="muted small">Le bouton « Se connecter avec Microsoft » apparaît sur l'écran de connexion dès que le service est configuré.</p>
        )}
        <div className="notice small">
          <p><strong>Configuration, sur le serveur uniquement :</strong></p>
          <p>1. Dans le portail Azure → Entra ID → Inscriptions d'applications, déclarez l'URI <code>{redirect}</code> de type « Application monopage (SPA) ».</p>
          <p>2. Renseignez <code>ENTRA_TENANT_ID</code> et <code>ENTRA_CLIENT_ID</code> dans le fichier <code>.env</code> du service, puis redémarrez le service (<code>Restart-Service PlanReliefSvc</code>, ou en installation sans NSSM : arrêt puis démarrage de la tâche planifiée « Plan Relief - Service »).</p>
          <p>Le service vérifie la signature de chaque jeton Microsoft avant d'ouvrir une session.</p>
        </div>
      </div>
    </section>
  );
}

function About() {
  return (
    <section className="card">
      <div className="card-h"><h2>Données et sauvegarde</h2></div>
      <div className="card-b small">
        <p style={{ margin: 0 }}>Les plans (fichiers d'origine), leurs équipements et les comptes sont stockés sur le serveur, dans le dossier <code>data\</code> du service. C'est la seule copie : la sauvegarde quotidienne doit être en place (<code>Register-PlanReliefBackup.ps1</code>, voir INSTALL.md).</p>
        <p className="muted" style={{ margin: 0 }}>Version de l'application : <span className="mono">{__APP_VERSION__}</span>. Après une mise à jour du serveur, chaque poste doit afficher la nouvelle version ; sinon, actualisez la page (Ctrl+F5).</p>
        <p className="muted" style={{ margin: 0 }}>Un plan retiré du stock est déplacé dans <code>data\corbeille\</code> : un administrateur peut le remettre dans <code>data\plans\</code> puis redémarrer le service.</p>
      </div>
    </section>
  );
}
