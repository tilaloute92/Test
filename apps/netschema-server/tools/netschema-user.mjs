#!/usr/bin/env node
/**
 * Gestion des comptes, en ligne de commande.
 *
 * C'est l'outil d'administration du serveur : créer le premier administrateur, réinitialiser
 * un mot de passe oublié, désactiver un départ. Il travaille sur le même fichier que le
 * service et n'a besoin d'aucune dépendance — utilisable depuis une session RDP sur le
 * serveur, sans que le service tourne.
 *
 *   node tools/netschema-user.mjs add rnelson --role admin
 *   node tools/netschema-user.mjs passwd rnelson
 *   node tools/netschema-user.mjs list
 *   node tools/netschema-user.mjs role rnelson editeur
 *   node tools/netschema-user.mjs disable rnelson
 *   node tools/netschema-user.mjs remove rnelson
 */
import { randomUUID, scrypt as scryptCallback, timingSafeEqual, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = isAbsolute(process.env.NETSCHEMA_DATA_DIR ?? '')
  ? process.env.NETSCHEMA_DATA_DIR
  : resolve(packageRoot, process.env.NETSCHEMA_DATA_DIR ?? 'data')
const file = resolve(dataDir, 'users.json')

const ROLES = ['lecteur', 'editeur', 'admin']
const MIN_LENGTH = 12

function read() {
  if (!existsSync(file)) return []
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`Fichier de comptes illisible : ${file}`)
  }
}

function write(users) {
  mkdirSync(dataDir, { recursive: true })
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temporary, JSON.stringify(users, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, file)
}

