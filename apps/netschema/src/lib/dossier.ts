/**
 * Dossier technique : un document imprimable, d'où sort le PDF.
 *
 * Un schéma ne fait pas un dossier. Ce qu'on remet à une maîtrise d'ouvrage, à un auditeur
 * ou à l'exploitation, c'est une pièce datée, indicée, avec une page de garde, un sommaire,
 * les plans, puis les tableaux qui les accompagnent : équipements, liaisons, plan
 * d'adressage, baies, matrice de flux, réserves.
 *
 * La sortie est une page HTML mise en page pour l'impression : ouvrir le fichier et
 * imprimer en PDF suffit, sur n'importe quel poste, sans imposer une bibliothèque PDF de
 * 500 ko dans l'application et sans dépendre d'un serveur.
 */

import { deviceMeta, LAYER_LABELS, LINKS, ROLES } from './catalog'
import { controlerMatrice, FLOW_ACTIONS } from './flows'
import { auditDiagram } from './ha'
import { linkEnd } from './osi'
import { controlerDossier } from './quality'
import { heightOf } from './racks'
import type { Diagram } from '../types'

export interface PageDossier {
  nom: string
  diagram: Diagram
  /** SVG du schéma, tel que l'application le dessine. */
  svg: string
}

function texte(valeur: unknown): string {
  return valeur === undefined || valeur === null ? '' : String(valeur).trim()
}

