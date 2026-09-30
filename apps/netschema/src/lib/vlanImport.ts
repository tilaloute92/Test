import { normalizeHeader, splitCsvLine } from './inventory'
import type { UsageVlan, VlanDef } from '../types'

/**
 * Import du plan d'adressage.
 *
 * Un plan VLAN existe presque toujours avant le schéma : dans un tableur, dans un tableau
 * Confluence, ou simplement dans la sortie d'un `show vlan brief`. Le retaper ligne à ligne
 * est la meilleure façon d'y introduire une faute de frappe qui se retrouvera ensuite dans
 * tout le document.
 *
 * Ce module lit donc ce que les gens ont réellement sous la main, sans leur demander de le
 * reformater : un CSV avec ou sans en-tête, un copier-coller de tableur, ou la sortie
 * brute d'un commutateur.
 */

/** Ce qu'on a su lire, et ce qu'on a laissé de côté. */
export interface ImportVlans {
  vlans: VlanDef[]
  /** Nom de la forme reconnue, pour que l'utilisateur sache ce qui a été compris. */
  format: string
  avertissements: string[]
}

/** Colonnes acceptées, dans toutes les graphies qu'on rencontre en pratique. */
const COLONNES: { champ: keyof VlanDef; entetes: string[] }[] = [
  { champ: 'id', entetes: ['id', 'vlan', 'vlan id', 'vlanid', 'n', 'no', 'num', 'numero', 'numéro', 'tag', '802.1q', 'dot1q'] },
  { champ: 'name', entetes: ['nom', 'name', 'libelle', 'libellé', 'description', 'desc'] },
  { champ: 'subnet', entetes: ['sous-reseau', 'sous reseau', 'sousreseau', 'reseau', 'subnet', 'network', 'cidr', 'plage', 'adressage'] },
  { champ: 'gateway', entetes: ['passerelle', 'gateway', 'gw', 'routeur', 'svi', 'default gateway'] },
  { champ: 'notes', entetes: ['notes', 'note', 'commentaire', 'commentaires', 'remarque', 'remarques', 'usage'] },
  { champ: 'color', entetes: ['couleur', 'color'] },
  { champ: 'usage', entetes: ['usage', 'nature', 'type', 'role', 'rôle', 'fonction', 'categorie', 'catégorie'] },
]

/**
 * Nature d'un VLAN, telle qu'elle s'écrit dans un tableau.
 *
 * Les plans d'adressage qui portent cette colonne la remplissent en toutes lettres et sans
 * vocabulaire commun : « interco », « point à point », « HA », « heartbeat », « prod ». On
 * accepte donc les mots d'usage plutôt que d'imposer trois valeurs.
 */
const USAGES: [RegExp, UsageVlan][] = [
  [/^(synchro|synchronisation|ha|heartbeat|battement|peer.?link|keepalive|pile|stack|grappe|cluster)/i, 'synchro'],
  [/^(transit|interco|interconnexion|point.?a.?point|p2p|liaison|uplink|backbone|core.?link)/i, 'transit'],
  [/^(service|utilisateur|production|prod|metier|métier|donnees|données|acces|accès|serveur|user)/i, 'service'],
]

function lireUsage(valeur: string): UsageVlan | undefined {
  const propre = valeur.trim()
  for (const [motif, usage] of USAGES) if (motif.test(propre)) return usage
  return undefined
}

const PAR_ENTETE = new Map<string, keyof VlanDef>()
for (const colonne of COLONNES) {
  for (const entete of colonne.entetes) PAR_ENTETE.set(normalizeHeader(entete), colonne.champ)
}

/** Ordre des colonnes quand le tableau n'a pas d'en-tête : celui qu'on écrit spontanément. */
const ORDRE_IMPLICITE: (keyof VlanDef)[] = ['id', 'name', 'subnet', 'gateway', 'notes', 'usage']

/** « VLAN 20 », « vlan0020 », « 20 » — on ne garde que le numéro. */
export function numeroVlan(valeur: string): string | null {
  const trouve = valeur.trim().replace(/^vlan\s*/i, '').match(/^0*(\d{1,4})$/)
  if (!trouve) return null
  const numero = Number(trouve[1])
  return numero >= 1 && numero <= 4094 ? String(numero) : null
}

/** Nettoie une cellule : espaces, guillemets, et les tirets qui veulent dire « rien ». */
function cellule(valeur: string | undefined): string {
  const propre = (valeur ?? '').trim().replace(/^"(.*)"$/s, '$1').trim()
  return /^(-+|—|n\/a|na|none|aucun)$/i.test(propre) ? '' : propre
}

