import { formatDateLong, formatWeekRange, isWeekend, toISODate } from '../lib/date';
import {
  COULEUR_ABSENCE,
  COULEUR_NATURE,
  estNature,
  ETIQUETTES_ABSENCE,
  type CodeCreneau,
  type MeetingReport,
  type ProjetRollup,
} from '../lib/meetingReport';
import { weatherMeta } from '../lib/weeklyReport';
import { NIVEAUX, resultatMeteo, type ResultatMeteo } from '../lib/meteoVote';
import { workloadColors, workloadHex } from '../lib/workload';
import { formatDureeAbsence } from '../lib/presence';
import type { Absence, ProjectTask, TeamMember } from '../types';

/**
 * Le document de réunion, tel qu'il est lu, imprimé et projeté.
 *
 * Styles en ligne et couleurs écrites en dur, contrairement au reste de l'application :
 * ce composant n'a pas de mode sombre. Un document part à l'impression, dans un PDF et
 * dans un message — trois supports toujours clairs. Le rendre « sombre comme le reste de
 * l'interface » produirait un aplat noir de 2 Mo chez l'imprimeur et un message illisible
 * chez les destinataires dont le client force un fond blanc.
 */

const ENCRE = '#0f172a';
const ENCRE2 = '#475569';
const ENCRE3 = '#94a3b8';
const TRAIT = '#e2e8f0';

const POLICE = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

const th: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '.06em',
  color: ENCRE3,
  fontWeight: 600,
  padding: '0 8px 5px 0',
};
const td: React.CSSProperties = {
  fontSize: 12.5,
  color: ENCRE2,
  padding: '7px 8px 7px 0',
  borderTop: `1px solid ${TRAIT}`,
  verticalAlign: 'top',
};

export interface DocumentProps {
  report: MeetingReport;
  members: TeamMember[];
  teamLabel: string;
  /** Qui génère le document. Vide si l'identité n'est pas connue — on n'invente pas un nom. */
  auteur?: string;
  /** Points décochés par l'utilisateur avant envoi (voir la fenêtre d'envoi). */
  pointsRetires?: string[];
  /** Météo retenue — votée par l'équipe, ou calculée à défaut de vote abouti. */
  meteo?: ResultatMeteo;
}

