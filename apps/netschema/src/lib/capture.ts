/**
 * Capture du schéma, page par page et vue par vue.
 *
 * Les exports composites (page interactive, dossier technique) ont besoin du rendu réel de
 * l'application, pas d'un second moteur de dessin qui divergerait au premier réglage. On
 * bascule donc la page et le mode, on laisse le navigateur repeindre, et on relève le SVG.
 *
 * Deux précautions rendent l'opération sans conséquence pour l'utilisateur : la page, le
 * mode de visualisation et le module ouverts sont remis en place à la fin, et l'historique
 * d'annulation est restauré — la bascule de page le vide, or un export ne doit rien coûter
 * au travail en cours.
 */

import { getDiagramSvg } from './exportRegistry'
import { svgMarkup } from './exportImage'
import { useDiagram } from '../store/useDiagram'
import type { Diagram, ViewMode } from '../types'

export interface PageCapturee {
  nom: string
  diagram: Diagram
  /** Un SVG par mode demandé, dans l'ordre. */
  vues: { mode: ViewMode; svg: string }[]
}

/** Laisse le navigateur peindre avant de relever le SVG. */
function repeindre(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** Attend que le plan de travail soit monté (il ne l'est pas depuis un autre module). */
async function attendreLeCanevas(delaiMs = 3000): Promise<SVGSVGElement> {
  const limite = Date.now() + delaiMs
  for (;;) {
    const svg = getDiagramSvg()
    if (svg) return svg
    if (Date.now() > limite) {
      throw new Error("Le plan de travail n'a pas pu être préparé pour l'export.")
    }
    await repeindre()
  }
}

/**
 * Capture toutes les pages du document dans les modes demandés.
 *
 * `modes` vide signifie « le mode courant », ce qui suffit au dossier technique : il montre
 * le schéma tel qu'il est tenu, pas ses quatre lectures.
 */
export async function capturerPages(modes: ViewMode[] = []): Promise<PageCapturee[]> {
  const store = useDiagram.getState
  const moduleInitial = store().appView
  const pageInitiale = store().activePage
  const modeInitial = store().viewMode
  const { past, future } = store()

  if (moduleInitial !== 'diagram') store().setAppView('diagram')

  const capturees: PageCapturee[] = []
  try {
    const svg = await attendreLeCanevas()
    const pages = store().pagesCompletes()
    for (let index = 0; index < pages.length; index += 1) {
      store().selectPage(index)
      const vues: PageCapturee['vues'] = []
      for (const mode of modes.length > 0 ? modes : [store().viewMode]) {
        store().setViewMode(mode)
        await repeindre()
        vues.push({ mode, svg: svgMarkup(svg) })
      }
      capturees.push({
        nom: pages[index].pageName ?? `Schéma ${index + 1}`,
        diagram: store().diagram,
        vues,
      })
    }
  } finally {
    store().selectPage(pageInitiale)
    store().setViewMode(modeInitial)
    if (moduleInitial !== 'diagram') store().setAppView(moduleInitial)
    useDiagram.setState({ past, future })
  }
  return capturees
}
