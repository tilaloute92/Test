import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';

/**
 * Vérifie côté serveur le jeton d'identité (id_token) renvoyé par Microsoft
 * après une connexion SSO côté navigateur (onglet Paramètres, via MSAL). Sans
 * cette étape, "être connecté" ne reposerait que sur ce que dit le
 * navigateur — vérifiable et falsifiable par quiconque a accès à ses outils
 * de développement. Ici, la signature du jeton est vérifiée avec les clés
 * publiques de Microsoft (JWKS), et on s'assure qu'il a bien été émis pour
 * CETTE application (audience) et CET annuaire (émetteur) avant d'ouvrir une
 * session — c'est cette vérification qui rend la session "réelle".
 */

let jwks = null;
let jwksTenantId = null;

function getJwks(tenantId) {
  if (!jwks || jwksTenantId !== tenantId) {
    jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
    jwksTenantId = tenantId;
  }
  return jwks;
}

export async function verifySsoToken(idToken) {
  if (!config.entraTenantId || !config.entraClientId) {
    throw new Error("Le SSO Microsoft n'est pas configuré côté serveur (ENTRA_TENANT_ID / ENTRA_CLIENT_ID dans .env).");
  }
  const { payload } = await jwtVerify(idToken, getJwks(config.entraTenantId), {
    issuer: `https://login.microsoftonline.com/${config.entraTenantId}/v2.0`,
    audience: config.entraClientId,
  });
  return { username: payload.preferred_username || payload.email || payload.sub, name: payload.name || payload.preferred_username };
}
