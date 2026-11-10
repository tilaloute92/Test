import { normalizeSpeech } from './voiceBase'

/**
 * Architectures de départ.
 *
 * La page blanche est ce qui coûte le plus cher : avant de dessiner *son* réseau, il faut
 * en poser les vingt premières boîtes. Chaque architecture ici est une phrase — celle qu'on
 * taperait dans l'assistant de conception — et rien d'autre : c'est l'assistant qui la
 * construit, la nomme et la raccorde. Pas de schéma figé à maintenir, donc, et ce qu'on
 * obtient se complète ensuite avec les mêmes mots (« ajoute deux switchs d'accès »).
 *
 * Elles servent à trois endroits : sur un plan vide, dans l'assistant, et à la voix
 * (« monte une architecture trois tiers »).
 */
export interface ArchitectureDepart {
  id: string
  titre: string
  /** Une ligne, pour choisir sans avoir à construire. */
  resume: string
  /** Ce que l'assistant de conception reçoit. */
  description: string
  /** Façons de la demander, sans accents ni casse. La plus longue qui correspond gagne. */
  mots: string[]
}

export const ARCHITECTURES: ArchitectureDepart[] = [
  {
    id: 'agence',
    titre: 'Petit site',
    resume: 'Un accès Internet, un pare-feu, un cœur, deux switchs d’accès, le Wi-Fi.',
    description:
      'un lien opérateur, un routeur, un pare-feu, un switch cœur, deux switchs d’accès, deux bornes wifi, une imprimante',
    mots: ['petit site', 'agence', 'site distant', 'succursale', 'pme', 'petite entreprise'],
  },
  {
    id: 'deux-niveaux',
    titre: 'Cœur redondé, deux niveaux',
    resume: 'Pare-feu et cœurs en grappe, accès doublement attaché. Le siège d’une PME.',
    description:
      'un lien opérateur, deux pare-feu en grappe actif/passif, deux switchs cœur en grappe, quatre switchs d’accès',
    mots: ['deux niveaux', 'deux tiers', '2 niveaux', '2 tiers', 'coeur effondre', 'collapsed core'],
  },
  {
    id: 'trois-tiers',
    titre: 'Campus trois niveaux',
    resume: 'Cœur, distribution, accès : le modèle hiérarchique classique, tout redondé.',
    description:
      'deux liens opérateur, deux routeurs de périmètre en grappe, deux pare-feu en grappe actif/passif, deux switchs cœur en grappe, deux switchs de distribution, quatre switchs d’accès',
    mots: ['trois tiers', 'trois niveaux', '3 tiers', '3 niveaux', 'campus', 'hierarchique', 'coeur distribution acces'],
  },
  {
    id: 'datacenter',
    titre: 'Salle serveurs, spine-leaf',
    resume: 'Une fabrique spine-leaf, une grappe d’hyperviseurs avec témoin, le stockage.',
    description:
      'deux spines, quatre leafs, trois hyperviseurs en grappe avec témoin, une baie de stockage, un serveur de sauvegarde',
    mots: ['spine leaf', 'spine-leaf', 'datacenter', 'data center', 'centre de donnees', 'salle serveurs', 'salle serveur', 'fabrique'],
  },
  {
    id: 'virtualisation',
    titre: 'Grappe de virtualisation',
    resume: 'Deux cœurs, trois hyperviseurs, un témoin, le stockage et l’énergie.',
    description:
      'deux switchs cœur en grappe, trois hyperviseurs en grappe avec témoin, une baie de stockage, un serveur de sauvegarde, deux onduleurs',
    mots: ['virtualisation', 'grappe de virtualisation', 'cluster de virtualisation', 'cluster vmware', 'infrastructure virtuelle'],
  },
  {
    id: 'perimetre',
    titre: 'Périmètre Internet redondé',
    resume: 'Deux opérateurs, routeurs et pare-feu en grappe, répartition de charge, serveurs web.',
    description:
      'deux liens opérateur, deux routeurs de périmètre en grappe, deux pare-feu en grappe actif/passif zone DMZ, deux répartiteurs de charge en grappe, trois serveurs web',
    mots: ['perimetre internet', 'acces internet redonde', 'front web', 'publication web'],
  },
  {
    id: 'wifi',
    titre: 'Réseau Wi-Fi',
    resume: 'Un contrôleur, des switchs PoE et six bornes.',
    description: 'un pare-feu, un switch cœur, deux switchs PoE, un contrôleur wifi, six bornes wifi',
    mots: ['wifi', 'wi-fi', 'reseau wifi', 'reseau sans fil', 'sans fil'],
  },
]

/**
 * L'architecture que désigne une phrase, ou rien.
 *
 * On ne cherche que des mots entiers, et la désignation la plus longue l'emporte : « trois
 * niveaux » ne doit pas être pris pour « deux niveaux » au motif qu'ils partagent un mot.
 */
export function trouverArchitecture(phrase: string): ArchitectureDepart | undefined {
  const texte = ` ${normalizeSpeech(phrase).replace(/œ/g, 'oe')} `
  let trouvee: { architecture: ArchitectureDepart; longueur: number } | undefined
  for (const architecture of ARCHITECTURES) {
    for (const mot of architecture.mots) {
      if (!texte.includes(` ${mot} `)) continue
      if (!trouvee || mot.length > trouvee.longueur) trouvee = { architecture, longueur: mot.length }
    }
  }
  return trouvee?.architecture
}
