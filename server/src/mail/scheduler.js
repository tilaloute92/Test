import { readJsonEquipe, writeJsonEquipe } from '../dataStore.js';
import { listerEquipes } from '../equipes.js';
import { getMailConfig } from './mailConfig.js';
import { isMailConfigured } from './transport.js';
import { sendDailyProgrammes } from './send.js';
import { toISODate } from './dailyProgramme.js';

/**
 * Envoi automatique du programme du jour, à l'heure indiquée par DAILY_MAIL_AT.
 *
 * Volontairement minimal : un réveil par minute plutôt qu'une dépendance de planification.
 * La date du dernier envoi est écrite sur disque, si bien qu'un redémarrage du service en
 * pleine journée ne renvoie pas les messages du matin — la protection tient au fichier, pas
 * à la mémoire du processus.
 *
 * UN ÉTAT PAR ÉQUIPE, et c'est indispensable : le fichier ne retenait qu'une seule date
 * d'envoi. La première équipe servie à 7 h 45 marquait la journée comme faite, et les
 * autres ne recevaient jamais rien — un défaut invisible tant qu'il n'y avait qu'une
 * équipe, total dès la deuxième.
 */

const STATE_FILE = 'mail-state.json';
const MINUTE = 60 * 1000;

function readState(equipe) {
  return readJsonEquipe(equipe, STATE_FILE, { lastSentDate: null, lastRunAt: null, lastResults: [] });
}

export function getMailState(equipe) {
  return readState(equipe);
}

function isDue(now, state) {
  // Relu à chaque réveil, et non capturé au démarrage : l'heure se règle désormais depuis
  // la page Paramètres, et attendre un redémarrage du service pour qu'elle prenne effet
  // ferait croire le réglage sans effet.
  const heure = getMailConfig().dailyMailAt;
  if (!heure) return false;
  const [h, m] = heure.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const today = toISODate(now);
  if (state.lastSentDate === today) return false;
  // À l'heure dite ou après : un service arrêté au moment prévu envoie au redémarrage,
  // le même jour, plutôt que de sauter la journée en silence.
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}

async function tickEquipe(equipe) {
  const state = readState(equipe.id);
  if (!isDue(new Date(), state)) return;
  try {
    const { date, results } = await sendDailyProgrammes({ equipe: equipe.id });
    writeJsonEquipe(equipe.id, STATE_FILE, { lastSentDate: date, lastRunAt: new Date().toISOString(), lastResults: results });
    const envoyes = results.filter((r) => r.status === 'envoye').length;
    console.log(`[mail] ${equipe.nom} : programme du jour envoyé à ${envoyes} personne(s) pour le ${date}.`);
  } catch (error) {
    // On n'écrit pas lastSentDate : la tentative sera refaite à la minute suivante, ce qui
    // rattrape une coupure passagère du relais sans intervention.
    console.error(`[mail] ${equipe.nom} : envoi automatique en échec — ${error.message}`);
  }
}

async function tick() {
  if (!isMailConfigured()) return;
  // Chaque équipe a son propre état d'envoi : l'échec de l'une ne prive pas les autres,
  // et la réussite de l'une ne fait pas croire la journée faite pour toutes.
  for (const equipe of listerEquipes()) {
    await tickEquipe(equipe);
  }
}

export function startMailScheduler() {
  // Le planificateur tourne toujours : l'heure d'envoi et la configuration SMTP peuvent
  // être renseignées en cours de route depuis la page Paramètres, et un planificateur qui
  // aurait renoncé au démarrage ne s'en apercevrait jamais.
  const cfg = getMailConfig();
  if (cfg.dailyMailAt && !isMailConfigured()) {
    console.warn(`[mail] Heure d'envoi ${cfg.dailyMailAt} définie mais SMTP incomplet : aucun envoi tant que le relais n'est pas renseigné.`);
  } else if (cfg.dailyMailAt) {
    console.log(`[mail] Envoi automatique du programme du jour à ${cfg.dailyMailAt}.`);
  } else {
    console.log("[mail] Aucun envoi automatique (heure non renseignée dans Paramètres → Envoi de mail).");
  }
  setInterval(() => void tick(), MINUTE).unref();
  void tick();
}
