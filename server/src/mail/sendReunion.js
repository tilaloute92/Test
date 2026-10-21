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

/**
 * Longueur maximale d'un champ de texte libre du rapport. Les notes du journal sont le
 * seul champ réellement long ; 20 000 caractères laissent largement la place d'une note
 * détaillée tout en bornant ce qu'un appel peut faire écrire dans un document conservé.
 */
const MAX_TEXTE = 20_000;
const MAX_ELEMENTS = 500;

/** Une couleur et rien d'autre. */
const COULEUR = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Normalise une couleur venue du navigateur avant qu'elle n'entre dans un attribut
 * `style`. L'échappement HTML empêche de sortir de l'attribut — il n'y a donc pas de XSS —
 * mais pas d'y écrire du CSS : `red;background-image:url(https://ailleurs/x)` ferait
 * appeler un serveur extérieur par chaque lecteur du rapport, y compris dans le document
 * conservé et re-servi par /api/mail/rapport-reunion/envois/:id. On n'accepte donc qu'une
 * notation hexadécimale, et à défaut un gris neutre : une couleur fausse est un détail,
 * un appel sortant non.
 */
export function couleurSure(valeur, defaut = '#94a3b8') {
  return typeof valeur === 'string' && COULEUR.test(valeur.trim()) ? valeur.trim() : defaut;
}

function tailleTexte(valeur, chemin, souci) {
  if (typeof valeur === 'string' && valeur.length > MAX_TEXTE) souci.push(`« ${chemin} » dépasse ${MAX_TEXTE} caractères.`);
}

/**
 * Contrôle de ce qui arrive du navigateur. Ce n'était auparavant qu'un test de présence
 * sur six clés : tout le reste passait sans que ni le type ni la taille ne soient
 * regardés, si bien qu'un rapport malformé produisait une erreur 500 au rendu plutôt
 * qu'un refus net, et qu'une chaîne de n'importe quelle longueur finissait dans un
 * document conservé sur le serveur.
 *
 * Le contenu reste échappé au rendu : ceci borne et typage, cela empêche l'injection. Les
 * deux sont nécessaires.
 */
export function verifierPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'Rapport absent de la requête.';

  const attendus = ['teamLabel', 'meteo', 'chiffres', 'points', 'semaines', 'grille'];
  for (const cle of attendus) {
    if (payload[cle] === undefined) return `Rapport incomplet : « ${cle} » manque.`;
  }

  const tableaux = ['chiffres', 'points', 'incidents', 'resolus', 'projets', 'retards', 'semaines', 'absences', 'charge'];
  for (const cle of tableaux) {
    const v = payload[cle];
    if (v === undefined) continue;
    if (!Array.isArray(v)) return `Rapport mal formé : « ${cle} » devrait être une liste.`;
    if (v.length > MAX_ELEMENTS) return `Rapport mal formé : « ${cle} » dépasse ${MAX_ELEMENTS} éléments.`;
  }

  if (typeof payload.meteo !== 'object' || payload.meteo === null) return 'Rapport mal formé : « meteo » devrait être un objet.';
  if (typeof payload.grille !== 'object' || payload.grille === null) return 'Rapport mal formé : « grille » devrait être un objet.';

  // Les notes voyagent avec leur ligne (incidents, projets, retards) plus un recueil.
  const souci = [];
  const verifierGroupes = (groupes, ou) => {
    if (groupes === undefined) return null;
    if (!Array.isArray(groupes)) return `Rapport mal formé : « ${ou} » devrait être une liste.`;
    if (groupes.length > MAX_ELEMENTS) return `Rapport mal formé : « ${ou} » dépasse ${MAX_ELEMENTS} sujets.`;
    for (const g of groupes) {
      if (!g || typeof g !== 'object' || !Array.isArray(g.lignes)) {
        return `Rapport mal formé : un sujet de « ${ou} » n'a pas de lignes.`;
      }
      if (g.lignes.length > MAX_ELEMENTS) return 'Rapport mal formé : trop de notes sur un même sujet.';
      tailleTexte(g.titre, `${ou}.titre`, souci);
      for (const n of g.lignes) tailleTexte(n?.texte, `${ou}.texte`, souci);
    }
    return null;
  };

  for (const [cle, ou] of [
    ['incidents', 'incidents[].notes'],
    ['projets', 'projets[].notes'],
    ['retards', 'retards[].notes'],
  ]) {
    for (const ligne of payload[cle] ?? []) {
      const mauvais = verifierGroupes(ligne?.notes, ou);
      if (mauvais) return mauvais;
    }
  }
  const mauvaisRecueil = verifierGroupes(payload.notesRecueil, 'notesRecueil');
  if (mauvaisRecueil) return mauvaisRecueil;
  if (souci.length > 0) return souci[0];

  return null;
}

