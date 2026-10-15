import { addDays, formatDayLabel, formatWeekRange, getWorkingDaysOfWeek, startOfWeek, toISODate } from './date';
import type { Recurrence } from './recurrences';
import { computeWeeklyReport, type WeeklyReport } from './weeklyReport';
import { isAbsent } from './workload';
import { jourCourt, pourcent, presenceJours, SEUIL_PRESENCE_DEFAUT } from './presence';
import type { Absence, AbsenceType, PlanningSlot, ProjectTask, TeamMember, TimeEntry } from '../types';

/**
 * Rapport de réunion d'équipe.
 *
 * Le rapport hebdomadaire (voir weeklyReport.ts) répond à « qu'est-ce qui s'est passé ? ».
 * Celui-ci sert à tenir la réunion du lundi : il ajoute ce qu'on y arbitre — les projets,
 * les sujets des deux semaines à venir, et surtout l'ordre du jour, déduit des données
 * plutôt que retapé chaque semaine de mémoire.
 *
 * Tout est calculé à la demande, rien n'est stocké : un rapport enregistré serait un
 * rapport périmé, et personne ne saurait dire de quand datent ses chiffres.
 */

/**
 * Jour de la réunion d'équipe, au sens de Date.getDay() — 5 = vendredi.
 *
 * Le rapport porte sur la semaine qui s'achève et sur les deux suivantes : la réunion a
 * donc lieu À LA FIN de la semaine rapportée, pas au début de la suivante. L'annoncer un
 * lundi, comme c'était le cas, datait le document du mauvais jour et faisait lire « les
 * deux semaines à venir » à partir d'une semaine déjà entamée.
 */
export const JOUR_REUNION = 5;

/** Nombre de jours sans aucune heure saisie à partir duquel un projet est dit à l'arrêt. */
const JOURS_SANS_ACTIVITE_ALERTE = 14;
const JOURS_SANS_ACTIVITE_GRAVE = 21;
/** Au-delà, un incident « en attente » n'attend plus, il est oublié. */
const JOURS_EN_ATTENTE_ALERTE = 5;

/**
 * Couleurs des natures de travail, partagées par les trois vues et par le rendu serveur.
 *
 * Validées au préalable (bande de clarté, saturation minimale, séparation protan/deutan/
 * tritan, contraste sur fond clair comme sur fond sombre) : ce ne sont pas les teintes des
 * pastilles de la liste des tâches, dont le gris du MCO ne se distingue pas assez et dont
 * l'écart Projet/Incident tombe à 4,1 en vision protan.
 */
export const COULEUR_NATURE: Record<ProjectTask['type'], string> = {
  Projet: '#7c3aed',
  Incident: '#ea580c',
  MCO: '#0d9488',
};

/** Les absences sont en pastel : ce n'est pas du travail sur une tâche, et la grille doit
 *  le dire d'un coup d'œil sans qu'on aille lire la légende. */
export const COULEUR_ABSENCE: Record<AbsenceType, string> = {
  conge: '#fde68a',
  formation: '#bfdbfe',
  teletravail: '#cbd5e1',
  astreinte: '#fbcfe8',
  autre: '#d9f99d',
};

export const ETIQUETTES_ABSENCE: Record<AbsenceType, string> = {
  conge: 'Congés',
  formation: 'Formation',
  teletravail: 'Télétravail',
  astreinte: 'Astreinte',
  autre: 'Absence',
};

// ----------------------------------------------------------------- Projets

export type EtatProjet = 'vert' | 'orange' | 'rouge';

export interface ProjetRollup {
  nom: string;
  /** Noms des personnes assignées aux tâches du projet, les plus présentes d'abord. */
  pilotes: string[];
  /** 0–100. Part du budget d'heures portée par les tâches terminées (voir calculeAvancement). */
  avance: number;
  heuresPassees: number;
  /** Somme des charges estimées de toutes les tâches du projet, terminées ou non. */
  budget: number;
  /** Échéance la plus lointaine parmi les tâches encore ouvertes (AAAA-MM-JJ). */
  echeance?: string;
  etat: EtatProjet;
  /** Pourquoi cet état : affiché tel quel, l'état ne doit jamais être une boîte noire. */
  etatRaison: string;
  /** Titres des tâches du projet terminées dans la semaine écoulée. */
  faitCetteSemaine: string[];
  /** Prochaine tâche ouverte, par échéance puis par priorité. */
  prochaineEtape?: string;
  /** Jours écoulés depuis la dernière heure saisie sur le projet. null = jamais rien saisi. */
  joursSansActivite: number | null;
  tachesEnRetard: number;
}

