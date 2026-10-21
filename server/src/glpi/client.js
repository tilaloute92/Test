/**
 * Le protocole de l'API REST de GLPI (`apirest.php`), et rien d'autre : ni cache, ni
 * règle métier, ni notion d'équipe. Ce découpage permet d'éprouver le dialogue avec GLPI
 * indépendamment de ce qu'on en fait.
 *
 * Déroulé d'un relevé :
 *   1. initSession   — App-Token + user_token  → un Session-Token
 *   2. search/Ticket — range=0-0, donc AUCUN ticket transféré, seulement le total
 *   3. killSession   — GLPI garde sinon la session ouverte jusqu'à expiration
 */

/** GLPI derrière un reverse proxy lent reste une dépendance secondaire : on abandonne
 *  vite plutôt que de faire attendre l'écran d'accueil de quelqu'un. */
const TIMEOUT_MS = 8000;

export class GlpiError extends Error {
  constructor(message, { code = null, statut = null } = {}) {
    super(message);
    this.name = 'GlpiError';
    this.code = code;
    this.statut = statut;
  }
}

/**
 * Les erreurs de GLPI arrivent sous la forme `["ERROR_XXX", "message en clair"]`. Le
 * message en clair est souvent une phrase technique en anglais ; on traduit les cas
 * courants, parce qu'ils désignent chacun un réglage précis à corriger et que c'est
 * exactement ce que la personne qui lit a besoin de savoir.
 */
const MESSAGES = {
  ERROR_WRONG_APP_TOKEN_PARAMETER: "GLPI refuse le jeton d'application (App-Token) : vérifiez le client API et sa plage d'adresses IP autorisées.",
  ERROR_APP_TOKEN_PARAMETERS_MISSING: "GLPI attend un jeton d'application (App-Token) : créez un client API dans Configuration → Générale → API.",
  ERROR_LOGIN_PARAMETERS_MISSING: 'GLPI attend un jeton utilisateur : vérifiez la clé d\'accès distante du compte de service.',
  ERROR_GLPI_LOGIN: "GLPI refuse le compte de service : jeton utilisateur invalide, ou compte désactivé.",
  ERROR_SESSION_TOKEN_INVALID: 'La session GLPI a expiré pendant le relevé.',
  ERROR_METHOD_NOT_ALLOWED: "L'API REST de GLPI semble désactivée : Configuration → Générale → API → Activer l'API REST.",
};

function messageErreur(corps, statut) {
  const code = Array.isArray(corps) ? corps[0] : corps?.[0] ?? null;
  if (code && MESSAGES[code]) return { code, message: MESSAGES[code] };
  const detail = Array.isArray(corps) && typeof corps[1] === 'string' ? corps[1] : '';
  if (statut === 401) return { code, message: `GLPI refuse l'authentification (401)${detail ? ` — ${detail}` : ''}.` };
  if (statut === 404) return { code, message: "Adresse introuvable (404) : vérifiez que l'URL se termine bien par /apirest.php." };
  return { code, message: `GLPI a répondu ${statut}${detail ? ` — ${detail}` : code ? ` — ${code}` : ''}.` };
}

async function appel(url, headers) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  } catch (erreur) {
    if (erreur?.name === 'TimeoutError' || erreur?.name === 'AbortError') {
      throw new GlpiError(`GLPI n'a pas répondu en ${TIMEOUT_MS / 1000} s.`);
    }
    throw new GlpiError(`GLPI est injoignable — ${erreur?.cause?.code || erreur.message}.`);
  }
  const texte = await res.text();
  let corps = null;
  try {
    corps = texte ? JSON.parse(texte) : null;
  } catch {
    // Une réponse qui n'est pas du JSON vient presque toujours d'un portail
    // d'authentification ou d'une page d'erreur du reverse proxy intercalés devant GLPI.
    if (!res.ok) throw new GlpiError(`GLPI a répondu ${res.status} sans contenu exploitable.`, { statut: res.status });
    throw new GlpiError("La réponse de GLPI n'est pas du JSON : l'adresse ne pointe probablement pas sur apirest.php.");
  }
  if (!res.ok) {
    const { code, message } = messageErreur(corps, res.status);
    throw new GlpiError(message, { code, statut: res.status });
  }
  return corps;
}

