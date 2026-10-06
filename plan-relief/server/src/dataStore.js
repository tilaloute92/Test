import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

/**
 * Stockage sur disque des données du service : comptes locaux, configuration LDAP,
 * et surtout la bibliothèque de plans (fichiers d'origine + équipements).
 *
 * Ces fichiers sont la SOURCE DE VÉRITÉ : c'est le seul exemplaire des plans de toute
 * l'équipe. Deux conséquences sur la façon d'écrire et de lire :
 *
 * 1. Écriture atomique. Un `writeFileSync` direct sur le fichier définitif laisse, si le
 *    serveur est arrêté ou la machine coupée pendant l'écriture, un fichier tronqué. On
 *    écrit donc dans un fichier temporaire puis on le renomme : le renommage est atomique,
 *    le fichier définitif est toujours soit l'ancienne version complète, soit la nouvelle.
 *
 * 2. Lecture stricte. Si un fichier existe mais ne se relit pas (corruption, édition
 *    manuelle malheureuse), on REFUSE de démarrer plutôt que de repartir d'une valeur par
 *    défaut. Un service qui démarre avec une bibliothèque vide ressemble à un service qui
 *    fonctionne ; un service arrêté avec un message clair force la restauration de la
 *    sauvegarde, ce qui est le bon comportement.
 */

export const dataDir = config.dataDir
  ? path.resolve(config.dataDir)
  : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export function dataPath(...parts) {
  return path.join(dataDir, ...parts);
}

export function readJson(name, defaultValue) {
  const p = dataPath(name);
  if (!fs.existsSync(p)) {
    writeJson(name, defaultValue);
    return defaultValue;
  }
  return readJsonStrict(p);
}

/** Lit un fichier JSON existant ; s'il est illisible, lève une erreur qui nomme le fichier. */
export function readJsonStrict(p) {
  const raw = fs.readFileSync(p, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Le fichier de données ${p} est illisible (${err.message}).\n` +
        `Le service refuse de démarrer pour ne pas repartir d'une base vide et faire croire à une perte de données normale.\n` +
        `Restaurez ce fichier depuis la sauvegarde, puis redémarrez le service.`
    );
  }
}

export function writeJson(name, value) {
  writeFileAtomic(dataPath(name), JSON.stringify(value, null, 2));
}

export function writeFileAtomic(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Fichier temporaire dans le MÊME dossier : le renommage n'est atomique qu'à l'intérieur
  // d'un même volume, ce que %TEMP% ne garantit pas sur un serveur Windows.
  const tmp = `${target}.tmp`;
  const handle = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(handle, content);
    // Force l'écriture physique avant le renommage : sans cela, le renommage peut être
    // visible alors que le contenu ne l'est pas encore en cas de coupure d'alimentation.
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(tmp, target);
}

/**
 * Compteur de version global, incrémenté à chaque écriture de la bibliothèque. Il sert de
 * témoin au script de sauvegarde (Backup-PlanRelief.ps1) : s'il a bougé pendant la copie,
 * la copie est refaite, pour ne jamais sauvegarder un plan à moitié écrit.
 */
export function bumpDataVersion() {
  const meta = readJson('meta.json', { version: 0 });
  meta.version = (Number(meta.version) || 0) + 1;
  meta.updatedAt = new Date().toISOString();
  writeJson('meta.json', meta);
  return meta.version;
}
