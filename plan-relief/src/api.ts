import type { PlanRecord, PlanSummary, SearchHit } from './lib/types';

/**
 * Client du service (server/). Toutes les requêtes envoient le cookie de session httpOnly :
 * c'est le serveur qui décide qui est connecté, ce module ne fait que relayer. En
 * développement, Vite relaie /api vers le service (vite.config.ts) ; en production, c'est
 * IIS (DEPLOYMENT.md). Dans les deux cas l'appel reste « même origine » pour le navigateur.
 */

export interface User { username: string; name: string; method?: 'local' | 'ldap' | 'sso' }
export interface LoginMethods { local: boolean; ldap: boolean; sso: { tenantId: string; clientId: string } | null }
export interface LdapConfig { enabled: boolean; url: string; userDnPattern: string }

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Appelé quand le serveur répond 401 en cours d'utilisation (session expirée). */
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function request<T>(path: string, init: RequestInit & { timeout?: number } = {}): Promise<T> {
  const { timeout = 15000, ...rest } = init;
  const isForm = rest.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...rest,
      credentials: 'include',
      headers: isForm ? rest.headers : { 'Content-Type': 'application/json', ...(rest.headers ?? {}) },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    throw new ApiError(timedOut ? 'Le serveur ne répond pas.' : 'Serveur injoignable.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `Erreur ${res.status}`, res.status, data);
  return data as T;
}

// Une sonde courte : si le service est arrêté, le proxy peut mettre longtemps à le dire.
export async function health(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { credentials: 'include', signal: AbortSignal.timeout(4000) });
    const body = await res.json();
    return res.ok && body.app === 'plan-relief';
  } catch {
    return false;
  }
}

export const getMethods = () => request<LoginMethods>('/auth/methods', { timeout: 4000 });
export async function getSession(): Promise<User | null> {
  try { return await request<User>('/auth/me', { timeout: 4000 }); } catch { return null; }
}
export const loginLocal = (username: string, password: string) => request<User>('/auth/local', { method: 'POST', body: JSON.stringify({ username, password }) });
export const loginLdap = (username: string, password: string) => request<User>('/auth/ldap', { method: 'POST', body: JSON.stringify({ username, password }) });
export const loginSso = (idToken: string) => request<User>('/auth/sso', { method: 'POST', body: JSON.stringify({ idToken }) });
export const logout = () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' });

export const listLocalUsers = () => request<{ username: string; name: string }[]>('/auth/local-users');
export const createLocalUser = (username: string, password: string, name: string) =>
  request<{ ok: boolean }>('/auth/local-users', { method: 'POST', body: JSON.stringify({ username, password, name }) });
export const deleteLocalUser = (username: string) => request<{ ok: boolean }>(`/auth/local-users/${encodeURIComponent(username)}`, { method: 'DELETE' });
export const getLdapConfig = () => request<LdapConfig>('/auth/ldap-config');
export const saveLdapConfig = (cfg: LdapConfig) => request<LdapConfig>('/auth/ldap-config', { method: 'PUT', body: JSON.stringify(cfg) });

export const listPlans = () => request<PlanSummary[]>('/plans');
export const getPlan = (id: string) => request<PlanRecord>(`/plans/${id}`, { timeout: 60000 });
export const deletePlan = (id: string) => request<{ ok: boolean }>(`/plans/${id}`, { method: 'DELETE' });
export const updatePlan = (id: string, patch: Partial<PlanRecord> & { version: number }) =>
  request<PlanRecord>(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(patch), timeout: 60000 });

export async function fetchPlanFile(id: string): Promise<ArrayBuffer> {
  const res = await fetch(`/api/plans/${id}/file`, { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `Erreur ${res.status}`, res.status);
  }
  return res.arrayBuffer();
}

export function uploadPlan(file: File, data: object) {
  const fd = new FormData();
  fd.append('data', JSON.stringify(data));
  fd.append('file', file, file.name);
  return request<{ plan: PlanSummary; duplicateOf: { id: string; name: string } | null }>('/plans', { method: 'POST', body: fd, timeout: 300000 });
}

export type SearchHitList = SearchHit[];

export function searchEquipment(params: { q: string; site?: string; kind?: string; plan?: string }) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  return request<{ total: number; results: SearchHit[] }>(`/search?${qs}`);
}
