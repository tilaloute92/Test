import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Ce que le panneau fait de ce que le micro entend, avant toute commande.
 *
 * Deux choses se jouent ici, sans micro ni navigateur : ne pas prendre la voix de
 * l'application pour celle de l'utilisateur, et choisir, parmi les transcriptions que la
 * reconnaissance propose, celle qui veut dire quelque chose.
 */

const { debutDeParole, finDeParole, estEcho, versionParlee, choisirTranscription, commandesDe, phrasesPossibles } = await import(
  '../../src/lib/voice.ts'
)

const await_interpret = await import('../../src/lib/voice.ts')

describe('l’application ne s’écoute pas parler', () => {
  it('ignore le micro pendant sa réponse', () => {
    const jeton = debutDeParole('Annulé.', 1_000)
    // « Annulé. » s'entend « annule » : sans cela, l'application annulait en boucle.
    assert.equal(estEcho('annule', 1_200), true)
    assert.equal(estEcho('ajoute un serveur', 1_200), true, 'même une vraie commande : elle ne peut pas trier')
    finDeParole(jeton, 1_600)
  })

  it('et un court instant après', () => {
    const jeton = debutDeParole('Annulé.', 10_000)
    finDeParole(jeton, 10_500)
    assert.equal(estEcho('annule', 10_900), true, '400 ms après : la fin de la phrase traîne encore')
    assert.equal(estEcho('ajoute un serveur', 11_400), false, '900 ms après : on écoute de nouveau')
  })

  it('reconnaît sa propre phrase quelques secondes durant', () => {
    const jeton = debutDeParole('Pare-feu FW-02 ajouté.', 20_000)
    finDeParole(jeton, 21_000)
    assert.equal(estEcho('pare-feu FW-02 ajouté', 23_000), true)
    assert.equal(estEcho('relie-le à SW-CORE-01', 23_000), false, 'une autre phrase passe')
    assert.equal(estEcho('pare-feu FW-02 ajouté', 30_000), false, 'bien plus tard, c’est l’utilisateur qui la dit')
  })

  it('ne reste pas sourde si le navigateur ne signale jamais la fin', () => {
    debutDeParole('Annulé.', 40_000)
    assert.equal(estEcho('ajoute un serveur', 41_000), true)
    assert.equal(estEcho('ajoute un serveur', 40_000 + 20_000), false, 'au-delà du plafond, l’écoute reprend')
  })

  it('une réponse remplacée par une autre ne libère pas le micro trop tôt', () => {
    const premier = debutDeParole('Première réponse.', 60_000)
    debutDeParole('Seconde réponse.', 60_300)
    // La fin de la première, annulée, arrive après le début de la seconde.
    finDeParole(premier, 60_350)
    assert.equal(estEcho('ajoute un serveur', 60_400), true)
  })
})

describe('ce qui se dit n’est pas ce qui s’écrit', () => {
  it('lit les pluriels, pas les parenthèses', () => {
    assert.equal(versionParlee('3 équipement(s) supprimé(s).'), '3 équipements supprimés.')
  })

  it('dit « une liaison » au singulier', () => {
    assert.equal(versionParlee('1 liaison(s) posée(s) entre eux.'), '1 liaison posée entre eux.')
    assert.equal(versionParlee('11 liaison(s) posée(s).'), '11 liaisons posées.')
    assert.equal(versionParlee('2 équipement(s) ajouté(s) : A, B. 1 liaison(s) posée(s).'), '2 équipements ajoutés : A, B. 1 liaison posée.')
  })

  it('ne récite pas une longue énumération', () => {
    const dit = versionParlee(
      'Campus trois niveaux : 14 équipement(s) posé(s) : Opérateur-01, Opérateur-02, RTR-01, RTR-02, FW-01. 27 liaison(s) posée(s) entre eux.',
    )
    assert.doesNotMatch(dit, /RTR-01/)
    assert.match(dit, /14 équipements posés/)
    assert.match(dit, /27 liaisons posées/)
  })

  it('garde une énumération courte', () => {
    assert.match(versionParlee('2 équipement(s) ajouté(s) : SW-ACC-03, SW-ACC-04.'), /SW-ACC-03, SW-ACC-04/)
  })

  it('dit les flèches', () => {
    assert.equal(versionParlee('2 saut(s) : A → B → C.'), '2 sauts : A vers B vers C.')
  })

  it('reste courte', () => {
    assert.ok(versionParlee(`Début. ${'Une phrase de plus. '.repeat(40)}`).length <= 241)
  })
})

