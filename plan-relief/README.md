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
- **Détection automatique des équipements** à l'import :
  - DXF : chaque **bloc inséré** (son nom devient le type : `SWITCH`, `BORNE_WIFI`…) avec ses
    **attributs** (`REPERE`, `MODELE`, `SERIE`…) ; le repère sert de nom. Chaque **texte**
    (TEXT, MTEXT) aussi : noms de locaux, étiquettes.
  - PDF : chaque **texte** de la page, fragments d'une même ligne regroupés.
  - Les cotes (« 3.50 ») et les textes d'un seul caractère sont écartés.
- **Ajout à la main** : sur la vue 3D, cliquez à l'emplacement ; repère, type, notes. Pour les
  plans sans textes exploitables (PDF scanné) ou les équipements absents du plan.
- **Recherche** dans tous les plans : insensible aux accents, à la casse et aux tirets
  (`sw b 01` trouve `SW-B-01`, `wifi` trouve `Wi-Fi`). Les mots peuvent viser l'équipement
  ou la fiche du plan : `switch bât B` trouve les switchs des plans du bâtiment B. Filtres par
  site et par origine. Chaque résultat ouvre le plan centré sur l'équipement.
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
| DXF ASCII | Géométrie : LINE, LWPOLYLINE/POLYLINE (arcs compris), ARC, CIRCLE, ELLIPSE, SPLINE (approchée), SOLID, blocs imbriqués. Équipements : INSERT + ATTRIB, TEXT, MTEXT (premier niveau). |
| DXF binaire | Refusé, avec explication : réenregistrer en DXF ASCII. |
| DWG | Refusé, avec explication : AutoCAD « Enregistrer sous → DXF » ou ODA File Converter. |
| PDF vectoriel | Tracés et aplats de la page choisie (regroupés par épaisseur et couleur), textes. |
| PDF scanné | Stocké et affiché sans géométrie ni textes : équipements à placer à la main. |

## Structure

```
plan-relief/
├── index.html, auth-redirect.html   pages (application, retour de connexion Microsoft)
├── src/
│   ├── App.tsx                      connexion obligatoire, navigation (#/plans, #/recherche…)
│   ├── api.ts                       appels au service
│   ├── auth/                        SSO Microsoft (MSAL)
│   ├── components/                  écrans : bibliothèque, import, plan 3D, recherche, paramètres
│   └── lib/                         lecture DXF/PDF, extraction des équipements, géométrie, scène 3D
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
