/**
 * Catégories d'équipements (même liste que src/lib/types.ts, côté application). Les mots-clés
 * sont ajoutés à l'index de recherche : « wifi », « borne », « point d'accès » ou « AP »
 * trouvent une borne Wi-Fi même si son repère ne le dit pas.
 */
export const CATEGORIES = {
  wifi: { label: 'Borne Wi-Fi', words: "wifi wi-fi borne point d'acces ap sans fil" },
  telephonie: { label: 'Téléphonie', words: 'telephonie telephone poste dect toip autocom' },
  camera: { label: 'Caméra', words: 'camera video videoprotection videosurveillance' },
  reseau: { label: 'Prise réseau', words: 'prise reseau rj45 point de connexion' },
  baie: { label: 'Baie / armoire', words: 'baie armoire brassage coffret' },
  acces: { label: "Contrôle d'accès", words: "controle d'acces badge lecteur interphone gache" },
  electrique: { label: 'Électricité', words: 'electricite electrique tableau onduleur' },
  escalier: { label: 'Escalier', words: 'escalier escaliers marches cage volee' },
  ascenseur: { label: 'Ascenseur', words: 'ascenseur elevateur lift monte-charge monte-malade monte-lit cabine' },
  autre: { label: 'Autre', words: '' },
};
