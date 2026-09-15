/**
 * Nettoyage d'une phrase dictée avant interprétation.
 *
 * La reconnaissance vocale rend les nombres en toutes lettres (« dix point dix point zéro
 * point onze »), sépare les sigles (« s w core zéro un ») et ponctue à sa façon. Ces
 * transformations rapprochent le texte entendu de ce qu'on aurait tapé.
 */

const UNITS: Record<string, number> = {
  zero: 0,
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  vingt: 20,
  vingts: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
  cent: 100,
  cents: 100,
}

function normalizeWord(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** « dix-sept », « quatre-vingt-douze » : des composés que la dictée écrit avec des tirets. */
function expandCompounds(text: string): string {
  const pattern =
    /\b(dix|vingt|trente|quarante|cinquante|soixante|quatre|cent|cents)-(vingts?|et|sept|huit|neuf|un|une|deux|trois|quatre|cinq|six|dix|onze|douze|treize|quatorze|quinze|seize)\b/gi
  // Une passe ne suffit pas sur « quatre-vingt-douze » : on répète jusqu'à stabilité.
  let previous = text
  for (let pass = 0; pass < 4; pass += 1) {
    const next = previous.replace(pattern, '$1 $2')
    if (next === previous) break
    previous = next
  }
  return previous
}

/** Mots après lesquels « un » est un nombre et non un article : « VLAN un », « en U un ». */
const NUMBER_CONTEXT = new Set(['vlan', 'u', 'numero', 'port', 'niveau', 'couche', 'baie', 'unite'])

/**
 * Convertit une suite de mots-nombres en valeur. Renvoie la valeur et le nombre de mots
 * consommés, ou `null` si le premier mot n'est pas un nombre.
 */
function readNumber(
  words: string[],
  start: number,
  options: { allowLeadingOne?: boolean } = {},
): { value: string; length: number } | null {
  const first = words[start]
  if (first === undefined) return null
  if ((first === 'un' || first === 'une') && !options.allowLeadingOne) return null

  // « zéro un » se dit pour « 01 » : on garde le zéro de tête plutôt que d'additionner.
  if (first === 'zero') {
    const next = UNITS[words[start + 1]]
    if (next !== undefined && next < 10) return { value: `0${next}`, length: 2 }
    return { value: '0', length: 1 }
  }

  let index = start
  let total = 0
  let current = 0
  let consumed = 0

  while (index < words.length) {
    const word = words[index]
    if (word === 'et') {
      if (index + 1 < words.length && UNITS[words[index + 1]] !== undefined) {
        index += 1
        consumed += 1
        continue
      }
      break
    }
    const value = UNITS[word]
    if (value === undefined) break
    if (word === 'zero') break

    if (value === 100) {
      // « cent quatre-vingt-douze » : la centaine est close, le reste repart à zéro.
      total += (current === 0 ? 1 : current) * 100
      current = 0
    } else if (value >= 20) {
      if (current > 0 && current < 10) current = current * value
      else current += value
    } else {
      current += value
    }
    index += 1
    consumed += 1
  }

  if (consumed === 0) return null
  return { value: String(total + current), length: consumed }
}

/**
 * Prépare une phrase dictée : nombres en chiffres, séparateurs parlés en symboles, sigles
 * épelés recollés.
 *
 * La transformation porte sur le texte d'origine (casse comprise) : c'est lui que les
 * règles d'interprétation relisent ensuite pour restituer les valeurs telles que dictées.
 */
export function prepareSpeech(raw: string): string {
  const rawWords = expandCompounds(raw).split(/\s+/).filter(Boolean)
  const words = rawWords.map(normalizeWord)
  const out: string[] = []
  let index = 0
  /** Vrai juste après un séparateur posé : dans « 192.168.1.1 », « un » est un nombre. */
  let afterSeparator = false

  while (index < words.length) {
    const previousWord = index > 0 ? words[index - 1] : ''
    const allowLeadingOne =
      afterSeparator ||
      NUMBER_CONTEXT.has(previousWord) ||
      // « baie A un » : la lettre d'un nom de baie ne coupe pas le contexte.
      (/^[a-z]$/.test(previousWord) && index > 1 && NUMBER_CONTEXT.has(words[index - 2]))
    const parsed = readNumber(words, index, { allowLeadingOne })
    if (parsed) {
      out.push(parsed.value)
      index += parsed.length
      afterSeparator = false
      continue
    }

    const word = words[index]
    const previousIsNumber = /\d$/.test(out[out.length - 1] ?? '')
    // Après un séparateur, « un » compte aussi comme un nombre : « point un point un ».
    const nextIsNumber =
      words[index + 1] !== undefined &&
      readNumber(words, index + 1, { allowLeadingOne: previousIsNumber }) !== null

    // « point » ne devient un séparateur qu'entre deux nombres : « point de passage » reste
    // une expression.
    if ((word === 'point' || word === 'virgule') && previousIsNumber && nextIsNumber) {
      out.push('.')
      index += 1
      afterSeparator = true
      continue
    }
    if ((word === 'slash' || word === 'barre') && nextIsNumber) {
      out.push('/')
      index += 1
      afterSeparator = true
      continue
    }
    if (word === 'tiret' && previousIsNumber && nextIsNumber) {
      out.push('-')
      index += 1
      afterSeparator = true
      continue
    }

    out.push(rawWords[index])
    index += 1
    afterSeparator = false
  }

  const joined = out
    .join(' ')
    .replace(/\s*([./])\s*/g, '$1')
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
    .replace(/\s+/g, ' ')
    .trim()

  return joinRackLabels(joinSpelledLetters(joined))
}

/**
 * Recolle la lettre et le numéro d'un repère de baie : « baie A 1 » devient « baie A1 ».
 * Limité à ce contexte, pour ne pas souder « hauteur U 2 » ni « VLAN 10 ».
 */
function joinRackLabels(text: string): string {
  return text.replace(/\b(baies?|rack|salle)\s+([a-zA-Z])\s+(\d{1,3})\b/gi, '$1 $2$3')
}

/**
 * Recolle les sigles épelés : « s w core » devient « sw core ». La dictée sépare volontiers
 * les lettres d'un nom d'équipement.
 */
export function joinSpelledLetters(text: string): string {
  return text.replace(/\b([a-zA-Z])(\s+[a-zA-Z]\b)+/g, (match) => match.replace(/\s+/g, ''))
}

// ─── Comparaison approximative de noms ───────────────────────────────────────

/** Distance de Levenshtein, bornée pour rester rapide sur des listes longues. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

/** Forme comparable d'un nom : sans accents, sans séparateurs, en minuscules. */
export function compactName(value: string): string {
  return value
    .replace(/[œŒ]/g, 'oe')
    .replace(/[æÆ]/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export interface FuzzyMatch<T> {
  item: T
  score: number
}

/**
 * Meilleure correspondance approximative dans une liste.
 *
 * Une dictée rend rarement « SW-CORE-01 » à la lettre : on accepte « sw core 01 »,
 * « swcore 1 », voire une syllabe de travers, tant que la ressemblance reste forte.
 */
export function bestMatch<T>(query: string, items: T[], toName: (item: T) => string): FuzzyMatch<T> | null {
  const needle = compactName(query)
  if (!needle) return null

  let best: FuzzyMatch<T> | null = null
  for (const item of items) {
    const candidate = compactName(toName(item))
    if (!candidate) continue

    // Le raccourci « préfixe » ou « inclusion » ne joue que dans un sens : quand la phrase
    // cherchée est plus courte que le candidat (« core 01 » pour « SW-CORE-01 »), et que les
    // deux restent de taille comparable. Une phrase plus longue que le candidat contient au
    // contraire un morceau qui ne lui appartient pas — « serveur srv » n'est pas le type
    // « serveur » : on la juge alors à la distance, qui pénalise ce surplus.
    const longest = Math.max(needle.length, candidate.length)
    const overlap = needle.length / candidate.length

    let score = 0
    if (candidate === needle) score = 1
    else if (overlap >= 0.8 && overlap <= 1 && candidate.startsWith(needle)) score = 0.92
    else if (overlap >= 0.8 && overlap <= 1 && candidate.includes(needle)) score = 0.85
    else score = 1 - editDistance(needle, candidate) / longest

    if (!best || score > best.score) best = { item, score }
  }

  return best && best.score >= 0.68 ? best : null
}
