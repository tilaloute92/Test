import { toISODate } from './date';
import type { WeatherLevel } from './weeklyReport';

/**
 * Météo de la semaine votée par l'équipe — côté navigateur.
 *
 * Le calcul composite (voir weeklyReport.ts) n'a pas disparu : il reste affiché à côté du
 * vote. Les deux ne mesurent pas la même chose — l'un dit ce que montrent les chiffres,
 * l'autre ce qu'ont vécu les personnes — et c'est justement quand ils divergent que la
 * réunion a quelque chose à se dire. Remplacer l'un par l'autre ferait perdre l'écart,
 * qui est l'information la plus utile des deux.
 *
 * Le dépouillement, les seuils et la fenêtre sont ici ; le stockage anonyme est côté
 * serveur (server/src/meteoVotes.js), seul endroit où il peut l'être.
 */

export const NIVEAUX: WeatherLevel[] = ['ensoleille', 'eclaircies', 'nuageux', 'orageux'];

/** Longueur du mot facultatif. Même valeur que côté serveur, qui la fait respecter. */
export const MOT_MAX = 200;

/**
 * En dessous de trois voix, le vote n'est pas publié.
 *
 * Deux raisons, et la seconde compte autant que la première : à une ou deux voix, la météo
 * affichée serait celle d'une personne présentée comme celle de l'équipe ; et dans une
 * équipe de cinq, deux voix s'attribuent de tête dès que quelqu'un dit en réunion ce qu'il
 * a voté. Le silence protège autant qu'il mesure.
 */
export const VOIX_MINIMUM = 3;

/** Ce que renvoie le serveur pour une semaine. Aucun champ ne désigne personne. */
export interface AgregatMeteo {
  semaine: string;
  voix: Record<WeatherLevel, number>;
  total: number;
  effectif: number;
  mots: string[];
  etat: 'a-venir' | 'ouvert' | 'clos';
  ouvert: boolean;
  ouvertureIso: string;
  clotureIso: string;
  /** Pour la personne qui demande, et elle seule. */
  aVote: boolean;
}

export type RaisonMeteo =
  /** Le vote a eu lieu et fait foi. */
  | 'vote'
  /** Vote encore ouvert : on montre les chiffres en attendant. */
  | 'en-cours'
  /** Clos, mais trop peu de voix pour publier. */
  | 'insuffisant'
  /** Semaine dont le vote n'est pas encore ouvert, ou semaine passée sans vote. */
  | 'sans-vote';

export interface ResultatMeteo {
  /** La météo à afficher en grand. Jamais nulle : à défaut de vote, c'est le calcul. */
  niveau: WeatherLevel;
  /** D'où elle vient, pour pouvoir l'écrire au lieu de laisser croire à un vote. */
  raison: RaisonMeteo;
  /** Vrai quand `niveau` vient des voix et non du score. */
  vote: boolean;
  agregat: AgregatMeteo | null;
  /** Phrase courte affichée sous la météo, toujours présente. */
  mention: string;
}

/** La clé d'une semaine : le lundi, au format AAAA-MM-JJ. */
export function cleSemaine(debutSemaine: Date): string {
  return toISODate(debutSemaine);
}

/**
 * Le niveau qui l'emporte.
 *
 * À égalité, le plus sombre : une équipe partagée entre « nuageux » et « orageux » ne va
 * pas bien, et arrondir vers le beau temps est exactement la façon dont un indicateur
 * cesse d'être lu. Pas de moyenne non plus — la moyenne de deux « ensoleillé » et deux
 * « orageux » donnerait « éclaircies », c'est-à-dire la seule réponse que personne n'a
 * donnée et qui cacherait que l'équipe est coupée en deux.
 */
export function depouiller(voix: Record<WeatherLevel, number>): WeatherLevel | null {
  let gagnant: WeatherLevel | null = null;
  let meilleur = 0;
  for (const n of NIVEAUX) {
    const c = voix[n] ?? 0;
    if (c > 0 && c >= meilleur) {
      meilleur = c;
      gagnant = n;
    }
  }
  return gagnant;
}

