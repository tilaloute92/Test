/**
 * Encombrement de la légende et du cartouche.
 *
 * Le calcul est séparé de leur dessin : le plan de travail a besoin de la taille avant de
 * savoir où les poser, et une constante partagée n'a rien à faire dans un fichier de
 * composants (elle empêcherait le rechargement à chaud de ne recharger que des composants).
 */

import { agregats } from './aggregates'
import { deviceMeta } from './catalog'
import type { Diagram } from '../types'

/** Largeurs fixes : les deux blocs se posent côte à côte sous le schéma. */
export const LARGEUR_LEGENDE = 260
export const LARGEUR_CARTOUCHE = 420
const LIGNE_LEGENDE = 17
const LIGNE_CARTOUCHE = 19

/** Encombrement de la légende, pour la placer sans recouvrir le schéma. */
export function legendSize(diagram: Diagram): { width: number; height: number } {
  const kinds = new Set(diagram.links.map((link) => link.kind)).size
  const groupes = new Set(diagram.nodes.map((node) => deviceMeta(node.kind).family)).size
  // Une ligne de plus dès qu'il y a un agrégat à expliquer : l'ovale n'est évident que pour
  // qui l'a déjà vu.
  const lignes = kinds + groupes + (agregats(diagram).length > 0 ? 1 : 0)
  return {
    width: LARGEUR_LEGENDE,
    height: 30 + lignes * LIGNE_LEGENDE + (kinds > 0 && groupes > 0 ? 14 : 0) + 10,
  }
}

/** Hauteur occupée, pour placer ce qui vient à côté. */
export function titleBlockSize(diagram: Diagram): { width: number; height: number } {
  const bloc = diagram.titleBlock ?? {}
  const remplies = [
    bloc.organisation,
    bloc.reference,
    bloc.version,
    bloc.date,
    bloc.author,
    bloc.status,
    bloc.confidentiality,
  ].filter((valeur) => (valeur ?? '').trim() !== '').length
  const colonnes = remplies > 4 ? 2 : 1
  const parColonne = Math.ceil(remplies / colonnes)
  return { width: LARGEUR_CARTOUCHE, height: 34 + parColonne * LIGNE_CARTOUCHE + (bloc.notes ? 22 : 0) + 8 }
}
