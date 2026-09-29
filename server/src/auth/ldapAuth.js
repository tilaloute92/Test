import { Client } from 'ldapts';
import { readJson, writeJson } from '../dataStore.js';

const FILE = 'config.json';
const CLE = 'ldap';

/**
 * Authentification Active Directory / LDAP.
 *
 * Le mot de passe n'est jamais stocké ni comparé ici : on tente une connexion (« bind »)
 * auprès du contrôleur de domaine avec les identifiants saisis, et c'est lui qui répond.
 * Ce service ne voit le mot de passe qu'en transit.
 *
 * Deux façons de retrouver la personne dans l'annuaire, parce qu'aucune ne suffit seule :
 *
 *   - MOTIF (« pattern ») : le DN se déduit de l'identifiant saisi, typiquement l'UPN
 *     `{username}@monentreprise.local`. Aucun compte de service nécessaire. Mais impose à
 *     chacun de taper son identifiant sous cette forme exacte.
 *   - RECHERCHE (« search ») : un compte de service interroge l'annuaire pour trouver le DN
 *     à partir de n'importe quel attribut, le plus souvent `sAMAccountName` — l'identifiant
 *     Windows court, celui que les gens connaissent. C'est ce que demandent la plupart des
 *     déploiements AD, et c'est le seul mode qui permet aussi de restreindre l'accès à un
 *     groupe.
 */

const defautLdap = {
  enabled: false,
  // ex : "ldap://dc01.monentreprise.local:389" ou "ldaps://dc01.monentreprise.local:636"
  url: '',
  mode: 'pattern',

  // --- mode MOTIF ---
  userDnPattern: '{username}@monentreprise.local',

  // --- mode RECHERCHE ---
  /** Où chercher : "DC=monentreprise,DC=local" ou une OU précise. */
  baseDN: '',
  /** Filtre de recherche ; {username} est remplacé par la saisie, échappée. */
  userFilter: '(sAMAccountName={username})',
  /** Compte de service en lecture seule. Vide = recherche anonyme (rarement permise par AD). */
  bindDN: '',
  bindPassword: '',

  // --- commun ---
  /** Attribut d'où vient le nom affiché dans l'application. Sans lui, l'application
   *  afficherait l'identifiant de connexion partout au lieu du nom de la personne. */
  displayNameAttribute: 'displayName',
  mailAttribute: 'mail',
  /** DN (ou simple nom) d'un groupe dont l'appartenance est exigée. Vide = tout compte
   *  valide de l'annuaire peut entrer, ce qui est rarement ce qu'on veut sur un AD
   *  d'entreprise où figurent aussi les prestataires et les comptes de service. */
  requiredGroup: '',
  /** À décocher pour un certificat LDAPS émis par une autorité interne non reconnue par
   *  le serveur. Sans cette option, un AD parfaitement configuré en interne restait
   *  inutilisable en ldaps:// sans aucun moyen de contournement. */
  tlsRejectUnauthorized: true,
  timeoutMs: 5000,
};

/** Champs jamais renvoyés au navigateur. */
const SECRETS = ['bindPassword'];

function lireBrut() {
  const tout = readJson(FILE, {});
  // Compatibilité : les premières versions écrivaient la configuration LDAP à plat, à la
  // racine de config.json. On la relit telle quelle plutôt que de la perdre.
  const heritage = tout.url !== undefined || tout.userDnPattern !== undefined;
  const stocke = tout[CLE] ?? (heritage ? { enabled: tout.enabled, url: tout.url, userDnPattern: tout.userDnPattern } : {});
  return { ...defautLdap, ...Object.fromEntries(Object.entries(stocke).filter(([, v]) => v !== undefined)) };
}

/** Configuration complète, secrets compris — usage serveur uniquement. */
export function getLdapConfig() {
  return lireBrut();
}

