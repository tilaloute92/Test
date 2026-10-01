/**
 * Export vers Microsoft Visio (.vsdx).
 *
 * C'est le format que réclament les directions informatiques qui ne travaillent pas avec
 * draw.io : un schéma qu'on ne peut pas rendre en Visio ne remonte pas dans le dossier
 * d'architecture, et l'on recommence le dessin à la main — ce que cette application existe
 * précisément pour éviter.
 *
 * Un `.vsdx` est un paquet OPC : une archive ZIP de parties XML reliées entre elles par des
 * fichiers de relations. On écrit ici le sous-ensemble utile — une page, des formes
 * rectangulaires, des connecteurs rattachés à ces formes — plutôt qu'un gabarit complet. Les
 * formes sont donc des rectangles dessinés, non des symboles réseau de la bibliothèque Visio :
 * un symbole de gabarit exigerait d'embarquer les masters correspondants, que l'on n'a pas le
 * droit de redistribuer. Le sens est fidèle, le pictogramme non — et une forme Visio native
 * reste déplaçable, recolorable et reliée, ce qu'une image ne serait pas.
 *
 * Repère : Visio compte en pouces, l'origine en bas à gauche, l'axe Y vers le haut ; le plan
 * compte en pixels, l'origine en haut à gauche, l'axe Y vers le bas. Tout passe donc par
 * `versPouces` et un retournement vertical.
 */

import { deviceMeta, LINKS } from './catalog'
import { resumerVlans } from './osi'
import { creerZip, type EntreeZip } from './zip'
import { COULEUR_INTERCONNEXION, marqueInterconnexion, usagesVlans } from './vlanUsage'
import { NODE_H, NODE_W, type Annotation, type Diagram, type NetLink, type NetNode } from '../types'

/** Pixels par pouce. 96 est la résolution de référence du Web : une boîte fait 1,54 pouce. */
const PPP = 96
/** Marge autour du dessin, en pouces. */
const MARGE = 0.5

const versPouces = (pixels: number) => Number((pixels / PPP).toFixed(4))

function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Visio refuse le document entier sur un caractère de contrôle : on les retire. La règle
    // de lint les interdit dans une expression régulière ; c'est précisément ce qu'on vise.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

