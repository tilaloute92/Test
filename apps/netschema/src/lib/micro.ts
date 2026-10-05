/**
 * Diagnostic du micro, et ce qu'il faut en dire.
 *
 * La dictée échoue presque toujours pour une des quatre mêmes raisons, et le navigateur
 * n'en désigne aucune clairement : il renvoie « not-allowed » aussi bien quand l'utilisateur
 * a refusé le micro que quand la page n'est pas servie en HTTPS. Diagnostiquer avant de
 * tenter évite de faire chercher.
 *
 * Le cas le plus fréquent en déploiement interne est le dernier qu'on soupçonne : une page
 * servie en `http://serveur:8080` n'est pas un « contexte sécurisé », et les navigateurs y
 * refusent le micro sans explication. Seul `localhost` échappe à la règle — ce qui fait que
 * la dictée marche sur le serveur et nulle part ailleurs, un symptôme déroutant.
 */

export type EtatMicro =
  | 'pret'
  | 'contexte-non-securise'
  | 'navigateur-sans-dictee'
  | 'micro-refuse'
  | 'inconnu'

export interface DiagnosticMicro {
  etat: EtatMicro
  /** Ce qui se passe, en une phrase. */
  constat: string
  /** Ce qu'il faut faire, concrètement. */
  remede?: string
  /** Moteur de reconnaissance présumé, et où part l'audio. */
  moteur?: string
}

/** Navigateur présumé, d'après la chaîne d'agent. Sert à nommer le service de reconnaissance. */
function moteurPresume(): { nom: string; service: string } | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return { nom: 'Edge', service: 'les serveurs de reconnaissance de Microsoft' }
  if (/Chrome\//.test(ua) && !/OPR\//.test(ua)) return { nom: 'Chrome', service: 'les serveurs de reconnaissance de Google' }
  if (/Firefox\//.test(ua)) return { nom: 'Firefox', service: '' }
  return null
}

function dicteeDisponible(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}

/**
 * Établit le diagnostic.
 *
 * Asynchrone parce que l'état de l'autorisation micro ne se lit que par l'API Permissions,
 * qui rend une promesse — et qui n'existe pas partout, d'où le repli silencieux.
 */
export async function diagnostiquerMicro(): Promise<DiagnosticMicro> {
  const moteur = moteurPresume()
  const nomMoteur = moteur?.service
    ? `${moteur.nom} fait analyser la voix par ${moteur.service} : l’audio sort du poste.`
    : undefined

  if (typeof window === 'undefined') {
    return { etat: 'inconnu', constat: 'Diagnostic impossible hors navigateur.' }
  }

  // L'ordre compte : un contexte non sécurisé masque tout le reste, et c'est lui qu'il faut
  // nommer en premier, sans quoi on part chercher une autorisation qui n'est jamais demandée.
  if (!window.isSecureContext) {
    const hote = window.location.hostname
    return {
      etat: 'contexte-non-securise',
      constat: `La page est servie en ${window.location.protocol.replace(':', '')} sur « ${hote} » : les navigateurs y interdisent le micro.`,
      remede:
        'Servez NetSchema en HTTPS — le script « 2-Activer-HTTPS.cmd » du paquet Windows s’en charge. ' +
        'Sur le serveur lui-même, http://localhost reste autorisé : c’est pourquoi la dictée y marche et nulle part ailleurs.',
      moteur: nomMoteur,
    }
  }

  if (!dicteeDisponible()) {
    return {
      etat: 'navigateur-sans-dictee',
      constat: `Ce navigateur${moteur ? ` (${moteur.nom})` : ''} n’expose pas la reconnaissance vocale.`,
      remede:
        'Ouvrez NetSchema dans Edge ou Chrome. Sinon, la saisie des commandes au clavier reste entière, ' +
        'et la reconnaissance vocale de Windows 11 sait dicter dans le champ de commande.',
      moteur: nomMoteur,
    }
  }

  try {
    const permissions = (navigator as unknown as {
      permissions?: { query: (d: { name: string }) => Promise<{ state: string }> }
    }).permissions
    const etat = await permissions?.query({ name: 'microphone' })
    if (etat?.state === 'denied') {
      return {
        etat: 'micro-refuse',
        constat: 'Le micro est refusé pour ce site.',
        remede:
          'Cliquez sur l’icône de cadenas dans la barre d’adresse, puis autorisez le micro et rechargez la page.',
        moteur: nomMoteur,
      }
    }
  } catch {
    // L'API Permissions ne connaît pas « microphone » partout ; ce n'est pas bloquant.
  }

  return {
    etat: 'pret',
    constat: 'Micro utilisable.',
    moteur: nomMoteur,
  }
}

/**
 * Message sur la confidentialité, quand il y a lieu de le donner.
 *
 * Un outil de documentation réseau décrit des topologies internes. Dire à voix haute le nom
 * d'un cœur de réseau devant un navigateur qui transmet l'audio à un service en ligne n'est
 * pas anodin, et l'utilisateur doit pouvoir le savoir avant, pas après.
 */
export const DICTEE_LOCALE_WINDOWS =
  'Pour une dictée qui ne sort pas du poste : activez l’accès vocal de Windows 11 ' +
  '(Paramètres ▸ Accessibilité ▸ Accès vocal), placez le curseur dans le champ de commande ' +
  'ci-dessous et dictez — l’accès vocal reconnaît la parole sur l’appareil.'
