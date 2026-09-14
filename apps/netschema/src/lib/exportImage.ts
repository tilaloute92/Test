/** Export du schéma en SVG (vectoriel) et en PNG (bitmap). */

const FONT_STACK = "'Segoe UI', Inter, system-ui, -apple-system, sans-serif"

function cloneForExport(svg: SVGSVGElement, padding: number, background: string): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement

  // Les repères d'écran (grille, poignées de sélection, aperçu de liaison) sont marqués
  // `data-export="false"` : ils ne doivent pas se retrouver dans le fichier livré.
  clone.querySelectorAll('[data-export="false"]').forEach((el) => el.remove())

  const root = clone.querySelector<SVGGElement>('[data-export-root]')
  if (!root) throw new Error("Le schéma n'a pas pu être préparé pour l'export.")
  root.removeAttribute('transform')

  // getBBox() exige que l'élément soit dans le document : on mesure hors écran.
  clone.setAttribute('style', 'position:absolute;left:-10000px;top:0;visibility:hidden')
  document.body.appendChild(clone)
  const box = root.getBBox()
  clone.remove()
  clone.removeAttribute('style')

  const x = box.x - padding
  const y = box.y - padding
  const width = Math.max(1, box.width + padding * 2)
  const height = Math.max(1, box.height + padding * 2)

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  clone.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
  clone.setAttribute('width', String(Math.round(width)))
  clone.setAttribute('height', String(Math.round(height)))
  clone.setAttribute('font-family', FONT_STACK)

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('x', String(x))
  bg.setAttribute('y', String(y))
  bg.setAttribute('width', String(width))
  bg.setAttribute('height', String(height))
  bg.setAttribute('fill', background)
  clone.insertBefore(bg, clone.firstChild)

  return clone
}

export function svgMarkup(svg: SVGSVGElement, padding = 40, background = '#ffffff'): string {
  const clone = cloneForExport(svg, padding, background)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadSvg(svg: SVGSVGElement, filename: string) {
  downloadBlob(new Blob([svgMarkup(svg)], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

export async function downloadPng(svg: SVGSVGElement, filename: string, scale = 2) {
  const clone = cloneForExport(svg, 40, '#ffffff')
  const width = Number(clone.getAttribute('width')) || 1200
  const height = Number(clone.getAttribute('height')) || 800
  const markup = new XMLSerializer().serializeToString(clone)
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Le rendu PNG a échoué."))
    img.src = source
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("Le rendu PNG n'est pas disponible dans ce navigateur.")
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error("Le rendu PNG a échoué.")
  downloadBlob(blob, filename)
}

/** Nom de fichier propre, dérivé du titre du schéma. */
export function slugify(value: string): string {
  const base = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'schema-reseau'
}
