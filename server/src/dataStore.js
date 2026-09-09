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

export function readJson(name, defaultValue) {
  const p = filePath(name);
  if (!fs.existsSync(p)) {
    writeJson(name, defaultValue);
    return defaultValue;
  }
  const raw = fs.readFileSync(p, 'utf8');
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

export function writeJson(name, value) {
  const target = filePath(name);
  // Fichier temporaire dans le MÊME dossier : le renommage n'est atomique qu'à l'intérieur
  // d'un même volume, ce que %TEMP% ne garantit pas sur un serveur Windows.
  const tmp = `${target}.tmp`;
  const handle = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(handle, JSON.stringify(value, null, 2));
    // Force l'écriture physique avant le renommage : sans cela, le renommage peut être
    // visible alors que le contenu ne l'est pas encore en cas de coupure d'alimentation.
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(tmp, target);
}
