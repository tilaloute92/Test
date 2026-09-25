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
    Nom par lequel l'application sera jointe. Défaut : winas (le nom du serveur).
    En HTTPS, il doit correspondre au certificat et à une entrée DNS.

.PARAMETER Protocol
    http (défaut) ou https.
      http  : installation immédiate, sans certificat. L'application est servie en clair
              sur le réseau interne - voir l'avertissement affiché en fin d'installation.
      https : exige un certificat pour -HostName dans Ordinateur local\Personnel.
    Pour passer de http à https plus tard, utilisez Enable-SuiviInfraHttps.ps1 : il bascule
    la liaison, le pare-feu et la configuration du service sans toucher aux données.

.PARAMETER Port
    Port d'écoute du site IIS. Défaut : 8081.

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

.PARAMETER AdminUser
    Identifiant du premier compte local, créé par le script. Si ce paramètre est omis et
    qu'aucun compte n'existe encore, le script le demande de façon interactive. Le mot de
    passe n'est jamais passé en paramètre : il est toujours saisi masqué.

.PARAMETER AdminName
    Nom complet associé à ce compte (ex. "R. Nelson"). Défaut : l'identifiant.

.PARAMETER SkipAdminAccount
    Ne crée aucun compte et ne pose aucune question. À utiliser pour une installation
    silencieuse ; il faudra créer le premier compte à la main, depuis une console
    administrateur (voir INSTALL.md).

.PARAMETER SkipFirewall
    N'ajoute pas la règle de pare-feu (si vos règles sont gérées par GPO).

.EXAMPLE
    .\Install-SuiviInfra.ps1
    Installation par défaut : http://winas:8081, site seul.

.EXAMPLE
    .\Install-SuiviInfra.ps1 -WithService -NssmPath C:\outils\nssm.exe
    http://winas:8081 avec le service (comptes locaux/LDAP, données partagées, envoi de mail).

.EXAMPLE
    .\Install-SuiviInfra.ps1 -Protocol https -HostName winas.monentreprise.local -Port 443 -WithService
    Installation directement en HTTPS, si le certificat est déjà en place.
#>

[CmdletBinding()]
param(
    [string] $SiteName = 'Suivi Infra & Reseau',
    [string] $HostName = 'winas',
    [ValidateSet('http', 'https')][string] $Protocol = 'http',
    [int]    $Port = 8081,
    [string] $SitePath = 'C:\inetpub\suivi-infra',
    [string] $CertificateThumbprint,
    [switch] $WithService,
    [string] $ServicePath = 'C:\services\suivi-infra',
    [int]    $ServicePort = 4000,
    [string] $NssmPath,
    [string] $AdminUser,
    [string] $AdminName,
    [switch] $SkipAdminAccount,
    [switch] $SkipFirewall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServiceName = 'SuiviInfraAuth'
$IsHttps     = $Protocol -eq 'https'
$BaseUrl     = "${Protocol}://${HostName}" + $(if (($IsHttps -and $Port -eq 443) -or (-not $IsHttps -and $Port -eq 80)) { '' } else { ":$Port" })
$FirewallRule = "Suivi Infra - $($Protocol.ToUpper()) $Port"

function Write-Step { param([string] $Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Message) Write-Host "    [OK] $Message" -ForegroundColor Green }
function Write-Warn { param([string] $Message) Write-Host "    [!]  $Message" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------------------
# 0. Contrôles préalables - on vérifie tout AVANT de modifier quoi que ce soit, pour ne
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
    Write-Warn "Le rôle IIS n'est pas installé - installation en cours (peut prendre une minute)."
    Install-WindowsFeature -Name Web-Server -IncludeManagementTools | Out-Null
}
# Le module PowerShell WebAdministration vient de Web-Scripting-Tools, pas du rôle IIS
# lui-même : sans lui, ni ce script ni Test-SuiviInfra.ps1 ne peuvent configurer ou
# contrôler le site.
if (-not (Get-WindowsFeature -Name Web-Scripting-Tools).Installed) {
    Write-Warn "Outils de script IIS absents - installation en cours."
    Install-WindowsFeature -Name Web-Scripting-Tools | Out-Null
}
Import-Module WebAdministration -ErrorAction Stop
Write-Ok 'IIS présent'

# Certificat : uniquement en HTTPS, et résolu maintenant - avant de créer quoi que ce soit.
$cert = $null
if ($IsHttps) {
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
Importez-le d'abord (certlm.msc -> Personnel -> Certificats), puis relancez.
Voir DEPLOYMENT-reference.md, section 4.1.
"@
        } else {
            $list = ($candidates | ForEach-Object { "  $($_.Thumbprint)  $($_.Subject)  (expire le $($_.NotAfter.ToString('yyyy-MM-dd')))" }) -join "`n"
            throw "Plusieurs certificats correspondent à '$HostName'. Relancez avec -CertificateThumbprint :`n$list"
        }
    }
    Write-Ok "Certificat : $($cert.Subject) (expire le $($cert.NotAfter.ToString('yyyy-MM-dd')))"
} else {
    Write-Warn "Installation en HTTP : l'application sera servie EN CLAIR sur $BaseUrl. Acceptable pour une mise en service sur réseau interne ; basculez en HTTPS avec Enable-SuiviInfraHttps.ps1 dès que le certificat est disponible."
}

