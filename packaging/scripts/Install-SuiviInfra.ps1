<#
.SYNOPSIS
    Installe "Suivi Infra & Réseau" sur Windows Server 2022 (IIS).

.DESCRIPTION
    Automatise ce que DEPLOYMENT.md décrit à la main :
      - Partie A (toujours) : copie du site, création du site IIS, liaison HTTPS,
        règle de pare-feu.
      - Partie B (si -WithService) : service Windows Node.js pour la connexion
        locale/LDAP et le mode multi-utilisateur, plus le relais /api par IIS.

    Le script est réentrant : le relancer sur une installation existante met à jour
    les fichiers et reconfigure, sans dupliquer le site ni le service.

    Rien n'est supprimé sans confirmation : les données existantes du service
    (service\data, comptes et données d'équipe) sont toujours préservées.

.PARAMETER SiteName
    Nom du site dans IIS. Défaut : "Suivi Infra & Reseau".

.PARAMETER HostName
    Nom DNS par lequel l'application sera jointe (ex. suivi-infra.monentreprise.local).
    Doit correspondre au certificat et à une entrée DNS pointant vers ce serveur.

.PARAMETER SitePath
    Dossier de publication du site. Défaut : C:\inetpub\suivi-infra.

.PARAMETER CertificateThumbprint
    Empreinte du certificat HTTPS déjà présent dans Ordinateur local\Personnel.
    Si omis et qu'un seul certificat correspond à -HostName, il est choisi
    automatiquement ; sinon le script s'arrête et liste les certificats trouvés.

.PARAMETER WithService
    Installe aussi le service d'authentification / multi-utilisateur (Partie B).

.PARAMETER ServicePath
    Dossier d'installation du service. Défaut : C:\services\suivi-infra.

.PARAMETER ServicePort
    Port d'écoute local du service (jamais exposé au réseau). Défaut : 4000.

.PARAMETER NssmPath
    Chemin vers nssm.exe (https://nssm.cc), utilisé pour faire tourner Node comme
    service Windows. Requis avec -WithService si NSSM n'est pas déjà dans le PATH.

.PARAMETER SkipFirewall
    N'ajoute pas la règle de pare-feu (si vos règles sont gérées par GPO).

.EXAMPLE
    .\Install-SuiviInfra.ps1 -HostName suivi-infra.monentreprise.local

.EXAMPLE
    .\Install-SuiviInfra.ps1 -HostName suivi-infra.monentreprise.local `
        -WithService -NssmPath C:\outils\nssm.exe
#>

[CmdletBinding()]
param(
    [string] $SiteName = 'Suivi Infra & Reseau',
    [Parameter(Mandatory = $true)][string] $HostName,
    [string] $SitePath = 'C:\inetpub\suivi-infra',
    [string] $CertificateThumbprint,
    [switch] $WithService,
    [string] $ServicePath = 'C:\services\suivi-infra',
    [int]    $ServicePort = 4000,
    [string] $NssmPath,
    [switch] $SkipFirewall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServiceName = 'SuiviInfraAuth'

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

if (-not (Test-Path (Join-Path $PackageRoot 'site\index.html'))) {
    throw "Dossier 'site' introuvable ou incomplet à côté du script. Décompressez le paquet en entier et relancez le script depuis le dossier décompressé."
}
Write-Ok 'Contenu du paquet présent'

if (-not (Get-WindowsFeature -Name Web-Server).Installed) {
    Write-Warn "Le rôle IIS n'est pas installé — installation en cours (peut prendre une minute)."
    Install-WindowsFeature -Name Web-Server -IncludeManagementTools | Out-Null
}
Import-Module WebAdministration -ErrorAction Stop
Write-Ok 'IIS présent'

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

if ($WithService) {
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue)
    if (-not $node) { throw "Node.js introuvable. Installez la version LTS depuis https://nodejs.org puis relancez (Partie B uniquement)." }
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

    # Simple avertissement : si le port est déjà pris par autre chose, le service ne
    # démarrera pas — autant le dire tout de suite. (On n'essaie pas de deviner *quel*
    # processus écoute : sur une réinstallation c'est justement notre propre service,
    # que le script arrête un peu plus bas.)
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $ServicePort -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0 -and -not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
        Write-Warn "Le port $ServicePort est déjà utilisé par un autre programme. Choisissez un autre port avec -ServicePort, sinon le service ne pourra pas démarrer."
    }
}

# ---------------------------------------------------------------------------------------
# 1. Partie A — publication du site statique
# ---------------------------------------------------------------------------------------
Write-Step "Publication du site vers $SitePath"

New-Item -ItemType Directory -Path $SitePath -Force | Out-Null
# On remplace le contenu applicatif sans toucher à un éventuel web.config personnalisé
# ajouté par l'administrateur : celui du paquet est copié sous un nom de sauvegarde si
# un fichier différent existe déjà (la règle de reverse proxy y est parfois ajoutée à la main).
$existingConfig = Join-Path $SitePath 'web.config'
$packagedConfig = Join-Path $PackageRoot 'site\web.config'
$configDiffers = (Test-Path $existingConfig) -and
    ((Get-FileHash $existingConfig).Hash -ne (Get-FileHash $packagedConfig).Hash)

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
    New-Website -Name $SiteName -PhysicalPath $SitePath -Port 443 -HostHeader $HostName -Ssl | Out-Null
    Write-Ok 'Site créé'
} else {
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $SitePath
    Write-Ok 'Site existant réutilisé'
}

$binding = Get-WebBinding -Name $SiteName -Protocol https -ErrorAction SilentlyContinue
if (-not $binding) {
    New-WebBinding -Name $SiteName -Protocol https -Port 443 -HostHeader $HostName -SslFlags 1
    $binding = Get-WebBinding -Name $SiteName -Protocol https
}
# SNI (SslFlags 1) : permet plusieurs sites HTTPS avec des noms d'hôte différents sur la
# même IP — le cas courant quand ce serveur héberge déjà autre chose.
$binding.AddSslCertificate($cert.Thumbprint, 'My')
Write-Ok "Liaison HTTPS 443 sur $HostName"

# HTTP en clair : on retire la liaison pour que l'application ne soit jamais servie
# sans chiffrement (recommandation de DEPLOYMENT.md, étape 5).
$httpBinding = Get-WebBinding -Name $SiteName -Protocol http -ErrorAction SilentlyContinue
if ($httpBinding) {
    Remove-WebBinding -Name $SiteName -Protocol http -Port 80 -ErrorAction SilentlyContinue
    Write-Ok 'Liaison HTTP (port 80) retirée — accès en HTTPS uniquement'
}

Start-Website -Name $SiteName -ErrorAction SilentlyContinue
Write-Ok 'Site démarré'

if (-not $SkipFirewall) {
    if (-not (Get-NetFirewallRule -DisplayName 'Suivi Infra - HTTPS' -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName 'Suivi Infra - HTTPS' -Direction Inbound -Protocol TCP `
            -LocalPort 443 -Action Allow -Profile Domain | Out-Null
        Write-Ok 'Règle de pare-feu 443/TCP (profil Domaine) ajoutée'
    } else {
        Write-Ok 'Règle de pare-feu déjà présente'
    }
}

