/**
 * Réconciliation d'une collecte avec un schéma existant.
 *
 * Une collecte unique ne sert à rien : on en refait une le mois suivant, et celle-là doit
 * se poser sur le schéma qu'on a mis une heure à ranger. D'où la règle qui commande tout ce
 * module : **la collecte ne sait que ce que SNMP lui a dit**. Les ports, les débits, les
 * agrégats, les voisinages — elle en est la source de vérité. Les positions, les sites, les
 * zones, les notes, les annotations, le cartouche — elle n'en sait rien, et n'a donc rien à
 * en dire.
 *
 * Deuxième règle, plus importante encore : **rien n'est supprimé en silence**. Un équipement
 * absent du relevé d'aujourd'hui n'est pas un équipement retiré du parc. C'est peut-être une
 * communauté SNMP changée, un équipement arrêté pour maintenance, un pare-feu qui bloque le
 * 161. Supprimer serait détruire un travail sur une supposition. On signale, et c'est
 * l'exploitant qui tranche.
 */

/** Clé de comparaison : on rapproche sans se soucier de la casse ni des espaces. */
function cle(valeur) {
  return String(valeur ?? '').trim().toLowerCase()
}

/**
 * Rapproche les équipements collectés de ceux du schéma.
 *
 * Trois clés, dans cet ordre : le nom, puis l'adresse IP, puis le numéro de série. Le nom
 * d'abord parce que c'est le sysName, celui que l'exploitant reconnaît ; l'adresse ensuite,
 * parce qu'un équipement renommé reste le même ; le numéro de série en dernier, parce qu'il
 * survit même à un changement d'adresse — mais il est rarement renseigné.
 */
export function apparier(existants, collectes) {
  const parNom = new Map()
  const parIp = new Map()
  const parSerie = new Map()
  for (const node of existants) {
    if (node.name) parNom.set(cle(node.name), node)
    if (node.ip) parIp.set(cle(node.ip), node)
    if (node.serial) parSerie.set(cle(node.serial), node)
  }

  const paires = []
  const nouveaux = []
  const vus = new Set()
  for (const collecte of collectes) {
    const trouve =
      (collecte.name && parNom.get(cle(collecte.name))) ||
      (collecte.ip && parIp.get(cle(collecte.ip))) ||
      (collecte.serial && parSerie.get(cle(collecte.serial))) ||
      null
    if (trouve && !vus.has(trouve.id)) {
      vus.add(trouve.id)
      paires.push({ existant: trouve, collecte })
    } else if (trouve) {
      // Deux équipements collectés tombent sur le même existant : on ne devine pas lequel
      // est le bon, on le dit.
      nouveaux.push({ ...collecte, _ambigu: trouve.name })
    } else {
      nouveaux.push(collecte)
    }
  }
  const absents = existants.filter((node) => !vus.has(node.id))
  return { paires, nouveaux, absents }
}

/**
 * Champs dont la collecte est la source de vérité : elle les a lus sur l'équipement.
 * Tout ce qui n'est pas listé ici appartient à celui qui tient le schéma.
 */
const CHAMPS_COLLECTE_NOEUD = ['kind', 'ip', 'vendor', 'model', 'serial']

/** Champs d'une liaison que la collecte connaît mieux que n'importe qui. */
const CHAMPS_COLLECTE_LIAISON = ['portA', 'portB', 'speed', 'lag', 'lacp']

/** Signature d'une liaison : la paire d'équipements et les deux ports. */
function signatureLiaison(link, nomDe) {
  const bouts = [
    `${cle(nomDe(link.from))}:${cle(link.portA)}`,
    `${cle(nomDe(link.to))}:${cle(link.portB)}`,
  ].sort()
  return bouts.join('~')
}

/**
 * Fusionne une collecte dans un schéma existant.
 *
 * Rend le document fusionné **et** le compte rendu de ce qui a changé. Le compte rendu
 * n'est pas un ornement : il se lit avant d'écrire, et c'est lui qui permet de refuser une
 * fusion qui annonce trente disparitions parce que la communauté SNMP a expiré.
 */
