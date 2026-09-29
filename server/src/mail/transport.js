import nodemailer from 'nodemailer';
import { getMailConfig } from './mailConfig.js';

/**
 * Envoi de courrier via un relais SMTP.
 *
 * Le relais est celui de l'entreprise (Exchange, Microsoft 365, ou un relais interne) : ce
 * service ne délivre rien lui-même, il remet le message à un serveur SMTP qui s'en charge.
 * Tout est optionnel — sans configuration SMTP, le module reste inerte et l'application
 * fonctionne exactement comme avant, l'envoi de mail étant simplement annoncé indisponible.
 */

let cache = null;
let cacheEmpreinte = '';

/** Empreinte des réglages qui définissent la connexion. Le transport est reconstruit dès
 *  qu'ils changent : sans cela, modifier le relais depuis la page Paramètres n'aurait
 *  d'effet qu'au redémarrage du service, et on croirait le nouveau réglage inopérant. */
function empreinte(cfg) {
  return JSON.stringify([cfg.host, cfg.port, cfg.secure, cfg.user, cfg.pass, cfg.tlsRejectUnauthorized]);
}

export function isMailConfigured() {
  const cfg = getMailConfig();
  return Boolean(cfg.host && cfg.from);
}

function transport(cfg = getMailConfig()) {
  const e = empreinte(cfg);
  if (cache && e === cacheEmpreinte) return cache;
  cache = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    // `secure` = TLS dès la connexion (port 465). Sur 587, la connexion démarre en clair
    // puis bascule en TLS via STARTTLS, ce que nodemailer fait de lui-même.
    secure: cfg.secure,
    // Un relais interne accepte souvent les messages sans authentification, sur la seule
    // foi de l'adresse IP du serveur : on n'envoie d'identifiants que s'il y en a.
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    tls: cfg.tlsRejectUnauthorized === false ? { rejectUnauthorized: false } : undefined,
  });
  cacheEmpreinte = e;
  return cache;
}

const NON_CONFIGURE = "L'envoi de mail n'est pas configuré (Paramètres → Envoi de mail).";

/** Vérifie que le relais répond et accepte la connexion, sans envoyer de message. */
export async function verifyMail() {
  if (!isMailConfigured()) throw new Error(NON_CONFIGURE);
  await transport().verify();
}

export async function sendMail({ to, subject, text, html }) {
  const cfg = getMailConfig();
  if (!cfg.host || !cfg.from) throw new Error(NON_CONFIGURE);
  return transport(cfg).sendMail({ from: cfg.from, to, subject, text, html });
}
