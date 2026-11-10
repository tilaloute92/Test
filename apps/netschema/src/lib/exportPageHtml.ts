import { capturerSelection } from './capture'
import { choixNormalise, choixValide, memoriserChoix, vuesExportables, type ChoixExport } from './exportChoix'
import { pageInteractive, type PageExportee } from './exportHtml'
import { downloadBlob, slugify } from './exportImage'
import { useDiagram } from '../store/useDiagram'

/**
 * Export « page HTML » selon un choix de pages, de vues et de tableaux.
 *
 * La capture est le rendu réel de l'application, page après page et vue après vue ; ce qui
 * était ouvert et réglé est remis en place à la fin (voir `capturerSelection`). Le fichier
 * ne contient que ce qui a été demandé.
 */
export async function exporterPageHtml(choix: ChoixExport): Promise<{ pages: number; vues: number; fichier: string }> {
  const store = useDiagram.getState
  const total = store().pagesCompletes().length
  const propre = choixNormalise(choix, total)
  if (!choixValide(propre)) throw new Error('Choisissez au moins une page et une vue.')

  const vues = vuesExportables().filter((vue) => propre.vues.includes(vue.id))
  const capturees = await capturerSelection(
    propre.pages,
    vues.map((vue) => ({ mode: vue.mode, logique: vue.logique })),
  )
  const pages: PageExportee[] = capturees.map((page) => ({
    nom: page.nom,
    diagram: page.diagram,
    vues: page.vues.map((capture, rang) => ({
      id: vues[rang].id,
      label: vues[rang].label,
      hint: vues[rang].hint,
      svg: capture.svg,
    })),
  }))

  const titre = store().diagram.title
  const fichier = `${slugify(titre)}.html`
  const html = pageInteractive(titre, pages, { tableaux: propre.tableaux, pagesDuDocument: total })
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), fichier)
  memoriserChoix(propre)
  return { pages: pages.length, vues: vues.length, fichier }
}
