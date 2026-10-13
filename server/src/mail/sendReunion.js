import { getSnapshot } from '../businessData.js';
import { isMailConfigured, sendMail } from './transport.js';
import { enregistrerEnvoi } from './reunionConfig.js';
import { nomFichier, renderDocument, renderMail, renderText } from './reunionReport.js';

/**
 * Envoi du rapport de réunion.
 *
 * Un seul message, à tous les destinataires en copie visible : contrairement au programme
 * du jour, qui est personnel et part donc en autant de messages que de personnes, le
 * rapport de réunion est le même pour tout le monde et les destinataires ont tout intérêt
 * à savoir qui d'autre l'a reçu — ne serait-ce que pour répondre à tous.
 *
 * Le résultat est détaillé destinataire par destinataire. Une personne sans adresse n'est
 * pas une erreur : c'est un cas normal, signalé comme tel avant et après l'envoi.
 */

/** Garde-fous sur ce qui vient du navigateur. Le contenu est déjà échappé au rendu, mais
 *  rien n'oblige un appel à être raisonnable sur les volumes. */
const MAX_DESTINATAIRES = 50;
const MAX_OBJET = 300;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function verifierPayload(payload) {
  if (!payload || typeof payload !== 'object') return 'Rapport absent de la requête.';
  const attendus = ['teamLabel', 'meteo', 'chiffres', 'points', 'semaines', 'grille'];
  for (const cle of attendus) {
    if (payload[cle] === undefined) return `Rapport incomplet : « ${cle} » manque.`;
  }
  if (!Array.isArray(payload.chiffres) || !Array.isArray(payload.points)) return 'Rapport mal formé.';
  return null;
}

/**
 * Résout la liste des destinataires : des membres de l'équipe (par identifiant, pour que
 * le navigateur n'ait pas à transmettre des adresses) et des adresses libres.
 */
export function resoudreDestinataires({ memberIds = [], adresses = [] }) {
  const { members } = getSnapshot();
  const cibles = [];

  for (const id of memberIds) {
    const m = members.find((x) => x.id === id);
    if (!m) continue;
    const email = (m.email || '').trim();
    if (!email) {
      cibles.push({ nom: m.name, email: null, statut: 'sans-adresse' });
      continue;
    }
    cibles.push({ nom: m.name, email, statut: 'a-envoyer' });
  }

  for (const brut of adresses) {
    const email = String(brut).trim();
    if (!email) continue;
    if (!EMAIL.test(email)) {
      cibles.push({ nom: email, email: null, statut: 'adresse-invalide' });
      continue;
    }
    if (cibles.some((c) => c.email && c.email.toLowerCase() === email.toLowerCase())) continue;
    cibles.push({ nom: email, email, statut: 'a-envoyer' });
  }

  return cibles.slice(0, MAX_DESTINATAIRES);
}

export async function envoyerRapportReunion({ payload, destinataires, objet, joindreDocument = true, par }) {
  if (!isMailConfigured()) {
    throw new Error("L'envoi de mail n'est pas configuré (Paramètres → Envoi de mail).");
  }
  const souci = verifierPayload(payload);
  if (souci) throw new Error(souci);

  const cibles = resoudreDestinataires(destinataires ?? {});
  const aEnvoyer = cibles.filter((c) => c.statut === 'a-envoyer');
  if (aEnvoyer.length === 0) {
    throw new Error("Aucun destinataire joignable : aucune adresse valide dans la sélection.");
  }

  const sujet = String(objet || '').trim().slice(0, MAX_OBJET) || `Réunion d'équipe — ${payload.teamLabel}`;
  const document = renderDocument(payload);

  let resultats;
  try {
    const info = await sendMail({
      to: aEnvoyer.map((c) => c.email).join(', '),
      subject: sujet,
      text: renderText(payload),
      html: renderMail(payload),
      attachments: joindreDocument
        ? [{ filename: nomFichier(payload), content: document, contentType: 'text/html; charset=utf-8' }]
        : undefined,
    });
    // Le relais peut accepter certaines adresses et en refuser d'autres dans le même
    // message : on recopie son verdict plutôt que de déclarer tout le monde servi.
    const refuses = (info.rejected || []).map((a) => String(a).toLowerCase());
    resultats = cibles.map((c) =>
      c.statut !== 'a-envoyer'
        ? { ...c, statut: c.statut }
        : refuses.includes(String(c.email).toLowerCase())
          ? { ...c, statut: 'echec', erreur: 'adresse refusée par le relais' }
          : { ...c, statut: 'envoye' }
    );
  } catch (error) {
    resultats = cibles.map((c) => (c.statut === 'a-envoyer' ? { ...c, statut: 'echec', erreur: error.message } : c));
    enregistrerEnvoi({ par, objet: sujet, destinataires: cibles.map((c) => c.email || c.nom), resultats, document });
    throw error;
  }

  const envoi = enregistrerEnvoi({
    par,
    objet: sujet,
    destinataires: cibles.map((c) => c.email || c.nom),
    resultats,
    document,
  });

  return { envoyeLe: envoi.envoyeLe, objet: sujet, resultats, piecesJointes: joindreDocument ? [nomFichier(payload)] : [] };
}
