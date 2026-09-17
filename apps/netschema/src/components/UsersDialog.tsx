import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { useSession } from '../store/useSession'

/**
 * Gestion des comptes, réservée aux administrateurs.
 *
 * Jusqu'ici, créer un compte demandait une main sur le serveur et une ligne de commande —
 * ce qui, en pratique, veut dire que personne n'en crée. Trois rôles, trois lignes à remplir :
 * un lecteur voit tout et ne modifie rien, un éditeur travaille, un administrateur gère les
 * comptes et les suppressions.
 */

const ROLES: { id: 'lecteur' | 'editeur' | 'admin'; label: string; aide: string }[] = [
  { id: 'lecteur', label: 'Lecteur', aide: 'Consulte, recherche et exporte. Les schémas s’ouvrent verrouillés.' },
  { id: 'editeur', label: 'Éditeur', aide: 'Modifie les schémas et en crée.' },
  { id: 'admin', label: 'Administrateur', aide: 'Gère les comptes et supprime les schémas.' },
]

function quand(iso: string | null): string {
  if (!iso) return 'jamais'
  const date = new Date(iso)
  const aujourdhui = new Date().toDateString() === date.toDateString()
  const heure = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return aujourdhui ? `aujourd’hui ${heure}` : `${date.toLocaleDateString('fr-FR')} ${heure}`
}