/**
 * Sépare une ligne de tableau. On accepte le point-virgule, la tabulation (collage depuis un
 * tableur), la virgule, et la barre verticale — celle des tableaux Markdown, qu'on copie
 * souvent depuis un wiki.
 */
function separateur(ligne: string): string {
  const compte = (caractere: string) => ligne.split(caractere).length - 1
  const candidats: [string, number][] = [
    ['\t', compte('\t')],
    ['|', compte('|')],
    [';', compte(';')],
    [',', compte(',')],
  ]
  const meilleur = candidats.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]
  return meilleur ? meilleur[0] : ';'
}

/** Un tableau Markdown encadre chaque ligne de barres : les cellules vides des bords ne comptent pas. */
function cellules(ligne: string, sep: string): string[] {
  const brut = splitCsvLine(ligne, sep).map(cellule)
  if (sep !== '|') return brut
  while (brut.length > 0 && brut[0] === '') brut.shift()
  while (brut.length > 0 && brut[brut.length - 1] === '') brut.pop()
  return brut
}

/**
 * Sortie d'un commutateur : `show vlan brief` et ses variantes.
 *
 * Le format est en colonnes de largeur fixe, jamais séparées. On reconnaît les lignes qui
 * commencent par un numéro suivi d'un nom, et l'on s'arrête au premier mot d'état — actif,
 * active, suspended : ce qui suit est la liste des ports, qui n'appartient pas au plan
 * d'adressage.
 */
function lireSortieCommutateur(lignes: string[]): VlanDef[] | null {
  const vlans: VlanDef[] = []
  for (const ligne of lignes) {
    /*
      « 10   Serveurs                 active    Gi1/0/1 » chez Cisco,
      « 10      Serveurs      | Port-based No » chez Aruba. Dans les deux cas, un numéro, un
      nom, puis un mot d'état : ce qui suit est la liste des ports, qui n'a rien à faire dans
      un plan d'adressage.
    */
    const trouve = ligne.match(
      /^\s*(\d{1,4})\s{1,}(\S[^|\t]*?)\s*(?:\|\s*)?\s{0,}(active|act\/unsup|suspended|actif|suspendu|enabled|disabled|up|down|port-based|protocol-based|static|dynamic)\b/i,
    )
    if (!trouve) continue
    const id = numeroVlan(trouve[1])
    if (!id) continue
    const nom = trouve[2].trim()
    vlans.push({ id, name: nom && nom.toLowerCase() !== 'default' ? nom : undefined })
  }
  return vlans.length > 0 ? vlans : null
}

/** Une ligne est-elle un en-tête de tableau ? Elle en a l'air si aucune cellule n'est un numéro. */
function estEntete(cellules: string[]): boolean {
  const reconnues = cellules.filter((valeur) => PAR_ENTETE.has(normalizeHeader(valeur))).length
  return reconnues >= 2 || (reconnues >= 1 && !cellules.some((valeur) => numeroVlan(valeur)))
}

/**
 * Lit un plan d'adressage collé tel quel.
 *
 * Les VLAN sans numéro exploitable sont signalés plutôt que devinés : un plan d'adressage
 * faux est pire qu'un plan absent.
 */
