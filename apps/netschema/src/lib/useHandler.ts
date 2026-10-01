import { useCallback, useRef } from 'react'

/**
 * Rend un gestionnaire d'événement stable d'un rendu à l'autre, sans figer ce qu'il voit.
 *
 * Le plan de travail dessine plusieurs milliers d'éléments SVG. Pour que React puisse en
 * sauter le rendu quand rien n'a changé — le cas de tous les zooms et de tous les
 * déplacements de vue —, les éléments doivent garder la même identité, donc recevoir les
 * mêmes fonctions. Or une fonction déclarée dans le corps d'un composant est neuve à chaque
 * rendu : il suffit d'une pour que la mémoïsation ne serve plus à rien.
 *
 * `useCallback` avec une liste de dépendances marcherait, mais il faudrait la tenir à jour
 * sur quinze gestionnaires qui lisent chacun une dizaine d'états — et une dépendance oubliée
 * donne un gestionnaire qui agit sur des données périmées, panne parmi les plus pénibles à
 * diagnostiquer. On garde donc la dernière version dans une référence, mise à jour à chaque
 * rendu, et l'on expose une enveloppe qui, elle, ne change jamais : le gestionnaire voit
 * toujours l'état courant, puisqu'il ne s'exécute qu'après le rendu.
 *
 * C'est le motif « useEvent » décrit par l'équipe React ; il est ici écrit à la main, React
 * ne l'ayant pas encore stabilisé.
 */
// oxlint-disable react/refs, react/use-memo -- écrire dans la référence pendant le rendu et
// mémoïser une enveloppe sans dépendance sont précisément le fond du motif : c'est ce qui rend
// l'enveloppe stable tout en lui faisant voir le dernier état.
export function useHandler<T extends (...args: never[]) => unknown>(handler: T): T {
  const reference = useRef(handler)
  reference.current = handler
  return useCallback(((...args: never[]) => reference.current(...args)) as T, [])
}