if ($WithService) {
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue)
    if (-not $node) { throw "Node.js introuvable. Installez la version LTS depuis https://nodejs.org puis relancez (Partie B uniquement)." }
    $nodeVersion = (& node.exe -v)
    if ([int](($nodeVersion -replace '^v','') -split '\.')[0] -lt 18) {
        throw "Node.js $nodeVersion détecté : la version 18 ou supérieure est requise."
    }
    Write-Ok "Node.js $nodeVersion - $($node.Source)"

    # NSSM est PRÉFÉRÉ mais facultatif : il fait de Node un vrai service Windows. Quand il
    # n'est pas là, on se rabat sur une tâche planifiée « au démarrage », native à Windows.
    # L'installation ne dépend donc d'aucun téléchargement.
    if (-not $NssmPath) {
        foreach ($candidat in @(
            (Get-Command nssm.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
            (Join-Path $PackageRoot 'nssm.exe'),
            (Join-Path $PackageRoot 'prereqs\nssm.exe'),
            'C:\outils\nssm.exe'
        )) {
            if ($candidat -and (Test-Path $candidat)) { $NssmPath = $candidat; break }
        }
    }
    if ($NssmPath -and (Test-Path $NssmPath)) {
        $UseNssm = $true
        Write-Ok "NSSM : $NssmPath"
    } else {
        $UseNssm = $false
        Write-Warn "nssm.exe absent : le service sera lancé par une tâche planifiée Windows au démarrage. C'est fonctionnel et sans téléchargement. Pour un vrai service Windows, posez nssm.exe (https://nssm.cc) à côté de ce script et relancez."
    }

    # Simple avertissement : si le port est déjà pris par autre chose, le service ne
    # démarrera pas - autant le dire tout de suite. (On n'essaie pas de deviner *quel*
    # processus écoute : sur une réinstallation c'est justement notre propre service,
    # que le script arrête un peu plus bas.)
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $ServicePort -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0 -and -not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
        Write-Warn "Le port $ServicePort est déjà utilisé par un autre programme. Choisissez un autre port avec -ServicePort, sinon le service ne pourra pas démarrer."
    }
}

# ---------------------------------------------------------------------------------------
# 1. Partie A - publication du site statique
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
    Write-Warn "Un web.config personnalisé existe déjà : il a été conservé. La version du paquet est déposée à côté ($([IO.Path]::GetFileName($backup))) - comparez-les si cette version apporte des changements."
} else {
    Copy-Item $packagedConfig $existingConfig -Force
}
Write-Ok 'Fichiers du site publiés'

# Drapeau lu par l'application au démarrage (voir public/app-config.js). Sur une
# installation avec service, il interdit le repli silencieux en mode autonome : si le
# service ou le relais /api tombe, l'application annonce « Serveur indisponible » au lieu
# de s'ouvrir sans authentification sur les données du navigateur.
$configJs = Join-Path $SitePath 'app-config.js'
@(
    "// Écrit par Install-SuiviInfra.ps1 le $(Get-Date -Format 'yyyy-MM-dd HH:mm'). Ne pas modifier :",
    '// ce fichier est réécrit à chaque installation.',
    "window.__SUIVI_INFRA__ = { requireServer: $(if ($WithService) { 'true' } else { 'false' }) };"
) | Set-Content -Path $configJs -Encoding UTF8
Write-Ok $(if ($WithService) {
    "app-config.js : le service est exigé - pas d'ouverture sans authentification si /api tombe"
} else {
    'app-config.js : installation autonome'
})

