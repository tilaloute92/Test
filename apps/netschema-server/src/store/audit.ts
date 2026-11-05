import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ensureDir, rotateIfLarge } from './files.ts'

/**
 * Journal d'audit.
 *
 * Une ligne JSON par événement, en append seul : lisible par un humain, analysable par un
 * script. C'est le minimum qu'on attend d'une application posée sur un serveur
 * d'entreprise : savoir qui a changé quoi, et quand.
 *
 * Le fichier tourne tout seul au-delà de 5 Mo — environ 30 000 événements — et quatre
 * générations sont gardées. Sans cela il grossit indéfiniment : personne ne vient jamais
 * purger à la main le journal d'un service qui marche.
 */

export type AuditEvent =
  | 'login'
  | 'login-refuse'
  | 'logout'
  | 'schema-cree'
  | 'schema-modifie'
  | 'schema-supprime'
  | 'compte-modifie'

/** Taille au-delà de laquelle le journal tourne, et nombre de générations gardées. */
const MAX_BYTES = 5 * 1024 * 1024
const GENERATIONS = 4

export class AuditLog {
  private readonly file: string

  constructor(dataDir: string) {
    ensureDir(dataDir)
    this.file = resolve(dataDir, 'audit.log')
  }

  write(event: AuditEvent, details: Record<string, unknown>): void {
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...details })
    try {
      // Contrôlé à l'écriture plutôt que par une minuterie : un service peut rester des
      // semaines sans rien journaliser, et une minuterie tournerait pour rien.
      rotateIfLarge(this.file, MAX_BYTES, GENERATIONS)
      appendFileSync(this.file, `${line}\n`, 'utf8')
    } catch {
      // Un journal indisponible ne doit pas empêcher le service de fonctionner ; l'erreur
      // sera visible dans la sortie du service au prochain démarrage.
    }
  }
}
