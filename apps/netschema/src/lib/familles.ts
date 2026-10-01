/**
 * Familles d'équipements, et leur couleur sur le plan.
 *
 * Le catalogue range déjà chaque type dans une famille — c'est ce qui structure la palette de
 * gauche. La même clé sert ici à encadrer, sur le plan, ce qui relève d'un même métier :
 * tous les commutateurs ensemble, tous les serveurs ensemble, l'énergie à part.
 *
 * Ce regroupement recoupe souvent les couches : la plupart des familles n'occupent qu'un seul
 * rang. Il apporte là où les couches ne disent rien — les switches de cœur et de distribution
 * se retrouvent dans un même cadre alors qu'ils vivent sur deux rangs, et le rang des serveurs,
 * qui mélange calcul, stockage et supervision, se sépare en trois.
 */

import { deviceMeta } from './catalog'
import type { NetNode } from '../types'

/**
 * Couleur de chaque famille.
 *
 * Fixe et non attribuée à la volée : une couleur qui changerait selon les équipements présents
 * ferait qu'un même parc ne se relit pas pareil d'un schéma à l'autre, ni d'un export au
 * suivant. Six familles reprennent l'accent déjà porté par leurs boîtes — le cadre et ce qu'il
 * contient parlent alors d'une seule voix ; les autres prennent une teinte libre, choisie pour
 * s'écarter au maximum des précédentes.
 *
 * Une réserve assumée : « Calcul & virtualisation » et « Énergie & environnement » ne sont
 * séparées que de trois degrés de teinte, les deux tenant leur couleur de l'accent de leurs
 * équipements. Elles se distinguent par la luminosité, et surtout par leur libellé et leur
 * éloignement sur le plan — l'énergie vit tout en bas. Au-delà d'une dizaine de couleurs, la
 * teinte cesse de toute façon d'être une clé fiable : c'est le libellé qui nomme, la couleur
 * qui regroupe.
 */
export const COULEURS_FAMILLES: Record<string, string> = {
  'Extérieur & opérateurs': '#475569',
  'Périmètre & routage': '#7c3aed',
  'Sécurité': '#dc2626',
  'Commutation & fabric': '#0891b2',
  'Sans fil & accès': '#059669',
  'Calcul & virtualisation': '#d97706',
  'Données & sauvegarde': '#4d7c0f',
  'Identité & supervision': '#a21caf',
  'Conteneurs & cloud': '#be185d',
  'Câblage & exploitation': '#15803d',
  'Voix & collaboration': '#1d4ed8',
  'Utilisateurs & périphériques': '#0d9488',
  'Industriel (OT)': '#7e22ce',
  'Énergie & environnement': '#78350f',
}

/** Couleur de repli pour une famille ajoutée au catalogue sans entrée ici. */
const NEUTRE = '#64748b'

export function couleurFamille(famille: string): string {
  return COULEURS_FAMILLES[famille] ?? NEUTRE
}

/** Famille d'un équipement, telle que le catalogue la range. */
export function familleDe(node: NetNode): string {
  return deviceMeta(node.kind).family
}

/**
 * Familles réellement présentes, dans l'ordre où le catalogue les déclare.
 *
 * Sert à la légende : on n'y liste que ce que le schéma contient, sinon quatorze lignes
 * décriraient un plan qui n'en montre que cinq.
 */
export function famillesPresentes(nodes: NetNode[]): { famille: string; couleur: string; compte: number }[] {
  const ordre = Object.keys(COULEURS_FAMILLES)
  const compte = new Map<string, number>()
  for (const node of nodes) {
    const famille = familleDe(node)
    compte.set(famille, (compte.get(famille) ?? 0) + 1)
  }
  return [...compte.entries()]
    .sort((a, b) => {
      const ia = ordre.indexOf(a[0])
      const ib = ordre.indexOf(b[0])
      return (ia < 0 ? ordre.length : ia) - (ib < 0 ? ordre.length : ib) || a[0].localeCompare(b[0])
    })
    .map(([famille, n]) => ({ famille, couleur: couleurFamille(famille), compte: n }))
}
