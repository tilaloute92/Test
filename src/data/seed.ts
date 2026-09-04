import type { Absence, ApiConnection, Copil, PlanningSlot, ProjectTask, RoadmapItem, TeamMember, TimeEntry } from '../types';
import { addDays, isWeekend, startOfWeek, toISODate } from '../lib/date';

// Deterministic PRNG so the seeded planning looks the same on every load.
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

export const members: TeamMember[] = [
  { id: 'm1', name: 'Camille Bernard', role: 'Administratrice systèmes', skills: ['Linux', 'VMware', 'Sauvegarde'], weeklyHours: 35, color: '#7c3aed', initials: 'CB' },
  { id: 'm2', name: 'Karim Belkacem', role: 'Ingénieur réseau', skills: ['Cisco', 'Firewall', 'VPN'], weeklyHours: 35, color: '#0ea5e9', initials: 'KB' },
  { id: 'm3', name: 'Julie Moreau', role: 'Administratrice systèmes & virtualisation', skills: ['Windows Server', 'Hyper-V', 'Active Directory'], weeklyHours: 35, color: '#db2777', initials: 'JM' },
  { id: 'm4', name: 'Thomas Petit', role: 'Technicien support N2', skills: ['Helpdesk N2', 'Postes de travail', 'Impression'], weeklyHours: 35, color: '#16a34a', initials: 'TP' },
  { id: 'm5', name: 'Sofia Rahmani', role: 'Ingénieure cloud & infra', skills: ['Azure', 'Terraform', 'Kubernetes'], weeklyHours: 35, color: '#ea580c', initials: 'SR' },
  { id: 'm6', name: 'Nicolas Faure', role: 'Technicien réseau N1/N2', skills: ['LAN/WAN', 'Switching', 'Supervision'], weeklyHours: 35, color: '#64748b', initials: 'NF' },
];

const today = new Date();
const iso = toISODate(today);