/**
 * Avancement d'un projet : part des heures ESTIMÉES que portent ses tâches terminées.
 *
 * Volontairement pas « nombre de tâches terminées / nombre de tâches » : un projet de dix
 * tâches dont neuf font une heure et la dixième quarante afficherait 90 % alors qu'il
 * reste l'essentiel à faire. Quand aucune tâche n'est estimée — c'est fréquent au début —
 * on retombe sur le comptage, en le disant.
 */
function calculeAvancement(taches: ProjectTask[]): number {
  const budget = taches.reduce((s, t) => s + t.estimatedHours, 0);
  if (budget > 0) {
    const fait = taches.filter((t) => t.status === 'termine').reduce((s, t) => s + t.estimatedHours, 0);
    return Math.round((fait / budget) * 100);
  }
  if (taches.length === 0) return 0;
  return Math.round((taches.filter((t) => t.status === 'termine').length / taches.length) * 100);
}

function joursDepuis(iso: string, reference: Date): number {
  const d = new Date(`${iso}T00:00:00`);
  return Math.max(0, Math.round((reference.getTime() - d.getTime()) / 86_400_000));
}

function nomsDe(ids: string[], members: TeamMember[]): string[] {
  return ids.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => Boolean(n));
}

export function rollupProjets(opts: {
  tasks: ProjectTask[];
  timeEntries: TimeEntry[];
  members: TeamMember[];
  semaineEcoulee: Date[];
  aujourdhui: Date;
}): ProjetRollup[] {
  const { tasks, timeEntries, members, semaineEcoulee, aujourdhui } = opts;
  const isoSemaine = new Set(semaineEcoulee.map(toISODate));
  const isoAujourdhui = toISODate(aujourdhui);

  const parProjet = new Map<string, ProjectTask[]>();
  for (const t of tasks) {
    if (!t.project) continue;
    const liste = parProjet.get(t.project) ?? [];
    liste.push(t);
    parProjet.set(t.project, liste);
  }

  const projets: ProjetRollup[] = [];
  for (const [nom, taches] of parProjet) {
    const ids = new Set(taches.map((t) => t.id));
    const saisies = timeEntries.filter((e) => ids.has(e.taskId));
    const heuresPassees = saisies.reduce((s, e) => s + e.hours, 0);
    const derniere = saisies.map((e) => e.date).sort().at(-1);
    const joursSansActivite = derniere ? joursDepuis(derniere, aujourdhui) : null;

    const ouvertes = taches.filter((t) => t.status !== 'termine');
    const echeances = ouvertes.map((t) => t.dueDate).filter((d): d is string => Boolean(d)).sort();
    const tachesEnRetard = ouvertes.filter((t) => t.dueDate && t.dueDate < isoAujourdhui).length;

    // Qui porte le projet : les personnes les plus souvent assignées à ses tâches.
    const compte = new Map<string, number>();
    for (const t of taches) for (const id of t.assigneeIds) compte.set(id, (compte.get(id) ?? 0) + 1);
    const pilotes = nomsDe(
      [...compte.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
      members
    ).slice(0, 2);

    const avance = calculeAvancement(taches);

    let etat: EtatProjet = 'vert';
    let etatRaison = 'rien à signaler';
    if (joursSansActivite === null && heuresPassees === 0 && ouvertes.length > 0) {
      etat = 'orange';
      etatRaison = 'aucune heure saisie à ce jour';
    }
    if (joursSansActivite !== null && joursSansActivite >= JOURS_SANS_ACTIVITE_ALERTE && ouvertes.length > 0) {
      etat = joursSansActivite >= JOURS_SANS_ACTIVITE_GRAVE ? 'rouge' : 'orange';
      etatRaison = `aucune heure saisie depuis ${joursSansActivite} jours`;
    }
    // Budget dépassé : un projet qui a consommé plus d'heures qu'il n'en avait de prévu
    // n'est pas « au vert » parce que personne n'a saisi de retard — c'est souvent le
    // premier signe, et le seul avant que l'échéance ne tombe.
    const budget = taches.reduce((s, t) => s + t.estimatedHours, 0);
    if (budget > 0 && heuresPassees > budget) {
      etat = 'orange';
      etatRaison = `budget dépassé : ${Math.round(heuresPassees)} h consommées sur ${budget} h prévues`;
    }
    if (tachesEnRetard > 0) {
      etat = etat === 'rouge' ? 'rouge' : 'orange';
      etatRaison = `${tachesEnRetard} tâche(s) en retard`;
    }
    if (echeances[0] && echeances[0] < isoAujourdhui) {
      etat = 'rouge';
      etatRaison = 'échéance dépassée';
    }

    const prochaine = [...ouvertes].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))[0];

    projets.push({
      nom,
      pilotes,
      avance,
      heuresPassees: Math.round(heuresPassees * 10) / 10,
      budget,
      echeance: echeances.at(-1),
      etat,
      etatRaison,
      faitCetteSemaine: taches
        .filter((t) => t.completedAt && isoSemaine.has(t.completedAt.slice(0, 10)))
        .map((t) => t.title),
      prochaineEtape: prochaine?.title,
      joursSansActivite,
      tachesEnRetard,
    });
  }

  // Les projets en difficulté d'abord : c'est d'eux qu'on parle en réunion.
  const rang: Record<EtatProjet, number> = { rouge: 0, orange: 1, vert: 2 };
  return projets.sort((a, b) => rang[a.etat] - rang[b.etat] || b.heuresPassees - a.heuresPassees);
}

