# NetSchema — schémas d'infrastructure réseau semi-automatisés

Application web autonome pour dessiner des schémas d'infrastructure réseau : on décrit les
équipements et leurs liaisons, le **placement automatique** construit le schéma par couches,
puis on ajuste à la main ce qui doit l'être. Le résultat s'exporte en **SVG** et en **PNG**.

L'application est construite autour des pratiques des **infrastructures haute disponibilité** :
grappes actif/passif et actif/actif, VRRP/HSRP, MLAG et agrégats LACP, témoin de quorum,
double attachement, double adduction opérateur, site de secours, double chaîne électrique.
Elle sait non seulement les représenter, mais aussi **analyser le schéma** et signaler les
points de défaillance uniques.

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
3. **Regroupements** — site, zone et grappe HA rangent côte à côte, dans chaque couche, les
   équipements qui vont ensemble, avec un espacement resserré entre membres d'une même
   grappe. Chaque groupe reçoit un cadre : site (trait plein), zone (pointillés), grappe
   (rose, avec son adresse virtuelle). Un groupe étalé sur plusieurs couches est dessiné en
   rangées soudées, pour ne jamais englober des équipements qui n'en font pas partie.
4. **Positions** — les équipements sont répartis régulièrement et chaque couche est centrée.
   Les espacements se règlent au curseur dans l'inspecteur, le sens des couches peut être
   vertical (haut → bas) ou horizontal (gauche → droite).

La part manuelle reste entière : on déplace n'importe quel équipement à la souris (aimantation
sur une grille de 20 px), et **figer une position** (`Figer la position`) exclut définitivement
l'équipement des replacements automatiques suivants. C'est le mode de travail visé : lancer le
placement auto, figer ce qui est bien placé, relancer.

Les liaisons sont tracées en orthogonal à angles arrondis (ou en direct), les câbles multiples
entre deux mêmes équipements sont automatiquement étalés pour ne pas se superposer.

## Haute disponibilité

### Ce que le modèle sait décrire

| Notion | Où |
| --- | --- |
| Grappe (cluster) et rôle : actif, passif, actif/actif, témoin de quorum | Inspecteur → bloc « Haute disponibilité » ; badge sur l'équipement |
| Adresse virtuelle VRRP / HSRP / VIP de répartiteur | Champ *Adresse virtuelle*, affichée sur le cadre de la grappe |
| Battement de cœur, stack / MLAG / VSS, agrégat LACP | Types de liaison |
| Réplication / synchronisation, administration hors bande, alimentation | Types de liaison |
| Liaison de secours | Case « Liaison de secours » (tracé en pointillés) |
| Site physique (siège, site de secours, site tiers) | Champ *Site* + cadre de site |
| Double alimentation A/B | Case « Double alimentation », marque ⚡ A/B sur l'équipement |
| Équipements dédiés : nœud hyperviseur, témoin de quorum, sauvegarde, onduleur, PDU | Palette |

### Modèles prêts à l'emploi

Onglet **Haute dispo** → *Modèles haute dispo*. Chaque modèle arrive au centre de la vue,
déjà câblé et déjà décrit (grappe, rôles, VIP, battement de cœur) ; il ne reste qu'à le
raccorder au schéma et à relancer le placement automatique. Les noms de grappes déjà
utilisés sont suffixés automatiquement.

- **Pare-feu actif / passif** — deux pare-feu, synchro HA, VIP partagée.
- **Cœur redondé MLAG** — deux switches cœur en MLAG, distribution en double attachement.
- **Ferme derrière répartiteurs actif / actif** — deux LB, trois serveurs, synchro de sessions.
- **Cluster d'hyperviseurs + témoin** — trois nœuds, stockage partagé, quorum.
- **Double adduction opérateur** — deux opérateurs, deux routeurs VRRP, liens croisés.
- **Second site (plan de reprise)** — interconnexion inter-sites, réplication, témoin tiers.
- **Double chaîne électrique A/B** — deux onduleurs, deux bandeaux PDU.

### Analyse automatique

L'onglet **Haute dispo** recalcule en continu une note de robustesse et la liste des constats ;
un clic sur un constat sélectionne les équipements concernés, et les points critiques sont
marqués d'une pastille rouge sur le schéma.

- **Points de défaillance uniques** — calcul des points d'articulation du graphe (algorithme
  de Tarjan) sur les seules liaisons de transport : tout équipement dont la panne coupe le
  réseau en deux est signalé.
- **Équipement critique sans pair** et **simple attachement** (avertissement sur le cœur et la
  distribution, conseil en couche d'accès, où le simple attachement reste la norme).
- **Grappes** — absence de battement de cœur, témoin de quorum manquant pour une grappe de
  calcul ou de données à deux nœuds (VRRP et MLAG, qui s'arbitrent autrement, ne sont pas
  concernés), rôles ambigus, adresse virtuelle non renseignée.
- **Adduction unique** vers l'extérieur, **chaîne électrique simple**, équipements critiques
  sans double alimentation.
- **Site de secours** et **sauvegarde** absents, **liens parallèles non agrégés** en LACP.
- Un raccordement latéral (interconnexion entre deux cœurs, lien inter-sites) est reconnu
  comme tel et n'est pas compté comme un défaut de raccordement.

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
| Voir l'analyse HA | Bouton **Haute dispo** de la barre d'outils, ou onglet du panneau droit |

Chaque équipement porte un nom, un type, un modèle, une IP, un VLAN, une zone, un site, des
notes et ses attributs de haute disponibilité (grappe, rôle, VIP, double alimentation) ;
chaque liaison un type (cuivre, fibre, trunk LACP, stack/MLAG, WAN, VPN, sans fil, battement
de cœur, réplication, hors bande, alimentation), un libellé, un débit et un indicateur
« liaison de secours ».

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
  lib/layout.ts         placement automatique par couches, cadres de groupes, cadrage
  lib/ha.ts             analyse haute disponibilité (points d'articulation + règles métier)
  lib/patterns.ts       bibliothèque de modèles d'architectures redondées
  lib/routing.ts        tracé des liaisons (orthogonal arrondi, étalement des parallèles)
  lib/exportImage.ts    export SVG / PNG
  lib/storage.ts        sauvegarde locale, lecture/écriture des fichiers projet
  lib/sample.ts         schéma d'exemple (architecture HA siège + site de secours)
  store/useDiagram.ts   état global (zustand) : schéma, sélection, vue, historique
  store/useAudit.ts     analyse HA mémorisée sur la version courante du schéma
  components/           barre d'outils, palette, plan de travail, inspecteur, panneau HA
```

## Limites connues

- L'analyse raisonne sur la topologie telle qu'elle est dessinée : elle ne connaît ni les
  chemins physiques réels des fibres, ni les configurations des équipements. Deux liens
  « redondants » passant dans le même fourreau lui paraîtront redondants.
- Pas encore d'import d'inventaire (CSV/Excel) ni de déduction de topologie depuis des exports
  d'équipements (LLDP/CDP, ARP, configurations) : la saisie est manuelle ou par fichier projet.
- Pas d'export PPTX ni PDF pour l'instant (le SVG s'insère tel quel dans PowerPoint et Word).