async function hash(password) {
  const salt = randomBytes(16)
  const key = await scrypt(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`
}

function problem(password) {
  if (password.length < MIN_LENGTH) return `Au moins ${MIN_LENGTH} caractères.`
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length
  if (classes < 3) return 'Mêlez au moins trois catégories : minuscules, majuscules, chiffres, symboles.'
  return null
}

/** Saisie masquée : le mot de passe ne doit pas rester dans l'historique du terminal. */
function askHidden(question) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const onData = (char) => {
      if (['\n', '\r', ''].includes(String(char))) process.stdin.removeListener('data', onData)
      else process.stdout.write('[2K[200D' + question + '*'.repeat(rl.line.length))
    }
    process.stdout.write(question)
    process.stdin.on('data', onData)
    rl.question('', (answer) => {
      rl.close()
      process.stdout.write('\n')
      done(answer)
    })
  })
}

async function askPassword() {
  const first = await askHidden('Mot de passe : ')
  const issue = problem(first)
  if (issue) throw new Error(issue)
  const second = await askHidden('Confirmation  : ')
  const a = Buffer.from(first)
  const b = Buffer.from(second)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Les deux saisies diffèrent.')
  return first
}

/**
 * Mot de passe lu sur l'entrée standard (`--password-stdin`).
 *
 * C'est ainsi que le script d'installation transmet la saisie masquée qu'il a faite lui-même :
 * un mot de passe passé en argument serait visible de toute la machine dans la liste des
 * processus, et le masquage maison ci-dessus suppose une console qui comprenne les codes ANSI
 * — ce qui n'est pas garanti sur les anciens Windows Server.
 */
function readStdin() {
  return new Promise((done, fail) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => done(data.replace(/\r?\n$/, '')))
    process.stdin.on('error', fail)
  })
}

/** Mot de passe : argument, entrée standard, ou saisie masquée interactive. */
async function resolvePassword(args) {
  const given = option(args, 'password', null)
  if (given) return given
  if (args.includes('--password-stdin')) {
    const value = await readStdin()
    if (!value) throw new Error('Aucun mot de passe reçu sur l’entrée standard.')
    return value
  }
  return askPassword()
}

function option(args, name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

function find(users, username) {
  const wanted = String(username).trim().toLowerCase()
  const index = users.findIndex((user) => user.username.toLowerCase() === wanted)
  if (index < 0) throw new Error(`Compte « ${username} » introuvable.`)
  return index
}

const [command, target, ...rest] = process.argv.slice(2)

try {
  const users = read()

  switch (command) {
    case 'add': {
      if (!target) throw new Error('Identifiant attendu : add <identifiant> [--role admin] [--nom "Nom affiché"]')
      if (!/^[A-Za-z0-9._@-]{3,64}$/.test(target)) throw new Error('Identifiant : 3 à 64 caractères (lettres, chiffres, . _ - @).')
      if (users.some((user) => user.username.toLowerCase() === target.toLowerCase())) {
        throw new Error(`Le compte « ${target} » existe déjà.`)
      }
      const role = option(rest, 'role', 'editeur')
      if (!ROLES.includes(role)) throw new Error(`Rôle inconnu : ${role} (${ROLES.join(', ')}).`)
      const password = await resolvePassword(rest)
      const issue = problem(password)
      if (issue) throw new Error(issue)
      users.push({
        id: randomUUID(),
        username: target,
        displayName: option(rest, 'nom', target),
        role,
        password: await hash(password),
        createdAt: new Date().toISOString(),
      })
      write(users)
      console.log(`Compte « ${target} » créé (rôle ${role}).`)
      break
    }

    case 'passwd': {
      if (!target) throw new Error('Identifiant attendu : passwd <identifiant>')
      const index = find(users, target)
      const password = await resolvePassword(rest)
      const issue = problem(password)
      if (issue) throw new Error(issue)
      users[index] = { ...users[index], password: await hash(password), failures: 0, lockedUntil: undefined }
      write(users)
      console.log(`Mot de passe de « ${users[index].username} » changé.`)
      break
    }

    case 'role': {
      const role = rest[0]
      if (!target || !ROLES.includes(role)) throw new Error(`role <identifiant> <${ROLES.join('|')}>`)
      const index = find(users, target)
      users[index] = { ...users[index], role }
      write(users)
      console.log(`« ${users[index].username} » est désormais ${role}.`)
      break
    }

    case 'disable':
    case 'enable': {
      if (!target) throw new Error(`${command} <identifiant>`)
      const index = find(users, target)
      users[index] = { ...users[index], disabled: command === 'disable' ? true : undefined }
      write(users)
      console.log(`« ${users[index].username} » ${command === 'disable' ? 'désactivé' : 'réactivé'}.`)
      break
    }

    case 'remove': {
      if (!target) throw new Error('remove <identifiant>')
      const index = find(users, target)
      const remaining = users.filter((_, position) => position !== index)
      if (!remaining.some((user) => user.role === 'admin' && !user.disabled)) {
        throw new Error('Refusé : il ne resterait aucun administrateur actif.')
      }
      write(remaining)
      console.log(`Compte « ${users[index].username} » supprimé.`)
      break
    }

    case 'list': {
      if (users.length === 0) {
        console.log('Aucun compte. Créez le premier administrateur :')
        console.log('  node tools/netschema-user.mjs add <identifiant> --role admin')
        break
      }
      console.log(`${users.length} compte(s) — ${file}`)
      for (const user of users) {
        const flags = [user.disabled ? 'désactivé' : null, user.lockedUntil ? `bloqué jusqu'à ${user.lockedUntil}` : null]
          .filter(Boolean)
          .join(', ')
        console.log(
          `  ${user.username.padEnd(20)} ${user.role.padEnd(8)} ${user.displayName}${flags ? `  (${flags})` : ''}`,
        )
      }
      break
    }

    default:
      console.log(
        [
          'Gestion des comptes NetSchema',
          '',
          '  add <identifiant> [--role lecteur|editeur|admin] [--nom "Nom"] [--password "…"]',
          '  passwd <identifiant> [--password "…"]',
          '  role <identifiant> <lecteur|editeur|admin>',
          '  disable <identifiant> | enable <identifiant>',
          '  remove <identifiant>',
          '  list',
          '',
          `Fichier de comptes : ${file}`,
          '',
          'Sans --password, le mot de passe est demandé de façon masquée (recommandé :',
          "il n'apparaît alors ni à l'écran ni dans l'historique du terminal).",
        ].join('\n'),
      )
  }
} catch (error) {
  console.error(`Erreur : ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
