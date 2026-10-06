# Déploiement manuel — Plan Relief (Windows Server 2022, IIS)

Procédure de référence, étape par étape. Le script `Install-PlanRelief.ps1` du paquet
(voir `packaging/INSTALL.md`) fait exactement la même chose : ce document sert à comprendre
ce qu'il fait, ou à l'adapter.

L'architecture est celle de Suivi Infra & Réseau en mode client/serveur :

```
Navigateur ──HTTPS 8082──▶ IIS ──┬── fichiers du site (C:\inetpub\plan-relief)
                                └── /api/* ──HTTP 127.0.0.1:4100──▶ service Node.js (PlanReliefSvc)
                                                                     └── data\ : comptes, plans, équipements
```

- Le **site** est 100 % statique : IIS sert des fichiers, sans runtime applicatif.
- Le **service** est le seul à lire et écrire les données. Il n'écoute que sur
  `127.0.0.1` : il n'est jamais exposé au réseau, seul IIS lui parle.
- Le chiffrement TLS est assuré par IIS ; le saut interne IIS → service reste local.

## 1. Construire

Sur un poste avec Node.js 18+ :

```bash
git clone https://github.com/tilaloute92/Test.git
cd Test/plan-relief
npm ci && npm run build          # → dist/ (site, web.config inclus)
cd server && npm ci --omit=dev   # → dépendances du service
```

Ou, pour obtenir directement le paquet complet : `bash plan-relief/packaging/build-package.sh`.

## 2. Prérequis serveur

```powershell
Install-WindowsFeature -Name Web-Server -IncludeManagementTools
```

Puis installez Node.js LTS, les modules IIS **URL Rewrite** et **ARR**, et éventuellement NSSM
(facultatif, voir §5).

## 3. Publier le site

Copiez le contenu de `dist/` dans `C:\inetpub\plan-relief\`.

`web.config` (copié avec le site) apporte :

| Réglage | Rôle |
| --- | --- |
| `Content-Security-Policy` | Scripts, polices, worker PDF et moteur OCR servis par le site uniquement ; réseau limité au site et aux domaines Microsoft (SSO). Pas de `*` : l'application n'appelle aucune API tierce. `'wasm-unsafe-eval'` autorise seulement la compilation du moteur OCR (WebAssembly, dossier `ocr/` du site) ; `eval()` et le JavaScript en ligne restent interdits. |
| `X-Frame-Options: DENY`, `frame-ancestors 'none'` | Anti-clickjacking. |
| `Strict-Transport-Security: max-age=0` | HSTS volontairement **désactivé** : le navigateur l'applique au nom du serveur sur tous les ports, il forcerait donc aussi en HTTPS les autres sites servis en clair sur le même serveur (8080, 8081…). Le site reste accessible en HTTPS uniquement (pas de liaison http). |
| `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` | Mêmes en-têtes que Suivi Infra & Réseau. |
| `requestLimits maxAllowedContentLength` | 110 Mo : import de plans jusqu'à 100 Mo (IIS bloque à 30 Mo par défaut). |
| `mimeMap .mjs`, `.woff2`, `.gz` | Types de fichiers que IIS ne sert pas par défaut (`.gz` : modèle de langue de l'OCR). |

## 4. Site IIS et HTTPS

1. Importez le certificat dans *Ordinateur local → Personnel*.
2. Gestionnaire IIS → *Ajouter un site* : nom `Plan Relief`, chemin `C:\inetpub\plan-relief`,
   liaison **https** port **8082**, nom d'hôte `plans.monentreprise.local`, cochez *Exiger
   l'indication du nom de serveur* (SNI), certificat.
3. Supprimez toute liaison **http** : l'application ne doit jamais être servie en clair
   (les mots de passe locaux et LDAP transitent par la page de connexion).
4. Pare-feu : 8082/TCP entrant uniquement (Windows et, le cas échéant, pare-feu réseau). Le
   port 4100 n'est **pas** à ouvrir.

## 5. Service Windows

```powershell
# Copier server\src, server\scripts, server\node_modules, server\package.json, server\.env.example
# vers C:\services\plan-relief, puis :
cd C:\services\plan-relief
copy .env.example .env
notepad .env
```

Dans `.env` : `JWT_SECRET` (valeur aléatoire longue, **différente** de celle de Suivi Infra),
`COOKIE_SECURE=true`, `CORS_ORIGIN=https://plans.monentreprise.local:8082`, `PORT=4100`. Pour le
SSO : `ENTRA_TENANT_ID` et `ENTRA_CLIENT_ID`.