export const tasks: ProjectTask[] = [
  // --- MCO récurrent ---
  { id: 't1', title: 'Supervision & contrôle des sauvegardes', type: 'MCO', assigneeIds: ['m1'], status: 'en_cours', priority: 'normale', estimatedHours: 3.5, createdAt: iso },
  { id: 't2', title: 'Patch management serveurs Linux', type: 'MCO', assigneeIds: ['m1'], status: 'a_faire', priority: 'normale', estimatedHours: 7, createdAt: iso },
  { id: 't3', title: 'Supervision réseau (Centreon/PRTG)', type: 'MCO', assigneeIds: ['m6'], status: 'en_cours', priority: 'normale', estimatedHours: 3.5, createdAt: iso },
  { id: 't4', title: 'Support utilisateurs N2 - ticketing', type: 'MCO', assigneeIds: ['m4'], status: 'en_cours', priority: 'normale', estimatedHours: 10.5, createdAt: iso },
  { id: 't5', title: 'Contrôle sauvegardes AD / GPO', type: 'MCO', assigneeIds: ['m3'], status: 'a_faire', priority: 'normale', estimatedHours: 3.5, createdAt: iso },
  { id: 't6', title: 'Revue quotidienne alertes cloud', type: 'MCO', assigneeIds: ['m5'], status: 'en_cours', priority: 'normale', estimatedHours: 3.5, createdAt: iso },
  { id: 't7', title: 'Astreinte réseau - vérification liens WAN', type: 'MCO', assigneeIds: ['m2'], status: 'a_faire', priority: 'normale', estimatedHours: 3.5, createdAt: iso },

  // --- Incidents ---
  { id: 'i1', title: 'INC-1042 Panne switch salle serveur B12', type: 'Incident', assigneeIds: ['m2', 'm6'], status: 'en_cours', priority: 'critique', estimatedHours: 4, dueDate: iso, createdAt: iso },
  { id: 'i2', title: 'INC-1043 Lenteur VPN agence Lyon', type: 'Incident', assigneeIds: ['m6'], status: 'en_attente', priority: 'haute', estimatedHours: 3, dueDate: iso, createdAt: iso },
  { id: 'i3', title: 'INC-1044 Serveur de fichiers plein (Prod)', type: 'Incident', assigneeIds: ['m1'], status: 'a_faire', priority: 'haute', estimatedHours: 2, createdAt: iso },
  { id: 'i4', title: 'INC-1045 Poste utilisateur ne démarre plus - Direction', type: 'Incident', assigneeIds: ['m4'], status: 'a_faire', priority: 'normale', estimatedHours: 1.5, createdAt: iso },
  { id: 'i5', title: 'INC-1046 Compte AD verrouillé en boucle', type: 'Incident', assigneeIds: ['m3'], status: 'termine', priority: 'normale', estimatedHours: 1, createdAt: iso, completedAt: today.toISOString() },

  // --- Projets ---
  { id: 'p1', title: 'Cadrage & inventaire salle serveur', type: 'Projet', project: 'Migration Datacenter Nord', assigneeIds: ['m1', 'm5'], status: 'en_cours', priority: 'haute', estimatedHours: 14, dueDate: toISODate(addDays(today, 18)), createdAt: iso },
  { id: 'p2', title: 'Migration VM prioritaires (vMotion)', type: 'Projet', project: 'Migration Datacenter Nord', assigneeIds: ['m5'], status: 'a_faire', priority: 'haute', estimatedHours: 21, dueDate: toISODate(addDays(today, 25)), createdAt: iso },
  { id: 'p3', title: 'Bascule stockage SAN', type: 'Projet', project: 'Migration Datacenter Nord', assigneeIds: ['m1'], status: 'a_faire', priority: 'normale', estimatedHours: 10.5, dueDate: toISODate(addDays(today, 25)), createdAt: iso },

  { id: 'p4', title: 'Déploiement boîtiers SD-WAN agence Lyon', type: 'Projet', project: 'Déploiement SD-WAN agences', assigneeIds: ['m2', 'm6'], status: 'en_cours', priority: 'haute', estimatedHours: 17.5, dueDate: toISODate(addDays(today, 11)), createdAt: iso },
  { id: 'p5', title: 'Déploiement boîtiers SD-WAN agence Nantes', type: 'Projet', project: 'Déploiement SD-WAN agences', assigneeIds: ['m6'], status: 'a_faire', priority: 'normale', estimatedHours: 17.5, dueDate: toISODate(addDays(today, 18)), createdAt: iso },
  { id: 'p6', title: 'Rédaction procédures & schémas réseau', type: 'Projet', project: 'Déploiement SD-WAN agences', assigneeIds: ['m2'], status: 'a_faire', priority: 'basse', estimatedHours: 7, createdAt: iso },

  { id: 'p7', title: 'Étude & choix modèle firewall', type: 'Projet', project: 'Renouvellement parc firewalls', assigneeIds: ['m2'], status: 'termine', priority: 'normale', estimatedHours: 7, createdAt: iso, completedAt: addDays(today, -2).toISOString() },
  { id: 'p8', title: 'Remplacement firewall siège', type: 'Projet', project: 'Renouvellement parc firewalls', assigneeIds: ['m6'], status: 'a_faire', priority: 'haute', estimatedHours: 14, dueDate: toISODate(addDays(today, 9)), createdAt: iso },

  { id: 'p9', title: 'Audit couverture Wifi sites pilotes', type: 'Projet', project: 'Passage Wifi 6 sièges', assigneeIds: ['m4'], status: 'en_cours', priority: 'normale', estimatedHours: 10.5, dueDate: toISODate(addDays(today, 15)), createdAt: iso },
  { id: 'p10', title: 'Déploiement bornes Wifi 6 - bâtiment A', type: 'Projet', project: 'Passage Wifi 6 sièges', assigneeIds: ['m3'], status: 'a_faire', priority: 'normale', estimatedHours: 14, dueDate: toISODate(addDays(today, 22)), createdAt: iso },

  { id: 'p11', title: 'Automatisation provisioning (Terraform)', type: 'Projet', project: 'Industrialisation Cloud', assigneeIds: ['m5'], status: 'en_cours', priority: 'normale', estimatedHours: 21, dueDate: toISODate(addDays(today, 20)), createdAt: iso },
  { id: 'p12', title: 'Mise en place cluster Kubernetes de test', type: 'Projet', project: 'Industrialisation Cloud', assigneeIds: ['m5'], status: 'a_faire', priority: 'basse', estimatedHours: 14, createdAt: iso },
];