# ---------------------------------------------------------------------------------------
# 2. Site IIS + liaison HTTPS
# ---------------------------------------------------------------------------------------
Write-Step "Configuration du site IIS « $SiteName »"

if (-not (Test-Path "IIS:\Sites\$SiteName")) {
    if ($IsHttps) {
        New-Website -Name $SiteName -PhysicalPath $SitePath -Port $Port -HostHeader $HostName -Ssl | Out-Null
    } else {
        New-Website -Name $SiteName -PhysicalPath $SitePath -Port $Port -HostHeader $HostName | Out-Null
    }
    Write-Ok 'Site créé'
} else {
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $SitePath
    Write-Ok 'Site existant réutilisé'
}

# On repart d'une liaison propre : relancer le script en changeant de port ou de protocole
# doit remplacer l'ancienne liaison, pas en empiler une deuxième qui resterait joignable.
foreach ($b in @(Get-WebBinding -Name $SiteName -ErrorAction SilentlyContinue)) {
    $info = $b.bindingInformation   # "*:443:winas"
    $bPort = ($info -split ':')[1]
    if ($b.protocol -ne $Protocol -or $bPort -ne "$Port") {
        Remove-WebBinding -Name $SiteName -Protocol $b.protocol -Port $bPort -HostHeader (($info -split ':')[2]) -ErrorAction SilentlyContinue
        Write-Ok "Ancienne liaison $($b.protocol) $bPort retirée"
    }
}

$binding = Get-WebBinding -Name $SiteName -Protocol $Protocol -Port $Port -ErrorAction SilentlyContinue
if (-not $binding) {
    if ($IsHttps) {
        # SNI (SslFlags 1) : permet plusieurs sites HTTPS avec des noms d'hôte différents sur
        # la même IP - le cas courant quand ce serveur héberge déjà autre chose.
        New-WebBinding -Name $SiteName -Protocol https -Port $Port -HostHeader $HostName -SslFlags 1
    } else {
        New-WebBinding -Name $SiteName -Protocol http -Port $Port -HostHeader $HostName
    }
    $binding = Get-WebBinding -Name $SiteName -Protocol $Protocol -Port $Port
}
if ($IsHttps) {
    $binding.AddSslCertificate($cert.Thumbprint, 'My')
}
Write-Ok "Liaison $($Protocol.ToUpper()) $Port sur $HostName"

Start-Website -Name $SiteName -ErrorAction SilentlyContinue
Write-Ok 'Site démarré'