/** Ce qui peut être montré au navigateur : le mot de passe de service est remplacé par un
 *  simple indicateur de présence, pour qu'on sache qu'il est renseigné sans le divulguer. */
export function getPublicLdapConfig() {
  const cfg = lireBrut();
  const publique = { ...cfg };
  for (const s of SECRETS) delete publique[s];
  return { ...publique, bindPasswordSet: Boolean(cfg.bindPassword) };
}

export function setLdapConfig(patch) {
  const courant = lireBrut();
  const suivant = { ...courant, ...patch };
  // Un champ secret absent ou vide dans la mise à jour CONSERVE la valeur en place : le
  // navigateur ne reçoit jamais le mot de passe, il ne peut donc pas le renvoyer, et
  // enregistrer un autre réglage l'effacerait silencieusement.
  for (const s of SECRETS) {
    if (patch[s] === undefined || patch[s] === '') suivant[s] = courant[s];
    else if (patch[s] === null) suivant[s] = ''; // null = effacement demandé explicitement
  }
  const tout = readJson(FILE, {});
  writeJson(FILE, { ...tout, [CLE]: suivant });
  return getPublicLdapConfig();
}

/**
 * Échappement RFC 4515. Sans lui, un identifiant contenant `*)(uid=*` transformerait le
 * filtre en une requête toute différente — l'équivalent LDAP d'une injection SQL.
 */
