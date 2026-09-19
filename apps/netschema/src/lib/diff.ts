/**
 * Comparaison de deux versions d'un document.
 *
 * « Qu'est-ce qui a changé depuis la version de mars ? » est la question de toute revue de
 * changement, et celle à laquelle deux schémas côte à côte répondent très mal : l'œil voit
 * les boîtes déplacées, pas le VLAN passé de 20 à 30 sur un trunk.
 *
 * La comparaison se fait sur les données, pas sur le dessin : un équipement déplacé n'est
 * pas une modification, un port renommé en est une. Les équipements sont appariés par
 * identifiant, puis par nom — un équipement recréé à l'identique garde son sens même s'il a
 * changé d'identifiant.
 */

import { deviceMeta, LINKS, ROLES } from './catalog'
import { STATUS_LABELS } from './inventory'
import type { Diagram, NetLink, NetNode } from '../types'

export type SensDifference = 'ajoute' | 'supprime' | 'modifie' | 'deplace'

export type CibleDifference = 'Équipement' | 'Liaison' | 'VLAN' | 'Baie' | 'Flux' | 'Document'

export interface ChampModifie {
  champ: string
  avant: string
  apres: string
}

export interface Difference {
  sens: SensDifference
  cible: CibleDifference
  /** Libellé lisible de l'élément (nom d'équipement, « A → B » pour une liaison). */
  nom: string
  /** Identifiants dans la version actuelle, pour aller les montrer sur le schéma. */
  nodeIds: string[]
  champs: ChampModifie[]
  page?: string
}

export interface RapportDiff {
  differences: Difference[]
  compte: Record<SensDifference, number>
  /** Vrai si les deux documents sont identiques hors positions. */
  identiques: boolean
}

const vide = (valeur: unknown) => (valeur === undefined || valeur === null ? '' : String(valeur).trim())

/** Champs d'un équipement qui comptent pour une revue de changement. */
function champsNoeud(node: NetNode): Record<string, string> {
  return {
    Nom: node.name,
    Type: deviceMeta(node.kind).label,
    'Adresse IP': vide(node.ip),
    VLAN: vide(node.vlan),
    Zone: vide(node.zone),
    Site: vide(node.site),
    Grappe: vide(node.cluster),
    Rôle: node.role ? ROLES[node.role].label : '',
    'Adresse virtuelle': vide(node.vip),
    Constructeur: vide(node.vendor),
    Modèle: vide(node.model),
    'N° de série': vide(node.serial),
    Statut: node.status ? STATUS_LABELS[node.status] : '',
    Responsable: vide(node.owner),
    Baie: vide(node.rack),
    'Position (U)': vide(node.rackUnit),
    'Fin de garantie': vide(node.warrantyEnd),
    'Puissance (W)': vide(node.powerW),
    'Double alimentation': node.dualPower ? 'oui' : '',
  }
}

function champsLien(link: NetLink): Record<string, string> {
  return {
    Type: LINKS[link.kind]?.label ?? link.kind,
    Débit: vide(link.speed),
    Libellé: vide(link.label),
    'Port A': vide(link.portA),
    'Port B': vide(link.portB),
    VLAN: vide(link.vlans),
    'VLAN côté A': vide(link.vlansA),
    'VLAN côté B': vide(link.vlansB),
    Mode: vide(link.mode),
    'VLAN natif': vide(link.nativeVlan),
    Agrégat: vide(link.lag),
    'Spanning-tree': vide(link.stp),
    MTU: vide(link.mtu),
    'Sous-réseau': vide(link.subnet),
    VRF: vide(link.vrf),
    Routage: vide(link.routing),
    Secours: link.redundant ? 'oui' : '',
  }
}

function comparerChamps(
  avant: Record<string, string>,
  apres: Record<string, string>,
): ChampModifie[] {
  const modifies: ChampModifie[] = []
  for (const champ of Object.keys(apres)) {
    if (avant[champ] !== apres[champ]) {
      modifies.push({ champ, avant: avant[champ] ?? '', apres: apres[champ] ?? '' })
    }
  }
  return modifies
}

