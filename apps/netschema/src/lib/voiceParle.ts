import { trouverArchitecture, type ArchitectureDepart } from './architectures'
import { analyserDescription } from './assistant'
import { findDeviceScored } from './catalog'
import { REPERE_LIAISON, REPERE_PRONOM } from './voiceGrammar'
import {
  cleanName,
  LINK_WORDS,
  normalizeSpeech,
  type LinkPatch,
  type Rule,
  type VoiceIntent,
} from './voiceBase'

/**
 * Règles de la langue parlée.
 *
 * Les règles d'origine reconnaissent les commandes telles qu'on les écrit dans une aide :
 * « relie A à B », « renomme A en B ». Celles-ci reconnaissent ce qu'on dit en travaillant :
 * « le lien entre A et B est en 40 giga », « agrège-les en Po1 », « note sur A : … »,
 * « oups ». Elles passent en premier, parce qu'elles sont plus précises — et parce que
 * plusieurs phrases très naturelles tombaient jusque-là dans une règle voisine qui faisait
 * autre chose : « passe la liaison en fibre » changeait le type d'un équipement.
 *
 * Chaque règle reçoit le texte normalisé (minuscules, sans accents) et le texte d'origine,
 * alignés caractère par caractère : la valeur dictée se relit dans le second, à l'index où
 * la règle l'a trouvée dans le premier.
 */

// ─── Outils ──────────────────────────────────────────────────────────────────

/** Relit dans le texte d'origine ce qu'une règle a capturé dans le texte normalisé. */
function brut(raw: string, t: string, valeur: string, fin = false): string {
  const index = fin ? t.lastIndexOf(valeur) : t.indexOf(valeur)
  return index >= 0 ? raw.slice(index, index + valeur.length).trim() : valeur.trim()
}

/** Première lettre en capitale : ce qu'on dicte arrive tout en minuscules. */
export function phrase(texte: string): string {
  const net = texte.trim().replace(/^[:\s]+/, '')
  return net ? net.charAt(0).toUpperCase() + net.slice(1) : net
}

/**
 * Débit dicté, ramené à l'écriture du schéma : « 40 giga » donne « 40 Gb/s ».
 *
 * La reconnaissance écrit « giga », « gigabits », « G », « Gbps » selon l'humeur ; le schéma,
 * lui, n'a qu'une écriture, et c'est elle que lisent les contrôles de débit.
 */
export function debitDicte(texte: string): string | undefined {
  const trouve = normalizeSpeech(texte).match(
    /(\d+(?:[.,]\d+)?)\s*(gigabits?|gigas?|gbps|gb\/s|gb|g|megabits?|megas?|mbps|mb\/s|mb|m)(?![a-z])/,
  )
  if (!trouve) return undefined
  const nombre = trouve[1].replace(',', '.')
  return `${nombre} ${trouve[2].startsWith('g') ? 'Gb/s' : 'Mb/s'}`
}

