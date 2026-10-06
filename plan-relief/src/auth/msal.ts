import { PublicClientApplication } from '@azure/msal-browser';

/**
 * Connexion Microsoft Entra ID (SSO), même principe que Suivi Infra & Réseau : le navigateur
 * obtient un id_token auprès de Microsoft (flux Authorization Code + PKCE, sans secret),
 * puis l'envoie au service qui en vérifie lui-même la signature avant d'ouvrir une session.
 *
 * Différence : l'identifiant d'annuaire et d'application ne se saisissent pas dans le
 * navigateur. Ils viennent du service (ENTRA_TENANT_ID / ENTRA_CLIENT_ID dans son .env),
 * qui les expose sur /api/auth/methods : une seule configuration, sur le serveur.
 * L'URI de redirection est https://<site>/auth-redirect.html (voir src/auth/redirect.ts),
 * à déclarer dans Entra ID comme « Application monopage (SPA) ».
 */

let cached: { key: string; app: PublicClientApplication } | null = null;

async function getApp(tenantId: string, clientId: string) {
  const key = `${tenantId}|${clientId}`;
  if (cached?.key === key) return cached.app;
  const app = new PublicClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, redirectUri: `${window.location.origin}/auth-redirect.html` },
    // sessionStorage : la session Microsoft ne survit pas à la fermeture du navigateur ;
    // c'est la session du service (cookie httpOnly) qui fait foi.
    cache: { cacheLocation: 'sessionStorage' },
  });
  await app.initialize();
  cached = { key, app };
  return app;
}

/** Ouvre la fenêtre de connexion Microsoft et renvoie l'id_token à faire vérifier par le service. */
export async function microsoftIdToken(tenantId: string, clientId: string): Promise<string> {
  const app = await getApp(tenantId, clientId);
  const result = await app.loginPopup({ scopes: ['openid', 'profile'] });
  app.setActiveAccount(result.account);
  return result.idToken;
}

export async function microsoftLogout(tenantId: string, clientId: string) {
  const app = await getApp(tenantId, clientId);
  const account = app.getActiveAccount();
  if (account) await app.clearCache({ account });
}