export function analyserVlans(texte: string): ImportVlans {
  const avertissements: string[] = []
  const lignes = texte
    .split(/\r?\n/)
    .map((ligne) => ligne.replace(/^﻿/, ''))
    .filter((ligne) => ligne.trim() !== '' && !/^\s*[-+=_]{3,}\s*$/.test(ligne) && !/^\s*#/.test(ligne))
  if (lignes.length === 0) return { vlans: [], format: '—', avertissements: ['Rien à lire.'] }

  /*
    Sortie de commutateur. On ne l'essaie que si rien ne ressemble vraiment à un tableau —
    un point-virgule ou une tabulation ne trompent pas. La barre verticale, elle, ne
    disqualifie rien : les tableaux Aruba l'utilisent autant que les tableaux Markdown, et
    les deux se distinguent par ce qui commence la ligne (un numéro, ou une barre).
  */
  const tabulaire = lignes.some((ligne) => /[;\t]/.test(ligne))
  const sortie = tabulaire ? null : lireSortieCommutateur(lignes)
  if (sortie) {
    return {
      vlans: fusionner(sortie, avertissements),
      format: 'sortie de commutateur (show vlan)',
      avertissements: [
        ...avertissements,
        'Un « show vlan » ne porte ni sous-réseau ni passerelle : complétez-les ensuite, ou réimportez un tableau qui les contient.',
      ],
    }
  }

  // ── Tableau ─────────────────────────────────────────────────────────────────
  const sep = separateur(lignes[0])
  const premiere = cellules(lignes[0], sep)
  const avecEntete = premiere.length > 1 && estEntete(premiere)

  let champs: (keyof VlanDef | null)[]
  if (avecEntete) {
    champs = premiere.map((entete) => PAR_ENTETE.get(normalizeHeader(entete)) ?? null)
    for (const [index, champ] of champs.entries()) {
      if (!champ && premiere[index]) avertissements.push(`Colonne « ${premiere[index]} » ignorée.`)
    }
    if (!champs.includes('id')) {
      return {
        vlans: [],
        format: 'tableau',
        avertissements: [
          'Aucune colonne de numéro de VLAN reconnue. Nommez-la « VLAN », « ID » ou « Numéro », ou retirez la ligne d’en-tête pour un tableau dans l’ordre numéro, nom, sous-réseau, passerelle.',
        ],
      }
    }
  } else {
    champs = ORDRE_IMPLICITE
  }

  const brut: VlanDef[] = []
  for (const ligne of lignes.slice(avecEntete ? 1 : 0)) {
    const valeurs = cellules(ligne, sep)
    if (valeurs.every((valeur) => valeur === '')) continue
    const vlan: VlanDef = { id: '' }
    for (const [index, champ] of champs.entries()) {
      if (!champ) continue
      const valeur = valeurs[index]
      if (!valeur) continue
      if (champ === 'id') {
        const numero = numeroVlan(valeur)
        if (numero) vlan.id = numero
      } else if (champ === 'usage') {
        const usage = lireUsage(valeur)
        if (usage) vlan.usage = usage
        else avertissements.push(`Usage « ${valeur} » non reconnu : le VLAN sera classé d'après le schéma.`)
      } else vlan[champ] = valeur
    }
    if (!vlan.id) {
      const apercu = ligne.trim().slice(0, 60)
      avertissements.push(`Ligne sans numéro de VLAN exploitable, ignorée : « ${apercu} ».`)
      continue
    }
    brut.push(vlan)
  }

  return {
    vlans: fusionner(brut, avertissements),
      format: avecEntete
      ? 'tableau avec en-tête'
      : 'tableau sans en-tête (numéro, nom, sous-réseau, passerelle, commentaire, usage)',
    avertissements,
  }
}

/** Deux lignes pour le même VLAN : la seconde complète la première sans l'écraser. */
function fusionner(vlans: VlanDef[], avertissements: string[]): VlanDef[] {
  const parId = new Map<string, VlanDef>()
  for (const vlan of vlans) {
    const existant = parId.get(vlan.id)
    if (!existant) {
      parId.set(vlan.id, vlan)
      continue
    }
    avertissements.push(`VLAN ${vlan.id} cité plusieurs fois : les informations ont été réunies.`)
    parId.set(vlan.id, {
      ...existant,
      name: existant.name ?? vlan.name,
      subnet: existant.subnet ?? vlan.subnet,
      gateway: existant.gateway ?? vlan.gateway,
      notes: existant.notes ?? vlan.notes,
      color: existant.color ?? vlan.color,
    })
  }
  return [...parId.values()].sort((a, b) => Number(a.id) - Number(b.id))
}

/** Le plan d'adressage en CSV, pour le relire dans un tableur ou le réimporter tel quel. */
export function vlansVersCsv(vlans: VlanDef[]): string {
  const entete = ['VLAN', 'Nom', 'Sous-réseau', 'Passerelle', 'Usage', 'Commentaire']
  const echapper = (valeur: string | undefined) => {
    const texte = valeur ?? ''
    return /[";\r\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte
  }
  const lignes = [...vlans]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((vlan) =>
      [vlan.id, vlan.name, vlan.subnet, vlan.gateway, vlan.usage, vlan.notes].map(echapper).join(';'),
    )
  return `﻿${[entete.join(';'), ...lignes].join('\r\n')}\r\n`
}

/** Exemple affiché dans la zone de collage : il doit marcher tel quel. */
export const EXEMPLE_VLANS = `VLAN;Nom;Sous-réseau;Passerelle;Usage;Commentaire
10;Serveurs;10.10.0.0/24;10.10.0.254;service;
20;Bureautique Bât. A;10.10.20.0/24;10.10.20.254;service;
30;Bureautique Bât. B;10.10.30.0/24;10.10.30.254;service;
40;Wi-Fi;10.10.40.0/24;10.10.40.254;service;SSID interne
100;Transit pare-feu;10.10.100.0/29;10.10.100.1;transit;
999;Synchronisation HA;;;synchro;Non routé`
