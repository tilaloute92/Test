# Plan Relief

Bibliothèque de plans de bâtiments partagée par l'équipe : on y dépose les plans DXF ou PDF,
ils sont conservés sur le serveur, et les équipements qu'ils contiennent (switchs, baies,
bornes Wi-Fi, caméras, prises…) deviennent recherchables. Chaque plan s'affiche en maquette
3D, l'équipement recherché y est pointé.

Installation, sécurisation et connexion identiques à **Suivi Infra & Réseau** (mode
client/serveur) : voir [`packaging/INSTALL.md`](packaging/INSTALL.md) et
[`DEPLOYMENT.md`](DEPLOYMENT.md).

## Fonctionnalités

- **Plans en stock** : import DXF (ASCII) ou PDF vectoriel, jusqu'à 100 Mo. Chaque plan a une
  fiche (site, bâtiment, étage, notes) ; le fichier d'origine est conservé tel quel et
  téléchargeable. Un fichier déjà en stock est signalé. Retirer un plan le déplace dans la
  corbeille du serveur.
- **Équipements détectés à l'import** (DXF) : chaque **bloc inséré** (son nom devient le type :
  `SWITCH`, `BORNE_WIFI`…) avec ses **attributs** (`REPERE`, `MODELE`, `SERIE`…) ; le repère
  sert de nom.
- **Indications lues sur les plans**, toutes recherchables :

  | Source | Ce qui est lu |
  | --- | --- |
  | DXF | Textes (TEXT, MTEXT, sur plusieurs lignes), **étiquettes à flèche** (MULTILEADER), **cotes annotées** (texte ajouté à une cote, ex. « <> HSP sous faux plafond ») |
  | PDF | Texte de la page, les lignes d'un même bloc réunies (« Local serveur » / « climatisation CLIM-4 » → une indication) |
  | PDF | **Commentaires et annotations** (Acrobat, Bluebeam, Foxit…) : texte, auteur, objet |
  | PDF scanné ou texte en traits | **Lecture OCR** (reconnaissance de caractères), proposée d'office quand la page contient peu de texte. Tourne dans le navigateur, avec un modèle français servi par le site : rien n'est envoyé à l'extérieur. Fiabilité de chaque lecture conservée. |

  Les cotes chiffrées seules (« 3.50 ») et les textes d'un seul caractère sont écartés.
- **Rattachement aux équipements** : chaque indication est aussi rattachée au bloc ou à
  l'équipement ajouté à la main le plus proche (moins de 1,5 m). Chercher ce qui est écrit à
  côté d'un équipement le fait ressortir : « onduleur » trouve le switch près duquel est écrit
  « Cisco 9200 secours - onduleur UPS-2 », même si le bloc n'a aucun attribut.
- **Relire les indications** d'un plan déjà en stock (bouton dans l'onglet Équipements), avec
  ou sans OCR : pour les plans importés avant une amélioration de la lecture, ou pour lancer
  l'OCR après coup. Les équipements ajoutés à la main sont conservés.
- **Ajouts sur les plans** (bornes Wi-Fi, téléphonie…) : choisissez une catégorie (borne Wi-Fi,
  téléphonie, caméra, prise réseau, baie, contrôle d'accès, électricité, autre), puis cliquez à
  l'emplacement sur la vue 3D. Le repère est numéroté automatiquement (WIFI-01, WIFI-02…,
  TEL-01…) et la pose s'enchaîne : Entrée enregistre et passe au suivant. Chaque catégorie a sa
  couleur sur le plan et son filtre dans la liste. Utile aussi pour les plans sans textes
  exploitables (PDF scanné) ou les équipements absents du plan.
- **Recherche** dans tous les plans : insensible aux accents, à la casse, aux tirets et aux
  espaces parasites de l'OCR (`sw b 01` trouve `SW-B-01`, `wifi` trouve `Wi-Fi`, `CAM-07`
  trouve une lecture « CAM-0 7 »). Les mots peuvent viser l'équipement
  ou la fiche du plan : `switch bât B` trouve les switchs des plans du bâtiment B. Un équipement
  ajouté répond aussi à ses notes (modèle, adresse IP, n° de poste) et aux mots de sa catégorie
  (`wifi`, `borne`, `dect`, `téléphone`…). Filtres par site, par catégorie (à lui seul, il liste
  par exemple toutes les bornes Wi-Fi) et par origine. Chaque résultat ouvre le plan centré sur l'équipement.
