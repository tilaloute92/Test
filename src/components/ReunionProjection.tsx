import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateLong, toISODate } from '../lib/date';
import { COULEUR_ABSENCE, COULEUR_NATURE, ETIQUETTES_ABSENCE, type MeetingReport } from '../lib/meetingReport';
import { weatherMeta } from '../lib/weeklyReport';
import { NIVEAUX, resultatMeteo, type ResultatMeteo } from '../lib/meteoVote';
import type { ProjectTask, TeamMember } from '../types';

/**
 * Vue Projection : un écran par section, lisible du fond de la salle.
 *
 * Elle remplace le PowerPoint refait chaque semaine. Fond clair volontairement, comme le
 * document : un vidéoprojecteur rend un fond sombre gris sale, et la salle est rarement
 * dans le noir.
 */

const ENCRE = '#0f172a';
const ENCRE2 = '#475569';
const ENCRE3 = '#94a3b8';
const TRAIT = '#e2e8f0';
const POLICE = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

export function ReunionProjection({
  report,
  members,
  teamLabel,
  meteo: meteoRetenue,
}: {
  report: MeetingReport;
  members: TeamMember[];
  teamLabel: string;
  meteo?: ResultatMeteo;
}) {
  const resultat = meteoRetenue ?? resultatMeteo(null, report.hebdo.weather);
  const ecrans = useMemo(() => construireEcrans(report, members, resultat), [report, members, resultat]);
  const [index, setIndex] = useState(0);
  const total = ecrans.length;

  const aller = useCallback((d: number) => setIndex((i) => Math.min(total - 1, Math.max(0, i + d))), [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // On ne détourne pas les flèches quand l'utilisateur est dans un champ : il
      // déplacerait son curseur et changerait d'écran en même temps.
      const cible = e.target as HTMLElement | null;
      if (cible && /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') aller(1);
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') aller(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aller]);

  const ecran = ecrans[Math.min(index, total - 1)];
  const meteo = weatherMeta[resultat.niveau];

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-slate-200/60 p-4 dark:bg-slate-800">
        <div
          style={{
            // 16/9 : c'est le format des écrans de salle de réunion, et c'est aussi
            // celui du plein écran une fois la touche F pressée.
            aspectRatio: '16 / 9',
            width: '100%',
            maxWidth: 960,
            margin: '0 auto',
            background: '#fff',
            color: ENCRE,
            borderRadius: 10,
            boxShadow: '0 1px 3px rgba(15,23,42,.18)',
            fontFamily: POLICE,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 28px', borderBottom: `1px solid ${TRAIT}` }}>
            <span style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: ENCRE3 }}>
              {teamLabel}
              {report.dateReunion ? ` · ${formatDateLong(report.dateReunion)}` : ''}
            </span>
            <span style={{ fontSize: 13, color: ENCRE2, whiteSpace: 'nowrap' }}>
              {meteo.emoji} {meteo.label} · {Math.round(report.hebdo.avgWorkloadRatio * 100)} % de charge
            </span>
          </div>

          <div style={{ flex: 1, padding: '22px 36px', minHeight: 0, overflow: 'hidden' }}>{ecran.contenu}</div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 28px', borderTop: `1px solid ${TRAIT}`, fontSize: 12, color: ENCRE3 }}>
            <span>
              {index + 1} / {total} — {ecran.titre}
            </span>
            <span className="print:hidden">Flèches ← → pour naviguer</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 print:hidden">
        {ecrans.map((e, i) => (
          <button
            key={e.titre}
            onClick={() => setIndex(i)}
            className={`rounded-lg border px-2.5 py-1 text-xs ${
              index === i
                ? 'border-violet-300 bg-violet-50 font-medium text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {i + 1}. {e.titre}
          </button>
        ))}
      </div>
    </div>
  );
}

interface Ecran {
  titre: string;
  contenu: React.ReactNode;
}

function construireEcrans(report: MeetingReport, members: TeamMember[], meteo: ResultatMeteo): Ecran[] {
  const h = report.hebdo;
  const ecrans: Ecran[] = [];

  ecrans.push({ titre: 'Points à aborder', contenu: <EcranPoints report={report} /> });
  ecrans.push({ titre: 'Météo & chiffres', contenu: <EcranChiffres report={report} meteo={meteo} /> });
  if (h.openCriticalIncidents.length > 0 || h.incidentsResolved.length > 0) {
    ecrans.push({ titre: 'Incidents', contenu: <EcranIncidents report={report} members={members} /> });
  }
  if (report.projets.length > 0) {
    ecrans.push({ titre: 'Projets', contenu: <EcranProjets report={report} /> });
  }
  ecrans.push({ titre: 'Deux semaines', contenu: <EcranSujets report={report} /> });
  ecrans.push({ titre: 'Absences', contenu: <EcranAbsences report={report} /> });

  // Un écran vide projeté devant l'équipe est pire qu'un écran en moins : les sections
  // sans contenu ne sont pas ajoutées du tout.
  return ecrans;
}

function Titre({ children, apres }: { children: React.ReactNode; apres?: string }) {
  return (
    <div style={{ fontSize: 26, fontWeight: 600, marginBottom: 16 }}>
      {children}
      {apres && <span style={{ fontSize: 15, fontWeight: 400, color: ENCRE3 }}> — {apres}</span>}
    </div>
  );
}

function Rien({ texte }: { texte: string }) {
  return <div style={{ fontSize: 17, color: ENCRE3 }}>{texte}</div>;
}

function EcranPoints({ report }: { report: MeetingReport }) {
  return (
    <>
      <Titre>Points à aborder</Titre>
      {report.points.length === 0 ? (
        <Rien texte="Rien que les données signalent cette semaine." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {report.points.slice(0, 6).map((p, i) => (
            <div key={p.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 14, background: '#ede9fe', color: '#6d28d9', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {i + 1}
              </span>
              <span style={{ fontSize: 17, lineHeight: 1.35 }}>{p.texte}</span>
            </div>
          ))}
          {report.points.length > 6 && (
            <div style={{ fontSize: 14, color: ENCRE3 }}>+ {report.points.length - 6} autre(s), dans le document complet.</div>
          )}
        </div>
      )}
    </>
  );
}

function EcranChiffres({ report, meteo }: { report: MeetingReport; meteo: ResultatMeteo }) {
  const h = report.hebdo;
  const m = weatherMeta[meteo.niveau];
  const vote = meteo.vote && meteo.agregat ? meteo.agregat : null;
  const s1 = report.semaines[0];
  const tuiles: [string, string][] = [
    [`${Math.round(h.totalHoursLogged * 10) / 10} h`, `saisies sur ${Math.round(h.totalHoursTarget)} h`],
    [String(h.tasksCompleted.length), 'tâches terminées'],
    [`${h.openCriticalIncidents.length} / ${h.incidentsResolved.length}`, 'incidents ouverts / résolus'],
    [s1 ? `${Math.round(s1.remplissage * 100)} %` : '—', 'du planning S+1 rempli'],
  ];
  return (
    <>
      <Titre>La semaine en quatre chiffres</Titre>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {tuiles.map(([v, l]) => (
          <div key={l} style={{ border: `1px solid ${TRAIT}`, borderRadius: 10, padding: '18px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            <div style={{ fontSize: 13, color: ENCRE2, marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 16, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '14px 18px' }}>
        <span style={{ fontSize: 38 }}>{m.emoji}</span>
        <span style={{ fontSize: 16, color: '#78350f' }}>
          <strong>{m.label}</strong>
          {vote ? (
            <>
              {' '}
              — {NIVEAUX.filter((n) => (vote.voix[n] ?? 0) > 0)
                .map((n) => `${vote.voix[n]} ${weatherMeta[n].label.toLowerCase()}`)
                .join(', ')}
              . Les chiffres, eux : {weatherMeta[h.weather].label.toLowerCase()}, {h.weatherFactors.join(', ').toLowerCase()}.
            </>
          ) : (
            <> — {h.weatherFactors.join(', ').toLowerCase()}.</>
          )}
          <div style={{ fontSize: 13, marginTop: 4, color: '#92400e' }}>{meteo.mention}</div>
        </span>
      </div>
    </>
  );
}

function nomsDe(t: ProjectTask, members: TeamMember[]): string {
  const n = t.assigneeIds.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);
  return n.length > 0 ? n.join(', ') : 'non assigné';
}

function EcranIncidents({ report, members }: { report: MeetingReport; members: TeamMember[] }) {
  const h = report.hebdo;
  return (
    <>
      <Titre>Incidents ouverts</Titre>
      {h.openCriticalIncidents.length === 0 ? (
        <Rien texte="Aucun incident critique ou haut encore ouvert." />
      ) : (
        h.openCriticalIncidents.slice(0, 5).map((t) => (
          <div key={t.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '11px 0', borderTop: `1px solid ${TRAIT}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: t.priority === 'critique' ? '#b91c1c' : '#ea580c', borderRadius: 4, padding: '2px 7px', marginTop: 3, whiteSpace: 'nowrap' }}>
              {t.priority === 'critique' ? 'Critique' : 'Haute'}
            </span>
            <span>
              <div style={{ fontSize: 17, fontWeight: 500 }}>{t.title}</div>
              <div style={{ fontSize: 13, color: ENCRE2, marginTop: 2 }}>
                {nomsDe(t, members)}
                {t.status === 'en_attente' && <span style={{ color: '#b45309' }}> · en attente d’un tiers</span>}
              </div>
            </span>
          </div>
        ))
      )}
      {h.incidentsResolved.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 14, color: '#166534' }}>
          <strong>Résolus cette semaine ({h.incidentsResolved.length})</strong> — {h.incidentsResolved.map((t) => t.title).join(' · ')}
        </div>
      )}
    </>
  );
}

