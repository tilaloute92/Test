import type { Diagram } from '../types'

/**
 * Client de l'API NetSchema.
 *
 * L'application fonctionne de deux façons, sans qu'il faille la recompiler :
 *
 * - **locale** : ouverte comme un fichier ou servie en statique, elle enregistre dans le
 *   navigateur. C'est le mode d'origine, et il reste le repli si le serveur ne répond pas.
 * - **serveur** : servie par le service NetSchema, elle demande une authentification et
 *   travaille sur des schémas partagés.
 *
 * Le mode est déduit au démarrage d'un seul appel : inutile de configurer quoi que ce soit
 * côté client.
 */

export type Role = 'lecteur' | 'editeur' | 'admin'

export interface SessionUser {
  id: string
  username: string
  displayName: string
  role: Role
}

export interface SessionInfo {
  mode: 'server' | 'local'
  authenticated: boolean
  user: SessionUser | null
  /** Aucun compte n'existe encore : la page de connexion explique comment en créer un. */
  setupRequired: boolean
}

export interface DiagramSummary {
  id: string
  title: string
  updatedAt: string
  updatedBy: string
  version: string
  nodes: number
  links: number
  locked: boolean
}

export class ApiError extends Error {
  readonly status: number
  /** Version côté serveur, renvoyée en cas de conflit d'enregistrement. */
  readonly version?: string

  constructor(status: number, message: string, version?: string) {
    super(message)
    this.status = status
    this.version = version
  }
}

const CSRF_COOKIE = 'netschema_csrf'

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)netschema_csrf=([^;]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  // Le jeton du cookie, répété en en-tête : c'est ce qu'une page tierce ne peut pas faire.
  if (!['GET', 'HEAD'].includes(method)) headers.set('X-CSRF-Token', csrfToken())

  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  })

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload.error === 'string' ? payload.error : `Erreur ${response.status}.`,
      typeof payload.version === 'string' ? payload.version : undefined,
    )
  }
  return payload as T
}

/**
 * Détecte le mode de fonctionnement. Un serveur absent, un 404 ou une réponse qui n'est pas
 * la nôtre : on retombe sur le mode local, sans message d'erreur — c'est un fonctionnement
 * normal, pas une panne.
 */
export async function detectSession(): Promise<SessionInfo> {
  const local: SessionInfo = { mode: 'local', authenticated: false, user: null, setupRequired: false }
  try {
    const info = await request<{
      mode: string
      authenticated: boolean
      user: SessionUser | null
      setupRequired: boolean
    }>('/session')
    if (info.mode !== 'server') return local
    return {
      mode: 'server',
      authenticated: info.authenticated,
      user: info.user,
      setupRequired: info.setupRequired === true,
    }
  } catch {
    return local
  }
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const result = await request<{ user: SessionUser }>('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  return result.user
}

export async function logout(): Promise<void> {
  await request('/logout', { method: 'POST' })
}

export async function changePassword(current: string, next: string): Promise<void> {
  await request('/password', { method: 'POST', body: JSON.stringify({ current, next }) })
}

export async function listDiagrams(): Promise<DiagramSummary[]> {
  const result = await request<{ diagrams: DiagramSummary[] }>('/diagrams')
  return result.diagrams
}

export async function fetchDiagram(id: string): Promise<{ diagram: Diagram; version: string; title: string; updatedAt: string; updatedBy: string }> {
  return request(`/diagrams/${encodeURIComponent(id)}`)
}

export async function createDiagram(title: string, diagram: Diagram): Promise<{ id: string; version: string }> {
  return request('/diagrams', { method: 'POST', body: JSON.stringify({ title, diagram }) })
}

export async function saveDiagram(
  id: string,
  diagram: Diagram,
  version: string | null,
): Promise<{ version: string; updatedAt: string; updatedBy: string }> {
  return request(`/diagrams/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ diagram, version, title: diagram.title }),
  })
}

export async function deleteDiagram(id: string): Promise<void> {
  await request(`/diagrams/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export { CSRF_COOKIE }
