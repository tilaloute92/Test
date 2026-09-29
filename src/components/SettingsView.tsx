import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { Card, PrintButton, PrintHeader } from './ui';
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
  testLdapConfig,
  type LdapConfig,
  type LdapTestResult,
} from '../auth/backendAuth';
import {
  exportBackupFile,
  formatTimestamp,
  importBackupPayload,
  parseBackupFile,
  restoreSnapshot,
  useBackupStore,
  type Snapshot,
} from '../lib/backup';
import { fetchStatus, type ServerStatus } from '../lib/serverSync';
import { getSyncUser, isSyncActive, onSyncActiveChange, type SyncUser } from '../lib/syncState';
import { useAppMode, useLinkState } from '../hooks/useAppStatus';
import { clearLocalArchive, countArchived, readLocalArchive } from '../lib/localArchive';
import { findExpired, RETENTION_DAYS } from '../lib/retention';
import { fetchMailConfig, saveMailConfig, sendTestMail, verifyMailRelay, type MailConfig } from '../lib/mailApi';

const NOT_LOGGED_IN_HINT =
  "Connectez-vous d'abord avec un compte local ou LDAP existant (celui créé via `npm run create-user` sur le serveur, par exemple) pour gérer ceci depuis l'application.";
import type { AccountInfo } from '@azure/msal-browser';
import { useModalDismiss } from './Modal';

/**
 * @param canEdit  Ce compte peut-il modifier la configuration ? Décidé par le serveur
 *   (voir server/src/auth/admin.js), transmis par App.tsx. À faux, tout reste LISIBLE —
 *   savoir comment l'application est configurée n'est pas un privilège — mais rien n'est
 *   modifiable. Ce verrouillage est un confort de lecture, pas une protection : la
 *   protection est le refus 403 du serveur sur les routes de configuration. Masquer un
 *   bouton n'empêche personne d'appeler la route à la main.
 */
export function SettingsView({ canEdit = true }: { canEdit?: boolean }) {
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
      <PrintHeader title="Paramètres" subtitle="Authentification, annuaire et sécurité de l'application" />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Paramètres</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Authentification, annuaire et sécurité de l'application.</p>
        </div>
        <PrintButton />
      </div>

      {!canEdit && (
        <Card className="border-amber-200 p-3 dark:border-amber-500/40">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            <strong>Lecture seule.</strong> La configuration de l'application (comptes locaux, annuaire LDAP,
            connexion Microsoft, mode de fonctionnement, sauvegardes) est réservée au compte «&nbsp;admin&nbsp;».
            Vous pouvez consulter ces réglages, pas les changer.
          </p>
        </Card>
      )}

      {backendUp === false && (
        <Card className="p-3">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Serveur d'authentification non détecté (server/) — seule la connexion Microsoft (gérée par le navigateur) est disponible.
            L'authentification locale et LDAP nécessitent ce serveur : voir <code>server/README.md</code>.
          </p>
        </Card>
      )}

      {/* Un fieldset désactivé neutralise nativement TOUT contrôle qu'il contient, y compris
          ceux qu'on ajoutera plus tard sans y penser — plus sûr que de les désactiver un à
          un. Il ne les grise pas pour autant : les variantes ci-dessous s'en chargent, sans
          quoi un bouton resterait vif et cliquable en apparence alors qu'il ne répond plus. */}
      <fieldset
        disabled={!canEdit}
        className="m-0 min-w-0 space-y-6 border-0 p-0 [&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-50 [&_input:disabled]:opacity-60 [&_select:disabled]:opacity-60 [&_textarea:disabled]:opacity-60"
      >
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

        <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300 print:hidden">
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

        <div className="flex items-center gap-3 print:hidden">
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

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-slate-800 print:hidden">
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
      {/* 3bis. Mode de fonctionnement — d'où viennent les données affichées et  */}
      {/*       où vont les modifications. Toujours affiché, dans les deux      */}
      {/*       modes : le mode ne doit jamais être une devinette.              */}
      {/* ------------------------------------------------------------------ */}
      <ModeCard />

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

      {/* ------------------------------------------------------------------ */}
      {/* 5. Sauvegarde & versionnement — historique automatique (dans ce     */}
      {/*    navigateur) + export/import manuel en fichier (le seul qui       */}
      {/*    survive à un vidage du stockage local ou un changement de poste).*/}
      {/* ------------------------------------------------------------------ */}
      <BackupCard confirm={confirm} />
      <MailConfigCard confirm={confirm} />
      <RetentionCard confirm={confirm} />
      <ArchivedDataCard confirm={confirm} />
      </fieldset>
    </div>
  );
}

