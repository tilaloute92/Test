import { formatWeekRange, toISODate } from '../lib/date';
import { COULEUR_ABSENCE, COULEUR_NATURE, ETIQUETTES_ABSENCE, type MeetingReport } from '../lib/meetingReport';
import { weatherMeta } from '../lib/weeklyReport';
import { resultatMeteo, type ResultatMeteo } from '../lib/meteoVote';
import type { TeamMember } from '../types';

/**
 * Vue Synthèse : tout sur une page, sans défiler.
 *
 * Elle s'adresse à qui n'était pas dans la salle — la direction, un collègue d'une autre
 * équipe. Elle coupe donc au lieu de résumer : six sujets, trois incidents, le reste
 * renvoie au document complet. Un « résumé » qui reprend tout n'est qu'un document long
 * écrit en plus petit.
 */

const ENCRE = '#0f172a';
const ENCRE2 = '#475569';
const ENCRE3 = '#94a3b8';
const TRAIT = '#e2e8f0';
const POLICE = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

export function ReunionSynthese({
  report,
  members,
  teamLabel,
  auteur,
  meteo,
}: {
  report: MeetingReport;
  members: TeamMember[];
  teamLabel: string;
  auteur?: string;
  meteo?: ResultatMeteo;
}) {
  const h = report.hebdo;
  const resultat = meteo ?? resultatMeteo(null, h.weather);
  const m = weatherMeta[resultat.niveau];
  const s1 = report.semaines[0];
  const sujets = report.semaines.flatMap((s) => s.sujets);

  return (
    <div className="overflow-x-auto rounded-xl bg-slate-200/60 p-4 print:bg-white print:p-0 dark:bg-slate-800">
      <div
        id="document-reunion"
        style={{
          maxWidth: 820,
          margin: '0 auto',
          background: '#fff',
          color: ENCRE,
          borderRadius: 8,
          padding: '18px 22px 20px',
          fontFamily: POLICE,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, borderBottom: `2px solid ${ENCRE}`, paddingBottom: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {teamLabel} — semaine du {formatWeekRange(report.semaineEcoulee)}
            </div>
            <div style={{ fontSize: 12, color: ENCRE3 }}>
              Synthèse pour la réunion du {report.dateReunion.getDate()}/{report.dateReunion.getMonth() + 1}
              {auteur ? ` · ${auteur}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px' }}>
            <span style={{ fontSize: 18 }}>{m.emoji}</span>
            <span style={{ fontSize: 13, color: '#78350f' }}>
              <strong>{m.label}</strong> · charge {Math.round(h.avgWorkloadRatio * 100)} %
              {/* La synthèse part à qui n'était pas là : sans cette ligne, rien ne dirait
                  si la météo vient de l'équipe ou d'un calcul. */}
              <span style={{ display: 'block', fontSize: 11, color: '#92400e' }}>{resultat.mention}</span>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', margin: '10px 0 14px', fontSize: 13, color: ENCRE2 }}>
          <span>
            <strong style={{ fontSize: 17, color: ENCRE }}>{Math.round(h.totalHoursLogged * 10) / 10} h</strong> / {Math.round(h.totalHoursTarget)} h saisies
          </span>
          <span>
            <strong style={{ fontSize: 17, color: ENCRE }}>{h.tasksCompleted.length}</strong> terminées
          </span>
          <span>
            <strong style={{ fontSize: 17, color: ENCRE }}>{h.openCriticalIncidents.length}</strong> incidents ouverts
          </span>
          <span>
            <strong style={{ fontSize: 17, color: h.overdueTasks.length > 0 ? '#b91c1c' : ENCRE }}>{h.overdueTasks.length}</strong> en retard
          </span>
          {s1 && (
            <span>
              <strong style={{ fontSize: 17, color: ENCRE }}>{Math.round(s1.remplissage * 100)} %</strong> du planning S+1 rempli
            </span>
          )}
        </div>

        <Titre>À arbitrer en réunion</Titre>
        {report.points.length === 0 ? (
          <Rien texte="Rien que les données signalent cette semaine." />
        ) : (
          <ol style={{ margin: '0 0 14px', paddingLeft: 18, listStyle: 'decimal', fontSize: 13, lineHeight: 1.5, color: ENCRE }}>
            {report.points.slice(0, 5).map((p) => (
              <li key={p.id} style={{ marginBottom: 2 }}>
                {p.texte}
              </li>
            ))}
          </ol>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          <div>
            <Titre>Incidents ouverts</Titre>
            {h.openCriticalIncidents.length === 0 ? (
              <Rien texte="Aucun." />
            ) : (
              h.openCriticalIncidents.slice(0, 4).map((t) => (
                <div key={t.id} style={{ fontSize: 12.5, padding: '4px 0', borderTop: `1px solid ${TRAIT}` }}>
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, background: t.priority === 'critique' ? '#b91c1c' : '#ea580c', marginRight: 6 }} />
                  {t.title}
                  <div style={{ color: ENCRE3, fontSize: 11, marginLeft: 13 }}>
                    {t.assigneeIds.map((id) => members.find((x) => x.id === id)?.name).filter(Boolean).join(', ') || 'non assigné'}
                  </div>
                </div>
              ))
            )}

            <Titre style={{ marginTop: 14 }}>Absences à venir</Titre>
            <Absences report={report} />
          </div>

          <div>
            <Titre>Projets</Titre>
            {report.projets.length === 0 ? (
              <Rien texte="Aucun projet suivi." />
            ) : (
              report.projets.slice(0, 6).map((p) => (
                <div key={p.nom} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0', borderTop: `1px solid ${TRAIT}` }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.nom}>
                    {p.nom}
                  </span>
                  <span style={{ width: 70, flexShrink: 0 }}>
                    <span style={{ display: 'block', height: 6, background: '#f1f5f9', borderRadius: 3 }}>
                      <span style={{ display: 'block', width: `${Math.min(100, p.avance)}%`, height: 6, background: COULEUR_NATURE.Projet, borderRadius: 3 }} />
                    </span>
                  </span>
                  <span style={{ width: 34, textAlign: 'right', color: ENCRE3, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{p.avance} %</span>
                </div>
              ))
            )}

            <Titre style={{ marginTop: 14 }}>Sujets des deux semaines — sous réserve</Titre>
            {sujets.length === 0 ? (
              <Rien texte="Rien de planifié ni d'échu." />
            ) : (
              sujets.slice(0, 6).map((l) => (
                <div key={l.taskId} style={{ fontSize: 12.5, padding: '3px 0', borderTop: `1px solid ${TRAIT}`, color: ENCRE2 }}>
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 2, background: COULEUR_NATURE[l.nature], marginRight: 6 }} />
                  {l.titre}
                  {(l.reserve || l.sansCreneau) && <span style={{ color: '#b45309' }}> ⚠</span>}
                </div>
              ))
            )}
            <div style={{ fontSize: 11, color: ENCRE3, marginTop: 4 }}>
              ⚠ = sujet qui peut sauter.
              {sujets.length > 6 ? ` ${sujets.length - 6} autre(s) sujet(s) et la` : ' La'} grille jour par jour sont dans la
              vue Réunion.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Titre({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: ENCRE3, marginBottom: 4, ...style }}>
      {children}
    </div>
  );
}

function Rien({ texte }: { texte: string }) {
  return <div style={{ fontSize: 12.5, color: ENCRE3, marginBottom: 6 }}>{texte}</div>;
}

function Absences({ report }: { report: MeetingReport }) {
  const lignes = new Map<string, { nom: string; type: string; jours: string[] }>();
  report.grille.forEach((ligne) => {
    ligne.creneaux.forEach((code, i) => {
      if (code === 'MCO' || code === 'Incident' || code === 'Projet' || code === 'libre') return;
      const iso = toISODate(report.joursAVenir[Math.floor(i / 2)]);
      const cle = `${ligne.member.id}|${code}`;
      const e = lignes.get(cle) ?? { nom: ligne.member.name, type: code, jours: [] };
      if (!e.jours.includes(iso)) e.jours.push(iso);
      lignes.set(cle, e);
    });
  });

  if (lignes.size === 0) return <Rien texte="Aucune — toute l'équipe est là." />;

  return (
    <>
      {[...lignes.values()].map((l) => (
        // Pastille dans sa propre colonne : en pastille « en ligne », la deuxième ligne
        // d'une absence longue repartait sous elle, collée à la marge.
        <div key={`${l.nom}-${l.type}`} style={{ display: 'flex', gap: 6, fontSize: 12.5, padding: '3px 0', borderTop: `1px solid ${TRAIT}`, color: ENCRE2 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: COULEUR_ABSENCE[l.type as keyof typeof COULEUR_ABSENCE] ?? '#d9f99d', flexShrink: 0, marginTop: 5 }} />
          <span>
            <strong style={{ color: ENCRE, fontWeight: 600 }}>{l.nom}</strong> —{' '}
            {ETIQUETTES_ABSENCE[l.type as keyof typeof ETIQUETTES_ABSENCE] ?? l.type}, {l.jours.length} demi-journée(s)
          </span>
        </div>
      ))}
    </>
  );
}