# ---------------------------------------------------------------------------------------
# 3. Partie B — service d'authentification / multi-utilisateur
# ---------------------------------------------------------------------------------------
if ($WithService) {
    Write-Step "Installation du service « $ServiceName » vers $ServicePath"

    $serviceExists = [bool](Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
    if ($serviceExists) {
        & $NssmPath stop $ServiceName confirm | Out-Null
        Write-Ok 'Service existant arrêté le temps de la mise à jour'
    }

    New-Item -ItemType Directory -Path $ServicePath -Force | Out-Null
    # data\ contient les comptes et les données d'équipe : jamais écrasé par une mise à jour.
    foreach ($item in @('src', 'scripts', 'node_modules')) {
        $dest = Join-Path $ServicePath $item
        if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
        Copy-Item -Path (Join-Path $PackageRoot "service\$item") -Destination $dest -Recurse -Force
    }
    Copy-Item -Path (Join-Path $PackageRoot 'service\package.json') -Destination $ServicePath -Force
    Copy-Item -Path (Join-Path $PackageRoot 'service\.env.example') -Destination $ServicePath -Force
    New-Item -ItemType Directory -Path (Join-Path $ServicePath 'data') -Force | Out-Null
    Write-Ok 'Fichiers du service copiés (dossier data\ préservé)'

    # .env : généré une seule fois, avec un secret aléatoire. Jamais réécrit ensuite, pour
    # ne pas invalider les sessions en cours ni écraser une configuration LDAP saisie à la main.
    $envPath = Join-Path $ServicePath '.env'
    if (-not (Test-Path $envPath)) {
        $secretBytes = New-Object byte[] 48
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
        $jwtSecret = [Convert]::ToBase64String($secretBytes)
        @(
            "# Généré automatiquement par Install-SuiviInfra.ps1 le $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
            "# Voir .env.example pour la description de chaque valeur.",
            "PORT=$ServicePort",
            "JWT_SECRET=$jwtSecret",
            "COOKIE_SECURE=true",
            "CORS_ORIGIN=https://$HostName",
            "",
            "# SSO Microsoft (facultatif) — mêmes valeurs que dans l'onglet Paramètres :",
            "# ENTRA_TENANT_ID=",
            "# ENTRA_CLIENT_ID=",
            "",
            "# LDAP / Active Directory (facultatif) — se configure aussi depuis l'application :",
            "# LDAP_URL=ldaps://dc.monentreprise.local:636",
            "# LDAP_BIND_DN=",
            "# LDAP_BIND_PASSWORD=",
            "# LDAP_SEARCH_BASE="
        ) | Set-Content -Path $envPath -Encoding UTF8
        Write-Ok '.env généré (secret de session aléatoire)'
    } else {
        Write-Ok '.env existant conservé (secret et configuration LDAP inchangés)'
    }

    # Le dossier data\ contient des secrets (hachages de mots de passe) et les données
    # d'équipe : on restreint son accès aux administrateurs et au compte de service.
    $acl = Get-Acl (Join-Path $ServicePath 'data')
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($principal in @('BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM')) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
            $principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    Set-Acl -Path (Join-Path $ServicePath 'data') -AclObject $acl
    Write-Ok 'Droits restreints sur service\data (Administrateurs + SYSTEM)'

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
    & $NssmPath set $ServiceName Description 'Suivi Infra & Reseau - authentification et donnees partagees' | Out-Null
    & $NssmPath start $ServiceName | Out-Null
    Write-Ok "Service $ServiceName installé et démarré (journaux : $ServicePath\service.log)"

    # Attente active courte : le service doit répondre avant qu'on annonce que tout va bien.
    $healthy = $false
    foreach ($i in 1..10) {
        Start-Sleep -Seconds 1
        try {
            $r = Invoke-RestMethod "http://127.0.0.1:$ServicePort/api/health" -TimeoutSec 2
            if ($r.ok) { $healthy = $true; break }
        } catch { }
    }
    if ($healthy) {
        Write-Ok "Le service répond sur http://127.0.0.1:$ServicePort/api/health"
    } else {
        Write-Warn "Le service ne répond pas encore. Consultez $ServicePath\service.err.log."
    }

    # --- Relais /api par IIS (URL Rewrite + ARR) ---
    Write-Step "Relais des appels /api vers le service local"
    $rewriteInstalled = Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite'
    $arrInstalled     = Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing'

    if (-not $rewriteInstalled -or -not $arrInstalled) {
        Write-Warn @"
Modules IIS manquants : $(if(-not $rewriteInstalled){'URL Rewrite '})$(if(-not $arrInstalled){'Application Request Routing'})
Installez-les depuis https://www.iis.net/downloads (ou via Web Platform Installer), puis
relancez ce script. Sans eux, la connexion locale/LDAP et le mode multi-utilisateur ne
fonctionneront pas : le navigateur ne pourra pas joindre /api.
"@
    } else {
        # Proxy ARR activé au niveau serveur (sinon la règle de réécriture est ignorée).
        Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
            -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'

        $ruleFilter = "system.webServer/rewrite/rules/rule[@name='Suivi Infra - API']"
        Clear-WebConfiguration -PSPath "IIS:\Sites\$SiteName" -Filter $ruleFilter -ErrorAction SilentlyContinue

        Add-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" `
            -Filter 'system.webServer/rewrite/rules' -Name '.' `
            -Value @{ name = 'Suivi Infra - API'; stopProcessing = 'True' }
        Set-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" `
            -Filter "$ruleFilter/match" -Name 'url' -Value '^api/(.*)$'
        Set-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" `
            -Filter "$ruleFilter/action" -Name 'type' -Value 'Rewrite'
        # Seuls les chemins /api/* partent vers Node : tout le reste continue d'être servi
        # comme des fichiers par IIS (Node ne sait pas les servir).
        Set-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" `
            -Filter "$ruleFilter/action" -Name 'url' -Value "http://127.0.0.1:$ServicePort/api/{R:1}"
        Write-Ok "Règle « Suivi Infra - API » : /api/* → http://127.0.0.1:$ServicePort/api/*"
    }
}

# ---------------------------------------------------------------------------------------
# 4. Résumé
# ---------------------------------------------------------------------------------------
Write-Step 'Installation terminée'
Write-Host "    Application : https://$HostName" -ForegroundColor White
Write-Host "    Fichiers    : $SitePath"
if ($WithService) {
    Write-Host "    Service     : $ServiceName ($ServicePath), port local $ServicePort"
    Write-Host ""
    Write-Host "    Étape suivante — créer le premier compte administrateur :" -ForegroundColor Yellow
    Write-Host "      cd `"$ServicePath`""
    Write-Host "      node scripts\create-local-user.js admin `"MotDePasseSolide123!`" `"Administrateur`""
}
Write-Host ""
Write-Host "    Vérification :" -ForegroundColor Yellow
Write-Host "      Invoke-WebRequest https://$HostName -UseBasicParsing | Select-Object StatusCode"
if ($WithService) {
    Write-Host "      Invoke-RestMethod https://$HostName/api/health   # doit répondre ok = True"
}
Write-Host ""
