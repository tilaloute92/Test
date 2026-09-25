# Installation — Suivi Infra & Réseau (Windows Server 2022)

Procédure d'installation du paquet livré. Comptez **15 à 30 minutes** pour une
installation complète.

> **Ce que contient ce paquet**
>
> | Dossier / fichier | Rôle |
> | --- | --- |
> | `site\` | L'application, déjà construite (HTML/CSS/JS) — publiée par IIS |
> | `service\` | Le service optionnel (Node.js), **dépendances déjà installées** — données d'équipe, authentification, envoi du programme du jour par mail |
> | `Installer-SuiviInfra.cmd` | **Installation par double-clic** (pose 4 questions, puis lance le script ci-dessous) |
> | `Install-SuiviInfra.ps1` | Installation automatisée, si vous préférez la ligne de commande |
> | `Enable-SuiviInfraHttps.ps1` | Bascule de HTTP vers HTTPS, une fois le certificat disponible |
> | `Test-SuiviInfra.ps1` | Vérification de l'installation |
> | `Backup-SuiviInfra.ps1` | Sauvegarde des données (vérifiée et cohérente) |
> | `Register-SuiviInfraBackup.ps1` | Met la sauvegarde en tâche planifiée quotidienne |
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

| | Scénario A — site seul (autonome) | Scénario B — site + service (**client/serveur**) |
| --- | --- | --- |
| **Connexion** | SSO Microsoft uniquement (ou aucune) | SSO **+ comptes locaux + LDAP/AD**, toujours obligatoire |
| **Où vivent les données** | Dans le navigateur de chacun | **Sur le serveur**, qui en est la seule référence |
| **Partage** | Aucun | Toute l'équipe, en ~8 secondes |
| **Node.js sur le serveur** | Non | Oui (LTS) |
| **Modules IIS** | Aucun | URL Rewrite + ARR |

Le scénario A suffit si chacun travaille sur ses propres données. **Prenez le scénario B** si
l'équipe doit voir le même planning, les mêmes tâches et les mêmes COPIL — c'est le cas le
plus courant, et c'est le vrai mode client/serveur.

> **Ce que le scénario B implique en exploitation**
>
> Le serveur devient la seule copie du travail de l'équipe. Trois conséquences à connaître
> avant de vous lancer :
>
> - **Si le service est arrêté, l'application est inutilisable** — volontairement. Les postes
>   affichent « Serveur indisponible » et refusent toute saisie, au lieu de laisser chacun
>   accumuler dans son coin des modifications que personne ne reverra. Tout redevient normal
>   au redémarrage du service, sans rien faire sur les postes.
> - **La sauvegarde du dossier `data\` n'est plus une précaution, c'est une obligation** —
>   voir la section Sauvegarde plus bas.
> - **Le service refuse de démarrer si un fichier de données est illisible**, en nommant le
>   fichier. C'est voulu : mieux vaut un service arrêté et un message clair qu'un service
>   qui démarre en affichant une équipe vide.

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
5. **NSSM** (facultatif) — <https://nssm.cc> — fait tourner Node comme un *vrai* service
   Windows. **S'il est absent, l'installation se poursuit** : le script enregistre à la place
   une tâche planifiée Windows « au démarrage », exécutée par SYSTEM, avec relance
   automatique en cas d'arrêt. Le résultat pratique est le même ; le service Windows reste
   préférable pour l'exploitation (visible dans `services.msc`, `Restart-Service`).

   Pour l'utiliser, posez simplement `nssm.exe` **à côté des scripts** (ou dans
   `prereqs\`, ou `C:\outils\`) : il est détecté tout seul. Vous pouvez aussi passer
   de la tâche planifiée au service Windows plus tard, en relançant l'installation une
   fois `nssm.exe` en place — le script remplace l'un par l'autre.
6. Les modules IIS **URL Rewrite** et **Application Request Routing (ARR)** —
   <https://www.iis.net/downloads>. Ils permettent à IIS de relayer `/api` vers le
   service local.

> Le paquet embarque déjà les dépendances du service : **aucun accès Internet n'est
> nécessaire sur le serveur** une fois les prérequis ci-dessus installés. Seul Node.js
> reste indispensable au scénario B ; tout le reste est soit installé par le script (IIS),
> soit facultatif (NSSM), soit nécessaire uniquement en HTTPS (certificat) ou pour le
> relais `/api` (URL Rewrite + ARR).

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

### Le plus simple : double-clic

Clic droit sur **`Installer-SuiviInfra.cmd`** → *Exécuter en tant qu'administrateur*.

Le lanceur pose quatre questions, avec les bonnes valeurs par défaut :

```
  Nom du serveur [winas] :
  Port IIS [8081] :
  Mode :  1) HTTP (par defaut)   2) HTTPS
  Service : 1) Non   2) Oui (client/serveur)
