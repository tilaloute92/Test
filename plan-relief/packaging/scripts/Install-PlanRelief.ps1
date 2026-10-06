<#
.SYNOPSIS
    Installe "Plan Relief" sur Windows Server 2022 (IIS).

.DESCRIPTION
    Automatise ce que DEPLOYMENT.md décrit à la main :
      - le site (interface) : copie des fichiers, site IIS, liaison HTTPS, pare-feu ;
      - le service Windows Node.js (PlanReliefSvc) : connexion locale/LDAP/Microsoft,
        stockage des plans et recherche d'équipements ;
      - le relais /api par IIS vers ce service.

    Même architecture et mêmes protections que Suivi Infra & Réseau en mode
    client/serveur. Il n'y a pas de scénario « site seul » : les plans sont stockés
    sur le serveur, le service est donc toujours installé.

    Le script est réentrant : le relancer sur une installation existante met à jour
    les fichiers et reconfigure, sans dupliquer le site ni le service.

    Rien n'est supprimé sans confirmation : les données existantes du service
    (data\ : comptes, plans et équipements) et son fichier .env sont toujours préservés.

.PARAMETER SiteName
    Nom du site dans IIS. Défaut : "Plan Relief".

.PARAMETER HostName
    Nom DNS par lequel l'application sera jointe (ex. plans.monentreprise.local).
    Doit correspondre au certificat et à une entrée DNS pointant vers ce serveur.

.PARAMETER SitePath
    Dossier de publication du site. Défaut : C:\inetpub\plan-relief.

.PARAMETER CertificateThumbprint
    Empreinte du certificat HTTPS déjà présent dans Ordinateur local\Personnel.
    Si omis et qu'un seul certificat correspond à -HostName, il est choisi
    automatiquement ; sinon le script s'arrête et liste les certificats trouvés.