// --- Planning: 3 semaines glissantes, matin = MCO/Incident, après-midi = Projet ---
// Un même identifiant de tâche peut apparaître pour plusieurs personnes ici : c'est le cas
// normal d'une tâche à plusieurs intervenants (assigneeIds), chacun ayant son propre créneau.
const mcoIncidentTasksByMember: Record<string, string[]> = {
  m1: ['t1', 't2', 'i3'],
  m2: ['t7', 'i1'],
  m3: ['t5', 'i5'],
  m4: ['t4', 'i4'],
  m5: ['t6'],
  m6: ['t3', 'i2', 'i1'],
};
const projetTasksByMember: Record<string, string[]> = {
  m1: ['p1', 'p3'],
  m2: ['p4', 'p6'],
  m3: ['p10'],
  m4: ['p9'],
  m5: ['p1', 'p2', 'p11', 'p12'],
  m6: ['p4', 'p5', 'p8'],
};

export const planningSlots: PlanningSlot[] = [];
export const absences: Absence[] = [];

const weekStart = startOfWeek(today);
let slotCounter = 1;

// Each member has their own baseline fill rate so the dashboard shows a realistic
// spread of workload (some under-loaded, some balanced, some near capacity).
const baseFillByMember: Record<string, number> = {
  m1: 0.85,
  m2: 0.95,
  m3: 0.55,
  m4: 0.7,
  m5: 0.6,
  m6: 0.8,
};

// Équipe en horaires décalés : Karim (réseau, astreinte incidents) et Nicolas (déjà
// d'astreinte dans les données ci-dessous) couvrent aussi le week-end. Les autres
// suivent un rythme classique du lundi au vendredi (fill quasi nul le week-end).
const weekendDutyMembers = new Set(['m2', 'm6']);

for (let w = 0; w < 3; w++) {
  for (let d = 0; d < 7; d++) {
    const day = addDays(weekStart, w * 7 + d);
    const dayIso = toISODate(day);
    const weekend = isWeekend(day);
    for (const member of members) {
      // Fill rate decreases slightly for weeks further away (planning still being firmed up)
      const weekFactor = w === 0 ? 1 : w === 1 ? 0.85 : 0.6;
      const weekendFactor = weekend ? (weekendDutyMembers.has(member.id) ? 0.5 : 0) : 1;
      const fillProbability = baseFillByMember[member.id] * weekFactor * weekendFactor;

      const morningTasks = mcoIncidentTasksByMember[member.id];
      const afternoonTasks = projetTasksByMember[member.id];

      const morningTaskId = rand() < fillProbability ? pick(morningTasks) : null;
      const afternoonTaskId = rand() < fillProbability ? pick(afternoonTasks) : null;

      planningSlots.push({ id: `s${slotCounter++}`, memberId: member.id, date: dayIso, period: 'matin', taskId: morningTaskId ?? null });
      planningSlots.push({ id: `s${slotCounter++}`, memberId: member.id, date: dayIso, period: 'apres_midi', taskId: afternoonTaskId ?? null });
    }
  }
}

// A couple of overload/underload examples for the dashboard to be meaningful:
// Karim (m2) overloaded this week: fill every slot, week-end compris — illustre la
// "surcharge" désormais possible quand quelqu'un est planifié au-delà de son volume
// hebdomadaire (35h) du fait des horaires décalés.
for (let d = 0; d < 7; d++) {
  const day = toISODate(addDays(weekStart, d));
  for (const period of ['matin', 'apres_midi'] as const) {
    const slot = planningSlots.find((s) => s.memberId === 'm2' && s.date === day && s.period === period);
    if (slot) slot.taskId = period === 'matin' ? pick(mcoIncidentTasksByMember.m2) : pick(projetTasksByMember.m2);
  }
}

