import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { Avatar } from './ui';
import {
  fetchMailStatus,
  previewProgrammes,
  sendDailyProgrammes,
  verifyMailRelay,
  type MailPreview,
  type MailResult,
  type MailStatus,
} from '../lib/mailApi';

/**
 * Envoi du programme du jour par mail, personne par personne.
 *
 * Deux garde-fous volontaires : on ne peut rien envoyer sans avoir vu l'aperçu de ce qui
 * partira, et une personne sans adresse ou sans rien au programme n'est pas sélectionnable —
 * plutôt que de lui expédier un message vide. Le résultat est détaillé par destinataire : un
 * relais peut accepter une adresse et en refuser une autre.
 */
export function DailyMailModal({ date, onClose }: { date: string; onClose: () => void }) {
  const { members } = useStore();
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [previews, setPreviews] = useState<MailPreview[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [openPreview, setOpenPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'chargement' | 'envoi' | 'test' | null>('chargement');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MailResult[] | null>(null);
  const [verified, setVerified] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const [s, p] = await Promise.all([fetchMailStatus(), previewProgrammes(date)]);
        if (annule) return;
        setStatus(s);
        setPreviews(p.previews);
        // Présélection : tout le monde a qui on a réellement quelque chose à envoyer.
        setSelected(p.previews.filter((x) => x.email && x.subject).map((x) => x.memberId));
      } catch (e) {
        if (!annule) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!annule) setBusy(null);
      }
    })();
    return () => {
      annule = true;
    };
  }, [date]);

  const envoyables = previews.filter((p) => p.email && p.subject);

  const envoyer = async () => {
    setBusy('envoi');
    setError(null);
    try {
      const r = await sendDailyProgrammes(date, selected);
      setResults(r.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const tester = async () => {
    setBusy('test');
    setError(null);
    setVerified(null);
    try {
      await verifyMailRelay();
      setVerified('Le relais SMTP répond et accepte la connexion.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div
        className="my-8 w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Envoyer le programme du jour</h3>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            Fermer
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Chaque personne reçoit ses propres créneaux du jour et ses tâches ouvertes. Le message annonce ce qui est <strong>prévu</strong> :
          il ne contient pas de temps saisi, qui n'existe pas encore au moment où il part.
        </p>

        {busy === 'chargement' && <p className="text-sm text-slate-400">Chargement…</p>}

        {error && !status && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            L'envoi de mail n'est pas joignable : <span className="font-mono text-xs">{error}</span>
            <p className="mt-2">
              Cette fonction n'existe qu'en <strong>mode client/serveur</strong> — un site publié seul ne peut pas remettre un message à un
              relais SMTP. Voir <code className="font-mono">packaging/INSTALL.md</code>, scénario B.
            </p>
          </div>
        )}

        {status && !status.configured && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            Le relais SMTP n'est pas configuré. Renseignez <code className="font-mono">SMTP_HOST</code> et{' '}
            <code className="font-mono">SMTP_FROM</code> dans <code className="font-mono">server/.env</code>, puis redémarrez le service.
          </div>
        )}

        {status?.configured && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <span>
                Relais <strong className="text-slate-700 dark:text-slate-200">{status.host}</strong>
              </span>
              <span>
                Expéditeur <strong className="text-slate-700 dark:text-slate-200">{status.from}</strong>
              </span>
              <span>{status.dailyMailAt ? `Envoi automatique à ${status.dailyMailAt}` : 'Pas d’envoi automatique'}</span>
              {status.lastSentDate && <span>Dernier envoi : {status.lastSentDate}</span>}
              <button
                onClick={tester}
                disabled={busy !== null}
                className="ml-auto rounded-md border border-slate-200 px-2 py-1 text-[11px] hover:bg-white disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {busy === 'test' ? 'Test…' : 'Tester le relais'}
              </button>
            </div>

            {verified && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
                {verified}
              </p>
            )}

            <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-800">
              <ul className="divide-y divide-slate-50 dark:divide-slate-800/60">
                {previews.map((p) => {
                  const member = members.find((m) => m.id === p.memberId);
                  const result = results?.find((r) => r.memberId === p.memberId);
                  const envoyable = Boolean(p.email && p.subject);
                  return (
                    <li key={p.memberId} className="px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={!envoyable}
                          checked={selected.includes(p.memberId)}
                          onChange={(e) =>
                            setSelected((ids) => (e.target.checked ? [...ids, p.memberId] : ids.filter((id) => id !== p.memberId)))
                          }
                        />
                        {member && <Avatar name={member.name} color={member.color} initials={member.initials} size={20} />}
                        <span className="shrink-0 text-slate-800 dark:text-slate-100">{p.name}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
                          {p.email ?? <span className="text-amber-600 dark:text-amber-400">pas d'adresse mail</span>}
                        </span>
                        {p.email && !p.subject && <span className="shrink-0 text-[11px] text-slate-400">rien au programme</span>}
                        {p.subject && (
                          <button
                            onClick={() => setOpenPreview(openPreview === p.memberId ? null : p.memberId)}
                            className="shrink-0 text-[11px] text-violet-600 hover:underline dark:text-violet-400"
                          >
                            {openPreview === p.memberId ? 'masquer' : 'aperçu'}
                          </button>
                        )}
                        {result && (
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                              result.status === 'envoye'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                : result.status === 'echec'
                                  ? 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                            title={result.error}
                          >
                            {result.status === 'envoye'
                              ? 'envoyé'
                              : result.status === 'echec'
                                ? 'échec'
                                : result.status === 'sans-adresse'
                                  ? 'sans adresse'
                                  : 'rien à envoyer'}
                          </span>
                        )}
                      </div>
                      {openPreview === p.memberId && (
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                          {`Objet : ${p.subject}\n\n${p.text}`}
                        </pre>
                      )}
                      {result?.status === 'echec' && <p className="mt-1 pl-7 text-[11px] text-red-600 dark:text-red-400">{result.error}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-400">
                {envoyables.length} destinataire(s) possible(s) · {selected.length} sélectionné(s)
              </span>
              <button
                onClick={envoyer}
                disabled={selected.length === 0 || busy !== null}
                className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
              >
                {busy === 'envoi' ? 'Envoi…' : `Envoyer à ${selected.length} personne(s)`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