.PARAMETER Port
    Port HTTPS sur lequel les utilisateurs ouvrent l'application. Défaut : 8082
    (adresse https://<HostName>:8082). Passez 443 pour une adresse sans numéro de port.

.PARAMETER ServicePath
    Dossier d'installation du service. Défaut : C:\services\plan-relief.

.PARAMETER ServicePort
    Port d'écoute local du service (jamais exposé au réseau). Défaut : 4100, pour
    cohabiter avec Suivi Infra & Réseau (4000) sur le même serveur.

.PARAMETER NssmPath
    Chemin vers nssm.exe (https://nssm.cc), utilisé pour faire tourner Node comme
    service Windows. Requis si NSSM n'est pas déjà dans le PATH.

.PARAMETER SkipFirewall
    N'ajoute pas la règle de pare-feu (si vos règles sont gérées par GPO).

.EXAMPLE
    .\Install-PlanRelief.ps1 -HostName plans.monentreprise.local -NssmPath C:\outils\nssm.exe

.EXAMPLE
    .\Install-PlanRelief.ps1 -HostName plans.monentreprise.local -Port 443 -NssmPath C:\outils\nssm.exe
#>

[CmdletBinding()]
param(
    [string] $SiteName = 'Plan Relief',
    [Parameter(Mandatory = $true)][string] $HostName,
    [string] $SitePath = 'C:\inetpub\plan-relief',
    [string] $CertificateThumbprint,
    [ValidateRange(1, 65535)][int] $Port = 8082,
    [string] $ServicePath = 'C:\services\plan-relief',
    [int]    $ServicePort = 4100,
    [string] $NssmPath,
    [switch] $SkipFirewall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServiceName = 'PlanReliefSvc'
$RuleName    = 'Plan Relief - API'
# Adresse de l'application : le port n'apparaît que s'il n'est pas le port HTTPS standard.
$BaseUrl     = if ($Port -eq 443) { "https://$HostName" } else { "https://${HostName}:$Port" }

function Write-Step { param([string] $Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Message) Write-Host "    [OK] $Message" -ForegroundColor Green }
function Write-Warn { param([string] $Message) Write-Host "    [!]  $Message" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------------------
# 0. Contrôles préalables — on vérifie tout AVANT de modifier quoi que ce soit, pour ne
#    jamais laisser le serveur à moitié configuré.
# ---------------------------------------------------------------------------------------
Write-Step 'Contrôles préalables'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script doit être lancé depuis une console PowerShell *Administrateur*."
}
Write-Ok 'Console administrateur'

foreach ($required in @('site\index.html', 'site\web.config', 'service\src\index.js', 'service\node_modules')) {
    if (-not (Test-Path (Join-Path $PackageRoot $required))) {
        throw "'$required' introuvable à côté du script. Décompressez le paquet en entier et relancez le script depuis le dossier décompressé."
    }
}
Write-Ok 'Contenu du paquet présent'

if (-not (Get-WindowsFeature -Name Web-Server).Installed) {
    Write-Warn "Le rôle IIS n'est pas installé — installation en cours (peut prendre une minute)."
    Install-WindowsFeature -Name Web-Server -IncludeManagementTools | Out-Null
}
Import-Module WebAdministration -ErrorAction Stop
Write-Ok 'IIS présent'

# Sans URL Rewrite + ARR, le navigateur ne peut pas joindre le service : l'application
# serait installée mais inutilisable. On s'arrête donc avant de toucher à quoi que ce soit.
$rewriteInstalled = Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite'
$arrInstalled     = Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing'
if (-not $rewriteInstalled -or -not $arrInstalled) {
    $missing = @()
    if (-not $rewriteInstalled) { $missing += 'URL Rewrite' }
    if (-not $arrInstalled) { $missing += 'Application Request Routing (ARR)' }
    throw "Modules IIS manquants : $($missing -join ', '). Installez-les depuis https://www.iis.net/downloads puis relancez ce script. Ils permettent à IIS de relayer /api vers le service."
}
Write-Ok 'Modules IIS URL Rewrite et ARR présents'

# Certificat : on le résout maintenant, avant de créer quoi que ce soit.
if ($CertificateThumbprint) {
    $cert = Get-ChildItem Cert:\LocalMachine\My |
        Where-Object { $_.Thumbprint -eq $CertificateThumbprint.Replace(' ', '') }
    if (-not $cert) { throw "Aucun certificat avec l'empreinte '$CertificateThumbprint' dans Ordinateur local\Personnel." }
} else {
    $candidates = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object {
        $_.NotAfter -gt (Get-Date) -and (
            $_.Subject -like "*$HostName*" -or
            ($_.DnsNameList | ForEach-Object { $_.Unicode }) -contains $HostName
        )
    })
    if ($candidates.Count -eq 1) {
        $cert = $candidates[0]
    } elseif ($candidates.Count -eq 0) {
        throw @"
Aucun certificat valide trouvé pour '$HostName' dans Ordinateur local\Personnel.
Importez-le d'abord (certlm.msc → Personnel → Certificats), puis relancez.
Voir DEPLOYMENT-reference.md, section 4.1.
"@
    } else {
        $list = ($candidates | ForEach-Object { "  $($_.Thumbprint)  $($_.Subject)  (expire le $($_.NotAfter.ToString('yyyy-MM-dd')))" }) -join "`n"
        throw "Plusieurs certificats correspondent à '$HostName'. Relancez avec -CertificateThumbprint :`n$list"
    }
}
Write-Ok "Certificat : $($cert.Subject) (expire le $($cert.NotAfter.ToString('yyyy-MM-dd')))"

$node = (Get-Command node.exe -ErrorAction SilentlyContinue)
if (-not $node) { throw "Node.js introuvable. Installez la version LTS depuis https://nodejs.org puis relancez." }
$nodeVersion = (& node.exe -v)
if ([int](($nodeVersion -replace '^v','') -split '\.')[0] -lt 18) {
    throw "Node.js $nodeVersion détecté : la version 18 ou supérieure est requise."
}
Write-Ok "Node.js $nodeVersion — $($node.Source)"

if (-not $NssmPath) {
    $nssmCmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($nssmCmd) { $NssmPath = $nssmCmd.Source }
}
if (-not $NssmPath -or -not (Test-Path $NssmPath)) {
    throw "nssm.exe introuvable. Téléchargez-le sur https://nssm.cc, puis relancez avec -NssmPath C:\chemin\nssm.exe."
}
Write-Ok "NSSM : $NssmPath"

# Simple avertissement : si le port est déjà pris par autre chose, le service ne démarrera
# pas — autant le dire tout de suite. (Sur une réinstallation, c'est notre propre service,
# arrêté un peu plus bas.)
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $ServicePort -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0 -and -not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    Write-Warn "Le port $ServicePort est déjà utilisé par un autre programme. Choisissez un autre port avec -ServicePort, sinon le service ne pourra pas démarrer."
}

# Port de l'application : il doit être libre, ou déjà tenu par IIS (http.sys, processus 4).
# Un autre programme qui écoute dessus empêcherait le site de répondre.
if ($Port -eq $ServicePort) { throw "Le port de l'application ($Port) et le port interne du service ($ServicePort) doivent être différents." }
$owners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$foreign = @($owners | Where-Object { $_ -ne 4 })
if ($foreign.Count -gt 0) {
    $names = ($foreign | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName }) -join ', '
    throw "Le port $Port est déjà utilisé par un autre programme ($names). Libérez-le ou choisissez un autre port avec -Port."
}
$otherSites = @(Get-WebBinding -Protocol https -Port $Port -ErrorAction SilentlyContinue | Where-Object {
    $_.ItemXPath -notmatch [regex]::Escape("@name='$SiteName'") -and (($_.bindingInformation -split ':')[2] -in @('', $HostName))
})
if ($otherSites.Count -gt 0) {
    throw "Un autre site IIS écoute déjà en HTTPS sur le port $Port pour ce nom (ou pour tous les noms). Choisissez un autre port avec -Port, ou retirez cette liaison."
}
Write-Ok "Port $Port disponible pour l'application ($BaseUrl)"