type ConfirmFn = ReturnType<typeof useConfirm>;

function LocalAccountsCard({ confirm }: { confirm: ConfirmFn }) {
  const [users, setUsers] = useState<{ username: string; name: string }[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const dismiss = useModalDismiss(() => setShowForm(false), 'ce nouveau compte');
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
        <button onClick={() => setShowForm(true)} className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 print:hidden">
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
            <button onClick={() => remove(u.username)} className="ml-auto text-xs text-slate-300 hover:text-red-500 print:hidden">
              Suppr.
            </button>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" {...dismiss.backdrop}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" {...dismiss.content}>
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
  // Vide = « ne change pas le mot de passe ». Le navigateur ne l'a jamais reçu, il ne
  // peut donc pas le réafficher, et un champ pré-rempli de faux caractères mentirait.
  const [bindPassword, setBindPassword] = useState('');
  const [test, setTest] = useState<{ user: string; pass: string; busy: boolean; result: LdapTestResult | null }>({
    user: '',
    pass: '',
    busy: false,
    result: null,
  });

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
        {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : <p className="mt-2 text-xs text-slate-400">Chargement…</p>}
      </Card>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved) || bindPassword !== '';
  const set = (patch: Partial<LdapConfig>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    setError(null);
    if (!(await confirm({ title: 'Confirmer la modification', message: "Enregistrer ces paramètres d'annuaire ?" }))) return;
    try {
      const next = await saveLdapConfig({ ...draft, bindPassword: bindPassword || undefined });
      setSaved(next);
      setDraft(next);
      setBindPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runTest = async () => {
    setTest((t) => ({ ...t, busy: true, result: null }));
    try {
      setTest((t) => ({ ...t, busy: false, result: null }));
      const r = await testLdapConfig(test.user, test.pass);
      setTest((t) => ({ ...t, busy: false, result: r }));
    } catch (err) {
      setTest((t) => ({
        ...t,
        busy: false,
        result: { ok: false, journal: [{ etape: 'erreur', ok: false, detail: err instanceof Error ? err.message : String(err) }] },
      }));
    }
  };

  const recherche = draft.mode === 'search';

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Annuaire Active Directory (LDAP)</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Le serveur vérifie le mot de passe en tentant une connexion («&nbsp;bind&nbsp;») directement auprès de votre contrôleur de
          domaine — il ne le stocke jamais. À utiliser pour les comptes qui n'existent que dans votre AD local, sans synchronisation
          vers Entra ID.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Activer la connexion LDAP
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">URL du contrôleur de domaine</span>
          <input value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder="ldap://dc01.monentreprise.local:389" className="input" />
          <span className="mt-1 block text-xs text-slate-400">
            <code>ldap://</code> port 389, ou <code>ldaps://</code> port 636 (chiffré — à préférer, les mots de passe transitent ici).
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Délai d'attente (ms)</span>
          <input
            type="number"
            min={1000}
            step={500}
            value={draft.timeoutMs}
            onChange={(e) => set({ timeoutMs: Number(e.target.value) || 5000 })}
            className="input"
          />
        </label>
      </div>

      {draft.url.startsWith('ldaps://') && (
        <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={draft.tlsRejectUnauthorized}
            onChange={(e) => set({ tlsRejectUnauthorized: e.target.checked })}
          />
          <span>
            Vérifier le certificat du contrôleur de domaine
            <span className="mt-0.5 block text-xs text-slate-400">
              À décocher uniquement si votre certificat vient d'une autorité interne que ce serveur ne reconnaît pas. La liaison reste
              chiffrée, mais l'identité du serveur n'est plus vérifiée : la bonne solution reste d'installer votre autorité racine sur
              le serveur.
            </span>
          </span>
        </label>
      )}

      {/* --- Comment retrouver la personne dans l'annuaire --- */}
      <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Comment retrouver la personne</span>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="radio" className="mt-1" checked={!recherche} onChange={() => set({ mode: 'pattern' })} />
            <span>
              <strong>Motif d'identifiant</strong> — le plus simple, aucun compte de service
              <span className="mt-0.5 block text-xs text-slate-400">
                Chacun se connecte avec son UPN complet (prenom.nom@monentreprise.local).
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="radio" className="mt-1" checked={recherche} onChange={() => set({ mode: 'search' })} />
            <span>
              <strong>Recherche dans l'annuaire</strong> — identifiant Windows court, et restriction par groupe possible
              <span className="mt-0.5 block text-xs text-slate-400">
                Un compte de service en lecture seule retrouve la personne. Le seul mode qui accepte l'identifiant court
                (<code>rnelson</code>) et qui permet de n'ouvrir l'application qu'à un groupe.
              </span>
            </span>
          </label>
        </div>

        {!recherche ? (
          <label className="block pt-1">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
              Motif ({'{username}'} est remplacé par ce que la personne saisit)
            </span>
            <input
              value={draft.userDnPattern}
              onChange={(e) => set({ userDnPattern: e.target.value })}
              placeholder="{username}@monentreprise.local"
              className="input font-mono text-xs"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Le plus courant avec Active Directory : <code>{'{username}'}@monentreprise.local</code>. Un DN complet fonctionne aussi :{' '}
              <code>CN={'{username}'},OU=Utilisateurs,DC=monentreprise,DC=local</code>.
            </span>
          </label>
        ) : (
          <div className="space-y-2.5 pt-1">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Base de recherche (baseDN)</span>
              <input value={draft.baseDN} onChange={(e) => set({ baseDN: e.target.value })} placeholder="DC=monentreprise,DC=local" className="input font-mono text-xs" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Filtre de recherche</span>
              <input value={draft.userFilter} onChange={(e) => set({ userFilter: e.target.value })} placeholder="(sAMAccountName={username})" className="input font-mono text-xs" />
              <span className="mt-1 block text-xs text-slate-400">
                <code>(sAMAccountName={'{username}'})</code> pour l'identifiant Windows court, <code>(userPrincipalName={'{username}'})</code> pour l'UPN.
              </span>
            </label>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Compte de service (DN)</span>
                <input value={draft.bindDN} onChange={(e) => set({ bindDN: e.target.value })} placeholder="CN=svc_suivi,OU=Services,DC=..." className="input font-mono text-xs" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                  Mot de passe {draft.bindPasswordSet && <span className="text-emerald-600 dark:text-emerald-400">— enregistré</span>}
                </span>
                <input
                  type="password"
                  value={bindPassword}
                  onChange={(e) => setBindPassword(e.target.value)}
                  placeholder={draft.bindPasswordSet ? 'Laisser vide pour ne pas le changer' : 'Mot de passe du compte de service'}
                  autoComplete="new-password"
                  className="input"
                />
              </label>
            </div>
            <p className="text-xs text-slate-400">
              Un compte <strong>en lecture seule</strong> suffit : il ne sert qu'à retrouver le DN de la personne. Le mot de passe est
              conservé sur le serveur, dans le dossier réservé aux administrateurs, et n'est jamais renvoyé à un navigateur.
            </p>
          </div>
        )}
      </div>

      {/* --- Ce qu'on lit dans l'annuaire --- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Attribut du nom affiché</span>
          <input value={draft.displayNameAttribute} onChange={(e) => set({ displayNameAttribute: e.target.value })} className="input font-mono text-xs" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Attribut de l'adresse mail</span>
          <input value={draft.mailAttribute} onChange={(e) => set({ mailAttribute: e.target.value })} className="input font-mono text-xs" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Groupe exigé (optionnel)</span>
          <input value={draft.requiredGroup} onChange={(e) => set({ requiredGroup: e.target.value })} placeholder="Techniciens Infra" className="input" />
        </label>
      </div>
      <p className="-mt-2 text-xs text-slate-400">
        Sans nom d'attribut, l'application afficherait l'identifiant de connexion partout au lieu du nom de la personne. Le groupe
        restreint l'accès : laissé vide, <strong>tout compte valide de l'annuaire peut entrer</strong> — y compris les prestataires et
        les comptes de service. Un nom simple ou un DN complet conviennent.
        {recherche ? '' : " La vérification du groupe exige que l'annuaire accepte de renvoyer memberOf à la personne elle-même."}
      </p>

      <div className="flex items-center gap-3 print:hidden">
        <button onClick={save} disabled={!dirty} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40">
          Enregistrer
        </button>
        {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Modifications non enregistrées</span>}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {/* --- Test, sans se déconnecter --- */}
      <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60 print:hidden">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tester la configuration enregistrée</span>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Le test porte sur ce qui est <strong>enregistré</strong>, pas sur ce qui est affiché : enregistrez d'abord. Les identifiants
          saisis ici ne servent qu'à la vérification, ils ne sont ni conservés ni journalisés. Sans identifiants, seule la
          joignabilité du serveur est vérifiée.
        </p>
        <div className="flex flex-wrap gap-2">
          <input placeholder="Identifiant à tester" value={test.user} onChange={(e) => setTest((t) => ({ ...t, user: e.target.value }))} className="input flex-1" autoComplete="off" />
          <input type="password" placeholder="Mot de passe" value={test.pass} onChange={(e) => setTest((t) => ({ ...t, pass: e.target.value }))} className="input flex-1" autoComplete="new-password" />
          <button onClick={runTest} disabled={test.busy} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-white disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900">
            {test.busy ? 'Test…' : 'Tester'}
          </button>
        </div>
        {test.result && (
          <div className="space-y-1 pt-1">
            {test.result.journal.map((etape, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={etape.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{etape.ok ? '✔' : '✘'}</span>
                <span className="text-slate-600 dark:text-slate-300">
                  <span className="font-medium">{etape.etape}</span> — {etape.detail}
                </span>
              </div>
            ))}
            <p className={`pt-1 text-xs font-medium ${test.result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {test.result.ok
                ? test.result.user
                  ? `Connexion réussie — cette personne apparaîtra sous le nom « ${test.result.user.name} ».`
                  : 'Serveur joignable. Renseignez un identifiant pour éprouver une connexion complète.'
                : "Échec — l'étape marquée ✘ ci-dessus indique quoi corriger."}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function useSyncStatus() {
  const [status, setStatus] = useState<{ active: boolean; user: SyncUser | null }>(() => ({ active: isSyncActive(), user: getSyncUser() }));
  useEffect(() => onSyncActiveChange((active, user) => setStatus({ active, user })), []);
  return status;
}

function ModeCard() {
  const { active, user } = useSyncStatus();
  const mode = useAppMode();
  const link = useLinkState();
  const [status, setStatus] = useState<ServerStatus | null>(null);

  useEffect(() => {
    if (!active) return;
    fetchStatus().then(setStatus, () => setStatus(null));
  }, [active, link]);

  const archive = readLocalArchive();

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Mode de fonctionnement</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Où vivent les données de l'équipe (membres, tâches, planning, temps, absences, FDR, COPIL). Les connexions API et l'historique de
          requêtes restent dans tous les cas propres à ce navigateur : ce sont des réglages personnels, pas des données d'équipe.
        </p>
      </div>

      {mode === 'serveur' ? (
        <div className="space-y-2 rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-500/10">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Client / serveur</p>
          <p className="text-xs text-emerald-700 dark:text-emerald-200">
            Les données sont <strong>sur le serveur</strong>, qui en est la seule référence. Chaque modification y est enregistrée
            immédiatement ; si elle n'y parvient pas, elle est annulée et l'affichage resynchronisé — rien ne reste « en attente » dans ce
            navigateur. Les autres postes voient vos modifications sous ~8 secondes.
          </p>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Autonome</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Les données sont dans <strong>ce navigateur uniquement</strong>. Personne d'autre ne les voit, et elles disparaissent si le
            stockage local est vidé — pensez à l'export manuel ci-dessous. Pour passer en client/serveur, installez le service
            (scénario B de la procédure d'installation) : la bascule est automatique au prochain chargement.
          </p>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
        <dt className="text-slate-500 dark:text-slate-400">Liaison</dt>
        <dd className="text-slate-800 dark:text-slate-200">
          {mode !== 'serveur' ? 'sans objet' : link === 'connecte' ? 'serveur joignable' : link === 'indisponible' ? 'serveur injoignable' : 'en cours'}
        </dd>
        <dt className="text-slate-500 dark:text-slate-400">Session</dt>
        <dd className="text-slate-800 dark:text-slate-200">{active && user ? user.name : 'non connecté'}</dd>
        {mode === 'serveur' && status && (
          <>
            <dt className="text-slate-500 dark:text-slate-400">Mis en service</dt>
            <dd className="text-slate-800 dark:text-slate-200">{status.initialized ? 'oui' : 'non'}</dd>
            <dt className="text-slate-500 dark:text-slate-400" title="Compteur incrémenté à chaque modification enregistrée par le serveur.">
              Version des données
            </dt>
            <dd className="text-slate-800 dark:text-slate-200">{status.version}</dd>
          </>
        )}
      </dl>

      {mode === 'serveur' && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Dans ce mode, la connexion est obligatoire quelle que soit la position de l'interrupteur « exiger la connexion » ci-dessus : les
          données sont derrière une API qui exige une session, sans laquelle l'application n'aurait rien à afficher.
        </p>
      )}

      {mode === 'serveur' && archive && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-500/10">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Ce poste utilisait l'application en autonome avant la bascule. Ses {countArchived(archive)} enregistrement(s) d'alors ont été
            conservés à part et ne sont plus affichés (le serveur fait référence). Ils restent récupérables : voir « Données conservées
            avant la bascule » plus bas.
          </p>
        </div>
      )}
    </Card>
  );
}

/**
 * Données qu'un poste détenait avant de basculer en client/serveur (voir
 * src/lib/localArchive.ts). Elles ne sont plus affichées par l'application — le serveur fait
 * référence — mais les supprimer sans les proposer reviendrait à effacer du travail sans le
 * dire. Elles restent donc exportables tant que l'utilisateur ne les a pas écartées lui-même.
 */
/**
 * Réglages du relais SMTP.
 *
 * Ils n'existaient que dans server/.env : changer le nom du relais ou l'heure d'envoi
 * demandait une session sur le serveur, un éditeur de texte et un redémarrage du service —
 * pour un réglage qu'on ajuste rarement du premier coup.
 *
 * Deux boutons plutôt qu'un, parce qu'ils ne disent pas la même chose : « Vérifier » teste
 * la connexion au relais, « Envoyer un test » lui remet réellement un message. Un relais
 * accepte souvent la connexion puis refuse le message — expéditeur non autorisé, relayage
 * interdit pour cette adresse IP — et c'est ce second cas qui fait perdre le plus de temps.
 */
function MailConfigCard({ confirm }: { confirm: ConfirmFn }) {
  const [cfg, setCfg] = useState<MailConfig | null>(null);
  const [saved, setSaved] = useState<MailConfig | null>(null);
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState<'verify' | 'send' | null>(null);
  const [resultat, setResultat] = useState<{ ok: boolean; texte: string } | null>(null);

  useEffect(() => {
    fetchMailConfig()
      .then((c) => {
        setCfg(c);
        setSaved(c);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (!cfg) {
    return (
      <Card className="p-4 print:hidden">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Envoi de mail (programme du jour)</h2>
        {error ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            {error}
            <span className="mt-1 block text-slate-400">
              L'envoi de mail suppose le service (mode client/serveur) : un site statique ne peut pas remettre un message à un relais SMTP.
            </span>
          </p>
        ) : (
          <p className="mt-2 text-xs text-slate-400">Chargement…</p>
        )}
      </Card>
    );
  }

  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved) || pass !== '';
  const set = (patch: Partial<MailConfig>) => setCfg({ ...cfg, ...patch });

  const save = async () => {
    setError(null);
    setResultat(null);
    if (!(await confirm({ title: 'Confirmer la modification', message: "Enregistrer ces paramètres d'envoi de mail ?" }))) return;
    try {
      const next = await saveMailConfig({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        user: cfg.user,
        from: cfg.from,
        dailyMailAt: cfg.dailyMailAt,
        tlsRejectUnauthorized: cfg.tlsRejectUnauthorized,
        pass: pass || undefined,
      });
      setCfg(next);
      setSaved(next);
      setPass('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const verifier = async () => {
    setBusy('verify');
    setResultat(null);
    try {
      await verifyMailRelay();
      setResultat({ ok: true, texte: 'Le relais répond et accepte la connexion. Envoyez un message de test pour vérifier qu\'il accepte aussi de le remettre.' });
    } catch (err) {
      setResultat({ ok: false, texte: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const envoyer = async () => {
    setBusy('send');
    setResultat(null);
    try {
      const r = await sendTestMail(testTo);
      setResultat({
        ok: true,
        texte: `Message remis au relais pour ${r.accepted.join(', ') || testTo}.${r.rejected?.length ? ` Refusé pour : ${r.rejected.join(', ')}.` : ''} Réponse du serveur : ${r.response}`,
      });
    } catch (err) {
      setResultat({ ok: false, texte: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-4 p-4 print:hidden">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Envoi de mail (programme du jour)</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          L'application ne délivre rien elle-même : elle remet le message à votre relais SMTP (Exchange, Microsoft 365, ou un relais
          interne), qui s'en charge. Chaque personne reçoit son programme à l'adresse renseignée dans l'onglet Équipe.
        </p>
        {cfg.fromEnvOnly && (cfg.host || cfg.from) && (
          <p className="mt-1.5 text-xs text-slate-400">
            Ces valeurs viennent de <code>server/.env</code> et n'ont jamais été enregistrées ici. Le premier enregistrement depuis
            cette page les reprend et prend le pas sur le fichier.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Serveur SMTP</span>
          <input value={cfg.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.monentreprise.local" className="input" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Port</span>
          <input type="number" value={cfg.port} onChange={(e) => set({ port: Number(e.target.value) || 25 })} className="input" />
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" className="mt-0.5" checked={cfg.secure} onChange={(e) => set({ secure: e.target.checked })} />
        <span>
          Chiffrement dès la connexion (port 465)
          <span className="mt-0.5 block text-xs text-slate-400">
            À laisser décoché sur les ports 25 et 587 : la connexion y démarre en clair puis bascule en TLS d'elle-même (STARTTLS).
            Cocher cette case sur le port 587 fait échouer la connexion sans message clair.
          </span>
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Identifiant (optionnel)</span>
          <input value={cfg.user} onChange={(e) => set({ user: e.target.value })} placeholder="Vide si le relais accepte par adresse IP" className="input" autoComplete="off" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
            Mot de passe {cfg.passSet && <span className="text-emerald-600 dark:text-emerald-400">— enregistré</span>}
          </span>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={cfg.passSet ? 'Laisser vide pour ne pas le changer' : 'Mot de passe SMTP'}
            className="input"
            autoComplete="new-password"
          />
        </label>
      </div>
      <p className="-mt-2 text-xs text-slate-400">
        Un relais interne accepte souvent les messages sans authentification, sur la seule foi de l'adresse IP du serveur : laissez
        alors ces deux champs vides.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Adresse d'expéditeur</span>
          <input value={cfg.from} onChange={(e) => set({ from: e.target.value })} placeholder="suivi-infra@monentreprise.fr" className="input" />
          <span className="mt-1 block text-xs text-slate-400">
            Votre relais n'acceptera de l'expédier que si cette adresse lui est autorisée.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Heure d'envoi automatique (HH:MM)</span>
          <input value={cfg.dailyMailAt} onChange={(e) => set({ dailyMailAt: e.target.value })} placeholder="07:45" className="input" />
          <span className="mt-1 block text-xs text-slate-400">
            Vide = aucun envoi automatique, l'envoi reste possible à la demande depuis Activité du jour. Le service rattrape l'envoi du
            jour s'il était arrêté à l'heure dite.
          </span>
        </label>
      </div>

      {cfg.secure && (
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={cfg.tlsRejectUnauthorized} onChange={(e) => set({ tlsRejectUnauthorized: e.target.checked })} />
          <span>
            Vérifier le certificat du relais
            <span className="ml-1 text-xs text-slate-400">(à décocher pour un relais interne à certificat auto-signé)</span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={!dirty} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40">
          Enregistrer
        </button>
        {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Modifications non enregistrées</span>}
        {!dirty && cfg.configured && <span className="text-xs text-emerald-600 dark:text-emerald-400">Configuration complète</span>}
        {!dirty && !cfg.configured && <span className="text-xs text-slate-400">Serveur et expéditeur sont nécessaires pour envoyer.</span>}
      </div>

      <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Éprouver la configuration enregistrée</span>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={verifier} disabled={busy !== null} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-white disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900">
            {busy === 'verify' ? 'Vérification…' : 'Vérifier la connexion'}
          </button>
          <input type="email" placeholder="votre.adresse@monentreprise.fr" value={testTo} onChange={(e) => setTestTo(e.target.value)} className="input min-w-56 flex-1" />
          <button onClick={envoyer} disabled={busy !== null || !testTo.trim()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-white disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900">
            {busy === 'send' ? 'Envoi…' : 'Envoyer un test'}
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Ces deux boutons portent sur ce qui est <strong>enregistré</strong> : enregistrez d'abord vos modifications.
        </p>
        {resultat && (
          <p className={`text-xs ${resultat.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{resultat.texte}</p>
        )}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </Card>
  );
}

/**
 * Purge automatique. Carte volontairement informative : la règle est fixe, et ce qui
 * manquerait le plus à un administrateur n'est pas un réglage de plus mais de savoir CE QUI
 * VA DISPARAÎTRE, avant que cela ne disparaisse. D'où le décompte en direct.
 */
function RetentionCard({ confirm }: { confirm: ConfirmFn }) {
  const { tasks, absences, timeEntries, purgeExpiredRecords } = useStore();
  const mode = useAppMode();
  const expired = findExpired({ tasks, absences, timeEntries }, new Date());

  const purgeNow = async () => {
    if (
      await confirm({
        title: 'Purger maintenant',
        message: `Supprimer définitivement ${expired.tasks.length} tâche(s) terminée(s), ${expired.absences.length} absence(s) passée(s) et ${expired.timeEntries.length} saisie(s) de temps rattachée(s) ? Il n'y a pas de corbeille : le seul retour en arrière est une sauvegarde.`,
        confirmLabel: 'Purger',
        danger: true,
      })
    ) {
      purgeExpiredRecords();
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Purge automatique ({RETENTION_DAYS} jours)</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Sont supprimés automatiquement les <strong>tâches terminées</strong> depuis plus de {RETENTION_DAYS} jours et les{' '}
          <strong>absences</strong> dont la date est passée de plus de {RETENTION_DAYS} jours.
        </p>
      </div>

      <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
        <li>
          • Les <strong>saisies de temps</strong> rattachées à une tâche purgée partent avec elle : sans la tâche, elles ne
          s'affichent plus nulle part. Ce sont des heures de travail réelles — c'est la conséquence la plus lourde de cette purge.
        </li>
        <li>• Une tâche terminée <strong>sans date d'achèvement</strong> n'est jamais purgée : aucune date fiable, donc aucun risque pris.</li>
        <li>• Les créneaux de planning qui visaient une tâche purgée sont vidés, pas supprimés.</li>
        <li>
          • {mode === 'serveur'
            ? 'Le serveur purge au démarrage puis toutes les heures ; ce navigateur en voit le résultat à la synchronisation suivante.'
            : 'La purge a lieu à l\'ouverture de l\'application puis toutes les heures.'}
        </li>
        <li>
          • <strong>Il n'y a pas de corbeille.</strong> Le seul retour en arrière est une sauvegarde
          {mode === 'serveur' ? ' du serveur (Backup-SuiviInfra.ps1).' : ' (section ci-dessus).'}
        </li>
      </ul>

      <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
        {expired.total === 0 ? (
          <span className="text-slate-500 dark:text-slate-400">Rien à purger actuellement.</span>
        ) : (
          <span className="text-amber-700 dark:text-amber-300">
            Concernés au prochain passage (antérieurs au {expired.cutoff}) : <strong>{expired.tasks.length}</strong> tâche(s)
            terminée(s), <strong>{expired.absences.length}</strong> absence(s), <strong>{expired.timeEntries.length}</strong> saisie(s)
            de temps.
          </span>
        )}
      </div>

      {mode !== 'serveur' && expired.total > 0 && (
        <button
          onClick={purgeNow}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-slate-700 dark:hover:bg-red-500/10 print:hidden"
        >
          Purger maintenant
        </button>
      )}
    </Card>
  );
}

function ArchivedDataCard({ confirm }: { confirm: ConfirmFn }) {
  const [archive, setArchive] = useState(() => readLocalArchive());
  if (!archive) return null;

  const download = () => {
    const wrapper = { app: 'suivi-infra-reseau', version: 1, exportedAt: new Date().toISOString(), data: archive.data };
    const blob = new Blob([JSON.stringify(wrapper, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `donnees-avant-bascule_suivi-infra_${archive.archivedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const discard = async () => {
    if (
      await confirm({
        title: 'Écarter ces données',
        message:
          "Supprimer définitivement les données conservées avant la bascule en mode client/serveur ? Téléchargez-les d'abord si vous n'êtes pas certain qu'elles ont bien été reprises sur le serveur — cette suppression est irréversible.",
        confirmLabel: 'Supprimer définitivement',
        danger: true,
      })
    ) {
      clearLocalArchive();
      setArchive(null);
    }
  };

  return (
    <Card className="space-y-3 p-4 print:hidden">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Données conservées avant la bascule</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Ce poste a utilisé l'application en mode autonome jusqu'au {formatTimestamp(archive.archivedAt)}. Ses{' '}
          <strong>{countArchived(archive)} enregistrement(s)</strong> d'alors ont été mis de côté au moment de la bascule : ils ne sont plus
          affichés (le serveur fait référence), mais ils n'ont pas été détruits. Vérifiez que tout ce qui comptait se trouve bien sur le
          serveur, puis écartez-les.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={download} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
          Télécharger ces données (.json)
        </button>
        <button onClick={discard} className="text-xs text-slate-400 hover:text-red-500">
          Les écarter définitivement
        </button>
      </div>
    </Card>
  );
}

function BackupCard({ confirm }: { confirm: ConfirmFn }) {
  const { snapshots, remove: removeSnapshot, clear: clearHistory } = useBackupStore();
  // En mode client/serveur, restaurer localement ne changerait rien côté serveur et serait
  // effacé au sondage suivant : on désactive plutôt que de simuler une action sans effet.
  const serverMode = useAppMode() === 'serveur';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const handleFileChosen = async (file: File) => {
    setImportError(null);
    setImportBusy(true);
    try {
      const text = await file.text();
      const data = parseBackupFile(text);
      if (
        await confirm({
          title: 'Restaurer une sauvegarde',
          message: `Remplacer toutes les données actuelles (membres, tâches, planning, temps, absences, connexions API, paramètres de connexion) par le contenu du fichier "${file.name}" ? L'état actuel sera d'abord conservé dans l'historique ci-dessous, vous pourrez donc revenir en arrière si besoin.`,
          confirmLabel: 'Restaurer',
          danger: true,
        })
      ) {
        importBackupPayload(data);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const doRestore = async (snap: Snapshot) => {
    if (
      await confirm({
        title: 'Restaurer ce point',
        message: `Revenir à l'état du ${formatTimestamp(snap.createdAt)} (${snap.label}) ? L'état actuel sera d'abord conservé dans l'historique.`,
        confirmLabel: 'Restaurer',
        danger: true,
      })
    ) {
      restoreSnapshot(snap.id);
    }
  };

  const doRemoveSnapshot = async (snap: Snapshot) => {
    if (
      await confirm({
        title: 'Supprimer ce point',
        message: `Supprimer le point du ${formatTimestamp(snap.createdAt)} de l'historique ? Cela ne touche pas vos données actuelles.`,
        confirmLabel: 'Supprimer',
        danger: true,
      })
    ) {
      removeSnapshot(snap.id);
    }
  };

  const doClearHistory = async () => {
    if (
      await confirm({
        title: "Vider l'historique",
        message:
          "Supprimer tous les points de restauration automatiques enregistrés dans ce navigateur ? Cela n'affecte pas les données actuelles, ni les fichiers de sauvegarde déjà téléchargés.",
        confirmLabel: 'Vider',
        danger: true,
      })
    ) {
      clearHistory();
    }
  };

  return (
    <Card className="space-y-4 p-4 print:hidden">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Sauvegarde & historique des versions</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Deux façons de revenir en arrière si une mauvaise modification a été faite. L'<strong>historique automatique</strong> ci-dessous
          s'enregistre tout seul après chaque changement, dans ce navigateur — pratique, mais perdu si le stockage local est vidé, ou
          absent sur un autre appareil. La <strong>sauvegarde manuelle</strong> (fichier .json téléchargé) est la seule des deux qui
          survit à ça : à faire de temps en temps, ou juste avant une manipulation risquée.
        </p>
      </div>

      {serverMode && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <strong>Mode client/serveur :</strong> la restauration est désactivée ici. Elle ne modifierait que l'affichage de ce navigateur,
          sans rien changer sur le serveur, et serait effacée à la première actualisation — elle donnerait donc l'illusion d'avoir
          fonctionné. La restauration se fait côté serveur, en remettant les fichiers de <code>data\</code> depuis la sauvegarde
          quotidienne, puis en redémarrant le service (voir la procédure d'installation). Le téléchargement ci-dessous, lui, reste
          disponible : c'est une simple extraction de ce qui est affiché.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <button onClick={exportBackupFile} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
          Télécharger une sauvegarde (.json)
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importBusy || serverMode}
          title={serverMode ? 'Indisponible en mode client/serveur — voir ci-dessus.' : undefined}
          className="btn-ghost text-sm disabled:opacity-40"
        >
          {importBusy ? 'Lecture du fichier…' : 'Restaurer depuis un fichier…'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileChosen(file);
          }}
        />
      </div>
      {importError && <p className="text-xs text-red-600 dark:text-red-400">{importError}</p>}

      <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Historique automatique ({snapshots.length} point{snapshots.length > 1 ? 's' : ''})
          </h3>
          {snapshots.length > 0 && (
            <button onClick={doClearHistory} className="text-xs text-slate-300 hover:text-red-500">
              Vider l'historique
            </button>
          )}
        </div>
        {snapshots.length === 0 ? (
          <p className="text-xs text-slate-400">Aucun point enregistré pour l'instant.</p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {snapshots.map((snap) => (
              <div key={snap.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <span className="w-40 shrink-0 text-xs text-slate-500 dark:text-slate-400">{formatTimestamp(snap.createdAt)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">{snap.label}</span>
                <button
                  onClick={() => doRestore(snap)}
                  disabled={serverMode}
                  title={serverMode ? 'Indisponible en mode client/serveur — voir ci-dessus.' : undefined}
                  className="shrink-0 text-xs font-medium text-violet-600 hover:underline disabled:no-underline disabled:opacity-40 dark:text-violet-400"
                >
                  Restaurer
                </button>
                <button onClick={() => doRemoveSnapshot(snap)} className="shrink-0 text-xs text-slate-300 hover:text-red-500">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
