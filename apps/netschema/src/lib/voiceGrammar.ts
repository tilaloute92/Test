/**
 * La langue parlée, avant la commande.
 *
 * Les règles de `voice.ts` reconnaissent des commandes bien formées : « relie A à B ». Mais
 * personne ne parle ainsi. On dit « euh, alors… ajoute un switch, relie-le au cœur, puis
 * mets-le dans la zone serveurs » — trois commandes, deux pronoms, deux mots pour rien. Ce
 * module fait le chemin entre les deux : il nettoie, il découpe, il remplace les pronoms par
 * un repère que l'exécution sait résoudre.
 *
 * Tout ici est pur — du texte en entrée, du texte en sortie — donc testable sans micro,
 * sans navigateur et sans schéma.
 */

/**
 * Repère laissé à la place d'un pronom : « relie-le à X » devient « relie ceci à X ».
 * L'exécution le résout sur l'équipement dont on vient de parler, à défaut sur la sélection.
 * Un vrai mot plutôt qu'un symbole : il traverse sans dommage la normalisation et les règles
 * existantes, qui capturent les cibles comme du texte libre.
 */
export const REPERE_PRONOM = 'ceci'

/** Repère d'une liaison dont on vient de parler : « passe-la en fibre ». */
export const REPERE_LIAISON = 'cette liaison'

// ─── Nettoyage ───────────────────────────────────────────────────────────────