/** Liste de VLAN dictée : « 10 et 20 », « 10, 20 et 30 », « 10 à 15 ». */
function vlansDictes(texte: string): string | undefined {
  const propre = texte
    .replace(/\s+(?:a|jusqu'a)\s+/g, '-')
    .replace(/\s*(?:et|,|;)\s*/g, ',')
    .replace(/\s+/g, ',')
    .replace(/,+/g, ',')
    .replace(/^,|,$/g, '')
  return /^\d+(?:[-,]\d+)*$/.test(propre) ? propre : undefined
}

/** Nom d'agrégat dicté : « 1 » et « port-channel 1 » donnent « Po1 », « Po23 » reste tel quel. */
function nomAgregat(valeurBrute: string): string {
  const net = valeurBrute.trim().replace(/^(?:le\s+|l')/i, '')
  const numero = net.match(/^(?:port[- ]?channel|agr[ée]gat|po|lag|bundle)?\s*(\d{1,4})$/i)
  if (numero) return `Po${numero[1]}`
  return net.replace(/^po(\d+)$/i, 'Po$1')
}

/** Nom de port dicté : « ethernet 1/1 » donne « Ethernet1/1 ». */
function nomPort(valeurBrute: string): string {
  const colle = valeurBrute.trim().replace(/\s+(?=\d)/g, '').replace(/\s*\/\s*/g, '/')
  return colle.charAt(0).toUpperCase() + colle.slice(1)
}

/**
 * Ce qu'on dit d'une liaison, traduit en modifications : nature, débit, mode, VLAN, secours.
 * Renvoie un objet vide quand rien n'a été reconnu — la règle appelante abandonne alors.
 */
function patchLiaison(reste: string): LinkPatch {
  const patch: LinkPatch = {}
  const media = Object.entries(LINK_WORDS).find(([mot]) => new RegExp(`(?:^|\\s)${mot}(?:\\s|$)`).test(reste))
  if (media) patch.kind = media[1]
  const debit = debitDicte(reste)
  if (debit) patch.speed = debit
  if (/\btrunk\b/.test(reste)) patch.mode = 'trunk'
  else if (/\bacces\b/.test(reste) && !/switch/.test(reste)) patch.mode = 'access'
  if (/\b(secours|redondant|backup)\b/.test(reste)) patch.redundant = true
  const vlans = reste.match(/vlans?\s+([\d\s,;a-]+?)(?:\s+(?:en|et\s+en)\s|$)/)
  if (vlans) {
    const liste = vlansDictes(vlans[1].trim())
    if (liste) patch.vlans = liste
  }
  return patch
}

/** « la liaison entre A et B », sous toutes ses formes ; capture A et B. */
const LIAISON_ENTRE =
  "(?:(?:le|la|les|l')\\s*)?(?:liens?|liaisons?|cables?|connexions?|brins?)\\s+(?:entre\\s+|de\\s+)?(.+?)\\s+(?:et|vers|a|au)\\s+(.+?)"

/** La liaison du contexte : « cette liaison », ou le pronom laissé par « passe-la en fibre ». */
const LIAISON_COURANTE = `(?:${REPERE_LIAISON}|${REPERE_PRONOM})`

/**
 * Nom dicté lettre à lettre, remis à la convention du schéma : « sw core 01 » devient
 * « SW-CORE-01 ». Ne s'applique qu'à un nom tout en minuscules, court et terminé par un
 * numéro — c'est la signature d'un nom épelé. « Serveur web 1 » ou « Opérateur A » ne
 * bougent pas.
 */
export function formaterNomEpele(nom: string): string {
  const mots = nom.trim().split(/\s+/)
  if (mots.length < 2 || mots.length > 4) return nom
  if (nom !== nom.toLowerCase()) return nom
  if (!/^[a-z]{1,5}$/.test(mots[0]) || !/^\d{1,4}$/.test(mots[mots.length - 1])) return nom
  if (!mots.every((mot) => /^[a-z0-9]{1,8}$/.test(mot))) return nom
  return mots.join('-').toUpperCase()
}

// ─── Construction : plusieurs équipements d'une phrase ───────────────────────

/** Ce qu'on crée avec « ajoute » et qui n'est pas un équipement. */
const PAS_UN_EQUIPEMENT =
  /^(?:a\s+la\s+note|dans\s+la\s+note)\b|^(?:une?\s+|la\s+|le\s+|l')?(?:note|annotation|remarque|commentaire|page|onglet|vlan|baie|flux|lien|liaison|cable|brin|modele|patron|gabarit|fleche|renvoi|cadre|(?:deuxieme|second|seconde|autre|nouveau|nouvelle|2e|2eme)\s+(?:lien|liaison|cable|brin))\b/

/** Mots qui annoncent une architecture sans en nommer aucune. */
const NOM_GENERIQUE = '(?:architecture|infrastructure|topologie|reseau|schema|maquette|modele|plan)'

/** Ce qui peut accompagner le nom d'une architecture sans rien y changer. */
const MOTS_NEUTRES = new Set(['de', "d'", 'en', 'type', 'un', 'une', 'le', 'la', 'avec', 'a', 'redonde', 'redondee', 'complet', 'complete', 'classique', 'standard', 'simple'])

/**
 * L'architecture de départ que la phrase demande, si elle ne demande que cela.
 *
 * « Monte une architecture trois tiers », « construis une agence », « crée un réseau
 * wifi ». La phrase ne doit rien dire d'autre : « ajoute une borne wifi » parle d'une borne,
 * pas du réseau Wi-Fi. Avec un verbe ordinaire et sans mot d'annonce, un nom qui est aussi
 * un type du catalogue reste un équipement — « ajoute un wifi » pose une borne.
 */
function architectureDemandee(description: string, explicite: boolean): ArchitectureDepart | undefined {
  const texte = normalizeSpeech(description).replace(/œ/g, 'oe')
  const sansArticle = texte.replace(/^(?:une?|l'|le|la|mon|ma|notre)\s*/, '')
  const sansAnnonce = sansArticle.replace(new RegExp(`^${NOM_GENERIQUE}\\s+(?:de type\\s+|type\\s+|de\\s+|d'|en\\s+|a\\s+)?`), '')
  const annonce = sansAnnonce !== sansArticle
  for (const candidat of [sansArticle, sansAnnonce]) {
    const architecture = trouverArchitecture(candidat)
    if (!architecture) continue
    let reste = ` ${candidat} `
    for (const mot of [...architecture.mots].sort((a, b) => b.length - a.length)) reste = reste.split(` ${mot} `).join(' ')
    if (!reste.split(' ').filter(Boolean).every((mot) => MOTS_NEUTRES.has(mot))) continue
    if (!explicite && !annonce && (findDeviceScored(candidat)?.score ?? 0) >= 0.8) continue
    return architecture
  }
  return undefined
}

/**
 * Reconnaît une demande de construction et la confie à l'assistant de conception.
 *
 * Travaille sur la phrase nettoyée mais non normalisée : l'assistant découpe sur les
 * virgules, que la normalisation efface. Une demande n'est une construction que si
 * l'assistant y trouve au moins deux équipements, ou si le verbe l'annonce (« construis »,
 * « monte ») : « ajoute un routeur » reste l'ajout simple, avec ses compléments — nom,
 * adresse, zone, raccordement — que l'assistant ne lit pas.
 */
export function detecterConstruction(nettoye: string): VoiceIntent | null {
  const trouve = nettoye.match(
    /^(ajoute|cr[ée]e|mets|place|pose|ins[èe]re|construis|monte|dessine|g[ée]n[èe]re|fais(?:[- ]moi)?|b[âa]tis)\s+(.+)$/i,
  )
  if (!trouve) return null
  const verbe = normalizeSpeech(trouve[1])
  let description = trouve[2].trim()
  if (PAS_UN_EQUIPEMENT.test(normalizeSpeech(description))) return null

  // « sans les relier », « non reliés », « sans câblage » : on crée, on ne raccorde pas.
  const sansRaccord =
    /\s*,?\s*(?:sans\s+(?:les?\s+|la\s+)?(?:relier|raccorder|connecter|c[âa]bler|c[âa]blage|liaisons?|liens?)|non\s+reli[ée]e?s?|pas\s+reli[ée]e?s?)\s*$/i
  const raccorder = !sansRaccord.test(description)
  description = description.replace(sansRaccord, '').trim()

  const explicite = /^(construis|monte|dessine|genere|batis|fais)/.test(verbe)
  // Les verbes à tout faire (« mets », « place ») n'ouvrent une construction que devant une
  // quantité : « mets SW-01 dans la zone DMZ » n'en est pas une.
  if (/^(mets|place|pose)$/.test(verbe) && !/^(?:une?|des|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|\d+)\s/i.test(description)) {
    return null
  }

  const architecture = architectureDemandee(description, explicite)
  if (architecture) return { type: 'build', description: architecture.description, raccorder, modele: architecture.titre }
  // « Construis une architecture », sans dire laquelle : l'assistant les présente toutes.
  if (explicite && new RegExp(`^(?:une?\\s+|l')?${NOM_GENERIQUE}$`).test(normalizeSpeech(description))) return { type: 'assistant' }

  const vide = { title: '', nodes: [], links: [] }
  const plan = analyserDescription(description, vide)
  if (plan.noeuds === 0) return null
  if (plan.noeuds < 2 && !explicite) return null
  // Une part de la phrase que l'assistant n'a pas comprise, sur un ajout ordinaire : mieux
  // vaut laisser les règles d'ajout simple s'en charger que d'en exécuter la moitié.
  if (plan.ignores.length > 0 && !explicite) return null
  return { type: 'build', description, raccorder }
}

/** Ce qui ouvre un nouvel élément d'une énumération : un article ou une quantité. */
const DEBUT_ELEMENT = '(?:une?|des|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|\\d+)\\s'

/**
 * « ajoute un pare-feu FW-01 et un routeur RTR-01 » : deux ajouts, chacun avec son nom.
 *
 * L'assistant de conception construit les énumérations de types — « un routeur, un pare-feu
 * et deux cœurs » — mais il ne lit ni les noms dictés ni les compléments (adresse, zone,
 * « relié à »). Quand la phrase en porte, on la rend à l'ajout simple, un élément à la fois :
 * c'est lui qui sait les lire. La commande reçue est déjà nettoyée.
 */
export function eclaterAjouts(commande: string): string[] {
  const trouve = commande.match(/^(ajoute|rajoute|cr[ée]e|mets|place|pose|ins[èe]re)\s+(.+)$/i)
  if (!trouve) return [commande]
  const reste = trouve[2]
  if (PAS_UN_EQUIPEMENT.test(normalizeSpeech(reste))) return [commande]
  if (!new RegExp(`^${DEBUT_ELEMENT}`, 'i').test(reste)) return [commande]
  if (detecterConstruction(commande)) return [commande]
  const morceaux = reste
    .split(new RegExp(`\\s*,\\s*(?:et\\s+)?(?=${DEBUT_ELEMENT})|\\s+et\\s+(?=${DEBUT_ELEMENT})`, 'i'))
    .map((morceau) => morceau.trim())
    .filter(Boolean)
  if (morceaux.length < 2) return [commande]
  return morceaux.map((morceau) => `${trouve[1]} ${morceau}`)
}

// ─── Règles ──────────────────────────────────────────────────────────────────

export const REGLES_PARLEES: Rule[] = [
  // ── Confirmation ───────────────────────────────────────────────────────────
  (t) =>
    /^(?:oui|ouais|yes|confirme|je confirme|confirmer|c'est ca|exact|exactement|affirmatif|absolument|bien sur|fais le)$/.test(t)
      ? { type: 'confirm', yes: true }
      : null,
  (t) => (/^(?:non|no|surtout pas|abandonne|laisse|laisse tomber|ne fais rien)$/.test(t) ? { type: 'confirm', yes: false } : null),

  // ── Corriger ───────────────────────────────────────────────────────────────
  // Ancrées : « annule » perdu au milieu d'une phrase n'est pas un ordre.
  (t) => {
    const fois = t.match(
      /^(?:annule|defais)\s+(?:les\s+)?(\d{1,2})\s+(?:fois|dernieres?(?:\s+(?:actions?|commandes?|operations?))?)$/,
    )
    if (fois) return { type: 'undo', times: Math.min(20, Math.max(1, Number(fois[1]))) }
    return /^(?:annule|defais|defaire|oups+|zut|mince|oh non|reviens en arriere|retour en arriere|retour arriere|reviens|je me suis trompe|c'est pas ca|ce n'est pas ca|erreur)(?:\s+(?:ca|cela|tout ca|la derniere (?:action|commande|operation)|ce que (?:je viens|tu viens) de faire))?$/.test(
      t,
    )
      ? { type: 'undo' }
      : null
  },
  (t) =>
    /^(?:refais|refaire|retablis|retablir|remets|remettre|restaure)(?:\s+(?:ca|cela|la derniere (?:action|commande)))?$/.test(t)
      ? { type: 'redo' }
      : null,

  // ── Dictée ─────────────────────────────────────────────────────────────────
  (t) =>
    /^(?:fin|arrete|stop|termine|ferme|quitte)\s+(?:de\s+)?(?:la\s+)?(?:dictee|note)$|^(?:dictee|note)\s+terminee$/.test(t)
      ? { type: 'dictation', action: 'stop' }
      : null,
  (t, raw) => {
    const debut = t.match(
      /^(?:dictee|dicte|mode dictee|commence la dictee|demarre la dictee)(?:\s+(?:une\s+|la\s+)?(?:note|remarque|commentaire))?(?:\s+(?:sur|pour|de|du|a propos de)\s+(.+))?$/,
    )
    if (!debut) return null
    return { type: 'dictation', action: 'start', target: debut[1] ? cleanName(brut(raw, t, debut[1], true)) : undefined }
  },

  // « ajoute à la note de X : … » — le texte s'ajoute, il ne remplace pas.
  (t, raw) => {
    const ajout = t.match(
      /^(?:ajoute|rajoute|complete)\s+(?:a|dans)\s+(?:la\s+)?(?:note|remarque|commentaire)\s+(?:de|du|sur|d')\s*(.+?)\s*:\s*(.+)$/,
    )
    if (!ajout) return null
    return {
      type: 'note',
      target: cleanName(brut(raw, t, ajout[1])),
      text: phrase(brut(raw, t, ajout[2], true)),
      append: true,
    }
  },
  // « note sur X : … », puis la forme sans deux-points, où c'est l'exécution qui cherche
  // où finit le nom.
  (t, raw) => {
    const avec = t.match(
      /^(?:note|notes|remarque|commentaire|annotation)\s+(?:sur|pour|de|du|a propos de|concernant)\s+(.+?)\s*:\s*(.+)$/,
    )
    if (avec) {
      return {
        type: 'note',
        target: cleanName(brut(raw, t, avec[1])),
        text: phrase(brut(raw, t, avec[2], true)),
        append: false,
      }
    }
    const sans = t.match(/^(?:note|notes|remarque|commentaire|annotation)\s+(?:sur|pour|a propos de|concernant)\s+(.+)$/)
    if (sans) return { type: 'note', text: '', append: false, libre: brut(raw, t, sans[1], true) }
    return null
  },
  // « note : … » sans équipement désigné : une note posée sur le plan.
  (t, raw) => {
    const libre = t.match(/^(?:note|remarque|annotation|post[- ]?it)\s*:\s*(.+)$/)
    return libre ? { type: 'annotate', kind: 'note', text: phrase(brut(raw, t, libre[1], true)) } : null
  },
  (t) => {
    if (/^(?:supprime|efface|enleve|retire)\s+(?:toutes\s+)?les\s+(?:notes|annotations|remarques)$/.test(t)) {
      return { type: 'annotationRemove', which: 'all' }
    }
    return /^(?:supprime|efface|enleve|retire)\s+(?:la\s+|cette\s+)?(?:derniere\s+)?(?:note|annotation|remarque)$/.test(t)
      ? { type: 'annotationRemove', which: 'last' }
      : null
  },

  // « modifie la dernière note : … » — le texte est remplacé.
  (t, raw) => {
    const corrige = t.match(
      /^(?:modifie|change|corrige|remplace|reecris)\s+(?:la\s+)?(?:derniere\s+)?(?:note|annotation|remarque)\s*(?::|en|par)\s*(.+)$/,
    )
    return corrige ? { type: 'annotationEdit', text: phrase(brut(raw, t, corrige[1], true)) } : null
  },

  // ── Flux : retirer ─────────────────────────────────────────────────────────
  (t, raw) => {
    const verbe = '(?:supprime|efface|enleve|retire)'
    if (new RegExp(`^${verbe}\\s+(?:le\\s+)?dernier\\s+flux$`).test(t)) return { type: 'flowRemove', which: 'last' }
    if (new RegExp(`^${verbe}\\s+(?:tous\\s+les|les)\\s+flux$`).test(t)) return { type: 'flowRemove', which: 'all' }
    const couple = t.match(
      new RegExp(`^${verbe}\\s+(?:le\\s+|les\\s+)?flux\\s+(?:(\\S+)\\s+)?(?:de|depuis|entre)\\s+(.+?)\\s+(?:vers|a|au|et)\\s+(.+)$`),
    )
    if (!couple) return null
    return {
      type: 'flowRemove',
      from: cleanName(brut(raw, t, couple[2])),
      to: cleanName(brut(raw, t, couple[3], true)),
      service: couple[1] ? brut(raw, t, couple[1]).toUpperCase() : undefined,
    }
  },

  // ── Suivi des VLAN le long des trunks ──────────────────────────────────────
  (t) => {
    if (/^(?:ne\s+(?:suis|propage)\s+plus\s+les\s+vlans?|arrete\s+de\s+(?:suivre|propager)\s+les\s+vlans?|desactive\s+(?:la\s+)?propagation\s+des\s+vlans?)$/.test(t)) {
      return { type: 'vlanPropagation', on: false }
    }
    return /^(?:(?:suis|propage)\s+les\s+vlans?(?:\s+le\s+long\s+des\s+trunks)?|active\s+(?:la\s+)?propagation\s+des\s+vlans?)$/.test(t)
      ? { type: 'vlanPropagation', on: true }
      : null
  },

  // ── Ordre des pages ────────────────────────────────────────────────────────
  // Avant « déplace X à droite », qui prendrait « la page » pour un équipement.
  (t) => {
    const cote = t.match(/^(?:deplace|decale|pousse|bouge)\s+(?:la\s+|cette\s+)?page\s+(?:vers\s+|a\s+|sur\s+)?(?:la\s+)?(gauche|droite)$/)
    if (cote) return { type: 'pageMove', direction: cote[1] === 'gauche' ? -1 : 1 }
    const sens = t.match(/^(avance|recule)\s+(?:la\s+|cette\s+)?page$/)
    return sens ? { type: 'pageMove', direction: sens[1] === 'recule' ? -1 : 1 } : null
  },

  // ── Baies : renommer, redimensionner ───────────────────────────────────────
  (t, raw) => {
    const renomme = t.match(/^(?:renomme|appelle)\s+la\s+baie\s+(.+?)\s+(?:en\s+)?(?:baie\s+)?(\S+)$/)
    if (renomme && /\sen\s/.test(t)) {
      return { type: 'rackEdit', rack: cleanName(brut(raw, t, renomme[1])), name: brut(raw, t, renomme[2], true) }
    }
    const hauteur =
      t.match(/^(?:la\s+)?baie\s+(.+?)\s+(?:fait|mesure|compte|a)\s+(\d{1,2})\s*u$/) ??
      t.match(/^(?:passe|mets|change)\s+la\s+baie\s+(.+?)\s+(?:a|en)\s+(\d{1,2})\s*u$/)
    return hauteur ? { type: 'rackEdit', rack: cleanName(brut(raw, t, hauteur[1])), units: Number(hauteur[2]) } : null
  },

  // ── Titre ──────────────────────────────────────────────────────────────────
  (t, raw) => {
    const titre =
      t.match(/^(?:le\s+)?titre(?:\s+du\s+(?:schema|document|plan))?\s+(?:est|c'est|sera|devient)\s+(.+)$/) ??
      t.match(/^(?:le\s+)?titre(?:\s+du\s+(?:schema|document|plan))?\s*:\s*(.+)$/) ??
      t.match(/^intitule\s+(?:le\s+(?:schema|document|plan)\s+)?(?::\s*)?(.+)$/) ??
      t.match(/^(?:appelle|nomme|renomme)\s+le\s+(?:schema|document|plan)\s+(?:en\s+)?(.+)$/)
    return titre ? { type: 'title', title: phrase(brut(raw, t, titre[1], true)) } : null
  },

  // ── Panneaux ───────────────────────────────────────────────────────────────
  // Avant les règles de repli : « ferme la palette » était lu « replie le groupe palette ».
  (t) => {
    const panneau = t.match(
      /^(ouvre|affiche|montre|ferme|masque|cache|replie)\s+(?:la\s+|l'|le\s+)?(palette|inspecteur|proprietes|mini[- ]?carte|vue d'ensemble miniature)$/,
    )
    if (!panneau) return null
    const lequel = panneau[2].startsWith('palette')
      ? 'palette'
      : /^(inspecteur|proprietes)/.test(panneau[2])
        ? 'inspecteur'
        : 'minicarte'
    return { type: 'panel', panel: lequel, open: /^(ouvre|affiche|montre)$/.test(panneau[1]) }
  },

  // ── Chemin entre deux équipements ──────────────────────────────────────────
  (t, raw) => {
    const chemin = t.match(
      /^(?:montre|affiche|trace|surligne|eclaire|quel est|donne)\s+(?:moi\s+)?(?:le\s+)?(?:chemin|trajet|parcours)\s+(?:entre|de|depuis)\s+(.+?)\s+(?:et|a|au|vers|jusqu'a)\s+(.+)$/,
    )
    return chemin
      ? { type: 'path', from: cleanName(brut(raw, t, chemin[1])), to: cleanName(brut(raw, t, chemin[2], true)) }
      : null
  },

  // ── Clignotement ───────────────────────────────────────────────────────────
  (t) => {
    if (/^(?:clignotement|duree du clignotement|clignote)\s+(?:de\s+|a\s+|pendant\s+)?(?:1|une)\s+minute$/.test(t)) {
      return { type: 'blink', seconds: 60 }
    }
    const duree = t.match(/^(?:clignotement|duree du clignotement|clignote)\s+(?:de\s+|a\s+|pendant\s+)?(\d{2})\s*(?:s|sec|secondes?)?$/)
    return duree ? { type: 'blink', seconds: Number(duree[1]) } : null
  },

  // ── Matrice de flux ────────────────────────────────────────────────────────
  (t, raw) => {
    const flux =
      t.match(
        /^(autorise|permets|ouvre|accepte|refuse|bloque|interdis|ajoute|cree|declare)\s+(?:le\s+|un\s+)?flux\s+(?:(\S+)\s+)?(?:de|depuis|entre)\s+(.+?)\s+(?:vers|a|au|et|jusqu'a)\s+(.+?)(?:\s+(?:en|sur le port|port)\s+(.+))?$/,
      )
    if (!flux) return null
    const service = flux[5] ?? flux[2]
    return {
      type: 'flow',
      from: cleanName(brut(raw, t, flux[3])),
      to: cleanName(brut(raw, t, flux[4], !flux[5])),
      service: service ? brut(raw, t, service, Boolean(flux[5])).toUpperCase() : undefined,
      decision: /^(refuse|bloque|interdis)$/.test(flux[1]) ? 'refuse' : 'autorise',
    }
  },

  // ── Liaisons ───────────────────────────────────────────────────────────────
  // Second brin : la liaison est créée même s'il en existe déjà une.
  (t, raw) => {
    const double =
      t.match(new RegExp(`^(?:double|dedouble|redouble)\\s+${LIAISON_ENTRE}$`)) ??
      t.match(
        /^(?:ajoute|cree|tire|pose|trace)\s+(?:un\s+|une\s+)?(?:deuxieme|second|seconde|2e|2eme|autre|nouveau|nouvelle)\s+(?:lien|liaison|cable|brin)\s+(?:entre\s+|de\s+)?(.+?)\s+(?:et|vers|a|au)\s+(.+)$/,
      )
    return double
      ? { type: 'link', from: cleanName(brut(raw, t, double[1])), to: cleanName(brut(raw, t, double[2], true)), extra: true }
      : null
  },
  // « relie-les entre eux ».
  (t) =>
    new RegExp(`^(?:relie|connecte|raccorde|branche)\\s+${REPERE_PRONOM}\\s+(?:entre\\s+(?:eux|elles)|ensemble)$`).test(t)
      ? { type: 'link', from: REPERE_PRONOM, to: REPERE_PRONOM, mutual: true }
      : null,
  // « tire un lien entre A et B ».
  (t, raw) => {
    const tire = t.match(
      /^(?:tire|pose|ajoute|cree|trace|mets)\s+(?:un\s+|une\s+)?(?:lien|liaison|cable|connexion)\s+(?:entre\s+|de\s+)?(.+?)\s+(?:et|vers|a|au)\s+(.+?)(?:\s+en\s+(.+))?$/,
    )
    if (!tire) return null
    const patch = tire[3] ? patchLiaison(tire[3]) : {}
    return {
      type: 'link',
      from: cleanName(brut(raw, t, tire[1])),
      to: cleanName(brut(raw, t, tire[2], !tire[3])),
      linkKind: patch.kind,
      speed: patch.speed,
    }
  },
  // « relie A à B [en fibre 40 giga] » — avec une vraie préposition d'abord, pour que
  // « relie A et B à C » ne coupe pas au premier « et ».
  (t, raw) => {
    const verbe = '(?:relie|connecte|raccorde|branche|cable|lie|attache)'
    const avecPreposition = t.match(new RegExp(`^${verbe}\\s+(.+?)\\s+(?:a|au|aux|avec|vers|sur)\\s+(.+)$`))
    const avecEt = t.match(new RegExp(`^${verbe}\\s+(.+?)\\s+et\\s+(.+)$`))
    const trouve = avecPreposition ?? avecEt
    if (!trouve) return null
    // La queue « en fibre », « en 40 giga » se détache de la cible si elle décrit une liaison.
    let cible = trouve[2]
    let patch: LinkPatch = {}
    const queue = cible.match(/^(.+?)\s+en\s+(.+)$/)
    if (queue) {
      const lu = patchLiaison(queue[2])
      if (Object.keys(lu).length > 0) {
        cible = queue[1]
        patch = lu
      }
    }
    return {
      type: 'link',
      from: cleanName(brut(raw, t, trouve[1])),
      to: cleanName(brut(raw, t, cible, !queue || Object.keys(patch).length === 0)),
      linkKind: patch.kind,
      speed: patch.speed,
    }
  },

  // Supprimer une liaison : « le lien », « les liens », « cette liaison ».
  (t, raw) => {
    const verbe = '(?:supprime|efface|enleve|retire|debranche|coupe)'
    if (new RegExp(`^${verbe}\\s+${LIAISON_COURANTE}$`).test(t) && t.includes(REPERE_LIAISON)) {
      return { type: 'linkDelete', from: '', to: '' }
    }
    const entre = t.match(new RegExp(`^(?:supprime|efface|enleve|retire)\\s+${LIAISON_ENTRE}$`))
    return entre
      ? { type: 'linkDelete', from: cleanName(brut(raw, t, entre[1])), to: cleanName(brut(raw, t, entre[2], true)) }
      : null
  },

  // Agrégat : tous les brins entre deux équipements prennent le même nom.
  (t, raw) => {
    const agrege =
      t.match(
        new RegExp(
          `^(?:agrege|regroupe|groupe|reunis)\\s+${LIAISON_ENTRE}\\s+(?:en|dans|sous)\\s+(?:le\\s+|l'|un\\s+)?(?:agregat\\s+|port-?channel\\s+|lag\\s+)?(\\S+)$`,
        ),
      ) ??
      t.match(
        new RegExp(
          `^(?:mets|place|passe)\\s+${LIAISON_ENTRE}\\s+(?:dans|en|sous)\\s+(?:le\\s+|l'|un\\s+)?(?:agregat|port-?channel|lag|bundle)\\s*(\\S+)$`,
        ),
      )
    if (!agrege) return null
    return {
      type: 'linkEdit',
      from: cleanName(brut(raw, t, agrege[1])),
      to: cleanName(brut(raw, t, agrege[2])),
      patch: { lag: nomAgregat(brut(raw, t, agrege[3], true)) },
      tous: true,
    }
  },
  (t, raw) => {
    const agrege = t.match(
      new RegExp(`^(?:agrege|regroupe)\\s+${LIAISON_COURANTE}\\s+(?:en|dans|sous)\\s+(?:le\\s+|l')?(?:agregat\\s+|port-?channel\\s+)?(\\S+)$`),
    )
    return agrege
      ? { type: 'linkEdit', from: '', to: '', patch: { lag: nomAgregat(brut(raw, t, agrege[1], true)) }, tous: true }
      : null
  },

  // Port : « le port de A vers B est Ethernet 1/1 ».
  (t, raw) => {
    const port = t.match(
      /^(?:le\s+)?port\s+(?:de|du|sur|cote)\s+(.+?)\s+(?:vers|cote|pour|en direction de|qui va (?:a|au|vers))\s+(.+?)\s+(?:est|c'est|:)\s*(.+)$/,
    )
    if (!port) return null
    const equipement = cleanName(brut(raw, t, port[1]))
    return {
      type: 'linkEdit',
      from: equipement,
      to: cleanName(brut(raw, t, port[2])),
      patch: {},
      port: { device: equipement, name: nomPort(brut(raw, t, port[3], true)) },
    }
  },

  // Le même, dans l'ordre où on le lit sur l'équipement : « port Ethernet 1/1 sur A vers B ».
  (t, raw) => {
    const port = t.match(/^(?:le\s+)?port\s+(.+?)\s+(?:sur|de|du)\s+(.+?)\s+(?:vers|cote|pour|en direction de)\s+(.+)$/)
    if (!port || /^(?:de|du|sur|cote)$/.test(port[1])) return null
    const equipement = cleanName(brut(raw, t, port[2]))
    return {
      type: 'linkEdit',
      from: equipement,
      to: cleanName(brut(raw, t, port[3], true)),
      patch: {},
      port: { device: equipement, name: nomPort(brut(raw, t, port[1])) },
    }
  },

  // VLAN d'un trunk : « autorise les VLAN 10 et 20 entre A et B ».
  (t, raw) => {
    const vlans = t.match(
      /^(?:autorise|ajoute|laisse passer|transporte|passe)\s+(?:les?\s+)?vlans?\s+(.+?)\s+(?:entre|sur (?:le lien|la liaison) entre)\s+(.+?)\s+(?:et|vers)\s+(.+)$/,
    )
    if (!vlans) return null
    const liste = vlansDictes(vlans[1])
    if (!liste) return null
    return {
      type: 'linkEdit',
      from: cleanName(brut(raw, t, vlans[2])),
      to: cleanName(brut(raw, t, vlans[3], true)),
      patch: { vlans: liste, mode: 'trunk' },
    }
  },

  // Étiquette : « étiquette du lien entre A et B : transit ».
  (t, raw) => {
    const etiquette = t.match(
      new RegExp(`^(?:etiquette|libelle|nom)\\s+(?:du|de la|sur le|sur la|de)\\s+${LIAISON_ENTRE}\\s*:\\s*(.+)$`),
    )
    return etiquette
      ? {
          type: 'linkEdit',
          from: cleanName(brut(raw, t, etiquette[1])),
          to: cleanName(brut(raw, t, etiquette[2])),
          patch: { label: phrase(brut(raw, t, etiquette[3], true)) },
        }
      : null
  },

  // Caractériser : « le lien entre A et B est en 40 giga », « passe la liaison … en fibre ».
  (t, raw) => {
    const sujet = t.match(
      new RegExp(
        `^(?:(?:passe|mets|change|modifie|configure)\\s+)?${LIAISON_ENTRE}\\s+(?:est\\s+|passe\\s+)?(?:en|a|au|un|une|du|de la)\\s+(.+)$`,
      ),
    )
    if (!sujet) return null
    const patch = patchLiaison(sujet[3])
    if (Object.keys(patch).length === 0) return null
    return { type: 'linkEdit', from: cleanName(brut(raw, t, sujet[1])), to: cleanName(brut(raw, t, sujet[2])), patch }
  },
  // La même chose sur la liaison du contexte : « passe-la en fibre », « cette liaison est en 10 giga ».
  (t) => {
    const courant = t.match(
      new RegExp(`^(?:(?:passe|mets|change|modifie|configure)\\s+)?${LIAISON_COURANTE}\\s+(?:est\\s+|passe\\s+)?(?:en|a|au|un|une)\\s+(.+)$`),
    )
    if (!courant) return null
    const patch = patchLiaison(courant[1])
    // Un pronom seul ne désigne une liaison que si ce qu'on en dit ne peut être que d'une
    // liaison : « mets-le en fibre » oui, « mets-le en VLAN 20 » non — c'est un équipement.
    const propreALiaison = Boolean(patch.kind || patch.speed || patch.mode)
    if (!propreALiaison) return null
    if (!t.includes(REPERE_LIAISON) && patch.vlans && !patch.kind && !patch.speed) return null
    return { type: 'linkEdit', from: '', to: '', patch }
  },

  // ── Équipements ────────────────────────────────────────────────────────────
  // « appelle-le FW-EDGE », « son nom est FW-EDGE ».
  (t, raw) => {
    const appelle = t.match(new RegExp(`^(?:appelle|nomme|baptise|renomme)\\s+${REPERE_PRONOM}\\s+(?:en\\s+)?(.+)$`))
    if (appelle) return { type: 'rename', target: REPERE_PRONOM, name: brut(raw, t, appelle[1], true) }
    const nom = t.match(/^(?:le\s+)?nom\s+de\s+(.+?)\s+(?:est|c'est|:|devient)\s+(.+)$/)
    return nom
      ? { type: 'rename', target: cleanName(brut(raw, t, nom[1])), name: brut(raw, t, nom[2], true) }
      : null
  },
  // « SW-CORE-01 est dans la zone cœur ».
  (t, raw) => {
    const est = t.match(
      /^(.+?)\s+(?:est|se trouve|va)\s+(dans la zone|en zone|sur le site|dans le site|au site|dans la grappe|dans le cluster|en vlan|dans le vlan|sur le vlan|dans la baie)\s+(.+)$/,
    )
    if (!est) return null
    const cible = cleanName(brut(raw, t, est[1]))
    const valeur = brut(raw, t, est[3], true)
    if (est[2] === 'dans la baie') return { type: 'rackAssign', target: cible, rack: valeur }
    const champ = est[2].includes('zone') ? 'zone' : est[2].includes('site') ? 'site' : est[2].includes('vlan') ? 'vlan' : 'cluster'
    return { type: 'setField', target: cible, field: champ, value: valeur }
  },
  // « duplique SW-ACC-01 trois fois ».
  (t, raw) => {
    const fois = t.match(/^(?:duplique|copie|clone)\s+(.+?)\s+(\d{1,2})\s+fois$/)
    if (!fois) return null
    const cible = cleanName(fois[1])
    const copies = Math.min(50, Math.max(1, Number(fois[2])))
    if (/^(la selection|selection|ca|cela)$/.test(cible)) return { type: 'duplicate', copies }
    return { type: 'duplicate', target: cleanName(brut(raw, t, fois[1])), copies }
  },
  // Déplacer d'un mot : « monte-le », « descends-le un peu », « pousse-le à droite ».
  (t, raw) => {
    const vertical = t.match(/^(monte|remonte|leve|descends|baisse|abaisse)\s+(.+?)(?:\s+(un peu|legerement|beaucoup|de \d+))?$/)
    if (vertical && !/(?:cran|plan|dessus|dessous|devant|derriere)$/.test(vertical[2])) {
      const pas = vertical[3]
      const amount = !pas ? 120 : /peu|legerement/.test(pas) ? 40 : pas === 'beaucoup' ? 300 : Number(pas.replace(/\D/g, ''))
      return {
        type: 'move',
        target: cleanName(brut(raw, t, vertical[2])),
        direction: /^(monte|remonte|leve)$/.test(vertical[1]) ? 'up' : 'down',
        amount,
      }
    }
    const lateral = t.match(
      /^(?:pousse|decale|deplace|bouge|mets)\s+(.+?)\s+(?:plus\s+)?(?:vers |a |au |en |sur )?(la droite|la gauche|le haut|le bas|droite|gauche|haut|bas)(?:\s+(un peu|legerement|beaucoup))?$/,
    )
    if (!lateral) return null
    const sens = lateral[2].replace(/^(la|le) /, '')
    const amount = !lateral[3] ? 120 : lateral[3] === 'beaucoup' ? 300 : 40
    return {
      type: 'move',
      target: cleanName(brut(raw, t, lateral[1])),
      direction: sens === 'droite' ? 'right' : sens === 'gauche' ? 'left' : sens === 'haut' ? 'up' : 'down',
      amount,
    }
  },

  // ── Tout supprimer ─────────────────────────────────────────────────────────
  (t) =>
    /^(?:supprime|efface|enleve|retire|vide)\s+(?:tout|tout le schema|le schema|tous les equipements|l'ensemble)$/.test(t)
      ? { type: 'delete', all: true }
      : null,

  // ── Voir ───────────────────────────────────────────────────────────────────
  (t) =>
    /^(?:zoome|zoom|zoom avant|agrandis|agrandir|rapproche|rapproche toi|plus pres|plus gros|plus grand)(?:\s+(?:un peu|encore|plus))?$/.test(t)
      ? { type: 'zoom', direction: 'in' }
      : null,
  (t) =>
    /^(?:dezoome|dezoom|zoom arriere|eloigne|eloigne toi|plus loin|plus petit)(?:\s+(?:un peu|encore|plus))?$/.test(t)
      ? { type: 'zoom', direction: 'out' }
      : null,
  (t) =>
    /^(?:montre|affiche|voir|vois)\s+tout$|^(?:tout voir|vue d'ensemble|ajuste|ajuste a l'ecran|recentre|cadre)$/.test(t)
      ? { type: 'fit' }
      : null,
  (t) =>
    /^(?:range|arrange|organise|reorganise|remets de l'ordre|mets de l'ordre|fais le menage|nettoie)(?:\s+(?:tout|tout ca|le schema|le plan|ca))?$/.test(
      t,
    )
      ? { type: 'layout' }
      : null,

  // ── Aide ───────────────────────────────────────────────────────────────────
  (t) =>
    /^(?:qu'est ce que je peux dire|qu'est-ce que je peux dire|que puis je dire|que puis-je dire|quelles commandes|liste des commandes|quelles sont les commandes|comment (?:je fais|on fait|faire))$/.test(
      t,
    )
      ? { type: 'help' }
      : null,
]

/**
 * Règles de dernier recours, essayées après toutes les autres.
 *
 * « X est un Y » est la phrase la plus naturelle pour dire ce qu'est un équipement — et la
 * plus vague : elle ressemble à tout. Elle ne passe donc qu'en dernier, quand aucune règle
 * plus précise n'a reconnu la phrase.
 */
export const REGLES_DE_REPLI: Rule[] = [
  // « SW-CORE-01 est un Nexus 9300 » : un type du catalogue change le type, sinon c'est le modèle.
  (t, raw) => {
    const est = t.match(/^(.+?)\s+(?:est|c'est)\s+(?:un|une|du|de la)\s+(.+)$/)
    if (!est) return null
    const cible = cleanName(brut(raw, t, est[1]))
    const type = findDeviceScored(est[2])
    if (type && type.score >= 0.95) return { type: 'setKind', target: cible, kind: type.device.id, label: type.device.label }
    return { type: 'setField', target: cible, field: 'model', value: brut(raw, t, est[2], true) }
  },
]
