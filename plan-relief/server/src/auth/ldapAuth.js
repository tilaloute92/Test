import { Client } from 'ldapts';
import { readJson, writeJson } from '../dataStore.js';

const FILE = 'config.json';

const defaultLdapConfig = {
  enabled: false,
  // ex: "ldap://dc01.monentreprise.local:389" ou "ldaps://dc01.monentreprise.local:636"
  url: '',
  // Motif utilisé pour construire le DN à partir du nom saisi par
  // l'utilisateur. "{username}" est remplacé par ce qui est tapé dans le
  // champ identifiant. Exemples courants :
  //   "{username}@monentreprise.local"        (UPN Active Directory — le plus simple)
  //   "CN={username},OU=Utilisateurs,DC=monentreprise,DC=local"
  userDnPattern: '{username}@monentreprise.local',
};

export function getLdapConfig() {
  return readJson(FILE, defaultLdapConfig);
}

export function setLdapConfig(patch) {
  const current = getLdapConfig();
  const next = { ...current, ...patch };
  writeJson(FILE, next);
  return next;
}

/**
 * Authentifie en tentant un "bind" LDAP avec les identifiants fournis — c'est
 * la manière standard et la plus sûre de vérifier un mot de passe Active
 * Directory : le serveur LDAP fait la vérification lui-même, ce service ne
 * voit le mot de passe qu'en transit (jamais stocké) et se contente de
 * relayer la question "ce mot de passe est-il correct pour ce compte ?".
 */
export async function verifyLdapLogin(username, password) {
  const cfg = getLdapConfig();
  if (!cfg.enabled || !cfg.url) {
    throw new Error("L'authentification LDAP n'est pas configurée (onglet Paramètres).");
  }
  const client = new Client({ url: cfg.url, connectTimeout: 5000, timeout: 5000 });
  const dn = cfg.userDnPattern.replace('{username}', username);
  try {
    await client.bind(dn, password);
    return { username, name: username };
  } catch (err) {
    // Un refus d'authentification (mauvais mot de passe) et une panne réseau
    // remontent toutes deux comme une erreur ici : on distingue les deux via le
    // code d'erreur LDAP (49 = identifiants invalides) plutôt que de traiter
    // toute erreur comme "mot de passe incorrect", ce qui masquerait une vraie
    // panne de service.
    if (err?.code === 49) return null;
    throw new Error(`Connexion au serveur LDAP impossible : ${err.message}`);
  } finally {
    await client.unbind().catch(() => {});
  }
}
