import { config } from '../config.js';
import { readJson, writeJson } from '../dataStore.js';
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
 */

const STATE_FILE = 'mail-state.json';
const MINUTE = 60 * 1000;

function readState() {
  return readJson(STATE_FILE, { lastSentDate: null, lastRunAt: null, lastResults: [] });
}

export function getMailState() {
  return readState();
}

function isDue(now, state) {
  const [h, m] = config.dailyMailAt.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const today = toISODate(now);
  if (state.lastSentDate === today) return false;
  // À l'heure dite ou après : un service arrêté au moment prévu envoie au redémarrage,
  // le même jour, plutôt que de sauter la journée en silence.
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}

async function tick() {
  const state = readState();
  if (!isDue(new Date(), state)) return;
  try {
    const { date, results } = await sendDailyProgrammes({});
    writeJson(STATE_FILE, { lastSentDate: date, lastRunAt: new Date().toISOString(), lastResults: results });
    const envoyes = results.filter((r) => r.status === 'envoye').length;
    console.log(`[mail] Programme du jour envoyé à ${envoyes} personne(s) pour le ${date}.`);
  } catch (error) {
    // On n'écrit pas lastSentDate : la tentative sera refaite à la minute suivante, ce qui
    // rattrape une coupure passagère du relais sans intervention.
    console.error(`[mail] Envoi automatique en échec : ${error.message}`);
  }
}

export function startMailScheduler() {
  if (!config.dailyMailAt) return;
  if (!isMailConfigured()) {
    console.warn(`[mail] DAILY_MAIL_AT=${config.dailyMailAt} est défini mais SMTP n'est pas configuré : aucun envoi automatique.`);
    return;
  }
  console.log(`[mail] Envoi automatique du programme du jour à ${config.dailyMailAt}.`);
  setInterval(() => void tick(), MINUTE).unref();
  void tick();
}