// Absences
absences.push(
  { id: 'a1', memberId: 'm3', date: toISODate(addDays(weekStart, 3)), period: 'jour', type: 'conge', label: 'Congés' },
  { id: 'a2', memberId: 'm3', date: toISODate(addDays(weekStart, 4)), period: 'jour', type: 'conge', label: 'Congés' },
  { id: 'a3', memberId: 'm4', date: toISODate(addDays(weekStart, 1)), period: 'apres_midi', type: 'formation', label: 'Formation ITIL' },
  { id: 'a4', memberId: 'm6', date: toISODate(addDays(weekStart, 7 + 2)), period: 'jour', type: 'astreinte', label: "Astreinte d'exploitation" }
);

export const timeEntries: TimeEntry[] = [
  { id: 'te1', taskId: 't1', memberId: 'm1', date: iso, period: 'matin', hours: 2, note: 'Contrôle sauvegardes nocturnes OK' },
  { id: 'te2', taskId: 'i1', memberId: 'm2', date: iso, period: 'matin', hours: 3, note: 'Diagnostic switch, module SFP HS identifié' },
  { id: 'te3', taskId: 't4', memberId: 'm4', date: iso, period: 'matin', hours: 3.5, note: '6 tickets traités' },
  { id: 'te4', taskId: 'p1', memberId: 'm1', date: toISODate(addDays(today, -1)), period: 'apres_midi', hours: 3.5 },
  { id: 'te5', taskId: 'p4', memberId: 'm2', date: toISODate(addDays(today, -1)), period: 'apres_midi', hours: 3.5 },
  { id: 'te6', taskId: 'p11', memberId: 'm5', date: toISODate(addDays(today, -1)), period: 'apres_midi', hours: 3 },
  { id: 'te7', taskId: 't6', memberId: 'm5', date: toISODate(addDays(today, -1)), period: 'matin', hours: 2.5 },
];

export const apiConnections: ApiConnection[] = [
  {
    id: 'c1',
    name: 'Exemple public (JSONPlaceholder)',
    baseUrl: 'https://jsonplaceholder.typicode.com',
    authType: 'none',
    rememberSecret: false,
    headers: [{ key: 'Accept', value: 'application/json' }],
  },
];

// --- Feuille de route (FDR) : les projets déjà en cours ci-dessus (voir `project` sur les
// tâches "Projet") deviennent des initiatives de la FDR de l'année en cours, complétées par
// quelques initiatives futures pas encore démarrées (année en cours, trimestres restants, et
// année suivante) pour illustrer un horizon pluriannuel.
const currentYear = today.getFullYear();
const nextYear = currentYear + 1;

