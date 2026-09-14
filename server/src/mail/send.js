import { getSnapshot } from '../businessData.js';
import { isMailConfigured, sendMail } from './transport.js';
import { buildProgramme, renderHtml, renderSubject, renderText, toISODate } from './dailyProgramme.js';

/**
 * Envoi du programme du jour à l'équipe.
 *
 * Le résultat est détaillé personne par personne plutôt que global : un relais SMTP peut
 * refuser une adresse et en accepter une autre, et l'administrateur doit voir laquelle a
 * échoué. Une adresse manquante n'est pas une erreur, c'est un cas normal signalé comme tel.
 */
export async function sendDailyProgrammes({ date, memberIds } = {}) {
  if (!isMailConfigured()) throw new Error("L'envoi de mail n'est pas configuré (voir SMTP_HOST et SMTP_FROM dans server/.env).");

  const iso = date || toISODate(new Date());
  const { members } = getSnapshot();
  const cibles = memberIds?.length ? members.filter((m) => memberIds.includes(m.id)) : members;

  const results = [];
  for (const member of cibles) {
    const email = (member.email || '').trim();
    if (!email) {
      results.push({ memberId: member.id, name: member.name, status: 'sans-adresse' });
      continue;
    }
    const programme = buildProgramme(member, iso);
    if (!programme) {
      results.push({ memberId: member.id, name: member.name, email, status: 'rien-a-envoyer' });
      continue;
    }
    try {
      await sendMail({
        to: email,
        subject: renderSubject(programme),
        text: renderText(programme),
        html: renderHtml(programme),
      });
      results.push({ memberId: member.id, name: member.name, email, status: 'envoye' });
    } catch (error) {
      results.push({ memberId: member.id, name: member.name, email, status: 'echec', error: error.message });
    }
  }

  return { date: iso, results };
}
