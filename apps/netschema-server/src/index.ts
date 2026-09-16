import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { UserStore } from './auth/users.ts'
import { AuditLog } from './store/audit.ts'
import { DiagramStore } from './store/diagrams.ts'

/**
 * Point d'entrée du service.
 *
 * Écoute en HTTP ou en HTTPS selon la configuration, et s'arrête proprement quand Windows
 * lui demande de s'arrêter : les requêtes en cours se terminent, aucune écriture n'est
 * coupée en deux.
 */

const config = loadConfig()
const services = {
  config,
  users: new UserStore(config.dataDir),
  diagrams: new DiagramStore(config.dataDir),
  audit: new AuditLog(config.dataDir),
}

const app = createApp(services)

/**
 * Certificat : soit deux fichiers PEM, soit un PFX exporté du magasin Windows — cette
 * seconde forme évite une conversion par OpenSSL sur un serveur qui n'en dispose pas.
 */
function tlsOptions() {
  if (config.tlsPfx) {
    return {
      pfx: readFileSync(config.tlsPfx),
      ...(config.tlsPassphrase ? { passphrase: config.tlsPassphrase } : {}),
      minVersion: 'TLSv1.2' as const,
    }
  }
  return {
    cert: readFileSync(config.tlsCert!),
    key: readFileSync(config.tlsKey!),
    minVersion: 'TLSv1.2' as const,
  }
}

const server = config.https ? createHttpsServer(tlsOptions(), app) : createHttpServer(app)

server.listen(config.port, config.host, () => {
  const scheme = config.https ? 'https' : 'http'
  console.log(`[netschema] ${scheme}://${config.host}:${config.port}`)
  console.log(`[netschema] données   : ${config.dataDir}`)
  console.log(`[netschema] interface : ${config.webDir}`)
  if (services.users.count() === 0) {
    console.warn(
      '[netschema] aucun compte : créez le premier administrateur avec\n' +
        '            npm run user -- add <identifiant> --role admin',
    )
  }
  if (!config.https && config.host !== '127.0.0.1' && !config.trustProxy) {
    console.warn(
      "[netschema] attention : écoute en clair sur le réseau. Fournissez un certificat\n" +
        '            (NETSCHEMA_TLS_PFX, ou NETSCHEMA_TLS_CERT / NETSCHEMA_TLS_KEY) ou placez\n' +
        '            le service derrière IIS.',
    )
  }
})

function shutdown(signal: string) {
  console.log(`[netschema] arrêt (${signal})…`)
  server.close(() => process.exit(0))
  // Filet de sécurité : on ne laisse pas une connexion bloquée retenir le service.
  setTimeout(() => process.exit(0), 10_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
