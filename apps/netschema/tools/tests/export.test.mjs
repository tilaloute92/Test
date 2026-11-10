import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Export en page HTML : on choisit les pages, les vues et les tableaux.
 *
 * Deux choses se vérifient sans navigateur : le choix lui-même — ce qui est proposé, ce qui
 * est retenu, ce qui est refusé — et la page produite, qui ne doit contenir que ce qu'on lui
 * a donné. La capture des schémas, elle, a besoin d'un écran : elle est rejouée à part.
 */

const { vuesExportables, choixParDefaut, choixValide, choixNormalise, resumeChoix, TABLEAUX_EXPORT } = await import(
  '../../src/lib/exportChoix.ts'
)
const { pageInteractive } = await import('../../src/lib/exportHtml.ts')
const { interpret, VOICE_EXAMPLES } = await import('../../src/lib/voice.ts')

describe('les vues qu’on peut demander', () => {
  it('les trois modes, et les trois lectures logiques une à une', () => {
    assert.deepEqual(
      vuesExportables().map((vue) => vue.id),
      ['architecture', 'technique', 'logique-routage', 'logique-rails', 'logique-domaines', 'presentation'],
    )
  })

  it('chacune dit ce qu’elle montre', () => {
    for (const vue of vuesExportables()) {
      assert.ok(vue.label.length > 3, vue.id)
      assert.ok(vue.hint.length > 20, `${vue.id} : une explication`)
    }
    assert.match(vuesExportables().find((vue) => vue.id === 'logique-rails').label, /Plan VLAN/)
  })

  it('une lecture logique sait de quel mode elle relève', () => {
    const rails = vuesExportables().find((vue) => vue.id === 'logique-rails')
    assert.deepEqual([rails.mode, rails.logique], ['logique', 'rails'])
    assert.equal(vuesExportables().find((vue) => vue.id === 'technique').logique, undefined)
  })
})

describe('le choix proposé', () => {
  it('par défaut : toutes les pages, et ce que l’export sortait jusqu’ici', () => {
    const choix = choixParDefaut(3, 'rails')
    assert.deepEqual(choix.pages, [0, 1, 2])
    assert.deepEqual(choix.vues, ['architecture', 'technique', 'logique-rails', 'presentation'])
    assert.deepEqual(choix.tableaux, ['equipements', 'liaisons', 'flux'])
  })

  it('la lecture logique proposée est celle qui est affichée', () => {
    assert.ok(choixParDefaut(1, 'domaines').vues.includes('logique-domaines'))
    assert.ok(!choixParDefaut(1, 'domaines').vues.includes('logique-rails'))
  })

  it('reprend les vues et les tableaux du dernier export, pas ses pages', () => {
    const choix = choixParDefaut(4, 'routage', { vues: ['technique', 'logique-rails'], tableaux: ['equipements'] })
    assert.deepEqual(choix.vues, ['technique', 'logique-rails'])
    assert.deepEqual(choix.tableaux, ['equipements'])
    assert.deepEqual(choix.pages, [0, 1, 2, 3])
  })

  it('« aucun tableau », mémorisé, reste aucun tableau', () => {
    assert.deepEqual(choixParDefaut(1, 'routage', { vues: ['technique'], tableaux: [] }).tableaux, [])
  })

  it('une mémoire abîmée ou d’une autre version ne casse rien', () => {
    for (const memoire of [null, {}, { vues: 'tout' }, { vues: ['vue-disparue'] }, { vues: [1, 2], tableaux: 'x' }]) {
      const choix = choixParDefaut(2, 'routage', memoire)
      assert.ok(choixValide(choix), JSON.stringify(memoire))
      assert.deepEqual(choix.vues, ['architecture', 'technique', 'logique-routage', 'presentation'])
    }
  })

  it('il faut au moins une page et une vue', () => {
    assert.equal(choixValide({ pages: [], vues: ['technique'], tableaux: [] }), false)
    assert.equal(choixValide({ pages: [0], vues: [], tableaux: ['equipements'] }), false)
    assert.equal(choixValide({ pages: [0], vues: ['technique'], tableaux: [] }), true)
  })

  it('se remet dans l’ordre du document, sans doublon ni inconnu', () => {
    const propre = choixNormalise({ pages: [2, 0, 2, 9, -1], vues: ['presentation', 'inconnue', 'architecture'], tableaux: ['flux', 'equipements'] }, 3)
    assert.deepEqual(propre, { pages: [0, 2], vues: ['architecture', 'presentation'], tableaux: ['equipements', 'flux'] })
  })

  it('dit ce que contiendra le fichier', () => {
    assert.equal(resumeChoix({ pages: [0, 1], vues: ['technique', 'presentation', 'architecture'], tableaux: ['equipements', 'liaisons'] }), '2 pages × 3 vues = 6 schémas, 2 tableaux')
    assert.equal(resumeChoix({ pages: [0], vues: ['technique'], tableaux: [] }), '1 page, 1 vue, aucun tableau')
    assert.equal(resumeChoix({ pages: [0, 1, 2], vues: ['technique'], tableaux: ['flux'] }), '3 pages, 1 vue, 1 tableau')
  })

  it('les trois tableaux sont proposés', () => {
    assert.deepEqual(TABLEAUX_EXPORT.map((t) => t.id), ['equipements', 'liaisons', 'flux'])
  })
})

