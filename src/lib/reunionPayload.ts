import { formatDateLong, formatWeekRange, isWeekend, toISODate } from './date';
import {
  compteurNotes,
  COULEUR_ABSENCE,
  COULEUR_NATURE,
  estNature,
  ETIQUETTES_ABSENCE,
  libelleSemaine,
  notesDeSection,
  numeroterSections,
  type CodeCreneau,
  type GroupeNotes,
  type MeetingReport,
} from './meetingReport';
import { weatherMeta } from './weeklyReport';
import { NIVEAUX, resultatMeteo, type ResultatMeteo } from './meteoVote';
import { formatDureeAbsence } from './presence';
import { workloadColors, workloadHex } from './workload';
import type { ProjectTask, TeamMember } from '../types';

/**
 * Le rapport, mis à plat pour le serveur.
 *
 * Le navigateur envoie des CHIFFRES ET DES LIBELLÉS DÉJÀ FORMATÉS, jamais du HTML : le
 * serveur ne fait que de la mise en page, et c'est lui qui échappe le contenu. Deux
 * raisons. D'abord, relayer du HTML fabriqué par un navigateur vers la boîte de toute
 * l'équipe est une mauvaise idée même entre gens de confiance. Ensuite, refaire le calcul
 * côté serveur imposerait de maintenir deux fois la même logique métier, qui aurait dérivé
 * dans six mois — et un rapport envoyé qui ne dit pas la même chose que l'écran est pire
 * que pas de rapport du tout.
 *
 * Conséquence volontaire : aucun arbitrage ici. Tout ce qui demande une décision (quel
 * projet est en retard, quel sujet peut sauter) a déjà été tranché dans meetingReport.ts.
 */

export interface PayloadMeteo {
  /** La météo AFFICHÉE : celle votée par l'équipe quand le vote a abouti, sinon celle calculée. */
  emoji: string;
  label: string;
  /** Le score composite et ses facteurs restent envoyés dans tous les cas : ils disent ce
   *  que montrent les chiffres, que l'équipe les rejoigne ou non. */
  score: number;
  facteurs: string[];
  /** D'où vient la météo affichée, en une phrase — jamais sous-entendu. */
  mention: string;
  /** Le dépouillement, absent tant qu'aucun vote n'a abouti. */
  vote?: {
    repartition: { emoji: string; label: string; n: number }[];
    total: number;
    effectif: number;
    mots: string[];
    /** Ce que disait le calcul, pour l'afficher face au vote. */
    calculEmoji: string;
    calculLabel: string;
    /** Vrai quand le ressenti et les chiffres ne disent pas la même chose. */
    ecart: boolean;
  };
}

export interface PayloadChiffre {
  valeur: string;
  libelle: string;
  sous?: string;
}

export interface PayloadPoint {
  texte: string;
  source: string;
}

export interface PayloadNote {
  /** Déjà mis en forme côté client — le serveur ne refait aucun calcul de date. */
  quand: string;
  auteur: string;
  texte: string;
  retouchee: boolean;
}

export interface PayloadGroupeNotes {
  titre: string;
  nature: string;
  couleur: string;
  projet?: string;
  lignes: PayloadNote[];
}

function groupePayload(g: GroupeNotes): PayloadGroupeNotes {
  return {
    titre: g.titre,
    nature: g.type ?? 'Sujet supprimé',
    couleur: g.type ? COULEUR_NATURE[g.type] : '#94a3b8',
    projet: g.projet,
    lignes: g.notes.map((n) => ({
      quand: formatDateLong(new Date(n.createdAt)),
      auteur: n.auteur,
      texte: n.texte,
      retouchee: n.retouchee,
    })),
  };
}

export interface PayloadIncident {
  id: string;
  titre: string;
  priorite: string;
  /** Rouge pour un critique, orange pour un haut — décidé ici, pas dans le gabarit. */
  couleur: string;
  qui: string;
  ouvertLe: string;
  etat: string;
  enAttente: boolean;
}

export interface PayloadProjet {
  nom: string;
  pilotes: string;
  avance: number;
  /** Part du budget d'heures réellement terminée, affichée à côté de l'avancement déclaré. */
  avanceTerminees: number;
  heures: string;
  depassement: boolean;
  echeance: string;
  fait: string;
  suite: string;
  alerte?: string;
  couleurEtat: string;
}

export interface PayloadRetard {
  id: string;
  titre: string;
  /** Pour une demande : qui attend. Absent pour les autres natures. */
  demandeur?: string;
  nature: string;
  couleurNature: string;
  qui: string;
  echeance: string;
  retard: string;
}

export interface PayloadSujet {
  titre: string;
  projet?: string;
  nature: string;
  couleurNature: string;
  qui: string;
  quand: string;
  reserve?: string;
}

