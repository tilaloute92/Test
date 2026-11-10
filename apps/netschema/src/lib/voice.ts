import { findDevice, findDeviceScored, type DeviceMeta } from './catalog'
import { COULEURS_GRAPPE } from './couleurs'
import { prepareSpeech } from './speech'
import {
  cleanName,
  LINK_WORDS,
  normalizeSpeech,
  rawValue,
  type LinkPatch,
  type NodeField,
  type Rule,
  type ToggleKey,
  type VoiceIntent,
} from './voiceBase'
import { nettoyerPhrase, resoudrePronoms } from './voiceGrammar'
import { detecterConstruction, formaterNomEpele, REGLES_PARLEES } from './voiceParle'
import type { AssetStatus, HaRole, LinkShape, OsiView, ViewMode, ZOrder } from '../types'

// Les intentions et les outils partagés vivent dans le socle ; on les réexporte pour que
// rien de ce qui importait `voice` n'ait à changer.
export * from './voiceBase'

/**
 * Commandes vocales.
 *
 * L'interprétation est volontairement séparée de la reconnaissance : `interpret()` est une
 * fonction pure qui transforme une phrase en intention. Elle sert aussi bien à la dictée
 * qu'au champ de saisie du panneau — et c'est ce qui la rend testable sans microphone.
 */
/**
 * Une couleur de grappe désignée par son nom courant.
 *
 * On accepte le libellé de la palette (« rose (défaut) » se dit « rose ») et quelques
 * synonymes d'usage — personne ne dit « ardoise » à voix haute pour désigner un gris.
 */
function couleurParNom(nom: string): { id: string; label: string } | undefined {
  const SYNONYMES: Record<string, string> = {
    gris: 'Ardoise', grise: 'Ardoise', ardoise: 'Ardoise',
    jaune: 'Or', dore: 'Or', or: 'Or',
    marron: 'Moutarde', brun: 'Moutarde',
    mauve: 'Violet', parme: 'Violet', pourpre: 'Pourpre',
    fuchsia: 'Magenta', emeraude: 'Jade', vert: 'Vert', bleu: 'Bleu',
  }
  const cherche = normalizeSpeech(SYNONYMES[normalizeSpeech(nom)] ?? nom)
  return COULEURS_GRAPPE.find((couleur) => {
    const label = normalizeSpeech(couleur.label.replace(/\s*\(defaut\)/i, '').replace(/\s*\(défaut\)/i, ''))
    return label === cherche
  })
}

/** Retire les tournures de politesse et les mots outils en tête de phrase. */
function stripPrefix(value: string): string {
  return value
    .replace(/^(s'?il te plait|s'?il vous plait|peux[- ]tu|pourrais[- ]tu|je veux|je voudrais|merci de|va[ -]y)\s+/i, '')
    .replace(/^bien vouloir\s+/i, '')
    .trim()
}

const LAYER_WORDS: Record<string, OsiView> = {
  '1': 'l1',
  un: 'l1',
  physique: 'l1',
  '2': 'l2',
  deux: 'l2',
  liaison: 'l2',
  '3': 'l3',
  trois: 'l3',
  reseau: 'l3',
}

const ROLE_WORDS: Record<string, HaRole> = {
  actif: 'active',
  maitre: 'active',
  principal: 'active',
  passif: 'passive',
  secours: 'passive',
  'actif actif': 'active-active',
  'actif/actif': 'active-active',
  temoin: 'witness',
  quorum: 'witness',
  autonome: 'standalone',
}

const STATUS_WORDS: Record<string, AssetStatus> = {
  production: 'production',
  service: 'production',
  stock: 'stock',
  maintenance: 'maintenance',
  panne: 'maintenance',
  reparation: 'maintenance',
  retire: 'retire',
  reforme: 'retire',
  sorti: 'retire',
}

const TOGGLE_WORDS: { pattern: RegExp; key: ToggleKey }[] = [
  { pattern: /grille/, key: 'showGrid' },
  { pattern: /zones?/, key: 'showZones' },
  { pattern: /sites?/, key: 'showSites' },
  { pattern: /grappes?|clusters?/, key: 'showClusters' },
  /*
    Trois cases, visées séparément comme dans l'inspecteur.

    Les motifs sont bornés, à la différence des autres : « montre le vlan 20 » demande le
    projecteur, pas l'affichage des VLAN, et cette règle-ci passe avant celle du projecteur.
    Sans les ancres, le numéro était avalé et le projecteur devenait inatteignable à la voix.
  */
  { pattern: /^(ip|adressage|adresses?( ip)?)$/, key: 'showIp' },
  { pattern: /^vlans?$/, key: 'showVlans' },
  { pattern: /^(debits?|vitesses?)$/, key: 'showSpeeds' },
  { pattern: /couches?|libelles/, key: 'showLayerLabels' },
  { pattern: /alertes?|points critiques|defaillances?/, key: 'showAudit' },
  { pattern: /croisements?|ponts?|sauts?/, key: 'showHops' },
  { pattern: /superpositions?|chevauchements?|liaisons? superposees?|ecartement/, key: 'spreadLinks' },
  { pattern: /aimant|magnet|grille magnetique/, key: 'snap' },
  { pattern: /legende/, key: 'showLegend' },
  { pattern: /agregats?|port[- ]?channels?|lacp|faisceaux?|bundles?/, key: 'showLags' },
]

/**
 * Mots-clés qui introduisent un complément dans une phrase de création :
 * « ajoute un switch cœur SW-CORE-03 dans la zone Datacenter avec l'IP 10.10.0.13 ».
 */
const CLAUSE_KEYWORDS =
  "appelee?|appele|nommee?|nomme|de nom|avec l'ip|avec ip|adresse ip|dans la zone|en zone|zone|sur le site|site|dans la grappe|grappe|cluster|en vlan|vlan|dans la baie|reliee? a|reliee? au|relie a|relie au|raccordee? a|raccorde a|connectee? a|connecte a|rattachee? a|rattache a|en u|hauteur|puissance|en dessous de|au[- ]dessous de|au[- ]dessus de|sous|a droite de|a gauche de|a cote de|pres de"

/** Compléments de position : « sous SW-CORE-01 », « à droite de SW-ACC-02 ». */
const CLAUSE_POSITION: Record<string, 'below' | 'above' | 'left' | 'right'> = {
  'en dessous de': 'below',
  'au dessous de': 'below',
  'au-dessous de': 'below',
  sous: 'below',
  'au dessus de': 'above',
  'au-dessus de': 'above',
  'a droite de': 'right',
  'a cote de': 'right',
  'pres de': 'right',
  'a gauche de': 'left',
}

const CLAUSE_FIELD: Record<string, string> = {
  appele: 'name',
  appelee: 'name',
  nomme: 'name',
  nommee: 'name',
  'de nom': 'name',
  "avec l'ip": 'ip',
  'avec ip': 'ip',
  'adresse ip': 'ip',
  'dans la zone': 'zone',
  'en zone': 'zone',
  zone: 'zone',
  'sur le site': 'site',
  site: 'site',
  'dans la grappe': 'cluster',
  grappe: 'cluster',
  cluster: 'cluster',
  'en vlan': 'vlan',
  vlan: 'vlan',
  'dans la baie': 'rack',
  'relie a': 'connectTo',
  'relie au': 'connectTo',
  'reliee a': 'connectTo',
  'reliee au': 'connectTo',
  'raccorde a': 'connectTo',
  'raccordee a': 'connectTo',
  'connecte a': 'connectTo',
  'connectee a': 'connectTo',
  'rattache a': 'connectTo',
  'rattachee a': 'connectTo',
  'en u': 'rackUnit',
  hauteur: 'heightU',
  puissance: 'powerW',
}

interface Clauses {
  /** Début de phrase, avant tout complément (le type d'équipement, et parfois le nom). */
  head: string
  rawHead: string
  values: Record<string, string>
}

/**
 * Découpe une phrase en tête + compléments. Le texte normalisé et le texte d'origine sont
 * alignés caractère par caractère, ce qui permet de rendre chaque valeur avec sa casse.
 */
