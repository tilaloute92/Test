import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { Card } from './ui';
import { useConfirm } from './ConfirmProvider';
import { isAuthConfigured, signInWithIdToken, signOut, trySilentAccount } from '../auth/msalClient';
import {
  ApiError,
  backendAvailable,
  createLocalUser,
  deleteLocalUser,
  finalizeSsoSession,
  getLdapConfig,
  listLocalUsers,
  saveLdapConfig,
  type LdapConfig,
} from '../auth/backendAuth';

const NOT_LOGGED_IN_HINT =
  "Connectez-vous d'abord avec un compte local ou LDAP existant (celui créé via `npm run create-user` sur le serveur, par exemple) pour gérer ceci depuis l'application.";
import type { AccountInfo } from '@azure/msal-browser';

export function SettingsView() {
  const { authSettings, updateAuthSettings } = useStore();
  const confirm = useConfirm();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [httpsOk, setHttpsOk] = useState(false);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);

  // Champs modifiés localement jusqu'à ce que "Enregistrer" soit confirmé — sans
  // ça, chaque frappe clavier déclencherait sa propre demande de confirmation.
  const [draft, setDraft] = useState({
    tenantId: authSettings.tenantId,
    clientId: authSettings.clientId,
    redirectUri: authSettings.redirectUri,
  });
  const dirty = draft.tenantId !== authSettings.tenantId || draft.clientId !== authSettings.clientId || draft.redirectUri !== authSettings.redirectUri;

  const saveDraft = async () => {
    if (await confirm({ title: 'Confirmer la modification', message: 'Enregistrer ces paramètres de connexion Microsoft Entra ID ?' })) {
      updateAuthSettings(draft);
    }
  };

  useEffect(() => {
    setHttpsOk(window.location.protocol === 'https:');
    backendAvailable().then(setBackendUp);
  }, []);

  useEffect(() => {
    if (!isAuthConfigured(authSettings)) {
      setAccount(null);
      return;
    }
    trySilentAccount(authSettings)
      .then(setAccount)
      .catch(() => setAccount(null));
  }, [authSettings]);

  const testSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { account: acc, idToken } = await signInWithIdToken(authSettings);
      if (backendUp) {
        try {
          await finalizeSsoSession(idToken);
        } catch (err) {
          setAuthError(err instanceof Error ? err.message : String(err));
        }
      }
      setAccount(acc);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const testSignOut = async () => {
    setAuthBusy(true);
    try {
      await signOut(authSettings);
      setAccount(null);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Paramètres</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Authentification, annuaire et sécurité de l'application.</p>
      </div>

      {backendUp === false && (
        <Card className="p-3">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Serveur d'authentification non détecté (server/) — seule la connexion Microsoft (gérée par le navigateur) est disponible.
            L'authentification locale et LDAP nécessitent ce serveur : voir <code>server/README.md</code>.
          </p>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 1. SSO Microsoft Entra ID — fonctionne avec ou sans le serveur      */}
      {/*    d'authentification : sans lui, la session reste gérée par le    */}
      {/*    navigateur seul (comme avant) ; avec lui, le jeton est en plus   */}
      {/*    vérifié côté serveur pour ouvrir une vraie session protégée.     */}
      {/* ------------------------------------------------------------------ */}
      <Card className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Connexion automatique — Microsoft Entra ID (SSO)</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Permet à vous et votre équipe de vous connecter avec votre compte Microsoft professionnel (le même que Windows/Office 365),
            sans mot de passe séparé. Fonctionne uniquement si vos comptes existent dans <strong>Microsoft Entra ID</strong> (anciennement
            Azure AD) — soit nativement (cloud), soit synchronisés depuis votre Active Directory local via <em>Azure AD Connect</em>. Pour
            les comptes qui n'existent que dans un AD purement local, utilisez la connexion LDAP plus bas.
          </p>
        </div>

        <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          <summary className="cursor-pointer font-medium">Comment obtenir les identifiants ci-dessous (5 minutes, une seule fois)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>
              Allez sur <strong>portal.azure.com</strong> avec un compte administrateur, puis <em>Microsoft Entra ID → Inscriptions
              d'applications → Nouvelle inscription</em>.
            </li>
            <li>Donnez un nom (ex : "Suivi Infra & Réseau"), laissez le type de compte par défaut.</li>
            <li>
              Dans <em>URI de redirection</em>, choisissez le type <strong>"Application monopage (SPA)"</strong> et indiquez l'adresse
              exacte où l'application est accessible pour votre équipe (ex : <code>https://suivi-infra.monentreprise.local</code>). C'est
              obligatoire : le type "Web" ne fonctionnera pas pour ce genre d'application.
            </li>
            <li>
              Une fois créée, copiez <strong>l'ID d'application (client)</strong> et <strong>l'ID d'annuaire (locataire)</strong> affichés sur
              la page "Vue d'ensemble" de l'inscription, et collez-les ci-dessous.
            </li>
            <li>Aucun "secret client" n'est à créer : ce type d'application n'en utilise pas et n'en stocke pas.</li>
            {backendUp && (
              <li>
                Renseignez aussi <code>ENTRA_TENANT_ID</code> et <code>ENTRA_CLIENT_ID</code> (mêmes valeurs) dans le fichier{' '}
                <code>server/.env</code> du serveur, puis redémarrez-le — c'est ce qui lui permet de vérifier le jeton.
              </li>
            )}
          </ol>
        </details>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">ID d'annuaire (locataire / tenant ID)</span>
            <input
              value={draft.tenantId}
              onChange={(e) => setDraft((d) => ({ ...d, tenantId: e.target.value.trim() }))}
              placeholder="ex : 8f3b2c1a-....-....-....-............"
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">ID d'application (client ID)</span>
            <input
              value={draft.clientId}
              onChange={(e) => setDraft((d) => ({ ...d, clientId: e.target.value.trim() }))}
              placeholder="ex : 1a2b3c4d-....-....-....-............"
              className="input"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
            URI de redirection (doit être identique à celle enregistrée dans Entra ID)
          </span>
          <input value={draft.redirectUri} onChange={(e) => setDraft((d) => ({ ...d, redirectUri: e.target.value.trim() }))} className="input" />
        </label>

        <div className="flex items-center gap-3">
          <button
            onClick={saveDraft}
            disabled={!dirty}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          >
            Enregistrer les paramètres de connexion
          </button>
          {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Modifications non enregistrées</span>}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={authSettings.requireLogin}
            onChange={async (e) => {
              const checked = e.target.checked;
              const message = checked
                ? 'Exiger une connexion (Microsoft, locale ou LDAP) pour ouvrir l\'application ?'
                : "Ne plus exiger de connexion pour ouvrir l'application ?";
              if (await confirm({ title: 'Confirmer la modification', message })) {
                updateAuthSettings({ requireLogin: checked, enabled: checked || authSettings.enabled });
              }
            }}
          />
          Exiger la connexion pour ouvrir l'application (une fois testée et fonctionnelle)
        </label>
        {authSettings.requireLogin && !httpsOk && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            L'application n'est pas servie en HTTPS actuellement. N'activez la connexion obligatoire qu'une fois le HTTPS en place (voir
            section "Sécurité" ci-dessous) : les identifiants et jetons de connexion ne doivent jamais transiter en clair.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          {account ? (
            <>
              <span className="text-sm text-slate-700 dark:text-slate-200">
                Connecté en tant que <strong>{account.name ?? account.username}</strong>
              </span>
              <button onClick={testSignOut} disabled={authBusy} className="btn-ghost text-xs">
                Se déconnecter
              </button>
            </>
          ) : (
            <button
              onClick={testSignIn}
              disabled={authBusy || !isAuthConfigured(authSettings)}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
            >
              {authBusy ? 'Connexion…' : 'Se connecter avec Microsoft (tester)'}
            </button>
          )}
          {!isAuthConfigured(authSettings) && <span className="text-xs text-slate-400">Renseignez les 3 champs ci-dessus pour activer le test.</span>}
        </div>
        {authError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{authError}</p>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Comptes locaux — géré par le serveur d'authentification (server/) */}
      {/* ------------------------------------------------------------------ */}
      {backendUp && <LocalAccountsCard confirm={confirm} />}

      {/* ------------------------------------------------------------------ */}
      {/* 3. Active Directory (LDAP) — géré par le serveur d'authentification  */}
      {/*    quand il est présent ; sinon, explication honnête de pourquoi     */}
      {/*    ça ne peut pas marcher sans lui (le navigateur ne parle pas LDAP). */}
      {/* ------------------------------------------------------------------ */}
      {backendUp ? (
        <LdapConfigCard confirm={confirm} />
      ) : (
        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Annuaire Active Directory local (LDAP)</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Non disponible : un navigateur ne peut pas interroger un annuaire LDAP directement (ce n'est pas un protocole web), il faut le
            serveur d'authentification (<code>server/</code>) pour ça. Démarrez-le (voir <code>server/README.md</code>) pour activer cette
            section.
          </p>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 4. Sécurité / HTTPS — le certificat TLS se configure toujours côté */}
      {/*    serveur web qui héberge l'application (IIS, nginx, reverse      */}
      {/*    proxy...), jamais dans l'application elle-même. Un formulaire   */}
      {/*    qui accepterait de coller une clé privée ici serait une faille  */}
      {/*    de sécurité (clé exposée dans le navigateur) : on ne le fait    */}
      {/*    donc pas. Cette page se contente d'un statut + d'un guide.      */}
      {/* ------------------------------------------------------------------ */}
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Sécurité — certificat HTTPS</h2>
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${httpsOk ? 'bg-emerald-500' : 'bg-red-500'}`}
          />
          <span className="text-sm text-slate-700 dark:text-slate-200">
            {httpsOk ? 'Cette page est actuellement servie en HTTPS.' : "Cette page n'est pas servie en HTTPS actuellement."}
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Le certificat SSL/TLS ne se configure jamais dans l'application elle-même — il se configure sur le serveur web qui la sert. Cette
          application est un ensemble de fichiers statiques (HTML/JS/CSS, générés par <code>npm run build</code>) : n'importe quel serveur
          web d'entreprise peut les servir avec un certificat, interne ou public.
        </p>
        <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          <summary className="cursor-pointer font-medium">Exemple pour un serveur Windows avec IIS et un certificat interne (autorité de certification AD CS)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>
              Générez ou demandez un certificat pour le nom d'hôte choisi (ex : <code>suivi-infra.monentreprise.local</code>) auprès de
              votre autorité de certification interne (AD CS), ou importez-en un via <em>certlm.msc</em>.
            </li>
            <li>
              Dans le <em>Gestionnaire IIS</em>, créez un site pointant vers le dossier <code>dist/</code> généré par{' '}
              <code>npm run build</code>.
            </li>
            <li>
              Ajoutez une liaison <strong>HTTPS</strong> sur le port 443, sélectionnez le certificat importé, puis supprimez ou redirigez la
              liaison HTTP (port 80) pour forcer le HTTPS.
            </li>
            <li>Vérifiez depuis un poste du domaine que le certificat est approuvé (l'autorité interne doit être déployée via GPO).</li>
          </ol>
        </details>
        <p className="text-xs text-slate-400">
          N'activez "Exiger la connexion" dans la section SSO ci-dessus qu'une fois le HTTPS effectif : sans lui, les identifiants et jetons
          de connexion circuleraient en clair sur le réseau.
        </p>
      </Card>
    </div>
  );
}

type ConfirmFn = ReturnType<typeof useConfirm>;

function LocalAccountsCard({ confirm }: { confirm: ConfirmFn }) {
  const [users, setUsers] = useState<{ username: string; name: string }[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    listLocalUsers()
      .then(setUsers)
      .catch((err) => {
        setError(err instanceof ApiError && err.status === 401 ? NOT_LOGGED_IN_HINT : err instanceof Error ? err.message : String(err));
        setUsers([]);
      });
  useEffect(() => {
    refresh();
  }, []);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await createLocalUser(username, password, name);
      setUsername('');
      setPassword('');
      setName('');
      setShowForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: string) => {
    if (await confirm({ title: 'Supprimer le compte', message: `Supprimer le compte local "${u}" ?`, confirmLabel: 'Supprimer', danger: true })) {
      await deleteLocalUser(u);
      await refresh();
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Authentification locale</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Comptes identifiant + mot de passe gérés par le serveur (mots de passe hachés, jamais stockés en clair). À réserver aux
            personnes sans compte Microsoft/AD — pour tout le reste, préférez le SSO ou le LDAP ci-dessus/dessous.
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700">
          + Compte
        </button>
      </div>

      <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
        {users === null && !error && <p className="text-xs text-slate-400">Chargement…</p>}
        {users?.length === 0 && !error && <p className="text-xs text-slate-400">Aucun compte local.</p>}
        {error && !showForm && <p className="text-xs text-amber-600 dark:text-amber-400">{error}</p>}
        {users?.map((u) => (
          <div key={u.username} className="flex items-center gap-3 py-2 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">{u.name}</span>
            <span className="text-xs text-slate-400">{u.username}</span>
            <button onClick={() => remove(u.username)} className="ml-auto text-xs text-slate-300 hover:text-red-500">
              Suppr.
            </button>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Nouveau compte local</h3>
            <div className="space-y-2.5">
              <input placeholder="Identifiant" value={username} onChange={(e) => setUsername(e.target.value)} className="input" />
              <input placeholder="Nom complet" value={name} onChange={(e) => setName(e.target.value)} className="input" />
              <input type="password" placeholder="Mot de passe (8 caractères min.)" value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
            </div>
            {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
                Annuler
              </button>
              <button
                onClick={submit}
                disabled={busy || !username || password.length < 8}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
              >
                {busy ? 'Création…' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function LdapConfigCard({ confirm }: { confirm: ConfirmFn }) {
  const [draft, setDraft] = useState<LdapConfig | null>(null);
  const [saved, setSaved] = useState<LdapConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLdapConfig()
      .then((cfg) => {
        setDraft(cfg);
        setSaved(cfg);
      })
      .catch((err) => setError(err instanceof ApiError && err.status === 401 ? NOT_LOGGED_IN_HINT : err instanceof Error ? err.message : String(err)));
  }, []);

  if (!draft) {
    return (
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Annuaire Active Directory (LDAP)</h2>
        {error ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <p className="mt-2 text-xs text-slate-400">Chargement…</p>
        )}
      </Card>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async () => {
    if (await confirm({ title: 'Confirmer la modification', message: 'Enregistrer ces paramètres de connexion LDAP ?' })) {
      const next = await saveLdapConfig(draft);
      setSaved(next);
      setDraft(next);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Annuaire Active Directory (LDAP)</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Le serveur vérifie le mot de passe en tentant une connexion ("bind") directement auprès de votre contrôleur de domaine — il ne le
          stocke jamais. À utiliser pour les comptes qui n'existent que dans votre AD local, sans synchronisation vers Entra ID.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
        Activer la connexion LDAP
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">URL du contrôleur de domaine</span>
        <input
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          placeholder="ldap://dc01.monentreprise.local:389"
          className="input"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
          Motif d'identifiant ("{'{username}'}" est remplacé par ce que la personne saisit)
        </span>
        <input
          value={draft.userDnPattern}
          onChange={(e) => setDraft({ ...draft, userDnPattern: e.target.value })}
          placeholder="{username}@monentreprise.local"
          className="input font-mono text-xs"
        />
        <span className="mt-1 block text-xs text-slate-400">
          Le plus simple avec Active Directory : <code>{'{username}'}@monentreprise.local</code> (nom d'utilisateur principal / UPN).
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={!dirty}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
        >
          Enregistrer
        </button>
        {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Modifications non enregistrées</span>}
      </div>
      <p className="text-xs text-slate-400">
        Pas de bouton "Tester" ici : essayez simplement de vous déconnecter puis de vous reconnecter avec un identifiant LDAP depuis l'écran
        de connexion.
      </p>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </Card>
  );
}