// ----------------------------------------------------- Sujets des deux semaines

export interface SujetPrevu {
  taskId: string;
  titre: string;
  nature: ProjectTask['type'];
  projet?: string;
  qui: string[];
  /** « lun 19 – mer 21 », ou « échéance 22/10 » quand aucun créneau n'est réservé. */
  quand: string;
  /** Ce qui peut faire tomber le sujet. Vide = aucune réserve identifiée — pas « c'est sûr ». */
  reserve?: string;
  /** Échéance dans la fenêtre mais aucune demi-journée réservée. */
  sansCreneau: boolean;
}

export interface SemainePrevue {
  label: string;
  jours: Date[];
  /** Part des demi-journées planifiables déjà attribuées (hors absences). */
  remplissage: number;
  sujets: SujetPrevu[];
}

function libelleCreneaux(jours: Date[]): string {
  if (jours.length === 0) return '';
  if (jours.length === 1) return formatDayLabel(jours[0]).toLowerCase();
  const tries = [...jours].sort((a, b) => a.getTime() - b.getTime());
  return `${formatDayLabel(tries[0]).toLowerCase()} – ${formatDayLabel(tries[tries.length - 1]).toLowerCase()}`;
}

/**
 * Ce qui sera traité dans les deux semaines — sous réserve, et le mot n'est pas une
 * formule : la liste sort du planning et des échéances, qu'un seul incident suffit à
 * rebattre. Les sujets dont on sait DÉJÀ qu'ils peuvent sauter portent leur raison.
 */
