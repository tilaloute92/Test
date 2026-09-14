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
