import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { after, describe, it } from 'node:test'

/**
 * Historique des schémas et rotation du journal.
 *
 * Le verrou optimiste empêche deux personnes de s'écraser sans le savoir ; il ne protège
 * de rien quand on s'écrase soi-même. Ces tests vérifient qu'une version remplacée reste
 * récupérable, et qu'un journal qui grossit finit par tourner au lieu de remplir le disque.
 */

const { DiagramStore } = await import('../../dist/store/diagrams.js')
const { AuditLog } = await import('../../dist/store/audit.js')
const { rotateIfLarge } = await import('../../dist/store/files.js')

const dossiers = []
function jetable() {
  const dir = mkdtempSync(resolve(tmpdir(), 'netschema-histo-'))
  dossiers.push(dir)
  return dir
}
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }) })

const schema = (n) => ({ title: `v${n}`, nodes: [{ id: `n${n}`, kind: 'switch', name: `SW-${n}` }], links: [] })

describe('historique des schémas', () => {
  it('garde la version remplacée et sait la relire', () => {
    const magasin = new DiagramStore(jetable())
    const { record } = magasin.create('Cœur de réseau', schema(1), 'chef')

    assert.deepEqual(magasin.historique(record.id), [], 'rien à l’historique avant la première modification')

    magasin.update(record.id, schema(2), 'chef', undefined)
    const versions = magasin.historique(record.id)
    assert.equal(versions.length, 1)
    assert.equal(versions[0].by, 'chef')

    const ancienne = magasin.versionAnterieure(record.id, versions[0].at)
    assert.equal(ancienne.diagram.title, 'v1', 'c’est bien le contenu d’avant qui est gardé')
    assert.equal(magasin.get(record.id).record.diagram.title, 'v2', 'et le courant est bien le nouveau')
  })

  it('élague au-delà de vingt versions', () => {
    const magasin = new DiagramStore(jetable())
    const { record } = magasin.create('Charge', schema(0), 'chef')
    for (let i = 1; i <= 25; i += 1) {
      // L'horodatage sert de nom de fichier : deux écritures dans la même milliseconde
      // n'en feraient qu'une. On décale donc explicitement.
      const avant = Date.now()
      while (Date.now() === avant) { /* attente d'une milliseconde */ }
      magasin.update(record.id, schema(i), 'chef', undefined)
    }
    const versions = magasin.historique(record.id)
    assert.equal(versions.length, 20, `20 versions attendues, ${versions.length} trouvées`)
    assert.ok(versions[0].at > versions[19].at, 'la plus récente en tête')
  })

  it('refuse un horodatage forgé', () => {
    const magasin = new DiagramStore(jetable())
    const { record } = magasin.create('Cible', schema(1), 'chef')
    magasin.update(record.id, schema(2), 'chef', undefined)
    for (const forge of ['../../users', '..%2f..%2fusers', 'tout', '2026-01-01', '']) {
      assert.equal(magasin.versionAnterieure(record.id, forge), null, `« ${forge} » doit être refusé`)
    }
  })

  it('copie une dernière fois avant la suppression', () => {
    const magasin = new DiagramStore(jetable())
    const { record } = magasin.create('À supprimer', schema(7), 'chef')
    assert.equal(magasin.remove(record.id), true)
    const versions = magasin.historique(record.id)
    assert.equal(versions.length, 1, 'la suppression laisse une copie')
    assert.equal(magasin.versionAnterieure(record.id, versions[0].at).diagram.title, 'v7')
    magasin.removeHistory(record.id)
    assert.deepEqual(magasin.historique(record.id), [])
  })
})

describe('rotation du journal', () => {
  it('ne fait rien tant que le fichier est petit', () => {
    const dir = jetable()
    const fichier = resolve(dir, 'audit.log')
    writeFileSync(fichier, 'une ligne\n')
    assert.equal(rotateIfLarge(fichier, 1024, 3), false)
    assert.equal(existsSync(`${fichier}.1`), false)
  })

  it('décale les générations et jette la plus ancienne', () => {
    const dir = jetable()
    const fichier = resolve(dir, 'audit.log')
    for (let tour = 1; tour <= 5; tour += 1) {
      writeFileSync(fichier, `tour ${tour}\n`.repeat(200))
      assert.equal(rotateIfLarge(fichier, 100, 3), true, `tour ${tour}`)
    }
    assert.equal(existsSync(fichier), false, 'le courant a été déplacé')
    assert.match(readFileSync(`${fichier}.1`, 'utf8'), /tour 5/, 'le plus récent en .1')
    assert.match(readFileSync(`${fichier}.3`, 'utf8'), /tour 3/)
    assert.equal(existsSync(`${fichier}.4`), false, 'au-delà de trois générations, on jette')
  })

  it('fait tourner le journal d’audit en service', () => {
    const dir = jetable()
    const journal = new AuditLog(dir)
    const fichier = resolve(dir, 'audit.log')
    // 5 Mo de seuil : on écrit de quoi le dépasser, avec des détails volumineux.
    const bourrage = 'x'.repeat(4000)
    for (let i = 0; i < 1400; i += 1) journal.write('login', { username: `agent${i}`, note: bourrage })
    assert.ok(existsSync(`${fichier}.1`), 'une génération a été créée')
    assert.ok(statSync(fichier).size < 6 * 1024 * 1024, 'le courant est reparti petit')
  })
})
