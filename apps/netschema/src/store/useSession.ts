import { create } from 'zustand'
import * as api from '../lib/api'
import { emptyDiagram } from '../lib/storage'
import { useDiagram } from './useDiagram'
import type { Diagram } from '../types'

/**
 * Séance de travail côté serveur.
 *
 * Ce magasin ne connaît que l'accès distant : qui est connecté, quel schéma est ouvert, dans
 * quelle version, et si l'enregistrement a réussi. Le schéma lui-même reste dans `useDiagram`
 * — ce qui permet à l'application de fonctionner exactement pareil sans serveur.
 */

export interface SessionState {
  ready: boolean
  mode: 'server' | 'local'
  user: api.SessionUser | null
  setupRequired: boolean
  /** Schéma serveur ouvert, et version connue pour détecter les modifications concurrentes. */
  currentId: string | null
  version: string | null
  projects: api.DiagramSummary[]
  saving: boolean
  savedAt: string | null
  error: string | null
  /** Conflit détecté : quelqu'un d'autre a enregistré entre-temps. */
  conflict: boolean
  projectsOpen: boolean

  start: () => Promise<void>
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProjects: () => Promise<void>
  open: (id: string) => Promise<void>
  /** `from: 'current'` publie le schéma ouvert sous un nouveau nom ; sinon on part de zéro. */
  createProject: (title: string, from?: 'empty' | 'current') => Promise<void>
  removeProject: (id: string) => Promise<void>
  save: (options?: { force?: boolean }) => Promise<void>
  setProjectsOpen: (open: boolean) => void
  dismissError: () => void
}

/** Un lecteur ne modifie rien : le schéma s'ouvre alors en lecture seule. */
export function canEdit(user: api.SessionUser | null): boolean {
  return user?.role === 'editeur' || user?.role === 'admin'
}

const LAST_PROJECT_KEY = 'netschema:lastProject'

export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  mode: 'local',
  user: null,
  setupRequired: false,
  currentId: null,
  version: null,
  projects: [],
  saving: false,
  savedAt: null,
  error: null,
  conflict: false,
  projectsOpen: false,

  start: async () => {
    const info = await api.detectSession()
    set({
      ready: true,
      mode: info.mode,
      user: info.user,
      setupRequired: info.setupRequired,
    })
    if (info.mode === 'server' && info.authenticated) {
      await get().refreshProjects()
      // On rouvre le dernier schéma travaillé : sur un serveur partagé, c'est ce qu'on
      // attend en revenant le lendemain.
      const last = localStorage.getItem(LAST_PROJECT_KEY)
      const projects = get().projects
      const target = projects.find((project) => project.id === last) ?? projects[0]
      if (target) await get().open(target.id)
    }
  },

  signIn: async (username, password) => {
    set({ error: null })
    try {
      const user = await api.login(username, password)
      set({ user })
      await get().refreshProjects()
      const projects = get().projects
      const last = localStorage.getItem(LAST_PROJECT_KEY)
      const target = projects.find((project) => project.id === last) ?? projects[0]
      if (target) await get().open(target.id)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Connexion impossible.' })
      throw error
    }
  },

  signOut: async () => {
    await api.logout().catch(() => undefined)
    set({ user: null, currentId: null, version: null, projects: [], savedAt: null })
  },

  refreshProjects: async () => {
    try {
      set({ projects: await api.listDiagrams() })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Liste des schémas indisponible.' })
    }
  },

  open: async (id) => {
    try {
      const loaded = await api.fetchDiagram(id)
      const diagram = loaded.diagram as Diagram
      useDiagram.getState().loadDiagram({
        ...diagram,
        // Un lecteur ne doit rien pouvoir modifier : le schéma s'ouvre verrouillé.
        locked: diagram.locked || !canEdit(get().user) || undefined,
      })
      localStorage.setItem(LAST_PROJECT_KEY, id)
      set({ currentId: id, version: loaded.version, conflict: false, error: null, savedAt: loaded.updatedAt })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Ouverture impossible.' })
    }
  },

  createProject: async (title, from = 'empty') => {
    try {
      const base = from === 'current' ? useDiagram.getState().diagram : emptyDiagram()
      const diagram = { ...base, title }
      const created = await api.createDiagram(title, diagram)
      await get().refreshProjects()
      set({ currentId: created.id, version: created.version, conflict: false, savedAt: new Date().toISOString() })
      localStorage.setItem(LAST_PROJECT_KEY, created.id)
      // Le plan de travail suit ce que l'on vient de créer, vide ou repris.
      useDiagram.getState().loadDiagram(diagram)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Création impossible.' })
    }
  },

  removeProject: async (id) => {
    try {
      await api.deleteDiagram(id)
      if (get().currentId === id) set({ currentId: null, version: null })
      await get().refreshProjects()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Suppression impossible.' })
    }
  },

  /**
   * Enregistrement sur le serveur, avec contrôle de version. En cas de conflit, rien n'est
   * écrasé : l'utilisateur est prévenu et choisit de recharger ou de forcer.
   */
  save: async (options) => {
    const { currentId, version, user } = get()
    if (!currentId || !canEdit(user)) return
    set({ saving: true, error: null })
    try {
      const result = await api.saveDiagram(currentId, useDiagram.getState().diagram, options?.force ? null : version)
      set({ version: result.version, savedAt: result.updatedAt, saving: false, conflict: false })
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 409) {
        set({ saving: false, conflict: true, error: error.message })
        return
      }
      set({ saving: false, error: error instanceof Error ? error.message : 'Enregistrement impossible.' })
    }
  },

  setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
  dismissError: () => set({ error: null }),
}))