function escapeFilter(valeur) {
  return String(valeur).replace(/[\\*()\0/]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

function nouveauClient(cfg) {
  return new Client({
    url: cfg.url,
    connectTimeout: cfg.timeoutMs,
    timeout: cfg.timeoutMs,
    tlsOptions: cfg.url.startsWith('ldaps://') ? { rejectUnauthorized: cfg.tlsRejectUnauthorized !== false } : undefined,
  });
}

/**
 * Lecture d'attribut insensible à la casse.
 *
 * Les annuaires ne s'accordent pas sur la casse des noms d'attributs qu'ils renvoient :
 * Active Directory rend « displayName », d'autres « displayname ». Une lecture par clé
 * exacte marchait donc chez les uns et échouait silencieusement chez les autres — sans
 * erreur, juste l'identifiant de connexion affiché partout à la place du nom, et une
 * restriction par groupe qui refuse tout le monde parce qu'elle ne voit jamais memberOf.
 */
function litAttribut(entree, attribut) {
  if (!entree || !attribut) return undefined;
  if (entree[attribut] !== undefined) return entree[attribut];
  const voulu = attribut.toLowerCase();
  const cle = Object.keys(entree).find((k) => k.toLowerCase() === voulu);
  return cle ? entree[cle] : undefined;
}

function premiereValeur(entree, attribut) {
  const v = litAttribut(entree, attribut);
  if (v === undefined || v === null) return '';
  return Array.isArray(v) ? String(v[0] ?? '') : String(v);
}

/** Appartenance à un groupe, tolérante sur la forme : DN complet ou simple nom de groupe.
 *  Un administrateur qui tape « Techniciens Infra » plutôt que le DN complet a raison de
 *  s'attendre à ce que cela marche. */
function appartientAuGroupe(memberOf, attendu) {
  const voulu = attendu.trim().toLowerCase();
  if (!voulu) return true;
  const groupes = Array.isArray(memberOf) ? memberOf : memberOf ? [memberOf] : [];
  return groupes.some((dn) => {
    const s = String(dn).toLowerCase();
    if (s === voulu) return true;
    const cn = s.match(/^cn=([^,]+)/)?.[1];
    return cn === voulu || cn === voulu.replace(/^cn=/, '');
  });
}

/**
 * Résout le DN de la personne. Renvoie { dn, entry } ou null si introuvable.
 * En mode motif, aucune recherche n'est faite : le DN est déduit, et l'entrée reste vide
 * jusqu'à ce qu'on puisse la lire avec la session de la personne elle-même.
 */
async function resoudreDn(cfg, username, journal) {
  if (cfg.mode !== 'search') {
    const dn = cfg.userDnPattern.replace('{username}', username);
    journal?.push({ etape: 'dn', ok: true, detail: `DN déduit du motif : ${dn}` });
    return { dn, entry: null };
  }

  if (!cfg.baseDN) throw new Error("Mode recherche : la base de recherche (baseDN) n'est pas renseignée.");
  const client = nouveauClient(cfg);
  try {
    if (cfg.bindDN) {
      await client.bind(cfg.bindDN, cfg.bindPassword);
      journal?.push({ etape: 'service', ok: true, detail: `Compte de service connecté (${cfg.bindDN})` });
    } else {
      journal?.push({ etape: 'service', ok: true, detail: 'Recherche anonyme (aucun compte de service)' });
    }
    const filtre = cfg.userFilter.replace('{username}', escapeFilter(username));
    const { searchEntries } = await client.search(cfg.baseDN, {
      filter: filtre,
      scope: 'sub',
      attributes: [cfg.displayNameAttribute, cfg.mailAttribute, 'memberOf', 'dn'],
    });
    if (searchEntries.length === 0) {
      journal?.push({ etape: 'recherche', ok: false, detail: `Aucune entrée pour ${filtre} sous ${cfg.baseDN}` });
      return null;
    }
    journal?.push({ etape: 'recherche', ok: true, detail: `Trouvé : ${searchEntries[0].dn}` });
    return { dn: searchEntries[0].dn, entry: searchEntries[0] };
  } finally {
    await client.unbind().catch(() => {});
  }
}

/**
 * Vérifie un couple identifiant / mot de passe.
 * Renvoie { username, name, email } si valide, null si les identifiants sont refusés,
 * et lève une erreur si l'annuaire est injoignable ou mal configuré — la distinction
 * compte : afficher « mot de passe incorrect » sur une panne réseau envoie toute l'équipe
 * ressaisir un mot de passe qui était bon.
 */
export async function verifyLdapLogin(username, password, journal) {
  const cfg = getLdapConfig();
  if (!cfg.enabled || !cfg.url) {
    throw new Error("L'authentification LDAP n'est pas configurée (onglet Paramètres).");
  }
  if (!password) return null; // un bind LDAP avec mot de passe vide réussit en « anonyme »

  const resolu = await resoudreDn(cfg, username, journal);
  if (!resolu) return null;

  const client = nouveauClient(cfg);
  try {
    await client.bind(resolu.dn, password);
    journal?.push({ etape: 'bind', ok: true, detail: 'Mot de passe accepté par le contrôleur de domaine' });

    // Lecture des attributs avec la session de la personne : pas besoin d'un compte de
    // service en mode motif, et cela reflète exactement ce qu'elle a le droit de lire.
    let entry = resolu.entry;
    if (!entry) {
      try {
        const { searchEntries } = await client.search(resolu.dn, {
          scope: 'base',
          filter: '(objectClass=*)',
          attributes: [cfg.displayNameAttribute, cfg.mailAttribute, 'memberOf'],
        });
        entry = searchEntries[0] ?? null;
      } catch {
        // Annuaire qui refuse la lecture de sa propre entrée : on continue sans le nom
        // plutôt que de refuser une connexion par ailleurs valide.
        entry = null;
      }
    }

    if (cfg.requiredGroup) {
      const memberOf = litAttribut(entry, 'memberOf');
      const membre = appartientAuGroupe(memberOf, cfg.requiredGroup);
      // Distinguer « pas membre » de « l'annuaire ne dit pas de quoi il est membre » :
      // les deux refusent l'accès, mais la seconde n'est pas un problème de droits et se
      // corrige côté annuaire, pas côté application. Sans cette nuance, on cherche
      // longtemps pourquoi un compte manifestement membre du groupe est refusé.
      // Attribut absent OU renvoyé vide : dans les deux cas l'annuaire ne nous a rien
      // appris, et c'est une cause de refus toute différente d'une vraie non-appartenance.
      const inconnu = memberOf === undefined || (Array.isArray(memberOf) && memberOf.length === 0);
      journal?.push({
        etape: 'groupe',
        ok: membre,
        detail: membre
          ? `Membre de ${cfg.requiredGroup}`
          : inconnu
            ? `L'annuaire n'a renvoyé aucun attribut memberOf pour ce compte : l'appartenance au groupe « ${cfg.requiredGroup} » ne peut pas être vérifiée, l'accès est donc refusé. Vérifiez que le compte de service a le droit de lire memberOf, ou laissez le groupe vide.`
            : `NON membre de ${cfg.requiredGroup} — accès refusé`,
      });
      if (!membre) return null;
    }

    const name = premiereValeur(entry, cfg.displayNameAttribute) || username;
    const email = premiereValeur(entry, cfg.mailAttribute) || undefined;
    journal?.push({ etape: 'attributs', ok: true, detail: `Nom affiché : ${name}${email ? ` · ${email}` : ''}` });
    return { username, name, email };
  } catch (err) {
    // 49 = identifiants invalides. Toute autre erreur est une panne, pas un refus.
    if (err?.code === 49) {
      journal?.push({ etape: 'bind', ok: false, detail: 'Identifiants refusés par le contrôleur de domaine (code 49)' });
      return null;
    }
    throw new Error(`Connexion au serveur LDAP impossible : ${err.message}`);
  } finally {
    await client.unbind().catch(() => {});
  }
}

/**
 * Test de bout en bout depuis la page Paramètres, en nommant l'étape qui échoue.
 *
 * Un simple « ça ne marche pas » obligeait jusqu'ici à se déconnecter pour essayer, sans
 * savoir si le problème venait de l'URL, du certificat, du compte de service, du filtre ou
 * du groupe. Chaque étape est donc renvoyée séparément.
 */
export async function testLdap({ username, password }) {
  const cfg = getLdapConfig();
  const journal = [];
  if (!cfg.url) return { ok: false, journal: [{ etape: 'url', ok: false, detail: "Aucune URL de contrôleur de domaine renseignée." }] };

  // 1. Joignabilité, avant toute autre chose : c'est la panne la plus fréquente, et elle
  //    rend tout le reste du diagnostic trompeur.
  const client = nouveauClient(cfg);
  try {
    await client.bind(cfg.bindDN || '', cfg.bindDN ? cfg.bindPassword : '');
    journal.push({ etape: 'connexion', ok: true, detail: `Serveur ${cfg.url} joignable` });
  } catch (err) {
    if (err?.code === 49 && cfg.bindDN) {
      journal.push({ etape: 'connexion', ok: true, detail: `Serveur ${cfg.url} joignable` });
      journal.push({ etape: 'service', ok: false, detail: `Compte de service refusé (${cfg.bindDN}) : identifiants invalides` });
      return { ok: false, journal };
    }
    const indice = /self.signed|unable to verify|certificate/i.test(err.message)
      ? " — certificat non reconnu : décochez « Vérifier le certificat » si votre autorité est interne."
      : '';
    journal.push({ etape: 'connexion', ok: false, detail: `${err.message}${indice}` });
    return { ok: false, journal };
  } finally {
    await client.unbind().catch(() => {});
  }

  if (!username || !password) {
    journal.push({ etape: 'identifiants', ok: true, detail: 'Aucun identifiant fourni : test de connexion seul.' });
    return { ok: true, journal };
  }

  try {
    const user = await verifyLdapLogin(username, password, journal);
    if (!user) {
      // Le journal dit déjà laquelle des trois étapes a refusé (recherche, bind, groupe).
      return { ok: false, journal };
    }
    return { ok: true, user, journal };
  } catch (err) {
    journal.push({ etape: 'erreur', ok: false, detail: err.message });
    return { ok: false, journal };
  }
}
