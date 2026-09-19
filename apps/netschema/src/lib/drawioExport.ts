/**
 * Export vers draw.io / diagrams.net.
 *
 * L'import existait déjà : sans l'export, l'échange restait à sens unique et NetSchema
 * devenait un cul-de-sac pour un schéma qu'un prestataire attend dans son propre outil. On
 * écrit du XML non compressé — draw.io accepte les deux, et un fichier lisible se diffe, se
 * corrige et s'archive.
 *
 * Le rendu vise la fidélité du sens plutôt que du pixel : une boîte par équipement avec sa
 * couleur de couche, un lien par liaison avec son style, les groupes en conteneurs. Ce qui
 * n'a pas d'équivalent dans draw.io (cadres de couche, cartouche) n'est pas exporté.
 */

import { deviceMeta, LINKS } from './catalog'
import { NODE_H, NODE_W, type Diagram, type NetLink } from '../types'

function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Style d'une liaison, traduit dans la grammaire de draw.io. */
function styleLien(link: NetLink): string {
  const meta = LINKS[link.kind]
  const morceaux = [
    'edgeStyle=orthogonalEdgeStyle',
    'rounded=1',
    'html=1',
    'jettySize=auto',
    'orthogonalLoop=1',
    `strokeColor=${meta?.color ?? '#475569'}`,
    `strokeWidth=${Math.max(1, Math.round(meta?.width ?? 2))}`,
    'endArrow=none',
    'startArrow=none',
  ]
  if (meta?.dash || link.redundant) morceaux.push('dashed=1')
  return morceaux.join(';')
}

/** Étiquette d'une liaison : ce qu'on lit sur le schéma, débit et VLAN. */
function libelleLien(link: NetLink): string {
  return [link.label, link.speed, link.vlans ? `VLAN ${link.vlans}` : '']
    .filter(Boolean)
    .join(' · ')
}

function pageXml(diagram: Diagram, nom: string): string {
  const cellules: string[] = []

  for (const node of diagram.nodes) {
    const meta = deviceMeta(node.kind)
    const lignes = [node.name, meta.label, node.ip ?? '', node.vlan ? `VLAN ${node.vlan}` : '']
      .filter(Boolean)
      .join('&#10;')
    const style = [
      'rounded=1',
      'whiteSpace=wrap',
      'html=1',
      'arcSize=12',
      `fillColor=${meta.fill}`,
      `strokeColor=${meta.accent}`,
      'strokeWidth=2',
      'fontSize=11',
      'align=center',
      'verticalAlign=middle',
    ].join(';')
    cellules.push(
      `<mxCell id="${echapper(node.id)}" value="${echapper(lignes)}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${Math.round(node.x - NODE_W / 2)}" y="${Math.round(node.y - NODE_H / 2)}" ` +
        `width="${NODE_W}" height="${NODE_H}" as="geometry"/></mxCell>`,
    )
  }

  for (const link of diagram.links) {
    cellules.push(
      `<mxCell id="${echapper(link.id)}" value="${echapper(libelleLien(link))}" ` +
        `style="${styleLien(link)}" edge="1" parent="1" ` +
        `source="${echapper(link.from)}" target="${echapper(link.to)}">` +
        `<mxGeometry relative="1" as="geometry"/></mxCell>`,
    )
  }

  // Annotations : une note devient une boîte de texte, un cadre un rectangle en pointillés.
  for (const annotation of diagram.annotations ?? []) {
    if (annotation.kind === 'arrow') {
      const style = `endArrow=block;html=1;strokeColor=${annotation.color ?? '#dc2626'};strokeWidth=2`
      cellules.push(
        `<mxCell id="${echapper(annotation.id)}" value="${echapper(annotation.text ?? '')}" style="${style}" edge="1" parent="1">` +
          `<mxGeometry relative="1" as="geometry">` +
          `<mxPoint x="${Math.round(annotation.x)}" y="${Math.round(annotation.y)}" as="sourcePoint"/>` +
          `<mxPoint x="${Math.round(annotation.x + annotation.w)}" y="${Math.round(annotation.y + annotation.h)}" as="targetPoint"/>` +
          `</mxGeometry></mxCell>`,
      )
      continue
    }
    const note = annotation.kind === 'note'
    const style = [
      'rounded=1',
      'whiteSpace=wrap',
      'html=1',
      'align=left',
      'verticalAlign=top',
      'spacing=8',
      `strokeColor=${annotation.color ?? (note ? '#f59e0b' : '#7c3aed')}`,
      note ? 'fillColor=#fffbeb' : 'fillColor=none;dashed=1',
    ].join(';')
    cellules.push(
      `<mxCell id="${echapper(annotation.id)}" value="${echapper(annotation.text ?? '')}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${Math.round(annotation.x)}" y="${Math.round(annotation.y)}" ` +
        `width="${Math.round(annotation.w)}" height="${Math.round(annotation.h)}" as="geometry"/></mxCell>`,
    )
  }

  return (
    `<diagram name="${echapper(nom)}">` +
    `<mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" ` +
    `arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cellules.join('')}</root>` +
    `</mxGraphModel></diagram>`
  )
}

/** Document draw.io complet : une page par onglet du classeur. */
export function versDrawio(pages: Diagram[], titre: string): string {
  const contenu = pages
    .map((page, index) => pageXml(page, page.pageName ?? `${titre} ${index + 1}`))
    .join('')
  return `<mxfile host="NetSchema" type="device">${contenu}</mxfile>`
}