export function UsersDialog() {
  const ouvert = useSession((s) => s.usersOpen)
  const setOuvert = useSession((s) => s.setUsersOpen)
  const moi = useSession((s) => s.user)

  const [comptes, setComptes] = useState<api.CompteAdmin[]>([])
  const [erreur, setErreur] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [nouveau, setNouveau] = useState({ username: '', password: '', displayName: '', role: 'lecteur' as const })
  const [confirme, setConfirme] = useState<string | null>(null)

  const recharger = async () => {
    try {
      setComptes(await api.listUsers())
      setErreur(null)
    } catch (error) {
      setErreur(error instanceof Error ? error.message : 'Liste des comptes indisponible.')
    }
  }

  useEffect(() => {
    if (!ouvert) return
    // La liste vient du serveur : c'est bien une synchronisation avec un système extérieur.
    let annule = false
    void (async () => {
      try {
        const liste = await api.listUsers()
        if (!annule) {
          setComptes(liste)
          setErreur(null)
        }
      } catch (error) {
        if (!annule) setErreur(error instanceof Error ? error.message : 'Liste des comptes indisponible.')
      }
    })()
    return () => {
      annule = true
    }
  }, [ouvert])

  if (!ouvert) return null

  const agir = async (action: () => Promise<void>) => {
    setOccupe(true)
    try {
      await action()
      setErreur(null)
      await recharger()
    } catch (error) {
      setErreur(error instanceof Error ? error.message : 'Opération refusée.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-6 pt-16"
      onClick={() => setOuvert(false)}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="flex-1 text-[14px] font-semibold text-slate-900">Comptes</h2>
          <span className="text-[12px] text-slate-500">{comptes.length} compte(s)</span>
          <button type="button" onClick={() => setOuvert(false)} className="text-[18px] text-slate-400 hover:text-slate-700">
            ×
          </button>
        </div>

        {erreur && <p className="bg-red-50 px-4 py-2 text-[12.5px] text-red-700">{erreur}</p>}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 text-left font-semibold">Identifiant</th>
                <th className="px-3 py-2 text-left font-semibold">Rôle</th>
                <th className="px-3 py-2 text-left font-semibold">Dernière connexion</th>
                <th className="px-3 py-2 text-left font-semibold">État</th>
                <th className="px-4 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {comptes.map((compte) => {
                const soiMeme = compte.username.toLowerCase() === (moi?.username ?? '').toLowerCase()
                return (
                  <tr key={compte.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">
                      <span className="font-medium text-slate-800">{compte.username}</span>
                      {soiMeme && <span className="pl-2 text-[11px] text-slate-400">(vous)</span>}
                      {compte.displayName !== compte.username && (
                        <span className="block text-[11px] text-slate-500">{compte.displayName}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={compte.role}
                        disabled={soiMeme || occupe}
                        onChange={(event) =>
                          void agir(() =>
                            api.updateUser(compte.username, {
                              role: event.target.value as 'lecteur' | 'editeur' | 'admin',
                            }),
                          )
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[12px] disabled:opacity-50"
                      >
                        {ROLES.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{quand(compte.lastLoginAt)}</td>
                    <td className="px-3 py-2">
                      {compte.disabled ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                          désactivé
                        </span>
                      ) : compte.lockedUntil && new Date(compte.lockedUntil) > new Date() ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          bloqué
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          actif
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={soiMeme || occupe}
                          onClick={() => void agir(() => api.updateUser(compte.username, { disabled: !compte.disabled }))}
                          className="text-[11.5px] text-slate-500 hover:text-slate-800 disabled:opacity-40"
                        >
                          {compte.disabled ? 'Réactiver' : 'Désactiver'}
                        </button>
                        <button
                          type="button"
                          disabled={occupe}
                          onClick={() => {
                            const mot = window.prompt(`Nouveau mot de passe pour « ${compte.username} »`)
                            if (mot) void agir(() => api.updateUser(compte.username, { password: mot }))
                          }}
                          className="text-[11.5px] text-slate-500 hover:text-slate-800 disabled:opacity-40"
                        >
                          Mot de passe
                        </button>
                        {confirme === compte.username ? (
                          <button
                            type="button"
                            disabled={occupe}
                            onClick={() => {
                              setConfirme(null)
                              void agir(() => api.deleteUser(compte.username))
                            }}
                            className="rounded-md bg-red-600 px-2 py-0.5 text-[11.5px] font-medium text-white"
                          >
                            Confirmer
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={soiMeme || occupe}
                            onClick={() => setConfirme(compte.username)}
                            className="text-[11.5px] text-red-600 hover:text-red-700 disabled:opacity-40"
                          >
                            Supprimer
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <form
          className="border-t border-slate-100 bg-slate-50 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!nouveau.username.trim() || !nouveau.password) return
            void agir(async () => {
              await api.createUser({
                username: nouveau.username.trim(),
                password: nouveau.password,
                displayName: nouveau.displayName.trim() || undefined,
                role: nouveau.role,
              })
              setNouveau({ username: '', password: '', displayName: '', role: 'lecteur' })
            })
          }}
        >
          <p className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nouveau compte</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={nouveau.username}
              onChange={(event) => setNouveau({ ...nouveau, username: event.target.value })}
              placeholder="Identifiant"
              autoComplete="off"
              className="w-40 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] outline-none focus:border-blue-500"
            />
            <input
              value={nouveau.displayName}
              onChange={(event) => setNouveau({ ...nouveau, displayName: event.target.value })}
              placeholder="Nom affiché (facultatif)"
              autoComplete="off"
              className="w-52 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] outline-none focus:border-blue-500"
            />
            <input
              value={nouveau.password}
              onChange={(event) => setNouveau({ ...nouveau, password: event.target.value })}
              placeholder="Mot de passe"
              type="password"
              autoComplete="new-password"
              className="w-44 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] outline-none focus:border-blue-500"
            />
            <select
              value={nouveau.role}
              onChange={(event) => setNouveau({ ...nouveau, role: event.target.value as typeof nouveau.role })}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-[13px]"
            >
              {ROLES.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={occupe || !nouveau.username.trim() || !nouveau.password}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Créer
            </button>
          </div>
          <p className="pt-2 text-[11.5px] leading-relaxed text-slate-500">
            {ROLES.find((role) => role.id === nouveau.role)?.aide} Mot de passe : 12 caractères
            minimum, mêlant trois catégories parmi minuscules, majuscules, chiffres et symboles.
          </p>
        </form>
      </div>
    </div>
  )
}