export function ReunionDocument({ report, members, teamLabel, auteur, pointsRetires = [], meteo }: DocumentProps) {
  const points = report.points.filter((p) => !pointsRetires.includes(p.id));
  const h = report.hebdo;
  const resolus = h.incidentsResolved;

  return (
    <div
      id="document-reunion"
      style={{ background: '#fff', color: ENCRE, fontFamily: POLICE, maxWidth: 820, margin: '0 auto' }}
    >
      <EnTete report={report} teamLabel={teamLabel} auteur={auteur} />

      <div style={{ padding: '20px 28px 28px' }}>
        <Meteo report={report} meteo={meteo ?? resultatMeteo(null, report.hebdo.weather)} />
        <Chiffres report={report} />

        {/* L'ordre du jour ouvre le document : c'est par là que commence la réunion, le
            reste ne sert qu'à l'étayer. */}
        <Section n={1} titre="Points à aborder" />
        <ListePoints points={points} />

        <Section n={2} titre="Incidents" />
        <TableIncidents taches={h.openCriticalIncidents} members={members} />
        {resolus.length > 0 && (
          <div style={{ marginTop: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: '#166534' }}>
            <strong style={{ fontWeight: 600 }}>Résolus cette semaine ({resolus.length})</strong>
            <span style={{ color: '#15803d' }}> — {resolus.map((t) => t.title).join(' · ')}</span>
          </div>
        )}

        <Section n={3} titre="Projets" />
        <TableProjets projets={report.projets} />

        <Section n={4} titre="Tâches en retard" />
        <TableRetard taches={h.overdueTasks} members={members} referenceIso={h.referenceRetard} />

        <Section n={5} titre="Sujets prévus sur les deux semaines" apres="sous réserve" />
        <ListeSujets report={report} />
        <SousTitre>Qui travaille sur quoi, demi-journée par demi-journée</SousTitre>
        <Grille report={report} />

        <Section n={6} titre="Absences" />
        <ListeAbsences report={report} members={members} />

        <Section n={7} titre="Charge par personne" />
        <TableCharge report={report} />

        {h.roadmap.total > 0 && (
          <>
            <Section n={8} titre={`Feuille de route ${h.roadmap.year}`} />
            <FeuilleDeRoute report={report} />
          </>
        )}

        <PiedPage report={report} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- En-tête

function EnTete({ report, teamLabel, auteur }: { report: MeetingReport; teamLabel: string; auteur?: string }) {
  const reunion = report.dateReunion;
  return (
    <div style={{ background: '#1e1b4b', color: '#fff', padding: '20px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: '#a5b4fc' }}>
            Réunion d'équipe{reunion ? ` · ${formatDateLong(reunion)}` : ''}
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{teamLabel}</div>
          <div style={{ fontSize: 13, color: '#c7d2fe', marginTop: 4 }}>
            Semaine écoulée : {formatWeekRange(report.semaineEcoulee)}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#a5b4fc', lineHeight: 1.6 }}>
          Document généré le
          <br />
          <span style={{ color: '#fff', fontSize: 13 }}>
            {formatDateLong(report.genereLe)}, {heureCourte(report.genereLe)}
          </span>
          {auteur && (
            <>
              <br />
              par {auteur}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function heureCourte(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// -------------------------------------------------------------------- Météo

const COULEUR_METEO: Record<string, string> = {
  ensoleille: '#16a34a',
  eclaircies: '#65a30d',
  nuageux: '#f59e0b',
  orageux: '#dc2626',
};

/**
 * La météo, votée par l'équipe ou calculée.
 *
 * Les deux colonnes de droite ne font pas double emploi : « ce qu'a voté l'équipe » est un
 * ressenti, « ce que disent les chiffres » une mesure. Les afficher côte à côte est le seul
 * moyen de voir leur écart — une équipe qui se dit sous l'orage alors que la charge est au
 * vert dit quelque chose qu'aucun des deux indicateurs ne dit seul. La mention sous la
 * météo rappelle toujours laquelle des deux est affichée en grand.
 */
function Meteo({ report, meteo }: { report: MeetingReport; meteo: ResultatMeteo }) {
  const h = report.hebdo;
  const m = weatherMeta[meteo.niveau];
  const a = meteo.agregat;
  const vote = meteo.vote && a ? a : null;
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        border: `1px solid ${TRAIT}`,
        borderLeft: `4px solid ${COULEUR_METEO[meteo.niveau]}`,
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ textAlign: 'center', minWidth: 104 }}>
        <div style={{ fontSize: 34, lineHeight: 1 }}>{m.emoji}</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{m.label}</div>
        <div style={{ fontSize: 11, color: ENCRE3 }}>{vote ? `${vote.total} voix sur ${vote.effectif}` : `score ${h.weatherScore} / 100`}</div>
      </div>

      {vote && (
        <div style={{ minWidth: 190, borderLeft: `1px solid ${TRAIT}`, paddingLeft: 16 }}>
          <Intitule>Ce qu'a voté l'équipe</Intitule>
          <Repartition voix={vote.voix} total={vote.total} />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 240, borderLeft: `1px solid ${TRAIT}`, paddingLeft: 16 }}>
        <Intitule>{vote ? 'Ce que disent les chiffres' : 'Ce qui donne cette météo'}</Intitule>
        {vote && (
          <div style={{ fontSize: 13, color: ENCRE2, marginBottom: 4 }}>
            {weatherMeta[h.weather].emoji} {weatherMeta[h.weather].label} — score {h.weatherScore} / 100
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '4px 20px', fontSize: 13, color: ENCRE2 }}>
          {h.weatherFactors.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: ENCRE3, marginTop: 8 }}>{meteo.mention}</div>
        {vote && h.weather !== meteo.niveau && (
          <div style={{ marginTop: 6, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: '#78350f' }}>
            Le ressenti de l'équipe et les chiffres ne disent pas la même chose. C'est un point à aborder, pas une erreur.
          </div>
        )}
        {vote && vote.mots.length > 0 && (
          <div style={{ marginTop: 8, borderTop: `1px solid ${TRAIT}`, paddingTop: 6 }}>
            <Intitule>Mots laissés avec les voix — sans nom, dans un ordre mélangé</Intitule>
            <div style={{ fontSize: 12.5, color: ENCRE2 }}>{vote.mots.map((t) => `« ${t} »`).join(' · ')}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Intitule({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: ENCRE3, marginBottom: 6 }}>{children}</div>
  );
}

/** Barres du dépouillement. Jamais de camembert : quatre parts dont deux proches ne se
 *  comparent pas à l'œil, et le rapport est souvent relu imprimé en noir et blanc. */
function Repartition({ voix, total }: { voix: Record<string, number>; total: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {NIVEAUX.map((n) => (
        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ width: 16 }}>{weatherMeta[n].emoji}</span>
          <span style={{ width: 120, height: 10, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
            <span
              style={{
                display: 'block',
                width: `${total > 0 ? ((voix[n] ?? 0) / total) * 100 : 0}%`,
                height: 10,
                background: COULEUR_METEO[n],
                borderRadius: 3,
              }}
            />
          </span>
          <span style={{ color: ENCRE2, fontVariantNumeric: 'tabular-nums' }}>{voix[n] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

function Chiffres({ report }: { report: MeetingReport }) {
  const h = report.hebdo;
  const s1 = report.semaines[0];
  const tuiles = [
    { v: `${arrondi(h.totalHoursLogged)} h`, l: `saisies sur ${arrondi(h.totalHoursTarget)} h de capacité`, sub: `${Math.round(h.avgWorkloadRatio * 100)} %` },
    { v: String(h.tasksCompleted.length), l: 'tâches terminées cette semaine', sub: '' },
    { v: `${h.openCriticalIncidents.length} / ${h.incidentsResolved.length}`, l: 'incidents ouverts / résolus', sub: '' },
    { v: s1 ? `${Math.round(s1.remplissage * 100)} %` : '—', l: 'du planning S+1 déjà rempli', sub: '' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 20 }}>
      {tuiles.map((t) => (
        <div key={t.l} style={{ border: `1px solid ${TRAIT}`, borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{t.v}</div>
          <div style={{ fontSize: 11, color: ENCRE2, lineHeight: 1.35, marginTop: 2 }}>{t.l}</div>
          {t.sub && <div style={{ fontSize: 11, color: ENCRE3, marginTop: 2 }}>{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function arrondi(n: number): number {
  return Math.round(n * 10) / 10;
}

// ------------------------------------------------------------------ Sections

function Section({ n, titre, apres }: { n: number; titre: string; apres?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        margin: '22px 0 10px',
        borderBottom: `2px solid ${ENCRE}`,
        paddingBottom: 4,
        // Un titre de section seul en bas de page est une page perdue à la lecture.
        breakAfter: 'avoid',
        breakInside: 'avoid',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: ENCRE, borderRadius: 4, padding: '1px 6px' }}>{n}</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{titre}</span>
      {apres && <span style={{ fontSize: 12, color: ENCRE3, fontStyle: 'italic' }}>— {apres}</span>}
    </div>
  );
}

function SousTitre({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: ENCRE3, fontWeight: 600, margin: '16px 0 6px', breakAfter: 'avoid' }}>
      {children}
    </div>
  );
}

function Pastille({ couleur, texte }: { couleur: string; texte: string }) {
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, color: '#fff', background: couleur, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>
      {texte}
    </span>
  );
}

function Vide({ texte }: { texte: string }) {
  return <p style={{ fontSize: 12.5, color: ENCRE3, margin: '4px 0 0' }}>{texte}</p>;
}

// --------------------------------------------------------- Points à aborder

function ListePoints({ points }: { points: MeetingReport['points'] }) {
  if (points.length === 0) {
    return <Vide texte="Rien que les données signalent cette semaine. L'ordre du jour est à vous." />;
  }
  return (
    <div>
      {points.map((p, i) => (
        <div key={p.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: i === 0 ? 'none' : `1px solid ${TRAIT}`, breakInside: 'avoid' }}>
          <span style={{ width: 16, height: 16, flexShrink: 0, border: `1.5px solid ${ENCRE3}`, borderRadius: 3, marginTop: 1 }} />
          <span style={{ fontSize: 12.5, color: ENCRE }}>
            {p.texte}
            <span style={{ color: ENCRE3, fontSize: 11 }}> — {p.source}</span>
          </span>
        </div>
      ))}
      <div style={{ fontSize: 11, color: ENCRE3, marginTop: 8 }}>
        Liste déduite des données : incident en attente depuis plus de 5 jours, projet sans heure saisie depuis 14 jours,
        sujet daté sans créneau, semaine en sous-effectif, surcharge, échéances dépassées. Décochez avant envoi ce qui
        n'a pas lieu d'y être.
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Incidents

function noms(t: ProjectTask, members: TeamMember[]): string {
  const n = t.assigneeIds.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);
  return n.length > 0 ? n.join(', ') : 'non assigné';
}

function TableIncidents({ taches, members }: { taches: ProjectTask[]; members: TeamMember[] }) {
  if (taches.length === 0) return <Vide texte="Aucun incident critique ou haut encore ouvert." />;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...th, width: '38%' }}>Incident ouvert</th>
          <th style={{ ...th, width: 74 }}>Priorité</th>
          <th style={{ ...th, width: 130 }}>Qui</th>
          <th style={{ ...th, width: 70 }}>Ouvert le</th>
          <th style={th}>État</th>
        </tr>
      </thead>
      <tbody>
        {taches.map((t) => (
          <tr key={t.id} style={{ breakInside: 'avoid' }}>
            <td style={{ ...td, color: ENCRE, fontWeight: 500 }}>{t.title}</td>
            <td style={td}>
              <Pastille couleur={t.priority === 'critique' ? '#b91c1c' : '#ea580c'} texte={t.priority === 'critique' ? 'Critique' : 'Haute'} />
            </td>
            <td style={td}>{noms(t, members)}</td>
            <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{jolieDate(t.createdAt.slice(0, 10))}</td>
            <td style={{ ...td, color: t.status === 'en_attente' ? '#b45309' : ENCRE2 }}>
              {t.status === 'en_attente' ? 'En attente d’un tiers' : t.status === 'en_cours' ? 'En cours' : 'À faire'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function jolieDate(iso?: string): string {
  if (!iso) return '—';
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a.slice(2)}`;
}

// ------------------------------------------------------------------- Projets

const COULEUR_ETAT: Record<ProjetRollup['etat'], string> = { vert: '#16a34a', orange: '#d97706', rouge: '#dc2626' };

function TableProjets({ projets }: { projets: ProjetRollup[] }) {
  if (projets.length === 0) return <Vide texte="Aucune tâche rattachée à un projet." />;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...th, width: '28%' }}>Projet</th>
          <th style={{ ...th, width: 120 }}>Avancement</th>
          <th style={{ ...th, width: 92 }}>Heures</th>
          <th style={{ ...th, width: 76 }}>Échéance</th>
          <th style={th}>Fait cette semaine / prochaine étape</th>
        </tr>
      </thead>
      <tbody>
        {projets.map((p) => (
          <tr key={p.nom} style={{ breakInside: 'avoid' }}>
            <td style={{ ...td, color: ENCRE, fontWeight: 500 }}>
              <span
                title={p.etatRaison}
                style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 7, background: COULEUR_ETAT[p.etat], marginRight: 6 }}
              />
              {p.nom}
              <div style={{ fontSize: 11, color: ENCRE3, fontWeight: 400, marginLeft: 13 }}>
                {p.pilotes.join(', ') || 'personne d’assigné'}
              </div>
            </td>
            <td style={td}>
              <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, p.avance)}%`, height: '100%', background: COULEUR_NATURE.Projet, borderRadius: 3 }} />
              </div>
              {/* Le déclaré en barre, le terminé en toutes lettres : un projet annoncé à
                  80 % dont 10 % des heures sont bouclées se voit alors d'un coup d'œil. */}
              <div style={{ fontSize: 11, color: ENCRE3, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                {p.avance} % · {p.avanceTerminees} % terminé
              </div>
            </td>
            <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
              <strong style={{ color: p.budget > 0 && p.heuresPassees > p.budget ? '#b91c1c' : ENCRE, fontWeight: 600 }}>{p.heuresPassees} h</strong>
              <span style={{ color: ENCRE3 }}> / {p.budget} h</span>
            </td>
            <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{jolieDate(p.echeance)}</td>
            <td style={td}>
              {p.faitCetteSemaine.length > 0 ? p.faitCetteSemaine.join(' · ') : <span style={{ color: ENCRE3 }}>rien de clos cette semaine</span>}
              {p.prochaineEtape && <div style={{ color: ENCRE, marginTop: 2 }}>→ {p.prochaineEtape}</div>}
              {p.etat !== 'vert' && <div style={{ color: '#b45309', fontSize: 11, marginTop: 2 }}>⚠ {p.etatRaison}</div>}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={5} style={{ fontSize: 10.5, color: ENCRE3, paddingTop: 6 }}>
            Avancement : le premier chiffre est celui déclaré par l'équipe — la moyenne des avancements saisis sur les
            tâches, pondérée par leurs heures estimées. Le second est la part du budget d'heures réellement terminée.
            L'écart entre les deux se discute ; aucun des deux ne se déduit de l'autre.
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

// -------------------------------------------------------------------- Retards

function TableRetard({ taches, members, referenceIso }: { taches: ProjectTask[]; members: TeamMember[]; referenceIso: string }) {
  if (taches.length === 0) return <Vide texte="Aucune — tout est dans les temps." />;
  const iso = referenceIso;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...th, width: '44%' }}>Tâche</th>
          <th style={{ ...th, width: 72 }}>Nature</th>
          <th style={{ ...th, width: 140 }}>Qui</th>
          <th style={{ ...th, width: 86 }}>Échéance</th>
          <th style={th}>Retard</th>
        </tr>
      </thead>
      <tbody>
        {taches.map((t) => {
          const retard = t.dueDate ? Math.max(0, Math.round((Date.parse(`${iso}T00:00:00`) - Date.parse(`${t.dueDate}T00:00:00`)) / 86_400_000)) : 0;
          return (
            <tr key={t.id} style={{ breakInside: 'avoid' }}>
              <td style={{ ...td, color: ENCRE, fontWeight: 500 }}>
                {t.title}
                {/* Une demande en retard, ce n'est pas seulement du travail en retard :
                    c'est quelqu'un qui attend. Le nom du demandeur change la discussion. */}
                {t.demandeur && <div style={{ fontSize: 11, color: ENCRE3, fontWeight: 400 }}>demandé par {t.demandeur}</div>}
              </td>
              <td style={td}>
                <Pastille couleur={COULEUR_NATURE[t.type]} texte={t.type} />
              </td>
              <td style={td}>{noms(t, members)}</td>
              <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{jolieDate(t.dueDate)}</td>
              <td style={{ ...td, color: '#b91c1c', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>+{retard} j</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// --------------------------------------------------------------- Sujets prévus

function ListeSujets({ report }: { report: MeetingReport }) {
  const vide = report.semaines.every((s) => s.sujets.length === 0);
  if (vide) return <Vide texte="Rien de planifié ni d'échu sur les deux semaines — le planning est à remplir." />;
  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '44%' }}>Sujet</th>
            <th style={{ ...th, width: 72 }}>Nature</th>
            <th style={{ ...th, width: 150 }}>Qui</th>
            <th style={th}>Quand</th>
          </tr>
        </thead>
        {report.semaines.map((s) => (
          <tbody key={s.label}>
            <tr>
              <td
                colSpan={4}
                style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: ENCRE2, background: '#f8fafc', padding: '4px 8px 4px 6px', borderTop: `1px solid ${TRAIT}` }}
              >
                {s.label} — planning rempli à {Math.round(s.remplissage * 100)} %
              </td>
            </tr>
            {s.sujets.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ ...td, color: ENCRE3 }}>
                  Rien de planifié ni d'échu sur cette semaine.
                </td>
              </tr>
            ) : (
              s.sujets.map((l) => (
                <tr key={l.taskId} style={{ breakInside: 'avoid' }}>
                  <td style={{ ...td, color: ENCRE, fontWeight: 500 }}>
                    {l.titre}
                    {l.projet && <span style={{ color: ENCRE3, fontWeight: 400 }}> — {l.projet}</span>}
                    {/* La réserve est sous le titre et non en colonne : c'est elle qui décide
                        si le sujet tiendra, on doit la lire avec lui. */}
                    {l.reserve && <div style={{ fontSize: 11, fontWeight: 400, color: '#b45309', marginTop: 1 }}>⚠ {l.reserve}</div>}
                    {l.sansCreneau && (
                      <div style={{ fontSize: 11, fontWeight: 400, color: '#b45309', marginTop: 1 }}>
                        ⚠ aucune demi-journée réservée pour l'instant
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    <Pastille couleur={COULEUR_NATURE[l.nature]} texte={l.nature} />
                  </td>
                  <td style={td}>{l.qui.join(', ') || '—'}</td>
                  <td style={td}>{l.quand}</td>
                </tr>
              ))
            )}
          </tbody>
        ))}
      </table>
      <div style={{ fontSize: 11, color: ENCRE3, marginTop: 6 }}>
        Sous réserve : liste établie à partir du planning et des échéances au{' '}
        <span style={{ color: ENCRE2 }}>
          {jolieDate(toISODate(report.genereLe))} à {heureCourte(report.genereLe)}
        </span>
        . Un incident la rebat en une demi-journée — c'est une intention, pas un engagement. Les sujets marqués ⚠ sont
        ceux dont on sait déjà qu'ils peuvent sauter.
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Grille

const LARGEUR_JOUR = 44;

function couleurCode(code: CodeCreneau): string | null {
  if (code === 'libre') return null;
  if (estNature(code)) return COULEUR_NATURE[code];
  return COULEUR_ABSENCE[code] ?? '#d9f99d';
}

function Grille({ report }: { report: MeetingReport }) {
  const jours = report.joursAVenir;
  const milieu = jours.length / 2;

  // Seuls les codes réellement présents entrent dans la légende : une légende de huit
  // entrées dont six inutilisées fait chercher des couleurs qui ne sont pas là.
  const presents = new Set<CodeCreneau>();
  for (const l of report.grille) for (const c of l.creneaux) presents.add(c);
  const ordre: CodeCreneau[] = ['Projet', 'Incident', 'Demande', 'MCO', 'conge', 'formation', 'teletravail', 'astreinte', 'autre', 'libre'];

  const colonne = (i: number): React.CSSProperties => ({
    width: LARGEUR_JOUR,
    marginRight: 2,
    marginLeft: i === milieu ? 10 : 0,
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 118 + jours.length * (LARGEUR_JOUR + 2) + 10 }}>
        <div style={{ display: 'flex', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: ENCRE3, fontWeight: 600, marginBottom: 2 }}>
          <span style={{ width: 118 }} />
          {report.semaines.map((s, i) => (
            <span key={s.label} style={{ width: (LARGEUR_JOUR + 2) * (jours.length / 2), marginLeft: i === 1 ? 10 : 0, textAlign: 'center' }}>
              {s.label}
            </span>
          ))}
        </div>

        <div style={{ display: 'flex' }}>
          <span style={{ width: 118 }} />
          {jours.map((j, i) => (
            <span
              key={toISODate(j)}
              style={{ ...colonne(i), textAlign: 'center', fontSize: 10, color: isWeekend(j) ? ENCRE3 : ENCRE2, paddingBottom: 3 }}
            >
              {['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'][j.getDay()]} <span style={{ color: ENCRE3 }}>{j.getDate()}</span>
            </span>
          ))}
        </div>

        {report.grille.map((ligne) => (
          <div key={ligne.member.id} style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ width: 118, fontSize: 12, color: ENCRE, paddingRight: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ligne.member.name}
            </span>
            {jours.map((j, i) => (
              <span key={toISODate(j)} style={{ ...colonne(i), display: 'flex', gap: 1 }}>
                <Demi code={ligne.creneaux[i * 2]} weekend={isWeekend(j)} />
                <Demi code={ligne.creneaux[i * 2 + 1]} weekend={isWeekend(j)} />
              </span>
            ))}
          </div>
        ))}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8, fontSize: 11, color: ENCRE2 }}>
          {ordre
            .filter((c) => presents.has(c))
            .map((c) => (
              <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 2,
                    boxSizing: 'border-box',
                    background: couleurCode(c) ?? '#fff',
                    border: c === 'libre' ? '1px dashed #cbd5e1' : 'none',
                  }}
                />
                {libelleCode(c)}
              </span>
            ))}
          <span style={{ color: ENCRE3 }}>· chaque case = une demi-journée (matin, après-midi)</span>
        </div>
      </div>
    </div>
  );
}

function libelleCode(c: CodeCreneau): string {
  if (c === 'libre') return 'Non planifié';
  if (estNature(c)) return c;
  return ETIQUETTES_ABSENCE[c] ?? c;
}

function Demi({ code, weekend }: { code: CodeCreneau; weekend: boolean }) {
  const fond = couleurCode(code);
  return (
    <span
      title={libelleCode(code)}
      style={{
        flex: 1,
        height: 17,
        boxSizing: 'border-box',
        borderRadius: 2,
        // Le week-end reste visible même vide : sans lui, une case blanche de samedi se lit
        // comme un lundi qu'on aurait oublié de planifier.
        background: fond ?? (weekend ? '#f8fafc' : '#fff'),
        border: fond ? 'none' : '1px dashed #cbd5e1',
      }}
    />
  );
}

// ------------------------------------------------------------------ Absences

function ListeAbsences({ report, members }: { report: MeetingReport; members: TeamMember[] }) {
  // Les absences arrivent jour par jour : les regrouper par personne et par type évite
  // quinze lignes « congés » pour une seule semaine posée.
  const groupes = new Map<string, Absence[]>();
  for (const a of toutesLesAbsences(report)) {
    const cle = `${a.memberId}|${a.type}|${a.label ?? ''}`;
    groupes.set(cle, [...(groupes.get(cle) ?? []), a]);
  }
  if (groupes.size === 0) return <Vide texte="Aucune absence prévue sur les deux semaines." />;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        {[...groupes.values()].map((liste) => {
          const a = liste[0];
          const m = members.find((x) => x.id === a.memberId);
          const dates = liste.map((x) => x.date).sort();
          return (
            <tr key={`${a.memberId}-${a.type}-${a.label ?? ''}`} style={{ breakInside: 'avoid' }}>
              <td style={{ ...td, width: 150, color: ENCRE, fontWeight: 500 }}>{m?.name ?? '—'}</td>
              <td style={{ ...td, width: 200 }}>
                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: COULEUR_ABSENCE[a.type] ?? '#d9f99d', marginRight: 6 }} />
                {a.label || ETIQUETTES_ABSENCE[a.type]}
              </td>
              <td style={td}>{libelleDates(dates)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function toutesLesAbsences(report: MeetingReport): Absence[] {
  // Les absences ne sont pas portées par le rapport hebdomadaire au-delà de S+1 : on les
  // relit depuis la grille, qui couvre bien les deux semaines.
  const out: Absence[] = [];
  report.grille.forEach((ligne) => {
    ligne.creneaux.forEach((code, index) => {
      if (estNature(code) || code === 'libre') return;
      const jour = report.joursAVenir[Math.floor(index / 2)];
      const iso = toISODate(jour);
      // Une absence couvrant la journée produit deux créneaux : on ne la compte qu'une fois.
      if (out.some((a) => a.memberId === ligne.member.id && a.date === iso && a.type === code)) return;
      out.push({ id: `${ligne.member.id}-${iso}-${code}`, memberId: ligne.member.id, date: iso, period: 'jour', type: code });
    });
  });
  return out;
}

function libelleDates(isos: string[]): string {
  if (isos.length === 0) return '—';
  if (isos.length === 1) return `le ${jolieDate(isos[0])}`;
  const continu = isos.every((iso, i) => {
    if (i === 0) return true;
    return Date.parse(`${iso}T00:00:00`) - Date.parse(`${isos[i - 1]}T00:00:00`) === 86_400_000;
  });
  if (continu) return `du ${jolieDate(isos[0])} au ${jolieDate(isos[isos.length - 1])}`;
  return isos.map(jolieDate).join(', ');
}

// -------------------------------------------------------- Charge par personne

function TableCharge({ report }: { report: MeetingReport }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...th, width: 170 }}>Personne</th>
          <th style={{ ...th, width: 180 }}>Charge planifiée</th>
          <th style={{ ...th, width: 130 }}>Heures saisies</th>
          <th style={{ ...th, width: 110 }}>Terminées</th>
          <th style={th}>Absences</th>
        </tr>
      </thead>
      <tbody>
        {report.hebdo.perMember.map((p) => (
          <tr key={p.member.id} style={{ breakInside: 'avoid' }}>
            <td style={{ ...td, color: ENCRE, fontWeight: 500 }}>{p.member.name}</td>
            <td style={td}>
              <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    // Absent toute la semaine : barre pleine en gris, pas vide (voir WorkloadBar).
                    width: p.workloadLevel === 'absent' ? '100%' : `${Math.min(100, Math.round(p.workloadRatio * 100))}%`,
                    height: '100%',
                    background: workloadHex[p.workloadLevel],
                    borderRadius: 3,
                  }}
                />
              </div>
              <div style={{ fontSize: 11, color: ENCRE3, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                {p.workloadLevel === 'absent'
                  ? 'Absent toute la semaine'
                  : `${Math.round(p.workloadRatio * 100)} % — ${workloadColors[p.workloadLevel].label}`}
              </div>
            </td>
            <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
              {arrondi(p.hoursLogged)} h <span style={{ color: ENCRE3 }}>/ {arrondi(p.hoursTarget)} h</span>
            </td>
            <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{p.tasksCompleted.length}</td>
            <td style={td}>{formatDureeAbsence(p.absenceDemiJournees)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------ Feuille de route

const LIBELLE_FDR: Record<string, string> = {
  idee: 'Idée',
  planifie: 'Planifié',
  en_cours: 'En cours',
  termine: 'Terminé',
  reporte: 'Reporté',
  abandonne: 'Abandonné',
};

function FeuilleDeRoute({ report }: { report: MeetingReport }) {
  const rm = report.hebdo.roadmap;
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 16px', fontSize: 12.5, color: ENCRE2, marginBottom: 8 }}>
        <span>
          <strong style={{ color: ENCRE }}>{rm.total}</strong> initiative(s)
        </span>
        {(['idee', 'planifie', 'en_cours', 'termine', 'reporte', 'abandonne'] as const)
          .filter((s) => rm.byStatus[s] > 0)
          .map((s) => (
            <span key={s}>
              {LIBELLE_FDR[s]} : <strong style={{ color: ENCRE }}>{rm.byStatus[s]}</strong>
            </span>
          ))}
      </div>
      {rm.inProgress.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, padding: '5px 0', borderTop: `1px solid ${TRAIT}` }}>
          <span style={{ flex: 1, minWidth: 0, color: ENCRE }}>
            {r.title} <span style={{ color: ENCRE3 }}>— {r.domain}</span>
          </span>
          <span style={{ width: 110, flexShrink: 0 }}>
            <span style={{ display: 'block', height: 6, background: '#f1f5f9', borderRadius: 3 }}>
              <span style={{ display: 'block', width: `${Math.max(0, Math.min(r.progress, 100))}%`, height: 6, background: COULEUR_NATURE.Projet, borderRadius: 3 }} />
            </span>
          </span>
          <span style={{ width: 36, textAlign: 'right', color: ENCRE3, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{r.progress} %</span>
        </div>
      ))}
      {rm.notStartedButDue.length > 0 && (
        <div style={{ marginTop: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#78350f' }}>
          <strong style={{ fontWeight: 600 }}>Pas encore démarrée(s) alors que le trimestre cible est atteint :</strong>{' '}
          {rm.notStartedButDue.map((r) => `${r.title} (${r.quarter})`).join(' · ')}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Pied de page

function PiedPage({ report }: { report: MeetingReport }) {
  return (
    <div style={{ marginTop: 24, borderTop: `1px solid ${TRAIT}`, paddingTop: 10, fontSize: 10.5, color: ENCRE3, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span>Suivi Infra &amp; Réseau — document généré automatiquement, chiffres issus des saisies de l'équipe.</span>
      <span style={{ whiteSpace: 'nowrap' }}>{jolieDate(toISODate(report.genereLe))}</span>
    </div>
  );
}
