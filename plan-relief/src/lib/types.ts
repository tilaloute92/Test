export type Role = 'mur' | 'fenetre' | 'porte' | 'plan' | 'ignore';
export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type Format = 'dxf' | 'pdf';
export type EquipmentKind = 'bloc' | 'texte' | 'manuel';

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
  notes?: string;
  /** Indications écrites près de cet équipement sur le plan (blocs uniquement). */
  indications?: string[];
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
