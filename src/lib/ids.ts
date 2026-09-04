/**
 * Génération d'identifiants pour les données métier.
 *
 * Historique — pourquoi ce n'est pas un simple compteur : la première version utilisait
 * un compteur en mémoire (`m1000`, `m1001`...). Ce compteur repartait de zéro à chaque
 * chargement de page alors que les données, elles, sont conservées (localStorage, ou le
 * serveur en mode multi-utilisateur) : deux enregistrements créés dans deux sessions
 * différentes recevaient donc le *même* identifiant. Symptôme observé : cocher une
 * personne dans la liste des assignés en cochait une autre, les deux partageant le même id.
 *
 * Un identifiant doit donc être unique :
 * - d'un chargement de page à l'autre (d'où l'horodatage, et non un compteur) ;
 * - d'un navigateur à l'autre (d'où la partie aléatoire) — indispensable en mode
 *   multi-utilisateur, où deux collègues créent des données chacun de leur côté et où
 *   c'est le navigateur qui fixe l'identifiant (voir server/src/businessData.js).
 */

function randomSuffix(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '').slice(0, 10);
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(5);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Dernier recours (contexte non sécurisé et très ancien navigateur) : moins solide,
  // mais toujours préférable au compteur qui repartait de zéro.
  return Math.random().toString(36).slice(2, 12);
}

/**
 * Identifiant unique préfixé par type (`m` membre, `t` tâche, `cp` COPIL...). Le préfixe
 * n'a aucune valeur fonctionnelle : il rend seulement les données lisibles en débogage.
 */
export function makeId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${randomSuffix()}`;
}
