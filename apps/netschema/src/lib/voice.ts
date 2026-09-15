import { searchDevices } from './catalog'
import type {
  AppView,
  AssetStatus,
  DetailLevel,
  HaRole,
  LayoutDirection,
  LinkKind,
  LinkShape,
  LinkStyle,
  OsiView,
} from '../types'

/**
 * Commandes vocales.
 *
 * L'interprétation est volontairement séparée de la reconnaissance : `interpret()` est une
 * fonction pure qui transforme une phrase en intention. Elle sert aussi bien à la dictée
 * qu'au champ de saisie du panneau — et c'est ce qui la rend testable sans microphone.
 */
export type VoiceIntent =
  // Édition
  | { type: 'add'; kind: string; label: string }
  | { type: 'link'; from: string; to: string; linkKind?: LinkKind }
  | { type: 'rename'; target: string; name: string }
  | { type: 'setField'; target: string; field: 'ip' | 'vlan' | 'zone' | 'site' | 'cluster' | 'owner' | 'serial' | 'model' | 'vip'; value: string }
  | { type: 'setRole'; target: string; role: HaRole }
  | { type: 'setStatus'; target: string; status: AssetStatus }
  | { type: 'setPinned'; target?: string; pinned: boolean }
  | { type: 'duplicate' }
  | { type: 'delete'; target?: string }
  | { type: 'selectAll' }
  | { type: 'clearSelection' }
  | { type: 'connect' }
  | { type: 'pattern'; query: string }
  // Navigation et lecture
  | { type: 'focus'; name: string }
  | { type: 'layout' }
  | { type: 'fit' }
  | { type: 'zoom'; direction: 'in' | 'out' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'osi'; layer: OsiView }
  | { type: 'detail'; level: DetailLevel }
  | { type: 'view'; view: AppView }
  | { type: 'collapse'; label?: string }
  | { type: 'expand' }
  | { type: 'direction'; direction: LayoutDirection }
  | { type: 'linkStyle'; style: LinkStyle }
  | { type: 'route'; shape: LinkShape }
  | { type: 'toggle'; key: ToggleKey; value: boolean }
  // Projet
  | { type: 'export'; format: 'svg' | 'png' }
  | { type: 'project'; action: 'new' | 'sample' | 'save' }
  | { type: 'title'; title: string }
  | { type: 'import' }
  // Inventaire et baies
  | { type: 'rackAssign'; target: string; rack: string }
  | { type: 'rackDetach'; target: string }
  | { type: 'vlanAdd'; id: string; name?: string; subnet?: string }
  // Questions
  | { type: 'query'; question: QueryKind; argument?: string }
  | { type: 'help' }

export type ToggleKey =
  | 'showGrid'
  | 'showZones'
  | 'showSites'
  | 'showClusters'
  | 'showDetails'
  | 'showLayerLabels'
  | 'showAudit'
  | 'snap'

export type QueryKind = 'count' | 'countKind' | 'ha' | 'spof' | 'power' | 'freeUnits' | 'vlans' | 'racks'

export function normalizeSpeech(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[?!.,]/g, ' ')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
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

const LINK_WORDS: Record<string, LinkKind> = {
  cuivre: 'ethernet',
  ethernet: 'ethernet',
  fibre: 'fiber',
  optique: 'fiber',
  trunk: 'trunk',
  lacp: 'trunk',
  agregat: 'trunk',
  stack: 'stack',
  mlag: 'stack',
  wan: 'wan',
  mpls: 'wan',
  vpn: 'vpn',
  tunnel: 'vpn',
  wifi: 'wireless',
  'sans fil': 'wireless',
  overlay: 'overlay',
  vxlan: 'overlay',
  heartbeat: 'heartbeat',
  'battement de coeur': 'heartbeat',
  replication: 'replication',
  electrique: 'power',
  alimentation: 'power',
}