```

Appuyer sur Entrée à chaque question installe **`http://winas:8081`**, site seul. C'est la
mise en service la plus rapide : aucun certificat, aucun prérequis en dehors d'IIS, que le
script installe lui-même s'il manque.

### En ligne de commande

PowerShell **administrateur**, dans le dossier décompressé :

```powershell
# HTTP, site seul — équivalent du double-clic avec les valeurs par défaut
.\Install-SuiviInfra.ps1

# HTTP, avec le service (comptes locaux/LDAP, données partagées, envoi de mail)
.\Install-SuiviInfra.ps1 -WithService -NssmPath C:\outils\nssm.exe

# Directement en HTTPS, si le certificat est déjà importé
.\Install-SuiviInfra.ps1 -Protocol https -HostName winas.monentreprise.local -Port 443 -WithService
```

> Si PowerShell refuse d'exécuter le script (stratégie d'exécution), lancez-le ainsi :
> `powershell -ExecutionPolicy Bypass -File .\Install-SuiviInfra.ps1`
> C'est exactement ce que fait le lanceur `.cmd`.

Le script vérifie **tous** les prérequis avant de modifier quoi que ce soit, puis :

- publie le site dans `C:\inetpub\suivi-infra` ;
- crée le site IIS et la liaison demandée (**HTTP 8081** par défaut), en remplaçant une
  liaison précédente plutôt qu'en empilant une seconde ;
- ajoute une règle de pare-feu sur le port choisi (profil Domaine) ;
- en scénario B : installe le service `SuiviInfraAuth`, génère un `.env` avec un secret de
  session aléatoire, restreint les droits sur le dossier de données, et configure le relais
  `/api` dans IIS.

Options utiles : `-SiteName`, `-SitePath`, `-ServicePath`, `-ServicePort`,
`-CertificateThumbprint`, `-SkipFirewall`. Détail : `Get-Help .\Install-SuiviInfra.ps1 -Full`.

> ### ⚠ Ce qu'implique le mode HTTP
>
> En HTTP, **tout circule en clair sur le réseau** : mots de passe de connexion, données
> d'équipe, contenu des tâches. C'est acceptable pour une mise en service sur un réseau
> interne maîtrisé, le temps d'obtenir un certificat — ce n'est pas un état durable.
> Le script vous le rappelle en fin d'installation.

### Passer en HTTPS ensuite

Dès que le certificat pour votre nom DNS est importé dans *Ordinateur local → Personnel* :

```powershell
.\Enable-SuiviInfraHttps.ps1 -HostName winas -WithService
```

Le script remplace la liaison HTTP par une liaison HTTPS, déplace la règle de pare-feu, et
aligne la configuration du service (`COOKIE_SECURE=true`, `CORS_ORIGIN`) — deux valeurs sans
lesquelles la connexion cesserait de fonctionner sans message clair. Ni les fichiers du site,
ni les données d'équipe, ni le secret de session ne sont touchés.

Les sessions ouvertes en HTTP sont invalidées : chacun devra se reconnecter une fois.

