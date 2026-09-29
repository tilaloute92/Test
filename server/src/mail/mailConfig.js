import { readJson, writeJson } from '../dataStore.js';
import { config } from '../config.js';

const FILE = 'config.json';
const CLE = 'smtp';

/**
 * Réglages du relais SMTP, modifiables depuis la page Paramètres.
 *
 * Ils vivaient uniquement dans server/.env, c'est-à-dire hors de portée : changer le nom
 * du relais ou l'heure d'envoi exigeait une session sur le serveur, un éditeur de texte et
 * un redémarrage du service — pour un réglage que l'administrateur de l'application est le
 * mieux placé pour ajuster, et le plus susceptible de devoir ajuster plusieurs fois avant
 * que le relais n'accepte les messages.
 *
 * Le .env reste la valeur de DÉPART : ce qu'il contient sert tant que rien n'a été
 * enregistré depuis l'application. Une installation déjà configurée continue donc de
 * fonctionner à l'identique après mise à jour, sans rien ressaisir.
 */

const defautDepuisEnv = () => ({
  host: config.smtp.host || '',
  port: config.smtp.port || 25,
  secure: Boolean(config.smtp.secure),
  user: config.smtp.user || '',
  pass: config.smtp.pass || '',
  from: config.smtp.from || '',
  /** Heure d'envoi automatique du programme du jour, "HH:MM". Vide = pas d'envoi auto. */
  dailyMailAt: config.dailyMailAt || '',
  /** À décocher pour un relais interne présentant un certificat auto-signé. */
  tlsRejectUnauthorized: true,
});

const SECRETS = ['pass'];

function lireBrut() {
  const stocke = readJson(FILE, {})[CLE] ?? {};
  return { ...defautDepuisEnv(), ...Object.fromEntries(Object.entries(stocke).filter(([, v]) => v !== undefined)) };
}

/** Configuration complète, mot de passe compris — usage serveur uniquement. */
export function getMailConfig() {
  return lireBrut();
}

/** Ce qui peut être montré au navigateur. */
export function getPublicMailConfig() {
  const cfg = lireBrut();
  const publique = { ...cfg };
  for (const s of SECRETS) delete publique[s];
  return {
    ...publique,
    passSet: Boolean(cfg.pass),
    configured: Boolean(cfg.host && cfg.from),
    /** Vrai si rien n'a encore été enregistré depuis l'application : ce qui s'affiche vient
     *  alors du .env, et le dire évite de croire qu'on a déjà réglé quelque chose ici. */
    fromEnvOnly: readJson(FILE, {})[CLE] === undefined,
  };
}

export function setMailConfig(patch) {
  const courant = lireBrut();
  const suivant = { ...courant, ...patch };
  // Comme pour le compte de service LDAP : un secret absent ou vide conserve la valeur en
  // place, sinon enregistrer l'heure d'envoi effacerait le mot de passe du relais.
  for (const s of SECRETS) {
    if (patch[s] === undefined || patch[s] === '') suivant[s] = courant[s];
    else if (patch[s] === null) suivant[s] = '';
  }
  const tout = readJson(FILE, {});
  writeJson(FILE, { ...tout, [CLE]: suivant });
  return getPublicMailConfig();
}
