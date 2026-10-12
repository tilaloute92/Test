# Plan Relief — nouveautés

## Version 1.1.0

La version installée s'affiche en haut à gauche de l'application (« v1.1.0 ») ; l'info-bulle
donne la date de construction et la version du service. Si un poste affiche une ancienne
version après une mise à jour du serveur, un message lui demande d'actualiser (Ctrl+F5).

### Tracés
- **Fiche de tracé (PDF)** : bouton « Fiche PDF » après un calcul. La fiche (départ,
  arrivée, cheminement, étages, vue de dessus de chaque étage, étapes et longueurs, zone
  Observations / Visa) s'ouvre dans un nouvel onglet ; imprimez-la ou choisissez
  « Microsoft Print to PDF » / « Enregistrer au format PDF ». Le navigateur doit autoriser
  les fenêtres surgissantes pour le site.
- **Tracé groupé** : « Ajouter une arrivée » ou « Toutes les « … » de cet étage » sous
  l'arrivée (50 câbles au plus). Le résultat donne la longueur de chaque câble et le total à
  commander ; un clic sur une ligne affiche son tracé, les autres restent en couleur.
- **Export Excel** du tracé (CSV : une ligne par câble).
- **Tracés enregistrés** : « Enregistrer le tracé » (nom, référence de chantier). La page
  « Tracés enregistrés » les liste pour toute l'équipe ; « Ouvrir » les recalcule sur les
  plans actuels. Un tracé dont un plan a changé depuis est signalé. Tout utilisateur peut
  enregistrer ses tracés ; seul son auteur ou un administrateur peut le modifier ou le
  supprimer. Stockage : `data\routes.json` (compris dans la sauvegarde).

### Vue d'un plan
- **Mesure** : bouton « Mesurer » dans la vue, puis cliquer des points ; distance de chaque
  segment et total, en ligne droite ou en angles droits. Retour arrière : annuler le dernier
  point ; Échap : terminer.
- **Export Excel** de la liste des équipements affichée (filtres compris).
- **Journal** (onglet) : qui a ajouté, modifié ou supprimé quoi, et quand ; un administrateur
  peut restaurer un équipement supprimé. Le journal commence à l'installation de la 1.1.0
  (`data\plans\<id>\journal.json`).

### Recherche
- **Export Excel** des résultats (500 au plus), avec l'étage et un lien vers l'équipement.
