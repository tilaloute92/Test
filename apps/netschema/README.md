# NetSchema — schémas d'infrastructure réseau semi-automatisés

Application web autonome pour dessiner des schémas d'infrastructure réseau : on décrit les
équipements et leurs liaisons, le **placement automatique** construit le schéma par couches,
puis on ajuste à la main ce qui doit l'être. Le résultat s'exporte en **SVG** et en **PNG**.

L'application est construite autour des pratiques des **infrastructures haute disponibilité** :
grappes actif/passif et actif/actif, VRRP/HSRP, MLAG et agrégats LACP, témoin de quorum,
double attachement, double adduction opérateur, site de secours, double chaîne électrique.
Elle sait non seulement les représenter, mais aussi **analyser le schéma** et signaler les
points de défaillance uniques.

L'application tient quatre modules sur la même base de données : le **schéma**, l'**inventaire**
du parc, l'**implantation en baies** et la **découverte réseau** — auxquels s'ajoutent les
**commandes vocales** et un **guide intégré**. Un serveur posé dans une baie est le même objet
que celui câblé sur le schéma et listé à l'inventaire.

Le catalogue d'équipements couvre l'état de l'art 2026 — SD-WAN et SASE/SSE, fabric
spine-leaf VXLAN/EVPN, Wi-Fi 7, 5G, Kubernetes et serverless, serveurs GPU, pile Zero Trust
(ZTNA, WAF, EDR/XDR, SIEM/SOAR, PAM, HSM), OT/industriel — et il se met à jour **sans
recompiler l'application**.

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

## Découverte réseau

Un navigateur ne peut ni envoyer un ping, ni interroger un équipement en SNMP : la collecte
se fait donc hors de l'application, et le module **Découverte** interprète les relevés.

### Coller un relevé

Le module reconnaît seul le format de ce qu'on lui donne :

| Relevé | Ce qu'on en tire |
| --- | --- |
| `show lldp neighbors detail`, `show cdp neighbors detail` | **La topologie** : voisins directs, ports des deux côtés, adresse d'administration, type déduit de la plateforme annoncée |
| `nmap -sn … -oX` ou `nmap -sV … -oG` | Les hôtes actifs, leur nom, leur constructeur (OUI MAC) et un type déduit des services ouverts |
| `show ip arp`, `arp -a` | Les couples adresse IP / adresse MAC et leur VLAN |

L'aperçu liste ce qui a été reconnu avant toute modification. La fusion **complète sans
écraser** : un équipement est reconnu par son nom ou son adresse IP, et les champs déjà saisis
à la main sont conservés ; seules les liaisons inconnues sont ajoutées.

### Collecteur en ligne de commande

`tools/collector/netschema-collect.mjs` enchaîne la collecte depuis un poste d'administration
et écrit un fichier de projet ouvrable directement. Aucune dépendance npm : il s'appuie sur
`nmap` et `snmpwalk` s'ils sont présents, et sait aussi relire des relevés déjà pris.

```bash
node tools/collector/netschema-collect.mjs --subnet 10.10.0.0/24 --out site.json
node tools/collector/netschema-collect.mjs --subnet 10.10.0.0/24 --snmp-community public --out site.json
node tools/collector/netschema-collect.mjs --from exemples/lldp.txt exemples/nmap.xml --out exemple.json
```

En SNMP, il relève le nom système, la description et la table LLDP distante de chaque hôte
trouvé. Les exemples de `tools/collector/exemples/` servent à essayer la chaîne complète sans
toucher à un réseau réel.

## Importer un schéma draw.io

Un fichier `.drawio` (ou `.xml`) de draw.io / diagrams.net s'ouvre directement : bouton
**Ouvrir…**, ou simple glisser-déposer du fichier sur le plan de travail.

- Les deux formats sont acceptés : XML en clair **et** XML compressé (base64 + deflate),
  celui que draw.io produit par défaut.
- Les **positions d'origine sont conservées** — on retrouve le schéma tel qu'il a été
  dessiné, quitte à relancer ensuite le placement automatique.
- Le **type d'équipement est déduit du stencil** utilisé (`mxgraph.cisco.routers`,
  `firewall`, `wireless_access_point`, `server`…) et, à défaut, du libellé de la forme.
- Les **conteneurs nommés deviennent des zones** : un cadre « DMZ » qui englobe deux
  équipements donne la zone DMZ sur ces équipements.
- Les **propriétés personnalisées** de draw.io sont reprises quand leur nom est reconnu :
  `ip`, `vlan`, `zone`, `site`, `vendor`/`constructeur`, `model`/`modèle`, `serial`,
  `owner`/`responsable`, `notes`.
- Les liaisons reprennent leur libellé ; un trait en pointillés devient une liaison de
  secours.

Ce qui n'est pas repris est annoncé : pages supplémentaires (seule la première est
importée), liaisons dont une extrémité manque, formes sans libellé.

## Inventaire du parc

Onglet **Inventaire** : la table des actifs, avec constructeur, modèle, numéro de série,
numéro d'immobilisation, site, zone, baie et position, adresse IP, VLAN, responsable, dates
d'achat et de fin de garantie, consommation et notes. Les cellules sont modifiables
directement ; le type et la baie renvoient au schéma et à la salle.

- Recherche plein texte (nom, IP, numéro de série, modèle, responsable) et filtres par site,
  statut et baie — dont « non implantés ».