> Avec un nom court comme `winas`, un certificat d'AC interne (AD CS) est indispensable :
> aucune autorité publique n'émet pour un nom sans domaine. Si vous n'en avez pas, restez en
> HTTP ou faites émettre un certificat pour le nom complet (`winas.monentreprise.local`) et
> passez-le à `-HostName`.

## 5. Le premier compte (scénario B uniquement)

**Le script s'en charge**, sans rien demander. S'il n'existe aucun compte, il crée :

| | |
| --- | --- |
| Identifiant | `admin` |
| Mot de passe | `SuiviInfra2026!` |

Connectez-vous avec ce compte, onglet **Compte local**.

> ### ⚠ Ce mot de passe est public
>
> Il figure dans cette documentation et dans le code : tant qu'il n'est pas changé, toute
> personne connaissant le produit peut ouvrir votre application. **Changez-le à la première
> connexion**, dans Paramètres → Authentification locale.
>
> L'application affiche un bandeau rouge en haut de chaque écran tant que c'est le cas, pour
> tout le monde. Il disparaît dès que le mot de passe est changé.

Utilisez `-AdminUser` pour un autre identifiant, ou `-SkipAdminAccount` pour n'en créer aucun.

> ### Vous avez installé la version `ad871b1` ?
>
> Cette version-là créait le compte avec le mot de passe **`Administrateur`**, et non
> `SuiviInfra2026!` : le mot de passe était transmis par un argument vide, que Windows
> PowerShell 5.1 escamote, si bien que le nom complet glissait à sa place. Le symptôme est
> « Identifiant ou mot de passe incorrect » avec les identifiants documentés.
>
> Connectez-vous avec `admin` / `Administrateur`, puis changez le mot de passe
> immédiatement — il est public au même titre que l'autre, et l'application affiche le même
> bandeau rouge tant qu'il est en place. Ou, sans attendre, réinitialisez-le :
> `.\Reset-SuiviInfraAdmin.ps1` depuis une console administrateur.

### Quels comptes existent ?

Quand la connexion est refusée, la première chose à trancher est de savoir si c'est
l'identifiant ou le mot de passe qui est faux. Console **administrateur** :

```powershell
cd C:\services\suivi-infra
npm run list-users
```

Le script affiche les identifiants existants — jamais les mots de passe, qui ne sont stockés
que sous forme d'empreinte. `Test-SuiviInfra.ps1` les affiche également, lorsqu'il est lancé
depuis une console élevée.

### « Identifiant ou mot de passe incorrect » avec les identifiants attendus

Ce message vient du service, pas du navigateur : il prouve déjà que le service tourne et que
le relais `/api` fonctionne. Il ne reste que deux possibilités — le compte n'existe pas dans
le dossier que le service lit réellement, ou son mot de passe n'est pas celui que vous
croyez. Un seul script tranche, console **administrateur** :

```powershell
.\Repair-SuiviInfraLogin.ps1
```

Il retrouve le dossier réellement utilisé par le service **depuis la tâche planifiée** (et
non depuis un chemin supposé : une installation antérieure ailleurs suffit à ce qu'un compte
soit créé dans un dossier que le service ne lit jamais), affiche les comptes présents, fixe
le mot de passe que vous saisissez, puis **le vérifie en appelant la vraie API de
connexion**. Écrire le fichier ne prouve rien ; seul un `200` sur `/api/auth/local` prouve
que vous pourrez entrer.

`-DiagnoseOnly` affiche le diagnostic sans rien modifier.

> #### Attention au blocage après plusieurs essais
>
> Le service refuse plus de **10 tentatives par quart d'heure** et par adresse. Passé ce
> seuil, même le bon mot de passe est rejeté — avec un autre message, « Trop de tentatives de
> connexion ». Le compteur vit en mémoire : redémarrer le service le remet à zéro
> immédiatement.
>
> ```powershell
> Restart-ScheduledTask -TaskName SuiviInfraService
> ```

### Mot de passe oublié, ou personne ne peut se connecter

