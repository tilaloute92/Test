/** Extrémité d'un tracé : un équipement d'un plan. Codée « planId~equipementId » dans l'adresse. */
export interface EndpointRef { planId: string; eqId: string }
export const encodeEndpoint = (e: EndpointRef) => `${e.planId}~${e.eqId}`;
export const decodeEndpoint = (s?: string): EndpointRef | null => {
  const [planId, eqId] = (s || '').split('~');
  return planId && eqId ? { planId, eqId } : null;
};

const DRAFT_KEY = 'plan-relief:trace';
/** Mémorise le départ et l'arrivée choisis, pour les boutons « Tracé depuis / jusqu'ici » des plans. */
export function readDraft(): { de?: string; a?: string } {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}'); } catch { return {}; }
}
export function writeDraft(d: { de?: string; a?: string }) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* stockage indisponible */ }
}