export interface PayloadSemaine {
  label: string;
  remplissage: number;
  sujets: PayloadSujet[];
}

export interface PayloadCase {
  /** null = rien de planifié : le gabarit dessine alors un contour pointillé. */
  couleur: string | null;
  libelle: string;
}

export interface PayloadGrille {
  jours: { label: string; weekend: boolean }[];
  /** Index du jour où commence la deuxième semaine, pour l'écart visuel. */
  coupure: number;
  lignes: { nom: string; cases: PayloadCase[] }[];
  legende: PayloadCase[];
}

export interface PayloadAbsence {
  qui: string;
  quoi: string;
  couleur: string;
  quand: string;
}

export interface PayloadCharge {
  nom: string;
  pourcent: number;
  niveau: string;
  couleur: string;
  saisies: string;
  terminees: number;
  absences: string;
}

export interface PayloadFdr {
  annee: number;
  resume: string;
  enCours: { titre: string; domaine: string; progression: number }[];
  enRetard: string[];
}

export interface ReunionPayload {
  teamLabel: string;
  auteur: string;
  semaineLabel: string;
  semainePrefixe: string;
  dateReunion: string;
  genereLe: string;
  meteo: PayloadMeteo;
  chiffres: PayloadChiffre[];
  points: PayloadPoint[];
  incidents: PayloadIncident[];
  resolus: string[];
  notes: { incidents: PayloadGroupeNotes[]; projets: PayloadGroupeNotes[]; autres: PayloadGroupeNotes[] };
  sections: ReturnType<typeof numeroterSections>;
  marques: { taches: Record<string, number>; projets: Record<string, number> };
  projets: PayloadProjet[];
  retards: PayloadRetard[];
  semaines: PayloadSemaine[];
  grille: PayloadGrille;
  absences: PayloadAbsence[];
  charge: PayloadCharge[];
  fdr?: PayloadFdr;
  /** Mot d'introduction saisi dans la fenêtre d'envoi. */
  mot?: string;
}

const COULEUR_ETAT = { vert: '#16a34a', orange: '#d97706', rouge: '#dc2626' } as const;
const JOURS_COURTS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