Console **administrateur** :

```powershell
.\Reset-SuiviInfraAdmin.ps1
```

Le mot de passe est demandé de façon masquée. `-UserName` vise un autre compte que `admin`.
Le script ne touche ni au site, ni au service, ni aux données d'équipe.

Les comptes suivants se gèrent depuis l'application, dans **Paramètres → Authentification
locale** — plus besoin de repasser par le serveur.

### Le créer à la main

Si vous avez installé avec `-SkipAdminAccount`, ou si vous voulez ajouter un compte sans
passer par l'application :

```powershell
cd C:\services\suivi-infra
node scripts\create-local-user.js rnelson "MotDePasseSolide123!" "R. Nelson"
```

> ### ⚠ Cette commande exige une console **administrateur**
>
> Le dossier `data\` est réservé aux administrateurs et au compte SYSTEM — il contient les
> empreintes des mots de passe et les données de l'équipe. Depuis une console ordinaire, la
> commande échoue avec :
>
> ```
> Error: EPERM: operation not permitted, mkdir 'C:\services\suivi-infra\data'
> ```
>
> Ouvrez PowerShell par **clic droit → Exécuter en tant qu'administrateur**. Appartenir au
> groupe Administrateurs ne suffit pas : sans élévation, Windows retire ce groupe du jeton
> de la session.

Le mot de passe peut aussi être passé par la variable `SUIVI_INFRA_PASSWORD`, pour qu'il
n'apparaisse ni dans la liste des processus ni dans l'historique du terminal :

```powershell
$env:SUIVI_INFRA_PASSWORD = 'MotDePasseSolide123!'
node scripts\create-local-user.js rnelson --name "R. Nelson"
Remove-Item Env:\SUIVI_INFRA_PASSWORD
```

> Le nom complet se passe par `--name`, **jamais** comme troisième argument après un mot de
> passe vide : Windows PowerShell 5.1 supprime les arguments vides transmis aux programmes
> externes, et le nom complet prendrait alors la place du mot de passe. La commande refuse
> désormais de créer un compte quand un mot de passe lui parvient à la fois par argument et
> par `SUIVI_INFRA_PASSWORD` — c'est la signature de ce décalage.

### Comptes Active Directory

Une fois connecté avec ce compte local, activez l'annuaire dans **Paramètres → Annuaire
Active Directory (LDAP)** : URL du contrôleur de domaine et motif d'identifiant (le plus
simple étant `{username}@monentreprise.local`, l'UPN). Chacun pourra alors se connecter avec
son compte Windows, onglet **Identifiant Windows / LDAP**. Le mot de passe AD n'est jamais
stocké : le serveur le vérifie par un *bind* auprès de votre contrôleur de domaine.

## 5 bis. Programme du jour par mail (optionnel, scénario B)

Le service peut envoyer chaque matin à chacun son programme de la journée. Il ne délivre rien
lui-même : il remet le message à votre relais SMTP.

1. Renseignez dans `C:\services\suivi-infra\.env` :

   ```
   SMTP_HOST=relais.monentreprise.local
   SMTP_PORT=25
   SMTP_FROM=Suivi Infra <suivi-infra@monentreprise.fr>
   DAILY_MAIL_AT=07:30
   ```

   `SMTP_USER` / `SMTP_PASS` uniquement si le relais exige une authentification ; un relais
   interne accepte souvent les messages sur la seule foi de l'adresse IP du serveur.
   Laissez `DAILY_MAIL_AT` vide pour n'envoyer qu'à la demande.

2. Redémarrez le service : `Restart-Service SuiviInfraAuth`.

3. Renseignez l'**adresse mail de chaque membre** dans l'onglet Équipe de l'application.
   Sans adresse, la personne ne reçoit rien — c'est signalé, ce n'est pas une erreur.

4. Depuis l'onglet **Activité du jour**, bouton « Programme par mail » : vous y trouvez l'état
   du relais, un bouton *Tester le relais*, l'aperçu de chaque message avant envoi, et le
   résultat destinataire par destinataire.

> L'adresse de `SMTP_FROM` doit être autorisée à émettre sur le relais, sinon les messages
> seront rejetés. C'est la cause d'échec la plus fréquente.

## 6. Vérifier

```powershell
.\Test-SuiviInfra.ps1 -HostName winas -Protocol http -Port 8081
# scénario B :
.\Test-SuiviInfra.ps1 -HostName winas -Protocol http -Port 8081 -WithService
```

Tous les contrôles doivent être au vert. Le script vérifie notamment que les données
d'équipe sont bien **refusées sans session authentifiée** (401) — un contrôle de
sécurité, pas seulement de bon fonctionnement.

Puis, depuis un poste du domaine, ouvrez `http://winas:8081` (ou votre adresse HTTPS) :
le cadenas doit s'afficher sans avertissement (avec un certificat d'AC interne, l'AC
doit être déployée sur les postes par GPO).

