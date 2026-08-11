import type { Absence, PlanningSlot, ProjectTask, TeamMember, TimeEntry } from '../types';
import { addDays, startOfWeek, toISODate } from '../lib/date';

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
  { id: 't1', title: 'Supervision & contrôle des sauvegardes', type: 'MCO', assigneeId: 'm1', status: 'en_cours', priority: 'normale', estimatedHours: 3.5, createdAt: iso },
  { id: 't2', title: 'Patch management serveurs Linux', type: 'MCO', assigneeId: 'm1', status: 'a_faire', priority: 'normale', estimatedHours: 7, createdAt: iso },
  { id: 't3', title: 'Supervision réseau (Centreon/PRTG)', type: 'MCO', assigneeId: 'm6', status: 'en_cours', priority: 'normale', estimatedHours: 3.5, createdAt: iso },
  { id: 't4', title: 'Support utilisateurs N2 - ticketing', type: 'MCO', assigneeId: 'm4', status: 'en_cours', priority: 'normale', estimatedHours: 10.5, createdAt: iso },
  { id: 't5', title: 'Contrôle sauvegardes AD / GPO', type: 'MCO', assigneeId: 'm3', status: 'a_faire', priority: 'normale', estimatedHours: 3.5, createdAt: iso },
  { id: 't6', title: 'Revue quotidienne alertes cloud', type: 'MCO', assigneeId: 'm5', status: 'en_cours', priority: 'normale', estimatedHours: 3.5, createdAt: iso },
  { id: 't7', title: 'Astreinte réseau - vérification liens WAN', type: 'MCO', assigneeId: 'm2', status: 'a_faire', priority: 'normale', estimatedHours: 3.5, createdAt: iso },

  // --- Incidents ---
  { id: 'i1', title: 'INC-1042 Panne switch salle serveur B12', type: 'Incident', assigneeId: 'm2', status: 'en_cours', priority: 'critique', estimatedHours: 4, dueDate: iso, createdAt: iso },
  { id: 'i2', title: 'INC-1043 Lenteur VPN agence Lyon', type: 'Incident', assigneeId: 'm6', status: 'en_attente', priority: 'haute', estimatedHours: 3, dueDate: iso, createdAt: iso },
  { id: 'i3', title: 'INC-1044 Serveur de fichiers plein (Prod)', type: 'Incident', assigneeId: 'm1', status: 'a_faire', priority: 'haute', estimatedHours: 2, createdAt: iso },
  { id: 'i4', title: 'INC-1045 Poste utilisateur ne démarre plus - Direction', type: 'Incident', assigneeId: 'm4', status: 'a_faire', priority: 'normale', estimatedHours: 1.5, createdAt: iso },
  { id: 'i5', title: 'INC-1046 Compte AD verrouillé en boucle', type: 'Incident', assigneeId: 'm3', status: 'termine', priority: 'normale', estimatedHours: 1, createdAt: iso },

  // --- Projets ---
  { id: 'p1', title: 'Cadrage & inventaire salle serveur', type: 'Projet', project: 'Migration Datacenter Nord', assigneeId: 'm1', status: 'en_cours', priority: 'haute', estimatedHours: 14, dueDate: toISODate(addDays(today, 18)), createdAt: iso },
  { id: 'p2', title: 'Migration VM prioritaires (vMotion)', type: 'Projet', project: 'Migration Datacenter Nord', assigneeId: 'm5', status: 'a_faire', priority: 'haute', estimatedHours: 21, dueDate: toISODate(addDays(today, 25)), createdAt: iso },
  { id: 'p3', title: 'Bascule stockage SAN', type: 'Projet', project: 'Migration Datacenter Nord', assigneeId: 'm1', status: 'a_faire', priority: 'normale', estimatedHours: 10.5, dueDate: toISODate(addDays(today, 25)), createdAt: iso },

  { id: 'p4', title: 'Déploiement boîtiers SD-WAN agence Lyon', type: 'Projet', project: 'Déploiement SD-WAN agences', assigneeId: 'm2', status: 'en_cours', priority: 'haute', estimatedHours: 17.5, dueDate: toISODate(addDays(today, 11)), createdAt: iso },
  { id: 'p5', title: 'Déploiement boîtiers SD-WAN agence Nantes', type: 'Projet', project: 'Déploiement SD-WAN agences', assigneeId: 'm6', status: 'a_faire', priority: 'normale', estimatedHours: 17.5, dueDate: toISODate(addDays(today, 18)), createdAt: iso },
  { id: 'p6', title: 'Rédaction procédures & schémas réseau', type: 'Projet', project: 'Déploiement SD-WAN agences', assigneeId: 'm2', status: 'a_faire', priority: 'basse', estimatedHours: 7, createdAt: iso },

  { id: 'p7', title: 'Étude & choix modèle firewall', type: 'Projet', project: 'Renouvellement parc firewalls', assigneeId: 'm2', status: 'termine', priority: 'normale', estimatedHours: 7, createdAt: iso },
  { id: 'p8', title: 'Remplacement firewall siège', type: 'Projet', project: 'Renouvellement parc firewalls', assigneeId: 'm6', status: 'a_faire', priority: 'haute', estimatedHours: 14, dueDate: toISODate(addDays(today, 9)), createdAt: iso },

  { id: 'p9', title: 'Audit couverture Wifi sites pilotes', type: 'Projet', project: 'Passage Wifi 6 sièges', assigneeId: 'm4', status: 'en_cours', priority: 'normale', estimatedHours: 10.5, dueDate: toISODate(addDays(today, 15)), createdAt: iso },
  { id: 'p10', title: 'Déploiement bornes Wifi 6 - bâtiment A', type: 'Projet', project: 'Passage Wifi 6 sièges', assigneeId: 'm3', status: 'a_faire', priority: 'normale', estimatedHours: 14, dueDate: toISODate(addDays(today, 22)), createdAt: iso },

  { id: 'p11', title: 'Automatisation provisioning (Terraform)', type: 'Projet', project: 'Industrialisation Cloud', assigneeId: 'm5', status: 'en_cours', priority: 'normale', estimatedHours: 21, dueDate: toISODate(addDays(today, 20)), createdAt: iso },
  { id: 'p12', title: 'Mise en place cluster Kubernetes de test', type: 'Projet', project: 'Industrialisation Cloud', assigneeId: 'm5', status: 'a_faire', priority: 'basse', estimatedHours: 14, createdAt: iso },
];

// --- Planning: 3 semaines glissantes, matin = MCO/Incident, après-midi = Projet ---
const mcoIncidentTasksByMember: Record<string, string[]> = {
  m1: ['t1', 't2', 'i3'],
  m2: ['t7', 'i1'],
  m3: ['t5', 'i5'],
  m4: ['t4', 'i4'],
  m5: ['t6'],
  m6: ['t3', 'i2'],
};
const projetTasksByMember: Record<string, string[]> = {
  m1: ['p1', 'p3'],
  m2: ['p4', 'p6'],
  m3: ['p10'],
  m4: ['p9'],
  m5: ['p2', 'p11', 'p12'],
  m6: ['p5', 'p8'],
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

for (let w = 0; w < 3; w++) {
  for (let d = 0; d < 5; d++) {
    const day = addDays(weekStart, w * 7 + d);
    const dayIso = toISODate(day);
    for (const member of members) {
      // Fill rate decreases slightly for weeks further away (planning still being firmed up)
      const weekFactor = w === 0 ? 1 : w === 1 ? 0.85 : 0.6;
      const fillProbability = baseFillByMember[member.id] * weekFactor;

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
// Karim (m2) overloaded this week: fill every slot.
for (let d = 0; d < 5; d++) {
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