/**
 * Remplace toutes les couleurs du rapport par des couleurs sûres. Fait ici, en un seul
 * endroit, plutôt que dans chaque fonction de rendu : une teinte oubliée dans un coin du
 * document est précisément ce qui passe inaperçu.
 */
export function assainirPayload(payload) {
  const p = { ...payload };
  const liste = (v) => (Array.isArray(v) ? v : []);

  p.incidents = liste(p.incidents).map((i) => ({ ...i, couleur: couleurSure(i.couleur, '#b91c1c') }));
  p.projets = liste(p.projets).map((pr) => ({ ...pr, couleurEtat: couleurSure(pr.couleurEtat, '#16a34a') }));
  p.retards = liste(p.retards).map((t) => ({ ...t, couleurNature: couleurSure(t.couleurNature) }));
  p.charge = liste(p.charge).map((c) => ({ ...c, couleur: couleurSure(c.couleur, '#16a34a') }));
  p.absences = liste(p.absences).map((a) => ({ ...a, couleur: couleurSure(a.couleur) }));
  p.semaines = liste(p.semaines).map((s) => ({
    ...s,
    sujets: liste(s.sujets).map((x) => ({ ...x, couleurNature: couleurSure(x.couleurNature) })),
  }));
  if (p.grille && typeof p.grille === 'object') {
    p.grille = {
      ...p.grille,
      legende: liste(p.grille.legende).map((c) => ({ ...c, couleur: couleurSure(c.couleur) })),
      lignes: liste(p.grille.lignes).map((l) => ({
        ...l,
        cases: liste(l.cases).map((c) => (c && typeof c === 'object' ? { ...c, couleur: c.couleur ? couleurSure(c.couleur) : c.couleur } : c)),
      })),
    };
  }
  // Les notes voyagent maintenant AVEC leur ligne : il faut donc assainir les couleurs à
  // l'intérieur de chaque incident, de chaque projet et de chaque retard, en plus du
  // recueil. Une teinte oubliée dans un coin est précisément ce qui passe inaperçu.
  const notesSures = (v) => liste(v).map((g) => ({ ...g, couleur: couleurSure(g.couleur) }));
  p.incidents = p.incidents.map((i) => ({ ...i, notes: notesSures(i.notes) }));
  p.projets = p.projets.map((pr) => ({ ...pr, notes: notesSures(pr.notes) }));
  p.retards = p.retards.map((t) => ({ ...t, notes: notesSures(t.notes) }));
  p.notesRecueil = notesSures(p.notesRecueil);
  return p;
}

/**
 * Résout la liste des destinataires : des membres de l'équipe (par identifiant, pour que
 * le navigateur n'ait pas à transmettre des adresses) et des adresses libres.
 */
export function resoudreDestinataires(equipe, { memberIds = [], adresses = [] }) {
  const { members } = getSnapshot(equipe);
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

export async function envoyerRapportReunion({ equipe, payload, destinataires, objet, joindreDocument = true, par }) {
  if (!isMailConfigured()) {
    throw new Error("L'envoi de mail n'est pas configuré (Paramètres → Envoi de mail).");
  }
  const souci = verifierPayload(payload);
  if (souci) throw new Error(souci);

  const cibles = resoudreDestinataires(equipe, destinataires ?? {});
  const aEnvoyer = cibles.filter((c) => c.statut === 'a-envoyer');
  if (aEnvoyer.length === 0) {
    throw new Error("Aucun destinataire joignable : aucune adresse valide dans la sélection.");
  }

  const sujet = String(objet || '').trim().slice(0, MAX_OBJET) || `Réunion d'équipe — ${payload.teamLabel}`;
  const propre = assainirPayload(payload);
  const document = renderDocument(propre);

  let resultats;
  try {
    const info = await sendMail({
      to: aEnvoyer.map((c) => c.email).join(', '),
      subject: sujet,
      text: renderText(propre),
      html: renderMail(propre),
      attachments: joindreDocument
        ? [{ filename: nomFichier(propre), content: document, contentType: 'text/html; charset=utf-8' }]
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
    enregistrerEnvoi(equipe, { par, objet: sujet, destinataires: cibles.map((c) => c.email || c.nom), resultats, document });
    throw error;
  }

  const envoi = enregistrerEnvoi(equipe, {
    par,
    objet: sujet,
    destinataires: cibles.map((c) => c.email || c.nom),
    resultats,
    document,
  });

  return { envoyeLe: envoi.envoyeLe, objet: sujet, resultats, piecesJointes: joindreDocument ? [nomFichier(propre)] : [] };
}
