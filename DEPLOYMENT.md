# Déploiement sur Windows Server 2022 (IIS)

L'application elle-même (ce que voient les utilisateurs) est un site **100 % statique**
(HTML/CSS/JS générés par `npm run build`) : IIS se contente de servir des fichiers, sans
runtime applicatif. Ça reste vrai avec ou sans authentification locale/LDAP.

Deux parties dans ce guide :
- **Partie A (obligatoire)** : héberger l'application elle-même sous IIS, en HTTPS.
- **Partie B (optionnelle)** : ajouter le serveur d'authentification (`server/`) si vous
  voulez du login/mot de passe local et/ou une connexion LDAP/Active Directory — le SSO
  Microsoft, lui, fonctionne dès la Partie A, sans rien de plus.

Le build peut être fait sur n'importe quel poste (le vôtre, un serveur de build/CI) —
**pas besoin d'installer Node.js sur le serveur Windows 2022** pour la Partie A. La
Partie B, elle, a besoin de Node.js sur le serveur, puisqu'un petit service y tourne en
continu.

## Vue d'ensemble — Partie A

1. Générer le build (`dist/`)
2. Installer le rôle IIS sur le serveur
3. Copier `dist/` sur le serveur
4. Créer le site IIS et le binding HTTPS avec un certificat
5. Forcer la redirection HTTP → HTTPS
6. Mettre à jour la configuration SSO (Entra ID) avec l'URL finale
7. Vérifier
8. Pare-feu et maintenance continue

---

## 1. Générer le build

Sur un poste avec Node.js 18+ :

```powershell
git clone https://github.com/tilaloute92/Test.git
cd Test
git checkout claude/team-activity-tracking-infra-969r4y
npm install
npm run build
```

Cela produit un dossier `dist/` contenant tous les fichiers à déployer (y compris
`web.config`, copié automatiquement — voir la section Sécurité plus bas). C'est **ce
dossier `dist/`, et uniquement lui**, qu'il faut copier sur le serveur — jamais le
dossier `node_modules` ni le code source.

## 2. Installer le rôle IIS sur le serveur

Sur le serveur Windows Server 2022, en PowerShell (administrateur) :

```powershell
Install-WindowsFeature -Name Web-Server -IncludeManagementTools
```

Ça installe IIS avec les fonctionnalités de base — suffisant pour la Partie A seule
(aucun module supplémentaire n'est nécessaire : pas d'ASP.NET, pas de CGI, pas de module
de réécriture d'URL requis, puisque l'application ne fait pas de routage par URL). Si vous
ajoutez la Partie B (authentification locale/LDAP), deux modules IIS supplémentaires
seront nécessaires — voir cette section.

## 3. Copier les fichiers sur le serveur

Copiez le contenu du dossier `dist/` (généré à l'étape 1) vers un dossier sur le
serveur, par exemple :

```
C:\inetpub\suivi-infra\
```

(Évitez de réutiliser `C:\inetpub\wwwroot` du site par défaut — créez un dossier dédié.)

## 4. Créer le site IIS et le binding HTTPS

### 4.1 Obtenir un certificat

Deux cas :
- **Certificat interne** (recommandé pour un usage interne à l'entreprise) : demandez-en
  un à votre autorité de certification interne (AD CS) pour le nom d'hôte choisi (ex.
  `suivi-infra.monentreprise.local`), ou générez-le via `certlm.msc` (Certificats —
  ordinateur local) → *Personnel* → *Toutes les tâches* → *Demander un nouveau
  certificat*.
- **Certificat public** (si l'application doit être accessible depuis l'extérieur) :
  obtenez-en un auprès d'une autorité publique (Let's Encrypt, DigiCert, etc.).

Le certificat doit être installé dans le magasin **Ordinateur local → Personnel** du
serveur avant l'étape suivante.

### 4.2 Créer le site dans le Gestionnaire IIS

1. Ouvrez le **Gestionnaire des services Internet (IIS)**.
2. Clic droit sur *Sites* → *Ajouter un site*.
3. Nom du site : `Suivi Infra & Reseau`.
4. Chemin d'accès physique : `C:\inetpub\suivi-infra`.
5. Type de liaison : **https**, port `443`, sélectionnez le certificat importé à
   l'étape 4.1.
6. Nom d'hôte : le nom DNS choisi (ex. `suivi-infra.monentreprise.local`) — assurez-vous
   qu'une entrée DNS interne pointe vers l'IP du serveur.
7. Validez.

