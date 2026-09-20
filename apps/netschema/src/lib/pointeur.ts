/**
 * Dernière position connue du pointeur sur le plan, en coordonnées de schéma.
 *
 * Coller au pointeur plutôt qu'à un décalage fixe : c'est là que l'utilisateur regarde, et
 * c'est ce qu'il attend. L'information ne vaut pas d'être stockée dans l'état de
 * l'application — elle change à chaque mouvement de souris et n'a aucun effet sur le rendu.
 */
let dernierPoint: { x: number; y: number } | null = null

export function noterPointeur(x: number, y: number): void {
  dernierPoint = { x, y }
}

export function pointeurCourant(): { x: number; y: number } | null {
  return dernierPoint
}
