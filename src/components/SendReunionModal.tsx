import { useEffect, useMemo, useState } from 'react';
import {
  fetchReunionConfig,
  previewDestinataires,
  saveDestinatairesExternes,
  sendReunionReport,
  type ReunionDestinataire,
} from '../lib/mailApi';
import { objetParDefaut, type ReunionPayload } from '../lib/reunionPayload';
import type { MeetingReport } from '../lib/meetingReport';
import type { TeamMember } from '../types';
import { useModalDismiss } from './Modal';

/**
 * Fenêtre d'envoi du rapport de réunion.
 *
 * Le principe : rien ne part sans un dernier coup d'œil, et aucune mauvaise surprise
 * APRÈS le clic. En particulier, une personne sans adresse dans l'onglet Équipe est
 * signalée ici, avant l'envoi — pas découverte trois jours plus tard parce qu'elle
 * n'avait rien reçu et n'avait pas osé le dire.
 */

export function SendReunionModal({
  report,
  members,
  construirePayload,
  isAdmin,
  onClose,
}: {
  report: MeetingReport;
  members: TeamMember[];
  /** Fabrique le rapport à plat avec le mot d'accompagnement et les points retenus. */
  construirePayload: (opts: { mot: string; pointsRetires: string[] }) => ReunionPayload;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const dismiss = useModalDismiss(onClose, 'ce message');

  const [memberIds, setMemberIds] = useState<string[]>(() => members.filter((m) => m.email).map((m) => m.id));
  const [externes, setExternes] = useState<string[]>([]);
  const [externesRetenus, setExternesRetenus] = useState<string[]>([]);
  const [nouvelle, setNouvelle] = useState('');
  const [objet, setObjet] = useState('');
  const [mot, setMot] = useState(
    'Bonjour, voici le point avant la réunion. Merci de regarder la section « points à aborder », on commence par là.'
  );
  const [pointsRetires, setPointsRetires] = useState<string[]>([]);
  const [joindre, setJoindre] = useState(true);
  const [apercu, setApercu] = useState<ReunionDestinataire[]>([]);
  const [etat, setEtat] = useState<'saisie' | 'envoi' | 'fait'>('saisie');
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultats, setResultats] = useState<ReunionDestinataire[] | null>(null);
  const [dernier, setDernier] = useState<string | null>(null);

  const sansAdresse = useMemo(() => members.filter((m) => !m.email), [members]);

  useEffect(() => {
    setObjet(objetParDefaut(construirePayload({ mot: '', pointsRetires: [] })));
    // L'objet ne doit pas se réécrire pendant que l'utilisateur le corrige : on le pose
    // une fois à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let vivant = true;
    fetchReunionConfig()
      .then((c) => {
        if (!vivant) return;
        setExternes(c.destinatairesExternes);
        setExternesRetenus(c.destinatairesExternes);
        setDernier(
          c.dernierEnvoi
            ? `${new Date(c.dernierEnvoi.envoyeLe).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}, ${
                c.dernierEnvoi.destinataires.length
              } destinataire(s), ${c.dernierEnvoi.echecs} échec(s)`
            : null
        );
      })
      .catch(() => {
        // Liste indisponible (serveur injoignable, route absente) : on continue avec les
        // seuls membres de l'équipe plutôt que de bloquer l'envoi.
      });
    return () => {
      vivant = false;
    };
  }, []);

  // Le serveur dit qui est réellement joignable : c'est lui qui détient les adresses.
  useEffect(() => {
    let vivant = true;
    previewDestinataires({ memberIds, adresses: externesRetenus })
      .then((r) => vivant && setApercu(r.destinataires))
      .catch(() => vivant && setApercu([]));
    return () => {
      vivant = false;
    };
  }, [memberIds, externesRetenus]);

  const joignables = apercu.filter((d) => d.statut === 'a-envoyer');
  const invalides = apercu.filter((d) => d.statut === 'adresse-invalide');

  const bascule = (id: string) =>
    setMemberIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const basculeExt = (a: string) =>
    setExternesRetenus((c) => (c.includes(a) ? c.filter((x) => x !== a) : [...c, a]));

  const ajouterAdresse = async () => {
    const a = nouvelle.trim();
    if (!a) return;
    setNouvelle('');
    setExternesRetenus((c) => (c.includes(a) ? c : [...c, a]));
    if (!externes.includes(a)) {
      const liste = [...externes, a];
      setExternes(liste);
      // Enregistrer la liste est réservé à l'administrateur côté serveur. Pour les autres,
      // l'adresse sert quand même à cet envoi — elle ne sera simplement pas mémorisée.
      if (isAdmin) await saveDestinatairesExternes(liste).catch(() => undefined);
    }
  };

  const envoyer = async () => {
    setEtat('envoi');
    setErreur(null);
    try {
      const r = await sendReunionReport({
        payload: construirePayload({ mot, pointsRetires }),
        destinataires: { memberIds, adresses: externesRetenus },
        objet,
        joindreDocument: joindre,
      });
      setResultats(r.resultats);
      setEtat('fait');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
      setEtat('saisie');
    }
  };

  if (etat === 'fait' && resultats) {
    const echecs = resultats.filter((r) => r.statut === 'echec');
    return (
      <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" {...dismiss.backdrop}>
        <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900" {...dismiss.content}>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {echecs.length === 0 ? 'Rapport envoyé' : 'Envoyé, avec des échecs'}
          </h3>
          <ul className="mt-3 space-y-1 text-sm">
            {resultats.map((r) => (
              <li key={r.nom} className="flex items-start justify-between gap-3">
                <span className="text-slate-700 dark:text-slate-200">{r.nom}</span>
                <span className={`shrink-0 text-xs ${etiquetteCouleur(r.statut)}`}>
                  {etiquette(r.statut)}
                  {r.erreur ? ` — ${r.erreur}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-400">
            Le document tel qu'il est parti est conservé : il reste consultable même quand les chiffres auront changé.
          </p>
          <div className="mt-4 flex justify-end">
            <button onClick={onClose} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
              Fermer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" {...dismiss.backdrop}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900" {...dismiss.content}>
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Envoyer le rapport de réunion</h3>
          <span className="text-xs text-slate-400">{report.semaines[0]?.label ?? ''}</span>
        </div>

        <div className="space-y-4">
          <div>
            <Legende>Destinataires</Legende>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) =>
                m.email ? (
                  <button
                    key={m.id}
                    onClick={() => bascule(m.id)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      memberIds.includes(m.id)
                        ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200'
                        : 'border-slate-200 text-slate-400 dark:border-slate-700'
                    }`}
                    title={m.email}
                  >
                    {memberIds.includes(m.id) ? '✓ ' : ''}
                    {m.name}
                  </button>
                ) : (
                  <span
                    key={m.id}
                    className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                    title="Aucune adresse renseignée dans l'onglet Équipe"
                  >
                    ⚠ {m.name} — sans adresse
                  </span>
                )
              )}
              {externes.map((a) => (
                <button
                  key={a}
                  onClick={() => basculeExt(a)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    externesRetenus.includes(a)
                      ? 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                      : 'border-slate-200 text-slate-400 dark:border-slate-700'
                  }`}
                >
                  {externesRetenus.includes(a) ? '✓ ' : ''}
                  {a}
                </button>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={nouvelle}
                onChange={(e) => setNouvelle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void ajouterAdresse();
                  }
                }}
                placeholder="autre adresse…"
                className="input w-56 text-sm"
              />
              <button
                onClick={() => void ajouterAdresse()}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                Ajouter
              </button>
              {!isAdmin && (
                <span className="text-xs text-slate-400">
                  Servira pour cet envoi ; seul l'administrateur peut l'enregistrer dans la liste.
                </span>
              )}
            </div>

            {sansAdresse.length > 0 && (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                {sansAdresse.length} personne(s) sans adresse dans l'onglet Équipe ne recevront rien. C'est dit avant
                l'envoi, pas découvert après.
              </p>
            )}
            {invalides.length > 0 && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                Adresse(s) mal formée(s), ignorée(s) : {invalides.map((d) => d.nom).join(', ')}
              </p>
            )}
          </div>

          <div>
            <Legende>Objet</Legende>
            <input value={objet} onChange={(e) => setObjet(e.target.value)} className="input w-full text-sm" />
          </div>

          <div>
            <Legende>Mot d'accompagnement</Legende>
            <textarea rows={2} value={mot} onChange={(e) => setMot(e.target.value)} className="input w-full resize-y text-sm" />
          </div>

          {report.points.length > 0 && (
            <div>
              <Legende>Points à aborder — décochez ce qui n'a pas lieu d'y être</Legende>
              <div className="space-y-1">
                {report.points.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={!pointsRetires.includes(p.id)}
                      onChange={() =>
                        setPointsRetires((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 rounded"
                    />
                    <span>
                      {p.texte} <span className="text-xs text-slate-400">— {p.source}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={joindre} onChange={(e) => setJoindre(e.target.checked)} className="h-4 w-4 rounded" />
            Joindre le document complet (grille de planning, charge, feuille de route)
          </label>

          {erreur && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{erreur}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <button
              onClick={() => void envoyer()}
              disabled={etat === 'envoi' || joignables.length === 0}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
            >
              {etat === 'envoi'
                ? 'Envoi…'
                : joignables.length === 0
                  ? 'Aucun destinataire joignable'
                  : `Envoyer à ${joignables.length} destinataire${joignables.length > 1 ? 's' : ''}`}
            </button>
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
              Annuler
            </button>
            {dernier && <span className="text-xs text-slate-400">Dernier envoi : {dernier}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Legende({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">{children}</div>;
}

function etiquette(s: ReunionDestinataire['statut']): string {
  return s === 'envoye'
    ? 'envoyé'
    : s === 'echec'
      ? 'échec'
      : s === 'sans-adresse'
        ? 'sans adresse'
        : s === 'adresse-invalide'
          ? 'adresse invalide'
          : 'à envoyer';
}

function etiquetteCouleur(s: ReunionDestinataire['statut']): string {
  if (s === 'envoye') return 'text-emerald-600 dark:text-emerald-400';
  if (s === 'echec' || s === 'adresse-invalide') return 'text-red-600 dark:text-red-400';
  return 'text-amber-600 dark:text-amber-400';
}