if (-not $SkipFirewall) {
    if (-not (Get-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $FirewallRule -Direction Inbound -Protocol TCP `
            -LocalPort $Port -Action Allow -Profile Domain | Out-Null
        Write-Ok "Règle de pare-feu $Port/TCP (profil Domaine) ajoutée"
    } else {
        Write-Ok 'Règle de pare-feu déjà présente'
    }
}

# ---------------------------------------------------------------------------------------
# 3. Partie B - service d'authentification / multi-utilisateur
# ---------------------------------------------------------------------------------------
if ($WithService) {
    Write-Step "Installation du service « $ServiceName » vers $ServicePath"

    $serviceExists = [bool](Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
    $taskExists    = [bool](Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue)

    if ($serviceExists -and $UseNssm) {
        & $NssmPath stop $ServiceName confirm | Out-Null
        Write-Ok 'Service existant arrêté le temps de la mise à jour'
    } elseif ($serviceExists) {
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Write-Ok 'Service existant arrêté le temps de la mise à jour'
    }
    if ($taskExists) {
        Stop-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
        Write-Ok 'Tâche planifiée existante arrêtée le temps de la mise à jour'
    }
    # Arrêter la tâche tue cmd.exe, pas forcément le node.exe qu'elle a lancé : on le
    # termine explicitement, sinon les fichiers du service resteraient verrouillés.
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$ServicePath*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500

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
            "COOKIE_SECURE=$(if ($IsHttps) { 'true' } else { 'false' })",
            "CORS_ORIGIN=$BaseUrl",
            "",
            "# SSO Microsoft (facultatif) - mêmes valeurs que dans l'onglet Paramètres :",
            "# ENTRA_TENANT_ID=",
            "# ENTRA_CLIENT_ID=",
            "",
            "# LDAP / Active Directory (facultatif) - se configure aussi depuis l'application :",
            "# LDAP_URL=ldaps://dc.monentreprise.local:636",
            "# LDAP_BIND_DN=",
            "# LDAP_BIND_PASSWORD=",
            "# LDAP_SEARCH_BASE="
        ) | Set-Content -Path $envPath -Encoding UTF8
        Write-Ok '.env généré (secret de session aléatoire)'
    } else {
        # Le .env existant n'est jamais réécrit - il porte le secret de session et la
        # configuration LDAP/SMTP saisies à la main. Deux valeurs font exception : elles
        # décrivent l'adresse du site, qui vient de changer si on a rejoué le script avec
        # un autre protocole ou un autre port. Les laisser périmées casserait la connexion
        # (cookie refusé) sans message clair.
        $envLines = Get-Content $envPath
        $wanted = @{ 'COOKIE_SECURE' = $(if ($IsHttps) { 'true' } else { 'false' }); 'CORS_ORIGIN' = $BaseUrl }
        $changed = $false
        foreach ($key in $wanted.Keys) {
            $line = "$key=$($wanted[$key])"
            if ($envLines -notcontains $line) {
                $changed = $true
                if ($envLines -match "^$key=") {
                    $envLines = $envLines -replace "^$key=.*$", $line
                } else {
                    $envLines += $line
                }
            }
        }
        if ($changed) {
            $envLines | Set-Content -Path $envPath -Encoding UTF8
            Write-Ok ".env conservé ; COOKIE_SECURE et CORS_ORIGIN alignés sur $BaseUrl"
        } else {
            Write-Ok '.env existant conservé (secret, LDAP et SMTP inchangés)'
        }
    }

    # Le dossier data\ contient des secrets (hachages de mots de passe) et les données
    # d'équipe : on restreint son accès aux administrateurs et au compte de service.
    #
    # Les comptes sont désignés par leur SID bien connu, jamais par leur nom : sur un Windows
    # français le groupe s'appelle « BUILTIN\Administrateurs », en allemand « VORDEFINIERT\
    # Administratoren »... et l'attribution échoue avec « Impossible de traduire certaines ou
    # toutes les références d'identité ». Le SID, lui, est le même partout.
    $sidAdmins = New-Object Security.Principal.SecurityIdentifier(
        [Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)
    $sidSystem = New-Object Security.Principal.SecurityIdentifier(
        [Security.Principal.WellKnownSidType]::LocalSystemSid, $null)

    $acl = Get-Acl (Join-Path $ServicePath 'data')
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @($sidAdmins, $sidSystem)) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
            $sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    Set-Acl -Path (Join-Path $ServicePath 'data') -AclObject $acl
    Write-Ok 'Droits restreints sur service\data (Administrateurs + SYSTEM)'

    $nodeExe = (Get-Command node.exe).Source
    $entryPoint = Join-Path $ServicePath 'src\index.js'
    $logPath = Join-Path $ServicePath 'service.log'

    if ($UseNssm) {
        if (-not $serviceExists) {
            & $NssmPath install $ServiceName $nodeExe $entryPoint | Out-Null
        } else {
            & $NssmPath set $ServiceName Application $nodeExe | Out-Null
            & $NssmPath set $ServiceName AppParameters $entryPoint | Out-Null
        }
        & $NssmPath set $ServiceName AppDirectory $ServicePath | Out-Null
        & $NssmPath set $ServiceName Start SERVICE_AUTO_START | Out-Null
        & $NssmPath set $ServiceName AppStdout $logPath | Out-Null
        & $NssmPath set $ServiceName AppStderr (Join-Path $ServicePath 'service.err.log') | Out-Null
        & $NssmPath set $ServiceName AppRotateFiles 1 | Out-Null
        & $NssmPath set $ServiceName Description 'Suivi Infra & Reseau - authentification et donnees partagees' | Out-Null
        & $NssmPath start $ServiceName | Out-Null
        Write-Ok "Service Windows $ServiceName installé et démarré (journaux : $logPath)"

        # Une tâche planifiée d'une installation précédente ferait tourner un second Node
        # sur le même port : le service ne démarrerait pas. On la retire.
        if ($taskExists) {
            Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false
            Write-Ok 'Ancienne tâche planifiée retirée (remplacée par le service Windows)'
        }
    } else {
        # Repli natif : Node n'est pas un programme de service (il ne répond pas au
        # gestionnaire de services), on ne peut donc pas l'enregistrer tel quel avec
        # New-Service. Une tâche planifiée « au démarrage », exécutée par SYSTEM, donne le
        # même résultat pratique : démarrage automatique et relance en cas d'arrêt.
        # cmd.exe sert uniquement à rediriger la sortie vers le journal.
        # Le lancement passe par un fichier .cmd plutôt que par un « cmd.exe /c <ligne> ».
        # Quand la ligne remise à /c commence par un guillemet, cmd.exe en retire le premier
        # et le dernier avant d'interpréter le reste : la commande se retrouve coupée et Node
        # n'est jamais lancé - la tâche repasse aussitôt en « Ready », sans rien dans le
        # journal puisque la redirection elle-même a été mutilée. Un fichier évite ces règles
        # de découpage, et l'administrateur peut le lancer à la main pour voir les erreurs.
        $lanceur = Join-Path $ServicePath 'run-service.cmd'
        @(
            '@echo off',
            'REM Lanceur du service, appele par la tache planifiee SuiviInfraAuth.',
            'REM Ecrit par Install-SuiviInfra.ps1 - ne pas modifier, il est reecrit a chaque installation.',
            'REM Pour diagnostiquer : lancez ce fichier a la main dans une console administrateur.',
            'cd /d "%~dp0"',
            "`"$nodeExe`" `"$entryPoint`" >> `"$logPath`" 2>&1"
        ) | Set-Content -Path $lanceur -Encoding ASCII
        Write-Ok "Lanceur écrit : $lanceur"

        $action = New-ScheduledTaskAction -Execute $lanceur -WorkingDirectory $ServicePath
        $trigger = New-ScheduledTaskTrigger -AtStartup
        # Nom local du compte SYSTEM, obtenu depuis son SID : « AUTORITE NT\Système » en
        # français, « NT AUTHORITY\SYSTEM » en anglais. En cas d'échec de la traduction, on
        # retombe sur l'alias « SYSTEM », que le planificateur de tâches accepte aussi.
        try {
            $systemName = $sidSystem.Translate([Security.Principal.NTAccount]).Value
        } catch {
            $systemName = 'SYSTEM'
        }
        $principal = New-ScheduledTaskPrincipal -UserId $systemName -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew

        Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger `
            -Principal $principal -Settings $settings -Force `
            -Description 'Suivi Infra & Reseau - authentification et donnees partagees' | Out-Null
        Start-ScheduledTask -TaskName $ServiceName
        Write-Ok "Tâche planifiée $ServiceName enregistrée et démarrée (journaux : $logPath)"
    }

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
        Write-Warn "Le service ne répond pas."
        # Le journal dit pourquoi : autant l'afficher ici plutôt que d'y renvoyer, c'est la
        # première chose que l'on irait lire.
        foreach ($f in @("$ServicePath\service.log", $(if ($UseNssm) { "$ServicePath\service.err.log" }))) {
            if ($f -and (Test-Path $f)) {
                $lignes = Get-Content $f -Tail 15 -ErrorAction SilentlyContinue
                if ($lignes) {
                    Write-Host "    --- $f (15 dernières lignes) ---" -ForegroundColor Yellow
                    $lignes | ForEach-Object { Write-Host "    $_" }
                    Write-Host "    ---" -ForegroundColor Yellow
                }
            }
        }
        if (-not $UseNssm) {
            Write-Host "    Pour voir l'erreur en direct : lancez `"$ServicePath\run-service.cmd`" dans cette console." -ForegroundColor Yellow
        }
    }

    # --- Premier compte local ---
    # Créé ici, par le script, parce qu'il est déjà élevé : le dossier data\ n'est accessible
    # qu'aux administrateurs et à SYSTEM, si bien que la même commande lancée depuis une
    # console non élevée échoue avec « EPERM ». C'est aussi la dernière étape manuelle qui
    # restait entre l'installation et une application utilisable.
    $usersFile = Join-Path $ServicePath 'data\users.json'
    $aDesComptes = $false
    if (Test-Path $usersFile) {
        try { $aDesComptes = @(Get-Content $usersFile -Raw | ConvertFrom-Json).Count -gt 0 } catch { $aDesComptes = $false }
    }

    if ($aDesComptes) {
        Write-Ok 'Des comptes locaux existent déjà - aucun compte créé'
    } elseif ($SkipAdminAccount) {
        Write-Warn "Aucun compte local. Créez-en un depuis une console ADMINISTRATEUR : .\Reset-SuiviInfraAdmin.ps1"
    } else {
        Write-Step 'Compte de première connexion'
        # Compte créé sans rien demander : la saisie interactive d'un mot de passe est le
        # dernier endroit où une installation peut échouer ou être sautée par mégarde, et on
        # se retrouve alors avec une application installée mais inaccessible. Le mot de passe
        # par défaut est public ; l'application affiche un bandeau rouge tant qu'il est en
        # place, ce qui rend l'oubli difficile.
        $identifiant = if ($AdminUser) { $AdminUser } else { 'admin' }
        $motDePasse  = 'SuiviInfra2026!'
        $nomComplet  = if ($AdminName) { $AdminName } else { 'Administrateur' }

        $env:SUIVI_INFRA_PASSWORD = $motDePasse
        try {
            Push-Location $ServicePath
            # --name, et surtout pas un mot de passe positionnel vide : Windows PowerShell 5.1
            # escamote les arguments vides transmis aux programmes externes, si bien que le nom
            # complet glisserait à la place du mot de passe et créerait un compte inutilisable.
            & $nodeExe 'scripts\create-local-user.js' $identifiant '--name' $nomComplet
            if ($LASTEXITCODE -eq 0) {
                Write-Host ''
                Write-Host '    +------------------------------------------------------------+' -ForegroundColor Yellow
                Write-Host '    |  COMPTE DE PREMIERE CONNEXION                               |' -ForegroundColor Yellow
                Write-Host ("    |    Identifiant : {0,-42}|" -f $identifiant) -ForegroundColor White
                Write-Host ("    |    Mot de passe : {0,-41}|" -f $motDePasse) -ForegroundColor White
                Write-Host '    |                                                            |' -ForegroundColor Yellow
                Write-Host '    |  Ce mot de passe est PUBLIC. Changez-le a la premiere       |' -ForegroundColor Red
                Write-Host '    |  connexion : Parametres -> Authentification locale.         |' -ForegroundColor Red
                Write-Host '    +------------------------------------------------------------+' -ForegroundColor Yellow
                Write-Host ''
            } else {
                Write-Warn "La création du compte a échoué (code $LASTEXITCODE). Lancez .\Reset-SuiviInfraAdmin.ps1 depuis une console administrateur."
            }
        } finally {
            Pop-Location
            Remove-Item Env:\SUIVI_INFRA_PASSWORD -ErrorAction SilentlyContinue
        }
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
        Write-Ok "Règle « Suivi Infra - API » : /api/* -> http://127.0.0.1:$ServicePort/api/*"
    }
}

