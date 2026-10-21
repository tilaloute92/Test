import { enTeteEquipe } from './equipeCourante';
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
    headers: { 'Content-Type': 'application/json', ...enTeteEquipe(), ...(init?.headers ?? {}) },
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

// ------------------------------------------------------- Rapport de réunion

export type ReunionStatut = 'envoye' | 'echec' | 'sans-adresse' | 'adresse-invalide' | 'a-envoyer';

export interface ReunionDestinataire {
  nom: string;
  email: string | null;
  statut: ReunionStatut;
  erreur?: string;
}

export interface ReunionEnvoi {
  id: string;
  envoyeLe: string;
  par: string;
  objet: string;
  destinataires: string[];
  resultats: ReunionDestinataire[];
  echecs: number;
}

export interface ReunionConfig {
  destinatairesExternes: string[];
  dernierEnvoi: ReunionEnvoi | null;
}

export interface CibleRapport {
  memberIds?: string[];
  adresses?: string[];
}

export const fetchReunionConfig = () => request<ReunionConfig>('/rapport-reunion/config');

export const saveDestinatairesExternes = (destinatairesExternes: string[]) =>
  request<{ destinatairesExternes: string[] }>('/rapport-reunion/config', {
    method: 'PUT',
    body: JSON.stringify({ destinatairesExternes }),
  });

/** Qui recevrait quoi, sans rien envoyer : permet d'annoncer les personnes sans adresse
 *  AVANT le clic, plutôt que de le découvrir dans le compte rendu d'échec. */
export const previewDestinataires = (destinataires: CibleRapport) =>
  request<{ destinataires: ReunionDestinataire[] }>('/rapport-reunion/apercu', {
    method: 'POST',
    body: JSON.stringify({ destinataires }),
  });

export const sendReunionReport = (corps: {
  payload: unknown;
  destinataires: CibleRapport;
  objet: string;
  joindreDocument: boolean;
}) =>
  request<{ envoyeLe: string; objet: string; resultats: ReunionDestinataire[]; piecesJointes: string[] }>(
    '/rapport-reunion',
    { method: 'POST', body: JSON.stringify(corps) }
  );

export const fetchEnvoisReunion = () => request<{ envois: ReunionEnvoi[] }>('/rapport-reunion/envois');

/**
 * Le document complet en HTML, rendu par le serveur — le même code que la pièce jointe,
 * pour que ce qu'on télécharge soit exactement ce que les destinataires reçoivent.
 * Renvoie du HTML brut, d'où l'appel direct plutôt que `request`, qui attend du JSON.
 */
export async function fetchDocumentReunion(payload: unknown): Promise<string> {
  const res = await fetch('/api/mail/rapport-reunion/document', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...enTeteEquipe() },
    body: JSON.stringify({ payload }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(data.error || `Erreur ${res.status}`);
  }
  return res.text();
}
