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
| Certificat | Un PFX (ou deux fichiers PEM) lu par le service | Binding IIS habituel |
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
| Certificat | Un certificat serveur pour le nom DNS retenu — **pas nécessaire pour démarrer** : on met d'abord en service en HTTP, le certificat s'ajoute ensuite |
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

## 2. Récupérer le paquet (ou les sources)

Deux façons d'apporter l'application sur le serveur. **La première est celle à préférer** :
elle ne demande ni Git, ni compilation, ni accès au registre npm.

### a. Le paquet prêt à installer (recommandé)

Un fichier `NetSchema-<version>-windows.zip` d'environ 1,5 Mo, qui contient l'interface
compilée, le serveur compilé, ses dépendances et les scripts d'installation. Copiez-le sur le
serveur, par exemple dans `C:\Temp`, puis **clic droit → Propriétés → Débloquer**, puis
**Extraire tout…**

Ce paquet se fabrique depuis le dépôt, sur n'importe quelle machine ayant Node.js :

```bash
cd apps/netschema-server
node tools/creer-paquet.mjs          # produit paquet/NetSchema-<version>-windows.zip
```

### b. Le dépôt complet

```powershell
mkdir C:\Sources -Force
cd C:\Sources
git clone <url-du-depot> Test
cd C:\Sources\Test
git checkout claude/network-infrastructure-schema-app-hxmk8h
```

Sans Git : téléchargez l'archive ZIP du dépôt, **clic droit → Propriétés → Débloquer** avant
de l'extraire (sinon Windows marque les scripts comme « venant d'Internet » et refuse de les
exécuter). L'installeur compilera alors lui-même, ce qui suppose un accès au registre npm.

---

## 3. Installation automatique (voie normale)

Depuis le dossier extrait : **clic droit sur `1-Installer.cmd` → Exécuter en tant
qu'administrateur**. Un double-clic simple marche aussi, le script demande l'élévation.

En ligne de commande, dans une console administrateur :

```powershell
cd C:\Temp\NetSchema-1.0.0-windows
.\Installer-NetSchema.ps1

# depuis le dépôt plutôt que le paquet :
.\Installer-NetSchema.ps1 -SourceRoot C:\Sources\Test
```

### Paramètres

| Paramètre | Défaut | À quoi il sert |
| --- | --- | --- |
| `-Port` | `8080` | Port d'écoute, aussi ouvert dans le pare-feu |
| `-Admin` | `admin` | Identifiant proposé pour le premier compte |
| `-InstallDir` | `C:\Apps\NetSchema` | Où l'application est installée |
| `-DataDir` | `C:\ProgramData\NetSchema\data` | Comptes, schémas, journal |
| `-ServiceName` | `NetSchema` | Nom du service Windows |
| `-SourceRoot` | — | Dépôt à compiler, quand on n'utilise pas le paquet |
| `-NssmPath` | téléchargé si besoin | Gestionnaire de service |
| `-NodeVersion` | `22.11.0` | Version installée si Node.js est absent |
| `-SansNode` | — | N'installe pas Node.js : échoue s'il manque |
| `-Diagnostic` | — | N'installe rien, écrit un rapport d'état |
| `-Desinstaller` | — | Retire service, pare-feu et fichiers (données conservées) |
| `-SansPause` | — | Ne demande pas d'appuyer sur Entrée à la fin (installation scriptée) |

### Ce que le script fait, dans l'ordre

1. **Node.js** — vérifie la version (20.11 minimum) et, s'il manque, l'installe : par winget
   s'il est disponible, sinon en téléchargeant le paquet MSI officiel.
2. **Fichiers** — utilise le paquet s'il est à côté du script, sinon compile depuis le dépôt.
3. **Installation** — arrête le service en place, copie dans `C:\Apps\NetSchema`, crée le
   dossier de données.
4. **Configuration** — écrit `netschema.env`. *Un fichier déjà présent n'est jamais écrasé.*
5. **Service** — déclare le service Windows en démarrage automatique (NSSM, téléchargé au
   besoin ; à défaut une tâche planifiée), et lui passe la configuration.
