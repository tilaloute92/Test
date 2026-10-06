export type Role = 'mur' | 'fenetre' | 'porte' | 'plan' | 'ignore';
export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type Format = 'dxf' | 'pdf';
export type EquipmentKind = 'bloc' | 'texte' | 'manuel';

/**
 * Catégories d'équipements, pour les ajouts sur les plans et les filtres de recherche.
 * Même liste côté service (server/src/categories.js) : identifiants et mots-clés.
 */
export type Category = 'wifi' | 'telephonie' | 'camera' | 'reseau' | 'baie' | 'acces' | 'electrique' | 'autre';
export interface CategoryInfo {
  id: Category;
  label: string;
  /** Début des repères numérotés automatiquement (WIFI-01, TEL-01…). */
  prefix: string;
  color: number;
  hint: string;
}
export const CATEGORIES: CategoryInfo[] = [
  { id: 'wifi', label: 'Borne Wi-Fi', prefix: 'WIFI', color: 0x0e9f6e, hint: "Point d'accès sans fil" },
  { id: 'telephonie', label: 'Téléphonie', prefix: 'TEL', color: 0x7c3aed, hint: 'Poste téléphonique, borne DECT, autocom' },
  { id: 'camera', label: 'Caméra', prefix: 'CAM', color: 0xd61f69, hint: 'Vidéoprotection' },
  { id: 'reseau', label: 'Prise réseau', prefix: 'PR', color: 0x0891b2, hint: 'Prise RJ45, point de connexion' },
  { id: 'baie', label: 'Baie / armoire', prefix: 'BAIE', color: 0x475569, hint: 'Baie de brassage, armoire, coffret' },
  { id: 'acces', label: "Contrôle d'accès", prefix: 'CA', color: 0xb45309, hint: 'Lecteur de badge, interphone, gâche' },
  { id: 'electrique', label: 'Électricité', prefix: 'ELEC', color: 0xca8a04, hint: 'Tableau, onduleur, prise ondulée' },
  { id: 'autre', label: 'Autre', prefix: 'EQ', color: 0xd9730d, hint: 'Tout autre équipement' },
];
export const categoryOf = (id: string | undefined): CategoryInfo | undefined => CATEGORIES.find((c) => c.id === id);
export const cssColor = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export interface Fill {
  outer: number[];
  holes: number[][];
}

/** Un calque DXF, ou un groupe de traits de même épaisseur et couleur dans un PDF. */
export interface Group {
  id: string;
  name: string;
  color: number;
  kind: 'line' | 'fill';
  /** Segments à plat : x1, y1, x2, y2, x1, y1… dans l'unité du dessin. */
  segs: number[];
  fills: Fill[];
  width?: number;
  /** Rôle deviné à la lecture, utilisé tant que l'utilisateur n'en a pas choisi un autre. */
  guess: Role;
}

export interface Equipment {
  id: string;
  kind: EquipmentKind;
  label: string;
  type: string;
  layer: string;
  /** Position dans le repère du dessin (même unité que les segments). */
  x: number;
  y: number;
  attributes?: Record<string, string>;
  /** Catégorie choisie à l'ajout (ou après coup) : couleur du repère et filtre de recherche. */
  category?: Category;
  notes?: string;
  /** Indications écrites près de cet équipement sur le plan (blocs uniquement). */
  indications?: string[];
  /**
   * Nom du passage entre étages (gaine technique, colonne montante, escalier…). Deux
   * équipements portant le même nom sur deux étages d'un bâtiment sont reliés pour les tracés.
   */
  passage?: string;
}

export interface PlanSettings {
  unit: Unit;
  pdfScale: number;
  pdfPage: number;
  hWall: number;
  tWall: number;
  tMax: number;
  sill: number;
  hWin: number;
  slab: boolean;
  roles: Record<string, Role>;
}

export interface PlanMeta {
  name: string;
  site: string;
  building: string;
  floor: string;
  notes: string;
  /** Ordre de l'étage dans le bâtiment (0 = RDC, 1 = R+1, -1 = sous-sol). null : déduit du libellé d'étage. */
  level?: number | null;
  /** Hauteur de sol à sol, en mètres (montées entre étages). */
  floorHeight?: number | null;
}

export interface PlanSummary extends PlanMeta {
  id: string;
  file: { name: string; format: Format; size: number; sha256: string };
  equipmentCount: number;
  counts: Record<EquipmentKind, number>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface PlanRecord extends Omit<PlanSummary, 'equipmentCount' | 'counts'> {
  settings: PlanSettings;
  equipment: Equipment[];
}

export interface Drawing {
  format: Format;
  groups: Group[];
  equipment: Equipment[];
  /** Unité lue ou devinée (DXF uniquement). */
  unit?: { unit: Unit; source: 'file' | 'guess' };
  pageCount: number;
}

export interface SearchHit {
  planId: string;
  planName: string;
  site: string;
  building: string;
  floor: string;
  equipment: Equipment;
}

export const DEFAULT_SETTINGS: PlanSettings = {
  unit: 'm',
  pdfScale: 100,
  pdfPage: 1,
  hWall: 2.5,
  tWall: 0.2,
  tMax: 0.6,
  sill: 0.9,
  hWin: 1.25,
  slab: true,
  roles: {},
};

export const ROLE_LABELS: [Role, string][] = [
  ['mur', 'Murs'],
  ['fenetre', 'Fenêtres'],
  ['porte', 'Portes'],
  ['plan', 'Plan au sol'],
  ['ignore', 'Ignorer'],
];

export const KIND_LABELS: Record<EquipmentKind, string> = {
  bloc: 'Bloc',
  texte: 'Indication',
  manuel: 'Ajouté à la main',
};

export const UNIT_FACTORS: Record<Unit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
export const UNIT_NAMES: Record<Unit, string> = { mm: 'millimètres', cm: 'centimètres', m: 'mètres', in: 'pouces', ft: 'pieds' };
export const PT_TO_M = 0.0254 / 72;
