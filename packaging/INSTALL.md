# Installation — Suivi Infra & Réseau (Windows Server 2022)

Procédure d'installation du paquet livré. Comptez **15 à 30 minutes** pour une
installation complète.

> **Ce que contient ce paquet**
>
> | Dossier / fichier | Rôle |
> | --- | --- |
> | `site\` | L'application, déjà construite (HTML/CSS/JS) — publiée par IIS |
> | `service\` | Le service optionnel (Node.js), **dépendances déjà installées** |
> | `Install-SuiviInfra.ps1` | Installation automatisée |
> | `Test-SuiviInfra.ps1` | Vérification de l'installation |
> | `Uninstall-SuiviInfra.ps1` | Désinstallation |
> | `SHA256SUMS.txt` | Empreintes, pour vérifier l'intégrité après transfert |
> | `DEPLOYMENT-reference.md` | La procédure manuelle détaillée (référence) |
> | `README-application.md` | Description fonctionnelle de l'application |
>
> Il n'y a **pas de `.exe` à lancer** : l'application est un site web statique, et le
> service est du JavaScript exécuté par Node.js. C'est ce qui permet au serveur de
> n'exécuter aucun code applicatif compilé.

---

## 1. Choisir votre scénario

| | Scénario A — site seul | Scénario B — site + service |
| --- | --- | --- |
| **Connexion** | SSO Microsoft uniquement (ou aucune) | SSO **+ comptes locaux + LDAP/AD** |
| **Données** | Locales à chaque navigateur | **Partagées entre toute l'équipe** |
| **Node.js sur le serveur** | Non | Oui (LTS) |
| **Modules IIS** | Aucun | URL Rewrite + ARR |

Le scénario A suffit si chacun travaille sur ses propres données. Prenez le scénario B
si l'équipe doit voir le même planning, les mêmes tâches et les mêmes COPIL — c'est le
cas le plus courant.

Vous pouvez commencer en A et passer en B plus tard sans rien perdre : relancez
simplement le script avec `-WithService`.

## 2. Prérequis

**Sur le serveur** (Windows Server 2022, à jour) :

1. **Un nom DNS** interne pointant vers le serveur (ex. `suivi-infra.monentreprise.local`).
2. **Un certificat HTTPS** pour ce nom, importé dans *Ordinateur local → Personnel*
   (`certlm.msc`). Certificat d'AC interne (AD CS) ou public, au choix — voir
   `DEPLOYMENT-reference.md` §4.1.
3. Le rôle **IIS** (le script l'installe si absent).

**Uniquement pour le scénario B**, en plus :

4. **Node.js LTS** — <https://nodejs.org> (l'installeur par défaut convient).
5. **NSSM** — <https://nssm.cc> — fait tourner Node comme un vrai service Windows
   (démarrage automatique, redémarrage en cas de plantage). Décompressez `nssm.exe`
   quelque part, par exemple `C:\outils\nssm.exe`.
6. Les modules IIS **URL Rewrite** et **Application Request Routing (ARR)** —
   <https://www.iis.net/downloads>. Ils permettent à IIS de relayer `/api` vers le
   service local.

> Le paquet embarque déjà les dépendances du service : **aucun accès Internet n'est
> nécessaire sur le serveur** une fois les prérequis ci-dessus installés.

## 3. Transférer et vérifier le paquet

Copiez l'archive `.zip` sur le serveur, puis, en PowerShell :

```powershell
Expand-Archive .\suivi-infra-reseau_*_win2022.zip -DestinationPath C:\temp\suivi-infra
cd C:\temp\suivi-infra\suivi-infra-reseau_*_win2022
```

Vérifiez l'intégrité du transfert (facultatif mais recommandé) :

```powershell
$anomalies = 0
Get-Content .\SHA256SUMS.txt | ForEach-Object {
    $hash, $path = $_ -split '\s+', 2
    $path = $path -replace '^\*?\./', ''      # sha256sum préfixe les chemins par "./"
    if (Test-Path -LiteralPath $path) {
        $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $hash) { Write-Host "DIFFÉRENT : $path" -ForegroundColor Red; $anomalies++ }
    } else { Write-Host "MANQUANT : $path" -ForegroundColor Red; $anomalies++ }
}
Write-Host "Vérification terminée — anomalies : $anomalies"
```

`anomalies : 0` et aucune ligne rouge = le paquet est intact.

Si Windows a marqué les fichiers comme provenant d'Internet, débloquez-les :

```powershell
Get-ChildItem -Recurse | Unblock-File
```

## 4. Installer

Ouvrez PowerShell **en tant qu'administrateur**, dans le dossier décompressé.

**Scénario A — site seul :**

```powershell
.\Install-SuiviInfra.ps1 -HostName suivi-infra.monentreprise.local
```

**Scénario B — site + service :**

```powershell
.\Install-SuiviInfra.ps1 -HostName suivi-infra.monentreprise.local `
    -WithService -NssmPath C:\outils\nssm.exe
```

