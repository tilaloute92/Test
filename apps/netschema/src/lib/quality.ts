/**
 * Contrôle qualité du dossier.
 *
 * Un schéma juste mais incomplet coûte cher au premier incident : la baie n'est pas
 * renseignée, le responsable est parti, la garantie a expiré l'an dernier, le VLAN 40 n'est
 * documenté nulle part. Ces manques ne se voient pas en regardant le dessin — ils se
 * comptent.
 *
 * Ce module passe le document entier (toutes les pages) au crible de règles de
 * documentation et d'exploitation, et rend des constats actionnables plutôt qu'une note.
 * La note n'est là que pour suivre le progrès d'une revue à l'autre.
 */

import { deviceMeta, LINKS, rankOf } from './catalog'
import { auditDiagram } from './ha'
import { controlerMatrice } from './flows'
import { checkOsi, parseSubnet, usedVlans } from './osi'
import { heightOf, isRackable } from './racks'
import type { Diagram, NetNode } from '../types'

export type GraviteQualite = 'critique' | 'majeur' | 'mineur' | 'info'

export type CategorieQualite =
  | 'Document'
  | 'Schéma'
  | 'Adressage'
  | 'Inventaire'
  | 'Exploitation'
  | 'Sécurité'

export interface ConstatQualite {
  id: string
  categorie: CategorieQualite
  gravite: GraviteQualite
  titre: string
  detail: string
  /** Ce qu'il y a à faire, formulé à l'impératif. */
  action: string
  /** Équipements concernés, pour aller les corriger. */
  cibles: string[]
  /** Page concernée, quand le constat ne porte pas sur le document entier. */
  page?: string
}

export interface Completude {
  libelle: string
  renseignes: number
  total: number
}

export interface RapportQualite {
  constats: ConstatQualite[]
  /** Note 0–100 : 100 = rien à signaler. */
  score: number
  niveau: 'Exploitable' | 'À compléter' | 'Insuffisant'
  compte: Record<GraviteQualite, number>
  completude: Completude[]
}

/**
 * Pondération des constats. Un point de défaillance unique pèse davantage qu'un débit non
 * renseigné, sans que quelques oublis mineurs suffisent à déclasser un dossier par ailleurs
 * tenu : la note doit rester un indicateur de progrès, pas un couperet.
 */
const POIDS: Record<GraviteQualite, number> = { critique: 10, majeur: 4, mineur: 1.5, info: 0 }
const ORDRE: Record<GraviteQualite, number> = { critique: 0, majeur: 1, mineur: 2, info: 3 }

const rempli = (valeur?: string) => (valeur ?? '').trim() !== ''

/** Équipements dont on attend une fiche d'inventaire complète (les objets physiques). */
function inventoriables(diagram: Diagram): NetNode[] {
  return diagram.nodes.filter((node) => {
    const meta = deviceMeta(node.kind)
    return meta.rank > 0 && meta.rank < 8 && isRackable(node)
  })
}

/** Jours restants avant une date, négatif si elle est passée. */
function joursAvant(date: string, aujourdhui: Date): number | null {
  const valeur = Date.parse(date)
  if (Number.isNaN(valeur)) return null
  return Math.round((valeur - aujourdhui.getTime()) / 86400000)
}

/**
 * Analyse une page et accumule ses constats. Le document entier est passé page par page :
 * un manque sur la troisième page compte autant que sur la première.
 */