/** Couleur sur six chiffres, seule forme que Visio accepte dans une cellule. */
function couleur(valeur: string | undefined, defaut: string): string {
  const brut = (valeur ?? defaut).trim()
  if (/^#[0-9a-f]{6}$/i.test(brut)) return brut.toUpperCase()
  if (/^#[0-9a-f]{3}$/i.test(brut)) {
    return `#${brut[1]}${brut[1]}${brut[2]}${brut[2]}${brut[3]}${brut[3]}`.toUpperCase()
  }
  return defaut.toUpperCase()
}

interface Cadre {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function cadreDe(page: Diagram): Cadre {
  const cadre: Cadre = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const node of page.nodes) {
    cadre.minX = Math.min(cadre.minX, node.x - NODE_W / 2)
    cadre.minY = Math.min(cadre.minY, node.y - NODE_H / 2)
    cadre.maxX = Math.max(cadre.maxX, node.x + NODE_W / 2)
    cadre.maxY = Math.max(cadre.maxY, node.y + NODE_H / 2)
  }
  for (const annotation of page.annotations ?? []) {
    // Les flèches ne partent pas à l'export : les compter ici agrandirait la page pour rien,
    // et leur « taille » est un vecteur, qui peut être négatif.
    if (annotation.kind === 'arrow') continue
    cadre.minX = Math.min(cadre.minX, annotation.x)
    cadre.minY = Math.min(cadre.minY, annotation.y)
    cadre.maxX = Math.max(cadre.maxX, annotation.x + annotation.w)
    cadre.maxY = Math.max(cadre.maxY, annotation.y + annotation.h)
  }
  if (!Number.isFinite(cadre.minX)) return { minX: 0, minY: 0, maxX: PPP * 8, maxY: PPP * 6 }
  return cadre
}

/** Repère du plan vers repère Visio : pouces, origine en bas à gauche. */
function projeter(cadre: Cadre, x: number, y: number): { x: number; y: number } {
  return {
    x: Number((versPouces(x - cadre.minX) + MARGE).toFixed(4)),
    y: Number((versPouces(cadre.maxY - y) + MARGE).toFixed(4)),
  }
}

const cellule = (nom: string, valeur: string | number, formule?: string) =>
  `<Cell N="${nom}" V="${valeur}"${formule ? ` F="${echapper(formule)}"` : ''}/>`

/**
 * Géométrie d'un rectangle, en coordonnées relatives à la forme.
 *
 * Visio n'a pas de primitive « rectangle » : une forme porte une section de géométrie faite de
 * déplacements et de segments, exprimés en fractions de sa largeur et de sa hauteur. Les
 * écrire en formules plutôt qu'en valeurs fixes garde le dessin juste quand on redimensionne
 * la forme à la main.
 */
function geometrieRectangle(largeur: number, hauteur: number): string {
  const points: [string, number, string, number][] = [
    ['0', 0, '0', 0],
    ['Width*1', largeur, '0', 0],
    ['Width*1', largeur, 'Height*1', hauteur],
    ['0', 0, 'Height*1', hauteur],
    ['0', 0, '0', 0],
  ]
  const lignes = points
    .map(([fx, vx, fy, vy], index) => {
      const type = index === 0 ? 'MoveTo' : 'LineTo'
      return (
        `<Row T="${type}" IX="${index + 1}">` +
        `<Cell N="X" V="${vx}" F="${echapper(fx)}"/>` +
        `<Cell N="Y" V="${vy}" F="${echapper(fy)}"/>` +
        `</Row>`
      )
    })
    .join('')
  return `<Section N="Geometry" IX="0">${cellule('NoFill', 0)}${cellule('NoLine', 0)}${lignes}</Section>`
}

/** Mise en forme du texte d'une forme : taille, couleur, graisse. */
function sectionTexte(taille: number, teinte: string, gras: boolean): string {
  return (
    `<Section N="Character"><Row IX="0">` +
    cellule('Size', versPouces(taille)) +
    cellule('Color', teinte) +
    cellule('Style', gras ? 1 : 0) +
    cellule('Font', 'Segoe UI') +
    `</Row></Section>`
  )
}

function formeEquipement(node: NetNode, id: number, cadre: Cadre): string {
  const meta = deviceMeta(node.kind)
  const centre = projeter(cadre, node.x, node.y)
  const largeur = versPouces(NODE_W)
  const hauteur = versPouces(NODE_H)
  /*
    Le texte réunit ce que porte la boîte sur le plan : son nom, puis les lignes de détail. Un
    équipement exporté sans son adressage oblige à rouvrir NetSchema pour la moindre lecture.
  */
  // « VLAN 40 » saisi tel quel ne se préfixe pas une seconde fois.
  const vlan = node.vlan?.trim()
  const mentionVlan = vlan ? (/vlan/i.test(vlan) ? vlan : `VLAN ${vlan}`) : ''
  const lignes = [node.name, [node.ip, mentionVlan].filter(Boolean).join(' · '), node.model]
    .filter((ligne): ligne is string => !!ligne?.trim())
    .join('\n')
  return (
    `<Shape ID="${id}" NameU="${echapper(node.name) || `Equipement${id}`}" Type="Shape" ` +
    `LineStyle="0" FillStyle="0" TextStyle="0">` +
    cellule('PinX', centre.x) +
    cellule('PinY', centre.y) +
    cellule('Width', largeur) +
    cellule('Height', hauteur) +
    cellule('LocPinX', Number((largeur / 2).toFixed(4)), 'Width*0.5') +
    cellule('LocPinY', Number((hauteur / 2).toFixed(4)), 'Height*0.5') +
    cellule('Angle', 0) +
    cellule('FillForegnd', couleur(meta.fill, '#F1F5F9')) +
    cellule('FillPattern', 1) +
    cellule('LineColor', couleur(meta.accent, '#475569')) +
    cellule('LineWeight', 0.0139) +
    cellule('Rounding', 0.08) +
    cellule('VerticalAlign', 1) +
    sectionTexte(10, '#0F172A', true) +
    geometrieRectangle(largeur, hauteur) +
    `<Text>${echapper(lignes)}</Text>` +
    `</Shape>`
  )
}

function formeAnnotation(annotation: Annotation, id: number, cadre: Cadre): string {
  const coin = projeter(cadre, annotation.x, annotation.y + annotation.h)
  const largeur = versPouces(annotation.w)
  const hauteur = versPouces(annotation.h)
  const note = annotation.kind === 'note'
  return (
    `<Shape ID="${id}" NameU="Annotation${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    cellule('PinX', Number((coin.x + largeur / 2).toFixed(4))) +
    cellule('PinY', Number((coin.y + hauteur / 2).toFixed(4))) +
    cellule('Width', largeur) +
    cellule('Height', hauteur) +
    cellule('LocPinX', Number((largeur / 2).toFixed(4)), 'Width*0.5') +
    cellule('LocPinY', Number((hauteur / 2).toFixed(4)), 'Height*0.5') +
    cellule('FillForegnd', note ? '#FFFBEB' : '#FFFFFF') +
    cellule('FillPattern', note ? 1 : 0) +
    cellule('LineColor', couleur(annotation.color, note ? '#F59E0B' : '#7C3AED')) +
    cellule('LineWeight', 0.0139) +
    cellule('LinePattern', note ? 1 : 2) +
    cellule('VerticalAlign', 0) +
    sectionTexte(9.5, '#334155', false) +
    geometrieRectangle(largeur, hauteur) +
    `<Text>${echapper(annotation.text ?? '')}</Text>` +
    `</Shape>`
  )
}

/**
 * Connecteur entre deux formes.
 *
 * `ObjType=2` en fait un connecteur aux yeux de Visio : il se laisse rerouter, il suit les
 * formes qu'on déplace, et il apparaît comme liaison dans les outils d'analyse. Les cellules
 * `BeginX`/`EndX` donnent le tracé initial ; c'est la section `Connects` de la page qui dit à
 * quelles formes les deux bouts sont collés.
 */
function formeLiaison(
  link: NetLink,
  id: number,
  de: NetNode,
  vers: NetNode,
  cadre: Cadre,
  etiquette: string,
  interconnexion: boolean,
): string {
  const meta = LINKS[link.kind]
  const a = projeter(cadre, de.x, de.y)
  const b = projeter(cadre, vers.x, vers.y)
  /*
    Forme centrée sur le milieu du segment, de dimensions positives.

    Poser l'origine sur le point de départ et laisser la largeur devenir négative quand la
    liaison va vers la gauche donne une forme retournée : Visio l'accepte, mais le texte s'y
    écrit à l'envers et les lecteurs tiers la rendent en miroir. Le repère canonique d'un
    connecteur est son milieu, avec les deux bouts exprimés relativement à lui.
  */
  const largeur = Number(Math.abs(b.x - a.x).toFixed(4))
  const hauteur = Number(Math.abs(b.y - a.y).toFixed(4))
  const coinX = Math.min(a.x, b.x)
  const coinY = Math.min(a.y, b.y)
  const rel = (point: { x: number; y: number }) => ({
    x: Number((point.x - coinX).toFixed(4)),
    y: Number((point.y - coinY).toFixed(4)),
  })
  const depart = rel(a)
  const arrivee = rel(b)
  const pointille = link.redundant || link.dashed
  /*
    Bloc de texte à part, horizontal et de taille fixe. Sans lui, l'étiquette épouse la
    diagonale du connecteur : sur un plan dense, on obtient une pelote de mots pivotés au
    milieu du dessin, exactement ce qu'on cherchait à éviter en exportant.
  */
  const blocTexte =
    cellule('TxtPinX', Number((largeur / 2).toFixed(4)), 'Width*0.5') +
    cellule('TxtPinY', Number((hauteur / 2).toFixed(4)), 'Height*0.5') +
    cellule('TxtWidth', 1.6) +
    cellule('TxtHeight', 0.18) +
    cellule('TxtLocPinX', 0.8, 'TxtWidth*0.5') +
    cellule('TxtLocPinY', 0.09, 'TxtHeight*0.5') +
    cellule('TxtAngle', 0)
  return (
    `<Shape ID="${id}" NameU="Liaison${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    cellule('PinX', Number((coinX + largeur / 2).toFixed(4))) +
    cellule('PinY', Number((coinY + hauteur / 2).toFixed(4))) +
    cellule('Width', largeur) +
    cellule('Height', hauteur) +
    cellule('LocPinX', Number((largeur / 2).toFixed(4)), 'Width*0.5') +
    cellule('LocPinY', Number((hauteur / 2).toFixed(4)), 'Height*0.5') +
    cellule('Angle', 0) +
    cellule('BeginX', a.x) +
    cellule('BeginY', a.y) +
    cellule('EndX', b.x) +
    cellule('EndY', b.y) +
    cellule('ObjType', 2) +
    cellule('ShapeRouteStyle', 1) +
    cellule('LineColor', interconnexion ? COULEUR_INTERCONNEXION.toUpperCase() : couleur(meta?.color, '#475569')) +
    cellule('LineWeight', Number((Math.max(1, meta?.width ?? 2) / 72).toFixed(4))) +
    cellule('LinePattern', pointille ? 2 : 1) +
    cellule('BeginArrow', 0) +
    cellule('EndArrow', 0) +
    blocTexte +
    sectionTexte(7.5, '#475569', false) +
    `<Section N="Geometry" IX="0">` +
    cellule('NoFill', 1) +
    cellule('NoShow', 0) +
    `<Row T="MoveTo" IX="1"><Cell N="X" V="${depart.x}"/><Cell N="Y" V="${depart.y}"/></Row>` +
    `<Row T="LineTo" IX="2"><Cell N="X" V="${arrivee.x}"/><Cell N="Y" V="${arrivee.y}"/></Row>` +
    `</Section>` +
    `<Text>${echapper(etiquette)}</Text>` +
    `</Shape>`
  )
}

/**
 * Ce qu'on écrit le long du connecteur.
 *
 * Le plan répartit ces informations entre le milieu du câble et ses deux extrémités ; Visio
 * n'a qu'un texte par connecteur. On les réunit donc dans l'ordre où on les lit : ce qui
 * circule, à quelle vitesse, dans quel agrégat.
 */
function etiquetteLiaison(link: NetLink): string {
  const vlans = resumerVlans(link.vlans ?? link.vlansA ?? link.vlansB, 4)
  const morceaux = [
    link.label?.trim(),
    link.mode === 'trunk' ? (vlans ? `trunk ${vlans}` : 'trunk') : vlans ? `VLAN ${vlans}` : '',
    link.speed?.trim(),
    link.lag?.trim(),
    link.mtu ? `MTU ${link.mtu}` : '',
    link.subnet?.trim(),
  ].filter((valeur): valeur is string => !!valeur)
  return morceaux.join(' · ')
}

interface PagePreparee {
  nom: string
  largeur: number
  hauteur: number
  formes: string
  liens: string
}

function preparerPage(page: Diagram, nom: string): PagePreparee {
  const cadre = cadreDe(page)
  const usages = usagesVlans(page)
  const parId = new Map(page.nodes.map((node) => [node.id, node]))
  const idVisio = new Map<string, number>()
  let prochain = 1

  const formes: string[] = []
  for (const node of page.nodes) {
    const id = prochain
    prochain += 1
    idVisio.set(node.id, id)
    formes.push(formeEquipement(node, id, cadre))
  }

  const connexions: string[] = []
  for (const link of page.links) {
    const de = parId.get(link.from)
    const vers = parId.get(link.to)
    if (!de || !vers) continue
    const id = prochain
    prochain += 1
    const etiquette = etiquetteLiaison(link)
    formes.push(
      formeLiaison(link, id, de, vers, cadre, etiquette, marqueInterconnexion(link, usages) === 'totale'),
    )
    /*
      Collage des deux bouts. `FromPart` 9 et 12 désignent le début et la fin du connecteur,
      `ToPart` 3 le centre de la forme visée : c'est le collage dynamique, celui qui laisse
      Visio choisir le meilleur point d'accroche et le recalculer quand on déplace la boîte.
    */
    connexions.push(
      `<Connect FromSheet="${id}" FromCell="BeginX" FromPart="9" ToSheet="${idVisio.get(link.from)}" ToCell="PinX" ToPart="3"/>`,
      `<Connect FromSheet="${id}" FromCell="EndX" FromPart="12" ToSheet="${idVisio.get(link.to)}" ToCell="PinX" ToPart="3"/>`,
    )
  }

  for (const annotation of page.annotations ?? []) {
    // Une flèche d'annotation n'a pas d'équivalent simple : seules les notes et les cadres partent.
    if (annotation.kind === 'arrow') continue
    const id = prochain
    prochain += 1
    formes.push(formeAnnotation(annotation, id, cadre))
  }

  return {
    nom,
    largeur: Number((versPouces(cadre.maxX - cadre.minX) + MARGE * 2).toFixed(4)),
    hauteur: Number((versPouces(cadre.maxY - cadre.minY) + MARGE * 2).toFixed(4)),
    formes: formes.join(''),
    liens: connexions.join(''),
  }
}

const ENTETE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const NS = 'http://schemas.microsoft.com/office/visio/2012/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/**
 * Document Visio complet, une page par onglet du classeur.
 *
 * Le paquet est volontairement minimal : les parties que Visio sait reconstruire — fenêtres,
 * feuilles de style, masters — sont omises plutôt que remplies de valeurs approximatives, qui
 * se verraient à l'ouverture.
 */
export function versVisio(pages: Diagram[], titre: string): Blob {
  // Un document d'une seule page porte son titre ; au-delà, chaque onglet garde son nom.
  const preparees = pages.map((page, index) =>
    preparerPage(page, page.pageName?.trim() || (pages.length === 1 ? titre : `${titre} ${index + 1}`)),
  )
  const entrees: EntreeZip[] = []

  entrees.push({
    chemin: '[Content_Types].xml',
    contenu:
      ENTETE +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>' +
      '<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>' +
      preparees
        .map(
          (_, index) =>
            `<Override PartName="/visio/pages/page${index + 1}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`,
        )
        .join('') +
      '</Types>',
  })

  entrees.push({
    chemin: '_rels/.rels',
    contenu:
      ENTETE +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>',
  })

  const maintenant = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  entrees.push({
    chemin: 'docProps/core.xml',
    contenu:
      ENTETE +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${echapper(titre)}</dc:title>` +
      '<dc:creator>NetSchema</dc:creator>' +
      '<cp:lastModifiedBy>NetSchema</cp:lastModifiedBy>' +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${maintenant}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${maintenant}</dcterms:modified>` +
      '</cp:coreProperties>',
  })

  entrees.push({
    chemin: 'docProps/app.xml',
    contenu:
      ENTETE +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>NetSchema</Application>' +
      '<Company/>' +
      '</Properties>',
  })

  entrees.push({
    chemin: 'visio/document.xml',
    contenu:
      ENTETE +
      `<VisioDocument xmlns="${NS}" xmlns:r="${NS_REL}">` +
      '<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0">' +
      '<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings>' +
      '<SnapExtensions>34</SnapExtensions><DynamicGridEnabled>1</DynamicGridEnabled>' +
      '<ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes><ProtectMasters>0</ProtectMasters>' +
      '</DocumentSettings>' +
      '<FaceNames><FaceName NameU="Segoe UI" UnicodeRanges="0 0 0 0" CharSets="0 0" Panos="2 11 5 2 4 2 4 2 2 3" Flags="325"/></FaceNames>' +
      '<StyleSheets>' +
      '<StyleSheet ID="0" NameU="Aucun style" Name="Aucun style">' +
      '<Cell N="LineWeight" V="0.0139"/><Cell N="LineColor" V="#000000"/><Cell N="LinePattern" V="1"/>' +
      '<Cell N="FillForegnd" V="#FFFFFF"/><Cell N="FillPattern" V="1"/>' +
      '<Cell N="CharSize" V="0.1111"/><Cell N="CharColor" V="#000000"/>' +
      '</StyleSheet>' +
      '</StyleSheets>' +
      '</VisioDocument>',
  })

  entrees.push({
    chemin: 'visio/_rels/document.xml.rels',
    contenu:
      ENTETE +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>' +
      '</Relationships>',
  })

  entrees.push({
    chemin: 'visio/pages/pages.xml',
    contenu:
      ENTETE +
      `<Pages xmlns="${NS}" xmlns:r="${NS_REL}" xml:space="preserve">` +
      preparees
        .map(
          (page, index) =>
            `<Page ID="${index}" NameU="${echapper(page.nom)}" Name="${echapper(page.nom)}" ViewScale="-1" ` +
            `ViewCenterX="${(page.largeur / 2).toFixed(4)}" ViewCenterY="${(page.hauteur / 2).toFixed(4)}">` +
            '<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">' +
            cellule('PageWidth', page.largeur) +
            cellule('PageHeight', page.hauteur) +
            cellule('PageScale', 1, '1 in') +
            cellule('DrawingScale', 1, '1 in') +
            cellule('DrawingSizeType', 3) +
            cellule('DrawingScaleType', 0) +
            cellule('InhibitSnap', 0) +
            '</PageSheet>' +
            `<Rel r:id="rId${index + 1}"/>` +
            '</Page>',
        )
        .join('') +
      '</Pages>',
  })

  entrees.push({
    chemin: 'visio/pages/_rels/pages.xml.rels',
    contenu:
      ENTETE +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      preparees
        .map(
          (_, index) =>
            `<Relationship Id="rId${index + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page${index + 1}.xml"/>`,
        )
        .join('') +
      '</Relationships>',
  })

  for (const [index, page] of preparees.entries()) {
    entrees.push({
      chemin: `visio/pages/page${index + 1}.xml`,
      contenu:
        ENTETE +
        `<PageContents xmlns="${NS}" xmlns:r="${NS_REL}" xml:space="preserve">` +
        `<Shapes>${page.formes}</Shapes>` +
        (page.liens ? `<Connects>${page.liens}</Connects>` : '') +
        '</PageContents>',
    })
  }

  return creerZip(entrees)
}
