import { useEffect, useRef, useState } from 'react'
import { DICTEE_LOCALE_WINDOWS, diagnostiquerMicro, type DiagnosticMicro } from '../lib/micro'
import { Btn } from './ui'
import {
  choisirTranscription,
  createRecognizer,
  isSpeechSupported,
  phrasesPossibles,
  speak,
  suggestCommands,
  VOICE_EXAMPLE_GROUPS,
  type Recognizer,
} from '../lib/voice'
import { useDiagram } from '../store/useDiagram'

interface Entry {
  id: number
  transcript: string
  message: string
  ok: boolean
  /** Commandes proches proposées quand la phrase n'a pas été comprise. */
  suggestions?: string[]
}

/** Silence après lequel une phrase est tenue pour finie. */
const SILENCE_COMMANDE = 900
/** En dictée on réfléchit entre deux phrases : le silence toléré est plus long. */
const SILENCE_DICTEE = 1600

/**
 * Commande vocale : on dicte l'action, l'application l'exécute et répond.
 *
 * Le même champ accepte les commandes tapées — utile quand le navigateur n'a pas de
 * reconnaissance vocale (Firefox), quand le micro est refusé, ou dans un local bruyant.
 *
 * Le panneau montre toujours où en est la conversation : à l'écoute ou non, en dictée sur
 * quel équipement, en attente d'une confirmation. Celui qui parle ne devrait jamais avoir
 * à deviner ce que l'application fera de sa prochaine phrase.
 */