export const roadmapItems: RoadmapItem[] = [
  {
    id: 'r1',
    title: 'Migration Datacenter Nord',
    description: "Consolidation de la salle serveur historique vers le nouveau datacenter : inventaire, migration des VM prioritaires, bascule du stockage SAN.",
    domain: 'Infrastructure',
    year: currentYear,
    quarter: 'T2',
    status: 'en_cours',
    priority: 'haute',
    ownerIds: ['m1', 'm5'],
    progress: 40,
    budgetEstimate: 45000,
    linkedTaskIds: ['p1', 'p2', 'p3'],
    createdAt: iso,
    updatedAt: iso,
  },
  {
    id: 'r2',
    title: 'Déploiement SD-WAN agences',
    description: 'Remplacement des liaisons MPLS historiques par des boîtiers SD-WAN sur les agences distantes, en commençant par Lyon et Nantes.',
    domain: 'Réseau',
    year: currentYear,
    quarter: 'T2',
    status: 'en_cours',
    priority: 'haute',
    ownerIds: ['m2', 'm6'],
    progress: 55,
    budgetEstimate: 28000,
    linkedTaskIds: ['p4', 'p5', 'p6'],
    createdAt: iso,
    updatedAt: iso,
  },
  {
    id: 'r3',
    title: 'Renouvellement parc firewalls',
    description: 'Fin de vie des firewalls périmétriques actuels : choix du nouveau modèle puis remplacement site par site.',
    domain: 'Sécurité',
    year: currentYear,
    quarter: 'T1',
    status: 'en_cours',
    priority: 'haute',
    ownerIds: ['m2', 'm6'],
    progress: 70,
    budgetEstimate: 18000,
    linkedTaskIds: ['p7', 'p8'],
    createdAt: iso,
    updatedAt: iso,
  },
  {
    id: 'r4',
    title: 'Passage Wifi 6 sur les sièges',
    description: "Audit de couverture puis déploiement progressif de bornes Wifi 6 sur les bâtiments du siège.",
    domain: 'Réseau',
    year: currentYear,
    quarter: 'T3',
    status: 'en_cours',
    priority: 'normale',
    ownerIds: ['m3', 'm4'],
    progress: 30,
    budgetEstimate: 22000,
    linkedTaskIds: ['p9', 'p10'],
    createdAt: iso,
    updatedAt: iso,
  },
  {
    id: 'r5',
    title: 'Industrialisation Cloud (Terraform / Kubernetes)',
    description: "Automatisation du provisioning d'infrastructure et mise en place d'un cluster Kubernetes de test pour les futurs déploiements applicatifs.",
    domain: 'Cloud',
    year: currentYear,
    quarter: 'T3',
    status: 'en_cours',
    priority: 'normale',
    ownerIds: ['m5'],
    progress: 35,
    linkedTaskIds: ['p11', 'p12'],
    createdAt: iso,
    updatedAt: iso,
  },
  {
    id: 'r6',
    title: 'Migration Active Directory vers Entra ID hybride',
    description: "Synchronisation de l'AD local vers Microsoft Entra ID (Azure AD Connect) pour permettre le SSO et préparer un futur passage au cloud.",
    domain: 'Infrastructure',
    year: currentYear,
    quarter: 'T4',
    status: 'planifie',
    priority: 'haute',
    ownerIds: ['m3'],
    progress: 0,
    budgetEstimate: 15000,
    linkedTaskIds: [],
    createdAt: iso,
    updatedAt: iso,
  },
  {
    id: 'r7',
    title: 'Supervision centralisée unifiée',
    description: 'Regrouper la supervision système, réseau et applicative (aujourd\'hui éclatée entre plusieurs outils) sur une plateforme unique.',
    domain: 'Infrastructure',
    year: currentYear,
    quarter: 'T4',
    status: 'idee',
    priority: 'normale',
    ownerIds: [],
    progress: 0,
    linkedTaskIds: [],
    createdAt: iso,
    updatedAt: iso,
  },
  {
    id: 'r8',
    title: 'Migration IPv6 sur le cœur de réseau',
    description: "Étude puis activation d'IPv6 en double pile sur les équipements cœur, en commençant par le siège.",
    domain: 'Réseau',
    year: nextYear,
    quarter: 'T1',
    status: 'idee',
    priority: 'basse',
    ownerIds: ['m2'],
    progress: 0,
    linkedTaskIds: [],
    createdAt: iso,
    updatedAt: iso,
  },
  {
    id: 'r9',
    title: "Refonte du Plan de Reprise d'Activité (PRA)",
    description: "Mise à jour du PRA existant et organisation d'un exercice de bascule complet pour en valider le bon fonctionnement.",
    domain: 'Sécurité',
    year: nextYear,
    quarter: 'T2',
    status: 'planifie',
    priority: 'critique',
    ownerIds: ['m1', 'm5'],
    progress: 0,
    budgetEstimate: 8000,
    linkedTaskIds: [],
    createdAt: iso,
    updatedAt: iso,
  },
  {
    id: 'r10',
    title: 'Renouvellement du parc de postes de travail',
    description: 'Remplacement progressif des postes arrivant en fin de garantie, à étaler sur toute l\'année.',
    domain: 'Poste de travail',
    year: nextYear,
    quarter: 'annee',
    status: 'idee',
    priority: 'normale',
    ownerIds: ['m4'],
    progress: 0,
    budgetEstimate: 60000,
    linkedTaskIds: [],
    createdAt: iso,
    updatedAt: iso,
  },
];

// --- COPIL (comités de pilotage) ---
// Trois séances qui couvrent le cycle réel d'une instance de gouvernance : une séance tenue
// (avec décisions et relevé d'actions, dont une en retard), une séance à venir déjà préparée,
// et une séance suivante encore à préparer (ordre du jour vide) — de quoi voir immédiatement
// à quoi ressemble l'onglet, y compris les signaux qui remontent en Vue d'ensemble.
const copilPast = toISODate(addDays(today, -21));
const copilNext = toISODate(addDays(today, 5));
const copilFuture = toISODate(addDays(today, 96));

