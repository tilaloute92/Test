/**
 * Client pour le serveur d'authentification optionnel (voir server/README.md).
 * Toutes les requêtes utilisent `credentials: 'include'` pour envoyer/recevoir le
 * cookie de session httpOnly — c'est le serveur qui décide qui est connecté, pas ce
 * module (il ne fait que relayer). En développement, Vite proxifie /api vers le
 * serveur (voir vite.config.ts) ; en production, c'est IIS qui le fait (voir
 * DEPLOYMENT.md) — dans les deux cas l'appel reste "même origine" pour le navigateur.
 */

export interface BackendUser {
  username: string;
  name: string;
  method?: 'local' | 'ldap' | 'sso';
}

export interface LdapConfig {
  enabled: boolean;
  url: string;
  userDnPattern: string;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Si le serveur d'authentification n'est pas démarré, le proxy (Vite en développement,
// IIS en production) peut mettre du temps à signaler l'échec plutôt que de le renvoyer
// immédiatement — sans limite de temps ici, l'appel resterait "en attente" indéfiniment
// et bloquerait tout l'écran de connexion (page blanche). Cette limite garantit qu'on
// bascule toujours en mode "backend indisponible" en quelques secondes.
const REQUEST_TIMEOUT_MS = 3000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Erreur ${res.status}`, res.status);
  return data as T;
}

/** Vérifie si le serveur d'authentification est joignable — sinon l'app se rabat sur le SSO client seul. */
export async function backendAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { credentials: 'include', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getBackendSession(): Promise<BackendUser | null> {
  try {
    return await request<BackendUser>('/auth/me');
  } catch {
    return null;
  }
}

export const loginLocal = (username: string, password: string) =>
  request<BackendUser>('/auth/local', { method: 'POST', body: JSON.stringify({ username, password }) });

export const loginLdap = (username: string, password: string) =>
  request<BackendUser>('/auth/ldap', { method: 'POST', body: JSON.stringify({ username, password }) });

export const finalizeSsoSession = (idToken: string) =>
  request<BackendUser>('/auth/sso', { method: 'POST', body: JSON.stringify({ idToken }) });

export const backendLogout = () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' });

export const listLocalUsers = () => request<{ username: string; name: string }[]>('/auth/local-users');

export const createLocalUser = (username: string, password: string, name: string) =>
  request<{ ok: boolean }>('/auth/local-users', { method: 'POST', body: JSON.stringify({ username, password, name }) });

export const deleteLocalUser = (username: string) =>
  request<{ ok: boolean }>(`/auth/local-users/${encodeURIComponent(username)}`, { method: 'DELETE' });

export const getLdapConfig = () => request<LdapConfig>('/auth/ldap-config');

export const saveLdapConfig = (cfg: LdapConfig) => request<LdapConfig>('/auth/ldap-config', { method: 'PUT', body: JSON.stringify(cfg) });
