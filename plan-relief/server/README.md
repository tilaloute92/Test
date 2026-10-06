# Service Plan Relief

Service Express qui :

- vérifie les connexions (compte local, Active Directory/LDAP, ou finalisation du SSO
  Microsoft) et ouvre une session sécurisée (cookie signé, httpOnly) — modules repris de
  Suivi Infra & Réseau ;
- stocke la bibliothèque de plans (fichiers d'origine, fiches, équipements, réglages 3D) ;
- répond aux recherches d'équipements.

C'est la seule source de vérité : l'interface n'affiche rien sans lui (écran « Serveur
indisponible »).

## Démarrage (développement)

```bash
npm install
cp .env.example .env      # au minimum JWT_SECRET ; COOKIE_SECURE=false sans HTTPS
npm run create-user -- admin MotDePasse123 "Administrateur"
npm start                 # http://127.0.0.1:4100
npm test                  # tests de bout en bout sur un dossier de données temporaire
```

## API

| Méthode et chemin | Session | Rôle |
| --- | --- | --- |
| `GET /api/health` | non | Sonde : `{ ok, mode: "client-serveur", app: "plan-relief" }` |
| `GET /api/auth/methods` | non | Moyens de connexion proposés (local, LDAP, SSO + identifiants Entra ID publics) |
| `POST /api/auth/local` · `/ldap` · `/sso` | non | Connexion (10 essais / 15 min / IP pour local et LDAP) |
| `GET /api/auth/me` · `POST /api/auth/logout` | — | Session courante, déconnexion |
| `GET/POST/DELETE /api/auth/local-users` | oui | Comptes locaux |
| `GET/PUT /api/auth/ldap-config` | oui | Configuration LDAP |
| `GET /api/plans` | oui | Liste des plans (sans les équipements) |
| `POST /api/plans` | oui | Import : multipart, champ `file` + champ `data` (JSON : fiche, `settings`, `equipment`) |
| `GET /api/plans/:id` | oui | Plan complet (fiche, réglages, équipements) |
| `GET /api/plans/:id/file` | oui | Fichier d'origine |
| `PATCH /api/plans/:id` | oui | Modification ; `version` obligatoire, 409 si le plan a changé entre-temps |
| `DELETE /api/plans/:id` | oui | Déplace le plan dans `data/corbeille/` |
| `GET /api/search?q=&site=&kind=&plan=&limit=` | oui | Recherche d'équipements |

## Données (`data/`, hors dépôt Git)

```
data/
├── users.json            comptes locaux (empreintes bcrypt)
├── config.json           configuration LDAP
├── meta.json             compteur de version (témoin de cohérence pour la sauvegarde)
├── plans/<uuid>/
│   ├── plan.json         fiche, réglages 3D, équipements
│   └── source.dxf|pdf    fichier d'origine, jamais modifié
└── corbeille/<uuid>_<date>/   plans retirés du stock
```

Écritures atomiques ; démarrage refusé si un fichier JSON est illisible (le message nomme le
fichier) ; un dossier de plan sans `plan.json` (import interrompu) est ignoré.

Pourquoi l'extraction des équipements se fait dans le navigateur : la lecture des PDF
(pdf.js) tire côté Node une dépendance native facultative (`canvas`), qui rendrait le
paquet non portable vers Windows. Le navigateur lit déjà le plan pour la 3D ; il envoie le
résultat, que le service nettoie et borne avant de l'enregistrer.