/** Mots qu'on dit pour se donner le temps de penser, en tête de phrase. */
const REMPLISSAGE =
  /^(?:e+u+h+|h+e+u+|h+u+m+|h+m+|ben|bah|bon|alors|donc|ok|okay|d['’ ]?accord|voil[aà]|allez|tiens|dis(?:[- ]moi)?|et puis|et ensuite|et maintenant|et|puis|ensuite|maintenant|apr[eè]s [cç]a|apr[eè]s|non(?=[\s,]+\S))\b[\s,]*/i

/** Tournures de politesse et d'intention, en tête. */
const POLITESSE_DEBUT =
  /^(?:s['’ ]?il (?:te|vous) pla[iî]t|stp|svp|est[- ]ce que tu peux|est[- ]ce que tu pourrais|tu peux|tu pourrais|peux[- ]tu|pourrais[- ]tu|pouvez[- ]vous|je veux que tu|je voudrais que tu|j['’ ]?aimerais que tu|je veux|je voudrais|j['’ ]?aimerais|je souhaite|il faut|il faudrait|on va|on peut|merci de|bien vouloir|va[- ]y|vas[- ]y)\b[\s,]*/i

/** Les mêmes, en fin de phrase. */
const POLITESSE_FIN = /[\s,]*(?:s['’ ]?il (?:te|vous) pla[iî]t|stp|svp|merci(?: beaucoup)?|voil[aà])\s*[.!]?\s*$/i

/**
 * Verbes de commande, par leur radical. Chaque radical accepte les terminaisons que la
 * reconnaissance vocale produit pour un même son — « relie », « relis », « relit »,
 * « relier », « relié » — et se ramène à l'impératif que les règles attendent.
 */
const VERBES: [RegExp, string][] = [
  [/^ajout(?:e|es|é|ée|er|ez|ons)$/i, 'ajoute'],
  [/^cr[ée](?:e|es|é|ée|er|ez|ons)$/i, 'crée'],
  [/^(?:mets|met|mettre|mettez|mettons)$/i, 'mets'],
  [/^plac(?:e|es|é|er|ez)$/i, 'place'],
  [/^pos(?:e|es|é|er|ez)$/i, 'pose'],
  [/^ins[èeé]r(?:e|es|é|er|ez)$/i, 'insère'],
  [/^reli(?:e|es|s|t|é|ée|er|ez|ent)$/i, 'relie'],
  [/^connect(?:e|es|é|er|ez)$/i, 'connecte'],
  [/^branch(?:e|es|é|er|ez)$/i, 'branche'],
  [/^raccord(?:e|es|é|er|ez)$/i, 'raccorde'],
  [/^c[âa]bl(?:e|es|é|er|ez)$/i, 'câble'],
  [/^supprim(?:e|es|é|er|ez)$/i, 'supprime'],
  [/^enl[èeé]v(?:e|es|é|er|ez)$/i, 'enlève'],
  [/^retir(?:e|es|é|er|ez)$/i, 'retire'],
  [/^effac(?:e|es|é|er|ez)$/i, 'efface'],
  [/^renomm(?:e|es|é|er|ez)$/i, 'renomme'],
  [/^appell(?:e|es)$|^appel(?:é|er|ez)$/i, 'appelle'],
  [/^s[ée]lectionn(?:e|es|é|er|ez)$/i, 'sélectionne'],
  [/^d[ée]s[ée]lectionn(?:e|es|é|er|ez)$/i, 'désélectionne'],
  [/^d[ée]plac(?:e|es|é|er|ez)$/i, 'déplace'],
  [/^d[ée]cal(?:e|es|é|er|ez)$/i, 'décale'],
  [/^mont(?:e|es|é|er|ez)$/i, 'monte'],
  [/^descend(?:s|re|ez|u)?$/i, 'descends'],
  [/^dupliqu(?:e|es|é|er|ez)$/i, 'duplique'],
  [/^annul(?:e|es|é|er|ez)$/i, 'annule'],
  [/^affich(?:e|es|é|er|ez)$/i, 'affiche'],
  [/^masqu(?:e|es|é|er|ez)$/i, 'masque'],
  [/^montr(?:e|es|é|er|ez)$/i, 'montre'],
  [/^cach(?:e|es|é|er|ez)$/i, 'cache'],
  [/^zoom(?:e|es|é|er|ez)?$/i, 'zoome'],
  [/^d[ée]zoom(?:e|es|é|er|ez)?$/i, 'dézoome'],
  [/^ouvr(?:e|es|ir|ez)$|^ouvert$/i, 'ouvre'],
  [/^ferm(?:e|es|é|er|ez)$/i, 'ferme'],
  [/^pass(?:e|es|é|er|ez)$/i, 'passe'],
  [/^agr[èeé]g(?:e|es|é|er|ez)$/i, 'agrège'],
  [/^doubl(?:e|es|é|er|ez)$/i, 'double'],
  [/^autoris(?:e|es|é|er|ez)$/i, 'autorise'],
  [/^refus(?:e|es|é|er|ez)$/i, 'refuse'],
  [/^construi(?:s|t|re|sez)$/i, 'construis'],
  [/^transform(?:e|es|é|er|ez)$/i, 'transforme'],
  [/^verrouill(?:e|es|é|er|ez)$/i, 'verrouille'],
  [/^d[ée]verrouill(?:e|es|é|er|ez)$/i, 'déverrouille'],
  [/^align(?:e|es|é|er|ez)$/i, 'aligne'],
  [/^export(?:e|es|é|er|ez)$/i, 'exporte'],
  [/^enregistr(?:e|es|é|er|ez)$/i, 'enregistre'],
  [/^intitul(?:e|es|é|er|ez)$/i, 'intitule'],
  [/^dict(?:e|es|é|er|ez)$/i, 'dicte'],
  [/^repren(?:ds|d|dre|ez)$/i, 'reprends'],
  [/^r[ée]cup[èeé]r(?:e|es|er|ez)$/i, 'récupère'],
]

/** Impératif d'un mot s'il s'agit d'un verbe de commande, sinon rien. */
function imperatif(mot: string): string | null {
  for (const [motif, forme] of VERBES) if (motif.test(mot)) return forme
  return null
}

/**
 * Ce que la reconnaissance entend de travers, et qui a un sens dans ce logiciel.
 *
 * Chaque correction est bornée par son contexte. « Suisse » ne devient « switch » qu'après
 * un article ou un nombre : « site Suisse » reste un site.
 */
function corrigerReconnaissance(texte: string): string {
  return (
    texte
      // « un Suisse cœur », « deux suisses d'accès » : le mot le plus mal entendu du métier.
      .replace(
        /\b(une?|le|les|des|du|au|aux|ce|ces|chaque|nouveau|\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s+suisses?\b/gi,
        (_, avant: string) => `${avant} switch`,
      )
      .replace(/\b(?:switche|souitch|swich|switch)(e?s)?\b/gi, 'switch$1')
      // « chœur » pour « cœur », quand il suit un switch.
      .replace(/\b(switchs?|switches)\s+(?:de\s+)?ch[oœ]e?urs?\b/gi, '$1 cœur')
      // Le sigle épelé ou écrit comme on l'entend.
      .replace(/\b(?:v[- ]lan|v[ée]lan|velane|vie lane?)(s?)\b/gi, 'VLAN$1')
      .replace(/\bpare[- ]?feux?\b/gi, 'pare-feu')
      .replace(/\bfire[- ]?walls?\b/gi, 'pare-feu')
      .replace(/\bport[- ]?channel\b/gi, 'port-channel')
  )
}

/**
 * Nettoie une phrase dictée : hésitations, politesse, verbe ramené à l'impératif, mots mal
 * entendus. La casse et les noms sont conservés — seul ce qui n'est pas la commande part.
 */
export function nettoyerPhrase(phrase: string): string {
  let texte = phrase.replace(/\s+/g, ' ').trim()

  // Hésitations et politesse s'empilent (« euh, alors, tu peux… ») : on épluche jusqu'au bout.
  for (let tour = 0; tour < 6; tour += 1) {
    const avant = texte
    texte = texte.replace(REMPLISSAGE, '').replace(POLITESSE_DEBUT, '').trim()
    if (texte === avant) break
  }
  texte = texte.replace(POLITESSE_FIN, '').trim()

  // « mais un serveur » : « mets » entendu « mais », devant un article.
  texte = texte.replace(/^mais(?=[- ](?:une?|des|le|la|les|l['’]|[cç]a|tout|tous)\b)/i, 'mets')

  // Le verbe de tête, ramené à l'impératif — avec son pronom accroché s'il en a un.
  texte = texte.replace(/^([^\s-]+)((?:-(?:le|la|les|lui|moi))?)(?=\s|$)/i, (entier, verbe: string, clitique: string) => {
    const forme = imperatif(verbe)
    return forme ? `${forme}${clitique}` : entier
  })

  return corrigerReconnaissance(texte)
}

// ─── Pronoms ─────────────────────────────────────────────────────────────────

/** Ce qu'un possessif peut désigner : « son adresse », « sa zone », « leur VLAN ». */
const POSSEDES =
  'adresse ip|adresse|ip|zone|site|mod[eè]le|nom|vlan|r[oô]le|baie|grappe|cluster|propri[ée]taire|responsable|num[ée]ro de s[ée]rie|statut|[ée]tat'

/**
 * Remplace les pronoms par le repère de contexte.
 *
 * La phrase doit déjà être nettoyée et ne porter qu'une commande. Le pronom n'est reconnu
 * qu'accroché au verbe de tête, ou placé juste après lui devant une préposition : c'est ce
 * qui distingue « relie-le à X » de « relie le routeur à X », où « le » est un article. Un
 * nom d'équipement comme « SW-LE-01 » n'est pas touché, puisqu'il ne suit pas le verbe.
 */
export function resoudrePronoms(phrase: string): string {
  let texte = phrase

  // « relie-le », « mets-les », « supprime-la » : le pronom accroché au verbe.
  texte = texte.replace(/^([^\s-]+)-(?:le|la|les|lui)\b/i, `$1 ${REPERE_PRONOM}`)

  // La reconnaissance oublie souvent le trait d'union : « relie le à X », « supprime le ».
  texte = texte.replace(
    /^(\S+)\s+(?:le|la|les)(?=\s+(?:[àa]|au|aux|en|dans|sur|sous|vers|avec|de|du|d['’]|un peu|plus|encore|\d+)(?=\s|$)|\s*$)/i,
    (entier, verbe: string) => (imperatif(verbe) ? `${verbe} ${REPERE_PRONOM}` : entier),
  )

  // « son adresse est… », « sa zone est… », « leur VLAN est… ».
  texte = texte.replace(
    new RegExp(`^(?:son|sa|ses|leur|leurs)\\s+(${POSSEDES})\\b`, 'i'),
    (_, possede: string) => `${/^[aeiouyéèh]/i.test(possede) ? "l'" : 'le '}${possede} de ${REPERE_PRONOM}`,
  )

  // « celui-ci », « ce dernier », « cet équipement », « ce switch ».
  texte = texte
    .replace(/\b(?:celui|celle)[- ](?:ci|l[aà])(?=[\s,.]|$)/gi, REPERE_PRONOM)
    .replace(/\bce dernier\b|\bcette derni[eè]re\b/gi, REPERE_PRONOM)
    .replace(/\bcet [ée]quipement(?:[- ](?:ci|l[aà]))?(?=[\s,.]|$)/gi, REPERE_PRONOM)
    .replace(/\b(?:ceux|celles)[- ](?:ci|l[aà])(?=[\s,.]|$)/gi, REPERE_PRONOM)

  // « ce lien », « cette liaison », « ce câble » : la liaison dont on vient de parler.
  texte = texte.replace(
    /\b(?:ce (?:lien|c[âa]ble|brin)|cette (?:liaison|connexion))(?:[- ](?:ci|l[aà]))?(?=[\s,.]|$)/gi,
    REPERE_LIAISON,
  )

  return texte
}

// ─── Découpage ───────────────────────────────────────────────────────────────

/**
 * Verbes qui ouvrent une nouvelle commande après « et » ou une virgule.
 *
 * Les formes que la reconnaissance écrit pour le même son y sont (« relis », « relit »,
 * « ajoutes ») — pas le participe : dans « un serveur, relié à SW-01 », « relié » complète
 * l'ajout, il n'ouvre pas une commande.
 *
 * Seuls ceux qui ne peuvent pas être pris pour un nom figurent ici. « Note », « double »,
 * « centre », « place », « passe », « monte » sont aussi des noms ou des adjectifs : « la
 * zone nord et centre » ne doit pas devenir deux commandes. Ceux-là n'ouvrent une commande
 * qu'avec un pronom accroché — « et passe-le en fibre » —, ce qui lève le doute.
 */
const VERBES_FRANCS =
  'ajout(?:e|es|er|ez)|cr[ée](?:e|er)|mets|mettre|ins[èe]re|ins[ée]rer|reli(?:e|es|er|ez|s|t)|connect(?:e|es|er|ez)|branch(?:e|er)|raccord(?:e|er)|c[âa]bl(?:e|er)|supprim(?:e|es|er|ez)|enl[èe]ve|enlever|retir(?:e|er)|effac(?:e|er)|renomm(?:e|er)|appell(?:e)|appeler|s[ée]lectionn(?:e|er)|d[ée]s[ée]lectionn(?:e|er)|d[ée]plac(?:e|er)|d[ée]cal(?:e|er)|dupliqu(?:e|er)|annul(?:e|er)|affich(?:e|er)|masqu(?:e|er)|montr(?:e|er)|zoom(?:e|er)|d[ée]zoom(?:e|er)|agr[èe]g(?:e|er)|autoris(?:e|er)|refus(?:e|er)|construi(?:s|re)|transform(?:e|er)|verrouill(?:e|er)|d[ée]verrouill(?:e|er)|align(?:e|er)|export(?:e|er)|enregistr(?:e|er)|intitul(?:e|er)|repren(?:ds|dre)|r[ée]cup[èe]r(?:e|er)'

/** Tout verbe de commande, dès lors qu'un pronom y est accroché. */
const VERBE_A_PRONOM = '[a-zà-ÿ]+-(?:le|la|les|lui)'

/**
 * Phrases dont la suite est du texte libre : on n'y cherche pas d'autres commandes.
 * « Note sur X : relie le port console puis vérifie » est une note, pas trois ordres.
 */
const TEXTE_LIBRE =
  /^(?:(?:ajoute|cr[ée]e|mets|pose|[ée]cris)\s+(?:une?\s+)?(?:note|remarque|commentaire|annotation|[ée]tiquette)|note|notes|remarque|commentaire|annotation|[ée]tiquette|dict[ée]e?|dicte|titre|intitule|le titre|renomme le sch[ée]ma|ajoute [àa] la note)\b/i

/**
 * Découpe une phrase en commandes.
 *
 * « Puis » et « ensuite » coupent toujours. « Et » et la virgule ne coupent que devant un
 * verbe de commande : « relie A et B » reste entier, « ajoute un serveur et relie-le au
 * cœur » donne deux commandes. Une énumération — « un routeur, un pare-feu et deux cœurs »
 * — reste entière elle aussi, puisqu'aucun verbe ne suit ses virgules.
 */
export function decouperCommandes(phrase: string): string[] {
  const texte = nettoyerPhrase(phrase)
  if (!texte) return []
  if (TEXTE_LIBRE.test(texte)) return [texte]

  const debutCommande = `(?:${VERBE_A_PRONOM}|(?:${VERBES_FRANCS}))(?=[\\s-]|$)`
  const coupure = new RegExp(
    [
      // « puis », « ensuite », « et ensuite », « après ça » : toujours.
      `\\s*(?:,\\s*)?\\b(?:et\\s+)?(?:puis|ensuite|apr[eè]s [cç]a|apr[eè]s quoi|et apr[eè]s)\\b\\s*(?:,\\s*)?`,
      // « et » ou une virgule, devant un verbe de commande seulement.
      `\\s*(?:,\\s*(?:et\\s+)?|\\s+et\\s+)(?=${debutCommande})`,
    ].join('|'),
    'gi',
  )

  return texte
    .split(coupure)
    .map((morceau) => (morceau ?? '').trim())
    .filter((morceau) => morceau.length > 0)
    .map(nettoyerPhrase)
    .filter((morceau) => morceau.length > 0)
}