export function fusionner(existant, collecte, options = {}) {
  const { marquerAbsents = true, retirerLiensAbsents = false } = options
  const nodesExistants = existant.nodes ?? []
  const nodesCollectes = collecte.nodes ?? []
  const { paires, nouveaux, absents } = apparier(nodesExistants, nodesCollectes)

  const rapport = {
    equipementsAjoutes: [], equipementsMisAJour: [], equipementsAbsents: [],
    liaisonsAjoutees: [], liaisonsMisesAJour: [], liaisonsAbsentes: [],
    ambigus: [],
  }

  // ── Équipements ────────────────────────────────────────────────────────────
  const nodes = nodesExistants.map((node) => ({ ...node }))
  const parId = new Map(nodes.map((node) => [node.id, node]))
  /** Identifiant dans le document fusionné, pour un équipement de la collecte. */
  const idFusionne = new Map()

  for (const { existant: ancien, collecte: neuf } of paires) {
    const cible = parId.get(ancien.id)
    idFusionne.set(neuf.id, ancien.id)
    const changements = []
    for (const champ of CHAMPS_COLLECTE_NOEUD) {
      const valeur = neuf[champ]
      if (valeur === undefined || valeur === null || valeur === '') continue
      if (cle(cible[champ]) === cle(valeur)) continue
      // Le type est une déduction de la collecte, pas une lecture : si l'exploitant l'a
      // choisi, on ne le reprend pas. Une boîte reclassée « serveur » à chaque passage
      // serait le meilleur moyen de faire abandonner la collecte automatique.
      if (champ === 'kind' && cible[champ]) continue
      changements.push({ champ, avant: cible[champ] ?? null, apres: valeur })
      cible[champ] = valeur
    }
    // La grappe vPC est une lecture, pas une déduction : elle vient de la MIB.
    if (neuf.cluster && !cible.cluster) {
      changements.push({ champ: 'cluster', avant: null, apres: neuf.cluster })
      cible.cluster = neuf.cluster
      if (neuf.haTech) cible.haTech = neuf.haTech
    }
    if (changements.length > 0) {
      rapport.equipementsMisAJour.push({ nom: cible.name, changements })
    }
  }

  for (const neuf of nouveaux) {
    if (neuf._ambigu) {
      rapport.ambigus.push({ nom: neuf.name, correspondait: neuf._ambigu })
      continue
    }
    // Position : la collecte ne sait pas où poser une boîte. On la met à zéro, et c'est le
    // placement automatique de l'application qui rangera — lui sait lire la topologie.
    const copie = { ...neuf, x: 0, y: 0 }
    nodes.push(copie)
    parId.set(copie.id, copie)
    idFusionne.set(neuf.id, copie.id)
    rapport.equipementsAjoutes.push({ nom: copie.name, type: copie.kind })
  }

  for (const absent of absents) {
    rapport.equipementsAbsents.push({ nom: absent.name, ip: absent.ip ?? null })
    if (marquerAbsents) {
      const cible = parId.get(absent.id)
      // Un drapeau, pas une suppression : l'exploitant voit lequel n'a pas répondu et
      // décide. SNMP muet ne veut pas dire équipement retiré.
      cible.notes = ajouterNote(cible.notes, 'Non revu lors de la dernière collecte.')
    }
  }

  // ── Liaisons ───────────────────────────────────────────────────────────────
  const nomExistant = (id) => nodesExistants.find((node) => node.id === id)?.name ?? id
  const nomCollecte = (id) => nodesCollectes.find((node) => node.id === id)?.name ?? id

  const links = (existant.links ?? []).map((link) => ({ ...link }))
  const parSignature = new Map()
  for (const link of links) parSignature.set(signatureLiaison(link, nomExistant), link)

  const signaturesVues = new Set()
  for (const link of collecte.links ?? []) {
    const signature = signatureLiaison(link, nomCollecte)
    signaturesVues.add(signature)
    const ancien = parSignature.get(signature)
    if (ancien) {
      const changements = []
      for (const champ of CHAMPS_COLLECTE_LIAISON) {
        const valeur = link[champ]
        if (valeur === undefined || valeur === null || valeur === '') continue
        if (cle(ancien[champ]) === cle(valeur)) continue
        changements.push({ champ, avant: ancien[champ] ?? null, apres: valeur })
        ancien[champ] = valeur
      }
      if (changements.length > 0) {
        rapport.liaisonsMisesAJour.push({
          de: nomExistant(ancien.from), vers: nomExistant(ancien.to), changements,
        })
      }
      continue
    }
    const from = idFusionne.get(link.from)
    const to = idFusionne.get(link.to)
    if (!from || !to || from === to) continue
    const copie = { ...link, from, to }
    links.push(copie)
    parSignature.set(signature, copie)
    rapport.liaisonsAjoutees.push({
      de: nomCollecte(link.from), vers: nomCollecte(link.to),
      portA: link.portA ?? null, portB: link.portB ?? null,
    })
  }

  /*
    Liaisons du schéma qu'on n'a pas revues.

    Plus délicat que pour les équipements : un câble débranché est banal, et l'oublier dans
    le schéma est précisément ce qu'on veut éviter. Mais une collecte partielle — un seul
    équipement interrogé sur dix — ferait disparaître tout le reste. On ne retire donc que
    les liaisons dont les deux extrémités ont été interrogées aujourd'hui : là, le silence
    veut vraiment dire « plus de câble ».
  */
  const interroges = new Set(paires.map(({ existant: node }) => node.id))
  const liensRetires = []
  for (const link of links) {
    if (signaturesVues.has(signatureLiaison(link, nomExistant))) continue
    const vraimentAbsent = interroges.has(link.from) && interroges.has(link.to)
    if (!vraimentAbsent) continue
    rapport.liaisonsAbsentes.push({ de: nomExistant(link.from), vers: nomExistant(link.to) })
    if (retirerLiensAbsents) liensRetires.push(link.id)
  }
  const liensFinaux = links.filter((link) => !liensRetires.includes(link.id))

  return {
    document: { ...existant, nodes, links: liensFinaux },
    rapport,
  }
}

