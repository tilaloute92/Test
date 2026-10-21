/**
 * Administration des équipes — réservée à l'administrateur de plateforme.
 *
 * Ces appels ne portent PAS l'en-tête d'équipe : ils ne concernent aucune équipe en
 * particulier, ils décident lesquelles existent et qui va dedans. Le serveur les refuse
 * à quiconque n'est pas administrateur de plateforme (voir routes/equipes.js).
 */

export interface Equipe {
  id: string;
  nom: string;
}

export interface Appartenance {
  username: string;
  equipe: string;
  /** D'où vient l'affectation : `ldap` (relue à chaque connexion), `manuel` (posée ici),
   *  `automatique` (rattachement au démarrage tant qu'il n'y a qu'une équipe). */
  source: string;
}

export interface Correspondance {
  groupe: string;
  equipe: string;
}

export interface EtatEquipes {
  equipes: Equipe[];
  appartenances: Appartenance[];
  correspondances: Correspondance[];
  /** Comptes locaux rattachés à aucune équipe. Dès qu'il en existe deux, ils n'entrent
   *  plus nulle part : l'écran doit le montrer avant qu'ils ne s'en aperçoivent. */
  sansEquipe: string[];
}

const TIMEOUT_MS = 8000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/equipes${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  return data as T;
}

export const fetchEquipes = () => request<EtatEquipes>('');

export const creerEquipe = (nom: string) => request<Equipe>('', { method: 'POST', body: JSON.stringify({ nom }) });

export const renommerEquipe = (id: string, nom: string) =>
  request<Equipe>(`/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ nom }) });

export const retirerEquipe = (id: string) => request<{ ok: true }>(`/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const affecter = (username: string, equipe: string) =>
  request<Appartenance>(`/appartenances/${encodeURIComponent(username)}`, { method: 'PUT', body: JSON.stringify({ equipe }) });

export const desaffecter = (username: string) =>
  request<{ ok: true }>(`/appartenances/${encodeURIComponent(username)}`, { method: 'DELETE' });

export const enregistrerCorrespondances = (correspondances: Correspondance[]) =>
  request<{ correspondances: Correspondance[] }>('/correspondances', {
    method: 'PUT',
    body: JSON.stringify({ correspondances }),
  });
