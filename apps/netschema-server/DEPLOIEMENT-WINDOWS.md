# Déployer NetSchema sur un serveur Windows

Objectif : un service Windows qui démarre tout seul, sert l'application en HTTPS aux postes
du réseau interne, et range comptes et schémas dans un dossier que l'on sauvegarde.

Compté large, l'installation prend une demi-heure. Deux scénarios au choix :

- **A — Le service porte le HTTPS** (le plus simple, aucune dépendance IIS).
- **B — IIS en façade** (si le serveur héberge déjà des sites, ou si le certificat doit venir
  du magasin Windows).

---

## 0. Prérequis

| | |
| --- | --- |
| Système | Windows Server 2016 ou plus récent (fonctionne aussi sur Windows 10/11 Pro) |
| Node.js | **20.11 LTS ou plus récent**, installé pour toute la machine — <https://nodejs.org> |
| Droits | Une console PowerShell « exécuter en tant qu'administrateur » |
| Réseau | Un port libre (8443 par défaut) ouvert depuis les postes clients |
| Certificat | Un certificat serveur pour le nom DNS utilisé (interne ou public) |

Vérification rapide :

```powershell
node --version      # v20.11.0 ou plus
npm --version
```

---

## 1. Récupérer les sources

Copiez le dépôt sur le serveur (ou clonez-le), par exemple dans `C:\Sources\Test`. Seuls
deux dossiers sont nécessaires : `apps\netschema` (interface) et `apps\netschema-server`
(service).

---

## 2. Installation automatique

```powershell
cd C:\Sources\Test\apps\netschema-server\deploy\windows
.\Install-NetSchema.ps1 -SourceRoot C:\Sources\Test -InstallDir C:\Apps\NetSchema -Port 8443
```

Le script :

1. vérifie Node.js ;
2. compile l'interface web et le serveur ;
3. copie le tout dans `C:\Apps\NetSchema` et crée `C:\ProgramData\NetSchema\data` ;
4. écrit `netschema.env` (configuration) à partir de l'exemple ;
5. restreint les droits du dossier de données au compte de service ;
6. déclare le service Windows et l'ouvre dans le pare-feu (profils Domaine et Privé).