export async function initSession({ url, appToken, userToken }) {
  const corps = await appel(`${url}/initSession`, {
    'App-Token': appToken,
    Authorization: `user_token ${userToken}`,
  });
  const jeton = corps?.session_token;
  if (!jeton) throw new GlpiError("GLPI n'a pas renvoyé de jeton de session.");
  return { url, appToken, sessionToken: jeton };
}

export async function killSession(session) {
  if (!session) return;
  try {
    await appel(`${session.url}/killSession`, enTetes(session));
  } catch {
    // Fermer la session est une politesse, pas une étape du relevé : si elle échoue, GLPI
    // la laissera expirer seul. Faire remonter cette erreur masquerait le résultat obtenu.
  }
}

function enTetes(session) {
  return { 'App-Token': session.appToken, 'Session-Token': session.sessionToken };
}

/**
 * Sérialisation des critères de recherche au format attendu par GLPI :
 *   criteria[0][field]=12&criteria[0][searchtype]=equals&criteria[0][value]=notold
 * Les groupes (`criteria` imbriqués) servent à parenthéser une recherche enregistrée
 * avant de lui ajouter notre propre filtre — sans quoi un « OU » de l'utilisateur
 * absorberait le « ET » que nous ajoutons et le compteur compterait autre chose.
 */
export function serialiserCriteres(criteres, prefixe = 'criteria') {
  const params = [];
  criteres.forEach((critere, i) => {
    const base = `${prefixe}[${i}]`;
    // Le premier critère n'a pas de lien : GLPI l'ignore, mais certaines versions le
    // recopient dans la requête SQL et produisent un « WHERE AND ».
    if (i > 0 && critere.link) params.push([`${base}[link]`, critere.link]);
    if (Array.isArray(critere.criteria)) {
      params.push(...serialiserCriteres(critere.criteria, `${base}[criteria]`));
      return;
    }
    params.push([`${base}[field]`, String(critere.field)]);
    params.push([`${base}[searchtype]`, critere.searchtype ?? 'equals']);
    params.push([`${base}[value]`, String(critere.value ?? '')]);
  });
  return params;
}

/**
 * Combine les critères de l'équipe et un filtre supplémentaire. Le groupe est le point
 * important : voir le commentaire de `serialiserCriteres`.
 */
export function avecFiltre(criteres, filtre) {
  const base = criteres.length > 1 ? [{ criteria: criteres }] : criteres;
  return [...base, { link: 'AND', ...filtre }];
}

/**
 * Nombre de tickets répondant aux critères. `range=0-0` : on demande la première page la
 * plus courte possible, GLPI renvoie quand même `totalcount`. Aucun ticket n'est
 * transféré — ni titre, ni demandeur, ni description.
 */
export async function compter(session, criteres, itemtype = 'Ticket') {
  const params = new URLSearchParams([
    ['is_deleted', '0'],
    ['range', '0-0'],
    ...serialiserCriteres(criteres),
  ]);
  try {
    const corps = await appel(`${session.url}/search/${itemtype}?${params}`, enTetes(session));
    const total = Number(corps?.totalcount);
    return Number.isFinite(total) ? total : 0;
  } catch (erreur) {
    // GLPI répond 400 ERROR_RANGE_EXCEED_TOTAL quand la plage demandée dépasse le nombre
    // de résultats — c'est-à-dire, avec range=0-0, quand il n'y en a AUCUN. Zéro ticket
    // est un résultat, pas une panne : sans ce cas, une file vide afficherait une erreur.
    if (erreur instanceof GlpiError && erreur.code === 'ERROR_RANGE_EXCEED_TOTAL') return 0;
    throw erreur;
  }
}

/**
 * L'identifiant GLPI d'un compte, à partir de son identifiant de connexion. Nécessaire
 * parce que la recherche par technicien attribué attend un identifiant numérique, pas un
 * login. `searchText` filtre en « contient » : on exige ensuite l'égalité exacte, pour
 * que « dupont » ne compte pas les tickets de « dupont-martin ».
 */
export async function identifiantUtilisateur(session, login) {
  const params = new URLSearchParams([
    ['range', '0-19'],
    ['searchText[name]', login],
  ]);
  const corps = await appel(`${session.url}/User?${params}`, enTetes(session));
  const liste = Array.isArray(corps) ? corps : [];
  const exact = liste.find((u) => String(u?.name ?? '').toLowerCase() === login.toLowerCase());
  return exact ? Number(exact.id) : null;
}
