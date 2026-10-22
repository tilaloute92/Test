import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import { addDays, formatWeekRange, startOfWeek } from '../lib/date';
import { computeMeetingReport, libelleSemaine } from '../lib/meetingReport';
import { buildMarkdownReport } from '../lib/weeklyReport';
import { buildReunionPayload } from '../lib/reunionPayload';
import { exportWeeklyReportPptx } from '../lib/weeklyReportPptx';
import { fetchDocumentReunion } from '../lib/mailApi';
import { isServerMode } from '../lib/serverMode';
import { getStoredMemberId } from '../lib/identity';
import { ModeSwitcher } from './ui';
import { ReunionDocument } from './ReunionDocument';
import { ReunionProjection } from './ReunionProjection';
import { ReunionSynthese } from './ReunionSynthese';
import { SendReunionModal } from './SendReunionModal';
import { useViewMode } from '../hooks/useViewMode';
import { useMeteoVote } from '../hooks/useMeteoVote';
import { cleSemaine, resultatMeteo } from '../lib/meteoVote';
import { useSeuilPresence } from '../hooks/useSeuilPresence';
import { useRecurrences } from '../hooks/useRecurrences';

/**
 * Le nom de l'équipe en titre du rapport.
 *
 * C'était une constante du code — « Équipe Infrastructure & Réseau » — ce qui ne tenait
 * que tant qu'il n'y avait qu'une équipe. Il vient désormais du serveur, qui sait quelle
 * équipe il sert. Le repli ne vaut que pour le mode autonome, où il n'y a ni serveur ni
 * équipes : le nom y est celui du poste, et personne d'autre ne lit ce rapport.
 */
const TEAM_LABEL_DEFAUT = 'Équipe Infrastructure & Réseau';

function nomEquipeCourante(): string {
  const w = window as unknown as { __suiviSession?: { equipeNom?: string | null } | null };
  return w.__suiviSession?.equipeNom || TEAM_LABEL_DEFAUT;
}

/**
 * Rapport de réunion d'équipe.
 *
 * Trois vues des mêmes chiffres, selon ce qu'on en fait : le relire et l'imprimer
 * (Réunion), le projeter dans la salle (Projection), l'envoyer à qui n'y était pas
 * (Synthèse). Un seul calcul derrière — basculer d'une vue à l'autre ne change jamais
 * un nombre, sans quoi personne ne saurait laquelle croire.
 *
 * Il n'y a rien à « générer » : le rapport est recalculé à l'ouverture. Un rapport
 * enregistré serait un rapport périmé, et personne ne saurait dire de quand datent ses
 * chiffres. Seul un ENVOI laisse une trace, parce que lui ne doit plus bouger.
 */

const VUES = ['reunion', 'projection', 'synthese'] as const;
type Vue = (typeof VUES)[number];