describe('choisir la bonne transcription', () => {
  it('préfère celle qui est comprise', () => {
    assert.equal(
      choisirTranscription(['à joute un serveur', 'ajoute un serveur']),
      'ajoute un serveur',
    )
  })

  it('juge un enchaînement commande par commande', () => {
    // Prise en bloc, la phrase à trois commandes n'était « comprise » que par accident.
    const bonne = 'ajoute un serveur SRV-01, relie-le à SW-ACC-01 puis mets-le dans la zone serveurs'
    const mauvaise = 'ajoute un serveur SRV-01, relis le à SW-ACC-01 puis mais le dans la zone serveurs blabla truc'
    assert.equal(commandesDe(bonne).length, 3)
    assert.equal(choisirTranscription([bonne, mauvaise]), bonne)
  })

  it('à défaut, garde la plus probable', () => {
    assert.equal(choisirTranscription(['bla bla', 'blo blo']), 'bla bla')
    assert.equal(choisirTranscription(['', '  ']), '')
  })

  it('rend à l’ajout simple ce que l’assistant ne sait pas lire', () => {
    // « relié à … » est un complément de l'ajout simple : la phrase se sépare en deux ajouts.
    assert.deepEqual(commandesDe('ajoute un serveur SRV-09 relié à SW-CORE-01 et un pare-feu FW-09'), [
      'ajoute un serveur SRV-09 relié à SW-CORE-01',
      'ajoute un pare-feu FW-09',
    ])
    // Des types et des noms, l'assistant sait faire : la phrase reste entière, il raccordera.
    assert.equal(commandesDe('ajoute un pare-feu FW-09 et un routeur RTR-09').length, 1)
    assert.equal(commandesDe('ajoute un routeur, un pare-feu et deux switchs cœur').length, 1)
  })
})

describe('réunir ce que la reconnaissance a découpé', () => {
  it('une pause dans la parole sépare deux commandes', () => {
    // Collés par un espace, les deux segments donnaient un serveur nommé
    // « SRV-01 ajoute un pare-feu FW-01 ».
    const [phrase] = phrasesPossibles([['ajoute un serveur SRV-01'], ['ajoute un pare-feu FW-01']])
    assert.deepEqual(commandesDe(phrase), ['ajoute un serveur SRV-01', 'ajoute un pare-feu FW-01'])
  })

  it('une phrase coupée au milieu reste une phrase', () => {
    const [phrase] = phrasesPossibles([['relie SW-ACC-01'], ['à SW-CORE-01']])
    assert.equal(commandesDe(phrase).length, 1)
    const { interpret } = await_interpret
    assert.deepEqual(
      (({ type, from, to }) => ({ type, from, to }))(interpret(commandesDe(phrase)[0])),
      { type: 'link', from: 'SW-ACC-01', to: 'SW-CORE-01' },
    )
  })

  it('une énumération dite en deux temps reste une énumération', () => {
    const [phrase] = phrasesPossibles([['ajoute deux switchs cœur'], ['quatre switchs d’accès']])
    const { interpret } = await_interpret
    assert.equal(commandesDe(phrase).length, 1)
    assert.equal(interpret(commandesDe(phrase)[0]).type, 'build')
  })

  it('essaie les variantes de chaque segment ensemble, pas une à la fois', () => {
    const candidates = phrasesPossibles([
      ['à joute un serveur SRV-01', 'ajoute un serveur SRV-01'],
      ['relit le haut cœur', 'relie-le à SW-CORE-01'],
    ])
    assert.equal(candidates[0], 'à joute un serveur SRV-01, relit le haut cœur', 'la plus probable d’abord')
    assert.equal(choisirTranscription(candidates), 'ajoute un serveur SRV-01, relie-le à SW-CORE-01')
  })

  it('reste borné', () => {
    const beaucoup = Array.from({ length: 8 }, (_, i) => [`a${i}`, `b${i}`, `c${i}`])
    assert.ok(phrasesPossibles(beaucoup).length <= 48)
    assert.deepEqual(phrasesPossibles([]), [])
    assert.deepEqual(phrasesPossibles([['', '  ']]), [])
  })
})