Restreignez les droits : `data\` et `.env` accessibles aux seuls Administrateurs et SYSTEM.

Lancement **avec NSSM** (service Windows) :

```powershell
nssm install PlanReliefSvc "C:\Program Files\nodejs\node.exe" "C:\services\plan-relief\src\index.js"
nssm set PlanReliefSvc AppDirectory "C:\services\plan-relief"
nssm set PlanReliefSvc AppStdout "C:\services\plan-relief\service.log"
nssm set PlanReliefSvc AppStderr "C:\services\plan-relief\service.err.log"
nssm start PlanReliefSvc
node scripts\create-local-user.js admin "MotDePasseSolide123!" "Administrateur"
Invoke-RestMethod http://127.0.0.1:4100/api/health    # ok = True, app = plan-relief
```

Lancement **sans NSSM** (tâche planifiée) : copiez `Start-PlanReliefService.ps1` dans
`C:\services\plan-relief`, puis créez une tâche planifiée « Plan Relief - Service » : déclencheur
*Au démarrage*, compte *SYSTEM* avec privilèges les plus élevés, action
`powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\services\plan-relief\Start-PlanReliefService.ps1" -NodePath "C:\Program Files\nodejs\node.exe"`,
sans limite de durée d'exécution, redémarrage toutes les minutes en cas d'échec. Le script
superviseur relance Node s'il s'arrête et écrit les mêmes journaux.

## 6. Relais /api

1. Gestionnaire IIS, niveau **serveur** → *Application Request Routing Cache* → *Server Proxy
   Settings* → cochez **Enable proxy**, et portez **Time-out** à 300 secondes (import de
   grands plans).
2. Site `Plan Relief` → *URL Rewrite* → règle vide : modèle `^api/(.*)$`, action *Réécrire*
   vers `http://127.0.0.1:4100/api/{R:1}`, cochez *Arrêter le traitement des règles suivantes*.

## 7. Vérifier

- `https://plans.monentreprise.local:8082/api/health` → `{"ok":true,"mode":"client-serveur","app":"plan-relief"}`
- `https://plans.monentreprise.local:8082/api/plans` → **401** sans session.
- F12 → *Réseau* → en-têtes de la page : `Content-Security-Policy`, et `Strict-Transport-Security: max-age=0`.
- Connexion avec `admin`, import d'un plan, recherche d'un équipement.

## Sécurité : ce qui est en place

| Mesure | Détail |
| --- | --- |
| Session | Cookie `planrelief_session` httpOnly (illisible par le JavaScript de la page), `Secure`, `SameSite=Lax`, signé (JWT), 10 h. |
| Mots de passe locaux | Hachés bcrypt dans `data\users.json`. 8 caractères minimum. |
| Anti-brute-force | 10 tentatives de connexion par 15 minutes et par adresse IP. |
| LDAP | Vérification par « bind » sur le contrôleur de domaine ; le mot de passe n'est jamais stocké. |
| SSO Microsoft | Signature du jeton vérifiée par le service (clés publiques Microsoft), avec contrôle de l'émetteur et de l'audience. |
| Accès aux plans | Toutes les routes `/api/plans` et `/api/search` exigent une session. |
| Fichiers importés | Type vérifié par leur contenu (`%PDF-`, en-tête DXF), DWG et DXF binaires refusés, taille limitée. Identifiants générés par le serveur : aucun nom de fichier fourni par l'utilisateur n'entre dans un chemin disque. |
| Données reçues | Fiches, réglages et équipements nettoyés côté serveur (types, longueurs, nombre d'éléments). |
| Écriture concurrente | Chaque plan a un numéro de version : une modification basée sur une version périmée est refusée (409) au lieu d'écraser le travail d'un collègue. |
| Intégrité | Écritures atomiques (fichier temporaire + `fsync` + renommage) ; démarrage refusé si une fiche est illisible. |
| Suppression | Un plan retiré du stock part dans `data\corbeille\`, jamais effacé par l'application. |

## Exploitation

- **Sauvegarde** : `Register-PlanReliefBackup.ps1` (voir INSTALL.md §6). `data\` est la seule
  copie de la bibliothèque.
- **Mise à jour** : relancer `Install-PlanRelief.ps1` du nouveau paquet, avec les mêmes paramètres.
- **Journaux** : `C:\services\plan-relief\service.log` et `service.err.log`.
- **Dépendances** : `npm audit` dans `plan-relief/` et `plan-relief/server/` avant chaque
  nouveau paquet.