export function construireSujets(opts: {
  semaines: Date[][];
  tasks: ProjectTask[];
  members: TeamMember[];
  planningSlots: PlanningSlot[];
  absences: Absence[];
  aujourdhui: Date;
}): SemainePrevue[] {
  const { semaines, tasks, members, planningSlots, absences, aujourdhui } = opts;
  const isoAujourdhui = toISODate(aujourdhui);

  return semaines.map((jours) => {
    const isoJours = jours.map(toISODate);
    const dansLaSemaine = new Set(isoJours);

    // Créneaux attribués de la semaine, regroupés par tâche.
    const parTache = new Map<string, { jours: Set<string>; membres: Set<string> }>();
    let planifiables = 0;
    let attribues = 0;
    for (const jour of jours) {
      for (const periode of ['matin', 'apres_midi'] as const) {
        for (const m of members) {
          if (isAbsent(absences, m.id, jour, periode)) continue;
          planifiables += 1;
          const slot = planningSlots.find(
            (s) => s.memberId === m.id && s.date === toISODate(jour) && s.period === periode
          );
          if (!slot?.taskId) continue;
          attribues += 1;
          const entree = parTache.get(slot.taskId) ?? { jours: new Set(), membres: new Set() };
          entree.jours.add(toISODate(jour));
          entree.membres.add(m.id);
          parTache.set(slot.taskId, entree);
        }
      }
    }

    const sujets: SujetPrevu[] = [];
    const vus = new Set<string>();

    const ajoute = (t: ProjectTask, quand: string, sansCreneau: boolean, qui: string[]) => {
      if (vus.has(t.id)) return;
      vus.add(t.id);
      sujets.push({
        taskId: t.id,
        titre: t.title,
        nature: t.type,
        projet: t.project,
        qui: qui.length > 0 ? qui : nomsDe(t.assigneeIds, members),
        quand,
        reserve: reserveDe(t, isoAujourdhui),
        sansCreneau,
      });
    };

    // 1. Ce qui a une demi-journée réservée : c'est le prévu au sens strict.
    for (const [taskId, info] of parTache) {
      const t = tasks.find((x) => x.id === taskId);
      if (!t || t.status === 'termine') continue;
      const joursDates = [...info.jours].map((iso) => new Date(`${iso}T00:00:00`));
      ajoute(t, libelleCreneaux(joursDates), false, nomsDe([...info.membres], members));
    }

    // 2. Ce qui a une échéance dans la semaine SANS créneau réservé. C'est précisément
    //    le sujet qui saute : il a une date, personne n'a de temps dessus.
    for (const t of tasks) {
      if (t.status === 'termine' || !t.dueDate || !dansLaSemaine.has(t.dueDate)) continue;
      ajoute(t, `échéance ${formatDayLabel(new Date(`${t.dueDate}T00:00:00`)).toLowerCase()}`, true, []);
    }

    return {
      label: `Semaine du ${formatWeekRange(jours)}`,
      jours,
      remplissage: planifiables > 0 ? attribues / planifiables : 0,
      sujets: sujets.sort((a, b) => Number(a.sansCreneau) - Number(b.sansCreneau) || a.titre.localeCompare(b.titre)),
    };
  });
}

function reserveDe(t: ProjectTask, isoAujourdhui: string): string | undefined {
  if (t.dueDate && t.dueDate < isoAujourdhui) {
    return `déjà en retard de ${joursDepuis(t.dueDate, new Date(`${isoAujourdhui}T00:00:00`))} jours`;
  }
  if (t.status === 'en_attente') return 'en attente d’un tiers';
  if (t.priority === 'critique') return undefined;
  return undefined;
}

// ------------------------------------------------------------ Grille de planning

/** Un code par demi-journée. Les absences l'emportent : une personne en congés n'est pas
 *  « non planifiée », elle est absente, et la nuance change la lecture de la grille. */
export type CodeCreneau = 'MCO' | 'Incident' | 'Projet' | AbsenceType | 'libre';

export interface LigneGrille {
  member: TeamMember;
  /** Deux codes par jour (matin, après-midi), dans l'ordre des jours fournis. */
  creneaux: CodeCreneau[];
}

export function construireGrille(opts: {
  jours: Date[];
  members: TeamMember[];
  tasks: ProjectTask[];
  planningSlots: PlanningSlot[];
  absences: Absence[];
}): LigneGrille[] {
  const { jours, members, tasks, planningSlots, absences } = opts;
  return members.map((member) => {
    const creneaux: CodeCreneau[] = [];
    for (const jour of jours) {
      const iso = toISODate(jour);
      for (const periode of ['matin', 'apres_midi'] as const) {
        const absence = absences.find(
          (a) => a.memberId === member.id && a.date === iso && (a.period === 'jour' || a.period === periode)
        );
        if (absence) {
          creneaux.push(absence.type);
          continue;
        }
        const slot = planningSlots.find((s) => s.memberId === member.id && s.date === iso && s.period === periode);
        const tache = slot?.taskId ? tasks.find((t) => t.id === slot.taskId) : undefined;
        creneaux.push(tache ? tache.type : 'libre');
      }
    }
    return { member, creneaux };
  });
}

