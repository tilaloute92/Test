/**
 * Le plan de travail enregistre ici son élément SVG, pour que les commandes venues
 * d'ailleurs (voix, palette de commandes) puissent exporter le schéma sans avoir à faire
 * remonter une référence React à travers toute l'application.
 */
let diagramSvg: SVGSVGElement | null = null

export function setDiagramSvg(svg: SVGSVGElement | null) {
  diagramSvg = svg
}

export function getDiagramSvg(): SVGSVGElement | null {
  return diagramSvg
}