# ---------------------------------------------------------------------------------------
# 1. Publication du site (fichiers statiques)
# ---------------------------------------------------------------------------------------
Write-Step "Publication du site vers $SitePath"

New-Item -ItemType Directory -Path $SitePath -Force | Out-Null
# On remplace le contenu applicatif sans toucher à un éventuel web.config personnalisé :
# celui du paquet est déposé à côté si un fichier différent existe déjà.
$existingConfig = Join-Path $SitePath 'web.config'
$packagedConfig = Join-Path $PackageRoot 'site\web.config'
$configDiffers = $false
if (Test-Path $existingConfig) {
    # La règle /api est ajoutée par ce script lui-même (étape 4) : on compare donc la
    # version publiée sans cette règle, pour ne pas prendre notre propre ajout pour une
    # personnalisation de l'administrateur.
    [xml] $mine = Get-Content $existingConfig -Raw
    $rewrite = $mine.SelectSingleNode('/configuration/system.webServer/rewrite')
    if ($rewrite) { [void] $rewrite.ParentNode.RemoveChild($rewrite) }
    [xml] $packaged = Get-Content $packagedConfig -Raw
    $configDiffers = $mine.OuterXml -ne $packaged.OuterXml
}

Get-ChildItem -Path $SitePath -Exclude 'web.config' | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $PackageRoot 'site\*') -Destination $SitePath -Recurse -Force -Exclude 'web.config'

