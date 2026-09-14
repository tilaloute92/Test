import 'dotenv/config';

/**
 * Configuration lue depuis les variables d'environnement (fichier .env — voir
 * .env.example pour la liste commentée de ce qui est attendu). Ce module ne
 * fait qu'exposer des valeurs déjà validées ; il échoue tôt et clairement si
 * un réglage indispensable manque, plutôt que de démarrer dans un état à
 * moitié configuré.
 */

function required(name, value) {
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}. Copiez server/.env.example en server/.env et remplissez-la.`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: required('JWT_SECRET', process.env.JWT_SECRET),
  sessionHours: Number(process.env.SESSION_HOURS) || 10,
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  // Le cookie de session doit être "Secure" (envoyé uniquement en HTTPS) en production.
  // En développement local (http://localhost, sans certificat), mettez COOKIE_SECURE=false
  // dans .env, sinon le navigateur refusera silencieusement d'enregistrer le cookie.
  cookieSecure: process.env.COOKIE_SECURE !== 'false',
  entraTenantId: process.env.ENTRA_TENANT_ID || '',
  entraClientId: process.env.ENTRA_CLIENT_ID || '',
  // Envoi du programme du jour par mail (voir src/mail/). Entièrement optionnel : sans
  // SMTP_HOST ni SMTP_FROM, la fonction est annoncée indisponible et rien d'autre ne change.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 25,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
  /** Heure d'envoi automatique du programme du jour, au format HH:MM. Vide = pas d'envoi automatique. */
  dailyMailAt: (process.env.DAILY_MAIL_AT || '').trim(),
};