export function VoicePanel() {
  const open = useDiagram((s) => s.voiceOpen)
  const setVoiceOpen = useDiagram((s) => s.setVoiceOpen)
  const setAppView = useDiagram((s) => s.setAppView)
  const run = useDiagram((s) => s.runVoiceCommand)
  const dictee = useDiagram((s) => s.dicteeVocale)
  const attente = useDiagram((s) => s.attenteVocale)
  const demandeEcoute = useDiagram((s) => s.demandeEcoute)
  const paletteOuverte = useDiagram((s) => s.paletteOpen)

  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [typed, setTyped] = useState('')
  const [reply, setReply] = useState(true)
  const [history, setHistory] = useState<Entry[]>([])
  const [error, setError] = useState<string | null>(null)
  const recognizerRef = useRef<Recognizer | null>(null)
  const replyRef = useRef(reply)
  replyRef.current = reply
  const listeningRef = useRef(listening)
  listeningRef.current = listening

  /** Segments finaux reçus depuis le dernier silence, avec leurs variantes. */
  const segmentsRef = useRef<string[][]>([])
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const supported = isSpeechSupported()
  const champRef = useRef<HTMLInputElement>(null)
  const [diagnostic, setDiagnostic] = useState<DiagnosticMicro | null>(null)

  /*
    Le diagnostic est établi à l'ouverture, pas au premier échec : savoir avant de parler
    qu'il faudra du HTTPS vaut mieux que de le découvrir après trois tentatives muettes.
    Et le champ de commande prend le curseur, pour que la dictée de Windows ait où écrire.
  */
  useEffect(() => {
    if (!open) return
    let vivant = true
    void diagnostiquerMicro().then((resultat) => {
      if (vivant) setDiagnostic(resultat)
    })
    champRef.current?.focus()
    return () => {
      vivant = false
    }
  }, [open])

  const record = (transcript: string, result: { ok: boolean; message: string }) => {
    setHistory((current) =>
      [
        {
          id: Date.now() + Math.random(),
          transcript,
          ...result,
          suggestions: result.ok ? undefined : suggestCommands(transcript),
        },
        ...current,
      ].slice(0, 12),
    )
    speak(result.message, replyRef.current)
  }

  const execute = (transcript: string) => {
    const trimmed = transcript.trim()
    if (!trimmed) return
    record(trimmed, run(trimmed))
  }

  /**
   * Exécute la phrase accumulée. Chaque segment apporte ses variantes de transcription :
   * on essaie leurs combinaisons, les plus probables d'abord, et on retient la première
   * dont toutes les commandes sont comprises.
   *
   * En dictée il n'y a rien à comprendre : tout est du texte, et la transcription la plus
   * probable est la bonne — sauf pour l'ordre de fin, qu'une variante peut porter.
   */
  const flushSegments = () => {
    const segments = segmentsRef.current
    segmentsRef.current = []
    if (segments.length === 0) return

    const candidates = phrasesPossibles(segments)
    if (candidates.length === 0) return

    const enDictee = useDiagram.getState().dicteeVocale !== null
    const finDeDictee = candidates.find((candidate) => /^\s*(fin|arr[êe]te|stop|termine)\b.*\bdict/i.test(candidate))
    const transcript = enDictee ? (finDeDictee ?? candidates[0]) : choisirTranscription(candidates)
    if (transcript.trim()) record(transcript.trim(), run(transcript.trim()))
  }

  useEffect(() => {
    if (!open || !supported) return
    const recognizer = createRecognizer({
      onTranscript: (alternatives, isFinal) => {
        if (!isFinal) {
          setInterim(alternatives[0] ?? '')
          return
        }
        setInterim('')
        segmentsRef.current.push(alternatives)
        // La reconnaissance découpe une phrase en plusieurs segments : on attend un court
        // silence avant d'exécuter, sinon une commande se retrouve coupée en deux.
        clearTimeout(flushTimer.current)
        const silence = useDiagram.getState().dicteeVocale !== null ? SILENCE_DICTEE : SILENCE_COMMANDE
        flushTimer.current = setTimeout(flushSegments, silence)
      },
      onError: (message) => {
        setError(message)
        setListening(false)
      },
      onEnd: () => setListening(false),
    })
    recognizerRef.current = recognizer
    return () => {
      clearTimeout(flushTimer.current)
      recognizer?.stop()
      recognizerRef.current = null
      setListening(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supported])

  const toggleListening = () => {
    const recognizer = recognizerRef.current
    if (!recognizer) return
    setError(null)
    if (listeningRef.current) {
      recognizer.stop()
      setListening(false)
    } else {
      try {
        recognizer.start()
        setListening(true)
      } catch {
        setError('La reconnaissance est déjà active.')
      }
    }
  }

  /*
    Le raccourci clavier (F2) incrémente un compteur dans le magasin : y répondre ici évite
    de faire sortir le micro du composant qui le possède. La première valeur est ignorée —
    c'est celle du montage, pas une demande.
  */
  const demandeVue = useRef(demandeEcoute)
  useEffect(() => {
    if (demandeEcoute === demandeVue.current) return
    demandeVue.current = demandeEcoute
    if (!open) return
    if (recognizerRef.current) toggleListening()
    else champRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demandeEcoute, open])

  if (!open) return null

  const submitTyped = () => {
    execute(typed)
    setTyped('')
  }

  const etat = listening
    ? dictee
      ? 'Dictée en cours…'
      : 'À l’écoute…'
    : supported
      ? 'Micro en pause'
      : 'Dictée indisponible sur ce navigateur'

  return (
    <div
      className={`fixed bottom-4 z-50 w-96 max-w-[92vw] overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 ${
        paletteOuverte ? 'left-[260px]' : 'left-4'
      }`}
    >
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <h2 className="text-[13px] font-semibold text-slate-800">Commande vocale</h2>
        <button
          type="button"
          onClick={() => setAppView('guide')}
          className="rounded px-1.5 py-0.5 text-[11px] text-blue-600 hover:bg-blue-50"
          title="Ouvrir le guide d'utilisation"
        >
          Guide
        </button>
        <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600" title="F2 ouvre ce panneau et allume ou coupe le micro, où que soit le curseur.">
          F2 : micro
        </span>
        <button
          type="button"
          onClick={() => setVoiceOpen(false)}
          className="rounded px-1.5 text-[16px] leading-none text-slate-500 hover:bg-slate-100"
          title="Fermer"
        >
          ×
        </button>
      </header>

      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleListening}
            disabled={!supported}
            aria-pressed={listening}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${
              listening ? 'bg-red-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-700'
            }`}
            title={supported ? (listening ? 'Arrêter l’écoute (F2)' : 'Dicter une commande (F2)') : 'Reconnaissance vocale indisponible'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-slate-700">{etat}</p>
            <p className="truncate text-[11px] text-slate-500">
              {interim ||
                (dictee
                  ? 'Tout ce que vous dites est noté.'
                  : supported
                    ? 'Dites par exemple « ajoute un pare-feu ».'
                    : 'Tapez la commande ci-dessous.')}
            </p>
            {listening && !dictee && (
              <p className="text-[10px] text-slate-500">
                Enchaînez : « ajoute un serveur, relie-le au cœur ». La phrase part après une courte pause.
              </p>
            )}
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-slate-500" title="L’application répond à voix haute. Pendant qu’elle parle, elle n’écoute pas.">
            <input
              type="checkbox"
              checked={reply}
              onChange={(event) => setReply(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
            />
            réponse
          </label>
        </div>

        {dictee && (
          <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-2 py-1.5 text-[11.5px] leading-snug text-blue-900">
            <p className="min-w-0 flex-1">
              <b>Dictée sur {dictee}.</b> Les commandes sont suspendues : chaque phrase s’ajoute à la note.
            </p>
            <Btn onClick={() => execute('fin de dictée')}>Fin de dictée</Btn>
          </div>
        )}
        {attente && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11.5px] leading-snug text-amber-900">
            <p className="min-w-0 flex-1">
              <b>Confirmation attendue.</b> Dites « oui » ou « non » ; toute autre commande abandonne.
            </p>
            <Btn variant="danger" onClick={() => execute('oui')}>
              Oui
            </Btn>
            <Btn onClick={() => execute('non')}>Non</Btn>
          </div>
        )}

        {error && <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">{error}</p>}
        {diagnostic && diagnostic.etat !== 'pret' && (
          <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-900">
            <p className="font-medium">{diagnostic.constat}</p>
            {diagnostic.remede && <p className="pt-1 text-amber-800">{diagnostic.remede}</p>}
            <p className="pt-1 text-amber-700">{DICTEE_LOCALE_WINDOWS}</p>
          </div>
        )}
        {diagnostic?.etat === 'pret' && diagnostic.moteur && (
          // L'essentiel reste lisible sans rien ouvrir — l'audio sort du poste — ; le moyen
          // d'y échapper se déplie. Affiché en entier, ce paragraphe masquait le plan.
          <details className="rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] leading-snug text-slate-500">
            <summary className="cursor-pointer">{diagnostic.moteur}</summary>
            <p className="pt-1">{DICTEE_LOCALE_WINDOWS}</p>
          </details>
        )}

        <div className="flex gap-2">
          <input
            ref={champRef}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              submitTyped()
            }}
            placeholder={dictee ? '… ou tapez le texte de la note' : '… ou tapez la commande'}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <Btn variant="primary" onClick={submitTyped} disabled={!typed.trim()}>
            {dictee ? 'Noter' : 'Exécuter'}
          </Btn>
        </div>

        {history.length > 0 && (
          <ul className="max-h-36 overflow-y-auto rounded-lg border border-slate-100" aria-live="polite">
            {history.map((entry) => (
              <li key={entry.id} className="border-b border-slate-50 px-2 py-1.5 last:border-0">
                <p className="text-[11px] text-slate-500">« {entry.transcript} »</p>
                <p className={`text-[12px] ${entry.ok ? 'text-emerald-700' : 'text-red-600'}`}>{entry.message}</p>
                {entry.suggestions && entry.suggestions.length > 0 && (
                  <p className="pt-0.5 text-[11px] text-slate-500">
                    Essayez :{' '}
                    {entry.suggestions.map((suggestion, index) => (
                      <span key={suggestion}>
                        {index > 0 && ' · '}
                        <button
                          type="button"
                          onClick={() => execute(suggestion)}
                          className="text-blue-600 hover:underline"
                        >
                          « {suggestion} »
                        </button>
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <details className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">
            Ce qu’on peut dire ({VOICE_EXAMPLE_GROUPS.reduce((acc, group) => acc + group.examples.length, 0)} exemples)
          </summary>
          <div className="max-h-56 overflow-y-auto pt-1.5">
            {VOICE_EXAMPLE_GROUPS.map((group) => (
              <div key={group.title} className="pb-2">
                <p className="pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {group.title}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {group.examples.map((example) => (
                    <li key={example}>
                      <button
                        type="button"
                        onClick={() => execute(example)}
                        className="text-left hover:text-blue-700 hover:underline"
                      >
                        « {example} »
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  )
}