## 7. Premiers réglages dans l'application

1. **SSO Microsoft** (si utilisé) : onglet *Paramètres* → renseignez `tenantId`,
   `clientId` et l'URI de redirection `https://suivi-infra.monentreprise.local`, et
   déclarez cette même URI côté Entra ID (type *Application monopage / SPA*).
2. **Mise en service** (scénario B) : connectez-vous avec le compte `admin`. L'application
   affiche un écran **« Mise en service du serveur »** proposant deux départs, **une seule
   fois pour toute l'équipe** :
   - *Démarrer avec un serveur vide* — vous créez l'équipe depuis l'onglet Équipe. C'est le
     choix normal pour une nouvelle installation.
   - *Reprendre les N enregistrement(s) de ce poste* — proposé uniquement si ce navigateur
     utilisait déjà l'application en autonome. Ses données deviennent alors la référence de
     l'équipe. **À faire depuis le poste qui détient les bonnes données**, et depuis lui seul.

   Une fois ce choix confirmé, le serveur refuse toute nouvelle mise en service : le contenu
   d'un seul navigateur ne peut plus écraser le travail de l'équipe.
3. **Exiger la connexion** : en scénario B, la connexion est **de toute façon obligatoire**
   (les données sont derrière une API qui exige une session) — l'interrupteur ne concerne que
   le scénario A. Activez-le là si vous voulez verrouiller le site autonome.

---

## Sauvegarde — à mettre en place tout de suite (scénario B)

En mode client/serveur, **tout le travail de l'équipe** vit dans :

```
C:\services\suivi-infra\data\
```

(comptes locaux, tâches, planning, temps saisi, absences, FDR, COPIL). Rien ne le
sauvegarde automatiquement. **Une seule commande met tout en place**, à lancer en
administrateur depuis le dossier décompressé :

```powershell
.\Register-SuiviInfraBackup.ps1 -Destination \\serveur-sauvegarde\suivi-infra
```

Elle installe le script de sauvegarde, crée la tâche planifiée quotidienne (21h00 par
défaut), **puis l'exécute une fois et vérifie qu'elle a réussi** — une tâche planifiée qui
n'a jamais tourné n'est pas une sauvegarde, c'est une intention.

Options utiles : `-At 22:30`, `-RetentionDays 90`, `-RunAsUser DOMAINE\svc-sauvegarde`,
`-ExportXml tache.xml` (pour réimporter la même tâche ailleurs avec
`schtasks /Create /TN "Suivi Infra - Sauvegarde" /XML tache.xml`).

> **Destination réseau : le piège classique.** Par défaut la tâche s'exécute sous `SYSTEM`,
> qui n'a pas d'identité réseau propre — il se présente au partage sous le **compte
> ordinateur** du serveur (`DOMAINE\NOMSERVEUR$`). Soit vous autorisez ce compte en écriture
> sur le partage, soit vous passez `-RunAsUser` avec un compte de service. Sans cela, la
> sauvegarde échouerait tous les soirs sans que personne ne s'en aperçoive : c'est
> précisément pour cela que le script fait une exécution de contrôle et vous dit laquelle
> des deux situations vous êtes.