function analyserPage(
  page: Diagram,
  index: number,
  total: number,
  constats: ConstatQualite[],
  aujourdhui: Date,
) {
  const nom = page.pageName ?? `Page ${index + 1}`
  const suffixe = total > 1 ? nom : undefined
  const cle = (base: string) => (total > 1 ? `${base}:${index}` : base)
  if (page.nodes.length === 0) return

  // ── Schéma ────────────────────────────────────────────────────────────────
  const sansZone = page.nodes.filter((node) => !rempli(node.zone) && rankOf(node.kind, node.rank) < 8)
  if (sansZone.length > 0) {
    constats.push({
      id: cle('zone'),
      categorie: 'Schéma',
      gravite: sansZone.length > page.nodes.length / 2 ? 'majeur' : 'mineur',
      titre: `${sansZone.length} équipement(s) sans zone`,
      detail:
        'La zone (DMZ, LAN siège, production…) est ce qui permet de raisonner sur le cloisonnement et de rédiger la matrice de flux.',
      action: 'Renseignez la zone de ces équipements dans l’inspecteur ou par sélection multiple.',
      cibles: sansZone.map((node) => node.id),
      page: suffixe,
    })
  }

  const isoles = page.nodes.filter(
    (node) => !page.links.some((link) => link.from === node.id || link.to === node.id),
  )
  if (isoles.length > 0) {
    constats.push({
      id: cle('isoles'),
      categorie: 'Schéma',
      gravite: 'majeur',
      titre: `${isoles.length} équipement(s) sans aucune liaison`,
      detail:
        'Un équipement posé sans câble n’est documenté qu’à moitié : on ne sait ni d’où il vient, ni ce qu’il dessert.',
      action: 'Reliez-les, ou retirez-les du schéma s’ils n’y ont plus leur place.',
      cibles: isoles.map((node) => node.id),
      page: suffixe,
    })
  }

  const doublons = new Map<string, string[]>()
  for (const node of page.nodes) {
    const nomNormalise = node.name.trim().toLowerCase()
    if (!nomNormalise) continue
    const liste = doublons.get(nomNormalise)
    if (liste) liste.push(node.id)
    else doublons.set(nomNormalise, [node.id])
  }
  const homonymes = [...doublons.values()].filter((ids) => ids.length > 1)
  if (homonymes.length > 0) {
    constats.push({
      id: cle('homonymes'),
      categorie: 'Schéma',
      gravite: 'majeur',
      titre: `${homonymes.length} nom(s) d’équipement en double`,
      detail:
        'Deux équipements homonymes rendent toute consigne d’exploitation ambiguë — « redémarre SW-ACC » ne désigne rien.',
      action: 'Renommez-les selon votre convention (site, rôle, numéro).',
      cibles: homonymes.flat(),
      page: suffixe,
    })
  }

  const infra = page.links.filter(
    (link) => !LINKS[link.kind]?.service && link.kind !== 'wireless',
  )
  const sansPort = infra.filter((link) => !rempli(link.portA) && !rempli(link.portB))
  if (infra.length > 0 && sansPort.length > infra.length / 2) {
    constats.push({
      id: cle('ports'),
      categorie: 'Schéma',
      gravite: 'mineur',
      titre: `${sansPort.length} liaison(s) sans interface documentée`,
      detail:
        'Sans le nom des ports aux deux bouts, le schéma ne sert pas au dépannage : il faut retourner en baie pour savoir quel câble tirer.',
      action: 'Renseignez les interfaces (Gi1/0/1, xe-0/0/3…) dans l’onglet L2/L3 de l’inspecteur.',
      cibles: [],
      page: suffixe,
    })
  }

  const sansDebit = infra.filter((link) => !rempli(link.speed))
  if (sansDebit.length > 0) {
    constats.push({
      id: cle('debit'),
      categorie: 'Schéma',
      gravite: 'mineur',
      titre: `${sansDebit.length} liaison(s) sans débit annoncé`,
      detail: 'Le débit est ce qui permet de repérer le maillon lent d’un chemin.',
      action: 'Renseignez le débit des liaisons d’infrastructure (1 Gb/s, 10 Gb/s…).',
      cibles: [],
      page: suffixe,
    })
  }

  // ── Adressage ─────────────────────────────────────────────────────────────
  const declares = new Set((page.vlans ?? []).map((vlan) => vlan.id))
  const utilises = usedVlans(page)
  const orphelins = [...utilises.keys()].filter((id) => !declares.has(id))
  if (orphelins.length > 0) {
    constats.push({
      id: cle('vlan-orphelins'),
      categorie: 'Adressage',
      gravite: 'majeur',
      titre: `${orphelins.length} VLAN utilisés mais absents du plan d’adressage`,
      detail: `VLAN ${orphelins.slice(0, 8).join(', ')}${orphelins.length > 8 ? '…' : ''} cités sur le schéma sans nom, sous-réseau ni passerelle.`,
      action: 'Onglet L2/L3 → « Déduire du schéma », puis complétez sous-réseau et passerelle.',
      cibles: orphelins.flatMap((id) => utilises.get(id)?.nodes ?? []),
      page: suffixe,
    })
  }

  const sansSousReseau = (page.vlans ?? []).filter((vlan) => !rempli(vlan.subnet))
  if (sansSousReseau.length > 0) {
    constats.push({
      id: cle('vlan-subnet'),
      categorie: 'Adressage',
      gravite: 'mineur',
      titre: `${sansSousReseau.length} VLAN sans sous-réseau`,
      detail: 'Un VLAN sans plan d’adressage ne permet ni de router, ni de filtrer, ni de dépanner.',
      action: 'Complétez le sous-réseau (CIDR) et la passerelle de ces VLAN.',
      cibles: [],
      page: suffixe,
    })
  }

  // Adresses IP en double : la panne la plus pénible à diagnostiquer sur le terrain.
  const parIp = new Map<string, string[]>()
  for (const node of page.nodes) {
    const ip = node.ip?.trim()
    if (!ip) continue
    const liste = parIp.get(ip)
    if (liste) liste.push(node.id)
    else parIp.set(ip, [node.id])
  }
  const ipDoublees = [...parIp.entries()].filter(([, ids]) => ids.length > 1)
  if (ipDoublees.length > 0) {
    constats.push({
      id: cle('ip-doublees'),
      categorie: 'Adressage',
      gravite: 'critique',
      titre: `${ipDoublees.length} adresse(s) IP attribuée(s) deux fois`,
      detail: `${ipDoublees.map(([ip]) => ip).slice(0, 5).join(', ')} : conflit d’adresse, ou documentation fausse.`,
      action: 'Corrigez l’adressage : une adresse, un équipement.',
      cibles: ipDoublees.flatMap(([, ids]) => ids),
      page: suffixe,
    })
  }

  // Sous-réseaux qui se recouvrent : deux VLAN qui se marchent dessus.
  const reseaux = (page.vlans ?? [])
    .map((vlan) => ({ vlan, parse: vlan.subnet ? parseSubnet(vlan.subnet) : null }))
    .filter((item): item is { vlan: (typeof item)['vlan']; parse: NonNullable<(typeof item)['parse']> } => !!item.parse)
  const recouvrements: string[] = []
  for (let a = 0; a < reseaux.length; a += 1) {
    for (let b = a + 1; b < reseaux.length; b += 1) {
      const petit = reseaux[a].parse.bits >= reseaux[b].parse.bits ? reseaux[a] : reseaux[b]
      const grand = petit === reseaux[a] ? reseaux[b] : reseaux[a]
      const masque = grand.parse.bits === 0 ? 0 : (0xffffffff << (32 - grand.parse.bits)) >>> 0
      if (((petit.parse.network & masque) >>> 0) === grand.parse.network) {
        recouvrements.push(`VLAN ${reseaux[a].vlan.id} et ${reseaux[b].vlan.id}`)
      }
    }
  }
  if (recouvrements.length > 0) {
    constats.push({
      id: cle('subnet-overlap'),
      categorie: 'Adressage',
      gravite: 'majeur',
      titre: `${recouvrements.length} recouvrement(s) de sous-réseaux`,
      detail: `${recouvrements.slice(0, 4).join(' · ')} partagent des adresses : le routage devient ambigu.`,
      action: 'Redécoupez le plan d’adressage pour que chaque VLAN ait sa plage.',
      cibles: [],
      page: suffixe,
    })
  }

  // ── Inventaire ────────────────────────────────────────────────────────────
  const parc = inventoriables(page)
  if (parc.length > 0) {
    const sansModele = parc.filter((node) => !rempli(node.model) && !rempli(node.vendor))
    if (sansModele.length > 0) {
      constats.push({
        id: cle('materiel'),
        categorie: 'Inventaire',
        gravite: 'mineur',
        titre: `${sansModele.length} équipement(s) sans constructeur ni modèle`,
        detail:
          'Sans le matériel, on ne sait ni commander une pièce, ni estimer la consommation, ni ouvrir un dossier de support.',
        action: 'Renseignez le modèle : la base matériels remplit le reste en un clic.',
        cibles: sansModele.map((node) => node.id),
        page: suffixe,
      })
    }

    const sansSerie = parc.filter((node) => !rempli(node.serial))
    if (sansSerie.length > parc.length / 2) {
      constats.push({
        id: cle('serie'),
        categorie: 'Inventaire',
        gravite: 'mineur',
        titre: `${sansSerie.length} équipement(s) sans numéro de série`,
        detail: 'Le numéro de série est ce que demande le support constructeur avant toute chose.',
        action: 'Complétez l’inventaire, au besoin par import CSV.',
        cibles: sansSerie.map((node) => node.id),
        page: suffixe,
      })
    }

    const sansResponsable = parc.filter((node) => !rempli(node.owner))
    if (sansResponsable.length > parc.length / 2) {
      constats.push({
        id: cle('responsable'),
        categorie: 'Exploitation',
        gravite: 'mineur',
        titre: `${sansResponsable.length} équipement(s) sans responsable`,
        detail: 'En astreinte, la première question est « qui appelle-t-on ? ».',
        action: 'Renseignez le service ou la personne responsable.',
        cibles: sansResponsable.map((node) => node.id),
        page: suffixe,
      })
    }

    const expirees = parc.filter((node) => {
      const jours = node.warrantyEnd ? joursAvant(node.warrantyEnd, aujourdhui) : null
      return jours !== null && jours < 0
    })
    if (expirees.length > 0) {
      constats.push({
        id: cle('garantie-expiree'),
        categorie: 'Exploitation',
        gravite: 'majeur',
        titre: `${expirees.length} équipement(s) hors garantie`,
        detail:
          'Un matériel hors contrat allonge le délai de remise en service : pas de pièce, pas d’échange standard.',
        action: 'Renouvelez le support ou planifiez le remplacement.',
        cibles: expirees.map((node) => node.id),
        page: suffixe,
      })
    }

    const bientot = parc.filter((node) => {
      const jours = node.warrantyEnd ? joursAvant(node.warrantyEnd, aujourdhui) : null
      return jours !== null && jours >= 0 && jours <= 120
    })
    if (bientot.length > 0) {
      constats.push({
        id: cle('garantie-proche'),
        categorie: 'Exploitation',
        gravite: 'mineur',
        titre: `${bientot.length} garantie(s) expirent dans moins de 4 mois`,
        detail: 'Le délai d’achat public ou de renouvellement de contrat dépasse souvent ce délai.',
        action: 'Lancez le renouvellement maintenant.',
        cibles: bientot.map((node) => node.id),
        page: suffixe,
      })
    }

    const retiresCables = page.nodes.filter(
      (node) =>
        (node.status === 'retire' || node.status === 'stock') &&
        page.links.some((link) => link.from === node.id || link.to === node.id),
    )
    if (retiresCables.length > 0) {
      constats.push({
        id: cle('statut'),
        categorie: 'Inventaire',
        gravite: 'majeur',
        titre: `${retiresCables.length} équipement(s) en stock ou retirés mais encore câblés`,
        detail: 'Le schéma et l’inventaire se contredisent : l’un des deux est faux.',
        action: 'Corrigez le statut, ou retirez les liaisons devenues obsolètes.',
        cibles: retiresCables.map((node) => node.id),
        page: suffixe,
      })
    }

    // ── Implantation ────────────────────────────────────────────────────────
    if ((page.racks ?? []).length > 0) {
      const horsBaie = parc.filter((node) => !rempli(node.rack))
      if (horsBaie.length > 0) {
        constats.push({
          id: cle('baie'),
          categorie: 'Exploitation',
          gravite: 'mineur',
          titre: `${horsBaie.length} équipement(s) non implantés en baie`,
          detail:
            'Des baies sont décrites, mais ces équipements n’y sont pas placés : l’implantation reste incomplète.',
          action: 'Module Baies : glissez-les à leur emplacement réel.',
          cibles: horsBaie.map((node) => node.id),
          page: suffixe,
        })
      }
      for (const rack of page.racks ?? []) {
        const occupants = page.nodes.filter((node) => node.rack === rack.id)
        const occupation = occupants.reduce((total, node) => total + heightOf(node), 0)
        if (occupation > rack.units) {
          constats.push({
            id: cle(`baie-pleine:${rack.id}`),
            categorie: 'Exploitation',
            gravite: 'majeur',
            titre: `Baie « ${rack.name} » en surcapacité`,
            detail: `${occupation} U attribués pour ${rack.units} U disponibles.`,
            action: 'Répartissez les équipements ou déclarez la hauteur réelle de la baie.',
            cibles: occupants.map((node) => node.id),
            page: suffixe,
          })
        }
      }
    }
  }

  // ── Sécurité et exploitation ──────────────────────────────────────────────
  if (!page.links.some((link) => link.kind === 'oob')) {
    constats.push({
      id: cle('oob'),
      categorie: 'Sécurité',
      gravite: 'mineur',
      titre: 'Aucune administration hors bande documentée',
      detail:
        'Quand le réseau tombe, l’accès aux équipements passe par un chemin qui ne dépend pas de lui. Il doit figurer au dossier.',
      action: 'Documentez le chemin d’administration (liaison « hors bande ») ou justifiez son absence.',
      cibles: [],
      page: suffixe,
    })
  }

  const sauvegarde = page.nodes.some((node) => ['backup', 'tape-backup'].includes(node.kind))
  const donnees = page.nodes.some((node) =>
    ['storage', 'nvme-storage', 'managed-db', 'hci', 'hypervisor'].includes(node.kind),
  )
  if (donnees && !sauvegarde) {
    constats.push({
      id: cle('sauvegarde'),
      categorie: 'Sécurité',
      gravite: 'majeur',
      titre: 'Des données, aucune sauvegarde au schéma',
      detail:
        'Stockage ou virtualisation présents sans équipement de sauvegarde : soit elle existe et n’est pas documentée, soit elle manque.',
      action: 'Ajoutez la chaîne de sauvegarde (serveur, dépôt, bande) et ses liaisons.',
      cibles: [],
      page: suffixe,
    })
  }
}