- Statut d'actif : en production, en stock, en maintenance, retiré.
- **Export CSV** séparateur point-virgule avec BOM : le fichier s'ouvre tel quel dans Excel
  en français. **Import CSV** par la colonne « Nom » : les équipements connus sont mis à jour,
  les inconnus créés.
- Le total de puissance des lignes affichées est calculé en continu.

### Base de matériels constructeurs

La colonne *Modèle* est un champ de recherche sur une base d'environ 145 matériels : on tape
« r760 », « fortigate », « nutanix », « catalyst » et la fiche se remplit — constructeur,
modèle, hauteur en U et consommation indicative. Le type d'équipement est aligné au passage
(un FortiGate devient un pare-feu nouvelle génération, une AFF A250 une baie de stockage).

Constructeurs couverts : Cisco (Catalyst, Nexus, ISR/ASR, Firepower, Meraki), Dell
(PowerEdge, PowerStore, PowerVault, PowerSwitch), HPE (ProLiant, Alletra, Nimble, MSA,
SimpliVity), Aruba, Nutanix, Palo Alto Networks, Fortinet, Juniper, Arista, Extreme,
Ubiquiti, Check Point, Sophos, Stormshield, WatchGuard, F5, Citrix, Radware, NetApp, Pure
Storage, Synology, QNAP, Quantum, Veritas, Rubrik, Lenovo, Supermicro, NVIDIA, IBM, APC,
Eaton, Legrand, Schneider Electric, HP, Xerox, Yealink, Axis, Siemens.

Le champ reste libre : la base est une aide à la saisie, pas une contrainte. Un filtre
*constructeur* s'ajoute aux filtres de l'inventaire.

Les hauteurs sont celles des châssis ; **les puissances sont des ordres de grandeur en
fonctionnement**, pas des valeurs de plaque — elles restent modifiables équipement par
équipement. Un lot de catalogue peut apporter ses propres matériels (clé `models` à côté de
`devices`), donc la base s'étend elle aussi sans recompiler.

## Implantation en baies

Onglet **Baies** : l'élévation des baies, comme la vue « rack » d'un outil de parc.

- Une colonne par baie, numérotée en U, avec le nom, le site, le local et le nombre d'U libres.
- Chaque équipement occupe sa hauteur réelle (1 U pour un switch d'accès, 2 U pour un serveur,
  4 U pour une baie de stockage… valeur par défaut selon le type, modifiable).
- **Glisser-déposer** d'une position à l'autre, et d'une baie à l'autre.
- Liste des **équipements physiques non implantés** : un clic les pose à la première hauteur
  libre en partant du bas.
- Contrôles : chevauchements d'implantation signalés en rouge, dépassement de la hauteur de
  baie, taux d'occupation et puissance totale par baie.
- Export **SVG** et **PNG** de la salle entière.

Supprimer une baie ne supprime pas les équipements : ils redeviennent simplement non implantés.

## Commandes vocales

Bouton **Voix** dans la barre de modules. On dicte l'action, l'application l'exécute et
répond — vocalement si la réponse parlée est activée. Une quarantaine de tournures sont
reconnues, réparties en six familles :

