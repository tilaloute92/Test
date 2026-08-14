import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { Card } from './ui';
import { isAuthConfigured, signIn, signOut, trySilentAccount } from '../auth/msalClient';
import type { AccountInfo } from '@azure/msal-browser';

export function SettingsView() {
  const { authSettings, updateAuthSettings } = useStore();
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [httpsOk, setHttpsOk] = useState(false);

  useEffect(() => {
    setHttpsOk(window.location.protocol === 'https:');
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
      const acc = await signIn(authSettings);
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

      {/* ------------------------------------------------------------------ */}
      {/* 1. SSO Microsoft Entra ID — la seule connexion automatique possible */}
      {/*    sans serveur : le navigateur redirige vers Microsoft, qui       */}
      {/*    authentifie l'utilisateur et renvoie un jeton. Aucun secret     */}
      {/*    d'application n'est nécessaire ni stocké ici (flux "client      */}
      {/*    public" avec PKCE).                                            */}
      {/* ------------------------------------------------------------------ */}
      <Card className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Connexion automatique — Microsoft Entra ID (SSO)</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Permet à vous et votre équipe de vous connecter avec votre compte Microsoft professionnel (le même que Windows/Office 365),
            sans mot de passe séparé. Fonctionne uniquement si vos comptes existent dans <strong>Microsoft Entra ID</strong> (anciennement
            Azure AD) — soit nativement (cloud), soit synchronisés depuis votre Active Directory local via <em>Azure AD Connect</em>. Un
            compte qui n'existe que dans un AD purement local, sans aucune synchronisation vers le cloud, ne peut pas se connecter par ce
            biais : il faudrait alors un petit serveur dédié pour interroger l'annuaire directement (voir section suivante).
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
          </ol>
        </details>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">ID d'annuaire (locataire / tenant ID)</span>
            <input
              value={authSettings.tenantId}
              onChange={(e) => updateAuthSettings({ tenantId: e.target.value.trim() })}
              placeholder="ex : 8f3b2c1a-....-....-....-............"
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">ID d'application (client ID)</span>
            <input
              value={authSettings.clientId}
              onChange={(e) => updateAuthSettings({ clientId: e.target.value.trim() })}
              placeholder="ex : 1a2b3c4d-....-....-....-............"
              className="input"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
            URI de redirection (doit être identique à celle enregistrée dans Entra ID)
          </span>
          <input
            value={authSettings.redirectUri}
            onChange={(e) => updateAuthSettings({ redirectUri: e.target.value.trim() })}
            className="input"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={authSettings.requireLogin}
            onChange={(e) => updateAuthSettings({ requireLogin: e.target.checked, enabled: e.target.checked || authSettings.enabled })}
          />
          Exiger la connexion pour ouvrir l'application (une fois testée et fonctionnelle)
        </label>
        {authSettings.requireLogin && !httpsOk && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            L'application n'est pas servie en HTTPS actuellement. N'activez la connexion obligatoire qu'une fois le HTTPS en place (voir
            section "Sécurité" ci-dessous) : les jetons de connexion ne doivent jamais transiter en clair.
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
      {/* 2. Active Directory local (LDAP) — expliqué honnêtement : cette    */}
      {/*    application est un site statique sans serveur, et un navigateur */}
      {/*    ne peut techniquement pas parler le protocole LDAP (connexion   */}
      {/*    réseau bas niveau vers le port 389/636). Il n'y a donc pas de   */}
      {/*    formulaire fonctionnel ici — un formulaire qui aurait l'air de  */}
      {/*    marcher sans rien faire serait trompeur.                       */}
      {/* ------------------------------------------------------------------ */}
      <Card className="space-y-2 p-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Annuaire Active Directory local (LDAP)</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Non disponible dans cette version. Un navigateur ne peut pas interroger un annuaire LDAP directement (ce n'est pas un protocole
          web) : il faut un petit service serveur qui fait la connexion à l'annuaire à votre place. Comme cette application est un site
          statique sans serveur, on ne peut pas l'implémenter ici sans changer son mode d'hébergement.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Si une partie de vos comptes n'est pas synchronisée vers Entra ID (donc pas couverte par la section ci-dessus), la solution est
          d'ajouter un petit serveur (quelques dizaines de lignes, ex. Node.js + <code>ldapjs</code>) qui vérifie les identifiants auprès
          de votre contrôleur de domaine et ouvre une session. Dites-le-moi si vous voulez qu'on l'ajoute : ça implique d'avoir un serveur
          disponible en continu dans votre infrastructure, ce que vous m'avez indiqué vouloir éviter pour l'instant.
        </p>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* 3. Sécurité / HTTPS — le certificat TLS se configure toujours côté */}
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
          N'activez "Exiger la connexion" dans la section SSO ci-dessus qu'une fois le HTTPS effectif : sans lui, les échanges
          d'authentification circuleraient en clair sur le réseau.
        </p>
      </Card>
    </div>
  );
}