6. **Droits et pare-feu** — réserve le dossier de données au compte de service et aux
   administrateurs, ouvre le port (profils Domaine et Privé uniquement, jamais Public).
7. **Démarrage** — démarre, puis **attend que `/api/health` réponde** ; en cas d'échec,
   affiche les dernières lignes du journal du service et les causes les plus fréquentes.
8. **Premier compte** — demande identifiant et mot de passe (saisie masquée, transmise par
   l'entrée standard et non en argument de commande), et crée l'administrateur.

Tout est consigné dans `C:\ProgramData\NetSchema\logs\installation-….log`.

Le script est **rejouable sans risque** : une seconde exécution répare ou met à jour
l'installation sans toucher aux schémas, aux comptes ni à la configuration.

### NSSM ou tâche planifiée

- **Avec [`nssm.exe`](https://nssm.cc)** — vrai service Windows, **redémarrage automatique en
  cas de plantage**, journaux dans `service.log` avec rotation à 10 Mo, service tournant sous
  son **compte virtuel** `NT SERVICE\NetSchema` (aucun mot de passe à gérer). L'installeur le
  télécharge tout seul ; on peut aussi le poser à côté du script ou le désigner par
  `-NssmPath`.
- **Sans NSSM** (serveur sans Internet) — repli sur une tâche planifiée au démarrage, exécutée
  en `SYSTEM`. Utilisable, mais elle ne relance pas le serveur s'il s'arrête seul.

### En cas de problème

```powershell
.\Installer-NetSchema.ps1 -Diagnostic
```

Écrit `C:\ProgramData\NetSchema\diagnostic-….txt` : version de Node, état du service, ports
en écoute, configuration, journaux. Aucun mot de passe n'y figure — c'est le fichier à
transmettre.

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
| `NETSCHEMA_TLS_PFX` | — | Certificat PFX/PKCS#12 du magasin Windows. **Renseigné = HTTPS activé** |
| `NETSCHEMA_TLS_PASSPHRASE` | — | Mot de passe du PFX |
| `NETSCHEMA_TLS_CERT` / `NETSCHEMA_TLS_KEY` | — | Variante PEM : certificat et clé. **Les deux renseignés = HTTPS activé** |
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
> `Installer-NetSchema.ps1` ou la ligne `AppEnvironmentExtra` ci-dessus, puis redémarrez.
> Avec la tâche planifiée, le fichier est relu à chaque démarrage : un redémarrage suffit.

---

## 6. Activer le HTTPS

### Scénario A — le service porte le certificat

**Le plus simple : `2-Activer-HTTPS.cmd`**, clic droit → *Exécuter en tant qu'administrateur*.
Il demande le fichier `.pfx` et son mot de passe, installe le certificat, bascule la
configuration, redémarre et vérifie.

En ligne de commande, dans une console administrateur :

```powershell
cd C:\Temp\NetSchema-1.0.0-windows

# depuis un fichier .pfx
.\Configurer-HTTPS.ps1 -Pfx C:\Certificats\winas.pfx

# ou depuis un certificat déjà présent dans le magasin de l'ordinateur
Get-ChildItem Cert:\LocalMachine\My | Select-Object Thumbprint, Subject, NotAfter
.\Configurer-HTTPS.ps1 -Empreinte 9F2C4A…
```

Le script :

1. vérifie le certificat (clé privée présente, mot de passe correct) et affiche sa date
   d'expiration ;
2. le copie dans `C:\ProgramData\NetSchema\data\tls\netschema.pfx`, dont il réserve la lecture
   au compte de service et aux administrateurs ;
3. renseigne `NETSCHEMA_TLS_PFX`, `NETSCHEMA_TLS_PASSPHRASE`, le port (8443 par défaut) et
   `NETSCHEMA_SECURE_COOKIES=true` ; protège aussi `netschema.env`, qui contient désormais le
   mot de passe du certificat ;
4. ouvre le nouveau port dans le pare-feu, redémarre le service et **attend que l'application
   réponde en HTTPS** avant d'afficher la nouvelle adresse.

Le service lit donc **directement le PFX** du magasin Windows : pas de conversion, pas
d'OpenSSL à installer. Les cookies de session passent en `Secure` et l'en-tête HSTS apparaît.

<details>
<summary>À la main, ou avec un certificat au format PEM</summary>

Le service accepte aussi deux fichiers PEM — utile quand le certificat vient d'une autorité
Linux ou d'un Let's Encrypt :

```
NETSCHEMA_TLS_CERT=C:\ProgramData\NetSchema\data\tls\netschema.crt
NETSCHEMA_TLS_KEY=C:\ProgramData\NetSchema\data\tls\netschema.key
NETSCHEMA_SECURE_COOKIES=true
NETSCHEMA_PORT=8443
```

Si la chaîne de certification est fournie à part, concaténez le certificat serveur **puis**
les intermédiaires dans le `.crt`, dans cet ordre. Puis redémarrez :

```powershell
Restart-Service NetSchema
```

</details>

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
[annexe](#12-annexe--installation-derrière-iis-pas-à-pas). Elle se fait en deux temps : mise
en service **en HTTP** d'abord (avec `NETSCHEMA_SECURE_COOKIES=false`, le temps de vérifier la
chaîne), certificat ensuite.

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
# Avec le paquet : extraire la nouvelle version, puis
.\Installer-NetSchema.ps1

# Depuis le dépôt :
cd C:\Sources\Test
git pull
cd apps\netschema-server\deploy\windows
.\Installer-NetSchema.ps1 -SourceRoot C:\Sources\Test
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

.\Installer-NetSchema.ps1 -Desinstaller
```

La désinstallation retire le service, la règle de pare-feu et le dossier d'installation.
**Le dossier de données n'est jamais supprimé par le script.**

---

## 10. Problèmes courants

| Symptôme | Cause habituelle | Correction |
| --- | --- | --- |
| `.\Installer-NetSchema.ps1 : impossible de charger le fichier` | Politique d'exécution, ou archive non débloquée | `Set-ExecutionPolicy -Scope Process Bypass`, et `Unblock-File` sur les scripts |
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

À suivre **après** les étapes 1 à 4 : le service est installé et fonctionne. IIS ne remplace
pas le service, il se place devant lui.

La procédure se fait en **deux temps**. On met d'abord la chaîne complète en service **en
HTTP**, sans certificat : c'est ce qui permet de vérifier séparément le relais IIS, le
service, les comptes et les schémas. Le certificat s'ajoute ensuite, sans rien réinstaller.

```
Phase 1   Poste client ──80/HTTP───► IIS (URL Rewrite + ARR) ──8080/HTTP──► NetSchema
Phase 2   Poste client ──443/HTTPS─► IIS (certificat, ARR)   ──8080/HTTP──► NetSchema
                                                                127.0.0.1 uniquement
```

> **La phase 1 est une phase de mise au point, pas un état de fonctionnement.** En HTTP, les
> mots de passe et les cookies de session circulent en clair sur le réseau : n'y laissez pas
> de comptes réels ni de schémas de production, et enchaînez sur la phase 2 le jour même.
> Créez le compte administrateur définitif **après** le passage en HTTPS (ou changez son mot
> de passe à ce moment-là).

---

# Phase 1 — mettre en service en HTTP

### 12.1 Installer IIS et ses modules

```powershell
# IIS et la console de gestion (Windows Server)
Install-WindowsFeature Web-Server, Web-Mgmt-Console -IncludeManagementTools
# Sur Windows 10/11 Pro :
# Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole, IIS-ManagementConsole -All
```

Puis deux modules, à télécharger sur <https://www.iis.net/downloads> et à installer dans cet
ordre :

1. **URL Rewrite 2.1** (`rewrite_amd64_fr-FR.msi`)
2. **Application Request Routing 3.0** (`requestRouterAMD64.msi`) — il installe aussi
   *External Cache*

Sur un serveur isolé, récupérez les deux `.msi` depuis un poste connecté ; ils s'installent
sans accès Internet. Contrôle :

```powershell
Get-WebGlobalModule | Where-Object Name -match 'Rewrite|RequestRouter'
```

### 12.2 Activer le proxy ARR

Installé, ARR ne relaie rien tant que le proxy n'est pas activé : IIS répond alors **404.4**
sans autre explication.

```powershell
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
    -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'

# Ne pas annoncer la version d'ARR dans les réponses.
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
    -Filter 'system.webServer/proxy' -Name 'reverseRewriteHostInResponseHeaders' -Value 'False'

(Get-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy').enabled
# True
```

Équivalent à la souris : console IIS → nœud du **serveur** → *Application Request Routing
Cache* → panneau de droite *Server Proxy Settings…* → cocher **Enable proxy** → *Appliquer*.

### 12.3 Créer le site, en HTTP

Le site ne sert aucun fichier : il ne fait que relayer. Un dossier vide suffit, et le pool
d'applications n'a besoin d'aucun code managé.

```powershell
mkdir C:\inetpub\netschema -Force

New-WebAppPool -Name NetSchemaPool
Set-ItemProperty IIS:\AppPools\NetSchemaPool -Name managedRuntimeVersion -Value ''   # No Managed Code

New-WebSite -Name NetSchema -PhysicalPath C:\inetpub\netschema -ApplicationPool NetSchemaPool `
    -Port 80 -HostHeader netschema.societe.local
```

Si `Default Web Site` occupe déjà le port 80 sans en-tête d'hôte, arrêtez-le
(`Stop-WebSite 'Default Web Site'`) ou donnez-lui un en-tête d'hôte distinct — deux sites ne
peuvent pas écouter le même port avec le même en-tête.

### 12.4 Déposer le `web.config`

```powershell
Copy-Item C:\Sources\Test\apps\netschema-server\deploy\windows\web.config `
          C:\inetpub\netschema\web.config
```

Il contient trois choses, et rien de plus :

- une **règle entrante** qui relaie tout (`(.*)`) vers `http://127.0.0.1:8080/{R:1}` ;
- une **limite de taille** de requête alignée sur celle du service (8 Mo) ;
- le retrait de l'en-tête `X-Powered-By`.

Volontairement, **aucune règle sortante** : c'est le service qui marque ses cookies `Secure`
et qui pose les en-têtes de sécurité. Une règle sortante serait inutile, et IIS la refuserait
sur des réponses compressées — le service comprime les siennes.

Si vous changez le port du service, changez-le **aussi** dans cette règle.

### 12.5 Basculer le service en écoute locale

Dans `C:\Apps\NetSchema\netschema.env` :

```
NETSCHEMA_HOST=127.0.0.1
NETSCHEMA_PORT=8080
NETSCHEMA_TRUST_PROXY=true
NETSCHEMA_SECURE_COOKIES=false
# NETSCHEMA_TLS_CERT= et NETSCHEMA_TLS_KEY= commentés : le TLS ne sera pas porté par le service
```

Trois points méritent l'attention :

- `TRUST_PROXY=true` fait lire l'adresse réelle du client dans l'`X-Forwarded-For` ajouté par
  ARR. Sans elle, le journal d'audit et la limitation des tentatives de connexion verraient
  tout le monde sous l'adresse du serveur — et dix échecs venant d'un seul poste bloqueraient
  tout le monde.
- `SECURE_COOKIES=false` **pendant cette phase seulement** : un cookie marqué `Secure` n'est
  pas renvoyé par le navigateur sur une connexion en clair, et la connexion retomberait
  indéfiniment sur la page d'accueil. Il repassera à `true` en phase 2.
- `HOST=127.0.0.1` : le service n'est plus joignable que depuis la machine elle-même.

Avec NSSM, les variables sont recopiées dans la définition du service : rejouez la ligne
`AppEnvironmentExtra` (étape 4, point 5) ou le script d'installation, puis redémarrez.

```powershell
Restart-Service NetSchema
Start-Sleep 2
Invoke-RestMethod http://127.0.0.1:8080/api/health      # ok = True, en local
```

### 12.6 Pare-feu

```powershell
# Le service ne doit plus être joignable directement : tout passe par IIS.
Get-NetFirewallRule -DisplayName "NetSchema (8443/TCP)" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule

# Le port 80 est ouvert par la règle IIS standard « World Wide Web Services (HTTP Traffic-In) ».
Get-NetFirewallRule -DisplayName '*World Wide Web*' | Select-Object DisplayName, Enabled
Enable-NetFirewallRule -DisplayName 'World Wide Web Services (HTTP Traffic-In)'
```

### 12.7 Vérifier la chaîne complète

```powershell
iisreset /noforce
Get-Website NetSchema                                      # State : Started
Invoke-RestMethod http://netschema.societe.local/api/health  # ok = True, à travers IIS
```

Depuis un poste client, la recette de l'[étape 8](#8-vérifier-linstallation), avec un compte
**provisoire** créé pour l'occasion :

```powershell
cd C:\Apps\NetSchema
$env:NETSCHEMA_DATA_DIR = 'C:\ProgramData\NetSchema\data'
node tools\netschema-user.mjs add recette --role admin
```

Contrôlez aussi que l'adresse vue dans le journal est bien celle du poste, pas celle du
serveur — c'est le seul moyen de savoir que `TRUST_PROXY` est effectif :

```powershell
Get-Content C:\ProgramData\NetSchema\data\audit.log -Tail 5 | ConvertFrom-Json |
    Format-Table at, event, username, ip
```

Et que le service n'est plus joignable en direct, depuis un autre poste :

```powershell
Test-NetConnection serveur -Port 8080      # doit échouer
Test-NetConnection serveur -Port 80        # doit réussir
```

À ce stade, toute la chaîne fonctionne. Il ne reste qu'à la chiffrer.

---

# Phase 2 — ajouter le certificat

Rien de ce qui précède n'est défait : on ajoute un binding, on bascule un réglage, on ferme
le HTTP.

### 12.8 Importer le certificat

Depuis un `.pfx` (ici, pas de conversion PEM : IIS lit le magasin Windows) :

```powershell
$pwd = Read-Host 'Mot de passe du PFX' -AsSecureString
$cert = Import-PfxCertificate -FilePath C:\Certificats\netschema.pfx `
        -CertStoreLocation Cert:\LocalMachine\My -Password $pwd
$cert.Thumbprint
```

Le nom du certificat doit être **exactement** celui que les postes utiliseront
(`netschema.societe.local` dans nos exemples), sans quoi le navigateur affichera un
avertissement. Vérification :

```powershell
$cert | Select-Object Subject, DnsNameList, NotAfter
```

Notez la date d'expiration dès maintenant : c'est elle qui vous rappellera à l'ordre dans un
an.

### 12.9 Ajouter le binding HTTPS

```powershell
New-WebBinding -Name NetSchema -Protocol https -Port 443 `
    -HostHeader netschema.societe.local -SslFlags 1        # 1 = SNI

$binding = Get-WebBinding -Name NetSchema -Protocol https
$binding.AddSslCertificate($cert.Thumbprint, 'My')
```

Le site répond maintenant **en 80 et en 443**. Testez le HTTPS avant d'aller plus loin :

```powershell
Invoke-RestMethod https://netschema.societe.local/api/health    # ok = True
```

Ouvrez la page dans un navigateur : cadenas fermé, aucun avertissement. Si le certificat
vient d'une autorité interne, assurez-vous qu'elle est diffusée sur les postes (GPO) —
sinon l'avertissement apparaîtra sur tous les clients.

### 12.10 Repasser les cookies en `Secure`

Maintenant que le HTTPS fonctionne, dans `netschema.env` :

```
NETSCHEMA_SECURE_COOKIES=true
```

puis :

```powershell
Restart-Service NetSchema
```

Le service marque alors ses cookies de session `Secure` et ajoute l'en-tête HSTS. Les
personnes connectées pendant la bascule devront se reconnecter une fois — sans conséquence.

> Ne faites **pas** cette bascule avant que le HTTPS réponde : les cookies `Secure` ne
> circulent pas en clair, et l'accès en HTTP cesserait de fonctionner d'un coup, sans message
> d'erreur explicite.

### 12.11 Fermer le HTTP

Deux façons, au choix.

**Rediriger** (recommandé : un favori en `http://` continue de fonctionner). Ajoutez cette
règle **avant** la règle `NetSchema` dans `C:\inetpub\netschema\web.config` — sinon le relais
l'emporte :

```xml
<rule name="HTTPS obligatoire" stopProcessing="true">
  <match url="(.*)" />
  <conditions>
    <add input="{HTTPS}" pattern="off" />
  </conditions>
  <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
</rule>
```

**Ou supprimer purement le binding 80** :

```powershell
Remove-WebBinding -Name NetSchema -Protocol http -Port 80 -HostHeader netschema.societe.local
```

Dans les deux cas, vérifiez que le port 443 est bien ouvert dans le pare-feu :

```powershell
Enable-NetFirewallRule -DisplayName 'World Wide Web Services (HTTPS Traffic-In)'
# ou, si la règle n'existe pas :
New-NetFirewallRule -DisplayName 'NetSchema HTTPS (443/TCP)' -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort 443 -Profile Domain, Private
```

### 12.12 Comptes définitifs

Le compte de recette a circulé en clair : supprimez-le, et créez les comptes réels maintenant
que la liaison est chiffrée.

```powershell
cd C:\Apps\NetSchema
$env:NETSCHEMA_DATA_DIR = 'C:\ProgramData\NetSchema\data'
node tools\netschema-user.mjs add rnelson --role admin
node tools\netschema-user.mjs remove recette
```

### 12.13 Vérification finale

```powershell
iisreset /noforce
Invoke-RestMethod https://netschema.societe.local/api/health

# Les cookies doivent revenir marqués Secure et HttpOnly
(Invoke-WebRequest https://netschema.societe.local/api/session).Headers['Set-Cookie']

# En HTTP : une redirection 301 (ou plus rien, si le binding a été retiré)
try   { (Invoke-WebRequest http://netschema.societe.local -MaximumRedirection 0).StatusCode }
catch { $_.Exception.Response.StatusCode.value__ }
```

Depuis un poste client, rejouez la recette de l'[étape 8](#8-vérifier-linstallation) en
`https://`, et contrôlez que `https://netschema.societe.local/api/diagrams` répond **401** en
navigation privée.

---

### 12.14 Problèmes propres à IIS

| Symptôme | Cause | Correction |
| --- | --- | --- |
| **404.4** « aucun gestionnaire configuré » | Proxy ARR non activé | § 12.2 |
| **502.3** « mauvaise passerelle » / délai dépassé | Service arrêté, ou mauvais port dans la règle | `Get-Service NetSchema` ; `Invoke-RestMethod http://127.0.0.1:8080/api/health` |
| **500.52** « outbound rewrite … encoded (gzip) » | Une règle sortante a été ajoutée | La retirer : le service marque déjà ses cookies `Secure` |
| **500.50** « server variable … not allowed » | Une règle pose une variable non déclarée | Ne pas en poser, ou l'ajouter à `allowedServerVariables` |
| **413** « Request Entity Too Large » sur un gros schéma | `requestLimits` d'IIS plus bas que la limite du service | Aligner `maxAllowedContentLength` et `NETSCHEMA_MAX_BODY_BYTES` |
| La connexion « retombe » sur la page de connexion | Cookies `Secure` sur une liaison en clair (ou l'inverse) | Phase 1 : `SECURE_COOKIES=false`. Phase 2 : `true` **et** accès en `https://` |
| Tout le monde sous la même adresse dans le journal | `NETSCHEMA_TRUST_PROXY` resté à `false` | Passer à `true`, redémarrer |
| Blocages de comptes en cascade | Même cause : les échecs sont comptés par adresse | Idem |
| Le site ne démarre pas, port occupé | `Default Web Site` sur le même binding | Lui donner un en-tête d'hôte, ou l'arrêter |
| Avertissement de certificat | Binding sans SNI, mauvais nom, ou autorité interne non déployée | `Get-WebBinding` ; diffuser l'autorité par GPO |
| `New-WebBinding` refuse le certificat | Certificat importé dans le magasin de l'utilisateur | Réimporter dans `Cert:\LocalMachine\My` |

### 12.15 Mise à jour, avec IIS devant

Rien ne change : le script d'installation recompile et remplace le service, IIS n'est pas
touché. Le `web.config` n'a à être recopié que s'il a évolué dans le dépôt — attention, une
recopie écrase la règle de redirection ajoutée au § 12.11.
