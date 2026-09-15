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
**commandes vocales**. Un serveur posé dans une baie est le même objet que celui câblé sur le
schéma et listé à l'inventaire.

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
| **Construire** | « Ajoute un pare-feu », « Ajoute un cluster Kubernetes », « Relie SW-CORE-01 à FW-01 **en fibre** », « Insère le modèle pare-feu actif passif », « Duplique », « Supprime SW-ACC-B1 » |
| **Renseigner** | « Renomme SW-CORE-01 en SW-CORE-A », « Mets l'IP 10.10.0.11 sur SW-CORE-A », « La zone de FW-01 est DMZ », « FW-02 est passif », « Marque ESXi-03 en maintenance », « Crée le VLAN 60 nom Vidéo sous-réseau 10.10.60.0/24 », « Fige la position de FW-01 » |
| **Lire le schéma** | « Placement automatique », « Vue couche 2 », « Synthèse », « Replie la zone Datacenter », « Déplie tout », « De gauche à droite », « Liaisons droites », « Masque la grille », « Affiche les zones », « Va à SAN Siège », « Zoom arrière » |
| **Parc et baies** | « Ouvre l'inventaire », « Montre les baies », « Implante SW-DIST-BATA dans la baie A1 », « Retire PDU B de la baie » |
| **Questions** | « Combien d'équipements ? », « Combien de pare-feu ? », « Quel est le score de haute disponibilité ? », « Y a-t-il des points de défaillance ? », « Quelle est la consommation ? », « Combien de U libres dans la baie A1 ? » |
| **Projet** | « Exporte en PNG », « Enregistre le projet », « Charge l'exemple », « Titre : Architecture agence », « Annule », « Rétablis » |

Les **questions** reçoivent une vraie réponse, lue à voix haute : « Robustesse : 68 sur 100,
niveau Fragile, 8 constats », « 1 point de défaillance : SW-DIST-BATA », « Baie A1 : 23 U
libres ».

Deux détails qui comptent à l'usage : les valeurs écrites dans une fiche — un nom, un titre,
une adresse — gardent la **casse d'origine** (« SW-CORE-A », pas « sw-core-a »), et les noms
d'équipements se retrouvent **sans tenir compte des accents** (« va à SAN Siège » fonctionne
sur une dictée sans accent).

La reconnaissance s'appuie sur celle du navigateur (Chrome ou Edge, connexion réseau
requise). Le même panneau accepte les **commandes tapées** : c'est le repli quand le
navigateur n'a pas de reconnaissance vocale, quand le micro est refusé, ou dans un local
bruyant — et c'est aussi ce qui rend la grammaire testable.

Une phrase non reconnue n'est jamais exécutée au hasard : elle est signalée telle quelle.

## Niveaux 2 et 3 du modèle OSI

Un schéma d'infrastructure ne dit pas la même chose selon la couche regardée : le même
câble est un lien physique, un trunk 802.1Q et une interconnexion IP. L'application
documente les trois et bascule d'une lecture à l'autre **sans redessiner quoi que ce soit**.

### La vue OSI

Sélecteur dans la barre d'outils (ou `Ctrl+K` → « Vue OSI ») :

| Vue | Ce que portent les libellés des liaisons |
| --- | --- |
| **Toutes couches** | Libellé libre et débit — la vue de travail |
| **L1 — physique** | Débit et interfaces (`Te1/0/1 ↔ port2`) |
| **L2 — liaison** | Mode et VLAN (`T 20,40,50`, `A 20`), VLAN natif, agrégat LACP, rôle spanning-tree, MTU |
| **L3 — réseau** | Sous-réseau, adresses des deux extrémités, VRF, protocole de routage |

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
  port d'extrémité), MTU ;
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
  lib/routing.ts        tracé des liaisons (orthogonal arrondi, étalement des parallèles)
  lib/exportImage.ts    export SVG / PNG
  lib/storage.ts        sauvegarde locale, lecture/écriture des fichiers projet
  lib/sample.ts         schéma d'exemple (architecture HA siège + site de secours, baies, parc)
  lib/discovery.ts      reconnaissance et analyse des relevés LLDP/CDP, nmap et ARP
  lib/inventory.ts      colonnes de l'inventaire, export et import CSV
  lib/racks.ts          occupation des baies, hauteurs, chevauchements
  lib/voice.ts          grammaire des commandes vocales et reconnaissance du navigateur
  lib/vendors.ts        base de matériels constructeurs (≈145 références)
  lib/drawio.ts         import des schémas draw.io / diagrams.net
  store/useDiagram.ts   état global (zustand) : schéma, sélection, vue, historique
  store/useAudit.ts     analyse HA mémorisée sur la version courante du schéma
  components/           barre d'outils, palette, plan de travail, inspecteur, panneaux HA,
                        L2/L3 et catalogue, palette de commandes, import rapide
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
