import { useState } from 'react'
import { useSession } from '../store/useSession'

/**
 * Page de connexion.
 *
 * Elle n'apparaît que lorsque l'application est servie par le serveur NetSchema : ouverte en
 * local, l'application n'a personne à qui demander des comptes. Le message d'erreur reste
 * volontairement identique pour un identifiant inconnu et un mot de passe faux — dire lequel
 * des deux est en cause revient à confirmer l'existence d'un compte.
 */
export function LoginView() {
  const signIn = useSession((s) => s.signIn)
  const error = useSession((s) => s.error)
  const setupRequired = useSession((s) => s.setupRequired)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !username.trim() || !password) return
    setBusy(true)
    try {
      await signIn(username.trim(), password)
    } catch {
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-900 p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 pb-6">
          <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-bold tracking-wide text-white">
            NETSCHEMA
          </span>
          <span className="text-[13px] text-slate-400">Schémas d’infrastructure réseau</span>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-white p-6 shadow-2xl">
          <h1 className="text-[16px] font-semibold text-slate-900">Connexion</h1>

          {setupRequired ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
              <p className="font-semibold">Aucun compte n’existe encore.</p>
              <p className="pt-1">Sur le serveur, dans le dossier de l’application :</p>
              <code className="mt-1 block rounded bg-white/70 px-2 py-1 text-[11px] text-amber-900">
                npm run user -- add &lt;identifiant&gt; --role admin
              </code>
            </div>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Identifiant</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              className="rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Mot de passe</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="mt-1 rounded-lg bg-blue-600 px-4 py-2 text-[14px] font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>

          <p className="pt-1 text-[11px] leading-relaxed text-slate-400">
            Vos identifiants sont ceux du serveur NetSchema. En cas d’oubli, un administrateur
            réinitialise le mot de passe depuis le serveur.
          </p>
        </form>
      </div>
    </div>
  )
}
