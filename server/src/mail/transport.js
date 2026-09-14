import nodemailer from 'nodemailer';
import { config } from '../config.js';

/**
 * Envoi de courrier via un relais SMTP.
 *
 * Le relais est celui de l'entreprise (Exchange, Microsoft 365, ou un relais interne) : ce
 * service ne délivre rien lui-même, il remet le message à un serveur SMTP qui s'en charge.
 * Tout est optionnel — sans configuration SMTP, le module reste inerte et l'application
 * fonctionne exactement comme avant, l'envoi de mail étant simplement annoncé indisponible.
 */

let cached = null;

export function isMailConfigured() {
  return Boolean(config.smtp.host && config.smtp.from);
}

function transport() {
  if (cached) return cached;
  const { host, port, secure, user, pass } = config.smtp;
  cached = nodemailer.createTransport({
    host,
    port,
    // `secure` = TLS dès la connexion (port 465). Sur 587, la connexion démarre en clair
    // puis bascule en TLS via STARTTLS, ce que nodemailer fait de lui-même.
    secure,
    // Un relais interne accepte souvent les messages sans authentification, sur la seule
    // foi de l'adresse IP du serveur : on n'envoie d'identifiants que s'il y en a.
    auth: user ? { user, pass } : undefined,
  });
  return cached;
}

/** Vérifie que le relais répond et accepte la connexion, sans envoyer de message. */
export async function verifyMail() {
  if (!isMailConfigured()) throw new Error("L'envoi de mail n'est pas configuré (voir SMTP_HOST et SMTP_FROM dans server/.env).");
  await transport().verify();
}

export async function sendMail({ to, subject, text, html }) {
  if (!isMailConfigured()) throw new Error("L'envoi de mail n'est pas configuré (voir SMTP_HOST et SMTP_FROM dans server/.env).");
  return transport().sendMail({ from: config.smtp.from, to, subject, text, html });
}
