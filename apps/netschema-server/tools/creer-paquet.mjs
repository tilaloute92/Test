#!/usr/bin/env node
/**
 * Fabrique le paquet d'installation Windows de NetSchema.
 *
 * Le paquet contient tout ce qu'il faut pour installer le service sans compiler quoi que ce
 * soit sur le serveur : l'interface déjà compilée, le serveur déjà compilé, ses dépendances
 * (toutes en JavaScript pur, donc utilisables telles quelles sous Windows) et les scripts
 * d'installation. Sur place, il ne reste qu'à double-cliquer.
 *
 *   node tools/creer-paquet.mjs [dossier-de-sortie]
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const racineServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const racineWeb = resolve(racineServeur, '../netschema')
const sortie = resolve(process.argv[2] ?? join(racineServeur, 'paquet'))
const version = JSON.parse(readFileSync(join(racineServeur, 'package.json'), 'utf8')).version
const nom = `NetSchema-${version}-windows`
const etape = join(sortie, nom)

function lancer(commande, args, cwd) {
  console.log(`  ${commande} ${args.join(' ')}`)
  execFileSync(commande, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

console.log('→ Compilation de l’interface web')
lancer('npm', ['run', 'build'], racineWeb)

console.log('→ Compilation du serveur')
lancer('npm', ['run', 'build'], racineServeur)

console.log('→ Assemblage')
rmSync(etape, { recursive: true, force: true })
mkdirSync(join(etape, 'serveur'), { recursive: true })

cpSync(join(racineWeb, 'dist'), join(etape, 'web'), { recursive: true })
cpSync(join(racineServeur, 'dist'), join(etape, 'serveur/dist'), { recursive: true })
cpSync(join(racineServeur, 'tools'), join(etape, 'serveur/tools'), { recursive: true })
for (const fichier of ['package.json', 'package-lock.json']) {
  cpSync(join(racineServeur, fichier), join(etape, 'serveur', fichier))
}
// Le script de fabrication n'a rien à faire dans le paquet livré.
rmSync(join(etape, 'serveur/tools/creer-paquet.mjs'), { force: true })

console.log('→ Dépendances de production')
lancer('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], join(etape, 'serveur'))

console.log('→ Scripts d’installation')
const deploiement = join(racineServeur, 'deploy/windows')
for (const fichier of [
  '1-Installer.cmd',
  '2-Activer-HTTPS.cmd',
  '3-Diagnostic.cmd',
  'Installer-NetSchema.ps1',
  'Configurer-HTTPS.ps1',
  'Start-NetSchema.ps1',
  'web.config',
  'netschema.env.example',
]) {
  cpSync(join(deploiement, fichier), join(etape, fichier))
}
cpSync(join(racineServeur, 'INSTALLATION-RAPIDE.md'), join(etape, 'LISEZ-MOI.md'))
cpSync(join(racineServeur, 'DEPLOIEMENT-WINDOWS.md'), join(etape, 'DEPLOIEMENT-WINDOWS.md'))

writeFileSync(
  join(etape, 'VERSION.txt'),
  [`NetSchema ${version}`, `Paquet fabriqué le ${new Date().toISOString()}`, '', 'Installation : double-cliquez sur 1-Installer.cmd', ''].join('\r\n'),
)

console.log('→ Archive')
const archive = `${etape}.zip`
rmSync(archive, { force: true })
if (process.platform === 'win32') {
  lancer('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${etape}' -DestinationPath '${archive}'`], sortie)
} else {
  lancer('zip', ['-qr', `${nom}.zip`, nom], sortie)
}
if (!existsSync(archive)) throw new Error('Archive non produite.')

console.log('')
console.log(`Paquet prêt : ${archive}`)