function jolieDate(iso?: string): string {
  if (!iso) return '—';
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a.slice(2)}`;
}

function heureCourte(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function arrondi(n: number): number {
  return Math.round(n * 10) / 10;
}

function nomsDe(t: ProjectTask, members: TeamMember[]): string {
  const n = t.assigneeIds.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);
  return n.length > 0 ? n.join(', ') : 'non assigné';
}

function couleurCode(code: CodeCreneau): string | null {
  if (code === 'libre') return null;
  if (estNature(code)) return COULEUR_NATURE[code];
  return COULEUR_ABSENCE[code] ?? '#d9f99d';
}

function libelleCode(code: CodeCreneau): string {
  if (code === 'libre') return 'Non planifié';
  if (estNature(code)) return code;
  return ETIQUETTES_ABSENCE[code] ?? code;
}

function libelleDates(isos: string[]): string {
  if (isos.length === 0) return '—';
  const tries = [...isos].sort();
  if (tries.length === 1) return `le ${jolieDate(tries[0])}`;
  const continu = tries.every((iso, i) => i === 0 || Date.parse(`${iso}T00:00:00`) - Date.parse(`${tries[i - 1]}T00:00:00`) === 86_400_000);
  if (continu) return `du ${jolieDate(tries[0])} au ${jolieDate(tries[tries.length - 1])}`;
  return tries.map(jolieDate).join(', ');
}

export function buildReunionPayload(opts: {
  report: MeetingReport;
  members: TeamMember[];
  teamLabel: string;
  auteur?: string;
  /** Points décochés dans la fenêtre d'envoi : ils ne partent pas. */
  pointsRetires?: string[];
  mot?: string;
  /** Météo retenue, votée ou calculée (voir meteoVote.ts). */
  meteo?: ResultatMeteo;
}): ReunionPayload {
  const { report, members, teamLabel, auteur = '', pointsRetires = [], mot, meteo } = opts;
  const h = report.hebdo;
  const resultat: ResultatMeteo = meteo ?? resultatMeteo(null, h.weather);
  const m = weatherMeta[resultat.niveau];
  const calcul = weatherMeta[h.weather];
  const a = resultat.agregat;
  const s1 = report.semaines[0];
  const compteurs = compteurNotes(report.notes);
  // Le retard se compte depuis la référence qui a servi à le détecter (voir weeklyReport).
  const isoReference = h.referenceRetard;

  // --- Absences des deux semaines, relues depuis la grille (le rapport hebdomadaire ne
  //     porte que S+1) et regroupées par personne et par type.
  const groupes = new Map<string, { qui: string; type: CodeCreneau; jours: string[] }>();
  report.grille.forEach((ligne) => {
    ligne.creneaux.forEach((code, i) => {
      if (estNature(code) || code === 'libre') return;
      const iso = toISODate(report.joursAVenir[Math.floor(i / 2)]);
      const cle = `${ligne.member.id}|${code}`;
      const e = groupes.get(cle) ?? { qui: ligne.member.name, type: code, jours: [] };
      if (!e.jours.includes(iso)) e.jours.push(iso);
      groupes.set(cle, e);
    });
  });

  const presents = new Set<CodeCreneau>();
  for (const l of report.grille) for (const c of l.creneaux) presents.add(c);
  const ordreLegende: CodeCreneau[] = ['Projet', 'Incident', 'Demande', 'MCO', 'conge', 'formation', 'teletravail', 'astreinte', 'autre', 'libre'];

  return {
    teamLabel,
    auteur,
    semaineLabel: formatWeekRange(report.semaineEcoulee),
    /** « Semaine écoulée » ou « Semaine en cours » — calculé côté application, comme le
     *  reste des libellés : le serveur ne refait aucun calcul de date. */
    semainePrefixe: libelleSemaine(report.semaineEcoulee, report.genereLe).prefixe,
    dateReunion: formatDateLong(report.dateReunion),
    genereLe: `${formatDateLong(report.genereLe)}, ${heureCourte(report.genereLe)}`,

    meteo: {
      emoji: m.emoji,
      label: m.label,
      score: h.weatherScore,
      facteurs: h.weatherFactors,
      mention: resultat.mention,
      vote:
        resultat.vote && a
          ? {
              repartition: NIVEAUX.map((n) => ({ emoji: weatherMeta[n].emoji, label: weatherMeta[n].label, n: a.voix[n] ?? 0 })),
              total: a.total,
              effectif: a.effectif,
              mots: a.mots,
              calculEmoji: calcul.emoji,
              calculLabel: calcul.label,
              ecart: h.weather !== resultat.niveau,
            }
          : undefined,
    },

    chiffres: [
      {
        valeur: `${arrondi(h.totalHoursLogged)} h`,
        libelle: `saisies sur ${Math.round(h.totalHoursTarget)} h de capacité`,
        sous: `${Math.round(h.avgWorkloadRatio * 100)} %`,
      },
      { valeur: String(h.tasksCompleted.length), libelle: 'tâches terminées cette semaine' },
      { valeur: `${h.openCriticalIncidents.length} / ${h.incidentsResolved.length}`, libelle: 'incidents ouverts / résolus' },
      { valeur: s1 ? `${Math.round(s1.remplissage * 100)} %` : '—', libelle: 'du planning S+1 déjà rempli' },
    ],

    points: report.points.filter((p) => !pointsRetires.includes(p.id)).map((p) => ({ texte: p.texte, source: p.source })),

    incidents: h.openCriticalIncidents.map((t) => ({
      /** Sert au repère « ✎ N » : le serveur le cherche dans `marques.taches`. */
      id: t.id,
      titre: t.title,
      priorite: t.priority === 'critique' ? 'Critique' : 'Haute',
      couleur: t.priority === 'critique' ? '#b91c1c' : '#ea580c',
      qui: nomsDe(t, members),
      ouvertLe: jolieDate(t.createdAt.slice(0, 10)),
      etat: t.status === 'en_attente' ? 'En attente d’un tiers' : t.status === 'en_cours' ? 'En cours' : 'À faire',
      enAttente: t.status === 'en_attente',
    })),

    resolus: h.incidentsResolved.map((t) => t.title),

    /** Les notes de la semaine, rangées par section — mêmes couleurs, même ordre et même
     *  mise en page que le document : le mail ne doit pas en être une variante. */
    notes: {
      incidents: notesDeSection(report.notes, 'incidents').map(groupePayload),
      projets: notesDeSection(report.notes, 'projets').map(groupePayload),
      autres: notesDeSection(report.notes, 'autres').map(groupePayload),
    },
    /** Les numéros de section, calculés une seule fois côté application (voir
     *  numeroterSections) : le serveur les reprend au lieu de les recalculer, sinon les
     *  deux numérotations finissent par diverger d'un cran. */
    sections: numeroterSections(notesDeSection(report.notes, 'autres').length > 0),
    /** Combien de notes par sujet, pour le repère « ✎ N » des tableaux. */
    marques: {
      taches: Object.fromEntries(compteurs.parTache),
      projets: Object.fromEntries(compteurs.parProjet),
    },

    projets: report.projets.map((p) => ({
      nom: p.nom,
      pilotes: p.pilotes.join(', ') || 'personne d’assigné',
      avance: p.avance,
      avanceTerminees: p.avanceTerminees,
      heures: `${p.heuresPassees} h / ${p.budget} h`,
      depassement: p.budget > 0 && p.heuresPassees > p.budget,
      echeance: jolieDate(p.echeance),
      fait: p.faitCetteSemaine.join(' · ') || 'rien de clos cette semaine',
      suite: p.prochaineEtape ?? '',
      alerte: p.etat === 'vert' ? undefined : p.etatRaison,
      couleurEtat: COULEUR_ETAT[p.etat],
    })),

    retards: h.overdueTasks.map((t) => ({
      id: t.id,
      titre: t.title,
      demandeur: t.demandeur,
      nature: t.type,
      couleurNature: COULEUR_NATURE[t.type],
      qui: nomsDe(t, members),
      echeance: jolieDate(t.dueDate),
      retard: t.dueDate
        ? `+${Math.max(0, Math.round((Date.parse(`${isoReference}T00:00:00`) - Date.parse(`${t.dueDate}T00:00:00`)) / 86_400_000))} j`
        : '—',
    })),

    semaines: report.semaines.map((s) => ({
      label: s.label,
      remplissage: Math.round(s.remplissage * 100),
      sujets: s.sujets.map((l) => ({
        titre: l.titre,
        projet: l.projet,
        nature: l.nature,
        couleurNature: COULEUR_NATURE[l.nature],
        qui: l.qui.join(', ') || '—',
        quand: l.quand,
        reserve: l.reserve ?? (l.sansCreneau ? 'aucune demi-journée réservée pour l’instant' : undefined),
      })),
    })),

    grille: {
      jours: report.joursAVenir.map((j) => ({ label: `${JOURS_COURTS[j.getDay()]} ${j.getDate()}`, weekend: isWeekend(j) })),
      coupure: report.joursAVenir.length / 2,
      lignes: report.grille.map((l) => ({
        nom: l.member.name,
        cases: l.creneaux.map((c) => ({ couleur: couleurCode(c), libelle: libelleCode(c) })),
      })),
      legende: ordreLegende.filter((c) => presents.has(c)).map((c) => ({ couleur: couleurCode(c), libelle: libelleCode(c) })),
    },

    absences: [...groupes.values()].map((g) => ({
      qui: g.qui,
      quoi: libelleCode(g.type),
      couleur: couleurCode(g.type) ?? '#d9f99d',
      quand: libelleDates(g.jours),
    })),

    charge: h.perMember.map((p) => ({
      nom: p.member.name,
      pourcent: Math.round(p.workloadRatio * 100),
      niveau: workloadColors[p.workloadLevel].label,
      couleur: workloadHex[p.workloadLevel],
      /** Absent toute la semaine : capacité nulle, donc hors de l'échelle de charge.
       *  Le mail remplit alors la barre en gris et écrit l'absence au lieu d'un « 0 % »
       *  qui se lirait comme une semaine vide. */
      absent: p.workloadLevel === 'absent',
      saisies: `${arrondi(p.hoursLogged)} h / ${arrondi(p.hoursTarget)} h`,
      terminees: p.tasksCompleted.length,
      absences: formatDureeAbsence(p.absenceDemiJournees),
    })),

    fdr:
      h.roadmap.total > 0
        ? {
            annee: h.roadmap.year,
            resume: `${h.roadmap.total} initiative(s) — ${(['idee', 'planifie', 'en_cours', 'termine', 'reporte', 'abandonne'] as const)
              .filter((s) => h.roadmap.byStatus[s] > 0)
              .map((s) => `${LIBELLE_FDR[s]} : ${h.roadmap.byStatus[s]}`)
              .join(' · ')}`,
            enCours: h.roadmap.inProgress.map((r) => ({ titre: r.title, domaine: r.domain, progression: r.progress })),
            enRetard: h.roadmap.notStartedButDue.map((r) => `${r.title} (${r.quarter})`),
          }
        : undefined,

    mot,
  };
}

const LIBELLE_FDR: Record<string, string> = {
  idee: 'Idée',
  planifie: 'Planifié',
  en_cours: 'En cours',
  termine: 'Terminé',
  reporte: 'Reporté',
  abandonne: 'Abandonné',
};

/** Objet par défaut du message. La météo y figure : c'est l'information qu'on veut voir
 *  dans la liste des messages sans ouvrir. */
export function objetParDefaut(payload: ReunionPayload): string {
  const jour = payload.dateReunion ? payload.dateReunion.replace(/^\w/, (c) => c.toUpperCase()) : '';
  return `Réunion d'équipe${jour ? ` — ${jour}` : ''} · ${payload.meteo.label} ${payload.meteo.emoji}`;
}