/** Ajoute une note sans écraser celle qui s'y trouve, et sans la répéter. */
function ajouterNote(notes, phrase) {
  const actuel = String(notes ?? '').trim()
  if (actuel.includes(phrase)) return actuel
  return actuel ? `${actuel}\n${phrase}` : phrase
}

/**
 * Compte rendu lisible.
 *
 * Écrit pour être lu avant d'accepter la fusion, pas après. D'où l'ordre : ce qui disparaît
 * en premier, parce que c'est ce qui doit faire hésiter.
 */
export function resumerFusion(rapport) {
  const lignes = []
  const bloc = (titre, items, rendu) => {
    if (items.length === 0) return
    lignes.push(`${titre} (${items.length})`)
    for (const item of items.slice(0, 20)) lignes.push(`    ${rendu(item)}`)
    if (items.length > 20) lignes.push(`    … et ${items.length - 20} de plus`)
  }

  bloc('Équipements non revus', rapport.equipementsAbsents,
    (i) => `${i.nom}${i.ip ? ` (${i.ip})` : ''}`)
  bloc('Liaisons non revues', rapport.liaisonsAbsentes, (i) => `${i.de} ↔ ${i.vers}`)
  bloc('Rapprochements ambigus', rapport.ambigus,
    (i) => `${i.nom} tombait déjà sur « ${i.correspondait} »`)
  bloc('Équipements ajoutés', rapport.equipementsAjoutes, (i) => `${i.nom} (${i.type})`)
  bloc('Liaisons ajoutées', rapport.liaisonsAjoutees,
    (i) => `${i.de} ${i.portA ?? '?'} ↔ ${i.vers} ${i.portB ?? '?'}`)
  bloc('Équipements mis à jour', rapport.equipementsMisAJour,
    (i) => `${i.nom} : ${i.changements.map((c) => `${c.champ} ${c.avant ?? '—'} → ${c.apres}`).join(', ')}`)
  bloc('Liaisons mises à jour', rapport.liaisonsMisesAJour,
    (i) => `${i.de} ↔ ${i.vers} : ${i.changements.map((c) => `${c.champ} ${c.avant ?? '—'} → ${c.apres}`).join(', ')}`)

  if (lignes.length === 0) return 'Aucun écart : le schéma correspond déjà au relevé.'
  return lignes.join('\n')
}

/** Vrai si la fusion ne change rien — utile pour une collecte planifiée silencieuse. */
export function sansEcart(rapport) {
  return Object.values(rapport).every((liste) => liste.length === 0)
}