describe('la page produite', () => {
  const svg = (texte) => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text>${texte}</text></svg>`
  const noeud = (id, name) => ({ id, kind: 'server', name, x: 0, y: 0, serial: `SN-${name}` })
  const page = (nom, vues, extra = {}) => ({
    nom,
    diagram: {
      title: 'Parc',
      pageName: nom,
      nodes: [noeud(`${nom}-a`, `${nom}-A`), noeud(`${nom}-b`, `${nom}-B`)],
      links: [{ id: `${nom}-l`, from: `${nom}-a`, to: `${nom}-b`, kind: 'ethernet', speed: '1 Gb/s' }],
      ...extra,
    },
    vues: vues.map((id) => ({ id, label: `Vue ${id}`, hint: `Aide ${id}`, svg: svg(`${nom}/${id}`) })),
  })
  const compter = (html, motif) => (html.match(motif) ?? []).length

  it('ne contient que les pages et les vues qu’on lui donne', () => {
    const html = pageInteractive('Parc', [page('Siège', ['technique', 'logique-rails']), page('Lyon', ['technique', 'logique-rails'])])
    assert.equal(compter(html, /<div class="vue" /g), 4, 'deux pages × deux vues')
    for (const id of ['vue-0-technique', 'vue-0-logique-rails', 'vue-1-technique', 'vue-1-logique-rails']) {
      assert.ok(html.includes(`id="${id}"`), id)
    }
    assert.ok(!html.includes('vue-0-architecture'))
    assert.ok(html.includes('Siège/logique-rails') && html.includes('Lyon/technique'), 'chaque schéma à sa place')
  })

  it('un onglet par page exportée, un par vue', () => {
    const html = pageInteractive('Parc', [page('Siège', ['technique', 'presentation']), page('Lyon', ['technique', 'presentation'])])
    assert.equal(compter(html, /class="onglet page"/g), 2)
    assert.ok(html.includes('id="onglet-technique"') && html.includes('id="onglet-presentation"'))
    assert.ok(!html.includes('id="onglet-architecture"'))
  })

  it('une seule page : pas d’onglets de page ; une seule vue : pas d’onglets de vue', () => {
    const html = pageInteractive('Parc', [page('Siège', ['technique'])])
    assert.equal(compter(html, /class="onglet page"/g), 0)
    assert.ok(!html.includes('id="onglet-technique"'))
    assert.equal(compter(html, /<div class="vue" /g), 1)
  })

  it('les tableaux se choisissent', () => {
    const pages = [page('Siège', ['technique'], { flows: [{ id: 'f1', from: 'A', to: 'B', service: 'HTTPS', action: 'autorise' }] })]
    const tout = pageInteractive('Parc', pages)
    for (const id of ['page-equipements', 'page-liaisons', 'page-flux']) assert.ok(tout.includes(`id="${id}"`), id)

    const equipementsSeuls = pageInteractive('Parc', pages, { tableaux: ['equipements'] })
    assert.ok(equipementsSeuls.includes('id="page-equipements"') && equipementsSeuls.includes('id="page-onglet-equipements"'))
    for (const id of ['page-liaisons', 'page-onglet-liaisons', 'page-flux', 'page-onglet-flux']) {
      assert.ok(!equipementsSeuls.includes(`id="${id}"`), `${id} absent`)
    }

    const aucun = pageInteractive('Parc', pages, { tableaux: [] })
    assert.ok(!aucun.includes('id="page-equipements"') && !aucun.includes('id="page-liaisons"') && !aucun.includes('id="page-flux"'))
    assert.ok(aucun.includes('id="page-onglet-plan"'), 'le schéma reste')
  })

  it('sans tableaux, la fiche d’un équipement garde ses informations', () => {
    const html = pageInteractive('Parc', [page('Siège', ['technique'])], { tableaux: [] })
    const donnees = JSON.parse(html.match(/<script type="application\/json" id="donnees">(.*?)<\/script>/s)[1])
    assert.equal(donnees.equipements.length, 2)
    assert.equal(donnees.equipements[0].serie, 'SN-Siège-A')
    assert.equal(donnees.liaisons.length, 1)
  })

  it('les tableaux ne parlent que des pages exportées', () => {
    const html = pageInteractive('Parc', [page('Lyon', ['technique'])], { pagesDuDocument: 3 })
    assert.ok(html.includes('Lyon-A') && !html.includes('Siège-A'))
    assert.match(html, /1 page\(s\) sur les 3 du document/)
  })

  it('le pied ne prétend pas tout contenir quand ce n’est pas le cas', () => {
    const partiel = pageInteractive('Parc', [page('Lyon', ['technique'])], { pagesDuDocument: 2 })
    assert.ok(!/Toutes les pages/.test(partiel))
    const complet = pageInteractive('Parc', [page('Lyon', ['technique', 'presentation'])], { pagesDuDocument: 1 })
    assert.match(complet, /Toutes les pages du document y figurent, en 2 vue\(s\)/)
  })

  it('un nom de page, un titre ou un nom d’équipement hostile ne casse pas la page', () => {
    // Le SVG vient du navigateur, déjà échappé : ici on ne juge que ce que la coquille écrit.
    const hostile = 'Lyon"><img src=x onerror=alert(1)>'
    const pages = [page('Lyon', ['technique']), page('Siège', ['technique'])]
    pages[0].nom = hostile
    pages[0].diagram.nodes[0].name = '</script><script>alert(2)</script>'
    const html = pageInteractive('Parc </script><script>alert(1)</script>', pages)
    assert.ok(!html.includes('<script>alert(1)</script>'), 'le titre')
    assert.ok(!html.includes('<script>alert(2)</script>'), 'le nom d’équipement, dans le tableau comme dans les données')
    assert.ok(!html.includes('<img src=x'), 'le nom de page, dans l’onglet comme dans le tableau')
    assert.equal(compter(html, /<script/g), 2, 'deux balises script : les données et le code, rien d’autre')
    // Et ce qui a été neutralisé se relit tel quel : rien n'est perdu.
    const donnees = JSON.parse(html.match(/<script type="application\/json" id="donnees">(.*?)<\/script>/s)[1])
    assert.equal(donnees.pages[0].nom, hostile)
    assert.equal(donnees.equipements[0].nom, '</script><script>alert(2)</script>')
  })
})

describe('la page produite se lit', () => {
  /** Contraste WCAG entre deux couleurs « #rrggbb ». */
  const luminance = (hex) => {
    const canaux = [1, 3, 5].map((debut) => parseInt(hex.slice(debut, debut + 2), 16) / 255)
    const [r, g, b] = canaux.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contraste = (a, b) => {
    const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (clair + 0.05) / (sombre + 0.05)
  }

  it('les onglets de l’en-tête sont lisibles sur son fond sombre', () => {
    // « Équipements », « Liaisons », « Flux » s'écrivaient en gris foncé sur bleu nuit : 1,7 pour 1.
    const html = pageInteractive('Parc', [{ nom: 'A', diagram: { title: 'Parc', nodes: [], links: [] }, vues: [{ id: 'technique', label: 'T', hint: 'h', svg: '<svg/>' }] }])
    const fond = html.match(/header\{background:(#[0-9a-f]{6})/)[1]
    const texte = html.match(/header \.onglet\{color:(#[0-9a-f]{6})\}/)[1]
    assert.ok(contraste(texte, fond) >= 4.5, `${texte} sur ${fond} : ${contraste(texte, fond).toFixed(1)} pour 1`)
    const actifFond = html.match(/header \.onglet\.actif[^{]*\{background:(#[0-9a-f]{3,6});color:(#[0-9a-f]{6})\}/)
    assert.ok(contraste(actifFond[2], '#ffffff') >= 4.5, 'l’onglet actif aussi')
  })

  it('et ceux des pages et des vues, sur leur fond clair', () => {
    const html = pageInteractive('Parc', [{ nom: 'A', diagram: { title: 'Parc', nodes: [], links: [] }, vues: [{ id: 'technique', label: 'T', hint: 'h', svg: '<svg/>' }] }])
    const texte = html.match(/\n\.onglet\{[^}]*color:(#[0-9a-f]{6})\}/)[1]
    for (const fond of [html.match(/nav\.onglets\{[^}]*background:(#[0-9a-f]{6})/)[1], html.match(/nav\.onglets\.pages\{background:(#[0-9a-f]{6})/)[1]]) {
      assert.ok(contraste(texte, fond) >= 4.5, `${texte} sur ${fond} : ${contraste(texte, fond).toFixed(1)} pour 1`)
    }
  })
})

describe('à la voix', () => {
  it('« exporte en page HTML » ouvre le choix', () => {
    for (const phrase of ['exporte en page HTML', 'exporte la page HTML', 'exporte en HTML', 'génère la page interactive', 'exporter en page web']) {
      assert.deepEqual(interpret(phrase), { type: 'export', format: 'html' }, phrase)
    }
  })

  it('sans prendre la place des autres exports', () => {
    assert.deepEqual(interpret('exporte en PNG'), { type: 'export', format: 'png' })
    assert.deepEqual(interpret('exporte en SVG'), { type: 'export', format: 'svg' })
    assert.deepEqual(interpret('exporte une image'), { type: 'export', format: 'png' })
  })

  it('l’exemple figure dans l’aide', () => {
    assert.ok(VOICE_EXAMPLES.includes('Exporte en page HTML'))
  })

  it('la commande ouvre le dialogue sans rien exporter', async () => {
    const { useDiagram } = await import('../../src/store/useDiagram.ts')
    const r = useDiagram.getState().runVoiceCommand('exporte en page HTML')
    assert.equal(r.ok, true)
    assert.equal(useDiagram.getState().exportHtmlOuvert, true)
    useDiagram.getState().setExportHtmlOuvert(false)
  })
})