function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function tableau(entetes: string[], lignes: string[][]): string {
  if (lignes.length === 0) return '<p class="vide">Aucune donnée.</p>'
  const th = entetes.map((entete) => `<th>${echapper(entete)}</th>`).join('')
  const tr = lignes
    .map((ligne) => `<tr>${ligne.map((cellule) => `<td>${echapper(cellule)}</td>`).join('')}</tr>`)
    .join('')
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`
}

/** Fiche d'un équipement, ligne par ligne du tableau d'inventaire. */
function lignesEquipements(diagram: Diagram): string[][] {
  const racks = new Map((diagram.racks ?? []).map((rack) => [rack.id, rack.name]))
  return [...diagram.nodes]
    .sort((a, b) => (deviceMeta(a.kind).rank - deviceMeta(b.kind).rank) || a.name.localeCompare(b.name))
    .map((node) => [
      node.name,
      deviceMeta(node.kind).label,
      [texte(node.vendor), texte(node.model)].filter(Boolean).join(' '),
      texte(node.ip),
      texte(node.vlan),
      texte(node.zone),
      texte(node.site),
      texte(node.cluster) + (node.role && node.role !== 'standalone' ? ` (${ROLES[node.role].label})` : ''),
      node.rack ? `${racks.get(node.rack) ?? node.rack}${node.rackUnit ? ` U${node.rackUnit}` : ''}` : '',
      texte(node.serial),
      texte(node.owner),
      texte(node.warrantyEnd),
    ])
}

function lignesLiaisons(diagram: Diagram): string[][] {
  const noms = new Map(diagram.nodes.map((node) => [node.id, node.name]))
  const bout = (link: (typeof diagram.links)[number], cote: 'a' | 'b') => {
    const config = linkEnd(link, cote)
    return [
      config.port,
      config.mode === 'trunk' ? 'trunk' : config.mode === 'access' ? 'accès' : '',
      config.vlans ? `VLAN ${config.vlans}` : '',
      config.lag ? `LAG ${config.lag}` : '',
      config.ip,
    ]
      .filter(Boolean)
      .join(' · ')
  }
  return diagram.links.map((link) => [
    noms.get(link.from) ?? link.from,
    noms.get(link.to) ?? link.to,
    LINKS[link.kind]?.label ?? link.kind,
    texte(link.speed),
    bout(link, 'a'),
    bout(link, 'b'),
    texte(link.subnet),
    link.mtu ? String(link.mtu) : '',
    link.redundant ? 'oui' : '',
  ])
}

/** Puissance installée par baie : ce que demande l'électricien avant d'ajouter un serveur. */
function lignesBaies(diagram: Diagram): string[][] {
  return (diagram.racks ?? []).map((rack) => {
    const occupants = diagram.nodes.filter((node) => node.rack === rack.id)
    const u = occupants.reduce((total, node) => total + heightOf(node), 0)
    const watts = occupants.reduce((total, node) => total + (node.powerW ?? 0), 0)
    return [
      rack.name,
      texte(rack.site),
      texte(rack.room),
      `${u} / ${rack.units} U`,
      watts > 0 ? `${watts} W` : '',
      String(occupants.length),
      texte(rack.notes),
    ]
  })
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: 'Segoe UI', Inter, system-ui, -apple-system, sans-serif;
    color: #0f172a;
    background: #f1f5f9;
    font-size: 12px;
    line-height: 1.5;
  }
  .feuille {
    background: #ffffff;
    margin: 12px auto;
    padding: 18mm 16mm;
    width: 297mm;
    min-height: 210mm;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.12);
  }
  h1 { font-size: 26px; margin: 0 0 6px; }
  h2 { font-size: 17px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #0f172a; }
  h3 { font-size: 13.5px; margin: 16px 0 6px; color: #334155; }
  p { margin: 0 0 8px; }
  .sous-titre { color: #475569; font-size: 14px; margin-bottom: 26px; }
  .cartouche { width: 100%; border-collapse: collapse; margin: 22px 0; }
  .cartouche td { border: 1px solid #cbd5e1; padding: 7px 10px; }
  .cartouche td:nth-child(odd) { background: #f8fafc; color: #64748b; width: 120px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 10.5px; }
  th, td { border: 1px solid #e2e8f0; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f8fafc; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.03em; color: #475569; }
  tbody tr:nth-child(even) { background: #fbfcfe; }
  .vide { color: #94a3b8; font-style: italic; }
  .schema { text-align: center; margin: 10px 0 18px; }
  .schema svg { max-width: 100%; height: auto; }
  .sommaire { list-style: none; padding: 0; font-size: 13px; }
  .sommaire li { padding: 5px 0; border-bottom: 1px dotted #cbd5e1; }
  .constat { display: flex; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
  .pastille { width: 9px; height: 9px; border-radius: 50%; margin-top: 4px; flex: 0 0 auto; }
  .constat b { display: block; }
  .constat span { color: #475569; }
  .note { background: #f8fafc; border-left: 3px solid #94a3b8; padding: 8px 12px; margin: 10px 0; color: #475569; }
  .barre { height: 7px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
  .barre i { display: block; height: 100%; background: #2563eb; }
  .grille { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 22px; margin: 10px 0 16px; }
  .grille div { font-size: 11px; }
  .pied { margin-top: 26px; padding-top: 8px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 10px; }
  @media print {
    body { background: #ffffff; }
    .feuille { margin: 0; box-shadow: none; width: auto; padding: 0; page-break-after: always; }
    .feuille:last-child { page-break-after: auto; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  }
  @page { size: A4 landscape; margin: 12mm; }
`

const COULEURS_GRAVITE: Record<string, string> = {
  critique: '#dc2626',
  majeur: '#d97706',
  mineur: '#2563eb',
  info: '#64748b',
  avertissement: '#d97706',
}

/**
 * Compose le dossier.
 *
 * Une « feuille » par section : la mise en page d'impression coupe entre elles, et la
 * lecture à l'écran garde la même structure que le document imprimé.
 */
export function dossierTechnique(titre: string, pages: PageDossier[]): string {
  const principale = pages[0]?.diagram
  const bloc = principale?.titleBlock ?? {}
  const aujourdhui = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  const qualite = controlerDossier(
    pages.map((page) => page.diagram),
    titre,
  )
  const ha = principale ? auditDiagram(principale) : null
  const flux = principale ? controlerMatrice(principale) : null

  const cartouche = [
    ['Organisation', texte(bloc.organisation)],
    ['Référence', texte(bloc.reference)],
    ['Indice de révision', texte(bloc.version)],
    ['Date du document', texte(bloc.date) || aujourdhui],
    ['Établi par', texte(bloc.author)],
    ['État', texte(bloc.status)],
    ['Diffusion', texte(bloc.confidentiality)],
    ['Pages de schéma', String(pages.length)],
  ]

  const garde = `
    <section class="feuille">
      <h1>${echapper(titre)}</h1>
      <p class="sous-titre">Dossier technique d’infrastructure réseau</p>
      <table class="cartouche">
        ${cartouche
          .map(([etiquette, valeur]) => `<tr><td>${echapper(etiquette)}</td><td>${echapper(valeur || '—')}</td></tr>`)
          .join('')}
      </table>
      ${bloc.notes ? `<p class="note">${echapper(texte(bloc.notes))}</p>` : ''}
      <h3>Sommaire</h3>
      <ol class="sommaire">
        ${pages.map((page) => `<li>Schéma — ${echapper(page.nom)}</li>`).join('')}
        <li>Inventaire des équipements</li>
        <li>Liaisons et raccordements</li>
        <li>Plan d’adressage (VLAN)</li>
        <li>Implantation en baies</li>
        <li>Matrice de flux</li>
        <li>Réserves et points d’attention</li>
      </ol>
      <p class="pied">Document produit le ${echapper(aujourdhui)} par NetSchema. Les informations
      proviennent du schéma : elles ne reflètent pas une lecture des configurations réelles.</p>
    </section>
  `

  const feuillesSchemas = pages
    .map(
      (page) => `
        <section class="feuille">
          <h2>Schéma — ${echapper(page.nom)}</h2>
          <div class="schema">${page.svg}</div>
          <div class="grille">
            <div><b>${page.diagram.nodes.length}</b> équipements</div>
            <div><b>${page.diagram.links.length}</b> liaisons</div>
            <div><b>${new Set(page.diagram.nodes.map((n) => n.zone).filter(Boolean)).size}</b> zones</div>
            <div><b>${new Set(page.diagram.nodes.map((n) => n.site).filter(Boolean)).size}</b> sites</div>
          </div>
        </section>`,
    )
    .join('')

  const equipements = `
    <section class="feuille">
      <h2>Inventaire des équipements</h2>
      ${pages
        .map(
          (page) => `
            ${pages.length > 1 ? `<h3>${echapper(page.nom)}</h3>` : ''}
            ${tableau(
              ['Nom', 'Type', 'Matériel', 'Adresse IP', 'VLAN', 'Zone', 'Site', 'Grappe', 'Baie', 'N° de série', 'Responsable', 'Fin de garantie'],
              lignesEquipements(page.diagram),
            )}`,
        )
        .join('')}
    </section>
  `

  const liaisons = `
    <section class="feuille">
      <h2>Liaisons et raccordements</h2>
      ${pages
        .map(
          (page) => `
            ${pages.length > 1 ? `<h3>${echapper(page.nom)}</h3>` : ''}
            ${tableau(
              ['De', 'Vers', 'Type', 'Débit', 'Extrémité A', 'Extrémité B', 'Sous-réseau', 'MTU', 'Secours'],
              lignesLiaisons(page.diagram),
            )}`,
        )
        .join('')}
    </section>
  `

  const adressage = `
    <section class="feuille">
      <h2>Plan d’adressage</h2>
      ${tableau(
        ['VLAN', 'Nom', 'Sous-réseau', 'Passerelle', 'Commentaire'],
        (principale?.vlans ?? []).map((vlan) => [
          vlan.id,
          texte(vlan.name),
          texte(vlan.subnet),
          texte(vlan.gateway),
          texte(vlan.notes),
        ]),
      )}
      <h3>Couches du schéma</h3>
      ${tableau(
        ['Rang', 'Couche', 'Équipements'],
        Object.entries(LAYER_LABELS).map(([rang, label]) => [
          rang,
          principale?.layerNames?.[rang] ?? label,
          String(
            (principale?.nodes ?? []).filter((node) => deviceMeta(node.kind).rank === Number(rang)).length,
          ),
        ]).filter((ligne) => ligne[2] !== '0'),
      )}
    </section>
  `

  const baies = `
    <section class="feuille">
      <h2>Implantation en baies</h2>
      ${tableau(
        ['Baie', 'Site', 'Local', 'Occupation', 'Puissance installée', 'Équipements', 'Commentaire'],
        pages.flatMap((page) => lignesBaies(page.diagram)),
      )}
    </section>
  `

  const matrice = `
    <section class="feuille">
      <h2>Matrice de flux</h2>
      ${tableau(
        ['Source', 'Destination', 'Service', 'Protocole / ports', 'Décision', 'Justification', 'Demandeur', 'Protection'],
        (principale?.flows ?? []).map((flow) => [
          flow.from,
          flow.to,
          texte(flow.service),
          texte(flow.protocol),
          FLOW_ACTIONS.find((action) => action.value === flow.action)?.label ?? '',
          texte(flow.purpose),
          texte(flow.owner),
          texte(flow.encryption),
        ]),
      )}
      ${
        flux && flux.bloquants > 0
          ? `<p class="note">${flux.bloquants} flux présentent un point bloquant (extrémité inexistante,
             chemin non filtré ou exposition sans protection déclarée).</p>`
          : ''
      }
    </section>
  `

  const constats = `
    <section class="feuille">
      <h2>Réserves et points d’attention</h2>
      <h3>Complétude du dossier — note ${qualite.score}/100 (${qualite.niveau})</h3>
      <div class="grille">
        ${qualite.completude
          .map((ligne) => {
            const part = ligne.total === 0 ? 0 : Math.round((ligne.renseignes / ligne.total) * 100)
            return `<div>${echapper(ligne.libelle)} — ${ligne.renseignes}/${ligne.total} (${part} %)
              <div class="barre"><i style="width:${part}%"></i></div></div>`
          })
          .join('')}
      </div>

      <h3>Constats de documentation</h3>
      ${
        qualite.constats.length === 0
          ? '<p class="vide">Aucun constat.</p>'
          : qualite.constats
              .map(
                (constat) => `
                  <div class="constat">
                    <span class="pastille" style="background:${COULEURS_GRAVITE[constat.gravite]}"></span>
                    <div>
                      <b>${echapper(constat.titre)}${constat.page ? ` — ${echapper(constat.page)}` : ''}</b>
                      <span>${echapper(constat.detail)} <i>${echapper(constat.action)}</i></span>
                    </div>
                  </div>`,
              )
              .join('')
      }

      <h3>Haute disponibilité — robustesse ${ha?.score ?? 0}/100 (${ha?.level ?? '—'})</h3>
      ${
        !ha || ha.findings.length === 0
          ? '<p class="vide">Aucun constat.</p>'
          : ha.findings
              .slice(0, 20)
              .map(
                (constat) => `
                  <div class="constat">
                    <span class="pastille" style="background:${COULEURS_GRAVITE[constat.severity]}"></span>
                    <div><b>${echapper(constat.title)}</b><span>${echapper(constat.detail)}</span></div>
                  </div>`,
              )
              .join('')
      }
      <p class="pied">L’analyse raisonne sur la topologie dessinée : elle ne connaît ni les chemins
      physiques des fibres, ni les configurations des équipements.</p>
    </section>
  `

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${echapper(titre)} — dossier technique</title>
<style>${STYLE}</style>
</head>
<body>
${garde}
${feuillesSchemas}
${equipements}
${liaisons}
${adressage}
${baies}
${matrice}
${constats}
</body>
</html>`
}
