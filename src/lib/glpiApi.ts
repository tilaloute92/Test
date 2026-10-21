import { enTeteEquipe } from './equipeCourante';

/**
 * Client du compteur de tickets GLPI — voir server/src/routes/glpi.js.
 *
 * Tout passe par NOTRE serveur, jamais par GLPI directement. Deux raisons, et elles sont
 * l'une et l'autre rédhibitoires : GLPI ne renvoie pas d'en-têtes CORS, un appel depuis
 * le navigateur serait donc refusé ; et le jeton du compte de service se retrouverait
 * dans le stockage local de chaque poste, lisible par n'importe quelle extension.
 * La console « Requêtes API » de l'application, elle, appelle bien depuis le navigateur :
 * c'est un outil d'essai manuel, pas une intégration permanente.
 */

export interface GlpiRepartition {
  nouveaux: number;
  enCours: number;
  enAttente: number;
  aClore: number;
}

export interface GlpiBucket {
  cle: keyof GlpiRepartition;
  libelle: string;
}

export interface GlpiEtat {
  /** Faux tant que le raccordement n'est pas configuré : l'écran n'affiche alors rien. */
  actif: boolean;
  lien?: string;
  /** `null` = on ne sait pas. Jamais 0 par défaut : voir server/src/glpi/compteur.js. */
  total: number | null;
  parStatut: GlpiRepartition | null;
  releveLe: string | null;
  /** Le dernier relevé réussi date de trop longtemps pour être présenté comme actuel. */
  perime: boolean;
  erreur: string | null;
  /** Tickets dont la personne connectée est le technicien attribué. */
  mien: number | null;
  /** Aucun compte GLPI ne correspond au compte de l'application. */
  mienInconnu: boolean;
  intervalleMinutes: number;
  buckets: GlpiBucket[];
}

export interface GlpiConfig {
  actif: boolean;
  url: string;
  criteres: unknown[];
  champStatut: number;
  champTechnicien: number;
  intervalleMinutes: number;
  correspondances: Record<string, string>;
  appTokenSet: boolean;
  userTokenSet: boolean;
}

export type GlpiConfigInput = Partial<Omit<GlpiConfig, 'appTokenSet' | 'userTokenSet'>> & {
  appToken?: string;
  userToken?: string;
};

export interface GlpiTest {
  ok: boolean;
  error?: string;
  total?: number;
  parStatut?: GlpiRepartition;
  /** Identifiant cherché dans GLPI pour la personne connectée. */
  login?: string;
  compteTrouve?: boolean;
}

const TIMEOUT_MS = 15000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/glpi${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...enTeteEquipe(), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  return data as T;
}

export const fetchGlpiTickets = () => request<GlpiEtat>('/tickets');

export const fetchGlpiConfig = () => request<GlpiConfig>('/config');

export const saveGlpiConfig = (cfg: GlpiConfigInput) =>
  request<GlpiConfig>('/config', { method: 'PUT', body: JSON.stringify(cfg) });

export const testGlpi = (cfg: GlpiConfigInput) => request<GlpiTest>('/test', { method: 'POST', body: JSON.stringify(cfg) });

export interface GlpiChamps {
  ok: boolean;
  error?: string;
  statut?: { id: number; nom: string } | null;
  technicien?: { id: number; nom: string } | null;
  nombreDeChamps?: number;
}

/** Lit les numéros de champ sur l'instance : ils dépendent de la version et des plugins. */
export const detecterChampsGlpi = (cfg: GlpiConfigInput) =>
  request<GlpiChamps>('/champs', { method: 'POST', body: JSON.stringify(cfg) });

export const criteresDepuisUrl = (url: string) =>
  request<{ criteres: unknown[] }>('/criteres-depuis-url', { method: 'POST', body: JSON.stringify({ url }) });