Ce que le script fait qu'une simple copie ne fait pas :

- **il vérifie la cohérence** de l'instantané (si l'équipe écrit pendant la copie, il
  recommence — le compteur de version des données sert de témoin) ;
- **il relit chaque fichier copié** : un JSON invalide fait échouer la sauvegarde plutôt que
  de la laisser passer pour bonne, car le service refuse justement de démarrer dessus ;
- **il ne purge les anciennes sauvegardes qu'après un succès**, pour ne jamais se retrouver
  sans aucune copie valide ;
- **il dépose une note `RESTAURATION.txt`** dans chaque sauvegarde, avec la marche à suivre —
  le jour d'un incident, c'est ce dossier qu'on ouvre, rarement la documentation ;
- **il renvoie un code d'erreur** que le Planificateur de tâches affiche, au lieu d'échouer
  en silence.

Le fichier `.env` (secret de session, configuration LDAP) n'est **pas** sauvegardé par
défaut : il partirait sur le partage avec un secret en clair. `-IncludeEnv` l'ajoute si votre
destination est protégée comme le serveur. Sans lui, une restauration reste possible : il
suffit de regénérer un secret (tout le monde se reconnecte) et de ressaisir LDAP.

Vérifiez le journal de temps en temps : `\\serveur-sauvegarde\suivi-infra\sauvegarde.log`.

C'est la **seule** copie : en mode client/serveur, la restauration depuis le navigateur est
désactivée dans l'application (elle ne changerait rien côté serveur et serait effacée à
l'actualisation suivante — elle donnerait donc l'illusion d'avoir fonctionné). Pour restaurer :
arrêtez le service, remettez les fichiers `business-*.json` depuis la sauvegarde, redémarrez.

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
| Écran « Serveur indisponible » sur les postes | Le service est arrêté, ou le relais `/api` d'IIS ne répond plus. Comportement voulu : l'application refuse de laisser saisir hors ligne. Elle redevient utilisable seule au retour du service. |
| L'écran de mise en service ne s'affiche pas | Le serveur a déjà été mis en service — c'est la protection contre l'écrasement du travail de l'équipe. |
| Le service ne démarre pas : « fichier de données illisible » | Un `business-*.json` est corrompu. Restaurez-le depuis la sauvegarde, puis redémarrez. Le refus de démarrer est volontaire (voir §1). |
| « Modifié entre-temps par X — votre modification n'a pas été enregistrée » | Un collègue a modifié la même tâche/FDR/COPIL pendant votre saisie. Le serveur refuse d'écraser son travail. Rouvrez l'élément : il affiche la version du serveur, refaites votre modification dessus. |
| Un poste ne voit pas ses anciennes données après la bascule | Normal : le serveur fait référence. Ses données d'avant sont conservées à part — *Paramètres → Données conservées avant la bascule* permet de les télécharger. |
| Le service ne démarre pas | Port déjà utilisé (changez `PORT` dans `.env` **et** relancez le script avec `-ServicePort`), ou `.env` invalide. Journaux : `service.err.log`. |
| La tâche de sauvegarde échoue tous les soirs (destination réseau) | Le compte d'exécution n'a pas le droit d'écrire sur le partage. Autorisez le compte ordinateur `DOMAINE\NOMSERVEUR$`, ou relancez `Register-SuiviInfraBackup.ps1` avec `-RunAsUser`. |
| Sauvegarde : « copie cohérente impossible après 3 tentatives » | Le serveur est modifié en continu à cette heure-là. Décalez la tâche : `Register-SuiviInfraBackup.ps1 -At 04:00 …`. |

Pour la procédure manuelle équivalente, étape par étape (utile pour comprendre ce que
fait le script ou pour l'adapter), voir `DEPLOYMENT-reference.md`.
