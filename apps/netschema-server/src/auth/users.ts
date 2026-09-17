import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { readJson, writeJsonAtomic } from '../store/files.ts'
import { hashPassword, passwordProblem, verifyPassword } from './passwords.ts'

/**
 * Comptes locaux.
 *
 * Trois rôles, volontairement peu nombreux : un lecteur consulte, un éditeur modifie les
 * schémas, un administrateur gère en plus les comptes. Le fichier est lu à chaque opération
 * plutôt que gardé en mémoire : il change rarement, et cela évite qu'un serveur laissé en
 * route ignore un compte désactivé à la main.
 */

export type Role = 'lecteur' | 'editeur' | 'admin'

export const ROLES: Role[] = ['lecteur', 'editeur', 'admin']

export interface User {
  id: string
  /** Identifiant de connexion, comparé en minuscules. */
  username: string
  displayName: string
  role: Role
  password: string
  createdAt: string
  disabled?: boolean
  /** Échecs consécutifs et blocage temporaire, contre l'essai de mots de passe en série. */
  failures?: number
  lockedUntil?: string
  lastLoginAt?: string
  /**
   * Génération de session : incrémentée à chaque changement de mot de passe ou désactivation.
   * Les cookies émis avant ne valent plus rien — c'est ce qui permet de fermer la porte à
   * quelqu'un sans attendre l'expiration de sa session.
   */
  sessionGeneration?: number
}

export interface PublicUser {
  id: string
  username: string
  displayName: string
  role: Role
}

export function publicUser(user: User): PublicUser {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role }
}

export class UserStore {
  private readonly file: string

  constructor(dataDir: string) {
    this.file = resolve(dataDir, 'users.json')
  }

  list(): User[] {
    return readJson<User[]>(this.file, [])
  }

  private save(users: User[]): void {
    writeJsonAtomic(this.file, users)
  }

  count(): number {
    return this.list().length
  }

  find(username: string): User | undefined {
    const wanted = username.trim().toLowerCase()
    return this.list().find((user) => user.username.toLowerCase() === wanted)
  }

  findById(id: string): User | undefined {
    return this.list().find((user) => user.id === id)
  }

  async create(input: {
    username: string
    password: string
    displayName?: string
    role?: Role
  }): Promise<User> {
    const username = input.username.trim()
    if (!/^[A-Za-z0-9._@-]{3,64}$/.test(username)) {
      throw new Error('Identifiant invalide : 3 à 64 caractères, lettres, chiffres, « . _ - @ ».')
    }
    if (this.find(username)) throw new Error(`Le compte « ${username} » existe déjà.`)
    const problem = passwordProblem(input.password)
    if (problem) throw new Error(problem)

    const user: User = {
      id: randomUUID(),
      username,
      displayName: input.displayName?.trim() || username,
      role: input.role ?? 'editeur',
      password: await hashPassword(input.password),
      createdAt: new Date().toISOString(),
    }
    this.save([...this.list(), user])
    return user
  }

  async setPassword(username: string, password: string): Promise<void> {
    const problem = passwordProblem(password)
    if (problem) throw new Error(problem)
    const hash = await hashPassword(password)
    this.update(username, (user) => ({
      ...user,
      password: hash,
      failures: 0,
      lockedUntil: undefined,
      sessionGeneration: (user.sessionGeneration ?? 0) + 1,
    }))
  }

  setRole(username: string, role: Role): void {
    this.update(username, (user) => ({ ...user, role }))
  }

  setDisabled(username: string, disabled: boolean): void {
    // Désactiver ferme aussi les sessions ouvertes : sans cela, la personne continuerait de
    // travailler jusqu'à l'expiration de son cookie.
    this.update(username, (user) => ({
      ...user,
      disabled: disabled || undefined,
      sessionGeneration: (user.sessionGeneration ?? 0) + 1,
    }))
  }

  remove(username: string): void {
    const users = this.list()
    const remaining = users.filter((user) => user.username.toLowerCase() !== username.trim().toLowerCase())
    if (remaining.length === users.length) throw new Error(`Compte « ${username} » introuvable.`)
    if (!remaining.some((user) => user.role === 'admin' && !user.disabled)) {
      throw new Error('Impossible : il ne resterait aucun administrateur actif.')
    }
    this.save(remaining)
  }

  private update(username: string, change: (user: User) => User): void {
    const wanted = username.trim().toLowerCase()
    const users = this.list()
    const index = users.findIndex((user) => user.username.toLowerCase() === wanted)
    if (index < 0) throw new Error(`Compte « ${username} » introuvable.`)
    const current = users[index]
    if (!current) throw new Error(`Compte « ${username} » introuvable.`)
    users[index] = change(current)
    this.save(users)
  }

  /**
   * Vérifie un couple identifiant / mot de passe.
   *
   * Le résultat ne distingue jamais « compte inconnu » de « mot de passe faux » : dire lequel
   * des deux est en cause revient à confirmer l'existence d'un compte. Seul le blocage
   * temporaire est annoncé, parce que l'utilisateur légitime doit comprendre pourquoi il
   * attend.
   */
  async authenticate(
    username: string,
    password: string,
    options: { lockAfterFailures: number; lockMinutes: number },
  ): Promise<{ ok: true; user: User } | { ok: false; reason: 'invalid' | 'locked' | 'disabled' }> {
    const user = this.find(username)
    if (!user) {
      // Coût comparable à une vérification réelle : l'absence de compte ne se devine pas au
      // temps de réponse.
      await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')
      return { ok: false, reason: 'invalid' }
    }
    if (user.disabled) return { ok: false, reason: 'disabled' }
    if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
      return { ok: false, reason: 'locked' }
    }

    const valid = await verifyPassword(password, user.password)
    if (!valid) {
      const failures = (user.failures ?? 0) + 1
      const locked = failures >= options.lockAfterFailures
      this.update(user.username, (current) => ({
        ...current,
        failures: locked ? 0 : failures,
        lockedUntil: locked ? new Date(Date.now() + options.lockMinutes * 60_000).toISOString() : current.lockedUntil,
      }))
      return { ok: false, reason: locked ? 'locked' : 'invalid' }
    }

    this.update(user.username, (current) => ({
      ...current,
      failures: 0,
      lockedUntil: undefined,
      lastLoginAt: new Date().toISOString(),
    }))
    return { ok: true, user }
  }
}
