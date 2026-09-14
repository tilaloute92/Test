# NetSchema — schémas d'infrastructure réseau semi-automatisés

Application web autonome pour dessiner des schémas d'infrastructure réseau : on décrit les
équipements et leurs liaisons, le **placement automatique** construit le schéma par couches,
puis on ajuste à la main ce qui doit l'être. Le résultat s'exporte en **SVG** et en **PNG**.

Elle vit dans `apps/netschema/` et ne partage rien avec l'application de suivi d'équipe à la
racine du dépôt : dépendances, build et déploiement sont indépendants.

## Démarrer

```bash
cd apps/netschema
npm install
npm run dev      # http://localhost:5174
npm run build    # génère dist/ (fichiers statiques, ouvrables tels quels)
npm run lint
```

Le build utilise `base: './'` : le contenu de `dist/` fonctionne depuis n'importe quel
sous-répertoire d'un serveur web (IIS, nginx, partage réseau).

## Le « semi-automatisé » en pratique

Le placement automatique (`src/lib/layout.ts`) fait le gros du travail :

1. **Couches** — chaque équipement reçoit une couche déduite de son type : Internet/WAN →
   périmètre → sécurité → cœur → distribution → accès → serveurs → postes. La couche est
   modifiable équipement par équipement dans l'inspecteur (« Couche pour le placement auto »).
   Les couches vides sont supprimées : un schéma sans pare-feu ne laisse pas de trou.
2. **Ordre dans la couche** — quatre allers-retours de tri par barycentre font glisser chaque
   équipement en face de ses voisins, ce qui réduit fortement les croisements de liaisons.
3. **Zones** — l'option « Regrouper par zone » range côte à côte, dans chaque couche, les
   équipements d'une même zone (DMZ, Datacenter, Bâtiment A…), qui reçoivent aussi un cadre
   en pointillés.
4. **Positions** — les équipements sont répartis régulièrement et chaque couche est centrée.
   Les espacements se règlent au curseur dans l'inspecteur, le sens des couches peut être
   vertical (haut → bas) ou horizontal (gauche → droite).

La part manuelle reste entière : on déplace n'importe quel équipement à la souris (aimantation
sur une grille de 20 px), et **figer une position** (`Figer la position`) exclut définitivement
l'équipement des replacements automatiques suivants. C'est le mode de travail visé : lancer le
placement auto, figer ce qui est bien placé, relancer.

Les liaisons sont tracées en orthogonal à angles arrondis (ou en direct), les câbles multiples
entre deux mêmes équipements sont automatiquement étalés pour ne pas se superposer.

## Prise en main

| Action | Comment |
| --- | --- |
| Ajouter un équipement | Glisser depuis la palette, ou cliquer dessus (ajout au centre de la vue) |
| Relier deux équipements | Bouton **Relier** (ou `L`), cliquer le départ puis l'arrivée |
| Sélection multiple | `Maj` + clic |
| Supprimer | `Suppr` (supprime aussi les liaisons attachées) |
| Annuler / rétablir | `Ctrl+Z` / `Ctrl+Maj+Z` |
| Zoom / déplacement | Molette · glisser le fond · bouton **Ajuster** |
| Sortir d'un mode | `Échap` |

Chaque équipement porte un nom, un type, un modèle, une IP, un VLAN, une zone et des notes ;
chaque liaison un type (cuivre, fibre, trunk, WAN, VPN, sans fil), un libellé, un débit et un
indicateur « liaison de secours ».

## Exports et sauvegarde

- **SVG** — vectoriel, réutilisable dans Visio, Illustrator, Word, un wiki…
- **PNG** — bitmap ×2 sur fond blanc.
- **Projet `.json`** — *Enregistrer* / *Ouvrir…*, pour reprendre ou versionner un schéma.
- **Reprise automatique** — le schéma courant est sauvegardé dans le navigateur (localStorage)
  et rechargé au démarrage suivant.

Les exports ne contiennent que le schéma : la grille, les poignées de sélection et l'aperçu de
liaison en cours sont marqués `data-export="false"` et retirés du fichier produit.

## Organisation du code

```
src/
  types.ts              modèle de données (équipements, liaisons, options de mise en page)
  lib/catalog.ts        types d'équipements, couches, couleurs, styles de liaisons
  lib/icons.tsx         pictogrammes SVG des équipements
  lib/layout.ts         placement automatique par couches, cadres de zones, cadrage
  lib/routing.ts        tracé des liaisons (orthogonal arrondi, étalement des parallèles)
  lib/exportImage.ts    export SVG / PNG
  lib/storage.ts        sauvegarde locale, lecture/écriture des fichiers projet
  lib/sample.ts         schéma d'exemple (siège + agence)
  store/useDiagram.ts   état global (zustand) : schéma, sélection, vue, historique
  components/           barre d'outils, palette, plan de travail, inspecteur
```

## Limites connues

- Le cadre d'une zone étalée sur plusieurs couches peut englober visuellement des équipements
  d'autres zones ; l'affichage des zones se désactive dans l'inspecteur.
- Pas encore d'import d'inventaire (CSV/Excel) ni de déduction de topologie depuis des exports
  d'équipements (LLDP/CDP, ARP, configurations) : la saisie est manuelle ou par fichier projet.
- Pas d'export PPTX ni PDF pour l'instant (le SVG s'insère tel quel dans PowerPoint et Word).