export const copils: Copil[] = [
  {
    id: 'cp1',
    title: 'COPIL Infrastructure & Réseau — T2',
    date: copilPast,
    time: '14:00',
    location: 'Salle Mercure + Teams',
    status: 'tenu',
    participantIds: ['m1', 'm2', 'm5'],
    externalParticipants: ['Direction des systèmes d\'information', 'Responsable métier Logistique'],
    agenda: [
      { id: 'cpa1', label: 'Avancement Migration Datacenter Nord', presenterId: 'm1', durationMin: 20 },
      { id: 'cpa2', label: 'Point SD-WAN agences : Lyon et Nantes', presenterId: 'm2', durationMin: 20 },
      { id: 'cpa3', label: 'Budget prévisionnel firewalls', presenterId: 'm5', durationMin: 15 },
      { id: 'cpa4', label: 'Questions diverses', durationMin: 10 },
    ],
    decisions: [
      {
        id: 'cpd1',
        label: 'Bascule du stockage SAN validée pour le week-end du 12',
        detail: 'Fenêtre de maintenance confirmée avec les métiers, retour arrière possible jusqu\'au lundi matin.',
      },
      { id: 'cpd2', label: 'Déploiement SD-WAN étendu à 2 agences supplémentaires', detail: 'Sous réserve de la réception des boîtiers commandés.' },
      { id: 'cpd3', label: 'Budget firewalls arbitré à 35 000 € au lieu de 50 000 €' },
    ],
    actions: [
      { id: 'cpac1', label: 'Communiquer la fenêtre de maintenance SAN aux métiers', ownerIds: ['m1'], dueDate: toISODate(addDays(today, -7)), status: 'en_cours' },
      { id: 'cpac2', label: 'Relancer le fournisseur sur la livraison des boîtiers SD-WAN', ownerIds: ['m2'], dueDate: toISODate(addDays(today, 10)), status: 'a_faire' },
      { id: 'cpac3', label: 'Mettre à jour le chiffrage firewalls dans la FDR', ownerIds: ['m5'], dueDate: toISODate(addDays(today, -3)), status: 'a_faire' },
      { id: 'cpac4', label: 'Diffuser le compte-rendu de séance', ownerIds: ['m1'], dueDate: toISODate(addDays(today, -18)), status: 'termine' },
    ],
    roadmapItemIds: ['r1', 'r2'],
    notes: "Les métiers confirment leur disponibilité pour la bascule SAN. La direction demande un point de suivi mensuel sur le budget.",
    nextDate: copilNext,
    createdAt: iso,
    updatedAt: iso,
  },
  {
    id: 'cp2',
    title: 'COPIL Infrastructure & Réseau — T3',
    date: copilNext,
    time: '14:00',
    location: 'Salle Mercure + Teams',
    status: 'planifie',
    participantIds: ['m1', 'm2', 'm5', 'm6'],
    externalParticipants: ['Direction des systèmes d\'information'],
    agenda: [
      { id: 'cpa5', label: 'Bilan de la bascule SAN', presenterId: 'm1', durationMin: 15 },
      { id: 'cpa6', label: 'Avancement SD-WAN et couverture Wifi 6', presenterId: 'm2', durationMin: 20 },
      { id: 'cpa7', label: 'Industrialisation Cloud : point d\'étape Terraform', presenterId: 'm5', durationMin: 20 },
      { id: 'cpa8', label: 'Revue des actions de la séance précédente', durationMin: 10 },
    ],
    decisions: [],
    actions: [],
    roadmapItemIds: ['r1', 'r2', 'r3'],
    nextDate: copilFuture,
    createdAt: iso,
    updatedAt: iso,
  },
  {
    id: 'cp3',
    title: 'COPIL Infrastructure & Réseau — T4',
    date: copilFuture,
    time: '14:00',
    status: 'planifie',
    participantIds: ['m1', 'm2'],
    externalParticipants: ['Direction des systèmes d\'information'],
    agenda: [],
    decisions: [],
    actions: [],
    roadmapItemIds: [],
    createdAt: iso,
    updatedAt: iso,
  },
];
