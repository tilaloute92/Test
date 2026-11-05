/**
 * Palette des familles d'équipement.
 *
 * Isolée dans son propre module, sans aucune dépendance, pour deux raisons : elle est le
 * seul endroit où se décide le code couleur du schéma, et elle peut ainsi être vérifiée par
 * un test — le contraste de chaque couple est une exigence, pas une préférence.
 */

import type { AssetStatus } from '../types'

export interface CouplePalette {
  /** Couleur de trait, de pictogramme et des petits textes posés sur le fond. */
  accent: string
  /** Couleur de fond de la boîte. */
  fill: string
}

/**
 * Couleurs de famille : une teinte d'accent et son fond clair.
 *
 * L'accent sert à la fois au trait, au pictogramme et aux petits textes posés sur le fond
 * (débit, VLAN, rôle) — c'est ce dernier usage qui commande la teinte. Mesuré sur son fond,
 * chaque couple tient le rapport de 4,5:1 exigé par WCAG AA pour du texte courant : le
 * rouge, le cyan, le vert et l'ambre étaient auparavant à 4,41, 3,54, 3,58 et 3,07, soit
 * illisibles sur un vidéoprojecteur et à l'impression. La teinte est la même, en plus foncé :
 * le code couleur des familles ne change pas.
 */
export const PALETTE: Record<number, CouplePalette> = {
  0: { accent: '#475569', fill: '#f1f5f9' }, // ardoise — 6,92:1
  1: { accent: '#7c3aed', fill: '#f5f3ff' }, // violet  — 5,20:1
  2: { accent: '#b91c1c', fill: '#fef2f2' }, // rouge   — 5,91:1
  3: { accent: '#2563eb', fill: '#eff6ff' }, // bleu    — 4,75:1
  4: { accent: '#0e7490', fill: '#ecfeff' }, // cyan    — 5,15:1
  5: { accent: '#047857', fill: '#ecfdf5' }, // vert    — 5,21:1
  6: { accent: '#b45309', fill: '#fffbeb' }, // ambre   — 4,84:1
  7: { accent: '#64748b', fill: '#f8fafc' }, // gris    — 4,55:1 (inchangé)
  8: { accent: '#a16207', fill: '#fefce8' }, // or      — 4,76:1 (inchangé)
}

/**
 * Couleurs d'état. Elles colorent le libellé lui-même dans l'inventaire, pas seulement une
 * pastille : chacune doit donc tenir 4,5:1 sur le fond blanc du tableau. Les teintes 600 de
 * la palette n'y arrivaient pas — vert 3,77:1, ambre 3,19:1 — et « Retiré » en #94a3b8
 * tombait à 2,56:1, soit à peine visible.
 */
export const STATUS_COLORS: Record<AssetStatus, string> = {
  production: '#047857', // 5,48:1 sur blanc
  stock: '#1d4ed8', // 6,70:1
  maintenance: '#b45309', // 5,02:1
  retire: '#64748b', // 4,76:1
}
