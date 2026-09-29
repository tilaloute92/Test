/**
 * Client de l'envoi du programme du jour — voir server/src/routes/mail.js.
 *
 * Cette fonction n'existe qu'en mode client/serveur : un site statique ne peut pas remettre
 * un message à un relais SMTP. En mode autonome, `fetchMailStatus` échoue et l'interface
 * annonce la fonction indisponible plutôt que de proposer un bouton sans effet.
 */

export type MailSendStatus = 'envoye' | 'sans-adresse' | 'rien-a-envoyer' | 'echec';

export interface MailResult {
  memberId: string;
  name: string;
  email?: string;
  status: MailSendStatus;
  error?: string;
}

export interface MailStatus {
  configured: boolean;
  from: string | null;
  host: string | null;
  /** Heure d'envoi automatique (HH:MM), ou null si l'envoi n'est que manuel. */
  dailyMailAt: string | null;
  lastSentDate: string | null;
  lastRunAt: string | null;
  lastResults: MailResult[];
}

export interface MailPreview {
  memberId: string;
  name: string;
  email: string | null;
  subject: string | null;
  text: string | null;
}

const TIMEOUT_MS = 20000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/mail${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    // Un relais SMTP lent ne doit pas faire échouer l'envoi au bout de 6 s comme les appels
    // de données : on laisse nettement plus de temps ici.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data as T;
}

export const fetchMailStatus = () => request<MailStatus>('/status');

export const verifyMailRelay = () => request<{ ok: boolean }>('/verify', { method: 'POST' });

export const previewProgrammes = (date: string) =>
  request<{ date: string; previews: MailPreview[] }>(`/preview?date=${encodeURIComponent(date)}`);

export const sendDailyProgrammes = (date: string, memberIds?: string[]) =>
  request<{ date: string; results: MailResult[] }>('/daily-programme', {
    method: 'POST',
    body: JSON.stringify({ date, memberIds }),
  });

/** Réglages du relais SMTP, modifiables depuis Paramètres (réservé à l'administrateur).
 *  Le mot de passe n'en fait jamais partie : le serveur ne renvoie que `passSet`. */
export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  dailyMailAt: string;
  tlsRejectUnauthorized: boolean;
  passSet: boolean;
  configured: boolean;
  /** Rien n'a encore été enregistré depuis l'application : ce qui s'affiche vient du .env. */
  fromEnvOnly: boolean;
}

/** Ce qu'on envoie pour enregistrer. `pass` omis = mot de passe inchangé côté serveur. */
export type MailConfigInput = Omit<MailConfig, 'passSet' | 'configured' | 'fromEnvOnly'> & { pass?: string };

export const fetchMailConfig = () => request<MailConfig>('/config');

export const saveMailConfig = (cfg: MailConfigInput) =>
  request<MailConfig>('/config', { method: 'PUT', body: JSON.stringify(cfg) });

/** Envoi réel vers une adresse choisie. Distinct de `verifyMailRelay` : un relais peut
 *  accepter la connexion puis refuser le message (expéditeur non autorisé, relayage
 *  interdit pour cette IP) — seul un envoi le montre. */
export const sendTestMail = (to: string) =>
  request<{ ok: boolean; accepted: string[]; rejected: string[]; response: string }>('/test', {
    method: 'POST',
    body: JSON.stringify({ to }),
  });