// -------------------------------------------------------------- Points à aborder

export interface PointAborder {
  id: string;
  texte: string;
  /** D'où vient le point. Affiché en gris à côté : on doit pouvoir le contester. */
  source: string;
}

/**
 * L'ordre du jour, déduit des données. Ce n'est pas un gadget : un ordre du jour retapé
 * de mémoire chaque lundi oublie systématiquement le projet que personne n'a touché
 * depuis trois semaines — justement celui dont il faudrait parler.
 *
 * L'ordre est celui de la discussion : ce qui bloque d'abord, ce qui dérive ensuite.
 */
export function construirePoints(opts: {
  rapport: WeeklyReport;
  projets: ProjetRollup[];
  semaines: SemainePrevue[];
  tasks: ProjectTask[];
  members: TeamMember[];
  absences: Absence[];
  seuilPresence: number;
  aujourdhui: Date;
}): PointAborder[] {
  const { rapport, projets, semaines, tasks, members, absences, seuilPresence, aujourdhui } = opts;
  const points: PointAborder[] = [];

  // 1. Incidents qui attendent quelqu'un d'extérieur depuis trop longtemps.
  for (const t of tasks) {
    if (t.type !== 'Incident' || t.status !== 'en_attente') continue;
    const depuis = joursDepuis((t.updatedAt ?? t.createdAt).slice(0, 10), aujourdhui);
    if (depuis < JOURS_EN_ATTENTE_ALERTE) continue;
    points.push({
      id: `attente-${t.id}`,
      texte: `${t.title} : en attente depuis ${depuis} jours — faut-il escalader ?`,
      source: 'incident en attente',
    });
  }

  // 2. Projets à l'arrêt.
  for (const p of projets) {
    if (p.etat === 'vert') continue;
    if (p.joursSansActivite === null) {
      points.push({ id: `projet-${p.nom}`, texte: `${p.nom} : aucune heure saisie à ce jour.`, source: 'projet jamais démarré' });
    } else if (p.joursSansActivite >= JOURS_SANS_ACTIVITE_ALERTE) {
      points.push({
        id: `projet-${p.nom}`,
        texte: `${p.nom} : aucune heure saisie depuis ${p.joursSansActivite} jours, avancement ${p.avance} %.`,
        source: 'projet sans activité',
      });
    }
  }

  // 3. Sujets datés sans créneau : ils sauteront si on n'en parle pas maintenant.
  for (const s of semaines) {
    const orphelins = s.sujets.filter((x) => x.sansCreneau);
    if (orphelins.length === 0) continue;
    points.push({
      id: `sanscreneau-${s.label}`,
      texte: `${s.label} : ${orphelins.length} sujet(s) daté(s) sans la moindre demi-journée réservée — ${orphelins
        .slice(0, 2)
        .map((x) => x.titre)
        .join(', ')}${orphelins.length > 2 ? '…' : ''}`,
      source: 'planning incomplet',
    });
  }

  // 4. Présence du service sous le seuil : la condition de fonctionnement, pas la charge.
  //    Un jour à 40 % de présence est un problème même sans incident en cours — c'est
  //    justement celui qui tombera ce jour-là qui ne trouvera personne.
  for (const s of semaines) {
    const creux = presenceJours({ jours: s.jours, members, absences, seuil: seuilPresence }).filter((p) => p.aSignaler);
    if (creux.length === 0) continue;
    points.push({
      id: `presence-${s.label}`,
      texte: `${s.label} : présence à ${creux.map((p) => `${pourcent(p.taux)} le ${jourCourt(p.date)}`).join(', ')} — sous le seuil de ${pourcent(
        seuilPresence
      )}. Qui reste joignable ?`,
      source: 'présence du service',
    });
  }

  // 5. Surcharge.
  for (const p of rapport.perMember) {
    if (p.workloadLevel !== 'surcharge') continue;
    points.push({
      id: `charge-${p.member.id}`,
      texte: `${p.member.name} est à ${Math.round(p.workloadRatio * 100)} % de charge — que retire-t-on ?`,
      source: 'charge',
    });
  }

  // 6. Retards, en un seul point : les énumérer un par un noierait l'ordre du jour.
  if (rapport.overdueTasks.length > 0) {
    points.push({
      id: 'retards',
      texte: `${rapport.overdueTasks.length} tâche(s) en retard, dont ${rapport.overdueTasks
        .slice(0, 2)
        .map((t) => t.title)
        .join(' et ')}.`,
      source: 'échéances dépassées',
    });
  }

  return points;
}