## 5. Forcer la redirection HTTP → HTTPS

Par défaut, IIS crée aussi une écoute HTTP (port 80). Pour éviter que l'application ne
soit accessible en clair :

- Soit supprimez la liaison HTTP du site (*Liaisons* → sélectionnez `http` → *Supprimer*),
  si personne n'a besoin d'y accéder autrement qu'en HTTPS.
- Soit installez le module **URL Rewrite** (téléchargeable depuis le site IIS.net) et
  ajoutez une règle de redirection HTTP → HTTPS si vous préférez rediriger plutôt que
  couper l'accès HTTP.

La suppression de la liaison HTTP est l'option la plus simple et suffisante ici.

> Les en-têtes de sécurité (CSP, anti-clickjacking, HSTS, etc.) sont déjà inclus dans le
> fichier `web.config` livré avec le build — rien à faire de plus pour les activer, IIS
> les applique automatiquement dès que le site est en ligne. Voir le contenu commenté de
> `public/web.config` dans le dépôt pour le détail de chaque en-tête et pourquoi il est
> présent.

## 6. Mettre à jour la configuration SSO

Une fois l'URL finale connue (ex. `https://suivi-infra.monentreprise.local`) :

1. Dans le [portail Azure](https://portal.azure.com) → *Microsoft Entra ID* →
   *Inscriptions d'applications* → votre application → *Authentification*, vérifiez que
   l'URI de redirection **Application monopage (SPA)** correspond exactement à cette URL
   (avec le `https://`, sans slash final superflu).
2. Dans l'application elle-même, onglet **Paramètres**, mettez à jour le champ *URI de
   redirection* avec la même valeur, et testez le bouton *Se connecter avec Microsoft*.

## 7. Vérifier

- Ouvrez `https://suivi-infra.monentreprise.local` depuis un poste du domaine : le
  cadenas doit s'afficher sans avertissement (l'autorité interne doit être déployée sur
  les postes via GPO si vous utilisez un certificat interne).
- Dans les outils de développement du navigateur (F12 → onglet *Réseau* → cliquez sur la
  requête principale → *En-têtes de réponse*), vérifiez la présence de
  `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`.
- Testez la connexion SSO et la navigation dans les différents onglets.

## 8. Pare-feu et maintenance continue

- Sur le pare-feu Windows du serveur, n'autorisez que le port **443** en entrée pour ce
  site (443/TCP) ; fermez le 80 si la liaison HTTP a été supprimée à l'étape 5.
- Gardez Windows Server et IIS à jour (Windows Update standard) — c'est ce qui protège
  réellement le serveur, l'application elle-même n'exécutant aucun code côté serveur.
- Si vous mettez à jour l'application plus tard (nouvelle version), il suffit de
  refaire `npm run build` et de remplacer le contenu de `C:\inetpub\suivi-infra` par le
  nouveau `dist/` (le fichier `web.config` sera régénéré automatiquement à chaque build).
- Pensez à relancer `npm audit` avant chaque nouveau build si vous mettez à jour les
  dépendances, pour repérer d'éventuelles vulnérabilités publiées entre-temps.

---

## Partie B — Serveur d'authentification (login local + LDAP)