const TOGGLE_WORDS: { pattern: RegExp; key: ToggleKey }[] = [
  { pattern: /grille/, key: 'showGrid' },
  { pattern: /zones?/, key: 'showZones' },
  { pattern: /sites?/, key: 'showSites' },
  { pattern: /grappes?|clusters?/, key: 'showClusters' },
  { pattern: /details?|ip|adresses|debits/, key: 'showDetails' },
  { pattern: /couches?|libelles/, key: 'showLayerLabels' },
  { pattern: /alertes?|points critiques|defaillances?/, key: 'showAudit' },
  { pattern: /aimant|magnet|grille magnetique/, key: 'snap' },
]

/** Nettoie un nom dicté : « le switch cœur un » reste tel quel, la ponctuation part. */
function cleanName(value: string): string {
  return value
    .replace(/^(le|la|les|l'|du|de la|des|un|une)\s+/i, '')
    .replace(/\s+(s'?il te plait|merci)$/i, '')
    .trim()
}

type Rule = (text: string, raw: string) => VoiceIntent | null | undefined

/**
 * Récupère une valeur avec sa casse d'origine.
 *
 * Les règles travaillent sur le texte normalisé (sans accents ni majuscules) ; pour tout ce
 * qui sera écrit dans la fiche — un nom, un titre, une adresse — on relit la phrase brute
 * avec le même motif, insensible à la casse. Les mots-clés du motif sont sans accent, ils
 * correspondent donc des deux côtés.
 */
function rawValue(raw: string, pattern: RegExp, group: number, fallback: string): string {
  const match = raw.match(pattern)
  const value = match?.[group]?.trim()
  return value ? cleanName(value) : fallback
}

/**
 * Règles d'interprétation, dans l'ordre : les tournures les plus spécifiques d'abord,
 * pour qu'« ajoute FW-01 à la grappe FW-HA » ne soit pas lu comme « ajoute un équipement ».
 */
const RULES: Rule[] = [
  // ── Questions ──────────────────────────────────────────────────────────────
  (t) => (/^(aide|aidez moi|commandes|que sais tu faire|que peux tu faire)$/.test(t) ? { type: 'help' } : null),
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
      /^(?:mets|met|mettre|affecte|attribue|donne)\s+(?:l'|la |le )?(ip|adresse ip|adresse|vlan|zone|site|grappe|cluster|responsable|numero de serie|serie|modele|vip)\s+(.+?)\s+(?:a|au|sur|pour)\s+(.+)$/,
    )
    const reverse = t.match(
      /^(?:l'|la |le )?(ip|adresse ip|adresse|vlan|zone|site|grappe|cluster|responsable|numero de serie|serie|modele|vip)\s+(?:de |du |d')(.+?)\s+(?:est|c'est|:)\s+(.+)$/,
    )
    const match = direct ?? reverse
    if (!match) return null
    const fields: Record<string, 'ip' | 'vlan' | 'zone' | 'site' | 'cluster' | 'owner' | 'serial' | 'model' | 'vip'> = {
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
      vip: 'vip',
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
  (t) => {
    const match = t.match(/^(?:fige|figer|epingle|verrouille)\s*(?:la position (?:de |du |d')?)?(.*)$/)
    return match ? { type: 'setPinned', target: cleanName(match[1]) || undefined, pinned: true } : null
  },
  (t) => {
    const match = t.match(/^(?:libere|liberer|defige|deverrouille)\s*(?:la position (?:de |du |d')?)?(.*)$/)
    return match ? { type: 'setPinned', target: cleanName(match[1]) || undefined, pinned: false } : null
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
  (t) => {
    const match = t.match(/^(?:ajoute|ajouter|cree|creer|nouveau|nouvelle|pose|poser|insere|inserer)\s+(?:un|une|le|la|les|des|l')?\s*(.+)$/)
    if (!match) return null
    const wanted = match[1].trim()
    const device = searchDevices(wanted)[0]
    return device ? { type: 'add', kind: device.id, label: device.label } : null
  },
  (t) => (/^(duplique|dupliquer|copie|copier)(\s+.*)?$/.test(t) ? { type: 'duplicate' } : null),
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
  (t) => (/(annule|annuler|retour arriere)/.test(t) ? { type: 'undo' } : null),
  (t) => (/(retabli|retablir|refaire|refais)/.test(t) ? { type: 'redo' } : null),
  (t) => (/(toutes les couches|toutes couches)/.test(t) ? { type: 'osi', layer: 'all' } : null),
  (t) => {
    const match = t.match(/(?:couche|niveau|vue)\s+(?:osi\s+)?(1|2|3|un|deux|trois|physique|liaison|reseau)/)
    return match ? { type: 'osi', layer: LAYER_WORDS[match[1]] } : null
  },
  (t) => (/(synthese|vue resumee|resume)/.test(t) ? { type: 'detail', level: 'summary' } : null),
  (t) => (/(sans les postes|masque les postes|cache les postes)/.test(t) ? { type: 'detail', level: 'no-endpoints' } : null),
  (t) => (/(detail complet|tout le detail|montre tout)/.test(t) ? { type: 'detail', level: 'full' } : null),
  (t) => (/(inventaire|parc)/.test(t) ? { type: 'view', view: 'inventory' } : null),
  (t) => (/(baies?|racks?|salle serveur|salle machine)/.test(t) ? { type: 'view', view: 'racks' } : null),
  (t) => (/(decouverte|scan reseau|releve)/.test(t) ? { type: 'view', view: 'discovery' } : null),
  (t) => (/(schema|cartographie|carte|plan)$/.test(t) ? { type: 'view', view: 'diagram' } : null),
  (t) => {
    const match = t.match(/^(?:replie|replier|ferme|fermer)\s+(?:la zone|le site|la grappe|le groupe)?\s*(.*)$/)
    return match ? { type: 'collapse', label: cleanName(match[1]) || undefined } : null
  },
  (t) => (/(deplie|deplier|tout ouvrir|tout deplier|ouvre tout)/.test(t) ? { type: 'expand' } : null),
  (t) => (/(zoom avant|agrandi|agrandir|rapproche)/.test(t) ? { type: 'zoom', direction: 'in' } : null),
  (t) => (/(zoom arriere|dezoome|dezoomer|eloigne|recule)/.test(t) ? { type: 'zoom', direction: 'out' } : null),

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
  const text = stripPrefix(normalizeSpeech(transcript))
  if (!text) return null
  const raw = stripPrefix(transcript.replace(/\s+/g, ' ').trim())
  for (const rule of RULES) {
    const intent = rule(text, raw)
    if (intent) return intent
  }
  return null
}

/** Exemples affichés dans le panneau : ce sont de vraies commandes reconnues. */
export const VOICE_EXAMPLE_GROUPS: { title: string; examples: string[] }[] = [
  {
    title: 'Construire',
    examples: [
      'Ajoute un pare-feu',
      'Ajoute un cluster Kubernetes',
      'Relie SW-CORE-01 à FW-01 en fibre',
      'Insère le modèle pare-feu actif passif',
      'Duplique',
      'Supprime SW-ACC-B1',
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
      'Masque la grille',
      'Va à SAN Siège',
    ],
  },
  {
    title: 'Parc et baies',
    examples: [
      "Ouvre l'inventaire",
      'Montre les baies',
      'Implante SW-DIST-BATA dans la baie A1',
      'Retire PDU B de la baie',
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
  start(): void
  stop(): void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
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
  onTranscript: (transcript: string, isFinal: boolean) => void
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

  recognition.onresult = (event) => {
    const results = event.results
    const last = results[results.length - 1]
    if (!last) return
    const transcript = last[0]?.transcript ?? ''
    handlers.onTranscript(transcript, last.isFinal === true)
  }
  recognition.onerror = (event) => {
    const messages: Record<string, string> = {
      'not-allowed': 'Micro refusé : autorisez l’accès dans le navigateur.',
      'service-not-allowed': 'Service de reconnaissance indisponible.',
      'no-speech': 'Rien n’a été entendu.',
      network: 'Reconnaissance vocale injoignable (connexion réseau requise).',
      aborted: '',
    }
    const message = messages[event.error] ?? `Erreur de reconnaissance : ${event.error}`
    if (message) handlers.onError(message)
  }
  recognition.onend = handlers.onEnd

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
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
