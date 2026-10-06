# Installation — Plan Relief (Windows Server 2022)

Procédure d'installation du paquet livré. Comptez **20 à 30 minutes**.

Plan Relief reprend l'installation, la sécurisation et la connexion de **Suivi Infra &
Réseau** en mode client/serveur : site publié par IIS en HTTPS, service Node.js en service
Windows derrière un relais `/api`, connexion par comptes locaux, Active Directory
(LDAP) ou Microsoft Entra ID, sauvegarde quotidienne vérifiée. Les deux applications
peuvent tourner sur le même serveur : noms d'hôte, ports, services et dossiers sont
distincts.

> **Ce que contient ce paquet**
>
> | Dossier / fichier | Rôle |
> | --- | --- |
> | `site\` | L'interface, déjà construite (HTML/CSS/JS), publiée par IIS |
> | `service\` | Le service Node.js, **dépendances déjà installées** |
> | `Install-PlanRelief.ps1` | Installation automatisée |
> | `Test-PlanRelief.ps1` | Vérification de l'installation |
> | `Backup-PlanRelief.ps1` | Sauvegarde des plans (vérifiée et cohérente) |
> | `Register-PlanReliefBackup.ps1` | Met la sauvegarde en tâche planifiée quotidienne |
> | `Uninstall-PlanRelief.ps1` | Désinstallation |
> | `SHA256SUMS.txt` | Empreintes, pour vérifier l'intégrité après transfert |
> | `DEPLOYMENT-reference.md` | La procédure manuelle détaillée (référence) |
> | `README-application.md` | Description fonctionnelle de l'application |
>
> Il n'y a **pas de `.exe` à lancer** : l'interface est un site web statique, et le service
> est du JavaScript exécuté par Node.js.

---

## 1. Ce qui diffère de Suivi Infra & Réseau

| | Suivi Infra & Réseau | Plan Relief |
| --- | --- | --- |
| Scénarios | A (site seul) ou B (site + service) | **Toujours site + service** : les plans sont stockés sur le serveur |
| Port de l'application (navigateur) | 443 | **8082** (`-Port`) |
| Port local du service | 4000 | **4100** |
| Service Windows | `SuiviInfraAuth` | **`PlanReliefSvc`** |
| Dossiers | `C:\inetpub\suivi-infra`, `C:\services\suivi-infra` | **`C:\inetpub\plan-relief`**, **`C:\services\plan-relief`** |
| SSO Microsoft | Identifiants saisis dans l'onglet Paramètres | Identifiants dans le `.env` du service uniquement |
| URI de redirection Entra ID | `https://<site>` | **`https://<site>/auth-redirect.html`** |
| Taille des envois | Petits envois JSON | Plans jusqu'à **100 Mo** (limite IIS relevée dans `web.config`) |

