import { PublicClientApplication, type AccountInfo, type Configuration } from '@azure/msal-browser';
import type { AuthSettings } from '../types';

/**
 * Thin wrapper around @azure/msal-browser for Microsoft Entra ID (Azure AD) single
 * sign-on. This is the ONLY SSO path that works without a backend server: Entra ID's
 * public-client OAuth2/OIDC flow (Authorization Code + PKCE) lets a static, purely
 * client-side app redirect to Microsoft, get the user authenticated there, and receive
 * tokens back — with no client secret and no server-side code involved.
 *
 * It only works for accounts that exist in Entra ID (cloud-only, or on-prem AD accounts
 * synced to Entra ID via Azure AD Connect / Entra Connect). A purely on-prem Active
 * Directory with no cloud sync cannot be reached this way — that requires a backend
 * service that can perform an LDAP bind, which this static app does not have.
 *
 * See src/components/SettingsView.tsx for the setup instructions shown to the admin.
 */

let cachedInstance: PublicClientApplication | null = null;
let cachedKey = '';

function settingsKey(settings: AuthSettings): string {
  return `${settings.tenantId}|${settings.clientId}|${settings.redirectUri}`;
}

/** Builds (and memoizes) the MSAL client for the current settings. Re-creates it if the settings change. */
export async function getMsalInstance(settings: AuthSettings): Promise<PublicClientApplication> {
  const key = settingsKey(settings);
  if (cachedInstance && cachedKey === key) return cachedInstance;

  const config: Configuration = {
    auth: {
      clientId: settings.clientId,
      authority: `https://login.microsoftonline.com/${settings.tenantId}`,
      redirectUri: settings.redirectUri,
    },
    cache: {
      // localStorage keeps the session across browser restarts, consistent with how
      // the rest of this app persists its data. MSAL only stores tokens/session info
      // here, never a password.
      cacheLocation: 'localStorage',
    },
  };

  const instance = new PublicClientApplication(config);
  await instance.initialize();
  cachedInstance = instance;
  cachedKey = key;
  return cachedInstance;
}

export function isAuthConfigured(settings: AuthSettings): boolean {
  return Boolean(settings.tenantId.trim() && settings.clientId.trim() && settings.redirectUri.trim());
}

/** Returns a cached account (from a previous session) without any user interaction, or null. */
export async function trySilentAccount(settings: AuthSettings): Promise<AccountInfo | null> {
  if (!isAuthConfigured(settings)) return null;
  const instance = await getMsalInstance(settings);
  const accounts = instance.getAllAccounts();
  if (accounts.length === 0) return null;
  instance.setActiveAccount(accounts[0]);
  return accounts[0];
}

/** Opens the Microsoft sign-in popup. Throws on failure/cancellation — caller should catch and show the message. */
export async function signIn(settings: AuthSettings): Promise<AccountInfo> {
  const instance = await getMsalInstance(settings);
  const result = await instance.loginPopup({ scopes: ['User.Read'] });
  instance.setActiveAccount(result.account);
  return result.account;
}

/**
 * Same as signIn, but also returns the raw id_token (JWT). Used when a backend is
 * available: the token is sent to it so it can verify the signature itself and open a
 * real server-side session (see src/auth/backendAuth.ts) — the client-side account
 * object alone is not something the server can trust.
 */
export async function signInWithIdToken(settings: AuthSettings): Promise<{ account: AccountInfo; idToken: string }> {
  const instance = await getMsalInstance(settings);
  const result = await instance.loginPopup({ scopes: ['User.Read'] });
  instance.setActiveAccount(result.account);
  return { account: result.account, idToken: result.idToken };
}

export async function signOut(settings: AuthSettings): Promise<void> {
  const instance = await getMsalInstance(settings);
  const account = instance.getActiveAccount();
  await instance.logoutPopup({ account: account ?? undefined });
}