- **Tracés** (onglet Tracés, ou « Tracé depuis ici / jusqu'ici » sur un équipement) : chemin
  le plus court entre deux équipements d'un même bâtiment, pour estimer un passage de câble.
  - Sur un étage, le tracé contourne les murs et passe par les ouvertures (portes), sans sortir
    du bâtiment sauf nécessité. Traversée des murs (carottage) possible en option ; si aucun
    chemin n'existe par les portes, le tracé traverse un mur et le signale.
  - Entre étages, il passe par les **passages verticaux** : un équipement ou une indication
    (gaine technique, colonne montante, escalier, ascenseur) marqué « passage entre étages »
    avec le même nom sur chaque plan (GT-3…). Le nom est proposé d'après le texte du plan.
  - Un **bâtiment** = les plans de même site et même bâtiment. Chaque plan a un **niveau**
    (déduit de l'étage : RDC → 0, R+1 → 1, SS1 → -1, ou saisi sur la fiche) et une **hauteur
    d'étage** (3 m par défaut). Les étages sont superposés automatiquement grâce à leurs
    passages communs.
  - Résultat : longueur par tronçon, montées entre étages, descentes du faux plafond aux
    équipements, total avec marge (15 % par défaut) ; vue 3D du bâtiment, étages empilés, murs
    transparents. Le lien du tracé se partage et se recalcule à l'ouverture.
- **Recherche dans un plan** : filtre de la liste et des repères 3D en direct.
- **Liens directs** : l'adresse pointe sur l'équipement sélectionné (`#/plan/<id>?eq=<id>`),
  bouton « Copier le lien ».
- **Maquette 3D** (même moteur que le prototype) : rôle de chaque calque (murs, fenêtres,
  portes, plan au sol, ignorer), murs en double trait remplis, fenêtres avec allège, vitrage
  et linteau, unité ou échelle, hauteurs. Les réglages sont **enregistrés sur le serveur**
  pour toute l'équipe. Export GLB, OBJ, STL.
- **Paramètres** : comptes locaux, Active Directory / LDAP, état du SSO Microsoft.
- **Conflits** : si un collègue a enregistré le même plan entre-temps, la modification est
  refusée plutôt que d'écraser son travail, et le plan est rechargé.

## Formats

| Format | Prise en charge |
| --- | --- |
| DXF ASCII | Géométrie : LINE, LWPOLYLINE/POLYLINE (arcs compris), ARC, CIRCLE, ELLIPSE, SPLINE (approchée), SOLID, blocs imbriqués. Équipements et indications (premier niveau) : INSERT + ATTRIB, TEXT, MTEXT, MULTILEADER, texte ajouté aux cotes. |
| DXF binaire | Refusé, avec explication : réenregistrer en DXF ASCII. |
| DWG | Refusé, avec explication : AutoCAD « Enregistrer sous → DXF » ou ODA File Converter. |
| PDF vectoriel | Tracés et aplats de la page choisie (regroupés par épaisseur et couleur), textes, commentaires ; OCR en option pour le texte exporté en traits. |
| PDF scanné | Pas de géométrie 3D ; indications lues par OCR, équipements à placer à la main. |

## Structure

```
plan-relief/
├── index.html, auth-redirect.html   pages (application, retour de connexion Microsoft)
├── src/
│   ├── App.tsx                      connexion obligatoire, navigation (#/plans, #/recherche…)
│   ├── api.ts                       appels au service
│   ├── auth/                        SSO Microsoft (MSAL)
│   ├── components/                  écrans : bibliothèque, import, plan 3D, recherche, paramètres
│   └── lib/                         lecture DXF/PDF, indications, OCR, géométrie, scène 3D,
│                                    tracés (route.ts : grille et plus court chemin ; building.ts : étages)
├── scripts/copy-ocr-assets.mjs      copie le moteur OCR et le modèle français dans public/ocr/ (avant dev et build)
├── public/web.config                en-têtes de sécurité et limites IIS
├── server/                          service Node.js (Express)
│   ├── src/auth/                    local (bcrypt), LDAP, SSO, session — repris de Suivi Infra
│   ├── src/plansStore.js            bibliothèque sur disque (écritures atomiques, versions)
│   ├── src/search.js                recherche d'équipements
│   └── test/                        tests de bout en bout (npm test)
└── packaging/                       paquet Windows Server 2022 et scripts PowerShell
```

## Développement

```bash
cd plan-relief/server
npm install
cp .env.example .env      # JWT_SECRET, COOKIE_SECURE=false en local
npm run create-user -- admin MotDePasse123 "Administrateur"
npm start                 # http://127.0.0.1:4100

cd ..                     # plan-relief/
npm install
npm run dev               # http://localhost:5173, /api relayé vers le service
```

Contrôles avant livraison : `npm run build` et `npm run lint` (interface), `npm test` (service).