**Redémarrage automatique en cas de plantage** : placez [`nssm.exe`](https://nssm.cc) à côté
du script (ou passez `-NssmPath C:\Outils\nssm.exe`). Sans NSSM, le script installe une tâche
planifiée au démarrage — cela suffit à un usage interne, mais ne relance pas le service en
cas d'arrêt inattendu.

---

## 3. Activer le HTTPS

### Scénario A — le service porte le certificat

Le service lit un certificat et une clé au format PEM. Depuis un `.pfx` exporté du magasin
Windows (OpenSSL est fourni avec Git pour Windows) :

```powershell
mkdir C:\ProgramData\NetSchema\tls
openssl pkcs12 -in netschema.pfx -clcerts -nokeys  -out C:\ProgramData\NetSchema\tls\netschema.crt
openssl pkcs12 -in netschema.pfx -nocerts -nodes   -out C:\ProgramData\NetSchema\tls\netschema.key
icacls C:\ProgramData\NetSchema\tls /inheritance:r /grant:r "NT SERVICE\NetSchema:(OI)(CI)R" "BUILTIN\Administrators:(OI)(CI)F"
```

Puis dans `C:\Apps\NetSchema\netschema.env`, décommentez :

```
NETSCHEMA_TLS_CERT=C:\ProgramData\NetSchema\tls\netschema.crt
NETSCHEMA_TLS_KEY=C:\ProgramData\NetSchema\tls\netschema.key
```

et redémarrez le service :

```powershell
Restart-Service NetSchema          # ou : Stop-ScheduledTask/Start-ScheduledTask NetSchema
```

### Scénario B — IIS en façade

1. Installez les modules IIS **URL Rewrite** et **Application Request Routing**, puis activez
   le proxy (IIS → Application Request Routing Cache → Server Proxy Settings → *Enable proxy*).
2. Créez un site IIS avec votre certificat, pointant vers un dossier vide.
3. Copiez [`deploy/windows/web.config`](deploy/windows/web.config) à la racine de ce site.
4. Dans `netschema.env` :

```
NETSCHEMA_HOST=127.0.0.1
NETSCHEMA_PORT=8080
NETSCHEMA_TRUST_PROXY=true
NETSCHEMA_SECURE_COOKIES=true
# NETSCHEMA_TLS_CERT / NETSCHEMA_TLS_KEY restent commentés : IIS porte le certificat
```

Le service n'est alors plus joignable directement depuis le réseau : refermez son port dans
le pare-feu.

---

## 4. Créer le premier compte

```powershell
cd C:\Apps\NetSchema
$env:NETSCHEMA_DATA_DIR = 'C:\ProgramData\NetSchema\data'
node tools\netschema-user.mjs add rnelson --role admin
```

Le mot de passe est demandé en saisie masquée (12 caractères minimum, trois catégories parmi
minuscules, majuscules, chiffres, symboles). Les comptes suivants se créent de la même façon,
ou depuis l'application par un administrateur.

Rôles : `lecteur` consulte, `editeur` modifie, `admin` gère comptes et suppressions.

---

## 5. Vérifier

```powershell
Invoke-RestMethod https://serveur:8443/api/health     # { ok = True ... }
Get-Service NetSchema
Get-Content C:\ProgramData\NetSchema\data\audit.log -Tail 20
```

Depuis un poste client : `https://serveur:8443` → page de connexion → un schéma vide →
*Schémas* pour en créer un. Les modifications sont enregistrées automatiquement quelques
secondes après la dernière action, et `Ctrl+S` force l'enregistrement.

---

## 6. Exploitation

### Sauvegarde

Tout tient dans `C:\ProgramData\NetSchema\data` : comptes, schémas, secret de session,
journal. Une copie planifiée de ce dossier suffit ; une restauration consiste à le remettre
en place, service arrêté.

```powershell
# Exemple : copie quotidienne, service en fonctionnement (écritures atomiques)
robocopy C:\ProgramData\NetSchema\data \\sauvegarde\netschema\$(Get-Date -f yyyy-MM-dd) /MIR /R:2 /W:5
```

### Mise à jour

```powershell
cd C:\Sources\Test
git pull
cd apps\netschema-server\deploy\windows
.\Install-NetSchema.ps1 -SourceRoot C:\Sources\Test -InstallDir C:\Apps\NetSchema -Port 8443
```

Le script recompile et remplace l'installation ; `netschema.env` et le dossier de données
sont conservés.

### Journal

`audit.log` contient une ligne JSON par événement :

```powershell
Get-Content C:\ProgramData\NetSchema\data\audit.log -Tail 50 | ConvertFrom-Json |
    Format-Table at, event, username, ip, title
```

### Désinstallation

```powershell
.\Uninstall-NetSchema.ps1 -InstallDir C:\Apps\NetSchema -RemoveFiles
```

Le dossier de données n'est jamais supprimé par le script.

---

## 7. Problèmes courants

| Symptôme | Cause habituelle | Correction |
| --- | --- | --- |
| Page blanche, erreur 503 « Application web introuvable » | `NETSCHEMA_WEB_DIR` ne pointe pas sur le `dist` copié | Corriger le chemin dans `netschema.env`, redémarrer |
| « Jeton de sécurité absent ou invalide » | Onglet resté ouvert après un redémarrage, ou cookies bloqués | Recharger la page (F5) |
| Connexion impossible, `setupRequired` | Aucun compte créé | `node tools\netschema-user.mjs add … --role admin` |
| Compte bloqué | 10 échecs consécutifs | Attendre 15 minutes, ou `npm run user -- passwd <compte>` |
| Le service ne démarre pas | Port déjà pris, ou certificat illisible | `Get-Content …\data\service.log` ; `netstat -ano \| findstr :8443` |
| Avertissement « écoute en clair » au démarrage | HTTPS non configuré | Scénario A ou B ci-dessus |
| Tout le monde vu avec la même adresse IP | Derrière IIS sans `NETSCHEMA_TRUST_PROXY` | Passer la variable à `true` |

---

## 8. Ce qui reste à votre charge

- **Certificat** : renouvellement et remplacement des fichiers PEM (ou du binding IIS).
- **Sauvegarde** : le dossier de données, testée au moins une fois par une restauration.
- **Comptes** : ils sont locaux au serveur. Un raccordement à l'annuaire d'entreprise
  (LDAP/Entra ID) n'est pas fourni ; l'authentification est isolée dans
  `src/auth/` si vous souhaitez l'ajouter plus tard.
- **Mises à jour de Node.js** : suivre les versions LTS.