function splitClauses(text: string, raw: string): Clauses {
  // Le mot-clé doit être précédé d'un espace : « baie de stockage » en tête de phrase est
  // un type d'équipement, pas un complément d'implantation.
  const pattern = new RegExp(`\\s(${CLAUSE_KEYWORDS})(?=\\s)`, 'g')
  const found: { key: string; start: number; valueStart: number }[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const keyword = match[1]
    const start = match.index + 1
    found.push({ key: keyword, start, valueStart: start + keyword.length })
    pattern.lastIndex = match.index + match[0].length
  }

  const values: Record<string, string> = {}
  found.forEach((clause, index) => {
    const end = found[index + 1]?.start ?? text.length
    const value = raw.slice(clause.valueStart, end).trim()
    const cote = CLAUSE_POSITION[clause.key]
    if (cote) {
      if (value && !values.near) values.near = `${cote}:${value}`
      return
    }
    const field = CLAUSE_FIELD[clause.key]
    if (!field) return
    if (value && !values[field]) values[field] = value
  })

  const headEnd = found[0]?.start ?? text.length
  return { head: text.slice(0, headEnd).trim(), rawHead: raw.slice(0, headEnd).trim(), values }
}

/**
 * Reconnaît un type d'équipement en tête de phrase, et considère le reste comme son nom :
 * « switch cœur SW-CORE-03 » donne le type « Switch cœur » et le nom « SW-CORE-03 ».
 */
function matchDevice(
  phrase: string,
  rawPhrase: string,
): { kind: string; label: string; name?: string; descriptif?: boolean } | null {
  const words = phrase.split(' ').filter(Boolean)
  const rawWords = rawPhrase.split(' ').filter(Boolean)
  // Chaque découpage possible est noté : 1 pour une trouvaille stricte du catalogue, moins
  // pour une ressemblance. On garde ensuite le découpage le plus long parmi ceux qui
  // approchent la meilleure note — « par feu FW-09 » doit consommer « par feu », et non le
  // seul « par » (préfixe de l'alias « pare ») qui laisserait « feu » dans le nom.
  const scored: { device: DeviceMeta; score: number; words: number }[] = []
  for (let i = words.length; i > 0; i -= 1) {
    const found = findDeviceScored(words.slice(0, i).join(' '))
    if (found) scored.push({ ...found, words: i })
  }
  if (scored.length === 0) return null

  const bestScore = Math.max(...scored.map((entry) => entry.score))
  // Le découpage le plus long l'emporte quand il désigne un type plus précis (« switch
  // d'accès » plutôt que « switch »). S'il désigne le même type, le mot en plus n'apporte
  // rien — dans « serveur srv fic 01 », « srv » est le début du nom — et le plus sûr gagne.
  const chosen = scored
    .filter((entry) => entry.score >= bestScore - 0.15)
    .reduce((garde, entry) => {
      if (entry.device.id === garde.device.id) return entry.score > garde.score ? entry : garde
      return entry.words > garde.words ? entry : garde
    })
  return { kind: chosen.device.id, label: chosen.device.label, ...nomDicte(rawWords, chosen.words) }
}

/**
 * Le nom, dans ce qui suit le type.
 *
 * Tout ce qui suit le type n'est pas le nom : dans « serveur de fichiers SRV-FIC-01 », seul
 * le dernier mot en est un. On le reconnaît à sa forme — un code, avec une capitale ou un
 * chiffre accolé à des lettres — ou à ce qu'il s'épelle (« s w core zéro un »). Ce qui le
 * précède qualifie l'équipement et ne va pas dans le nom.
 *
 * Sans rien qui ressemble à un nom, c'est la phrase elle-même qui en tient lieu : « serveur
 * web » s'appelle « Serveur web », pas « web ». Le marqueur `descriptif` le signale, pour
 * qu'un second « serveur web » soit numéroté plutôt que refusé comme homonyme.
 */
function nomDicte(rawWords: string[], typeWords: number): { name?: string; descriptif?: boolean } {
  const reste = rawWords.slice(typeWords)
  if (reste.length === 0) return {}
  const estUnCode = (mot: string) =>
    /^[a-zà-ÿ]$/i.test(mot) || (/[a-zà-ÿ]/i.test(mot) && (/\d/.test(mot) || /[A-ZÀ-Ý]/.test(mot)))
  for (let debut = 0; debut < reste.length; debut += 1) {
    const suite = reste.slice(debut).join(' ')
    if (estUnCode(reste[debut]) || formaterNomEpele(suite) !== suite) return { name: suite }
  }
  const entier = rawWords.join(' ')
  return { name: entier.charAt(0).toUpperCase() + entier.slice(1), descriptif: true }
}

/**
 * La phrase est-elle, tout entière, une demande d'aller à une vue ?
 * « inventaire », « ouvre l'inventaire », « va sur les baies », « reviens au schéma ».
 */
function vue(t: string, noms: string): boolean {
  return new RegExp(
    `^(?:(?:va|aller|ouvre|ouvrir|affiche|afficher|montre|montrer|passe|passer|bascule|basculer|reviens|revenir|retourne|retourner|retour|vue|onglet)\\s+)?` +
      `(?:(?:a|au|aux|sur|dans|vers|en)\\s+)?(?:(?:moi)\\s+)?(?:l'|le |la |les |du |de la |des |mon |ma |mes )?(?:vue\\s+)?(?:${noms})$`,
  ).test(t)
}

/**
 * Règles d'interprétation, dans l'ordre : les tournures les plus spécifiques d'abord,
 * pour qu'« ajoute FW-01 à la grappe FW-HA » ne soit pas lu comme « ajoute un équipement ».
 */
