import { searchDevices } from './catalog'
import type { AppView, DetailLevel, OsiView } from '../types'

/**
 * Commandes vocales.
 *
 * L'interprétation est volontairement séparée de la reconnaissance : `interpret()` est une
 * fonction pure qui transforme une phrase en intention. Elle sert aussi bien à la dictée
 * qu'au champ de saisie du panneau — et c'est ce qui la rend testable sans microphone.
 */
export type VoiceIntent =
  | { type: 'add'; kind: string; label: string }
  | { type: 'link'; from: string; to: string }
  | { type: 'focus'; name: string }
  | { type: 'layout' }
  | { type: 'fit' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'delete' }
  | { type: 'connect' }
  | { type: 'osi'; layer: OsiView }
  | { type: 'detail'; level: DetailLevel }
  | { type: 'view'; view: AppView }
  | { type: 'collapse'; label?: string }
  | { type: 'expand' }
  | { type: 'export'; format: 'svg' | 'png' }
  | { type: 'zoom'; direction: 'in' | 'out' }
  | { type: 'import' }
  | { type: 'help' }

export function normalizeSpeech(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[?!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Retire les tournures de politesse et les mots outils en tête de phrase. */
function stripPrefix(value: string): string {
  return value
    .replace(/^(s'?il te plait|s'?il vous plait|peux[- ]tu|pourrais[- ]tu|je veux|je voudrais|merci de)\s+/i, '')
    .replace(/^(bien vouloir|de)\s+/i, '')
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

/**
 * Transforme une phrase en intention. Renvoie `null` si rien ne correspond — la commande
 * est alors signalée à l'utilisateur plutôt que d'être exécutée au hasard.
 */
export function interpret(transcript: string): VoiceIntent | null {
  const text = stripPrefix(normalizeSpeech(transcript))
  if (!text) return null

  if (/^(aide|aidez moi|commandes|que sais tu faire|que peux tu faire)$/.test(text)) return { type: 'help' }

  // Relier deux équipements : à vérifier avant le simple « relier ».
  const link = text.match(/^(?:relie|relier|connecte|connecter|raccorde|raccorder|branche|brancher)\s+(.+?)\s+(?:a|au|aux|avec|vers|et)\s+(.+)$/)
  if (link) return { type: 'link', from: link[1].trim(), to: link[2].trim() }

  if (/^(mode\s+)?(relier|connexion|liaison)$/.test(text)) return { type: 'connect' }

  const add = text.match(/^(?:ajoute|ajouter|cree|creer|nouveau|nouvelle|pose|poser|insere|inserer)\s+(?:un|une|le|la|les|l\s|des)?\s*(.+)$/)
  if (add) {
    const wanted = add[1].trim()
    const device = searchDevices(wanted)[0]
    if (device) return { type: 'add', kind: device.id, label: device.label }
    return null
  }

  if (/(placement automatique|place automatiquement|placement auto|range le schema|organise le schema|replace tout)/.test(text)) {
    return { type: 'layout' }
  }
  if (/(ajuste|ajuster|recentre|recentrer|vue d'?ensemble|cadre le schema|tout voir)/.test(text)) return { type: 'fit' }
  if (/(annule|annuler|retour arriere)/.test(text)) return { type: 'undo' }
  if (/(retabli|retablir|refaire|refais)/.test(text)) return { type: 'redo' }
  if (/(supprime|supprimer|efface|effacer|enleve|enlever) (la )?(selection|ca|cela)?$/.test(text)) return { type: 'delete' }

  if (/(toutes les couches|toutes couches)/.test(text)) return { type: 'osi', layer: 'all' }
  const layer = text.match(/(?:couche|niveau|vue)\s+(?:osi\s+)?(1|2|3|un|deux|trois|physique|liaison|reseau)/)
  if (layer) return { type: 'osi', layer: LAYER_WORDS[layer[1]] }

  if (/(synthese|vue resumee|resume)/.test(text)) return { type: 'detail', level: 'summary' }
  if (/(sans les postes|masque les postes|cache les postes)/.test(text)) return { type: 'detail', level: 'no-endpoints' }
  if (/(detail complet|tout le detail|montre tout)/.test(text)) return { type: 'detail', level: 'full' }

  if (/(inventaire|parc)/.test(text)) return { type: 'view', view: 'inventory' }
  if (/(baie|baies|rack|salle serveur|salle machine)/.test(text)) return { type: 'view', view: 'racks' }
  if (/(decouverte|scan reseau|releve)/.test(text)) return { type: 'view', view: 'discovery' }
  if (/(schema|cartographie|carte|plan)$/.test(text)) return { type: 'view', view: 'diagram' }

  const collapse = text.match(/^(?:replie|replier|ferme|fermer|masque|masquer)\s+(?:la zone|le site|la grappe|le groupe)?\s*(.*)$/)
  if (collapse) return { type: 'collapse', label: collapse[1].trim() || undefined }
  if (/(deplie|deplier|tout ouvrir|tout deplier|ouvre tout)/.test(text)) return { type: 'expand' }

  if (/(export|exporte|exporter|enregistre|telecharge).*(png|image)/.test(text)) return { type: 'export', format: 'png' }
  if (/(export|exporte|exporter|enregistre|telecharge).*(svg|vectoriel)/.test(text)) return { type: 'export', format: 'svg' }

  if (/(zoom avant|agrandi|agrandir|rapproche)/.test(text)) return { type: 'zoom', direction: 'in' }
  if (/(zoom arriere|dezoome|dezoomer|eloigne|recule)/.test(text)) return { type: 'zoom', direction: 'out' }

  if (/(import rapide|importer une liste|coller une liste)/.test(text)) return { type: 'import' }

  const focus = text.match(/^(?:va a|aller a|va sur|montre|montrer|affiche|selectionne|selectionner|trouve|trouver|cherche|chercher|ou est)\s+(?:moi\s+)?(?:le|la|les|l\s)?\s*(.+)$/)
  if (focus) return { type: 'focus', name: focus[1].trim() }

  return null
}

/** Exemples affichés dans le panneau : ce sont de vraies commandes reconnues. */
export const VOICE_EXAMPLES = [
  'Ajoute un pare-feu',
  'Ajoute un cluster Kubernetes',
  'Relie SW-CORE-01 à FW-01',
  'Placement automatique',
  'Vue couche 2',
  'Replie la zone Datacenter',
  'Va à SAN Siège',
  'Ouvre l’inventaire',
  'Montre les baies',
  'Exporte en PNG',
  'Annule',
]

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
