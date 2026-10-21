import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Stockage sur disque des données du serveur (comptes locaux et données d'équipe).
 *
 * En mode client/serveur, ces fichiers sont la SOURCE DE VÉRITÉ : ce n'est plus une copie
 * de commodité de ce qu'un navigateur détient déjà, mais le seul exemplaire du travail de
 * toute l'équipe. Deux conséquences sur la façon d'écrire et de lire :
 *
 * 1. Écriture atomique. Un `writeFileSync` direct sur le fichier définitif laisse, si le
 *    serveur est arrêté ou la machine coupée pendant l'écriture, un fichier tronqué —
 *    c'est-à-dire une collection entière perdue. On écrit donc dans un fichier temporaire
 *    puis on le renomme : le renommage est atomique, le fichier définitif est toujours
 *    soit l'ancienne version complète, soit la nouvelle, jamais un état intermédiaire.
 *
 * 2. Lecture stricte. Si un fichier existe mais ne se relit pas (corruption, édition
 *    manuelle malheureuse), on REFUSE de démarrer plutôt que de repartir d'une valeur par
 *    défaut. Un service qui démarre en affichant une équipe vide ressemble à un service qui
 *    fonctionne, et l'équipe travaillerait par-dessus le vide avant que personne ne
 *    s'aperçoive de la perte. Un service arrêté avec un message clair force la restauration
 *    de la sauvegarde, ce qui est le bon comportement.
 */

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function filePath(name) {
  return path.join(dataDir, name);
}

/**
 * Le dossier des données d'une équipe : `data/equipes/<identifiant>/`.
 *
 * C'est ICI que se joue le cloisonnement du multi-équipe. Deux équipes n'écrivent jamais
 * dans le même fichier : aucun filtre oublié ne peut donc faire apparaître les lignes de
 * l'une chez l'autre, parce qu'il n'existe aucun fichier où elles se croiseraient. La
 * seule faute possible est de se tromper d'identifiant — un point unique, qu'on peut
 * éprouver sérieusement, là où un filtre par colonne en aurait semé cinquante.
 *
 * L'identifiant est vérifié comme un nom de fichier, et non supposé propre : il finit
 * dans un chemin, et « ../../users » y arriverait aussi bien que « infra » s'il n'était
 * pas contrôlé.
 */
function dossierEquipe(equipe) {
  const id = nomSimple(String(equipe ?? ''));
  const p = path.join(dataDir, 'equipes', id);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

export function readJsonEquipe(equipe, name, defaultValue) {
  const p = path.join(dossierEquipe(equipe), nomSimple(name));
  if (!fs.existsSync(p)) {
    writeJsonEquipe(equipe, name, defaultValue);
    return defaultValue;
  }
  return parseOuRefuse(fs.readFileSync(p, 'utf8'), p);
}

export function writeJsonEquipe(equipe, name, value) {
  ecrireAtomique(path.join(dossierEquipe(equipe), nomSimple(name)), JSON.stringify(value, null, 2));
}

/** Les identifiants d'équipe ayant un dossier sur le disque. Sert à la migration et aux
 *  planificateurs, qui doivent balayer les équipes sans passer par le registre. */
export function dossiersEquipes() {
  const racine = path.join(dataDir, 'equipes');
  if (!fs.existsSync(racine)) return [];
  return fs
    .readdirSync(racine, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/** Déplace un fichier de la racine des données vers le dossier d'une équipe. Sert une
 *  seule fois, à la migration depuis la disposition mono-équipe. */
export function deplacerVersEquipe(name, equipe) {
  const source = filePath(name);
  if (!fs.existsSync(source)) return false;
  fs.renameSync(source, path.join(dossierEquipe(equipe), nomSimple(name)));
  return true;
}

export function readJson(name, defaultValue) {
  const p = filePath(name);
  if (!fs.existsSync(p)) {
    writeJson(name, defaultValue);
    return defaultValue;
  }
  return parseOuRefuse(fs.readFileSync(p, 'utf8'), p);
}

function parseOuRefuse(raw, p) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Le fichier de données ${p} est illisible (${err.message}).\n` +
        `Le serveur refuse de démarrer pour ne pas repartir d'une base vide et faire croire à une perte de données normale.\n` +
        `Restaurez ce fichier depuis la sauvegarde, puis redémarrez le service.`
    );
  }
}

/**
 * Lecture/écriture d'un fichier texte du dossier de données, pour ce qui n'est pas du
 * JSON de configuration : aujourd'hui les documents de rapport conservés, qui pèsent
 * ~35 Ko pièce. Les loger dans config.json faisait un fichier d'un mégaoctet, relu et
 * reparsé à CHAQUE contrôle de droit administrateur, et réécrit en entier à chaque
 * changement de réglage.
 *
 * `nom` est composé par l'appelant à partir d'un identifiant qu'il a lui-même produit,
 * jamais d'une entrée réseau ; la vérification ci-dessous le garantit plutôt que de
 * l'espérer.
 */
function nomSimple(name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) {
    throw new Error(`Nom de fichier refusé : ${name}`);
  }
  return name;
}

export function readText(name, defaultValue = null) {
  const p = filePath(nomSimple(name));
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : defaultValue;
}

export function writeText(name, contenu) {
  ecrireAtomique(filePath(nomSimple(name)), contenu);
}

export function removeText(name) {
  const p = filePath(nomSimple(name));
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function writeJson(name, value) {
  ecrireAtomique(filePath(name), JSON.stringify(value, null, 2));
}

function ecrireAtomique(target, contenu) {
  // Fichier temporaire dans le MÊME dossier : le renommage n'est atomique qu'à l'intérieur
  // d'un même volume, ce que %TEMP% ne garantit pas sur un serveur Windows.
  const tmp = `${target}.tmp`;
  const handle = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(handle, contenu);
    // Force l'écriture physique avant le renommage : sans cela, le renommage peut être
    // visible alors que le contenu ne l'est pas encore en cas de coupure d'alimentation.
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(tmp, target);
}
