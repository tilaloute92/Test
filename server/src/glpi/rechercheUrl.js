/**
 * Lecture des critères contenus dans l'URL d'une recherche GLPI.
 *
 * Régler un compteur en recopiant à la main des numéros de champ est un exercice où
 * l'on se trompe sans le voir : le nombre affiché est plausible, et personne ne le
 * recoupe. Le chemin fiable est l'inverse — construire la recherche dans GLPI, où l'on
 * voit les tickets qu'elle renvoie, puis copier l'adresse de la page. Les critères y
 * sont déjà, sous la forme :
 *
 *   ?criteria[0][field]=12&criteria[0][searchtype]=equals&criteria[0][value]=notold
 *     &criteria[1][link]=AND&criteria[1][criteria][0][field]=8...
 */

const CLE = /^([^[\]]+)|\[([^[\]]*)\]/g;

/** Découpe « criteria[0][criteria][1][field] » en ['criteria','0','criteria','1','field']. */
function chemin(cle) {
  const morceaux = [];
  for (const m of cle.matchAll(CLE)) morceaux.push(m[1] ?? m[2]);
  return morceaux;
}

/** Les objets dont toutes les clés sont « 0, 1, 2... » redeviennent des listes. */
function enListes(valeur) {
  if (!valeur || typeof valeur !== 'object') return valeur;
  const cles = Object.keys(valeur);
  const converti = Object.fromEntries(cles.map((c) => [c, enListes(valeur[c])]));
  const indices = cles.every((c) => /^\d+$/.test(c));
  if (!indices || cles.length === 0) return converti;
  const liste = [];
  for (const c of cles.sort((a, b) => Number(a) - Number(b))) liste.push(converti[c]);
  return liste;
}

export function criteresDepuisUrl(brut) {
  const texte = String(brut ?? '').trim();
  if (!texte) throw new Error('Collez ici l\'adresse complète d\'une recherche GLPI.');
  let params;
  try {
    // On accepte l'adresse entière comme la seule chaîne de paramètres : selon le
    // navigateur et la façon de copier, on obtient l'une ou l'autre.
    params = texte.includes('://') ? new URL(texte).searchParams : new URLSearchParams(texte.replace(/^\?/, ''));
  } catch {
    throw new Error("Cette adresse n'est pas lisible.");
  }
  const racine = {};
  for (const [cle, valeur] of params) {
    const parts = chemin(cle);
    if (parts[0] !== 'criteria') continue;
    let courant = racine;
    for (let i = 1; i < parts.length - 1; i++) {
      const p = parts[i];
      if (typeof courant[p] !== 'object' || courant[p] === null) courant[p] = {};
      courant = courant[p];
    }
    courant[parts[parts.length - 1]] = valeur;
  }
  const criteres = enListes(racine);
  if (!Array.isArray(criteres) || criteres.length === 0) {
    throw new Error("Aucun critère de recherche dans cette adresse : vérifiez que c'est bien l'URL d'une recherche GLPI, filtres appliqués.");
  }
  return criteres;
}