# ---------------------------------------------------------------------------------------
# 4. Résumé
# ---------------------------------------------------------------------------------------
Write-Step 'Installation terminée'
Write-Host "    Application : $BaseUrl" -ForegroundColor White
Write-Host "    Fichiers    : $SitePath"
if ($WithService) {
    Write-Host "    Service     : $ServiceName ($ServicePath), port local $ServicePort$(if (-not $UseNssm) { ' - tâche planifiée Windows' })"
    Write-Host ""
    Write-Host "    Connexion : onglet « Compte local », identifiant « $(if ($AdminUser) { $AdminUser } else { 'admin' }) »." -ForegroundColor Yellow
    Write-Host "    Mot de passe oublié ou compte à recréer : .\Reset-SuiviInfraAdmin.ps1" -ForegroundColor Yellow
    Write-Host "    Connexion refusée malgré ces identifiants : .\Repair-SuiviInfraLogin.ps1" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "    Vérification :" -ForegroundColor Yellow
Write-Host "      .\Test-SuiviInfra.ps1 -HostName $HostName -Protocol $Protocol -Port $Port$(if ($WithService) { ' -WithService' })"
Write-Host ""

if (-not $IsHttps) {
    Write-Host "    ATTENTION - l'application est servie EN CLAIR." -ForegroundColor Red
    Write-Host "    Mots de passe et données d'équipe circulent sans chiffrement sur le réseau." -ForegroundColor Yellow
    Write-Host "    Dès que le certificat pour $HostName est importé dans Ordinateur local\Personnel :" -ForegroundColor Yellow
    Write-Host "      .\Enable-SuiviInfraHttps.ps1 -HostName $HostName$(if ($WithService) { ' -WithService' })"
    Write-Host ""
}