/**
 * Contrôle du document complet.
 *
 * `pages` porte toutes les pages du classeur ; `page` est celle qui est ouverte, seule
 * concernée par les analyses de topologie déjà calculées ailleurs (HA, flux).
 */
export function controlerDossier(pages: Diagram[], titre: string): RapportQualite {
  const constats: ConstatQualite[] = []
  const aujourdhui = new Date()
  const principale = pages[0] ?? { title: titre, nodes: [], links: [] }

  // ── Document ──────────────────────────────────────────────────────────────
  const bloc = principale.titleBlock
  const manquants = [
    !rempli(bloc?.author) ? 'auteur' : null,
    !rempli(bloc?.version) ? 'indice de révision' : null,
    !rempli(bloc?.date) ? 'date' : null,
    !rempli(bloc?.confidentiality) ? 'mention de diffusion' : null,
  ].filter(Boolean) as string[]
  if (manquants.length > 0) {
    constats.push({
      id: 'cartouche',
      categorie: 'Document',
      gravite: manquants.length >= 3 ? 'majeur' : 'mineur',
      titre: `Cartouche incomplet : ${manquants.join(', ')}`,
      detail:
        'Un schéma qui circule sans auteur, sans indice ni mention de diffusion ne peut être ni daté, ni comparé, ni transmis en confiance.',
      action: 'Inspecteur → Document : complétez le cartouche et affichez-le sur le plan.',
      cibles: [],
    })
  }

  if (/^(nouveau )?sch[ée]ma( r[ée]seau)?$/i.test(titre.trim())) {
    constats.push({
      id: 'titre',
      categorie: 'Document',
      gravite: 'mineur',
      titre: 'Le document porte encore son titre par défaut',
      detail: 'Un dossier se retrouve par son titre : « Architecture réseau » ne distingue rien.',
      action: 'Donnez-lui un titre qui nomme le site, le périmètre et l’année.',
      cibles: [],
    })
  }

  for (const [index, page] of pages.entries()) {
    analyserPage(page, index, pages.length, constats, aujourdhui)
  }

  // ── Analyses déjà outillées, reprises ici ────────────────────────────────
  const ha = auditDiagram(principale)
  const spofCritiques = ha.findings.filter((constat) => constat.severity === 'critique')
  for (const constat of spofCritiques.slice(0, 6)) {
    constats.push({
      id: `ha:${constat.id}`,
      categorie: 'Sécurité',
      gravite: 'critique',
      titre: constat.title,
      detail: constat.detail,
      action: 'Panneau Haute dispo : traitez ce point de défaillance unique.',
      cibles: constat.nodeIds,
    })
  }

  for (const constat of checkOsi(principale).filter((item) => item.severity === 'critique').slice(0, 6)) {
    constats.push({
      id: `osi:${constat.id}`,
      categorie: 'Adressage',
      gravite: 'majeur',
      titre: constat.title,
      detail: constat.detail,
      action: 'Onglet L2/L3 : corrigez la configuration documentée.',
      cibles: constat.nodeIds,
    })
  }

  const flux = controlerMatrice(principale)
  if ((principale.flows ?? []).length === 0 && principale.nodes.length > 4) {
    constats.push({
      id: 'flux-absents',
      categorie: 'Sécurité',
      gravite: 'majeur',
      titre: 'Aucune matrice de flux',
      detail:
        'Le schéma montre ce qui est relié, pas ce qui a le droit de communiquer. La matrice est la pièce que réclame toute revue de sécurité.',
      action: 'Module Flux → « Proposer d’après le schéma », puis qualifiez chaque ligne.',
      cibles: [],
    })
  } else if (flux.bloquants > 0) {
    constats.push({
      id: 'flux-bloquants',
      categorie: 'Sécurité',
      gravite: 'majeur',
      titre: `${flux.bloquants} flux à corriger dans la matrice`,
      detail: 'Extrémité inexistante, chemin non filtré ou exposition sans protection déclarée.',
      action: 'Module Flux : traitez les lignes marquées en rouge.',
      cibles: [],
    })
  }

  // ── Complétude, pour suivre le remplissage sans lire tous les constats ────
  const parc = pages.flatMap((page) => inventoriables(page))
  const liaisons = pages.flatMap((page) => page.links)
  const tousNoeuds = pages.flatMap((page) => page.nodes)
  const completude: Completude[] = [
    {
      libelle: 'Zone renseignée',
      renseignes: tousNoeuds.filter((node) => rempli(node.zone)).length,
      total: tousNoeuds.length,
    },
    {
      libelle: 'Matériel identifié',
      renseignes: parc.filter((node) => rempli(node.model) || rempli(node.vendor)).length,
      total: parc.length,
    },
    {
      libelle: 'Numéro de série',
      renseignes: parc.filter((node) => rempli(node.serial)).length,
      total: parc.length,
    },
    {
      libelle: 'Responsable',
      renseignes: parc.filter((node) => rempli(node.owner)).length,
      total: parc.length,
    },
    {
      libelle: 'Implantation en baie',
      renseignes: parc.filter((node) => rempli(node.rack)).length,
      total: parc.length,
    },
    {
      libelle: 'Débit des liaisons',
      renseignes: liaisons.filter((link) => rempli(link.speed)).length,
      total: liaisons.length,
    },
    {
      libelle: 'Interfaces documentées',
      renseignes: liaisons.filter((link) => rempli(link.portA) || rempli(link.portB)).length,
      total: liaisons.length,
    },
  ].filter((ligne) => ligne.total > 0)

  const compte: Record<GraviteQualite, number> = { critique: 0, majeur: 0, mineur: 0, info: 0 }
  for (const constat of constats) compte[constat.gravite] += 1
  const penalite = constats.reduce((total, constat) => total + POIDS[constat.gravite], 0)
  const score = Math.round(Math.max(0, Math.min(100, 100 - penalite)))

  return {
    constats: constats.sort(
      (a, b) => ORDRE[a.gravite] - ORDRE[b.gravite] || a.categorie.localeCompare(b.categorie),
    ),
    score,
    niveau: score >= 80 ? 'Exploitable' : score >= 50 ? 'À compléter' : 'Insuffisant',
    compte,
    completude,
  }
}