> Si PowerShell refuse d'exécuter le script (stratégie d'exécution), lancez-le ainsi :
> `powershell -ExecutionPolicy Bypass -File .\Install-SuiviInfra.ps1 -HostName ...`

Le script vérifie **tous** les prérequis avant de modifier quoi que ce soit, puis :

- publie le site dans `C:\inetpub\suivi-infra` ;
- crée le site IIS, la liaison **HTTPS 443** avec votre certificat, et **retire la
  liaison HTTP** (l'application n'est jamais servie en clair) ;
- ajoute une règle de pare-feu 443/TCP (profil Domaine) ;
- en scénario B : installe le service `SuiviInfraAuth`, génère un `.env` avec un secret
  de session aléatoire, restreint les droits sur le dossier de données, et configure le
  relais `/api` dans IIS.

Options utiles : `-SitePath`, `-ServicePath`, `-ServicePort`, `-CertificateThumbprint`
(si plusieurs certificats correspondent au nom), `-SkipFirewall` (si vos règles sont
gérées par GPO). Détail : `Get-Help .\Install-SuiviInfra.ps1 -Full`.

## 5. Créer le premier compte (scénario B uniquement)

```powershell
cd C:\services\suivi-infra
node scripts\create-local-user.js admin "MotDePasseSolide123!" "Administrateur"
```

Ce compte sert à se connecter la première fois ; tout le reste (autres comptes, LDAP)
se gère ensuite depuis l'onglet **Paramètres** de l'application.

## 6. Vérifier

```powershell
.\Test-SuiviInfra.ps1 -HostName suivi-infra.monentreprise.local
# scénario B :
.\Test-SuiviInfra.ps1 -HostName suivi-infra.monentreprise.local -WithService
```

Tous les contrôles doivent être au vert. Le script vérifie notamment que les données
d'équipe sont bien **refusées sans session authentifiée** (401) — un contrôle de
sécurité, pas seulement de bon fonctionnement.

Puis, depuis un poste du domaine, ouvrez `https://suivi-infra.monentreprise.local` :
le cadenas doit s'afficher sans avertissement (avec un certificat d'AC interne, l'AC
doit être déployée sur les postes par GPO).

## 7. Premiers réglages dans l'application

1. **SSO Microsoft** (si utilisé) : onglet *Paramètres* → renseignez `tenantId`,
   `clientId` et l'URI de redirection `https://suivi-infra.monentreprise.local`, et
   déclarez cette même URI côté Entra ID (type *Application monopage / SPA*).
2. **Mode multi-utilisateur** (scénario B) : connectez-vous avec le compte `admin`,
   allez dans *Paramètres → Mode multi-utilisateur* et cliquez sur **« Publier les
   données de ce navigateur »** pour initialiser le jeu de données partagé de l'équipe.
   Ce bouton n'apparaît qu'une seule fois, tant que le serveur est vide : ensuite, le
   serveur refuse toute nouvelle publication pour ne jamais écraser le travail de
   l'équipe.
