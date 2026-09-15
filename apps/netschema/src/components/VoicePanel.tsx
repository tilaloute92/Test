import { useEffect, useRef, useState } from 'react'
import { Btn } from './ui'
import { createRecognizer, isSpeechSupported, speak, VOICE_EXAMPLES, type Recognizer } from '../lib/voice'
import { useDiagram } from '../store/useDiagram'

interface Entry {
  id: number
  transcript: string
  message: string
  ok: boolean
}

/**
 * Commande vocale : on dicte l'action, l'application l'exécute et répond.
 *
 * Le même champ accepte les commandes tapées — utile quand le navigateur n'a pas de
 * reconnaissance vocale (Firefox), quand le micro est refusé, ou dans un local bruyant.
 */
export function VoicePanel() {
  const open = useDiagram((s) => s.voiceOpen)
  const setVoiceOpen = useDiagram((s) => s.setVoiceOpen)
  const run = useDiagram((s) => s.runVoiceCommand)

  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [typed, setTyped] = useState('')
  const [reply, setReply] = useState(true)
  const [history, setHistory] = useState<Entry[]>([])
  const [error, setError] = useState<string | null>(null)
  const recognizerRef = useRef<Recognizer | null>(null)
  const supported = isSpeechSupported()

  const execute = (transcript: string) => {
    const trimmed = transcript.trim()
    if (!trimmed) return
    const result = run(trimmed)
    setHistory((current) => [{ id: Date.now(), transcript: trimmed, ...result }, ...current].slice(0, 12))
    speak(result.message, reply)
  }

  useEffect(() => {
    if (!open || !supported) return
    const recognizer = createRecognizer({
      onTranscript: (transcript, isFinal) => {
        if (isFinal) {
          setInterim('')
          execute(transcript)
        } else setInterim(transcript)
      },
      onError: (message) => {
        setError(message)
        setListening(false)
      },
      onEnd: () => setListening(false),
    })
    recognizerRef.current = recognizer
    return () => {
      recognizer?.stop()
      recognizerRef.current = null
      setListening(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supported, reply])

  if (!open) return null

  const submitTyped = () => {
    execute(typed)
    setTyped('')
  }

  const toggleListening = () => {
    const recognizer = recognizerRef.current
    if (!recognizer) return
    setError(null)
    if (listening) {
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

  return (
    <div className="fixed bottom-4 left-[260px] z-50 w-96 max-w-[92vw] overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200">
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <h2 className="text-[13px] font-semibold text-slate-800">Commande vocale</h2>
        <button
          type="button"
          onClick={() => setVoiceOpen(false)}
          className="ml-auto rounded px-1.5 text-[16px] leading-none text-slate-400 hover:bg-slate-100"
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
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${
              listening ? 'bg-red-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-700'
            }`}
            title={supported ? (listening ? 'Arrêter l’écoute' : 'Dicter une commande') : 'Reconnaissance vocale indisponible'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-slate-700">
              {listening ? 'À l’écoute…' : supported ? 'Micro en pause' : 'Dictée indisponible sur ce navigateur'}
            </p>
            <p className="truncate text-[11px] text-slate-400">
              {interim || (supported ? 'Dites par exemple « ajoute un pare-feu ».' : 'Tapez la commande ci-dessous.')}
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-slate-500">
            <input
              type="checkbox"
              checked={reply}
              onChange={(event) => setReply(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-600"
            />
            réponse
          </label>
        </div>

        {error && <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">{error}</p>}
        {!supported && (
          <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] leading-snug text-slate-500">
            La dictée s’appuie sur la reconnaissance vocale du navigateur (Chrome ou Edge, avec une
            connexion réseau). Les commandes tapées fonctionnent partout.
          </p>
        )}

        <div className="flex gap-2">
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              submitTyped()
            }}
            placeholder="… ou tapez la commande"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          <Btn variant="primary" onClick={submitTyped} disabled={!typed.trim()}>
            Exécuter
          </Btn>
        </div>

        {history.length > 0 && (
          <ul className="max-h-40 overflow-y-auto rounded-lg border border-slate-100">
            {history.map((entry) => (
              <li key={entry.id} className="border-b border-slate-50 px-2 py-1.5 last:border-0">
                <p className="text-[11px] text-slate-400">« {entry.transcript} »</p>
                <p className={`text-[12px] ${entry.ok ? 'text-emerald-700' : 'text-red-600'}`}>{entry.message}</p>
              </li>
            ))}
          </ul>
        )}

        <details className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">Commandes reconnues</summary>
          <ul className="flex flex-col gap-0.5 pt-1.5">
            {VOICE_EXAMPLES.map((example) => (
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
        </details>
      </div>
    </div>
  )
}
