# Installer NetSchema sur un serveur Windows

Objectif : un service Windows qui démarre tout seul, sert l'application en HTTPS aux postes du
réseau interne, et range comptes et schémas dans **un seul dossier** que l'on sauvegarde.

Compté large, l'installation prend une demi-heure. Ce document la déroule étape par étape :
chaque commande est à taper dans une console **PowerShell ouverte en tant qu'administrateur**,
sur le serveur.

**Sommaire**

0. [Ce qu'il faut décider avant de commencer](#0-ce-quil-faut-décider-avant-de-commencer)
1. [Prérequis et vérifications](#1-prérequis-et-vérifications)
2. [Récupérer les sources](#2-récupérer-les-sources)
3. [Installation automatique](#3-installation-automatique-voie-normale)
4. [Installation manuelle, pas à pas](#4-installation-manuelle-pas-à-pas)
5. [Le fichier de configuration](#5-le-fichier-de-configuration-netschemaenv)
6. [Activer le HTTPS](#6-activer-le-https)
7. [Créer le premier compte](#7-créer-le-premier-compte)
8. [Vérifier l'installation](#8-vérifier-linstallation)
9. [Exploitation](#9-exploitation)
10. [Problèmes courants](#10-problèmes-courants)
11. [Ce qui reste à votre charge](#11-ce-qui-reste-à-votre-charge)
12. [Annexe — installation derrière IIS, pas à pas](#12-annexe--installation-derrière-iis-pas-à-pas)

---

## 0. Ce qu'il faut décider avant de commencer

Trois décisions, à prendre une fois pour toutes. Notez les réponses : elles reviennent à
chaque étape.

### a. Qui porte le certificat HTTPS ?

| | **Scénario A — le service** | **Scénario B — IIS en façade** |
| --- | --- | --- |
| Quand le choisir | Serveur dédié, pas d'IIS, on veut le moins de pièces possible | Le serveur héberge déjà des sites, ou le certificat doit rester dans le magasin Windows |
| Le service écoute sur | `0.0.0.0:8443`, en HTTPS | `127.0.0.1:8080`, en clair (jamais exposé) |
| Certificat | Deux fichiers PEM lus par le service | Binding IIS habituel |
| Pare-feu | Port 8443 ouvert | Rien à ouvrir pour le service (443 par IIS) |

Le scénario A est le plus simple ; on peut passer de A à B plus tard sans rien réinstaller,
en changeant trois lignes de configuration.

### b. Les emplacements

Valeurs par défaut, reprises dans tout ce document :

| Rôle | Chemin par défaut |
| --- | --- |
| Sources (dépôt) | `C:\Sources\Test` |
| Application installée | `C:\Apps\NetSchema` |
| Interface web | `C:\Apps\NetSchema\web` |
| **Données (à sauvegarder)** | `C:\ProgramData\NetSchema\data` |
| Certificats PEM (scénario A) | `C:\ProgramData\NetSchema\tls` |

Les données sont **séparées de l'application** exprès : une mise à jour remplace
`C:\Apps\NetSchema` sans jamais toucher aux schémas ni aux comptes.

### c. Le nom et le port

Les postes clients ouvriront `https://<nom-dns-du-serveur>:8443`. Le nom doit correspondre au
certificat, sans quoi le navigateur affichera un avertissement. Prévoyez l'enregistrement DNS
avant d'installer.

---

## 1. Prérequis et vérifications

| | |
| --- | --- |
| Système | Windows Server 2016 ou plus récent (fonctionne aussi sur Windows 10/11 Pro) |
| Node.js | **20.11 LTS ou plus récent**, installé pour toute la machine — <https://nodejs.org> |
| Droits | Une console PowerShell « exécuter en tant qu'administrateur » |
| Réseau | Un port libre (8443 par défaut) joignable depuis les postes clients |
| Certificat | Un certificat serveur pour le nom DNS retenu (interne ou public) |
| Facultatif | [`nssm.exe`](https://nssm.cc) — recommandé, voir l'étape 3 |

Vérifications, dans l'ordre :

```powershell
# 1. Node.js présent et assez récent (v20.11.0 ou plus)
node --version
npm --version

# 2. Console bien élevée en administrateur (doit répondre True)
([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

# 3. Port libre (aucune ligne = libre)
netstat -ano | findstr :8443

# 4. Politique d'exécution des scripts : autoriser les scripts signés localement
Get-ExecutionPolicy -List
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass   # le temps de l'installation
```

> **Serveur sans accès Internet ?** La compilation télécharge les dépendances npm. Voir
> l'encadré « Serveur isolé » à la fin de l'étape 3.

---

## 2. Récupérer les sources

Copiez le dépôt sur le serveur, par exemple dans `C:\Sources\Test`. Deux dossiers seulement
sont nécessaires : `apps\netschema` (l'interface) et `apps\netschema-server` (le service).

```powershell
mkdir C:\Sources -Force
cd C:\Sources
git clone <url-du-depot> Test
cd C:\Sources\Test
git checkout claude/network-infrastructure-schema-app-hxmk8h
```

Sans Git : téléchargez l'archive ZIP du dépôt, faites un clic droit → **Propriétés** →
**Débloquer** avant de l'extraire (sinon Windows marque les scripts comme « venant
d'Internet » et refuse de les exécuter), puis extrayez dans `C:\Sources\Test`.

Contrôle :

```powershell
Test-Path C:\Sources\Test\apps\netschema\package.json          # True
Test-Path C:\Sources\Test\apps\netschema-server\package.json   # True
```

---

## 3. Installation automatique (voie normale)

```powershell
cd C:\Sources\Test\apps\netschema-server\deploy\windows
.\Install-NetSchema.ps1 -SourceRoot C:\Sources\Test -InstallDir C:\Apps\NetSchema -Port 8443
```

### Paramètres du script

| Paramètre | Défaut | À quoi il sert |
| --- | --- | --- |
| `-SourceRoot` | racine déduite du script | Dépôt contenant `apps\netschema` et `apps\netschema-server` |
| `-InstallDir` | `C:\Apps\NetSchema` | Où l'application est installée |
| `-DataDir` | `C:\ProgramData\NetSchema\data` | Comptes, schémas, journal |
| `-ServiceName` | `NetSchema` | Nom du service Windows |
| `-Port` | `8443` | Port d'écoute, aussi ouvert dans le pare-feu |
| `-NssmPath` | `nssm.exe` à côté du script | Gestionnaire de service (voir plus bas) |
| `-ServiceAccount` | compte virtuel du service | Compte sous lequel tourne le service |

### Ce que le script fait, dans l'ordre

1. **Vérifie Node.js** (refuse en dessous de 20.11) et l'élévation administrateur.
2. **Compile l'interface web** (`npm ci` puis `npm run build` dans `apps\netschema`).
3. **Compile le serveur** (`npm ci` puis `npm run build` dans `apps\netschema-server`).
4. **Copie** `dist`, `node_modules`, `package.json` et `tools` dans `C:\Apps\NetSchema`,
   l'interface compilée dans `C:\Apps\NetSchema\web`, et crée le dossier de données.
5. **Écrit `netschema.env`** à partir de l'exemple, avec vos chemins et votre port
   (HTTPS laissé commenté : c'est l'étape 6). *Un fichier déjà présent n'est jamais écrasé.*
6. **Déclare le service** et lui passe les variables du fichier de configuration.
7. **Restreint les droits** du dossier de données au compte de service, aux administrateurs
   et à SYSTEM — l'héritage est coupé, personne d'autre n'y accède.
8. **Démarre** le service et contrôle qu'il tourne.
9. **Ouvre le port** dans le pare-feu (profils Domaine et Privé uniquement — jamais Public).
10. **Rappelle la commande** de création du premier compte si aucun n'existe.

### NSSM ou tâche planifiée

- **Avec [`nssm.exe`](https://nssm.cc)** (recommandé) placé à côté du script ou désigné par
  `-NssmPath` : vrai service Windows, **redémarrage automatique en cas de plantage**, journaux
  du service écrits dans `service.log` avec rotation à 10 Mo, et service tournant sous son
  **compte virtuel** `NT SERVICE\NetSchema` — aucun mot de passe à gérer ni à renouveler.
- **Sans NSSM** : repli sur une tâche planifiée au démarrage, exécutée en `SYSTEM`. Cela
  suffit à un usage interne, mais la tâche ne redémarre pas le serveur s'il s'arrête seul.

> **Serveur isolé (sans Internet)** — compilez sur un poste qui a accès au réseau :
> ```powershell
> cd apps\netschema        ; npm ci ; npm run build
> cd ..\netschema-server   ; npm ci ; npm run build
> ```
> puis copiez sur le serveur `apps\netschema\dist` → `C:\Apps\NetSchema\web`, et
> `apps\netschema-server\{dist,node_modules,package.json,tools}` → `C:\Apps\NetSchema`.
> Reprenez ensuite à l'étape 4 à partir du point 3 (configuration), le reste du script n'ayant
> plus rien à compiler.

---

## 4. Installation manuelle, pas à pas

À utiliser si la politique du serveur interdit les scripts, ou pour comprendre exactement ce
qui est posé sur la machine. Le résultat est identique à l'étape 3.

**1. Compiler**

```powershell
cd C:\Sources\Test\apps\netschema
npm ci
npm run build                      # produit dist\

cd C:\Sources\Test\apps\netschema-server
npm ci
npm run build                      # produit dist\
```

**2. Copier**

```powershell
mkdir C:\Apps\NetSchema\web -Force
mkdir C:\ProgramData\NetSchema\data -Force

Copy-Item C:\Sources\Test\apps\netschema\dist\* C:\Apps\NetSchema\web -Recurse -Force
foreach ($item in 'dist','node_modules','package.json','tools') {
    Copy-Item "C:\Sources\Test\apps\netschema-server\$item" C:\Apps\NetSchema -Recurse -Force
}
Copy-Item C:\Sources\Test\apps\netschema-server\deploy\windows\Start-NetSchema.ps1 C:\Apps\NetSchema
```

**3. Configurer**

```powershell
Copy-Item C:\Sources\Test\apps\netschema-server\deploy\windows\netschema.env.example `
          C:\Apps\NetSchema\netschema.env
notepad C:\Apps\NetSchema\netschema.env      # voir l'étape 5
```

**4. Essai en premier plan** (on garde la console ouverte, on vérifie, on arrête par Ctrl+C)

```powershell
cd C:\Apps\NetSchema
.\Start-NetSchema.ps1
```

Le serveur annonce son adresse, son dossier de données et son dossier d'interface. S'il
signale « écoute en clair » c'est normal tant que l'étape 6 n'est pas faite.

**5. Déclarer le service**

Avec NSSM :

```powershell
C:\Outils\nssm.exe install NetSchema "C:\Program Files\nodejs\node.exe" C:\Apps\NetSchema\dist\index.js
C:\Outils\nssm.exe set NetSchema AppDirectory C:\Apps\NetSchema
C:\Outils\nssm.exe set NetSchema DisplayName "NetSchema — schémas d'infrastructure"
C:\Outils\nssm.exe set NetSchema Start SERVICE_AUTO_START
C:\Outils\nssm.exe set NetSchema AppStdout C:\ProgramData\NetSchema\data\service.log
C:\Outils\nssm.exe set NetSchema AppStderr C:\ProgramData\NetSchema\data\service.log
C:\Outils\nssm.exe set NetSchema AppRotateFiles 1
C:\Outils\nssm.exe set NetSchema AppRotateBytes 10485760
# Variables d'environnement : une ligne NOM=valeur par variable du fichier .env
C:\Outils\nssm.exe set NetSchema AppEnvironmentExtra (Get-Content C:\Apps\NetSchema\netschema.env | Where-Object { $_ -match '^[A-Z]' })
# Compte virtuel du service : à faire après la création du service
sc.exe sidtype NetSchema unrestricted
C:\Outils\nssm.exe set NetSchema ObjectName "NT SERVICE\NetSchema"
```

Sans NSSM, tâche planifiée au démarrage :

```powershell
$action = New-ScheduledTaskAction -Execute powershell.exe `
    -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Apps\NetSchema\Start-NetSchema.ps1"' `
    -WorkingDirectory C:\Apps\NetSchema
Register-ScheduledTask -TaskName NetSchema -Action $action `
    -Trigger (New-ScheduledTaskTrigger -AtStartup) -User SYSTEM -RunLevel Highest -Force
```

**6. Droits sur les données** (après la création du service : le compte virtuel n'existe pas avant)

```powershell
icacls C:\ProgramData\NetSchema\data /inheritance:r `
    /grant:r "NT SERVICE\NetSchema:(OI)(CI)M" "BUILTIN\Administrators:(OI)(CI)F" "NT AUTHORITY\SYSTEM:(OI)(CI)F"
icacls C:\Apps\NetSchema /grant:r "NT SERVICE\NetSchema:(OI)(CI)RX"
```

*(Avec la tâche planifiée, remplacez `NT SERVICE\NetSchema` par `NT AUTHORITY\SYSTEM`.)*

**7. Pare-feu, puis démarrage**

```powershell
New-NetFirewallRule -DisplayName "NetSchema (8443/TCP)" -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort 8443 -Profile Domain,Private
Start-Service NetSchema          # ou : Start-ScheduledTask -TaskName NetSchema
```

---

## 5. Le fichier de configuration (`netschema.env`)

`C:\Apps\NetSchema\netschema.env`, une ligne `NOM=valeur` par réglage, sans guillemets. Il est
relu à chaque démarrage du service : **toute modification demande un redémarrage**.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `NETSCHEMA_HOST` | `0.0.0.0` | Cartes réseau d'écoute. `127.0.0.1` derrière IIS |
| `NETSCHEMA_PORT` | `8443` en HTTPS, `8080` sinon | Port d'écoute |
| `NETSCHEMA_TLS_CERT` / `NETSCHEMA_TLS_KEY` | — | Certificat et clé PEM. **Les deux renseignés = HTTPS activé** |
| `NETSCHEMA_DATA_DIR` | `data` | Comptes, schémas, journal. **À sauvegarder** |
| `NETSCHEMA_WEB_DIR` | `../netschema/dist` | Interface web compilée |
| `NETSCHEMA_SESSION_SECRET` | tiré au hasard, conservé | Signature des sessions, 32 caractères minimum |
| `NETSCHEMA_SESSION_MINUTES` | `720` (12 h) | Durée d'une session |
| `NETSCHEMA_TRUST_PROXY` | `false` | Derrière IIS : lire l'adresse du client dans `X-Forwarded-For` |
| `NETSCHEMA_SECURE_COOKIES` | comme le HTTPS | Forcer les cookies `Secure` quand IIS termine le TLS |
| `NETSCHEMA_LOGIN_ATTEMPTS` | `10` | Tentatives par quart d'heure et par adresse |
| `NETSCHEMA_LOCK_AFTER_FAILURES` | `10` | Échecs consécutifs avant blocage d'un compte |
| `NETSCHEMA_LOCK_MINUTES` | `15` | Durée du blocage |
| `NETSCHEMA_MAX_BODY_BYTES` | `8388608` (8 Mo) | Taille maximale d'un schéma envoyé |

Le secret de session n'a pas à être inventé : s'il est absent, le service en tire un au hasard
au premier démarrage et le conserve dans `session-secret.key` (lisible par lui seul).
Redémarrer le service ne déconnecte donc personne.

> Avec NSSM, les variables sont recopiées **dans la définition du service** au moment de
> l'installation. Après avoir modifié `netschema.env`, rejouez
> `Install-NetSchema.ps1` ou la ligne `AppEnvironmentExtra` ci-dessus, puis redémarrez.
> Avec la tâche planifiée, le fichier est relu à chaque démarrage : un redémarrage suffit.

---

## 6. Activer le HTTPS

### Scénario A — le service porte le certificat

Le service lit un certificat et une clé au format PEM. Depuis un `.pfx` exporté du magasin
Windows (OpenSSL est fourni avec Git pour Windows) :

```powershell
mkdir C:\ProgramData\NetSchema\tls -Force
openssl pkcs12 -in netschema.pfx -clcerts -nokeys -out C:\ProgramData\NetSchema\tls\netschema.crt
openssl pkcs12 -in netschema.pfx -nocerts -nodes  -out C:\ProgramData\NetSchema\tls\netschema.key

# La clé privée ne se lit que par le service et les administrateurs.
icacls C:\ProgramData\NetSchema\tls /inheritance:r `
    /grant:r "NT SERVICE\NetSchema:(OI)(CI)R" "BUILTIN\Administrators:(OI)(CI)F"
```

Si la chaîne de certification est fournie à part, concaténez le certificat serveur **puis**
les intermédiaires dans `netschema.crt` — dans cet ordre.

Puis, dans `C:\Apps\NetSchema\netschema.env`, décommentez :

```
NETSCHEMA_TLS_CERT=C:\ProgramData\NetSchema\tls\netschema.crt
NETSCHEMA_TLS_KEY=C:\ProgramData\NetSchema\tls\netschema.key
```

et redémarrez :

```powershell
Restart-Service NetSchema     # ou : Stop-ScheduledTask/Start-ScheduledTask -TaskName NetSchema
```

Les cookies de session passent automatiquement en `Secure` et l'en-tête HSTS apparaît.

### Scénario B — IIS en façade

En résumé : IIS termine le TLS sur 443 et relaie vers le service, qui n'écoute plus que sur
`127.0.0.1:8080`. Il faut les modules **URL Rewrite** et **Application Request Routing**, un
site IIS portant le certificat, le `web.config` fourni, et ces quatre lignes dans
`netschema.env` :

```
NETSCHEMA_HOST=127.0.0.1
NETSCHEMA_PORT=8080
NETSCHEMA_TRUST_PROXY=true
NETSCHEMA_SECURE_COOKIES=true
# NETSCHEMA_TLS_CERT / NETSCHEMA_TLS_KEY restent commentés : IIS porte le certificat
```

La procédure complète, commande par commande, est en
[annexe](#12-annexe--installation-derrière-iis-pas-à-pas).

---

## 7. Créer le premier compte

Tant qu'aucun compte n'existe, la page de connexion affiche la commande à taper sur le serveur
— plutôt qu'un compte par défaut que personne ne pense à changer.

```powershell
cd C:\Apps\NetSchema
$env:NETSCHEMA_DATA_DIR = 'C:\ProgramData\NetSchema\data'
node tools\netschema-user.mjs add rnelson --role admin
```

Le mot de passe est demandé en **saisie masquée** : au moins 12 caractères, mêlant trois
catégories parmi minuscules, majuscules, chiffres et symboles. Il n'apparaît ni à l'écran ni
dans l'historique du terminal.

Les rôles :

| Rôle | Peut |
| --- | --- |
| `lecteur` | Ouvrir, consulter, rechercher, exporter. Le schéma s'ouvre verrouillé |
| `editeur` | Tout cela, plus modifier et créer des schémas |
| `admin` | Tout cela, plus gérer les comptes et supprimer des schémas |

Gestion courante des comptes :

```powershell
node tools\netschema-user.mjs list
node tools\netschema-user.mjs add mdupont --role editeur
node tools\netschema-user.mjs passwd mdupont       # réinitialisation, débloque aussi le compte
node tools\netschema-user.mjs role mdupont admin
node tools\netschema-user.mjs disable mdupont      # départ : on désactive, on ne supprime pas
node tools\netschema-user.mjs enable mdupont
node tools\netschema-user.mjs remove mdupont       # refusé si c'est le dernier admin actif
```

---

## 8. Vérifier l'installation

**Sur le serveur :**

```powershell
Get-Service NetSchema                                  # Status : Running
Invoke-RestMethod https://serveur:8443/api/health      # ok = True
Get-Content C:\ProgramData\NetSchema\data\service.log -Tail 20
Get-Content C:\ProgramData\NetSchema\data\audit.log -Tail 20
```

Le service doit avoir créé, dans le dossier de données : `users.json`, `session-secret.key`,
le dossier `diagrams\` et `audit.log`.

**Depuis un poste client**, la recette en six points :

1. `https://serveur:8443` s'ouvre sur la **page de connexion**, cadenas fermé dans le
   navigateur, sans avertissement de certificat.
2. Un mauvais mot de passe donne *« Identifiant ou mot de passe incorrect. »* — le même
   message qu'un identifiant inconnu, volontairement.
3. Le bon mot de passe ouvre l'application ; le bandeau du haut affiche le compte et son rôle.
4. **Schémas** → nommer, **Créer** : le schéma apparaît dans la liste.
5. Ajouter un équipement, attendre trois secondes : le bandeau indique *« Enregistré hh:mm »*.
   `Ctrl+S` force l'enregistrement.
6. **F5** : le schéma revient du serveur. **Quitter** ramène à la page de connexion.

Contrôle de bon cloisonnement : ouvrez `https://serveur:8443/api/diagrams` dans une fenêtre de
navigation privée — la réponse doit être **401**, pas la liste des schémas.

---

## 9. Exploitation

### Sauvegarde

Tout tient dans `C:\ProgramData\NetSchema\data` : comptes, schémas, secret de session,
journal. Une copie planifiée de ce dossier suffit ; restaurer consiste à le remettre en place,
service arrêté. Les écritures étant atomiques, la copie peut se faire service en marche.

```powershell
robocopy C:\ProgramData\NetSchema\data \\sauvegarde\netschema\$(Get-Date -f yyyy-MM-dd) /MIR /R:2 /W:5
```

Restauration :

```powershell
Stop-Service NetSchema
robocopy \\sauvegarde\netschema\2026-09-15 C:\ProgramData\NetSchema\data /MIR
Start-Service NetSchema
```

### Mise à jour

```powershell
cd C:\Sources\Test
git pull
cd apps\netschema-server\deploy\windows
.\Install-NetSchema.ps1 -SourceRoot C:\Sources\Test -InstallDir C:\Apps\NetSchema -Port 8443
```

Le script recompile et remplace l'installation ; `netschema.env` et le dossier de données sont
conservés. Une sauvegarde du dossier de données avant mise à jour reste la bonne habitude.

### Journal d'audit

`audit.log` contient une ligne JSON par événement : `login`, `login-refuse`, `logout`,
`schema-cree`, `schema-modifie`, `schema-supprime`, `compte-modifie`.

```powershell
Get-Content C:\ProgramData\NetSchema\data\audit.log -Tail 50 | ConvertFrom-Json |
    Format-Table at, event, username, ip, title

# Les échecs de connexion des dernières 24 h
Get-Content C:\ProgramData\NetSchema\data\audit.log | ConvertFrom-Json |
    Where-Object { $_.event -eq 'login-refuse' -and [datetime]$_.at -gt (Get-Date).AddDays(-1) }
```

### Arrêt, démarrage, désinstallation

```powershell
Stop-Service NetSchema ; Start-Service NetSchema ; Restart-Service NetSchema

.\Uninstall-NetSchema.ps1 -InstallDir C:\Apps\NetSchema -RemoveFiles
```

La désinstallation retire le service, la règle de pare-feu et — seulement avec `-RemoveFiles`
— le dossier d'installation. **Le dossier de données n'est jamais supprimé par le script.**

---

## 10. Problèmes courants

| Symptôme | Cause habituelle | Correction |
| --- | --- | --- |
| `.\Install-NetSchema.ps1 : impossible de charger le fichier` | Politique d'exécution, ou archive non débloquée | `Set-ExecutionPolicy -Scope Process Bypass`, et `Unblock-File` sur les scripts |
| `Node.js x.y est trop ancien` | Version en dessous de 20.11 | Installer la LTS, rouvrir la console (PATH) |
| Page blanche, erreur 503 « Application web introuvable » | `NETSCHEMA_WEB_DIR` ne pointe pas sur le `dist` copié | Corriger le chemin, redémarrer |
| Le service démarre puis s'arrête | Port pris, certificat illisible, dossier de données non accessible | `Get-Content …\data\service.log` ; `netstat -ano \| findstr :8443` |
| « Jeton de sécurité absent ou invalide » | Onglet resté ouvert après un redémarrage, ou cookies bloqués | Recharger la page (F5) |
| Connexion impossible, message d'installation | Aucun compte créé | Étape 7 |
| Compte bloqué | 10 échecs consécutifs | Attendre 15 minutes, ou `node tools\netschema-user.mjs passwd <compte>` |
| Avertissement « écoute en clair » au démarrage | HTTPS non configuré | Étape 6, scénario A ou B |
| Avertissement de certificat sur les postes | Nom du certificat ≠ nom utilisé, ou autorité interne non déployée | Utiliser le nom DNS du certificat ; diffuser l'autorité interne par GPO |
| Tout le monde vu avec la même adresse IP dans le journal | Derrière IIS sans `NETSCHEMA_TRUST_PROXY` | Passer la variable à `true` |
| « Le schéma a été modifié entre-temps » | Deux personnes sur le même schéma | Rouvrir le schéma pour repartir de la version du serveur |
| Les modifications ne s'enregistrent pas | Compte `lecteur`, ou schéma verrouillé | Vérifier le rôle ; déverrouiller le schéma |

---

## 11. Ce qui reste à votre charge

- **Certificat** : renouvellement et remplacement des fichiers PEM (ou du binding IIS). Notez
  la date d'expiration dès aujourd'hui.
- **Sauvegarde** : le dossier de données, testée au moins une fois par une vraie restauration.
- **Comptes** : ils sont locaux au serveur. Un raccordement à l'annuaire d'entreprise
  (LDAP/Entra ID) n'est pas fourni ; l'authentification est isolée dans `src/auth/` si vous
  souhaitez l'ajouter plus tard.
- **Mises à jour de Node.js** : suivre les versions LTS.
- **Supervision** : surveiller le service et l'URL `/api/health` avec vos outils habituels.


---

## 12. Annexe — installation derrière IIS, pas à pas

À suivre **après** les étapes 1 à 4 (le service est installé et fonctionne). IIS ne remplace
pas le service : il se place devant lui.

```
Poste client ──443/HTTPS──► IIS (certificat, URL Rewrite + ARR) ──8080/HTTP──► NetSchema
                                                                  127.0.0.1 uniquement
```

### 12.1 Installer IIS et ses modules

```powershell
# IIS et la console de gestion (Windows Server)
Install-WindowsFeature Web-Server, Web-Mgmt-Console -IncludeManagementTools
# Sur Windows 10/11 Pro :
# Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole, IIS-ManagementConsole -All
```

Puis deux modules, à télécharger sur <https://www.iis.net/downloads> (ou par Web Platform
Installer si vous l'avez encore) et à installer dans cet ordre :

1. **URL Rewrite 2.1** (`rewrite_amd64_fr-FR.msi`)
2. **Application Request Routing 3.0** (`requestRouterAMD64.msi`) — il installe aussi
   *External Cache*

Sur un serveur isolé, récupérez les deux `.msi` depuis un poste connecté ; ils s'installent
sans accès Internet. Contrôle :

```powershell
Get-WebGlobalModule | Where-Object Name -match 'Rewrite|RequestRouter'
```

### 12.2 Activer le proxy ARR

Installé, ARR ne relaie rien tant que le proxy n'est pas activé. En ligne de commande :

```powershell
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
    -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'

# Ne pas annoncer la version d'ARR dans les réponses.
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
    -Filter 'system.webServer/proxy' -Name 'reverseRewriteHostInResponseHeaders' -Value 'False'
```

Équivalent à la souris : console IIS → nœud du **serveur** → *Application Request Routing
Cache* → panneau de droite *Server Proxy Settings…* → cocher **Enable proxy** → *Appliquer*.

Vérification :

```powershell
(Get-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy').enabled
# True
```

### 12.3 Importer le certificat

Depuis un `.pfx` :

```powershell
$pwd = Read-Host 'Mot de passe du PFX' -AsSecureString
$cert = Import-PfxCertificate -FilePath C:\Certificats\netschema.pfx `
        -CertStoreLocation Cert:\LocalMachine\My -Password $pwd
$cert.Thumbprint
```

*(Ici, pas de conversion PEM : contrairement au scénario A, IIS lit le magasin Windows.)*

### 12.4 Créer le site IIS

Le site ne sert aucun fichier : il ne fait que relayer. Un dossier vide suffit, et le pool
d'applications n'a besoin d'aucun code managé.

```powershell
mkdir C:\inetpub\netschema -Force

New-WebAppPool -Name NetSchemaPool
Set-ItemProperty IIS:\AppPools\NetSchemaPool -Name managedRuntimeVersion -Value ''   # No Managed Code

New-WebSite -Name NetSchema -PhysicalPath C:\inetpub\netschema -ApplicationPool NetSchemaPool `
    -Port 443 -HostHeader netschema.societe.local -Ssl

# Associer le certificat au binding (SNI activé : plusieurs sites HTTPS peuvent coexister)
$binding = Get-WebBinding -Name NetSchema -Protocol https
$binding.AddSslCertificate($cert.Thumbprint, 'My')
Set-WebBinding -Name NetSchema -BindingInformation "*:443:netschema.societe.local" `
    -PropertyName sslFlags -Value 1
```

Si le site par défaut occupe déjà le port 443 sans en-tête d'hôte, arrêtez-le
(`Stop-WebSite 'Default Web Site'`) ou donnez-lui un en-tête d'hôte distinct.

### 12.5 Déposer le `web.config`

```powershell
Copy-Item C:\Sources\Test\apps\netschema-server\deploy\windows\web.config `
          C:\inetpub\netschema\web.config
```

Il contient trois choses, et rien de plus :

- une **règle entrante** qui relaie tout (`(.*)`) vers `http://127.0.0.1:8080/{R:1}` ;
- une **limite de taille** de requête alignée sur celle du service (8 Mo) ;
- le retrait de l'en-tête `X-Powered-By`.

Volontairement, **aucune règle sortante** : c'est le service qui marque ses cookies `Secure`
(`NETSCHEMA_SECURE_COOKIES=true`) et qui pose les en-têtes de sécurité. Une règle sortante
serait inutile, et IIS la refuserait sur des réponses compressées — le service comprime les
siennes.

Si vous changez le port du service, changez-le **aussi** dans cette règle.

### 12.6 Basculer le service en écoute locale

Dans `C:\Apps\NetSchema\netschema.env` :

```
NETSCHEMA_HOST=127.0.0.1
NETSCHEMA_PORT=8080
NETSCHEMA_TRUST_PROXY=true
NETSCHEMA_SECURE_COOKIES=true
# NETSCHEMA_TLS_CERT= et NETSCHEMA_TLS_KEY= commentés : IIS porte le certificat
```

`TRUST_PROXY` fait lire l'adresse réelle du client dans l'`X-Forwarded-For` ajouté par ARR :
sans elle, le journal d'audit et la limitation des tentatives de connexion verraient tout le
monde sous l'adresse du serveur — et dix échecs venant d'un seul poste bloqueraient tout le
monde. `SECURE_COOKIES` remplace la détection automatique, qui ne voit qu'une connexion en
clair puisque le TLS s'arrête chez IIS.

Avec NSSM, les variables sont recopiées dans la définition du service : rejouez la ligne
`AppEnvironmentExtra` (étape 4, point 5) ou le script d'installation, puis redémarrez.

```powershell
Restart-Service NetSchema
Start-Sleep 2
Invoke-RestMethod http://127.0.0.1:8080/api/health      # ok = True, en local
```

### 12.7 Refermer le port du service

Le service ne doit plus être joignable directement depuis le réseau : tout doit passer par
IIS.

```powershell
Get-NetFirewallRule -DisplayName "NetSchema (8443/TCP)" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule
# 443 est ouvert par la règle IIS standard « World Wide Web Services (HTTP Traffic-In) » ;
# sinon :
New-NetFirewallRule -DisplayName 'NetSchema HTTPS (443/TCP)' -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort 443 -Profile Domain, Private
```

Depuis un autre poste, `Test-NetConnection serveur -Port 8080` doit échouer, et
`Test-NetConnection serveur -Port 443` réussir.

### 12.8 Rediriger le HTTP vers le HTTPS (facultatif)

Pour que `http://netschema.societe.local` ne tombe pas dans le vide, ajoutez un binding 80 au
site et, **en première règle** du `web.config`, une redirection :

```xml
<rule name="HTTPS obligatoire" stopProcessing="true">
  <match url="(.*)" />
  <conditions>
    <add input="{HTTPS}" pattern="off" />
  </conditions>
  <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
</rule>
```

Elle doit précéder la règle `NetSchema`, sinon le relais l'emporte.

### 12.9 Vérifier

```powershell
iisreset /noforce
Get-Website NetSchema                                  # State : Started
Invoke-RestMethod https://netschema.societe.local/api/health
```

Puis la recette de l'[étape 8](#8-vérifier-linstallation) depuis un poste client, avec deux
contrôles propres à IIS :

```powershell
# Les cookies doivent revenir marqués Secure et HttpOnly
(Invoke-WebRequest https://netschema.societe.local/api/session -SessionVariable s).Headers['Set-Cookie']

# L'adresse du client doit apparaître dans le journal, pas celle du serveur
Get-Content C:\ProgramData\NetSchema\data\audit.log -Tail 5 | ConvertFrom-Json |
    Format-Table at, event, username, ip
```

### 12.10 Problèmes propres à IIS

| Symptôme | Cause | Correction |
| --- | --- | --- |
| **404.4** « aucun gestionnaire configuré » | Proxy ARR non activé | § 12.2 |
| **500.52** « outbound rewrite … encoded (gzip) » | Une règle sortante a été ajoutée | Les retirer : le service marque déjà ses cookies `Secure` |
| **500.50** « server variable … not allowed » | Une règle pose une variable non déclarée | Ne pas en poser, ou l'ajouter à `allowedServerVariables` |
| **502.3** « mauvaise passerelle » / délai dépassé | Service arrêté, mauvais port dans la règle | `Get-Service NetSchema` ; `Invoke-RestMethod http://127.0.0.1:8080/api/health` |
| **413** « Request Entity Too Large » sur un gros schéma | `requestLimits` d'IIS plus bas que la limite du service | Aligner `maxAllowedContentLength` et `NETSCHEMA_MAX_BODY_BYTES` |
| Connexion qui « retombe » sur la page de connexion | Cookies non marqués `Secure` | `NETSCHEMA_SECURE_COOKIES=true`, redémarrer le service |
| Tout le monde sous la même adresse dans le journal | `NETSCHEMA_TRUST_PROXY` resté à `false` | Passer à `true`, redémarrer |
| Blocages de comptes en cascade | Même cause : les échecs sont comptés par adresse | Idem |
| Le site ne démarre pas, port 443 occupé | `Default Web Site` sur le même binding | Lui donner un en-tête d'hôte, ou l'arrêter |
| Avertissement de certificat | Binding sans SNI ou mauvais nom | Vérifier `Get-WebBinding`, le nom DNS et l'en-tête d'hôte |

### 12.11 Mise à jour, avec IIS devant

Rien ne change : le script d'installation recompile et remplace le service, IIS n'est pas
touché. Le `web.config` n'a à être recopié que s'il a évolué dans le dépôt.