/** Apparie les équipements des deux versions : d'abord par identifiant, puis par nom. */
function apparier(avant: NetNode[], apres: NetNode[]): {
  couples: [NetNode, NetNode][]
  disparus: NetNode[]
  nouveaux: NetNode[]
} {
  const restantsAvant = new Map(avant.map((node) => [node.id, node]))
  const couples: [NetNode, NetNode][] = []
  const nouveaux: NetNode[] = []

  for (const node of apres) {
    const parId = restantsAvant.get(node.id)
    if (parId) {
      couples.push([parId, node])
      restantsAvant.delete(node.id)
    } else nouveaux.push(node)
  }

  // Seconde passe par nom : un équipement supprimé puis recréé reste le même aux yeux
  // d'une revue de changement.
  const parNom = new Map<string, NetNode>()
  for (const node of restantsAvant.values()) parNom.set(node.name.trim().toLowerCase(), node)
  const vraimentNouveaux: NetNode[] = []
  for (const node of nouveaux) {
    const correspondant = parNom.get(node.name.trim().toLowerCase())
    if (correspondant) {
      couples.push([correspondant, node])
      parNom.delete(node.name.trim().toLowerCase())
      restantsAvant.delete(correspondant.id)
    } else vraimentNouveaux.push(node)
  }

  return { couples, disparus: [...restantsAvant.values()], nouveaux: vraimentNouveaux }
}

/** Clé d'une liaison indépendante des identifiants : les deux noms d'équipements, triés. */
function cleLien(link: NetLink, noms: Map<string, string>): string {
  const a = noms.get(link.from) ?? link.from
  const b = noms.get(link.to) ?? link.to
  return [a, b].sort().join(' ↔ ')
}

/** Compare deux pages et accumule les différences. */
function comparerPage(avant: Diagram, apres: Diagram, page: string | undefined, out: Difference[]) {
  const { couples, disparus, nouveaux } = apparier(avant.nodes, apres.nodes)

  for (const node of nouveaux) {
    out.push({
      sens: 'ajoute',
      cible: 'Équipement',
      nom: node.name,
      nodeIds: [node.id],
      champs: [],
      page,
    })
  }
  for (const node of disparus) {
    out.push({
      sens: 'supprime',
      cible: 'Équipement',
      nom: node.name,
      nodeIds: [],
      champs: [],
      page,
    })
  }
  for (const [ancien, nouveau] of couples) {
    const champs = comparerChamps(champsNoeud(ancien), champsNoeud(nouveau))
    if (champs.length > 0) {
      out.push({
        sens: 'modifie',
        cible: 'Équipement',
        nom: nouveau.name,
        nodeIds: [nouveau.id],
        champs,
        page,
      })
    } else if (Math.abs(ancien.x - nouveau.x) > 1 || Math.abs(ancien.y - nouveau.y) > 1) {
      out.push({ sens: 'deplace', cible: 'Équipement', nom: nouveau.name, nodeIds: [nouveau.id], champs: [], page })
    }
  }

  const nomsAvant = new Map(avant.nodes.map((node) => [node.id, node.name]))
  const nomsApres = new Map(apres.nodes.map((node) => [node.id, node.name]))
  const liensAvant = new Map(avant.links.map((link) => [cleLien(link, nomsAvant), link]))
  const liensApres = new Map(apres.links.map((link) => [cleLien(link, nomsApres), link]))

  for (const [cle, link] of liensApres) {
    const ancien = liensAvant.get(cle)
    if (!ancien) {
      out.push({ sens: 'ajoute', cible: 'Liaison', nom: cle, nodeIds: [link.from, link.to], champs: [], page })
      continue
    }
    const champs = comparerChamps(champsLien(ancien), champsLien(link))
    if (champs.length > 0) {
      out.push({ sens: 'modifie', cible: 'Liaison', nom: cle, nodeIds: [link.from, link.to], champs, page })
    }
  }
  for (const [cle] of liensAvant) {
    if (!liensApres.has(cle)) {
      out.push({ sens: 'supprime', cible: 'Liaison', nom: cle, nodeIds: [], champs: [], page })
    }
  }

  // VLAN, baies et flux : des tables, comparées par identifiant.
  const comparerTable = <T extends { id: string }>(
    cible: CibleDifference,
    listeAvant: T[],
    listeApres: T[],
    libelle: (item: T) => string,
    champs: (item: T) => Record<string, string>,
  ) => {
    const parIdAvant = new Map(listeAvant.map((item) => [item.id, item]))
    for (const item of listeApres) {
      const ancien = parIdAvant.get(item.id)
      if (!ancien) {
        out.push({ sens: 'ajoute', cible, nom: libelle(item), nodeIds: [], champs: [], page })
        continue
      }
      parIdAvant.delete(item.id)
      const modifies = comparerChamps(champs(ancien), champs(item))
      if (modifies.length > 0) {
        out.push({ sens: 'modifie', cible, nom: libelle(item), nodeIds: [], champs: modifies, page })
      }
    }
    for (const item of parIdAvant.values()) {
      out.push({ sens: 'supprime', cible, nom: libelle(item), nodeIds: [], champs: [], page })
    }
  }

  comparerTable(
    'VLAN',
    avant.vlans ?? [],
    apres.vlans ?? [],
    (vlan) => `VLAN ${vlan.id}${vlan.name ? ` — ${vlan.name}` : ''}`,
    (vlan) => ({
      Nom: vide(vlan.name),
      'Sous-réseau': vide(vlan.subnet),
      Passerelle: vide(vlan.gateway),
      Commentaire: vide(vlan.notes),
    }),
  )
  comparerTable(
    'Baie',
    avant.racks ?? [],
    apres.racks ?? [],
    (rack) => rack.name,
    (rack) => ({
      Nom: rack.name,
      Site: vide(rack.site),
      Local: vide(rack.room),
      Hauteur: vide(rack.units),
    }),
  )
  comparerTable(
    'Flux',
    avant.flows ?? [],
    apres.flows ?? [],
    (flow) => `${flow.from} → ${flow.to}`,
    (flow) => ({
      Source: flow.from,
      Destination: flow.to,
      Service: vide(flow.service),
      'Protocole / ports': vide(flow.protocol),
      Décision: vide(flow.action),
      Justification: vide(flow.purpose),
      Protection: vide(flow.encryption),
    }),
  )
}

