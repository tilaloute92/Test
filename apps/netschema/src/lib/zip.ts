/**
 * Écriture d'archives ZIP, sans dépendance.
 *
 * Un fichier Visio `.vsdx` — comme tout format Office moderne — est un paquet OPC, c'est-à-dire
 * une archive ZIP contenant des parties XML. Produire un `.vsdx` depuis le navigateur demande
 * donc d'écrire un ZIP, et rien dans la plateforme ne le fait : `CompressionStream` compresse
 * un flux, mais ne construit pas l'archive qui l'entoure.
 *
 * Plutôt que d'ajouter une bibliothèque de plusieurs centaines de kilo-octets à une application
 * qui n'en a aucune, on écrit ici le strict nécessaire : des entrées « stockées », sans
 * compression. Le format l'autorise explicitement, tous les lecteurs l'acceptent, et le surcoût
 * est sans conséquence pour des parties XML de quelques dizaines de kilo-octets. Ce qui compte
 * est que l'archive soit exacte : un octet de travers et le fichier ne s'ouvre pas.
 */

/** Table CRC-32, construite une fois : c'est la somme de contrôle qu'impose le format. */
const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let valeur = i
    for (let bit = 0; bit < 8; bit += 1) {
      valeur = valeur & 1 ? (valeur >>> 1) ^ 0xedb88320 : valeur >>> 1
    }
    table[i] = valeur >>> 0
  }
  return table
})()

function crc32(octets: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < octets.length; i += 1) {
    crc = (crc >>> 8) ^ TABLE[(crc ^ octets[i]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface EntreeZip {
  /** Chemin dans l'archive, séparé par des barres obliques. */
  chemin: string
  contenu: string
}

/**
 * Heure et date au format MS-DOS, sur deux mots de 16 bits.
 *
 * Le format ZIP est plus vieux que l'an 2000 : les secondes y tiennent sur cinq bits — d'où le
 * pas de deux secondes — et l'année se compte depuis 1980.
 */
function horodatage(date: Date): { heure: number; date: number } {
  return {
    heure: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** Écriture petit-boutiste, l'ordre d'octets du format. */
class Tampon {
  private morceaux: Uint8Array[] = []
  private taille = 0

  octets(valeur: Uint8Array) {
    this.morceaux.push(valeur)
    this.taille += valeur.length
    return this
  }

  mot(valeur: number) {
    return this.octets(new Uint8Array([valeur & 0xff, (valeur >>> 8) & 0xff]))
  }

  double(valeur: number) {
    return this.octets(
      new Uint8Array([valeur & 0xff, (valeur >>> 8) & 0xff, (valeur >>> 16) & 0xff, (valeur >>> 24) & 0xff]),
    )
  }

  get position() {
    return this.taille
  }

  assembler(): Uint8Array {
    const sortie = new Uint8Array(this.taille)
    let curseur = 0
    for (const morceau of this.morceaux) {
      sortie.set(morceau, curseur)
      curseur += morceau.length
    }
    return sortie
  }
}

/**
 * Assemble les entrées en une archive ZIP.
 *
 * Structure : pour chaque fichier, un en-tête local suivi de ses octets ; puis le répertoire
 * central qui les référence par leur position ; puis l'enregistrement de fin qui pointe le
 * répertoire. C'est ce répertoire que lisent les décompresseurs — l'ordre des fichiers dans le
 * corps ne compte pas, leur position déclarée si.
 */
export function creerZip(entrees: EntreeZip[], date = new Date()): Blob {
  const encodeur = new TextEncoder()
  const { heure, date: jour } = horodatage(date)
  const corps = new Tampon()
  const central = new Tampon()

  for (const entree of entrees) {
    const nom = encodeur.encode(entree.chemin)
    const contenu = encodeur.encode(entree.contenu)
    const somme = crc32(contenu)
    const position = corps.position

    corps
      .double(0x04034b50) // signature d'en-tête local
      .mot(20) // version minimale
      .mot(0) // indicateurs
      .mot(0) // méthode 0 : stocké
      .mot(heure)
      .mot(jour)
      .double(somme)
      .double(contenu.length) // taille compressée
      .double(contenu.length) // taille réelle
      .mot(nom.length)
      .mot(0) // champ supplémentaire
      .octets(nom)
      .octets(contenu)

    central
      .double(0x02014b50) // signature d'entrée centrale
      .mot(20) // version d'écriture
      .mot(20) // version minimale
      .mot(0)
      .mot(0)
      .mot(heure)
      .mot(jour)
      .double(somme)
      .double(contenu.length)
      .double(contenu.length)
      .mot(nom.length)
      .mot(0) // champ supplémentaire
      .mot(0) // commentaire
      .mot(0) // numéro de disque
      .mot(0) // attributs internes
      .double(0) // attributs externes
      .double(position)
      .octets(nom)
  }

  const octetsCorps = corps.assembler()
  const octetsCentral = central.assembler()
  const fin = new Tampon()
  fin
    .double(0x06054b50) // signature de fin
    .mot(0) // disque courant
    .mot(0) // disque du répertoire
    .mot(entrees.length)
    .mot(entrees.length)
    .double(octetsCentral.length)
    .double(octetsCorps.length)
    .mot(0) // commentaire

  const octetsFin = fin.assembler()
  const total = new Uint8Array(octetsCorps.length + octetsCentral.length + octetsFin.length)
  total.set(octetsCorps, 0)
  total.set(octetsCentral, octetsCorps.length)
  total.set(octetsFin, octetsCorps.length + octetsCentral.length)
  return new Blob([total as unknown as BlobPart], { type: 'application/zip' })
}
