import { useEffect, useRef, useState } from 'react';
import { useConfirm } from './ConfirmProvider';

/**
 * Protection commune à toutes les fenêtres modales : un clic à côté ne doit PAS faire
 * disparaître ce qu'on était en train de saisir.
 *
 * Chaque formulaire posait auparavant son propre fond avec `onClick={onCancel}`, si bien
 * qu'un clic manqué de quelques pixels — ou un clic réflexe pour redonner le focus à la
 * fenêtre — effaçait la saisie en cours sans un mot, sans avertissement et sans retour
 * possible : il fallait tout recommencer.
 *
 * La règle retenue distingue les deux situations, plutôt que d'interdire la fermeture par
 * clic extérieur (commode quand on vient d'ouvrir la fenêtre par erreur) ou de la laisser
 * détruire le travail :
 *
 *   - rien n'a été saisi        -> le clic extérieur et Échap ferment, comme avant ;
 *   - quelque chose a été saisi -> une confirmation est demandée, et refuser laisse la
 *                                  fenêtre ouverte avec tout son contenu.
 *
 * « Quelque chose a été saisi » est détecté sans que chaque formulaire ait à le déclarer :
 * les événements change/input de React remontent depuis les champs, un écouteur posé sur
 * le conteneur les voit donc tous, y compris ceux qu'on ajoutera plus tard. Exiger une
 * déclaration explicite ferait retomber dans le défaut d'origine le premier formulaire
 * qui l'oublierait.
 *
 * Renvoie deux jeux de propriétés à étaler sur le fond et sur le contenu — de sorte que
 * seules les balises ouvrantes des modales existantes changent.
 */
export function useModalDismiss(onClose: () => void, subject = 'cette saisie') {
  const confirm = useConfirm();
  const [dirty, setDirty] = useState(false);
  // Référence plutôt qu'état : deux Échap rapides ouvriraient sinon deux confirmations
  // superposées, dont la seconde ne se refermerait jamais.
  const closing = useRef(false);
  // Les valeurs les plus fraîches pour l'écouteur clavier, sans le réabonner à chaque
  // frappe ni capturer un `dirty` périmé dans la fermeture.
  const state = useRef({ dirty, onClose, subject, confirm });
  state.current = { dirty, onClose, subject, confirm };

  const requestClose = async () => {
    const { dirty: sale, onClose: fermer, subject: quoi, confirm: demander } = state.current;
    if (!sale) return fermer();
    if (closing.current) return;
    closing.current = true;
    try {
      const ok = await demander({
        title: 'Abandonner les modifications ?',
        message: `Vous avez commencé à remplir ${quoi}. Fermer maintenant perdra ce que vous avez saisi.`,
        confirmLabel: 'Abandonner',
        cancelLabel: 'Continuer la saisie',
        danger: true,
      });
      if (ok) fermer();
    } finally {
      closing.current = false;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // La confirmation qui s'ouvre par-dessus a son propre Échap : sans arrêter la
      // propagation, une seule pression traverserait les deux.
      e.stopPropagation();
      void requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // requestClose lit tout via `state`, l'abonnement n'a donc pas à être refait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    backdrop: {
      // mousedown et non click : un clic commencé DANS la fenêtre et relâché dehors —
      // une sélection de texte tirée un peu trop loin — produit un `click` sur le fond,
      // et fermait donc la fenêtre alors que l'utilisateur ne visait que du texte.
      onMouseDown: (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) void requestClose();
      },
    },
    content: {
      role: 'dialog' as const,
      'aria-modal': true,
      onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
      onChange: () => setDirty(true),
      onInput: () => setDirty(true),
    },
  };
}