/**
 * Compare deux documents page à page, dans l'ordre des pages.
 *
 * Les pages sont appariées par nom quand c'est possible : un onglet renommé ne doit pas
 * apparaître comme une page supprimée et une page ajoutée.
 */
export function comparerDocuments(
  avant: { title: string; pages: Diagram[] },
  apres: { title: string; pages: Diagram[] },
): RapportDiff {
  const differences: Difference[] = []

  if (avant.title.trim() !== apres.title.trim()) {
    differences.push({
      sens: 'modifie',
      cible: 'Document',
      nom: 'Titre du document',
      nodeIds: [],
      champs: [{ champ: 'Titre', avant: avant.title, apres: apres.title }],
    })
  }

  const parNom = new Map(avant.pages.map((page, index) => [page.pageName ?? `Page ${index + 1}`, page]))
  for (const [index, page] of apres.pages.entries()) {
    const nom = page.pageName ?? `Page ${index + 1}`
    const ancienne = parNom.get(nom) ?? avant.pages[index]
    if (ancienne) parNom.delete(ancienne.pageName ?? `Page ${index + 1}`)
    if (!ancienne) {
      differences.push({ sens: 'ajoute', cible: 'Document', nom: `Page « ${nom} »`, nodeIds: [], champs: [] })
      continue
    }
    comparerPage(ancienne, page, apres.pages.length > 1 ? nom : undefined, differences)
  }
  for (const page of parNom.values()) {
    differences.push({
      sens: 'supprime',
      cible: 'Document',
      nom: `Page « ${page.pageName ?? 'sans nom'} »`,
      nodeIds: [],
      champs: [],
    })
  }

  const compte: Record<SensDifference, number> = { ajoute: 0, supprime: 0, modifie: 0, deplace: 0 }
  for (const difference of differences) compte[difference.sens] += 1

  const ordre: Record<SensDifference, number> = { supprime: 0, modifie: 1, ajoute: 2, deplace: 3 }
  return {
    differences: differences.sort(
      (a, b) => ordre[a.sens] - ordre[b.sens] || a.cible.localeCompare(b.cible) || a.nom.localeCompare(b.nom),
    ),
    compte,
    identiques: differences.filter((difference) => difference.sens !== 'deplace').length === 0,
  }
}