export function WeeklyReportView() {
  const { members, tasks, timeEntries, absences, planningSlots, roadmapItems, journalEntries, referents } = useStore();
  const [weekOffset, setWeekOffset] = useState(0);
  const [vue, setVue] = useViewMode<Vue>('rapport-reunion', VUES, 'reunion');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'' | 'pptx' | 'html'>('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiOuvert, setEnvoiOuvert] = useState(false);
  const seuilPresence = useSeuilPresence();
  const recurrences = useRecurrences();

  // La date est réduite à un nombre : un objet Date recréé à chaque rendu relancerait le
  // calcul en boucle à travers useMemo.
  const debutMs = startOfWeek(addDays(new Date(), weekOffset * 7)).getTime();

  const report = useMemo(
    () =>
      computeMeetingReport({
        debutSemaine: new Date(debutMs),
        members,
        tasks,
        timeEntries,
        absences,
        planningSlots,
        roadmapItems,
        journalEntries,
        referents,
        seuilPresence,
        recurrences,
      }),
    [debutMs, members, tasks, timeEntries, absences, planningSlots, roadmapItems, journalEntries, referents, seuilPresence, recurrences]
  );

  // Qui signe le document. Le choix mémorisé dans « Ma journée » sert de source : il a
  // déjà été confirmé par la personne, contrairement à un rapprochement automatique.
  // La météo votée par l'équipe pour la semaine affichée (voir src/lib/meteoVote.ts).
  // Chargée à part des données d'équipe, et à défaut de vote abouti, c'est le score
  // calculé qui reste affiché — le rapport n'est jamais privé de météo.
  const { agregat: voteMeteo } = useMeteoVote(cleSemaine(new Date(debutMs)));
  const meteo = useMemo(() => resultatMeteo(voteMeteo, report.hebdo.weather), [voteMeteo, report.hebdo.weather]);

  const auteur = useMemo(() => {
    const id = getStoredMemberId();
    return members.find((m) => m.id === id)?.name ?? '';
  }, [members]);

  const construirePayload = ({ mot, pointsRetires }: { mot: string; pointsRetires: string[] }) =>
    buildReunionPayload({ report, members, teamLabel: nomEquipeCourante(), auteur, mot, pointsRetires, meteo });

  const copierMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(buildMarkdownReport(report.hebdo, nomEquipeCourante(), members, meteo, report.notes));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : pas de confirmation,
      // plutôt qu'un plantage.
    }
  };

  const exporterPptx = async () => {
    setErreur(null);
    setBusy('pptx');
    try {
      await exportWeeklyReportPptx({ report: report.hebdo, members, teamLabel: nomEquipeCourante(), meteo, notes: report.notes });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  /**
   * Le document en un fichier autonome, qui s'ouvre d'un double-clic et s'imprime en PDF.
   *
   * En mode client/serveur il est rendu par le SERVEUR, exactement comme la pièce jointe
   * du message : ce qu'on télécharge est alors ce que les destinataires recevront. Sans
   * serveur, on sérialise ce qui est à l'écran — c'est possible parce que le document
   * n'utilise que des styles en ligne, sans la moindre classe ni feuille de style.
   */
  const telecharger = async () => {
    setErreur(null);
    setBusy('html');
    try {
      let html: string;
      if (isServerMode()) {
        html = await fetchDocumentReunion(construirePayload({ mot: '', pointsRetires: [] }));
      } else {
        const noeud = document.getElementById('document-reunion');
        if (!noeud) throw new Error('Passez sur la vue Réunion ou Synthèse avant de télécharger le document.');
        html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Réunion d'équipe — ${nomEquipeCourante()}</title><style>@page{size:A4;margin:12mm}body{margin:0;padding:16px;background:#f1f5f9}</style></head><body>${noeud.outerHTML}</body></html>`;
      }
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `reunion-${formatWeekRange(report.semaineEcoulee).replace(/[^0-9a-zA-Z]+/g, '-')}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Rapport de réunion</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {nomEquipeCourante()} · {libelleSemaine(report.semaineEcoulee, report.genereLe).prefixe.toLowerCase()} : {formatWeekRange(report.semaineEcoulee)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 text-sm dark:bg-slate-800">
            <button onClick={() => setWeekOffset((w) => w - 1)} className="rounded-md px-2 py-1 text-slate-500" title="Semaine précédente">
              ◀
            </button>
            <button onClick={() => setWeekOffset(0)} className="rounded-md px-2.5 py-1 text-slate-600 dark:text-slate-300">
              {weekOffset === 0 ? 'Semaine en cours' : 'Revenir à la semaine en cours'}
            </button>
            <button onClick={() => setWeekOffset((w) => w + 1)} className="rounded-md px-2 py-1 text-slate-500" title="Semaine suivante">
              ▶
            </button>
          </div>
          <ModeSwitcher
            value={vue}
            onChange={setVue}
            options={[
              { value: 'reunion', label: 'Réunion', title: 'Document complet, imprimable et joint au message' },
              { value: 'projection', label: 'Projection', title: "Grand format, une section par écran, pour l'écran de la salle" },
              { value: 'synthese', label: 'Synthèse', title: "Une page, pour qui n'était pas dans la salle" },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {isServerMode() ? (
          <button
            onClick={() => setEnvoiOuvert(true)}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            ✉ Envoyer par mail…
          </button>
        ) : (
          /* Sans serveur, aucun relais SMTP n'est joignable : plutôt qu'un bouton sans
             effet, on dit ce qui reste possible. */
          <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Envoi par mail indisponible en mode autonome — téléchargez le document et joignez-le à votre message.
          </span>
        )}
        <button onClick={() => window.print()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          Imprimer / PDF
        </button>
        <button
          onClick={() => void telecharger()}
          disabled={busy === 'html'}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {busy === 'html' ? 'Préparation…' : 'Télécharger (.html)'}
        </button>
        <button onClick={() => void copierMarkdown()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          {copied ? 'Copié ✓' : 'Copier en Markdown'}
        </button>
        <button
          onClick={() => void exporterPptx()}
          disabled={busy === 'pptx'}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {busy === 'pptx' ? 'Génération…' : 'Exporter PowerPoint'}
        </button>
        <span className="text-xs text-slate-400">Chiffres arrêtés à l'instant — le rapport se recalcule à chaque ouverture.</span>
      </div>

      {erreur && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 print:hidden dark:bg-red-500/10 dark:text-red-300">{erreur}</p>
      )}

      {vue === 'reunion' && (
        <div className="overflow-x-auto rounded-xl bg-slate-200/60 p-4 print:overflow-visible print:bg-white print:p-0 dark:bg-slate-800">
          <ReunionDocument report={report} members={members} teamLabel={nomEquipeCourante()} auteur={auteur} meteo={meteo} />
        </div>
      )}
      {vue === 'projection' && <ReunionProjection report={report} members={members} teamLabel={nomEquipeCourante()} meteo={meteo} />}
      {vue === 'synthese' && <ReunionSynthese report={report} members={members} teamLabel={nomEquipeCourante()} auteur={auteur} meteo={meteo} />}

      {envoiOuvert && (
        <SendReunionModal
          report={report}
          members={members}
          construirePayload={construirePayload}
          isAdmin={estAdmin()}
          onClose={() => setEnvoiOuvert(false)}
        />
      )}
    </div>
  );
}

/** Le droit réel est vérifié par le serveur ; ici il ne sert qu'à choisir le message
 *  affiché quand on ajoute une adresse qui ne sera pas mémorisée. */
function estAdmin(): boolean {
  const w = window as unknown as { __suiviSession?: { isAdmin?: boolean } | null };
  return Boolean(w.__suiviSession?.isAdmin);
}