const RULES: Rule[] = [
  // La langue parlée d'abord : ses tournures sont plus précises que celles qui suivent, et
  // plusieurs d'entre elles tombaient auparavant dans une règle voisine qui faisait autre chose.
  ...REGLES_PARLEES,

  // ── Annotations ────────────────────────────────────────────────────────────
  // Placées avant « ajoute <équipement> » : « ajoute une note » désigne une annotation,
  // pas un type du catalogue.
  (t, raw) => {
    const motif = /^(?:ajoute|ajouter|pose|poser|cree|creer|ecris|ecrire)\s+(?:une\s+|un\s+)?(note|annotation|remarque|commentaire)\s*(.*)$/
    const match = t.match(motif)
    if (!match) return null
    const texte = rawValue(raw, motif, 2, match[2] ?? '')
    return { type: 'annotate', kind: 'note', text: texte.trim() || undefined }
  },
  (t, raw) => {
    const motif = /^(?:encadre|encadrer|entoure|entourer|delimite|delimiter)\s*(.*)$/
    const match = t.match(motif)
    if (!match) return null
    const texte = rawValue(raw, motif, 1, match[1] ?? '')
    return { type: 'annotate', kind: 'zone', text: texte.trim() || undefined }
  },
  (t, raw) => {
    const motif = /^(?:ajoute|ajouter|pose|poser|trace|tracer)\s+(?:une\s+)?(?:fleche|renvoi)\s*(.*)$/
    const match = t.match(motif)
    if (!match) return null
    const texte = rawValue(raw, motif, 1, match[1] ?? '')
    return { type: 'annotate', kind: 'arrow', text: texte.trim() || undefined }
  },

  // ── Pages du document ──────────────────────────────────────────────────────
  (t, raw) => {
    const match = t.match(/^(?:ajoute|ajouter|cree|creer|nouvelle|nouveau|nouvel)\s+(?:une\s+|un\s+)?(?:page|onglet)\s*(.*)$/)
    if (!match) return null
    // Le nom garde la casse saisie : un onglet « Agence Lyon » ne s'écrit pas « agence lyon ».
    const nom = rawValue(
      raw,
      /^(?:ajoute|ajouter|cree|creer|nouvelle|nouveau|nouvel)\s+(?:une\s+|un\s+)?(?:page|onglet)\s*(.*)$/i,
      1,
      cleanName(match[1]),
    )
    return { type: 'page', action: 'add', name: nom || undefined }
  },
  (t) => {
    const match = t.match(/^(?:duplique|dupliquer|copie|copier)\s+(?:la\s+|cette\s+)?(?:page|onglet)$/)
    return match ? { type: 'page', action: 'duplicate' } : null
  },
  (t) => {
    const match = t.match(/^(?:supprime|supprimer|efface|effacer|ferme|fermer)\s+(?:la\s+|cette\s+)?(?:page|onglet)\s*(.*)$/)
    return match ? { type: 'page', action: 'remove', name: cleanName(match[1]) || undefined } : null
  },
  (t, raw) => {
    const match = t.match(/^(?:renomme|renommer|appelle|appeler)\s+(?:la\s+|cette\s+)?(?:page|onglet)\s+(?:en\s+|:\s*)?(.+)$/)
    if (!match) return null
    const name = rawValue(
      raw,
      /^(?:renomme|renommer|appelle|appeler)\s+(?:la\s+|cette\s+)?(?:page|onglet)\s+(?:en\s+|:\s*)?(.+)$/i,
      1,
      cleanName(match[1]),
    )
    return name ? { type: 'page', action: 'rename', name } : null
  },
  (t) => {
    const match = t.match(/^(?:page|onglet)\s+(?:suivante?|d'apres|apres)$/)
    return match ? { type: 'page', action: 'next' } : null
  },
  (t) => {
    const match = t.match(/^(?:page|onglet)\s+(?:precedente?|d'avant|avant)$/)
    return match ? { type: 'page', action: 'previous' } : null
  },
  (t) => {
    const match = t.match(/^(?:va (?:a|sur) la |ouvre la |affiche la |montre la )?(?:page|onglet)\s+(\d{1,2})$/)
    return match ? { type: 'page', action: 'select', number: Number(match[1]) } : null
  },
  (t) => {
    const match = t.match(/^(?:va (?:a|sur) la |ouvre la |affiche la |montre la )(?:page|onglet)\s+(.+)$/)
    const name = match ? cleanName(match[1]) : ''
    return name ? { type: 'page', action: 'select', name } : null
  },

  // ── Analyse d'impact ───────────────────────────────────────────────────────
  (t) => {
    const match = t.match(
      /^(?:simule|simuler|teste|tester)\s+(?:la\s+)?(?:panne|coupure|perte|arret)\s+(?:de |du |d'|de la )?(.+)$/,
    )
    return match ? { type: 'impact', action: 'fail', target: cleanName(match[1]) } : null
  },
  (t) => {
    const match = t.match(/^(?:arrete|arreter|eteins|eteindre|coupe|couper)\s+(?:le |la |l')?(.+?)\s*$/)
    if (!match) return null
    // « coupe la liaison entre A et B » relève du débranchement, pas de l'arrêt d'un boîtier.
    if (/^(liaison|lien|cable|câble)/.test(match[1])) return null
    if (/^(schema|simulation|analyse)/.test(match[1])) return { type: 'impact', action: 'reset' }
    return { type: 'impact', action: 'fail', target: cleanName(match[1]) }
  },
  (t) => {
    const match = t.match(
      /^(?:debranche|debrancher|coupe|couper)\s+(?:la\s+|le\s+)?(?:liaison|lien|cable|câble)\s+(?:entre\s+)?(.+?)\s+(?:et|vers|a)\s+(.+)$/,
    )
    return match ? { type: 'impact', action: 'unplug', target: cleanName(match[1]), to: cleanName(match[2]) } : null
  },
  (t) =>
    // « rétablis » et « remets » tout seuls rétablissent la dernière action annulée : c'est
    // ce qu'on veut dire neuf fois sur dix. L'exécution garde le bon sens — si une panne est
    // simulée et qu'il n'y a rien à rétablir, c'est la simulation qu'elle remet à zéro.
    /^(?:retablis (?:le reseau|la simulation|tout)|remets (?:le reseau|tout) en (?:marche|service|etat)|reinitialise|reinitialise la simulation|arrete la simulation|fin de simulation|tout va bien)$/.test(t)
      ? { type: 'impact', action: 'reset' }
      : null,
  (t) =>
    /^(?:analyse d'impact|impact|ouvre l'impact|montre l'impact|que se passe t il|quel est l'impact)$/.test(t)
      ? { type: 'impact', action: 'open' }
      : null,

  // ── Zones, sites, grappes et couches du schéma ─────────────────────────────
  (t, raw) => {
    const match = t.match(
      /^(?:renomme|renommer|rebaptise)\s+(?:la |le |l')?(zone|site|grappe|cluster|couche|bande)\s+(.+?)\s+(?:en|par)\s+(.+)$/,
    )
    if (!match) return null
    const what =
      match[1] === 'site'
        ? 'site'
        : match[1] === 'grappe' || match[1] === 'cluster'
          ? 'cluster'
          : match[1] === 'zone'
            ? 'zone'
            : 'layer'
    const to = rawValue(
      raw,
      /^(?:renomme|renommer|rebaptise)\s+(?:la |le |l')?(?:zone|site|grappe|cluster|couche|bande)\s+.+?\s+(?:en|par)\s+(.+)$/i,
      1,
      cleanName(match[3]),
    )
    return to ? { type: 'groupRename', what, from: cleanName(match[2]), to } : null
  },

  // ── Questions ──────────────────────────────────────────────────────────────
  (t) => (/^(aide|aide moi|aidez moi|commandes|au secours|que sais tu faire|que peux tu faire|comment ca marche)$/.test(t) ? { type: 'help' } : null),
  (t) => {
    const match = t.match(/^(?:combien (?:de|d')\s*)(u libres?|unites? libres?)(?:\s+(?:dans|de)\s+(?:la\s+)?(?:baie\s+)?(.+))?$/)
    return match ? { type: 'query', question: 'freeUnits', argument: match[2]?.trim() } : null
  },
  (t) => {
    const match = t.match(/^combien (?:d'|de )(.+)$/)
    if (!match) return null
    const what = match[1].trim()
    if (/^(equipements?|elements?|machines?|objets?)$/.test(what)) return { type: 'query', question: 'count' }
    if (/^(vlans?)$/.test(what)) return { type: 'query', question: 'vlans' }
    if (/^(baies?|racks?)$/.test(what)) return { type: 'query', question: 'racks' }
    return { type: 'query', question: 'countKind', argument: what }
  },
  (t) =>
    /(score|note).*(haute disponibilite|ha|robustesse)|quelle est la robustesse|niveau de robustesse/.test(t)
      ? { type: 'query', question: 'ha' }
      : null,
  (t) =>
    /(point|points) de defaillance|spof|y a[- ]t[- ]il des (risques|problemes)/.test(t)
      ? { type: 'query', question: 'spof' }
      : null,
  (t) => (/(consommation|puissance totale|combien de watts)/.test(t) ? { type: 'query', question: 'power' } : null),

  // ── Liaisons ───────────────────────────────────────────────────────────────
  (t) => {
    const match = t.match(
      /^(?:relie|relier|connecte|connecter|raccorde|raccorder|branche|brancher)\s+(.+?)\s+(?:a|au|aux|avec|vers|et)\s+(.+?)(?:\s+en\s+(.+))?$/,
    )
    if (!match) return null
    const media = match[3] ? normalizeSpeech(match[3]) : ''
    const linkKind = Object.entries(LINK_WORDS).find(([word]) => media.includes(word))?.[1]
    return { type: 'link', from: cleanName(match[1]), to: cleanName(match[2]), linkKind }
  },
  (t) => (/^(mode\s+)?(relier|connexion|liaison)$/.test(t) ? { type: 'connect' } : null),

  // ── Fiches d'équipement ────────────────────────────────────────────────────
  (t, raw) => {
    const match = t.match(/^(?:renomme|renommer|appelle)\s+(?:l'|le\s+)?agregat\s+(?:en\s+)?(.+)$/)
    return match ? { type: 'lagRename', nom: rawValue(raw, /agr[ée]gat\s+(?:en\s+)?(.+)$/i, 1, match[1].trim()) } : null
  },
  (t, raw) => {
    const match = t.match(/^(?:renomme|renommer|rebaptise)\s+(.+?)\s+(?:en|par)\s+(.+)$/)
    if (!match) return null
    return {
      type: 'rename',
      target: cleanName(match[1]),
      name: rawValue(raw, /(?:renomme|renommer|rebaptise)\s+.+?\s+(?:en|par)\s+(.+)$/i, 1, cleanName(match[2])),
    }
  },
  (t, raw) => {
    // « mets l'ip 10.0.0.1 sur FW-01 » / « l'adresse de FW-01 est 10.0.0.1 »
    const direct = t.match(
      /^(?:mets|met|mettre|affecte|attribue|donne)\s+(?:l'|la |le )?(ip|adresse ip|adresse|vlan|zone|site|grappe|cluster|responsable|numero de serie|serie|modele|materiel|vip|note|notes|hauteur|puissance|position)\s+(.+?)\s+(?:a|au|sur|pour)\s+(.+)$/,
    )
    const reverse = t.match(
      /^(?:l'|la |le )?(ip|adresse ip|adresse|vlan|zone|site|grappe|cluster|responsable|numero de serie|serie|modele|materiel|vip|note|notes|hauteur|puissance|position)\s+(?:de |du |d')(.+?)\s+(?:est|c'est|:)\s+(.+)$/,
    )
    const match = direct ?? reverse
    if (!match) return null
    const fields: Record<string, NodeField> = {
      ip: 'ip',
      adresse: 'ip',
      'adresse ip': 'ip',
      vlan: 'vlan',
      zone: 'zone',
      site: 'site',
      grappe: 'cluster',
      cluster: 'cluster',
      responsable: 'owner',
      'numero de serie': 'serial',
      serie: 'serial',
      modele: 'model',
      materiel: 'model',
      vip: 'vip',
      note: 'notes',
      notes: 'notes',
      hauteur: 'heightU',
      puissance: 'powerW',
      position: 'rackUnit',
    }
    const field = fields[match[1]]
    if (!field) return null
    const [value, target] = direct ? [match[2], match[3]] : [match[3], match[2]]
    const rawPattern = direct
      ? /(?:mets|met|mettre|affecte|attribue|donne)\s+(?:l'|la |le )?[\wéèêàûô' ]+?\s+(.+?)\s+(?:a|au|sur|pour)\s+.+$/i
      : /(?:est|c'est|:)\s+(.+)$/i
    return {
      type: 'setField',
      target: cleanName(target),
      field,
      value: rawValue(raw, rawPattern, 1, value.trim()),
    }
  },
  // « mets tous les postes de travail dans la zone Bâtiment A »
  (t, raw) => {
    const match = t.match(
      /^(?:mets|met|mettre|place|placer|affecte|affecter|range|ranger|deplace)\s+(.+?)\s+(dans la zone|en zone|dans le site|sur le site|dans la grappe|dans le cluster|en vlan|dans le vlan|sur le vlan|dans la baie)\s+(.+)$/,
    )
    if (!match) return null
    const keyword = match[2]
    const value = rawValue(
      raw,
      /(?:dans la zone|en zone|dans le site|sur le site|dans la grappe|dans le cluster|en vlan|dans le vlan|sur le vlan|dans la baie)\s+(.+)$/i,
      1,
      match[3].trim(),
    )
    const target = cleanName(match[1])
    if (keyword === 'dans la baie') return { type: 'rackAssign', target, rack: value }
    const field: NodeField = keyword.includes('zone')
      ? 'zone'
      : keyword.includes('site')
        ? 'site'
        : keyword.includes('vlan')
          ? 'vlan'
          : 'cluster'
    return { type: 'setField', target, field, value }
  },

  (t) => {
    const match = t.match(/^(.+?)\s+(?:est|passe)\s+(?:en\s+|le\s+)?(actif|passif|maitre|principal|secours|temoin|quorum|autonome|actif actif)$/)
    if (!match) return null
    const role = ROLE_WORDS[match[2]]
    return role ? { type: 'setRole', target: cleanName(match[1]), role } : null
  },
  (t) => {
    const match = t.match(/^(?:marque|passe|mets|met)\s+(.+?)\s+(?:en|au)\s+(production|service|stock|maintenance|panne|reparation|retire|reforme)$/)
    if (!match) return null
    const status = STATUS_WORDS[match[2]]
    return status ? { type: 'setStatus', target: cleanName(match[1]), status } : null
  },
  // ── Verrous ────────────────────────────────────────────────────────────────
  (t) => {
    const match = t.match(/^(verrouille|verrouiller|deverrouille|deverrouiller|bloque|debloque)\s*(?:le |les |la )?(schema|plan|etiquettes?|libelles?|textes?)?$/)
    if (!match) return null
    const locked = !/^(deverrouille|deverrouiller|debloque)/.test(match[1])
    const what = match[2] && /etiquette|libelle|texte/.test(match[2]) ? 'labels' : 'diagram'
    return { type: 'lock', what, locked }
  },
  (t) => {
    const match = t.match(/^(?:fige|figer|epingle|verrouille)\s*(?:la position (?:de |du |d')?)?(.*)$/)
    return match ? { type: 'setPinned', target: cleanName(match[1]) || undefined, pinned: true } : null
  },
  (t) => {
    const match = t.match(/^(?:libere|liberer|defige|deverrouille)\s*(?:la position (?:de |du |d')?)?(.*)$/)
    return match ? { type: 'setPinned', target: cleanName(match[1]) || undefined, pinned: false } : null
  },

  // ── Plan d'affichage ───────────────────────────────────────────────────────
  (t) => {
    const match = t.match(
      /^(?:mets|met|mettre|passe|place|envoie|remonte|descends?|avance|recule)\s*(.*?)\s*(?:au |en |a l'|vers l'|vers le |au niveau )?(premier.?plan|avant.?plan|arriere.?plan|second.?plan|dessus|dessous|devant|derriere)$/,
    )
    if (!match) return null
    const where: ZOrder =
      /premier.?plan|avant.?plan|dessus|devant/.test(match[2]) ? 'front' : 'back'
    return { type: 'zorder', target: cleanName(match[1]) || undefined, where }
  },
  // « avance » / « recule » tout court restent le zoom : il faut un équipement visé ou la
  // mention du cran pour parler du plan d'affichage.
  (t) => {
    const match = t.match(/^(?:avance|avancer|remonte|remonter)\s+(?:d'un (?:cran|plan)|(.+))$/)
    if (!match) return null
    return { type: 'zorder', target: cleanName(match[1] ?? '') || undefined, where: 'forward' }
  },
  (t) => {
    const match = t.match(/^(?:recule|reculer|descends|descendre)\s+(?:d'un (?:cran|plan)|(.+))$/)
    if (!match) return null
    return { type: 'zorder', target: cleanName(match[1] ?? '') || undefined, where: 'backward' }
  },
  (t) =>
    /(accroches? automatiques?|reinitialise les accroches|accroches? auto)/.test(t)
      ? { type: 'linkAttach', reset: true }
      : null,


  // ── Déductions, mise en page, grappes ─────────────────────────────────────
  /*
    Ces commandes-là valent le plus cher à la main : déduire les mécanismes de haute
    disponibilité d'un parc, c'est ouvrir chaque grappe et choisir dans une liste de
    soixante-sept mécanismes. Une phrase suffit.
  */
  (t) =>
    /^(?:deduis|deduire|devine|retrouve)\s+(?:les\s+)?mecanismes?(?:\s+(?:de\s+)?(?:haute\s+disponibilite|ha))?$/.test(t)
      ? { type: 'deduireHa' }
      : null,
  (t) =>
    /^(?:deduis|deduire|devine|retrouve)\s+(?:les\s+)?(?:vlans?|plan\s+d'adressage)(?:\s+du\s+schema)?$/.test(t)
      ? { type: 'deduireVlans' }
      : null,

  (t) => {
    const match = t.match(/^(?:aligne|aligner|alignement)\s+(?:la\s+selection\s+)?(?:a\s+|au\s+|en\s+)?(gauche|droite|haut|bas|centre|milieu|horizontalement|verticalement)$/)
    if (!match) return null
    const modes: Record<string, 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'> = {
      gauche: 'left', droite: 'right', haut: 'top', bas: 'bottom',
      centre: 'vcenter', milieu: 'vcenter', horizontalement: 'vcenter', verticalement: 'hcenter',
    }
    return { type: 'align', mode: modes[match[1]] }
  },
  (t) => {
    const match = t.match(/^(?:repartis|repartir|distribue|distribuer|espace)\s+(?:la\s+selection\s+)?(horizontalement|verticalement)$/)
    return match ? { type: 'distribute', axis: match[1] === 'horizontalement' ? 'x' : 'y' } : null
  },

  (t, raw) => {
    const match = t.match(/^(?:mets|met|mettre|colore|colorer|passe)\s+la\s+grappe\s+(.+?)\s+(?:en|au)\s+(.+)$/)
    if (!match) return null
    const couleur = couleurParNom(match[2].trim())
    if (!couleur) return null
    return {
      type: 'clusterColor',
      cluster: rawValue(raw, /grappe\s+(.+?)\s+(?:en|au)\s+/i, 1, match[1].trim()),
      couleur: couleur.id,
      libelle: couleur.label,
    }
  },

  (t) => {
    const match = t.match(/^(?:supprime|supprimer|retire|enleve)\s+le\s+vlan\s+(\d+)$/)
    return match ? { type: 'vlanRemove', id: match[1] } : null
  },
  (t, raw) => {
    const match = t.match(/^(?:cree|creer|ajoute|ajouter)\s+(?:la\s+)?baie\s+(.+?)(?:\s+(?:de|a)\s+(\d+)\s*u)?$/)
    if (!match) return null
    return {
      type: 'rackAdd',
      name: rawValue(raw, /baie\s+(.+?)(?:\s+(?:de|à|a)\s+\d+\s*u)?$/i, 1, match[1].trim()),
      units: match[2] ? Number(match[2]) : undefined,
    }
  },
  (t, raw) => {
    const match = t.match(/^(?:supprime|supprimer|retire)\s+(?:la\s+)?baie\s+(.+)$/)
    return match ? { type: 'rackRemove', name: rawValue(raw, /baie\s+(.+)$/i, 1, match[1].trim()) } : null
  },
  (t) => {
    const match = t.match(/^(masque|masquer|cache|affiche|afficher|montre)\s+(?:les\s+)?(?:anneaux\s+d')?agregats?$/)
    return match ? { type: 'lagHidden', hidden: /^(masque|masquer|cache)$/.test(match[1]) } : null
  },
  (t) => {
    const match = t.match(/^(?:(active|activer|passe\s+en|mode)|(desactive|desactiver|quitte))\s+(?:le\s+)?(?:mode\s+)?l3\s+strict$/)
    return match ? { type: 'strictOsi', strict: Boolean(match[1]) } : null
  },
  (t, raw) => {
    // « établi par Dupont » tourne autrement que « auteur Dupont », et c'est la tournure
    // qu'on emploie en dictant un cartouche.
    const auteur = t.match(/^(?:etabli|redige|dresse)\s+par\s+(.+)$/)
    if (auteur) {
      return {
        type: 'titleBlock',
        champ: 'auteur',
        valeur: rawValue(raw, /(?:établi|etabli|rédigé|redige|dressé|dresse)\s+par\s+(.+)$/i, 1, auteur[1].trim()),
      }
    }
    const match = t.match(/^(?:(?:mets|met|mettre|renseigne)\s+)?(?:l'|le\s+|la\s+)?(reference|indice|auteur|redacteur|organisation|societe|diffusion)\s*(?::|a|en|=)?\s+(.+)$/)
    if (!match) return null
    const champs: Record<string, 'reference' | 'indice' | 'auteur' | 'organisation' | 'diffusion'> = {
      reference: 'reference', indice: 'indice', auteur: 'auteur', redacteur: 'auteur',
      organisation: 'organisation', societe: 'organisation', diffusion: 'diffusion',
    }
    return {
      type: 'titleBlock',
      champ: champs[match[1]],
      valeur: rawValue(raw, new RegExp(`${match[1]}\\s*(?::|à|a|en|=)?\\s+(.+)$`, 'i'), 1, match[2].trim()),
    }
  },

  // ── Baies et plan d'adressage ──────────────────────────────────────────────
  (t) => {
    const match = t.match(/^(?:implante|implanter|installe|pose|place)\s+(.+?)\s+(?:dans|en|sur)\s+(?:la\s+)?(?:baie\s+)?(.+)$/)
    return match ? { type: 'rackAssign', target: cleanName(match[1]), rack: cleanName(match[2]) } : null
  },
  (t) => {
    const match = t.match(/^(?:retire|retirer|sors|desimplante)\s+(.+?)\s+(?:de|du)\s+(?:la\s+)?baie.*$/)
    return match ? { type: 'rackDetach', target: cleanName(match[1]) } : null
  },
  (t, raw) => {
    const match = t.match(/^(?:cree|creer|ajoute|ajouter)\s+le\s+vlan\s+(\d+)(?:\s+(?:nom|appele)\s+([^0-9]+?))?(?:\s+(?:sous.?reseau|reseau)\s+([\d./ ]+))?$/)
    if (!match) return null
    return {
      type: 'vlanAdd',
      id: match[1],
      name: match[2] ? rawValue(raw, /(?:nom|appele)\s+([^0-9]+?)(?:\s+(?:sous.?reseau|reseau)\s+|$)/i, 1, match[2].trim()) : undefined,
      subnet: match[3]?.replace(/\s/g, '') || undefined,
    }
  },

  // ── Ajouts ─────────────────────────────────────────────────────────────────
  (t) => {
    const match = t.match(/^(?:insere|inserer|ajoute|ajouter)\s+(?:le\s+)?(?:modele|patron|gabarit)\s+(.+)$/)
    return match ? { type: 'pattern', query: match[1].trim() } : null
  },
  (t, raw) => {
    // « mets », « place », « installe » sont des verbes à tout faire : ils ne créent un
    // équipement que devant un article indéfini. « Mets SW-01 dans la zone DMZ » n'en crée pas.
    const match =
      t.match(
        /^(?:ajoute|ajouter|rajoute|cree|creer|nouveau|nouvelle|pose|poser|insere|inserer)\s+(?:(?:un|une|le|la|les|des)\s+|l')?(.+)$/,
      ) ?? t.match(/^(?:mets|place|installe|donne moi|il me faut)\s+(?:un|une)\s+(.+)$/)
    if (!match) return null
    const offset = t.length - match[1].length
    const { head, rawHead, values } = splitClauses(match[1], raw.slice(offset))
    const device = matchDevice(head, rawHead)
    if (!device) return null

    const props: Partial<Record<NodeField, string>> = {}
    for (const field of ['ip', 'zone', 'site', 'cluster', 'vlan', 'rackUnit', 'heightU', 'powerW'] as NodeField[]) {
      if (values[field]) props[field] = values[field]
    }
    const nom = values.name ?? device.name
    const [cote, repere] = values.near ? values.near.split(/:(.+)/) : []
    return {
      type: 'add',
      kind: device.kind,
      label: device.label,
      // Un nom épelé — « s w core zéro un » — retrouve la forme qu'on lui aurait tapée.
      name: nom ? formaterNomEpele(nom) : undefined,
      descriptif: !values.name && device.descriptif ? true : undefined,
      props: Object.keys(props).length > 0 ? props : undefined,
      rack: values.rack,
      connectTo: values.connectTo,
      near: repere ? { target: cleanName(repere), side: cote as 'below' | 'above' | 'left' | 'right' } : undefined,
    }
  },
  // Presse-papiers : ce qui voyage d'une page ou d'un document à l'autre.
  (t) =>
    /^(?:colle|coller)(?:\s+(?:le\s+)?(?:presse[- ]?papiers?|bloc|la\s+copie))?$/.test(t)
      ? { type: 'clipboard', action: 'paste' }
      : null,
  (t) =>
    /(?:mets?|mettre|copie|copier)\s+(?:la\s+selection\s+)?dans\s+le\s+presse[- ]?papiers?/.test(t)
      ? { type: 'clipboard', action: 'copy' }
      : null,
  (t) =>
    /^(?:coupe|couper)(?:\s+la\s+selection)?$/.test(t) ? { type: 'clipboard', action: 'cut' } : null,
  // « duplique en série » ouvre le dialogue ; « duplique cinq fois » agit directement.
  (t) =>
    /(?:duplique|dupliquer|duplication)\s+(?:la\s+selection\s+)?en\s+serie/.test(t)
      ? { type: 'duplicateSeries' }
      : null,
  (t) => {
    const match = t.match(
      /^(?:duplique|dupliquer)\s+(?:la\s+selection\s+)?(un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|\d{1,2})\s+fois$/,
    )
    if (!match) return null
    const mots: Record<string, number> = {
      un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
      six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12,
    }
    const copies = mots[match[1]] ?? Number(match[1])
    return copies >= 1 && copies <= 50 ? { type: 'duplicate', copies } : null
  },
  (t, raw) => {
    const match = t.match(/^(?:duplique|dupliquer|copie|copier)(?:\s+(.+))?$/)
    if (!match) return null
    const target = match[1] ? cleanName(match[1]) : undefined
    if (!target || /^(la selection|selection|ca|cela)$/.test(target)) return { type: 'duplicate' }
    return { type: 'duplicate', target: rawValue(raw, /(?:duplique|dupliquer|copie|copier)\s+(.+)$/i, 1, target) }
  },

  // Changer le type d'un équipement.
  (t, raw) => {
    const match = t.match(
      /^(?:change|changer|modifie|modifier|transforme|transformer|passe|convertis)\s+(?:le type (?:de |du |d')?)?(.+?)\s+(?:en|vers|comme)\s+(.+)$/,
    )
    if (!match) return null
    const device = findDevice(match[2].trim())
    if (!device) return null
    return {
      type: 'setKind',
      target: rawValue(raw, /(?:change|changer|modifie|modifier|transforme|transformer|passe|convertis)\s+(?:le type (?:de |du |d')?)?(.+?)\s+(?:en|vers|comme)\s+/i, 1, cleanName(match[1])),
      kind: device.id,
      label: device.label,
    }
  },

  // Déplacer un équipement sur le plan.
  (t, raw) => {
    const match = t.match(
      /^(?:deplace|deplacer|bouge|bouger|decale|decaler)\s+(.+?)\s+(?:vers |a |au |en |sur )?(la droite|la gauche|le haut|le bas|droite|gauche|haut|bas)(?:\s+de\s+(\d+))?$/,
    )
    if (!match) return null
    const directions: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      droite: 'right',
      'la droite': 'right',
      gauche: 'left',
      'la gauche': 'left',
      haut: 'up',
      'le haut': 'up',
      bas: 'down',
      'le bas': 'down',
    }
    const direction = directions[match[2]]
    if (!direction) return null
    return {
      type: 'move',
      target: rawValue(raw, /(?:deplace|deplacer|bouge|bouger|decale|decaler)\s+(.+?)\s+(?:vers |a |au |en |sur )?(?:la |le )?(?:droite|gauche|haut|bas)/i, 1, cleanName(match[1])),
      direction,
      amount: match[3] ? Number(match[3]) : 120,
    }
  },

  // Supprimer une liaison désignée par ses extrémités.
  (t, raw) => {
    const match = t.match(
      /^(?:supprime|supprimer|efface|effacer|enleve|enlever|coupe|couper)\s+(?:la\s+)?(?:liaison|lien|cable|connexion)\s+(?:entre\s+)?(.+?)\s+(?:et|a|au|avec|vers)\s+(.+)$/,
    )
    if (!match) return null
    void raw
    return { type: 'linkDelete', from: cleanName(match[1]), to: cleanName(match[2]) }
  },

  // Modifier une liaison désignée par ses extrémités.
  (t, raw) => {
    const match = t.match(
      /^(?:(?:passe|mets|met|mettre|modifie|change)\s+)?(?:la\s+)?(?:liaison|lien|cable|connexion)\s+(?:entre\s+)?(.+?)\s+(?:et|vers)\s+(.+?)\s+(?:en|a|au|avec|:)\s+(.+)$/,
    )
    if (!match) return null
    const from = cleanName(match[1])
    const to = cleanName(match[2])
    const rest = match[3].trim()
    const patch: LinkPatch = {}

    const media = Object.entries(LINK_WORDS).find(([word]) => rest.includes(word))
    if (media) patch.kind = media[1]
    if (/secours|redondant|backup/.test(rest)) patch.redundant = true
    if (/trunk/.test(rest)) patch.mode = 'trunk'
    else if (/acces/.test(rest)) patch.mode = 'access'

    const vlans = rest.match(/vlan[s]?\s+([\d,;\s-]+)/)
    if (vlans) patch.vlans = vlans[1].replace(/\s/g, '')
    const subnet = rest.match(/(\d{1,3}(?:\.\d{1,3}){3}\s*\/\s*\d{1,2})/)
    if (subnet) patch.subnet = subnet[1].replace(/\s/g, '')
    const speed = rest.match(/(\d+(?:[.,]\d+)?\s*(?:g|gb|gbps|gb\/s|gigabit|m|mb|mbps|mb\/s)[a-z/]*)/)
    if (speed) patch.speed = rawValue(raw, /\s(\d+(?:[.,]\d+)?\s*(?:G|Gb|Gbps|Gb\/s|M|Mb|Mbps|Mb\/s)[a-z/]*)\b/i, 1, speed[1])
    const label = rest.match(/(?:libelle|etiquette|nom)\s+(.+)$/)
    if (label) patch.label = rawValue(raw, /(?:libell[ée]|[ée]tiquette|nom)\s+(.+)$/i, 1, label[1])

    if (Object.keys(patch).length === 0) return null
    return { type: 'linkEdit', from, to, patch }
  },

  // Sélectionner tous les équipements d'un type.
  (t) => {
    const match = t.match(/^(?:selectionne|selectionner|choisis)\s+(?:tous\s+les|toutes\s+les|les)\s+(.+)$/)
    if (!match) return null
    const device = findDevice(match[1].trim())
    return device ? { type: 'selectKind', kind: device.id, label: device.label } : null
  },
  (t) => {
    const match = t.match(/^(?:supprime|supprimer|efface|effacer|enleve|enlever)\s+(.+)$/)
    if (!match) return null
    const what = cleanName(match[1])
    if (/^(selection|ca|cela|tout)$/.test(what)) return { type: 'delete' }
    return { type: 'delete', target: what }
  },
  (t) => (/^(supprime|supprimer|efface|effacer)$/.test(t) ? { type: 'delete' } : null),
  (t) => (/^(tout selectionner|selectionne tout)$/.test(t) ? { type: 'selectAll' } : null),
  (t) => (/^(deselectionne|annule la selection|rien)$/.test(t) ? { type: 'clearSelection' } : null),

  // ── Mise en page et affichage ──────────────────────────────────────────────
  (t) =>
    /(placement automatique|place automatiquement|placement auto|range le schema|organise le schema|replace tout|reorganise)/.test(t)
      ? { type: 'layout' }
      : null,
  (t) =>
    /(ajuste|ajuster|recentre|recentrer|vue d'ensemble|cadre le schema|tout voir)/.test(t) ? { type: 'fit' } : null,
  (t) => (/(de gauche a droite|horizontal|a l'horizontale)/.test(t) ? { type: 'direction', direction: 'LR' } : null),
  (t) => (/(de haut en bas|vertical|a la verticale)/.test(t) ? { type: 'direction', direction: 'TB' } : null),
  // « tracé … » vise la liaison sélectionnée ; « liaisons … » vise tout le schéma.
  (t) => {
    const match = t.match(/^(?:trace|tracer|le trace)\s+(courbe|droit|direct|orthogonal|automatique)$/)
    if (!match) return null
    const shapes: Record<string, LinkShape> = {
      courbe: 'curved',
      droit: 'straight',
      direct: 'straight',
      orthogonal: 'orthogonal',
      automatique: 'auto',
    }
    return { type: 'route', shape: shapes[match[1]] }
  },
  (t) =>
    /(reinitialise le trace|trace automatique|rends? le trace automatique|redresse la liaison)/.test(t)
      ? { type: 'route', shape: 'auto' }
      : null,
  (t) => (/(liaisons? droites?|traits? droits?|ligne droite)/.test(t) ? { type: 'linkStyle', style: 'straight' } : null),
  (t) =>
    /(liaisons? orthogonales?|angles? droits?)/.test(t) ? { type: 'linkStyle', style: 'orthogonal' } : null,
  (t) => {
    const match = t.match(/^(affiche|affiches|montre|masque|masquer|cache|cacher)\s+(?:les |la |le |l')?(.+)$/)
    if (!match) return null
    const show = /^(affiche|affiches|montre)$/.test(match[1])
    const toggle = TOGGLE_WORDS.find((item) => item.pattern.test(match[2].trim()))
    return toggle ? { type: 'toggle', key: toggle.key, value: show } : null
  },
  // Les formes parlées d'« annule » et de « refais » sont traitées en tête, ancrées. Ces deux
  // règles attrapaient le mot n'importe où dans la phrase : « la commande est annulée »,
  // dictée dans une note, annulait la dernière action.
  (t) => (/(toutes les couches|toutes couches)/.test(t) ? { type: 'osi', layer: 'all' } : null),
  (t) => {
    const match = t.match(/(?:couche|niveau|vue)\s+(?:osi\s+)?(1|2|3|un|deux|trois|physique|liaison|reseau)/)
    return match ? { type: 'osi', layer: LAYER_WORDS[match[1]] } : null
  },
  (t) => (/(synthese|vue resumee|resume)/.test(t) ? { type: 'detail', level: 'summary' } : null),
  (t) => (/(sans les postes|masque les postes|cache les postes)/.test(t) ? { type: 'detail', level: 'no-endpoints' } : null),
  // « montre tout » cadre le schéma à l'écran ; il ne change plus le niveau de détail.
  (t) => (/(detail complet|tout le detail|montre tout le detail)/.test(t) ? { type: 'detail', level: 'full' } : null),
  // Modes de visualisation : « mode présentation », « vue technique », « en architecture ».
  (t) => {
    const match = t.match(
      /(?:mode|vue|affichage|passe en|bascule en|mets? en)\s+(architecture|technique|presentation|projection)/,
    )
    if (!match) return null
    const mode: ViewMode =
      match[1] === 'technique' ? 'technique' : match[1] === 'architecture' ? 'architecture' : 'presentation'
    return { type: 'viewMode', mode }
  },
  // Vues logiques et projecteur VLAN.
  (t) =>
    /(plan vlan|rails? vlan|un rail par vlan)/.test(t) ? { type: 'vueLogique', vue: 'rails' } : null,
  (t) =>
    /(domaines? de diffusion|nuages? vlan|bulles? vlan)/.test(t)
      ? { type: 'vueLogique', vue: 'domaines' }
      : null,
  (t) =>
    /(vue (du )?routage|plan de routage|vue logique|mode logique)/.test(t)
      ? { type: 'vueLogique', vue: 'routage' }
      : null,
  (t) => {
    const match = t.match(
      /^(?:projecteur|montre|affiche|isole|isoler|mets? en avant|surligne)\s+(?:le\s+|sur\s+le\s+)?vlan\s*(\d{1,4})$/,
    )
    return match ? { type: 'vlanFocus', id: match[1] } : null
  },
  (t) =>
    /(tous les vlans?|enleve le projecteur|plus de projecteur|montre tout le schema)/.test(t)
      ? { type: 'vlanFocus', id: null }
      : null,
  (t) =>
    /(assistant|aide a la conception|aide moi a construire|aide moi a dessiner)/.test(t)
      ? { type: 'assistant' }
      : null,
  /*
    Navigation entre les vues.

    Ces règles cherchaient leur mot n'importe où : toute phrase contenant « baie », « parc »,
    « plan » ou « dossier » ouvrait une vue. « Note sur SW-CORE-01 : baie B12 » ouvrait les
    baies. La phrase entière doit maintenant être une demande de navigation — un verbe de
    déplacement facultatif, puis le nom de la vue, et rien d'autre.
  */
  (t) => (vue(t, "guide|mode d'emploi|manuel|documentation|notice|tutoriel") ? { type: 'view', view: 'guide' } : null),
  (t) => (vue(t, 'inventaire|parc') ? { type: 'view', view: 'inventory' } : null),
  (t) => (vue(t, 'baies?|racks?|salle serveur|salle machine|salle des machines') ? { type: 'view', view: 'racks' } : null),
  (t) => (vue(t, 'decouverte|scan reseau|scan du reseau|releve') ? { type: 'view', view: 'discovery' } : null),
  (t) => (vue(t, 'matrice de flux|matrice des flux|matrice|flux|flux reseau') ? { type: 'view', view: 'flows' } : null),
  (t) =>
    vue(t, 'dossier|dossier technique|controle qualite|completude|comparaison')
      ? { type: 'view', view: 'dossier' }
      : null,
  (t) => (vue(t, 'schema|cartographie|carte|plan|dessin') ? { type: 'view', view: 'diagram' } : null),
  (t) => {
    const match = t.match(/^(?:replie|replier|ferme|fermer)\s+(?:la zone|le site|la grappe|le groupe)?\s*(.*)$/)
    return match ? { type: 'collapse', label: cleanName(match[1]) || undefined } : null
  },
  (t) => (/(deplie|deplier|tout ouvrir|tout deplier|ouvre tout)/.test(t) ? { type: 'expand' } : null),
  (t) => (/^(?:zoom avant|agrandi[sr]?|rapproche|avance)$/.test(t) ? { type: 'zoom', direction: 'in' } : null),
  (t) => (/^(?:zoom arriere|dezoomer?|eloigne|recule)$/.test(t) ? { type: 'zoom', direction: 'out' } : null),

  // ── Projet ─────────────────────────────────────────────────────────────────
  (t) => (/(export|exporte|exporter|enregistre|telecharge).*(png|image)/.test(t) ? { type: 'export', format: 'png' } : null),
  (t) => (/(export|exporte|exporter|enregistre|telecharge).*(svg|vectoriel)/.test(t) ? { type: 'export', format: 'svg' } : null),
  (t) => (/(enregistre le projet|sauvegarde le projet|enregistre le schema)/.test(t) ? { type: 'project', action: 'save' } : null),
  (t) => (/(nouveau schema|vide le schema|repars de zero)/.test(t) ? { type: 'project', action: 'new' } : null),
  (t) => (/(charge l'exemple|schema d'exemple|montre l'exemple)/.test(t) ? { type: 'project', action: 'sample' } : null),
  (t, raw) => {
    const match = t.match(/^(?:titre|renomme le schema|appelle le schema)\s*(?::|en)?\s*(.+)$/)
    if (!match) return null
    return {
      type: 'title',
      title: rawValue(raw, /(?:titre|renomme le schema|appelle le schema)\s*(?::|en)?\s*(.+)$/i, 1, match[1].trim()),
    }
  },
  (t) => (/(import rapide|importer une liste|coller une liste)/.test(t) ? { type: 'import' } : null),

  // ── Recherche ──────────────────────────────────────────────────────────────
  (t) => {
    const match = t.match(
      /^(?:va a|aller a|va sur|montre|montrer|affiche|selectionne|selectionner|trouve|trouver|cherche|chercher|ou est)\s+(?:moi\s+)?(.+)$/,
    )
    return match ? { type: 'focus', name: cleanName(match[1]) } : null
  },
]

/**
 * Transforme une phrase en intention. Renvoie `null` si rien ne correspond — la commande
 * est alors signalée à l'utilisateur plutôt que d'être exécutée au hasard.
 */
export function interpret(transcript: string): VoiceIntent | null {
  // La langue parlée d'abord : hésitations, politesse, verbe à l'impératif, mots mal
  // entendus. Tout ce qui suit travaille sur une phrase propre.
  const nettoye = nettoyerPhrase(transcript)
  if (!nettoye) return null

  // Plusieurs équipements d'une phrase : l'assistant de conception s'en charge. Le contrôle
  // se fait avant la normalisation, qui effacerait les virgules dont il a besoin.
  const construction = detecterConstruction(nettoye)
  if (construction) return construction

  // Nombres dictés en chiffres, séparateurs parlés en symboles, sigles recollés : le texte
  // préparé sert de référence pour les deux versions (normalisée et d'origine), ce qui
  // garde leur alignement caractère par caractère.
  const prepared = prepareSpeech(resoudrePronoms(nettoye))
  const normalized = normalizeSpeech(prepared)
  const text = stripPrefix(normalized)
  if (!text) return null

  // Le texte d'origine subit les mêmes découpages d'espaces, puis on retire exactement
  // autant de caractères en tête : les deux chaînes restent alignées, index par index.
  const collapsed = prepared
    .replace(/[?!,;]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  const raw = collapsed.slice(normalized.length - text.length)

  for (const rule of RULES) {
    const intent = rule(text, raw)
    if (intent) return intent
  }
  return null
}

/**
 * La reconnaissance vocale propose plusieurs transcriptions d'une même phrase. Plutôt que
 * de s'arrêter à la première, on retient la première qui donne une commande comprise : une
 * hésitation sur un mot ne fait plus échouer la phrase entière.
 */
export function interpretBest(alternatives: string[]): { transcript: string; intent: VoiceIntent | null } {
  for (const alternative of alternatives) {
    if (!alternative.trim()) continue
    const intent = interpret(alternative)
    if (intent) return { transcript: alternative, intent }
  }
  return { transcript: alternatives.find((item) => item.trim()) ?? '', intent: null }
}

/**
 * Commandes les plus proches d'une phrase incomprise, pour proposer une correction plutôt
 * que de laisser l'utilisateur deviner.
 */
export function suggestCommands(transcript: string, limit = 3): string[] {
  const words = new Set(
    normalizeSpeech(transcript)
      .split(' ')
      .filter((word) => word.length > 2),
  )
  if (words.size === 0) return []
  return VOICE_EXAMPLES.map((example) => {
    const exampleWords = normalizeSpeech(example).split(' ')
    const shared = exampleWords.filter((word) => words.has(word)).length
    return { example, score: shared / Math.max(1, exampleWords.length) }
  })
    .filter((entry) => entry.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.example)
}

/** Exemples affichés dans le panneau : ce sont de vraies commandes reconnues. */
/**
 * Intentions qui modifient le schéma.
 *
 * Sert au mode verrouillé : lire, naviguer, exporter et interroger restent permis ; tout ce
 * qui touche au document est refusé avec une explication, plutôt que d'échouer en silence.
 */
const EDITING_INTENTS = new Set<VoiceIntent['type']>([
  'add',
  'setKind',
  'move',
  'linkEdit',
  'linkDelete',
  'setField',
  'setRole',
  'setStatus',
  'setPinned',
  'zorder',
  'linkAttach',
  'duplicate',
  'duplicateSeries',
  'delete',
  'link',
  'route',
  'rackAssign',
  'rackDetach',
  'vlanAdd',
  'pattern',
  'title',
  'layout',
  'direction',
  'undo',
  'redo',
  'groupRename',
  'annotate',
  // Les nouvelles commandes qui modifient le document passent par le même verrou.
  // « masque les agrégats » et « L3 strict » n'y sont pas : ils ne changent que l'affichage.
  'deduireHa',
  'deduireVlans',
  'align',
  'distribute',
  'clusterColor',
  'vlanRemove',
  'rackAdd',
  'rackRemove',
  'lagRename',
  'titleBlock',
  // Ce que la voix sait désormais écrire d'autre.
  'build',
  'note',
  'dictation',
  'annotationRemove',
  'flow',
  // Les commandes de page ne sont pas gardées ici : un verrou porte sur une page, il ne doit
  // pas empêcher d'en créer une autre ni d'aller la voir. Le magasin refuse de lui seul de
  // renommer ou de supprimer une page verrouillée.
])

export function isEditingIntent(intent: VoiceIntent): boolean {
  return EDITING_INTENTS.has(intent.type)
}

export const VOICE_EXAMPLE_GROUPS: { title: string; examples: string[] }[] = [
  {
    title: 'Pages',
    examples: [
      'Ajoute une page Agence Lyon',
      'Va à la page 2',
      'Page suivante',
      'Renomme la page en Vue physique',
      'Renomme la zone DMZ en Périmètre',
      'Renomme la couche Accès en Étage 2',
      'Duplique la page',
      'Verrouille le schéma',
    ],
  },
  {
    title: 'Construire',
    examples: [
      'Ouvre l’assistant de conception',
      'Ajoute un pare-feu',
      'Ajoute un switch cœur SW-CORE-03 dans la zone Datacenter',
      'Ajoute un serveur SRV-APP-01 avec IP 10.10.0.60 relié à SW-CORE-01',
      'Relie SW-CORE-01 à FW-01 en fibre',
      'Change le type de SRV-APP-01 en nœud hyperviseur',
      'Supprime la liaison entre SW-CORE-01 et FW-01',
      'Liaison entre SW-CORE-01 et SW-DIST-BATA en fibre 10 Gb/s',
      'Insère le modèle pare-feu actif passif',
      'Affiche les agrégats',
      'Plan VLAN',
      'Domaines de diffusion',
      'Projecteur sur le VLAN 20',
      'Tous les VLAN',
      'Duplique',
      'Duplique quatre fois',
      'Duplique la sélection en série',
      'Mets la sélection dans le presse-papiers',
      'Colle',
      'Supprime SW-ACC-B1',
    ],
  },
  {
    title: 'Annoter et documenter',
    examples: [
      'Ajoute une note Migration prévue au troisième trimestre',
      'Encadre Lot 2 bâtiment B',
      'Ajoute une flèche',
      'Affiche la légende',
      'Ouvre la matrice de flux',
      'Ouvre le dossier',
    ],
  },
  {
    title: 'Renseigner',
    examples: [
      'Renomme SW-CORE-01 en SW-CORE-A',
      "Mets l'IP 10.10.0.11 sur SW-CORE-01",
      'La zone de FW-01 est DMZ',
      'FW-02 est passif',
      'Marque ESXi-03 en maintenance',
      'Déplace FW-01 vers la droite',
      'Sélectionne tous les switches accès',
      'Mets tous les postes de travail dans la zone Bâtiment A',
      'Crée le VLAN 60 nom Vidéo sous-réseau 10.10.60.0/24',
    ],
  },
  {
    title: 'Lire le schéma',
    examples: [
      'Placement automatique',
      'Vue couche 2',
      'Synthèse',
      'Replie la zone Datacenter',
      'Déplie tout',
      'De gauche à droite',
      'Tracé courbe',
      'Réinitialise le tracé',
      'Accroches automatiques',
      'Verrouille le schéma',
      'Déverrouille les étiquettes',
      'Mode présentation',
      'Vue technique',
      'Masque les croisements',
      'Masque les VLAN',
      'Affiche les adresses IP',
      'Masque les débits',
      'Mets FW-01 au premier plan',
      'Place SW-ACC-A1 en arrière-plan',
      'Masque la grille',
      'Va à SAN Siège',
    ],
  },
  {
    title: 'Parc et baies',
    examples: [
      'crée la baie A3 de 42 U',
      'supprime la baie PRA',
      "Ouvre l'inventaire",
      'Montre les baies',
      'Implante SW-DIST-BATA dans la baie A1',
      'Retire PDU B de la baie',
      'Mets le modèle PowerEdge R760 sur ESXi-01',
      'Mets la hauteur 2 sur ESXi-01',
    ],
  },
  {
    title: 'Laisser l’application déduire',
    examples: [
      'déduis les mécanismes de haute disponibilité',
      'déduis les VLAN du schéma',
    ],
  },
  {
    title: 'Ranger la sélection',
    examples: [
      'aligne à gauche',
      'aligne au centre',
      'répartis horizontalement',
    ],
  },
  {
    title: 'Grappes, agrégats, cartouche',
    examples: [
      'mets la grappe FW-HA en bleu',
      'renomme l’agrégat en Po23',
      'masque les agrégats',
      'supprime le VLAN 40',
      'indice B',
      'établi par Dupont',
      'active le mode L3 strict',
    ],
  },
  {
    title: 'Questions',
    examples: [
      "Combien d'équipements ?",
      'Combien de pare-feu ?',
      'Quel est le score de haute disponibilité ?',
      'Y a-t-il des points de défaillance ?',
      'Quelle est la consommation ?',
      'Combien de U libres dans la baie A1 ?',
    ],
  },
  {
    title: 'Projet',
    examples: ['Exporte en PNG', 'Enregistre le projet', 'Annule', 'Rétablis', 'Titre : Architecture agence'],
  },
]

/** Liste à plat, pour les aides compactes. */
export const VOICE_EXAMPLES = VOICE_EXAMPLE_GROUPS.flatMap((group) => group.examples)

// ─── Reconnaissance vocale du navigateur ─────────────────────────────────────

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean; length: number }>
      }) => void)
    | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type RecognitionConstructor = new () => SpeechRecognitionLike

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const candidate =
    (window as unknown as { SpeechRecognition?: RecognitionConstructor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition
  return candidate ?? null
}

export function isSpeechSupported(): boolean {
  return recognitionConstructor() !== null
}

export interface Recognizer {
  start: () => void
  stop: () => void
}

/**
 * Enveloppe la reconnaissance du navigateur (Chrome, Edge). Les phrases intermédiaires
 * servent à l'affichage ; seules les phrases finales déclenchent une action.
 */
export function createRecognizer(handlers: {
  /** `alternatives` contient les transcriptions proposées, de la plus probable à la moins. */
  onTranscript: (alternatives: string[], isFinal: boolean) => void
  onError: (message: string) => void
  onEnd: () => void
  lang?: string
}): Recognizer | null {
  const Recognition = recognitionConstructor()
  if (!Recognition) return null

  const recognition = new Recognition()
  recognition.lang = handlers.lang ?? 'fr-FR'
  recognition.continuous = true
  recognition.interimResults = true
  // Plusieurs transcriptions par phrase : l'interprétation choisit celle qu'elle comprend.
  recognition.maxAlternatives = 5

  let wanted = false

  recognition.onresult = (event) => {
    const results = event.results
    const last = results[results.length - 1]
    if (!last) return
    const alternatives: string[] = []
    for (let i = 0; i < (last.length ?? 1); i += 1) {
      const transcript = last[i]?.transcript
      if (transcript) alternatives.push(transcript)
    }
    if (alternatives.length === 0) return
    handlers.onTranscript(alternatives, last.isFinal === true)
  }

  recognition.onerror = (event) => {
    const messages: Record<string, string> = {
      'not-allowed': 'Micro refusé : autorisez l’accès dans le navigateur.',
      'service-not-allowed': 'Service de reconnaissance indisponible.',
      network: 'Reconnaissance vocale injoignable (connexion réseau requise).',
      'no-speech': '',
      aborted: '',
    }
    const message = messages[event.error] ?? `Erreur de reconnaissance : ${event.error}`
    if (message) {
      wanted = false
      handlers.onError(message)
    }
  }

  // Le navigateur arrête l'écoute après un silence : on la relance tant que l'utilisateur
  // n'a pas coupé le micro, sinon une commande sur deux tombe dans le vide.
  recognition.onend = () => {
    if (!wanted) {
      handlers.onEnd()
      return
    }
    try {
      recognition.start()
    } catch {
      wanted = false
      handlers.onEnd()
    }
  }

  return {
    start: () => {
      wanted = true
      recognition.start()
    },
    stop: () => {
      wanted = false
      recognition.stop()
    },
  }
}

/** Réponse parlée, quand l'utilisateur l'a demandée. */
export function speak(message: string, enabled: boolean) {
  if (!enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const utterance = new SpeechSynthesisUtterance(message)
  utterance.lang = 'fr-FR'
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}
