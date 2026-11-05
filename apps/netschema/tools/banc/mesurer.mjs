/**
 * Banc d'essai : combien d'équipements une page supporte-t-elle ?
 *
 * Il mesure sur le vrai build de production — un serveur de développement est deux fois
 * plus lent et donnerait des chiffres pessimistes dont on tirerait de mauvaises décisions.
 *
 *   npm run build && npx vite preview --port 4173
 *   node tools/banc/generer-schema.mjs 800
 *   node tools/banc/mesurer.mjs http://127.0.0.1:4173/
 *
 * Chaque mesure est la médiane de cinq prises : une seule est trop bruitée pour conclure.
 */
import pw from '/opt/node22/lib/node_modules/playwright/index.js'
import { readFileSync } from 'node:fs'
const { chromium } = pw
const DIR = process.env.BANC_DIR ?? new URL('.', import.meta.url).pathname
const TAILLES = [29, 300, 800, 2000]
const ADRESSE = process.argv[2] ?? 'http://127.0.0.1:4173/'
const b = await chromium.launch()

/** Médiane de n mesures : une seule prise est trop bruitée pour conclure. */
const med = (xs) => { const s = [...xs].sort((a, z) => a - z); return s[Math.floor(s.length / 2)] }

console.log('taille  chargement  rendu    recherche  filtre VLAN  placement auto  export PNG  export SVG  mémoire')
for (const taille of TAILLES) {
  const p = await b.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 })
  const erreurs = []
  p.on('pageerror', (e) => erreurs.push(e.message))
  await p.goto(ADRESSE)
  await p.waitForTimeout(800)

  if (taille === 29) {
    for (const t of ['Fichier', 'Exemple']) { const e = p.locator(`button:has-text("${t}")`).first(); if (await e.count()) { await e.click(); await p.waitForTimeout(300) } }
  } else {
    const json = readFileSync(`${DIR}/charge-${taille}.json`, 'utf8')
    await p.evaluate((j) => localStorage.setItem('netschema:diagram:v1', JSON.stringify(JSON.parse(j).diagram)), json)
  }
  const t0 = Date.now()
  await p.reload()
  await p.waitForSelector('[data-noeud]', { timeout: 60000 })
  await p.waitForTimeout(1500)
  const chargement = Date.now() - t0

  const noeuds = await p.locator('[data-noeud]').count()
  if (noeuds < 5) { console.log(`${taille} : chargement raté (${noeuds} nœuds)`); await p.close(); continue }

  // Rendu : forcer un recalcul complet en basculant un affichage.
  const rendu = []
  for (let i = 0; i < 5; i++) {
    const bt = p.locator('button:has-text("Étiquettes")').first()
    if (!(await bt.count())) break
    const t = Date.now(); await bt.click(); await p.waitForTimeout(0)
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    rendu.push(Date.now() - t)
  }

  // Recherche dans l'inventaire.
  await p.locator('button:has-text("Inventaire")').first().click()
  await p.waitForTimeout(800)
  const champ = p.locator('input[placeholder*="echerch"]').first()
  const recherche = []
  for (const terme of ['sw', 'acc', 'srv', 'commutateur', 'sw-dist']) {
    const t = Date.now(); await champ.fill(terme)
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    await p.waitForTimeout(60)
    recherche.push(Date.now() - t)
  }
  await champ.fill('')
  await p.locator('button:has-text("Schéma")').first().click()
  await p.waitForTimeout(800)

  // Filtre VLAN (recalcule tout le dessin).
  const filtre = []
  const select = p.locator('select').first()
  if (await select.count()) {
    for (const v of ['10', '20', '']) {
      const t = Date.now()
      try { await select.selectOption({ index: v ? Number(v) / 10 : 0 }) } catch { break }
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      filtre.push(Date.now() - t)
    }
  }

  // Placement automatique.
  let placement = null
  const btPlacement = p.locator('button:has-text("Placement auto")').first()
  if (await btPlacement.count()) {
    const t = Date.now(); await btPlacement.click(); await p.waitForTimeout(100)
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    placement = Date.now() - t
  }

  // Exports : on mesure la sérialisation, pas l'écriture disque.
  const exports = await p.evaluate(async () => {
    const svg = document.querySelector('[data-export-root]') || document.querySelector('svg')
    if (!svg) return { svg: null, png: null }
    const t1 = performance.now()
    const texte = new XMLSerializer().serializeToString(svg)
    const dureeSvg = performance.now() - t1
    const t2 = performance.now()
    const blob = new Blob([texte], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    await new Promise((resolve) => { const img = new Image(); img.onload = img.onerror = resolve; img.src = url })
    URL.revokeObjectURL(url)
    return { svg: Math.round(dureeSvg), png: Math.round(performance.now() - t2), octets: texte.length }
  })

  const memoire = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null)

  console.log(
    `${String(taille).padStart(5)}   ${String(chargement).padStart(6)} ms  ` +
    `${String(rendu.length ? med(rendu) : '—').padStart(5)} ms  ` +
    `${String(recherche.length ? med(recherche) : '—').padStart(7)} ms  ` +
    `${String(filtre.length ? med(filtre) : '—').padStart(8)} ms  ` +
    `${String(placement ?? '—').padStart(11)} ms  ` +
    `${String(exports.png ?? '—').padStart(7)} ms  ` +
    `${String(exports.svg ?? '—').padStart(7)} ms  ` +
    `${memoire ?? '—'} Mo   (svg ${exports.octets ? Math.round(exports.octets / 1024) + ' Ko' : '—'}, ${noeuds} nœuds dessinés${erreurs.length ? ', ' + erreurs.length + ' ERREURS' : ''})`
  )
  if (erreurs.length) console.log('        ', erreurs[0].slice(0, 120))
  await p.close()
}
await b.close()
