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
  /** Le compte « admin » tourne encore avec le mot de passe public livré par l'installateur.
   *  L'application l'affiche en bandeau tant que ce n'est pas corrigé. */
  defaultPassword?: boolean;
  /** Ce compte peut-il modifier la configuration (comptes locaux, LDAP, SSO) ? Décidé par le
   *  serveur (voir server/src/auth/admin.js), jamais déduit de l'identifiant ici : la liste
   *  des administrateurs est extensible, et deux définitions divergentes afficheraient des
   *  commandes que le serveur refuserait ensuite. */
  isAdmin?: boolean;
}

export interface LdapConfig {
  enabled: boolean;
  url: string;
  /** « pattern » : le DN se déduit de l'identifiant (UPN). « search » : un compte de
   *  service retrouve la personne dans l'annuaire, seul mode permettant l'identifiant
   *  Windows court et la restriction par groupe. */
  mode: 'pattern' | 'search';
  userDnPattern: string;
  baseDN: string;
  userFilter: string;
  bindDN: string;
  displayNameAttribute: string;
  mailAttribute: string;
  requiredGroup: string;
  tlsRejectUnauthorized: boolean;
  timeoutMs: number;
  /** Le mot de passe du compte de service ne sort jamais du serveur ; seule sa présence
   *  est connue du navigateur. */
  bindPasswordSet: boolean;
}

/** Ce qu'on envoie pour enregistrer. `bindPassword` omis = inchangé côté serveur. */
export type LdapConfigInput = Omit<LdapConfig, 'bindPasswordSet'> & { bindPassword?: string };

/** Une étape du diagnostic renvoyé par le test de configuration. */
export interface LdapTestStep {
  etape: string;
  ok: boolean;
  detail: string;
}

export interface LdapTestResult {
  ok: boolean;
  user?: { username: string; name: string; email?: string };
  journal: LdapTestStep[];
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

/** `timeoutMs` desserre la limite ci-dessus pour les appels qui interrogent un système
 *  tiers — un contrôleur de domaine injoignable met bien plus de 3 secondes à le dire, et
 *  abandonner avant transformerait un diagnostic utile en « délai dépassé ». */
async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...reste } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...reste,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs ?? REQUEST_TIMEOUT_MS),
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

export const saveLdapConfig = (cfg: LdapConfigInput) =>
  request<LdapConfig>('/auth/ldap-config', { method: 'PUT', body: JSON.stringify(cfg) });

/** Éprouve la configuration LDAP enregistrée, sans se déconnecter — la seule façon de le
 *  faire jusqu'ici était de fermer sa session et d'essayer, en restant dehors si le
 *  réglage était faux. Les identifiants servent au seul bind, ils ne sont pas conservés.
 *  Un test LDAP peut être long (annuaire injoignable, délai réseau), d'où le délai propre. */
export const testLdapConfig = (username: string, password: string) =>
  request<LdapTestResult>('/auth/ldap-test', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
    timeoutMs: 30000,
  });
