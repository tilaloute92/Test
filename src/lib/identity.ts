import type { TeamMember } from '../types';

/**
 * Qui, dans l'équipe, est la personne connectée ?
 *
 * L'application n'a jamais fait ce lien : les comptes vivent côté serveur (local, LDAP ou
 * SSO) et les membres de l'équipe sont des fiches saisies à la main dans l'onglet Équipe.
 * Rien ne les rattache. C'était sans conséquence tant que tous les écrans montraient
 * l'équipe entière ; dès qu'un écran prétend montrer VOTRE journée, il faut le savoir.
 *
 * Trois façons de le deviner, de la plus sûre à la plus approximative, puis une question
 * posée à la personne. On ne force jamais un rapprochement douteux : afficher la journée
 * d'un collègue en croyant montrer la sienne serait pire que de demander.
 */

const CLE = 'suivi-infra:mon-membre';

function normalise(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Choix mémorisé sur ce poste. Volontairement local : c'est un confort d'affichage, pas
 *  une donnée d'équipe, et l'écrire sur le serveur reviendrait à décider pour les autres. */
export function getStoredMemberId(): string | null {
  try {
    return localStorage.getItem(CLE);
  } catch {
    return null;
  }
}

export function setStoredMemberId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CLE, id);
    else localStorage.removeItem(CLE);
  } catch {
    // Navigation privée ou stockage bloqué : la personne devra se désigner à chaque
    // ouverture, ce qui reste préférable à un plantage.
  }
}

export interface ResolvedIdentity {
  member: TeamMember | undefined;
  /** Comment on est arrivé à cette personne — affiché pour qu'elle puisse corriger. */
  source: 'choisi' | 'email' | 'nom' | 'identifiant' | 'aucun';
}

/**
 * @param session  Ce que le serveur sait de la personne connectée (identifiant + nom
 *   affiché), ou null en mode autonome où personne n'est identifié.
 */
export function resolveMember(
  members: TeamMember[],
  session: { username?: string; name?: string } | null
): ResolvedIdentity {
  // 1. Un choix explicite l'emporte toujours : il a été fait en connaissance de cause.
  const stocke = getStoredMemberId();
  if (stocke) {
    const m = members.find((x) => x.id === stocke);
    if (m) return { member: m, source: 'choisi' };
    // La fiche a été supprimée depuis : on oublie le choix plutôt que de rester muet.
    setStoredMemberId(null);
  }
  if (!session) return { member: undefined, source: 'aucun' };

  // 2. L'adresse mail est le seul rapprochement réellement fiable.
  const identifiant = normalise(session.username ?? '');
  if (identifiant) {
    const parMail = members.find((m) => m.email && normalise(m.email) === normalise(session.username ?? ''));
    if (parMail) return { member: parMail, source: 'email' };
    const parDebutMail = members.find((m) => m.email && normalise(m.email.split('@')[0]) === identifiant);
    if (parDebutMail) return { member: parDebutMail, source: 'email' };
  }

  // 3. Le nom affiché, qui vient de l'annuaire en LDAP/SSO et correspond souvent.
  const nom = normalise(session.name ?? '');
  if (nom) {
    const parNom = members.find((m) => normalise(m.name) === nom);
    if (parNom) return { member: parNom, source: 'nom' };
  }

  // 4. L'identifiant contre le nom, pour les comptes du type « rnelson » face à
  //    « R. Nelson ». Exigé sans ambiguïté : si deux fiches correspondent, on ne tranche
  //    pas à la place de la personne.
  if (identifiant) {
    const candidats = members.filter((m) => {
      const n = normalise(m.name).replace(/ /g, '');
      const initialesEtNom = normalise(m.name)
        .split(' ')
        .map((p, i, arr) => (i < arr.length - 1 ? p[0] : p))
        .join('');
      return n === identifiant.replace(/ /g, '') || initialesEtNom === identifiant.replace(/ /g, '');
    });
    if (candidats.length === 1) return { member: candidats[0], source: 'identifiant' };
  }

  return { member: undefined, source: 'aucun' };
}