3. **Exiger la connexion** : toujours dans *Paramètres*, activez l'interrupteur une fois
   que la connexion fonctionne.

---

## Sauvegarde — à mettre en place tout de suite (scénario B)

En mode multi-utilisateur, **tout le travail de l'équipe** vit dans :

```
C:\services\suivi-infra\data\
```

(comptes locaux, tâches, planning, temps saisi, absences, FDR, COPIL). Rien ne le
sauvegarde automatiquement. Exemple de tâche planifiée quotidienne :

```powershell
$dest = "\\serveur-sauvegarde\suivi-infra\$(Get-Date -Format yyyy-MM-dd)"
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item C:\services\suivi-infra\data\*.json $dest
```

En scénario A, il n'y a rien à sauvegarder côté serveur : les données sont dans le
navigateur de chaque utilisateur, qui peut les exporter depuis *Paramètres →
Sauvegarde*.

## Mettre à jour vers une version ultérieure

Relancez simplement le nouveau paquet avec les **mêmes paramètres** :

```powershell
.\Install-SuiviInfra.ps1 -HostName suivi-infra.monentreprise.local `
    -WithService -NssmPath C:\outils\nssm.exe
```

Le script met à jour les fichiers et redémarre le service. Sont **préservés** : le
dossier `data\` (comptes et données d'équipe), le fichier `.env` (secret de session et
configuration LDAP), et un `web.config` que vous auriez personnalisé — dans ce dernier
cas, la version du paquet est déposée à côté sous `web.config.nouveau-<date>` pour
comparaison, plutôt qu'appliquée en écrasant la vôtre.

## Désinstaller

```powershell
.\Uninstall-SuiviInfra.ps1                 # conserve les données
.\Uninstall-SuiviInfra.ps1 -RemoveData     # supprime tout (confirmation demandée)
```

---

## Dépannage

| Symptôme | Cause probable et correctif |
| --- | --- |
| `Aucun certificat valide trouvé` | Le certificat n'est pas dans *Ordinateur local → Personnel*, est expiré, ou son nom ne correspond pas à `-HostName`. Vérifiez dans `certlm.msc`. |
| `Plusieurs certificats correspondent` | Relancez avec `-CertificateThumbprint <empreinte>` (le script liste les candidats). |
| Page inaccessible depuis un poste | DNS qui ne pointe pas sur le serveur, pare-feu, ou site arrêté. Lancez `Test-SuiviInfra.ps1`. |
| Avertissement de certificat dans le navigateur | AC interne non déployée sur les postes (GPO), ou nom du certificat ≠ URL utilisée. |
| Onglet *Paramètres* : « Non authentifié » | Normal tant que vous n'êtes pas connecté. Connectez-vous avec le compte local créé au §5. |
| `/api/health` ne répond pas (scénario B) | Service arrêté → `C:\services\suivi-infra\service.err.log` ; ou modules URL Rewrite/ARR absents ; ou proxy ARR désactivé (Gestionnaire IIS → niveau serveur → *Application Request Routing Cache* → *Server Proxy Settings* → *Enable proxy*). |
| Le mode multi-utilisateur ne s'active pas | Il exige une **vraie session serveur** : connectez-vous avec un compte local/LDAP (ou SSO validé côté serveur). Le SSO seul, sans le service, ne l'active pas — c'est voulu. |
| Le bouton « Publier » n'apparaît pas | Le serveur contient déjà des données : c'est la protection contre l'écrasement du travail de l'équipe. |
| Le service ne démarre pas | Port déjà utilisé (changez `PORT` dans `.env` **et** relancez le script avec `-ServicePort`), ou `.env` invalide. Journaux : `service.err.log`. |

Pour la procédure manuelle équivalente, étape par étape (utile pour comprendre ce que
fait le script ou pour l'adapter), voir `DEPLOYMENT-reference.md`.