Comme pour le scénario B de Suivi Infra : **si le service est arrêté, l'application est
inutilisable** (écran « Serveur indisponible »), **la sauvegarde de `data\` est une
obligation**, et **le service refuse de démarrer si un fichier de données est illisible**,
en nommant le fichier.

## 2. Prérequis

Sur le serveur (Windows Server 2022, à jour) :

1. **Un nom DNS** interne pointant vers le serveur (ex. `plans.monentreprise.local`).
2. **Un certificat HTTPS** pour ce nom, importé dans *Ordinateur local → Personnel*
   (`certlm.msc`), émis par l'AC interne (AD CS) ou une AC publique.
3. Le rôle **IIS** (le script l'installe si absent).
4. **Node.js LTS** : <https://nodejs.org> (l'installeur par défaut convient).
5. **NSSM** (facultatif) : <https://nssm.cc>. Sans NSSM, le service est lancé par une tâche
   planifiée Windows (voir §4) : rien à télécharger.
6. Les modules IIS **URL Rewrite** et **Application Request Routing (ARR)** :
   <https://www.iis.net/downloads>.

Si Suivi Infra & Réseau est déjà installé sur ce serveur, les prérequis 3 à 6 sont déjà
en place.

> Le paquet embarque les dépendances du service et le moteur de lecture OCR : **aucun accès
> Internet n'est nécessaire sur le serveur**. Le navigateur des utilisateurs n'appelle Internet que pour la connexion
> Microsoft, si elle est activée.

## 3. Transférer et vérifier le paquet

```powershell
Expand-Archive .\plan-relief_*_win2022.zip -DestinationPath C:\temp\plan-relief
cd C:\temp\plan-relief\plan-relief_*_win2022
```

Vérifiez l'intégrité du transfert (recommandé) :

```powershell
$anomalies = 0
Get-Content .\SHA256SUMS.txt | ForEach-Object {
    $hash, $path = $_ -split '\s+', 2
    $path = $path -replace '^\*?\./', ''
    if (Test-Path -LiteralPath $path) {
        $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $hash) { Write-Host "DIFFÉRENT : $path" -ForegroundColor Red; $anomalies++ }
    } else { Write-Host "MANQUANT : $path" -ForegroundColor Red; $anomalies++ }
}
Write-Host "Vérification terminée — anomalies : $anomalies"
```

Si Windows a marqué les fichiers comme provenant d'Internet : `Get-ChildItem -Recurse | Unblock-File`.

## 4. Installer

PowerShell **en tant qu'administrateur**, dans le dossier décompressé :

```powershell
.\Install-PlanRelief.ps1 -HostName plans.monentreprise.local -Port 8082
```

**Lancement du service Node.js, deux possibilités :**

| | Sans NSSM (par défaut si nssm.exe est absent) | Avec NSSM (`-NssmPath C:\outils\nssm.exe`) |
| --- | --- | --- |
| Mécanisme | Tâche planifiée « Plan Relief - Service », au démarrage du serveur, sous SYSTEM | Service Windows `PlanReliefSvc` (comme Suivi Infra) |
| Relance si Node s'arrête | Oui : script superviseur `Start-PlanReliefService.ps1` (relance espacée de 30 s si l'échec est immédiat) | Oui : NSSM |
| Journaux | `service.log`, `service.err.log` (rotation à 10 Mo) | idem |
| Arrêter / démarrer | `Stop-ScheduledTask` / `Start-ScheduledTask -TaskName 'Plan Relief - Service'` | `Stop-Service` / `Start-Service PlanReliefSvc` |
| Visible dans | Planificateur de tâches | Services (`services.msc`) |

`-ScheduledTask` force le mode tâche planifiée même si nssm.exe est dans le PATH. Relancer le
script dans l'autre mode bascule proprement de l'un à l'autre.

> Si PowerShell refuse d'exécuter le script :
> `powershell -ExecutionPolicy Bypass -File .\Install-PlanRelief.ps1 -HostName ... -Port 8082`

Le script vérifie **tous** les prérequis avant de modifier quoi que ce soit, puis :

- publie le site dans `C:\inetpub\plan-relief` ;
- crée le site IIS, la liaison **HTTPS sur le port 8082** (SNI) avec votre certificat, et **retire la
  liaison HTTP** ;
- ajoute une règle de pare-feu 8082/TCP (profil Domaine) ;
- installe le service `PlanReliefSvc` dans `C:\services\plan-relief`, génère un `.env` avec
  un secret de session aléatoire, restreint les droits sur `data\` et `.env` aux
  administrateurs et à SYSTEM ;
- configure le relais `/api` dans IIS (délai porté à 5 minutes pour les imports de grands plans).

**Port** : l'application répond sur **`https://<nom>:8082`** (paramètre `-Port`, 8082 par
défaut). `-Port 443` donne une adresse sans numéro de port. Le script vérifie que le port est
libre (ou déjà tenu par IIS pour un autre nom d'hôte, grâce au SNI), règle la liaison IIS, le
pare-feu et l'adresse autorisée du service. Pour changer de port plus tard, relancez simplement
le script avec un autre `-Port` : l'ancienne liaison est retirée.

Options : `-SitePath`, `-ServicePath`, `-ServicePort`, `-CertificateThumbprint` (si plusieurs
certificats correspondent), `-SkipFirewall` (règles gérées par GPO).
Détail : `Get-Help .\Install-PlanRelief.ps1 -Full`.

## 5. Créer le premier compte

```powershell
cd C:\services\plan-relief
node scripts\create-local-user.js admin "MotDePasseSolide123!" "Administrateur"
```

Ce compte sert à la première connexion ; les autres comptes et LDAP se gèrent ensuite dans
l'onglet **Paramètres**.

## 6. Mettre en place la sauvegarde (obligatoire)

```powershell
.\Register-PlanReliefBackup.ps1 -Destination \\serveur-sauvegarde\plan-relief
```

La tâche planifiée tourne tous les jours à 21h15 (décalée de celle de Suivi Infra, 21h00).
Le script l'exécute une fois tout de suite et vérifie qu'elle a réussi. Mêmes options et
même piège que pour Suivi Infra : sur un partage réseau, SYSTEM se présente sous le compte
ordinateur `DOMAINE\NOMSERVEUR$`. Autorisez-le en écriture, ou passez
`-RunAsUser DOMAINE\svc-sauvegarde`.

Chaque sauvegarde contient les fichiers d'origine des plans, leurs équipements, la corbeille,
les comptes et la configuration LDAP, plus une note `RESTAURATION.txt` (restauration
complète ou d'un seul plan). Le `.env` n'est inclus qu'avec `-IncludeEnv`.

## 7. Vérifier

```powershell
.\Test-PlanRelief.ps1 -HostName plans.monentreprise.local -Port 8082
```

Tous les contrôles doivent être au vert. Le script vérifie notamment que **les plans et la
recherche sont refusés sans session (401)**, que les en-têtes de sécurité sont présents, que
IIS accepte les imports de 100 Mo et que la sauvegarde a tourné.

Puis, depuis un poste du domaine, ouvrez `https://plans.monentreprise.local:8082` et connectez-vous
avec le compte `admin`.

## 8. Connexion Microsoft (facultatif)

1. Portail Azure → *Microsoft Entra ID* → *Inscriptions d'applications* → nouvelle
   inscription (ou celle de Suivi Infra) → *Authentification* → ajoutez la plateforme
   **Application monopage (SPA)** avec l'URI `https://plans.monentreprise.local:8082/auth-redirect.html` (port compris).
2. Dans `C:\services\plan-relief\.env`, renseignez `ENTRA_TENANT_ID` et `ENTRA_CLIENT_ID`.
3. `Restart-Service PlanReliefSvc`. Le bouton « Se connecter avec Microsoft » apparaît sur
   l'écran de connexion.

---

## Mettre à jour

Relancez le nouveau paquet avec les **mêmes paramètres**. Sont **préservés** : `data\` (comptes
et plans), `.env`, et un `web.config` personnalisé (la version du paquet est alors déposée à
côté sous `web.config.nouveau-<date>`).

## Désinstaller

```powershell
.\Uninstall-PlanRelief.ps1                 # conserve les données
.\Uninstall-PlanRelief.ps1 -RemoveData     # supprime tout (confirmation demandée)
```

## Dépannage

| Symptôme | Cause probable et correctif |
| --- | --- |
| `Modules IIS manquants` | Installez URL Rewrite et ARR, puis relancez. |
| `Aucun certificat valide trouvé` | Certificat absent de *Ordinateur local → Personnel*, expiré, ou nom ≠ `-HostName`. |
| `Plusieurs certificats correspondent` | Relancez avec `-CertificateThumbprint <empreinte>`. |
| Écran « Serveur indisponible » | Service arrêté, ou relais `/api` inopérant. `Get-Service PlanReliefSvc` (avec NSSM) ou `Get-ScheduledTask 'Plan Relief - Service'` (sans NSSM), puis `C:\services\plan-relief\service.err.log`. |
| Le service ne démarre pas : « plan.json est illisible » | Une fiche de plan est corrompue. Remettez le dossier `data\plans\<id>` depuis la sauvegarde (voir `RESTAURATION.txt`), puis redémarrez. Le refus de démarrer est voulu. |
| Import refusé : « Fichier trop volumineux » | Plan > 100 Mo. Augmentez `MAX_UPLOAD_MB` dans `.env` **et** `maxAllowedContentLength` dans `web.config`. |
| Import bloqué vers 30 Mo avec une erreur 404.13 | `web.config` personnalisé sans la section `requestLimits` : reprenez-la depuis `web.config.nouveau-<date>`. |
| « Ce plan a été modifié entre-temps par X » | Un collègue a enregistré le même plan pendant votre saisie. Le serveur refuse d'écraser son travail ; le plan est rechargé, refaites votre modification. |
| Lecture OCR : « Lecture OCR impossible » | `web.config` personnalisé sans le type `.gz` ou sans `'wasm-unsafe-eval'` dans la CSP : reprenez-les depuis `web.config.nouveau-<date>`. Vérifiez que `https://<site>/ocr/fra.traineddata.gz` se télécharge. |
| `Le port 8082 est déjà utilisé par un autre programme` | Libérez le port, ou installez sur un autre avec `-Port` (et passez le même `-Port` à `Test-PlanRelief.ps1`). |
| Page inaccessible depuis les postes, mais OK sur le serveur | Pare-feu réseau entre les postes et le serveur : le port 8082/TCP doit y être ouvert, en plus du pare-feu Windows. |
| Connexion Microsoft : fenêtre blanche ou erreur `redirect_uri` | L'URI `https://<site>/auth-redirect.html` n'est pas déclarée en « Application monopage (SPA) » dans Entra ID. |
| Un plan supprimé par erreur | Il est dans `data\corbeille\<id>_<date>` : arrêtez le service, déplacez-le dans `data\plans\<id>`, redémarrez. |
| Après l'installation, d'autres sites du serveur (ex. `http://winas:8080`) ne s'ouvrent plus dans le navigateur, alors qu'ils fonctionnent sur le serveur | Paquets antérieurs au 06/10/2026 : leur en-tête HSTS faisait passer le navigateur en HTTPS pour **tous** les ports de ce nom de serveur. Installez ce paquet (il envoie `max-age=0`), ouvrez une fois `https://winas:8082` depuis chaque poste touché, ou supprimez la règle à la main : `edge://net-internals/#hsts` (ou `chrome://net-internals/#hsts`) → *Delete domain security policies* → `winas`. La configuration IIS d'avant l'installation est sauvegardée : `Restore-WebConfiguration -Name avant-plan-relief-<date>`. |
| La sauvegarde échoue tous les soirs | Droits d'écriture du compte d'exécution sur le partage (voir §6). Journal : `<destination>\sauvegarde.log`. |