function EcranProjets({ report }: { report: MeetingReport }) {
  const couleurEtat = { vert: '#16a34a', orange: '#d97706', rouge: '#dc2626' } as const;
  return (
    <>
      <Titre>Projets</Titre>
      {report.projets.slice(0, 6).map((p) => (
        <div key={p.nom} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 0', borderTop: `1px solid ${TRAIT}` }}>
          <span style={{ width: 9, height: 9, borderRadius: 9, background: couleurEtat[p.etat], flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{p.nom}</div>
            <div style={{ fontSize: 13, color: p.etat === 'vert' ? ENCRE2 : '#b45309' }}>
              {p.etat === 'vert' ? p.prochaineEtape ? `→ ${p.prochaineEtape}` : 'rien à signaler' : `⚠ ${p.etatRaison}`}
            </div>
          </span>
          <span style={{ width: 150, flexShrink: 0 }}>
            <span style={{ display: 'block', height: 8, background: '#f1f5f9', borderRadius: 4 }}>
              <span style={{ display: 'block', width: `${Math.min(100, p.avance)}%`, height: 8, background: COULEUR_NATURE.Projet, borderRadius: 4 }} />
            </span>
          </span>
          <span style={{ width: 96, textAlign: 'right', fontSize: 14, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            <strong>{p.avance} %</strong>
          </span>
        </div>
      ))}
    </>
  );
}

function EcranSujets({ report }: { report: MeetingReport }) {
  return (
    <>
      <Titre apres="sous réserve">Les deux semaines à venir</Titre>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {report.semaines.map((s) => (
          <div key={s.label}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: ENCRE3, marginBottom: 6 }}>
              {s.label}
            </div>
            {s.sujets.length === 0 ? (
              <div style={{ fontSize: 14, color: ENCRE3 }}>Rien de planifié ni d'échu.</div>
            ) : (
              s.sujets.slice(0, 6).map((l) => (
                <div key={l.taskId} style={{ display: 'flex', gap: 8, padding: '5px 0', borderTop: `1px solid ${TRAIT}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: COULEUR_NATURE[l.nature], flexShrink: 0, marginTop: 5 }} />
                  <span style={{ fontSize: 14, lineHeight: 1.3 }}>
                    {l.titre}
                    {(l.reserve || l.sansCreneau) && <span style={{ color: '#b45309' }}> ⚠</span>}
                  </span>
                </div>
              ))
            )}
            {s.sujets.length > 6 && <div style={{ fontSize: 12, color: ENCRE3, marginTop: 4 }}>+ {s.sujets.length - 6} autre(s)</div>}
          </div>
        ))}
      </div>
    </>
  );
}

function EcranAbsences({ report }: { report: MeetingReport }) {
  // Une ligne par personne et par type, agrégée sur les deux semaines.
  const lignes = new Map<string, { nom: string; type: string; jours: string[] }>();
  report.grille.forEach((ligne) => {
    ligne.creneaux.forEach((code, i) => {
      if (code === 'MCO' || code === 'Incident' || code === 'Projet' || code === 'libre') return;
      const jour = report.joursAVenir[Math.floor(i / 2)];
      const cle = `${ligne.member.id}|${code}`;
      const entree = lignes.get(cle) ?? { nom: ligne.member.name, type: code, jours: [] };
      const iso = toISODate(jour);
      if (!entree.jours.includes(iso)) entree.jours.push(iso);
      lignes.set(cle, entree);
    });
  });

  return (
    <>
      <Titre>Absences sur les deux semaines</Titre>
      {lignes.size === 0 ? (
        <Rien texte="Aucune absence prévue — toute l'équipe est là." />
      ) : (
        [...lignes.values()].map((l) => (
          <div key={`${l.nom}-${l.type}`} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', borderTop: `1px solid ${TRAIT}` }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: COULEUR_ABSENCE[l.type as keyof typeof COULEUR_ABSENCE] ?? '#d9f99d', flexShrink: 0 }} />
            <span style={{ fontSize: 17, fontWeight: 500, width: 180 }}>{l.nom}</span>
            <span style={{ fontSize: 16, color: ENCRE2, width: 180 }}>{ETIQUETTES_ABSENCE[l.type as keyof typeof ETIQUETTES_ABSENCE] ?? l.type}</span>
            <span style={{ fontSize: 16, color: ENCRE2 }}>{l.jours.length} demi-journée(s) · {resume(l.jours)}</span>
          </div>
        ))
      )}
    </>
  );
}

function resume(isos: string[]): string {
  const tries = [...isos].sort();
  const f = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return `${['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'][d.getDay()]} ${d.getDate()}`;
  };
  if (tries.length === 1) return f(tries[0]);
  return `${f(tries[0])} → ${f(tries[tries.length - 1])}`;
}
