import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

/**
 * Lisibilité des couleurs du catalogue et de l'inventaire.
 *
 * L'accent d'une famille ne colore pas seulement un trait : il écrit les petits textes
 * posés sur le fond de la boîte (débit, VLAN, rôle), et les couleurs d'état colorent le
 * libellé lui-même dans le tableau. Ces couples doivent donc tenir le rapport de 4,5:1
 * exigé par WCAG AA pour du texte courant. Sans ce test, une teinte « un peu plus jolie »
 * ramène l'illisibilité sans que personne ne s'en aperçoive avant la salle de réunion.
 */

const canal = (valeur) => {
  const v = valeur / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `couleur « ${hex} » : six chiffres hexadécimaux attendus`)
  const [r, v, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.2126 * canal(r) + 0.7152 * canal(v) + 0.0722 * canal(b)
}

/** Rapport de contraste WCAG entre deux couleurs opaques. */
export function contraste(a, b) {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const SEUIL = 4.5

describe('rapport de contraste', () => {
  it('calcule les repères connus', () => {
    // Noir sur blanc : 21:1. Une couleur sur elle-même : 1:1. De quoi vérifier la formule
    // avant de lui faire juger la palette.
    assert.equal(Math.round(contraste('#000000', '#ffffff')), 21)
    assert.equal(Math.round(contraste('#3b82f6', '#3b82f6')), 1)
    assert.ok(Math.abs(contraste('#64748b', '#ffffff') - 4.76) < 0.02)
  })
})

describe('couleurs des familles d’équipement', () => {
  it('chaque accent reste lisible sur son fond', async () => {
    const { PALETTE } = await import('../../src/lib/palette.ts')
    const echecs = []
    for (const [rang, { accent, fill }] of Object.entries(PALETTE)) {
      const ratio = contraste(accent, fill)
      if (ratio < SEUIL) echecs.push(`famille ${rang} : ${accent} sur ${fill} — ${ratio.toFixed(2)}:1`)
    }
    assert.deepEqual(echecs, [], `couples sous ${SEUIL}:1 :\n  ${echecs.join('\n  ')}`)
  })
})

describe('couleurs d’état de l’inventaire', () => {
  it('chaque état reste lisible sur le fond blanc du tableau', async () => {
    const { STATUS_COLORS } = await import('../../src/lib/palette.ts')
    const echecs = []
    for (const [etat, couleur] of Object.entries(STATUS_COLORS)) {
      const ratio = contraste(couleur, '#ffffff')
      if (ratio < SEUIL) echecs.push(`${etat} : ${couleur} — ${ratio.toFixed(2)}:1`)
    }
    assert.deepEqual(echecs, [], `états sous ${SEUIL}:1 :\n  ${echecs.join('\n  ')}`)
  })
})