/** Vrai si l'équipe n'est pas d'accord — deux niveaux au moins ont des voix. */
export function partage(voix: Record<WeatherLevel, number>): boolean {
  return NIVEAUX.filter((n) => (voix[n] ?? 0) > 0).length > 1;
}

function heureCourte(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/**
 * Ce qu'affiche le rapport, en tenant compte du calcul comme repli.
 *
 * @param calcule  la météo issue du score composite, toujours disponible.
 */
export function resultatMeteo(agregat: AgregatMeteo | null, calcule: WeatherLevel): ResultatMeteo {
  if (!agregat) {
    return { niveau: calcule, raison: 'sans-vote', vote: false, agregat: null, mention: 'Météo calculée à partir des chiffres de la semaine.' };
  }

  const retenu = depouiller(agregat.voix);
  const surEffectif = `${agregat.total} voix sur ${agregat.effectif}`;

  if (agregat.etat === 'ouvert') {
    return {
      niveau: calcule,
      raison: 'en-cours',
      vote: false,
      agregat,
      mention: `Vote en cours — ${surEffectif}, clôture à ${heureCourte(agregat.clotureIso)}. Météo calculée en attendant.`,
    };
  }

  if (agregat.etat === 'a-venir') {
    return {
      niveau: calcule,
      raison: 'sans-vote',
      vote: false,
      agregat,
      mention: 'Vote pas encore ouvert — météo calculée.',
    };
  }

  // Le minimum ne peut pas dépasser l'effectif : dans un service de deux personnes, exiger
  // trois voix reviendrait à ne jamais publier de météo sans jamais dire pourquoi.
  const minimum = Math.min(VOIX_MINIMUM, agregat.effectif);

  if (!retenu || agregat.total < minimum) {
    return {
      niveau: calcule,
      raison: 'insuffisant',
      vote: false,
      agregat,
      mention:
        agregat.total === 0
          ? 'Personne n’a voté cette semaine — météo calculée.'
          : `Vote non concluant (${surEffectif}, ${minimum} minimum) — météo calculée.`,
    };
  }

  return {
    niveau: retenu,
    raison: 'vote',
    vote: true,
    agregat,
    mention: partage(agregat.voix) ? `${surEffectif} — avis partagés.` : `${surEffectif}, à l’unanimité.`,
  };
}

/* ------------------------------------------------------------------ voix locale */

/**
 * L'identifiant de SA voix, remis une fois par le serveur au moment du dépôt.
 *
 * Il ne vit que dans ce navigateur : c'est ce qui permet de changer d'avis sans que le
 * serveur ait à savoir quelle voix est la nôtre. Le perdre (autre poste, navigation
 * privée, stockage effacé) coûte la possibilité de modifier, rien d'autre — l'interface
 * le dit plutôt que de laisser croire à un bogue.
 */
const CLE = 'suivi-infra:meteo-voix';

export interface VoixLocale {
  id: string;
  niveau: WeatherLevel;
  mot: string;
}

export function voixLocale(semaine: string): VoixLocale | null {
  try {
    const brut = localStorage.getItem(`${CLE}:${semaine}`);
    if (!brut) return null;
    const v = JSON.parse(brut) as VoixLocale;
    // Le niveau est relu avec méfiance : le stockage local se modifie à la main, et un
    // niveau inconnu ferait planter l'affichage de la tuile.
    return v && typeof v.id === 'string' && NIVEAUX.includes(v.niveau)
      ? { id: v.id, niveau: v.niveau, mot: typeof v.mot === 'string' ? v.mot : '' }
      : null;
  } catch {
    return null;
  }
}

export function setVoixLocale(semaine: string, voix: VoixLocale | null): void {
  try {
    if (voix) localStorage.setItem(`${CLE}:${semaine}`, JSON.stringify(voix));
    else localStorage.removeItem(`${CLE}:${semaine}`);
  } catch {
    // Stockage refusé : la voix est déposée quand même, elle ne sera simplement plus
    // modifiable depuis ce poste.
  }
}