| Famille | Exemples |
| --- | --- |
| **Construire** | « Ajoute un pare-feu », « Ajoute un **switch cœur SW-CORE-03** dans la zone Datacenter », « Ajoute un **serveur SRV-APP-01 avec l'IP 10.10.0.60 relié à SW-CORE-01** », « Ajoute une borne Wi-Fi AP-ETAGE-3 en VLAN 40 », « Ajoute un switch accès SW-ACC-C1 dans la baie A1 », « Duplique SW-ACC-C1 », « Supprime SW-ACC-B1 », « **Supprime tous les téléphones IP** » |
| **Liaisons** | « Relie SW-CORE-01 à FW-01 en fibre », « **Liaison entre SW-CORE-01 et SW-DIST-BATA en fibre 10 Gb/s** » (créée si elle n'existe pas), « Liaison entre A et B en trunk VLAN 10,20 », « Supprime la liaison entre SW-CORE-01 et FW-01 », « Tracé courbe », « Réinitialise le tracé » |
| **Renseigner** | « Renomme SW-CORE-01 en SW-CORE-A », « Mets l'IP 10.10.0.11 sur SW-CORE-A », « La zone de FW-01 est DMZ », « **Change le type de SRV-APP-01 en nœud hyperviseur** », « **Mets le modèle PowerEdge R760 sur ESXi-01** », « FW-02 est passif », « Marque ESXi-03 en maintenance », « Crée le VLAN 60 nom Vidéo sous-réseau 10.10.60.0/24 », « Fige la position de FW-01 » |
| **En lot** | « **Sélectionne tous les postes de travail** », « **Mets tous les postes de travail dans la zone Bâtiment A** », « Marque toutes les bornes Wi-Fi en maintenance », « Supprime tous les téléphones IP » |
| **Déplacer et lire** | « Déplace FW-01 vers la droite de 200 », « Placement automatique », « Vue couche 2 », « Synthèse », « Replie la zone Datacenter », « Déplie tout », « De gauche à droite », « Masque la grille », « Va à SAN Siège », « Zoom arrière » |
| **Parc et baies** | « Ouvre l'inventaire », « Montre les baies », « Implante SW-DIST-BATA dans la baie A1 », « Retire PDU B de la baie », « Mets la hauteur 2 sur ESXi-01 » |
| **Questions** | « Combien d'équipements ? », « Combien de pare-feu ? », « Quel est le score de haute disponibilité ? », « Y a-t-il des points de défaillance ? », « Quelle est la consommation ? », « Combien de U libres dans la baie A1 ? » |
| **Projet** | « Exporte en PNG », « Enregistre le projet », « Charge l'exemple », « Titre : Architecture agence », « Annule », « Rétablis » |

Tout ce qui se fait à la souris se dicte : **créer, modifier, supprimer** n'importe quel
composant — cœurs de réseau, switches, pare-feu, serveurs, bornes, baies, liaisons — et les
modifications s'appliquent aussi **en lot** (« tous les … ») ou à la sélection courante.
Une phrase de création accepte le nom et les attributs d'un coup : type, nom, IP, zone, site,
grappe, VLAN, baie d'implantation et équipement à raccorder.

Les **questions** reçoivent une vraie réponse, lue à voix haute : « Robustesse : 68 sur 100,
niveau Fragile, 8 constats », « 1 point de défaillance : SW-DIST-BATA », « Baie A1 : 23 U
libres ».

Quelques détails qui comptent à l'usage : les valeurs écrites dans une fiche — un nom, un
titre, une adresse — gardent la **casse d'origine** (« SW-CORE-A », pas « sw-core-a ») ; les
noms d'équipements se retrouvent **sans tenir compte des accents** ; les types se reconnaissent
**au pluriel comme au singulier** (« tous les postes de travail », « les bornes wifi ») ; et
les adresses IP gardent leurs points malgré la ponctuation de la dictée.

### Être compris du premier coup

La reconnaissance du navigateur rend rarement une phrase technique telle qu'on l'a dite. Six
mécanismes rattrapent l'écart, entre le micro et la grammaire :

- **Phrase reconstituée** : la reconnaissance découpe une phrase en plusieurs segments ; ils
  sont accumulés et la commande n'est exécutée qu'après un court silence, ce qui évite qu'une
  instruction soit coupée en deux. L'écoute redémarre toute seule tant que le micro est actif.
- **Plusieurs transcriptions par phrase** : le navigateur en propose jusqu'à cinq ; elles sont
  essayées, segment par segment, et la première combinaison comprise est retenue.
- **Nombres dictés** : « dix point dix point zéro point onze » devient `10.10.0.11`, « zéro
  deux » devient `02`, « cent quatre-vingt-douze » devient `192`, « slash vingt-quatre »
  devient `/24`. « un » reste l'article dans « ajoute un serveur », et redevient un nombre
  après « VLAN » ou « U ».
- **Sigles épelés** : « S W core zéro un » est recollé en « SW-CORE-01 ».
- **Correspondance approximative** : « pare-fou » retombe sur *Pare-feu*, « switche » sur
  *Switch*, et un nom d'équipement mal entendu est rapproché du plus ressemblant (distance
  d'édition, accents et séparateurs ignorés). La palette, elle, reste sur la recherche stricte.
- **Propositions** : quand une phrase n'est pas comprise, le panneau affiche les commandes les
  plus proches — un clic les exécute.

Le même panneau accepte les **commandes tapées** : c'est le repli quand le navigateur n'a pas
de reconnaissance vocale (Firefox), quand le micro est refusé, ou dans un local bruyant — et
c'est aussi ce qui rend la grammaire testable sans microphone.

Une phrase non reconnue n'est jamais exécutée au hasard : elle est signalée telle quelle.

## Guide intégré

Onglet **Guide**, ou « ouvre le guide » à la voix, ou encore « comment ça marche ». Le mode
d'emploi vit dans l'application plutôt que dans un fichier à côté :

- **treize sections** — prise en main, les quatre modules, construction du schéma, liaisons et
  couches OSI, haute disponibilité, simplification d'une architecture complexe, commande
  vocale, imports et exports, découverte, inventaire et baies, catalogue, raccourcis clavier,
  dépannage ;
- une **recherche** insensible aux accents (« decouverte », « export », « micro ») ;
- des **exemples vocaux cliquables** : le clic exécute la commande pour de vrai, l'application
  bascule sur le module concerné et répond ;
- des **renvois directs** : charger le schéma d'exemple, ouvrir l'analyse de haute
  disponibilité, le panneau OSI, le catalogue ou l'import rapide.

La section *Commande vocale* rassemble les conseils de dictée, et la section *Dépannage* les
cas qui reviennent : micro refusé, navigateur sans reconnaissance vocale, schéma introuvable
après un nettoyage du navigateur, export tronqué par un niveau de détail, import draw.io
pauvre en types.

## Trois modes de visualisation

Le même schéma ne se montre pas de la même façon selon qu'on le construit, qu'on le
documente ou qu'on le projette. Le sélecteur de la barre d'outils (également dans
*Mise en page*) bascule entre trois modes, sans jamais toucher au modèle :

| Mode | Pour quoi faire | Ce qui change |
| --- | --- | --- |
| **Architecture** | Le mode de travail | Nom, adresse, VLAN, modèle et zone dans la boîte ; cadres de groupes ; grille et noms de couches |
| **Technique** | La documentation d'exploitation | Boîtes compactes, numéro de série et responsable en plus, étiquette sur chaque liaison même hors vue OSI, traits fins |
| **Présentation** | Projeter, coller dans un document | Noms seuls en grand, traits épais, ni grille ni détail technique ni nom de couche |

Chaque mode applique un jeu de réglages d'affichage ; les cases restent modifiables ensuite.
À la voix : « mode présentation », « vue technique », « mode architecture ».

## Liaisons superposées

Deux câbles qui se superposent, c'est pire qu'un croisement : le croisement se voit, la
superposition se cache — on ne voit qu'un trait là où il y en a quatre, et le schéma ment.
Par défaut, l'application l'empêche :

- **Répartition des accroches** — les liaisons qui quittent un équipement par le même côté
  sont réparties le long de l'arête, **dans l'ordre de leurs destinations** : celle qui part le
  plus à gauche sort le plus à gauche, donc sans se croiser entre elles.
- **Couloirs** — celles qui emprunteraient malgré tout le même axe sur une portion commune
  sont rangées dans des couloirs voisins, comme des câbles dans un chemin de câbles. C'est un
  coloriage de graphe d'intervalles : une liaison qui ne gêne personne garde le couloir
  central, les autres s'écartent de part et d'autre.
- **Ce que vous avez tracé ne bouge pas** — une liaison avec des points de passage ou une
  accroche posée à la main garde exactement son tracé, et les autres s'écartent autour d'elle.
  Superposer deux liaisons reste donc possible : c'est alors une décision, pas un accident.
- **Mesure** — le compteur en bas du plan indique combien de couples de liaisons restent
  confondus. Sur le schéma d'exemple : **79 sans le mécanisme, 6 avec**.
- La case *Mise en page → Écarter les liaisons superposées* (ou « masque les superpositions »
  à la voix) rend l'ancien comportement.

## Info-bulle et verrous

### Le détail au survol

Le schéma ne montre qu'une partie de ce qu'une liaison documente — c'est ce qui le garde
lisible. Le survol donne le reste, sans rien ouvrir ni déplacer : type et couches OSI, débit,
libellé, sous-réseau, VRF, protocole de routage, MTU, liaison de secours, puis **la
configuration de chaque extrémité côte à côte** (port, mode, VLAN, VLAN natif, agrégat, rôle
spanning-tree, adresse d'interface). L'info-bulle se place du côté où il reste de la place et
n'apparaît pas pendant un glisser.

### Deux verrous

Enregistrés **avec le schéma** : ils suivent le document, y compris après un export/import.

| Verrou | Ce qu'il empêche | Ce qui reste possible |
| --- | --- | --- |
| **Schéma** (`Verrouiller`) | Tout ce qui modifie le document : déplacer, ajouter, relier, supprimer, importer, disposer — à la souris, au clavier, à la voix | Naviguer, zoomer, replier, changer de mode ou de vue OSI, consulter les fiches, interroger, exporter |
| **Étiquettes** | Le replacement automatique et le déplacement des étiquettes | Tout le reste |

Le verrou du schéma est une **barrière unique posée dans le magasin d'état**, pas un
grisage de boutons : la voix, les raccourcis clavier, le glisser-déposer et les imports
passent tous par là. À la voix : « verrouille le schéma », « déverrouille les étiquettes ».

Verrouiller les étiquettes **inscrit leur position calculée dans le schéma** : elles ne
bougent plus, même si le schéma change autour d'elles.

## Étiquettes des liaisons

Une étiquette qui en recouvre une autre ne dit plus rien — et fait pire, elle fait croire
qu'on lit la valeur d'une liaison alors qu'on lit celle d'à côté. Elles sont donc placées,
pas seulement posées :

- chaque étiquette (débit, VLAN, port, adresse) se pose **à côté du trait**, au plus près de
  son point d'ancrage, à un emplacement qui ne recouvre **ni une boîte ni une autre
  étiquette** — l'application essaie des positions de plus en plus éloignées, de part et
  d'autre du trait puis le long de celui-ci, et retient la première libre ;
- quand la place manque vraiment, elle retient le moindre recouvrement plutôt que d'empiler ;
- **glissez une étiquette** pour la mettre où vous voulez : un trait de rappel en pointillés
  la relie à sa liaison, elle suit l'équipement quand il se déplace, et les autres se replacent
  autour d'elle (une étiquette déplacée à la main est posée en premier) ;
- **double-clic** dessus pour revenir au placement automatique ; *Tracé auto* remet aussi les
  étiquettes de la liaison à leur place.

Sur le schéma d'exemple : **0 recouvrement** sur les 30 étiquettes de la vue d'ensemble, 6 sur
les 66 de la vue L2 (contre 41 avant).

## Croisements de liaisons

Deux traits qui se coupent sans rien indiquer se lisent comme un raccordement : on croit voir
une patte là où il n'y a qu'un croisement. NetSchema applique la convention des schémas
électriques — **la liaison du dessus enjambe l'autre par un petit pont**.

- Les croisements sont recalculés à chaque changement du schéma, segment par segment.
- Deux liaisons branchées sur le même équipement ne comptent pas comme un croisement à leurs
  abords : elles se rejoignent, c'est normal.
- Le pont revient à la liaison dessinée en dernier, celle qui passe visuellement au-dessus :
  le dessin dit la même chose que l'ordre d'empilement.
- Tous les ponts bombent du même côté, quel que soit le sens de parcours de la liaison.
- Le compteur en bas à droite du plan (« 4 croisement(s) enjambé(s) ») est un bon indicateur
  de lisibilité : moins il y en a, mieux le schéma est rangé.
- Se coupe dans *Mise en page → Enjamber les croisements de liaisons*, ou à la voix
  (« masque les croisements »).

## Tracé des liaisons

Le tracé automatique convient tant que le schéma reste rangé en couches ; dès qu'on veut
faire passer une liaison ailleurs, il faut pouvoir la prendre en main.

- **Poser un point de passage** : tirez le trait à l'endroit voulu, ou tirez l'une des
  poignées claires posées au milieu de chaque segment de la liaison sélectionnée. La
  liaison passe alors par ce point.
- **Déplacer** un point : glissez sa poignée bleue (aimantée à la grille si l'option est
  active). **Supprimer** : double-clic dessus.
- **Forme**, liaison par liaison (inspecteur → *Tracé*) : comme le schéma, orthogonale,
  directe ou **courbe**. Le réglage global reste dans *Mise en page*.
- **Côté d'accroche** imposé au départ et à l'arrivée : dessus, dessous, gauche, droite —
  ou automatique. C'est ce qui permet de faire sortir deux liaisons par des faces
  différentes du même équipement.
- **Tracé auto** (bouton de l'inspecteur) efface points de passage, forme et accroches.
- À la voix : « Tracé courbe », « Réinitialise le tracé » sur la liaison sélectionnée.

### Où la liaison se branche

Le côté ne suffit pas toujours : sur un même bord, deux liaisons se superposent et l'on veut
parfois brancher *là*, précisément. Les deux extrémités de la liaison sélectionnée sont donc
des poignées (carrés verts) :

- **Glissez une extrémité sur la boîte d'un équipement** : elle s'accroche à l'endroit exact
  désigné, n'importe où sur le pourtour. Le point est mémorisé en proportion de la boîte : il
  suit l'équipement quand on le déplace et reste juste quel que soit le zoom.
- **Glissez-la sur un *autre* équipement** : la liaison change de destination sans être
  supprimée ni recréée — ses attributs (type, VLAN, débit, ports) sont conservés.
- **Aimantation** : à quelques pixels du milieu d'une arête, le point s'y cale, pour retrouver
  facilement l'accroche « propre » d'un schéma rangé.
- **Amorce** : une accroche choisie à la main fait sortir la liaison perpendiculairement à la
  boîte sur quelques pixels avant de repartir. Sans elle, une accroche prise à revers ferait
  traverser l'équipement au trait.
- **Double-clic** sur une extrémité, ou bouton *Accroches auto* : retour au calcul
  automatique. À la voix : « Accroches automatiques ».
- **À la création** : en mode *Relier* (`L`), un clic près d'un bord fixe l'accroche de ce
  côté ; un clic au centre laisse l'application choisir.

Les poignées sont dessinées au-dessus des équipements : un point de passage posé sur une
boîte reste attrapable. Elles n'apparaissent jamais dans les exports, et une liaison reportée
sur un bloc replié retrouve un tracé automatique — son tracé manuel ne vaut que pour ses
extrémités d'origine.

## Premier plan, arrière-plan

Deux boîtes qui se chevauchent, un équipement posé sur un cadre de zone, une grappe dense :
c'est l'ordre d'empilement qui décide de ce qu'on voit. Il se règle pour la sélection —
un équipement ou plusieurs, qui se déplacent alors d'un bloc :

| Action | Inspecteur | Clavier | Voix |
| --- | --- | --- | --- |
| Premier plan | *Plan d'affichage → Premier plan* | `Ctrl+Maj+F` | « Mets FW-01 au premier plan » |
| Arrière-plan | *Plan d'affichage → Arrière-plan* | `Ctrl+Maj+B` | « Place SW-ACC-A1 en arrière-plan » |
| Avancer d'un cran | *Plan d'affichage → Avancer* | `]` | « Avance FW-01 » |
| Reculer d'un cran | *Plan d'affichage → Reculer* | `[` | « Recule FW-01 » |

L'ordre est celui du schéma, pas de la vue : il est enregistré avec le projet et respecté à
l'export SVG et PNG. Les cadres de sites, de zones et de grappes restent toujours derrière les
équipements, et les liaisons sous les boîtes qu'elles relient.

## Niveaux 2 et 3 du modèle OSI

Un schéma d'infrastructure ne dit pas la même chose selon la couche regardée : le même
câble est un lien physique, un trunk 802.1Q et une interconnexion IP. L'application
documente les trois et bascule d'une lecture à l'autre **sans redessiner quoi que ce soit**.

### La vue OSI

Sélecteur dans la barre d'outils (ou `Ctrl+K` → « Vue OSI ») :

| Vue | Au milieu du trait | À chaque extrémité, côté équipement |
| --- | --- | --- |
| **Toutes couches** | Libellé libre et débit — la vue de travail | — |
| **L1 — physique** | Débit | Interface branchée (`Te1/0/1`) |
| **L2 — liaison** | MTU | Port, mode et VLAN (`T 20,40,50`, `A 20`), VLAN natif, agrégat, rôle spanning-tree |
| **L3 — réseau** | Sous-réseau, VRF, protocole de routage | Adresse de l'interface |

### Chaque bout de câble, de son côté

Un port et sa configuration n'appartiennent pas à la liaison mais à l'équipement où elle est
branchée. Au milieu du trait, « Gi1/0/1 ↔ Gi0/1 » oblige à deviner lequel est de quel côté, et
il n'y a pas de place pour dire que le trunk est racine ici et bloquant là. Chaque extrémité
porte donc sa propre étiquette, posée à la sortie de la boîte concernée — c'est ainsi que se
lisent les plans de brassage.

L'inspecteur d'une liaison suit le même découpage : les valeurs **communes aux deux
extrémités** (mode, VLAN, VLAN natif, MTU), puis un bloc **par côté**, nommé d'après
l'équipement (« Côté SW-CORE-01 », « Côté SW-DIST-BATA »), avec port, mode, VLAN, VLAN natif,
agrégat et rôle spanning-tree. Un champ laissé vide **hérite** de la valeur commune — affichée
en filigrane — de sorte qu'on ne saisit que ce qui diffère vraiment d'un équipement à l'autre :

- le **rôle spanning-tree**, qui diffère presque toujours (racine d'un côté, désigné ou
  alternatif de l'autre) ;
- le nom du **port-channel**, local à chaque châssis (`Po10` côté cœur, `Po1` côté
  distribution) ;
- un **trunk plus restreint** d'un côté que de l'autre ;
- le **VLAN natif**, quand il n'est pas symétrique.

*Inverser le sens* échange les deux côtés d'un bloc, configuration comprise.

En vue L2, une liaison qui ne transporte qu'un seul VLAN prend **la couleur de ce VLAN** :
les domaines de diffusion se lisent d'un coup d'œil.

Ce qui n'appartient pas à la couche regardée est **estompé** (l'alimentation disparaît
visuellement en L2, les commutateurs en L3) tout en gardant le contexte du schéma. La case
*Masquer ce qui n'est pas de cette couche* passe en vue stricte : les équipements et les
liaisons hors couche sont retirés, et un équipement qui n'a plus aucune liaison de cette
couche l'est aussi — on obtient un vrai schéma de niveau 3, réduit aux éléments routés.

### Ce qu'une liaison peut porter

Chaque liaison déclare les couches qu'elle documente (par défaut celles de son type : un
câble cuivre porte L1 et L2, un tunnel VPN seulement L3, un overlay VXLAN L2 au-dessus de L3)
puis, couche par couche :

- **L1** — interfaces de départ et d'arrivée, débit, type de média ;
- **L2** — mode du port (accès / trunk), VLAN transportés (`10,20,30-39`), VLAN natif,
  agrégat LACP (`Po1`), rôle spanning-tree (racine, désigné, alternatif, bloquant,
  port d'extrémité), MTU — chacun de ces champs (sauf le MTU) pouvant être précisé
  **extrémité par extrémité** ;
- **L3** — sous-réseau en CIDR, adresse de chaque extrémité, VRF, protocole de routage
  (statique, OSPF, BGP, EIGRP, IS-IS, RIP).

Les types de liaison eux-mêmes couvrent le cuivre, la fibre, le trunk/agrégat LACP, le
stack/MLAG/VSS, le lien WAN/MPLS, le tunnel VPN, le sans-fil, l'**overlay VXLAN/SD-WAN**, le
battement de cœur HA, la réplication, l'administration hors bande et l'alimentation.

### Plan d'adressage et contrôles

L'onglet **L2/L3** tient la table des VLAN — numéro, nom, sous-réseau, passerelle, couleur —
qui fait le lien entre le schéma de niveau 2 et celui de niveau 3. *Déduire du schéma*
reprend tous les VLAN déjà cités sur les équipements et les liaisons.

Les contrôles de cohérence tournent en continu :

- VLAN utilisé mais absent du plan d'adressage ;
- sous-réseau en notation invalide, ou partagé par deux VLAN ;
- passerelle hors de son sous-réseau ;
- adresse d'un équipement hors du sous-réseau de son VLAN ;
- adresse d'extrémité de liaison hors du sous-réseau de la liaison ;
- trunk sans VLAN déclarés, liaison de niveau 3 sans adressage ;
- MTU divergents entre les membres d'un même agrégat ;
- **boucle de niveau 2** : cycle entre commutateurs sans aucun rôle spanning-tree documenté.

Un clic sur un constat sélectionne les équipements et les liaisons concernés.

## Catalogue d'équipements

Le catalogue est décrit **en données, pas en code** : un type d'équipement est une ligne
(identifiant, libellé, couche, famille, pictogramme, synonymes de recherche) qui désigne un
pictogramme du registre d'icônes. Ajouter une technologie ne demande donc ni composant à
écrire, ni dessin, ni compilation.

### Ce qu'il contient (version 2026.1, 5 lots embarqués, ~76 types)

| Lot | Contenu |
| --- | --- |
| **Socle réseau** | Internet, opérateur, routeur, pare-feu, répartiteur, switches cœur / distribution / accès, Wi-Fi, serveur, hyperviseur, stockage, sauvegarde, témoin, postes, onduleur, PDU |
| **Réseau moderne** | Boîtier SD-WAN, point de présence SASE/SSE, CDN / edge, filtrage anti-DDoS, routeur 5G/LTE, liaison satellite, multiplexeur DWDM, switches **spine** et **leaf** (fabric VXLAN/EVPN), TAP / packet broker, borne **Wi-Fi 7**, passerelle API, maillage de services, DNS/DHCP/IPAM, serveur de temps NTP/PTP |
| **Sécurité & Zero Trust** | NGFW, WAF, IDS/IPS, **ZTNA**, passerelle SSE (SWG/CASB), sécurité de la messagerie, NAC 802.1X, bastion, PAM, identité/SSO/MFA, SIEM, SOAR, EDR/XDR, HSM, autorité de certification, scanner de vulnérabilités, DLP, MDM/UEM, leurre |
| **Cloud & conteneurs** | Région cloud, VPC, interconnexion cloud, cluster Kubernetes, plan de contrôle et nœuds K8s, registre d'images, fonction serverless, file de messages, base managée, stockage objet, **serveur GPU / IA**, agent CI/CD |
| **Datacenter & salle** | Nœud hyperconvergé, bare metal, baie NVMe / NVMe-oF, sauvegarde immuable / bande, baie, supervision NMS, caméra IP, groupe électrogène, climatisation |

Un sixième lot, **OT / industriel** (automate, SCADA, passerelle IT/OT, capteur IoT), est livré
dans `public/catalog/` : il n'est pas compilé dans l'application mais chargé au démarrage —
c'est la démonstration du mécanisme de mise à jour.

### Trois façons de le mettre à jour

1. **Déposer un fichier** — un lot `.json` dans le dossier `catalog/` livré à côté de
   l'application, référencé dans `catalog/index.json`. Rechargez la page : les nouveaux types
   sont là. Aucune recompilation, aucun déploiement applicatif.
2. **Pointer une source distante** — onglet *Catalogue* → *Source distante* : l'URL d'un
   dossier contenant `index.json` (serveur interne, dépôt d'entreprise), puis
   *Vérifier les mises à jour*. Chaque poste suit ainsi le catalogue de l'organisation.
3. **Créer ou importer depuis l'application** — onglet *Catalogue* : créer un type maison
   (nom, famille, couche, pictogramme choisi dans une grille, synonymes), importer un lot reçu
   d'un collègue, exporter ses propres types pour les partager.

Un schéma qui référence un type absent du poste reste ouvrable et modifiable : le type
inconnu s'affiche avec un pictogramme neutre plutôt que de disparaître.

Format d'un lot :

```json
{
  "id": "mon-lot",
  "title": "Équipements maison",
  "version": "2026.1",
  "devices": [
    {
      "id": "passerelle-edi",
      "label": "Passerelle EDI",
      "rank": 2,
      "icon": "gateway-api",
      "family": "Métier",
      "aliases": ["edi", "b2b"],
      "infrastructure": true,
      "critical": true
    }
  ]
}
```

`rank` est la couche (0 Internet/WAN → 8 énergie), `icon` un identifiant du registre
(la grille de l'onglet *Catalogue* les montre tous), `infrastructure` et `critical` font
entrer le type dans l'analyse de haute disponibilité.

## Simplifier une architecture complexe

Les outils pensés pour que trente ou cent équipements restent lisibles :

- **Recherche dans la palette** — « k8s », « waf », « fortigate », « borne » : les types
  répondent à leurs synonymes, pas seulement à leur nom exact.
- **Palette de commandes `Ctrl+K`** — une seule entrée pour tout : lancer une action, ajouter
  n'importe quel type du catalogue, ou retrouver un équipement du schéma et s'y rendre.
- **Repli des groupes** — un site, une zone ou une grappe se replie en **un bloc unique**
  portant le nombre d'équipements qu'il contient ; les liaisons internes disparaissent, les
  liaisons externes sont reportées sur le bloc et dédoublonnées. Double-clic pour l'ouvrir.
  Les rangées vidées sont resserrées automatiquement.
- **Niveau de détail** — *complet*, *sans les postes ni l'énergie*, *synthèse* (jusqu'à la
  distribution) : trois vues du même schéma, sans rien supprimer.
- **Import rapide `Ctrl+I`** — coller une liste plutôt que poser les équipements un par un.
  Le type accepte l'identifiant, le libellé ou un synonyme ; absent, il est deviné d'après le
  nom (`SW-…` → switch, `FW-…` → pare-feu). Un équipement déjà présent est retrouvé par son
  nom et mis à jour au lieu d'être dupliqué.

  ```
  SW-CORE-01 ; switch cœur ; ip=10.10.0.11 ; site=Siège ; cluster=CORE-MLAG ; role=aa
  FW-01 -> SW-CORE-01 : fibre 10 Gb/s subnet=10.0.0.0/29 ipa=10.0.0.2 ipb=10.0.0.5 routage=ospf
  SW-CORE-01 -> SW-DIST-A : fibre vlans=20,40,50 mode=trunk lag=Po10 mtu=9000 stp=racine
  FW-02 -> SW-CORE-01 : fibre !          # « ! » = liaison de secours
  ```

  Les champs de niveau 1, 2 et 3 s'écrivent directement sur la ligne de liaison :
  `porta=`, `portb=`, `debit=`, `vlans=`, `mode=`, `natif=`, `lag=`, `mtu=`, `stp=`,
  `subnet=`, `ipa=`, `ipb=`, `vrf=`, `routage=`.

- **Type de liaison déduit** — deux pare-feu d'une même grappe se relient par un battement de
  cœur, deux switches cœur par un lien de pile, un onduleur par une liaison électrique. Le
  type reste modifiable.
- **Duplication `Ctrl+D`** — le nom est incrémenté (SW-ACC-A1 → SW-ACC-A2) et les liaisons
  internes à la sélection sont dupliquées.
- **Modèles d'architecture** — sept blocs HA prêts à insérer (voir plus bas).

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
| Tout faire au clavier | `Ctrl+K` — commandes, ajout d'équipement, recherche dans le schéma |
| Importer une liste | `Ctrl+I` |
| Dupliquer | `Ctrl+D` |
| Ouvrir un bloc replié | Double-clic dessus |
| Premier plan / arrière-plan | `Ctrl+Maj+F` / `Ctrl+Maj+B` · `]` / `[` pour un cran |
| Changer de mode de visualisation | Sélecteur de la barre d'outils, ou « mode présentation » à la voix |
| Brancher une liaison où l'on veut | Glisser un carré vert de la liaison sélectionnée sur un équipement |
| Déplacer une étiquette | Glisser l'étiquette · double-clic pour la replacer automatiquement |
| Voir tout le détail d'une liaison | La survoler |
| Figer le schéma | Bouton **Verrouiller** · « verrouille le schéma » à la voix |
| Retrouver comment faire | Onglet **Guide**, ou « ouvre le guide » à la voix |

Chaque équipement porte un nom, un type, un modèle, une IP, un VLAN, une zone, un site, des
notes et ses attributs de haute disponibilité (grappe, rôle, VIP, double alimentation) ;
chaque liaison un type, un libellé, un débit, un indicateur « liaison de secours » et ses
attributs de niveau 1, 2 et 3 (voir *Niveaux 2 et 3 du modèle OSI*).

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
  lib/catalogData.ts    lots d'équipements embarqués (données pures, pas de code)
  lib/catalog.ts        registre du catalogue : lots chargés, recherche, couleurs, liaisons
  lib/catalogSource.ts  mise à jour du catalogue (dossier catalog/, source distante, lots locaux)
  lib/icons.tsx         registre de pictogrammes SVG, désignés par identifiant
  lib/derive.ts         vue dérivée : niveau de détail, repli des groupes, couche OSI, compactage
  lib/osi.ts            couches des liaisons, libellés par couche, plan d'adressage, contrôles L2/L3
  lib/linkRules.ts      type de liaison déduit des deux équipements reliés
  lib/quickImport.ts    import rapide par collage de texte
  lib/layout.ts         placement automatique par couches, cadres de groupes, cadrage
  lib/ha.ts             analyse haute disponibilité (points d'articulation + règles métier)
  lib/patterns.ts       bibliothèque de modèles d'architectures redondées
  lib/routing.ts        tracé des liaisons : automatique, points de passage, accroches libres, courbes
  lib/crossings.ts      croisements à enjamber (ponts) et détection des superpositions
  lib/spread.ts         répartition des accroches et couloirs, pour ne pas superposer les liaisons
  lib/labels.ts         placement des étiquettes de liaison sans recouvrement
  lib/viewModes.ts      modes de visualisation : architecture, technique, présentation
  lib/exportImage.ts    export SVG / PNG
  lib/storage.ts        sauvegarde locale, lecture/écriture des fichiers projet
  lib/sample.ts         schéma d'exemple (architecture HA siège + site de secours, baies, parc)
  lib/discovery.ts      reconnaissance et analyse des relevés LLDP/CDP, nmap et ARP
  lib/inventory.ts      colonnes de l'inventaire, export et import CSV
  lib/racks.ts          occupation des baies, hauteurs, chevauchements
  lib/voice.ts          grammaire des commandes vocales et reconnaissance du navigateur
  lib/speech.ts         préparation de la dictée : nombres, sigles épelés, correspondance approchée
  lib/vendors.ts        base de matériels constructeurs (≈145 références)
  lib/drawio.ts         import des schémas draw.io / diagrams.net
  store/useDiagram.ts   état global (zustand) : schéma, sélection, vue, historique
  store/useAudit.ts     analyse HA mémorisée sur la version courante du schéma
  components/           barre d'outils, palette, plan de travail, inspecteur, panneaux HA,
                        L2/L3 et catalogue, palette de commandes, import rapide, guide intégré
public/catalog/         lots chargés au démarrage — la voie de mise à jour sans recompilation
tools/collector/        collecteur de découverte réseau (Node, sans dépendance) et exemples
```

## Limites connues

- Les contrôles L2/L3 ne lisent que ce qui est saisi dans le schéma : ils ne comparent pas
  l'adressage documenté aux configurations réelles des équipements.
- L'analyse raisonne sur la topologie telle qu'elle est dessinée : elle ne connaît ni les
  chemins physiques réels des fibres, ni les configurations des équipements. Deux liens
  « redondants » passant dans le même fourreau lui paraîtront redondants.
- La découverte interprète des relevés : elle ne sonde pas le réseau depuis le navigateur.
  La collecte passe par le collecteur fourni ou par un copier-coller, et un balayage nmap seul
  donne des hôtes sans liaisons — seuls LLDP et CDP donnent la topologie.
- Les caractéristiques de la base matériels sont indicatives : hauteurs de châssis fiables,
  puissances en ordre de grandeur. Vérifiez-les pour un dimensionnement électrique réel.
- L'import draw.io reprend la première page du fichier et déduit les types des stencils :
  un schéma dessiné avec des formes génériques donnera des types génériques.
- La reconnaissance vocale dépend du navigateur (Chrome, Edge) et de sa connexion aux services
  de reconnaissance ; les commandes tapées fonctionnent partout.
- Les pictogrammes sont dessinés pour cette application : ce ne sont pas les jeux d'icônes des
  constructeurs ou des fournisseurs cloud, et ils ne cherchent pas à les imiter.
- Pas d'export PPTX ni PDF pour l'instant (le SVG s'insère tel quel dans PowerPoint et Word).