// ------------------------------------------------------------------- Le rapport

export interface MeetingReport {
  /** La semaine écoulée, celle dont on rend compte. */
  semaineEcoulee: Date[];
  /** Le jour de la réunion : le vendredi de la semaine rapportée (voir JOUR_REUNION). */
  dateReunion: Date;
  /** Les deux semaines à venir. */
  semaines: SemainePrevue[];
  /** Les 14 jours des deux semaines, bout à bout — l'axe de la grille. */
  joursAVenir: Date[];
  grille: LigneGrille[];
  hebdo: WeeklyReport;
  projets: ProjetRollup[];
  points: PointAborder[];
  genereLe: Date;
}

export function computeMeetingReport(opts: {
  /** Lundi de la semaine dont on rend compte. */
  debutSemaine: Date;
  members: TeamMember[];
  tasks: ProjectTask[];
  timeEntries: TimeEntry[];
  absences: Absence[];
  planningSlots: PlanningSlot[];
  roadmapItems: Parameters<typeof computeWeeklyReport>[0]['roadmapItems'];
  /** Seuil en vigueur pour le service (voir src/lib/presence.ts). */
  seuilPresence?: number;
  /** Créneaux récurrents du service (voir src/lib/recurrences.ts). */
  recurrences?: Recurrence[];
  /** Injectable pour les tests ; par défaut l'instant présent. */
  maintenant?: Date;
}): MeetingReport {
  const { debutSemaine, members, tasks, timeEntries, absences, planningSlots, roadmapItems } = opts;
  const seuilPresence = opts.seuilPresence ?? SEUIL_PRESENCE_DEFAUT;
  const maintenant = opts.maintenant ?? new Date();

  const lundi = startOfWeek(debutSemaine);
  const semaineEcoulee = getWorkingDaysOfWeek(lundi);
  const s1 = getWorkingDaysOfWeek(addDays(lundi, 7));
  const s2 = getWorkingDaysOfWeek(addDays(lundi, 14));

  const hebdo = computeWeeklyReport({
    weekDays: semaineEcoulee,
    nextWeekDays: s1,
    members,
    tasks,
    timeEntries,
    absences,
    planningSlots,
    roadmapItems,
    recurrences: opts.recurrences,
  });

  const projets = rollupProjets({ tasks, timeEntries, members, semaineEcoulee, aujourdhui: maintenant });
  const semaines = construireSujets({ semaines: [s1, s2], tasks, members, planningSlots, absences, aujourdhui: maintenant });
  const joursAVenir = [...s1, ...s2];
  const grille = construireGrille({ jours: joursAVenir, members, tasks, planningSlots, absences });
  const points = construirePoints({
    rapport: hebdo,
    projets,
    semaines,
    tasks,
    members,
    absences,
    seuilPresence,
    aujourdhui: maintenant,
  });

  // getWorkingDaysOfWeek renvoie lundi → dimanche : l'index 0 est donc lundi.
  const dateReunion = semaineEcoulee[(JOUR_REUNION + 6) % 7];

  return { semaineEcoulee, dateReunion, semaines, joursAVenir, grille, hebdo, projets, points, genereLe: maintenant };
}