Nécessaire uniquement si vous voulez du login/mot de passe local et/ou une connexion
LDAP/Active Directory (voir onglet Paramètres de l'application, sections dédiées). Sans
cette partie, le SSO Microsoft de la Partie A continue de fonctionner seul.

### B.1 Installer Node.js sur le serveur

Téléchargez et installez la version **LTS** depuis [nodejs.org](https://nodejs.org) (le
choix par défaut de l'installeur convient).

### B.2 Déployer le service

```powershell
# Sur le serveur, ou copié depuis un poste de build :
git clone https://github.com/tilaloute92/Test.git C:\services\suivi-infra-auth
cd C:\services\suivi-infra-auth\server
npm install --omit=dev
copy .env.example .env
notepad .env
```

Dans `.env` (voir les commentaires du fichier pour le détail de chaque valeur) :
renseignez au minimum `JWT_SECRET` (une valeur aléatoire longue), laissez
`COOKIE_SECURE=true` (le site tourne en HTTPS via IIS), et mettez `CORS_ORIGIN` à l'URL
finale de l'application (ex. `https://suivi-infra.monentreprise.local`). Si vous utilisez
le SSO Microsoft, renseignez aussi `ENTRA_TENANT_ID` et `ENTRA_CLIENT_ID` (mêmes valeurs
que dans l'onglet Paramètres de l'application).

Créez le tout premier compte local, qui servira à se connecter une première fois pour
ensuite tout gérer depuis l'application :

```powershell
npm run create-user -- admin "MotDePasseSolide123!" "Administrateur"
```

### B.3 Enregistrer le service Windows (NSSM)

[NSSM](https://nssm.cc/) permet de faire tourner n'importe quel programme (ici `node`)
comme un service Windows, démarré automatiquement et redémarré s'il plante — sans avoir à
laisser une fenêtre PowerShell ouverte.

```powershell
# Téléchargez nssm.exe (nssm.cc) et placez-le dans le PATH, puis :
nssm install SuiviInfraAuth "C:\Program Files\nodejs\node.exe" "C:\services\suivi-infra-auth\server\src\index.js"
nssm set SuiviInfraAuth AppDirectory "C:\services\suivi-infra-auth\server"
nssm start SuiviInfraAuth
```

Vérifiez qu'il tourne : `Invoke-WebRequest http://127.0.0.1:4000/api/health` doit répondre
`{"ok":true}`. En cas de souci, les journaux du service (`nssm` peut aussi rediriger
stdout/stderr vers un fichier — `nssm set SuiviInfraAuth AppStdout ...`) aident à
diagnostiquer.

### B.4 Faire relayer /api par IIS (reverse proxy)

Le site continue d'être servi par IIS (Partie A) ; on lui ajoute juste une règle qui
relaie les appels `/api/*` vers le service Node local, pour que le navigateur ne voie
qu'une seule adresse.

1. Installez deux modules IIS (téléchargements depuis iis.net) : **URL Rewrite** et
   **Application Request Routing (ARR)**.
2. Dans le **Gestionnaire IIS**, au niveau du serveur (pas du site), ouvrez *Application
   Request Routing Cache* → *Server Proxy Settings* → cochez **Enable proxy** → *Appliquer*.
3. Sur le site créé en Partie A, ouvrez *URL Rewrite* → *Ajouter une règle* → *Reverse
   Proxy* → renseignez `127.0.0.1:4000` comme serveur, cochez **HTTPS** décoché (le saut
   interne IIS → Node se fait en HTTP, seul le trajet navigateur → IIS est en HTTPS) →
   IIS ajoute automatiquement une règle dans `web.config`.
4. Modifiez cette règle générée pour qu'elle ne s'applique qu'aux chemins commençant par
   `api/` (dans le champ *Modèle*, remplacez `(.*)` par `^api/(.*)$`, et l'URL de
   réécriture par `http://127.0.0.1:4000/api/{R:1}`) — sinon IIS relaierait aussi les
   fichiers de l'application vers Node, qui ne sait pas les servir.

### B.5 Vérifier

- `https://suivi-infra.monentreprise.local/api/health` doit répondre `{"ok":true}` (relayé
  par IIS vers le service Node).
- Dans l'application, onglet Paramètres : la carte "Authentification locale" doit lister
  le compte `admin` créé en B.2, et la carte LDAP doit se charger sans erreur — signe que
  le reverse proxy fonctionne. (Les deux resteront en erreur "Non authentifié" tant que
  vous n'êtes connecté avec aucun compte — normal, connectez-vous d'abord avec `admin`
  depuis l'écran de connexion.)
- Testez une connexion avec le compte local `admin`, puis configurez LDAP si besoin.

### Maintenance

- Le service ne stocke que des identifiants et sessions (`server/data/`, hors dépôt Git) —
  pensez à sauvegarder ce dossier si vous avez plusieurs comptes locaux configurés.
- Mise à jour du service : `git pull`, `npm install --omit=dev`, `nssm restart
  SuiviInfraAuth`.
- `npm audit` (dans `server/`) avant chaque mise à jour des dépendances, comme pour le
  frontend.

---

## Ce que ce déploiement ne couvre pas

- **Sauvegarde des données métier** (tâches, planning, temps saisi...) : chaque
  utilisateur les a dans le stockage local de *son* navigateur (voir README) — la Partie B
  ne gère que l'authentification, pas ces données. La perte du profil navigateur d'un
  utilisateur perd ses données locales.
- **Haute disponibilité / répartition de charge** : un seul serveur IIS (+ un seul service
  d'authentification) suffit pour un usage interne à une équipe de 6 personnes ; non
  traité ici.
- **Gestion de certificat dans l'application** : volontairement non implémentée (le
  certificat se configure sur IIS, jamais dans l'app — voir onglet Paramètres et le
  README pour l'explication).
