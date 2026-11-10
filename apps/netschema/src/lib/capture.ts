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
import type { VueLogique } from './vlanViews'

export interface PageCapturee {
  nom: string
  diagram: Diagram
  /** Un SVG par vue demandée, dans l'ordre. */
  vues: { mode: ViewMode; logique?: VueLogique; svg: string }[]
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

/** Une vue à capturer : un mode, et pour le mode logique laquelle de ses lectures. */
export interface VueDemandee {
  mode: ViewMode
  logique?: VueLogique
}

/** Ce qu'un changement de mode ou de lecture logique réécrit, et qu'un export doit rendre. */
const REGLAGES_DE_VUE = [
  'viewMode', 'vueLogique', 'view', 'osi', 'strictOsi',
  'showIp', 'showVlans', 'showSpeeds', 'showGrid', 'showLayerLabels', 'showZones', 'showSites', 'showClusters', 'showLags',
] as const

/**
 * Capture toutes les pages du document dans les modes demandés.
 *
 * `modes` vide signifie « le mode courant », ce qui suffit au dossier technique : il montre
 * le schéma tel qu'il est tenu, pas ses quatre lectures.
 */
export async function capturerPages(modes: ViewMode[] = []): Promise<PageCapturee[]> {
  const vues = modes.length > 0 ? modes.map((mode): VueDemandee => ({ mode })) : null
  return capturerSelection(null, vues)
}

/**
 * Capture les pages et les vues demandées.
 *
 * `pages` à `null` : toutes. `vues` à `null` : la vue affichée, telle quelle.
 *
 * Changer de mode réécrit les cases d'affichage, et une lecture logique recadre le plan :
 * remettre le mode d'origine à la fin ne suffisait pas — les cases que l'utilisateur avait
 * décochées se retrouvaient cochées après un export. On relève donc tous ces réglages
 * avant de commencer, et on les rend tels quels.
 */
export async function capturerSelection(pages: number[] | null, vues: VueDemandee[] | null): Promise<PageCapturee[]> {
  const store = useDiagram.getState
  const moduleInitial = store().appView
  const pageInitiale = store().activePage
  const { past, future } = store()
  const etat = store()
  const reglages = Object.fromEntries(REGLAGES_DE_VUE.map((cle) => [cle, etat[cle]]))

  if (moduleInitial !== 'diagram') store().setAppView('diagram')

  const capturees: PageCapturee[] = []
  try {
    const svg = await attendreLeCanevas()
    const toutes = store().pagesCompletes()
    const index = (pages ?? toutes.map((_, position) => position)).filter((position) => position >= 0 && position < toutes.length)
    for (const position of index) {
      store().selectPage(position)
      const prises: PageCapturee['vues'] = []
      for (const vue of vues ?? [{ mode: store().viewMode, logique: store().viewMode === 'logique' ? store().vueLogique : undefined }]) {
        if (vue.mode === 'logique' && vue.logique) store().setVueLogique(vue.logique)
        else store().setViewMode(vue.mode)
        await repeindre()
        prises.push({ mode: vue.mode, logique: vue.logique, svg: svgMarkup(svg) })
      }
      capturees.push({
        nom: toutes[position].pageName ?? `Schéma ${position + 1}`,
        diagram: store().diagram,
        vues: prises,
      })
    }
  } finally {
    store().selectPage(pageInitiale)
    if (moduleInitial !== 'diagram') store().setAppView(moduleInitial)
    useDiagram.setState({ ...reglages, past, future })
  }
  return capturees
}
