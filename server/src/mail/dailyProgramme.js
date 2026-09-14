import { getSnapshot } from '../businessData.js';

/**
 * Programme du jour d'une personne, mis en forme pour le courrier.
 *
 * C'est un message du MATIN : il annonce ce qui est PRÉVU (le créneau affecté au planning),
 * pas ce qui a été fait — le temps saisi n'existe pas encore quand le message part. D'où
 * l'absence volontaire de tout compteur d'heures réalisées ici.
 */

const PERIODS = [
  { key: 'matin', label: 'Matin', hours: '08:00 → 12:00', nature: 'MCO & incidents' },
  { key: 'apres_midi', label: 'Après-midi', hours: '14:00 → 18:00', nature: 'Projets' },
];

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatLong(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Ce que contient le programme d'une personne pour une date donnée. Renvoie null si la
 * personne n'a ni adresse mail, ni rien à annoncer — on n'envoie pas de message vide.
 */
export function buildProgramme(member, iso) {
  const { tasks, planningSlots, absences } = getSnapshot();
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const dayAbsence = absences.find((a) => a.memberId === member.id && a.date === iso && a.period === 'jour');

  const creneaux = PERIODS.map((p) => {
    const absence = absences.find((a) => a.memberId === member.id && a.date === iso && (a.period === 'jour' || a.period === p.key));
    const slot = planningSlots.find((s) => s.memberId === member.id && s.date === iso && s.period === p.key);
    const task = slot?.taskId ? byId.get(slot.taskId) : undefined;
    return { ...p, absence, task };
  });

  // Tâches ouvertes de la personne, pour donner le contexte de ce qui reste à traiter.
  const ouvertes = tasks
    .filter((t) => t.assigneeIds.includes(member.id) && t.status !== 'termine')
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 8);

  const rienAAnnoncer = !dayAbsence && creneaux.every((c) => !c.task && !c.absence) && ouvertes.length === 0;
  if (rienAAnnoncer) return null;

  return { member, iso, dayAbsence, creneaux, ouvertes };
}

export function renderSubject(programme) {
  return `Programme du ${formatLong(programme.iso)} — ${programme.member.name}`;
}

export function renderText(programme) {
  const lines = [`Programme du ${formatLong(programme.iso)}`, `${programme.member.name} — ${programme.member.role}`, ''];

  if (programme.dayAbsence) {
    lines.push(`Absent(e) toute la journée — ${programme.dayAbsence.label || programme.dayAbsence.type}`, '');
  } else {
    for (const c of programme.creneaux) {
      lines.push(`${c.hours}  ${c.label} (${c.nature})`);
      if (c.absence) lines.push(`    Absent(e) — ${c.absence.label || c.absence.type}`);
      else if (c.task) lines.push(`    ${c.task.title}${c.task.project ? ` [${c.task.project}]` : ''} — ${c.task.type}, priorité ${c.task.priority}`);
      else lines.push('    Non planifié');
      lines.push('');
    }
  }

  if (programme.ouvertes.length > 0) {
    lines.push('Vos tâches ouvertes :');
    for (const t of programme.ouvertes) {
      lines.push(`  - ${t.title} (${t.type}, ${t.priority}${t.dueDate ? `, échéance ${t.dueDate}` : ''})`);
    }
    lines.push('');
  }

  lines.push('— Suivi Infra & Réseau');
  return lines.join('\n');
}

export function renderHtml(programme) {
  const e = escapeHtml;
  const creneaux = programme.dayAbsence
    ? `<p style="margin:0 0 16px;padding:12px;background:#f1f5f9;border-radius:8px;color:#475569">
         Absent(e) toute la journée — ${e(programme.dayAbsence.label || programme.dayAbsence.type)}
       </p>`
    : programme.creneaux
        .map((c) => {
          const contenu = c.absence
            ? `<span style="color:#64748b">Absent(e) — ${e(c.absence.label || c.absence.type)}</span>`
            : c.task
              ? `<strong>${e(c.task.title)}</strong>${c.task.project ? ` <span style="color:#64748b">[${e(c.task.project)}]</span>` : ''}
                 <br><span style="color:#64748b;font-size:13px">${e(c.task.type)} · priorité ${e(c.task.priority)}</span>`
              : '<span style="color:#94a3b8">Non planifié</span>';
          return `<tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap;vertical-align:top;color:#475569;font-variant-numeric:tabular-nums">
                <strong>${e(c.hours)}</strong><br><span style="font-size:12px;color:#94a3b8">${e(c.label)}</span>
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top">${contenu}</td>
            </tr>`;
        })
        .join('');

  const ouvertes = programme.ouvertes.length
    ? `<h3 style="margin:24px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8">Vos tâches ouvertes</h3>
       <ul style="margin:0;padding-left:18px;color:#334155">
         ${programme.ouvertes
           .map(
             (t) =>
               `<li style="margin-bottom:4px">${e(t.title)} <span style="color:#94a3b8;font-size:13px">— ${e(t.type)}, ${e(t.priority)}${
                 t.dueDate ? `, échéance ${e(t.dueDate)}` : ''
               }</span></li>`
           )
           .join('')}
       </ul>`
    : '';

  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 4px;font-size:18px">Programme du ${e(formatLong(programme.iso))}</h1>
    <p style="margin:0 0 20px;color:#64748b;font-size:14px">${e(programme.member.name)} — ${e(programme.member.role)}</p>
    ${programme.dayAbsence ? creneaux : `<table style="width:100%;border-collapse:collapse">${creneaux}</table>`}
    ${ouvertes}
    <p style="margin:24px 0 0;color:#94a3b8;font-size:12px">Suivi Infra &amp; Réseau — message automatique, ne pas répondre.</p>
  </div>
</body></html>`;
}
