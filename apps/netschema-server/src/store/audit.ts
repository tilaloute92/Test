import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ensureDir } from './files.ts'

/**
 * Journal d'audit.
 *
 * Une ligne JSON par événement, en append seul : lisible par un humain, analysable par un
 * script, et rien à purger d'urgent puisque le fichier reste petit (un événement par
 * connexion ou par enregistrement). C'est le minimum qu'on attend d'une application posée
 * sur un serveur d'entreprise : savoir qui a changé quoi, et quand.
 */

export type AuditEvent =
  | 'login'
  | 'login-refuse'
  | 'logout'
  | 'schema-cree'
  | 'schema-modifie'
  | 'schema-supprime'
  | 'compte-modifie'

export class AuditLog {
  private readonly file: string

  constructor(dataDir: string) {
    ensureDir(dataDir)
    this.file = resolve(dataDir, 'audit.log')
  }

  write(event: AuditEvent, details: Record<string, unknown>): void {
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...details })
    try {
      appendFileSync(this.file, `${line}\n`, 'utf8')
    } catch {
      // Un journal indisponible ne doit pas empêcher le service de fonctionner ; l'erreur
      // sera visible dans la sortie du service au prochain démarrage.
    }
  }
}
