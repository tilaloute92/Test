import { vendorMark } from './vendorMarks'

/**
 * Logos officiels des constructeurs, fournis par l'installation.
 *
 * L'application ne peut pas les embarquer : un logo est une marque déposée, et le droit de
 * l'utiliser appartient à celui qui exploite le schéma, pas à l'outil qui le dessine. En
 * revanche, rien n'empêche de les déposer soi-même : les fichiers placés dans
 * `public/logos/` sont chargés au démarrage et remplacent alors les monogrammes.
 *
 * Ils sont convertis en données intégrées dès le chargement, pour que les exports — SVG, PNG,
 * page interactive — les emportent avec eux au lieu de pointer vers un serveur.
 */

const BASE = './logos'

/** Clé de constructeur → image intégrée (data:…), prête à poser dans un SVG. */
const logos = new Map<string, string>()
let charge = false

function cle(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function enDonnees(url: string): Promise<string | null> {
  try {
    const reponse = await fetch(url, { cache: 'no-cache' })
    if (!reponse.ok) return null
    const blob = await reponse.blob()
    if (blob.size > 512 * 1024) return null
    return await new Promise<string | null>((resolve) => {
      const lecteur = new FileReader()
      lecteur.onload = () => resolve(typeof lecteur.result === 'string' ? lecteur.result : null)
      lecteur.onerror = () => resolve(null)
      lecteur.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * Charge `public/logos/index.json`, de la forme :
 *
 *     { "cisco": "cisco.svg", "fortinet": "fortinet.png" }
 *
 * Son absence est le cas normal : l'application se rabat alors sur ses monogrammes.
 */
export async function chargerLogos(): Promise<number> {
  if (charge) return logos.size
  charge = true
  try {
    const reponse = await fetch(`${BASE}/index.json`, { cache: 'no-cache' })
    if (!reponse.ok) return 0
    const manifeste = (await reponse.json()) as Record<string, unknown>
    // Les clés commençant par « _ » sont des commentaires du fichier d'exemple.
    const entrees = Object.entries(manifeste).filter(
      ([nom, fichier]) => typeof nom === 'string' && !nom.startsWith('_') && typeof fichier === 'string',
    ) as [string, string][]
    await Promise.all(
      entrees.map(async ([nom, fichier]) => {
        const donnees = await enDonnees(`${BASE}/${fichier}`)
        if (donnees) logos.set(cle(nom), donnees)
      }),
    )
  } catch {
    // Pas de dossier de logos : ce n'est pas une erreur.
  }
  return logos.size
}

/** Logo d'un équipement, s'il en existe un pour son constructeur. */
export function logoDe(vendor?: string, model?: string): string | null {
  if (logos.size === 0) return null
  if (vendor) {
    const direct = logos.get(cle(vendor))
    if (direct) return direct
  }
  // Le fichier peut porter le nom canonique de la marque plutôt que celui saisi dans la fiche.
  const marque = vendorMark(vendor, model)
  return marque ? (logos.get(cle(marque.label)) ?? logos.get(cle(marque.code)) ?? null) : null
}

/** Nombre de logos chargés — utile au guide et aux tests. */
export function nombreDeLogos(): number {
  return logos.size
}