if ($configDiffers) {
    $backup = Join-Path $SitePath ("web.config.nouveau-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Copy-Item $packagedConfig $backup -Force
    Write-Warn "Un web.config personnalisé existe déjà : il a été conservé. La version du paquet est déposée à côté ($([IO.Path]::GetFileName($backup))) — comparez-les si cette version apporte des changements."
} else {
    Copy-Item $packagedConfig $existingConfig -Force
}
Write-Ok 'Fichiers du site publiés'

# ---------------------------------------------------------------------------------------
# 2. Site IIS + liaison HTTPS
# ---------------------------------------------------------------------------------------
Write-Step "Configuration du site IIS « $SiteName »"

if (-not (Test-Path "IIS:\Sites\$SiteName")) {
    New-Website -Name $SiteName -PhysicalPath $SitePath -Port $Port -HostHeader $HostName -Ssl | Out-Null
    Write-Ok 'Site créé'
} else {
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $SitePath
    Write-Ok 'Site existant réutilisé'
}

# Une liaison HTTPS sur un autre port (installation précédente sur 443, par exemple) est
# retirée : l'application ne doit répondre qu'à une seule adresse.
foreach ($old in @(Get-WebBinding -Name $SiteName -Protocol https -ErrorAction SilentlyContinue)) {
    $parts = $old.bindingInformation -split ':'
    if ([int]$parts[1] -ne $Port -or $parts[2] -ne $HostName) {
        Remove-WebBinding -Name $SiteName -Protocol https -Port ([int]$parts[1]) -HostHeader $parts[2] -ErrorAction SilentlyContinue
        Write-Ok "Ancienne liaison HTTPS retirée ($($old.bindingInformation))"
    }
}
$binding = Get-WebBinding -Name $SiteName -Protocol https -Port $Port -HostHeader $HostName -ErrorAction SilentlyContinue
if (-not $binding) {
    New-WebBinding -Name $SiteName -Protocol https -Port $Port -HostHeader $HostName -SslFlags 1
    $binding = Get-WebBinding -Name $SiteName -Protocol https -Port $Port -HostHeader $HostName
}
# SNI (SslFlags 1) : plusieurs sites HTTPS avec des noms d'hôte différents sur la même IP,
# par exemple Plan Relief et Suivi Infra & Réseau sur le même serveur.
$binding.AddSslCertificate($cert.Thumbprint, 'My')
Write-Ok "Liaison HTTPS $Port sur $HostName"

# HTTP en clair : on retire la liaison pour que l'application ne soit jamais servie sans
# chiffrement (les mots de passe locaux et LDAP transitent par cette page).
$httpBinding = Get-WebBinding -Name $SiteName -Protocol http -ErrorAction SilentlyContinue
if ($httpBinding) {
    Remove-WebBinding -Name $SiteName -Protocol http -Port 80 -ErrorAction SilentlyContinue
    Write-Ok 'Liaison HTTP (port 80) retirée — accès en HTTPS uniquement'
}

Start-Website -Name $SiteName -ErrorAction SilentlyContinue
Write-Ok 'Site démarré'

if (-not $SkipFirewall) {
    $fw = Get-NetFirewallRule -DisplayName 'Plan Relief - HTTPS' -ErrorAction SilentlyContinue
    if (-not $fw) {
        New-NetFirewallRule -DisplayName 'Plan Relief - HTTPS' -Direction Inbound -Protocol TCP `
            -LocalPort $Port -Action Allow -Profile Domain | Out-Null
        Write-Ok "Règle de pare-feu $Port/TCP (profil Domaine) ajoutée"
    } else {
        # Règle existante : on la met au port choisi (changement de port lors d'une mise à jour).
        $fw | Set-NetFirewallRule -LocalPort $Port
        Write-Ok "Règle de pare-feu mise à jour : $Port/TCP"
    }
}

# ---------------------------------------------------------------------------------------
# 3. Service Windows (plans, équipements, authentification)
# ---------------------------------------------------------------------------------------
Write-Step "Installation du service « $ServiceName » vers $ServicePath"

$serviceExists = [bool](Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
if ($serviceExists) {
    & $NssmPath stop $ServiceName confirm | Out-Null
    Write-Ok 'Service existant arrêté le temps de la mise à jour'
}

New-Item -ItemType Directory -Path $ServicePath -Force | Out-Null
# data\ contient les comptes, les plans et leurs équipements : jamais écrasé par une mise à jour.
foreach ($item in @('src', 'scripts', 'node_modules')) {
    $dest = Join-Path $ServicePath $item
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Copy-Item -Path (Join-Path $PackageRoot "service\$item") -Destination $dest -Recurse -Force
}
Copy-Item -Path (Join-Path $PackageRoot 'service\package.json') -Destination $ServicePath -Force
Copy-Item -Path (Join-Path $PackageRoot 'service\.env.example') -Destination $ServicePath -Force
New-Item -ItemType Directory -Path (Join-Path $ServicePath 'data') -Force | Out-Null
Write-Ok 'Fichiers du service copiés (dossier data\ préservé)'

# .env : généré une seule fois, avec un secret aléatoire propre à cette application. Jamais
# réécrit ensuite, pour ne pas invalider les sessions en cours ni écraser la configuration SSO.
$envPath = Join-Path $ServicePath '.env'
if (-not (Test-Path $envPath)) {
    $secretBytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
    $jwtSecret = [Convert]::ToBase64String($secretBytes)
    $content = @(
        "# Généré automatiquement par Install-PlanRelief.ps1 le $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
        "# Voir .env.example pour la description de chaque valeur.",
        "PORT=$ServicePort",
        "JWT_SECRET=$jwtSecret",
        "COOKIE_SECURE=true",
        "CORS_ORIGIN=$BaseUrl",
        "MAX_UPLOAD_MB=100",
        "",
        "# SSO Microsoft (facultatif). Déclarez $BaseUrl/auth-redirect.html comme URI de",
        "# redirection « Application monopage (SPA) » dans Entra ID, renseignez ces deux valeurs,",
        "# puis redémarrez le service. Le bouton Microsoft apparaît alors sur l'écran de connexion.",
        "# ENTRA_TENANT_ID=",
        "# ENTRA_CLIENT_ID=",
        "",
        "# LDAP / Active Directory et comptes locaux : se configurent depuis l'application",
        "# (onglet Paramètres), enregistrés dans data\config.json et data\users.json."
    )
    # UTF-8 sans BOM : Set-Content -Encoding UTF8 de PowerShell 5.1 en ajouterait un, que le
    # service lirait comme faisant partie du nom de la première variable.
    [IO.File]::WriteAllLines($envPath, [string[]] $content, (New-Object Text.UTF8Encoding $false))
    Write-Ok '.env généré (secret de session aléatoire)'
} else {
    Write-Ok '.env existant conservé (secret et configuration SSO inchangés)'
    # Seule l'adresse autorisée suit le port choisi : elle se déduit de -HostName et -Port.
    # TrimStart : retire un éventuel BOM laissé par une installation précédente.
    $lines = @(Get-Content -Path $envPath -Encoding UTF8 | ForEach-Object { $_.TrimStart([char]0xFEFF) })
    if ($lines -match '^CORS_ORIGIN=') {
        $lines = $lines | ForEach-Object { if ($_ -match '^CORS_ORIGIN=') { "CORS_ORIGIN=$BaseUrl" } else { $_ } }
    } else {
        $lines += "CORS_ORIGIN=$BaseUrl"
    }
    [IO.File]::WriteAllLines($envPath, [string[]] $lines, (New-Object Text.UTF8Encoding $false))
    Write-Ok "Adresse autorisée dans .env : $BaseUrl"
}

# data\ contient des secrets (hachages de mots de passe) et tous les plans : accès restreint
# aux administrateurs et au compte du service (SYSTEM).
$acl = Get-Acl (Join-Path $ServicePath 'data')
$acl.SetAccessRuleProtection($true, $false)
foreach ($principal in @('BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM')) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
        $principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
}
Set-Acl -Path (Join-Path $ServicePath 'data') -AclObject $acl
Write-Ok 'Droits restreints sur data\ (Administrateurs + SYSTEM)'
# Même restriction sur .env (secret de session).
$envAcl = Get-Acl $envPath
$envAcl.SetAccessRuleProtection($true, $false)
foreach ($principal in @('BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM')) {
    $envAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($principal, 'FullControl', 'Allow')))
}
Set-Acl -Path $envPath -AclObject $envAcl
Write-Ok 'Droits restreints sur .env'

$nodeExe = (Get-Command node.exe).Source
if (-not $serviceExists) {
    & $NssmPath install $ServiceName $nodeExe (Join-Path $ServicePath 'src\index.js') | Out-Null
} else {
    & $NssmPath set $ServiceName Application $nodeExe | Out-Null
    & $NssmPath set $ServiceName AppParameters (Join-Path $ServicePath 'src\index.js') | Out-Null
}
& $NssmPath set $ServiceName AppDirectory $ServicePath | Out-Null
& $NssmPath set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $NssmPath set $ServiceName AppStdout (Join-Path $ServicePath 'service.log') | Out-Null
& $NssmPath set $ServiceName AppStderr (Join-Path $ServicePath 'service.err.log') | Out-Null
& $NssmPath set $ServiceName AppRotateFiles 1 | Out-Null
& $NssmPath set $ServiceName Description 'Plan Relief - plans, equipements et authentification' | Out-Null
& $NssmPath start $ServiceName | Out-Null
Write-Ok "Service $ServiceName installé et démarré (journaux : $ServicePath\service.log)"

# Attente active courte : le service doit répondre avant qu'on annonce que tout va bien.
$healthy = $false
foreach ($i in 1..15) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-RestMethod "http://127.0.0.1:$ServicePort/api/health" -TimeoutSec 2
        if ($r.ok -and $r.app -eq 'plan-relief') { $healthy = $true; break }
    } catch { }
}
if ($healthy) {
    Write-Ok "Le service répond sur http://127.0.0.1:$ServicePort/api/health"
} else {
    Write-Warn "Le service ne répond pas encore. Consultez $ServicePath\service.err.log (un plan.json illisible, par exemple, l'empêche volontairement de démarrer)."
}

# ---------------------------------------------------------------------------------------
# 4. Relais /api par IIS (URL Rewrite + ARR)
# ---------------------------------------------------------------------------------------
Write-Step 'Relais des appels /api vers le service local'

# Proxy ARR activé au niveau serveur (sinon la règle de réécriture est ignorée), avec un
# délai porté à 5 minutes : l'import d'un grand plan peut dépasser le délai par défaut.
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'timeout' -Value '00:05:00'

$ruleFilter = "system.webServer/rewrite/rules/rule[@name='$RuleName']"
Clear-WebConfiguration -PSPath "IIS:\Sites\$SiteName" -Filter $ruleFilter -ErrorAction SilentlyContinue
Add-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" -Filter 'system.webServer/rewrite/rules' -Name '.' `
    -Value @{ name = $RuleName; stopProcessing = 'True' }
Set-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" -Filter "$ruleFilter/match" -Name 'url' -Value '^api/(.*)$'
Set-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" -Filter "$ruleFilter/action" -Name 'type' -Value 'Rewrite'
# Seuls les chemins /api/* partent vers Node : tout le reste continue d'être servi comme
# des fichiers par IIS.
Set-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" -Filter "$ruleFilter/action" -Name 'url' -Value "http://127.0.0.1:$ServicePort/api/{R:1}"
Write-Ok "Règle « $RuleName » : /api/* → http://127.0.0.1:$ServicePort/api/*"

# ---------------------------------------------------------------------------------------
# 5. Résumé
# ---------------------------------------------------------------------------------------
Write-Step 'Installation terminée'
Write-Host "    Application : $BaseUrl" -ForegroundColor White
Write-Host "    Site        : $SitePath"
Write-Host "    Service     : $ServiceName ($ServicePath), port local $ServicePort"
Write-Host "    Données     : $ServicePath\data   ← à sauvegarder (Register-PlanReliefBackup.ps1)"
Write-Host ""
Write-Host "    Étape suivante — créer le premier compte administrateur :" -ForegroundColor Yellow
Write-Host "      cd `"$ServicePath`""
Write-Host "      node scripts\create-local-user.js admin `"MotDePasseSolide123!`" `"Administrateur`""
Write-Host ""
Write-Host "    Vérification :" -ForegroundColor Yellow
Write-Host "      .\Test-PlanRelief.ps1 -HostName $HostName -Port $Port"
Write-Host ""
