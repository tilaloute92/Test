<#
.SYNOPSIS
    Installe NetSchema de bout en bout sur un serveur Windows.

.DESCRIPTION
    Un seul script pour toute l'installation : il vérifie (et au besoin installe) Node.js,
    met en place l'application, déclare le service Windows, ouvre le pare-feu, crée le premier
    compte administrateur, démarre le service et vérifie que la page de connexion répond.

    Il est fait pour être relancé sans risque : une seconde exécution répare ou met à jour
    l'installation sans toucher aux schémas, aux comptes ni au fichier de configuration.

    Tout ce qu'il fait est écrit dans un journal, sous C:\ProgramData\NetSchema\logs.

.PARAMETER Port
    Port d'écoute (8080 par défaut).

.PARAMETER Admin
    Identifiant du premier compte administrateur. Le mot de passe est demandé, masqué.

.PARAMETER Diagnostic
    N'installe rien : rassemble l'état complet de la machine dans un fichier à transmettre.

.PARAMETER Desinstaller
    Retire le service, la règle de pare-feu et les fichiers installés. Les données restent.

.EXAMPLE
    .\Installer-NetSchema.ps1

.EXAMPLE
    .\Installer-NetSchema.ps1 -Port 8080 -Admin rnelson

.EXAMPLE
    .\Installer-NetSchema.ps1 -Diagnostic

.NOTES
    À lancer dans une console PowerShell « exécuter en tant qu'administrateur », ou par un
    double-clic sur Installer-NetSchema.cmd qui s'en charge.
#>

[CmdletBinding()]
param(
    [int]$Port = 8080,
    [string]$InstallDir = 'C:\Apps\NetSchema',
    [string]$DataDir = 'C:\ProgramData\NetSchema\data',
    [string]$ServiceName = 'NetSchema',
    [string]$Admin = 'admin',
    [string]$SourceRoot,
    [string]$NssmPath,
    [string]$NodeVersion = '22.11.0',
    [switch]$SansNode,
    [switch]$Diagnostic,
    [switch]$Desinstaller,
    [switch]$SansPause
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# ══════════════════════════════════════════════════════════════════════════════
#  Affichage
# ══════════════════════════════════════════════════════════════════════════════

$script:Avertissements = @()

function Titre([string]$texte) {
    Write-Host ''
    Write-Host "  $texte" -ForegroundColor White
    Write-Host ('  ' + ('─' * [Math]::Min($texte.Length, 70))) -ForegroundColor DarkGray
}
function Etape([string]$texte) { Write-Host "  → $texte" -ForegroundColor Cyan }
function Ok([string]$texte) { Write-Host "    $texte" -ForegroundColor Green }
function Info([string]$texte) { Write-Host "    $texte" -ForegroundColor Gray }
function Avert([string]$texte) {
    $script:Avertissements += $texte
    Write-Host "    $texte" -ForegroundColor Yellow
}

function Test-Administrateur {
    $identite = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$identite).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ══════════════════════════════════════════════════════════════════════════════
#  Outils
# ══════════════════════════════════════════════════════════════════════════════

function Recharger-Path {
    # Après l'installation de Node.js, le PATH de la console en cours ne le connaît pas encore.
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $utilisateur = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = @($machine, $utilisateur) -join ';'
}

function Get-VersionNode {
    try {
        $brut = (& node --version 2>$null)
        if (-not $brut) { return $null }
        return [version](($brut -replace '^v', '') -replace '-.*$', '')
    } catch { return $null }
}

function Installer-Node {
    Etape "Installation de Node.js $NodeVersion"

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Info 'Tentative par winget…'
        try {
            & winget install --id OpenJS.NodeJS.LTS -e --silent `
                --accept-package-agreements --accept-source-agreements | Out-Null
            Recharger-Path
            if (Get-VersionNode) { Ok 'Node.js installé par winget.'; return }
        } catch { Info "winget n'a pas abouti, passage au téléchargement direct." }
    }

    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $nom = "node-v$NodeVersion-$arch.msi"
    $url = "https://nodejs.org/dist/v$NodeVersion/$nom"
    $msi = Join-Path $env:TEMP $nom

    Info "Téléchargement de $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing -TimeoutSec 180
    } catch {
        throw @"
Node.js n'a pas pu être téléchargé ($url).

Ce serveur n'a probablement pas d'accès Internet. Installez Node.js à la main :
  1. depuis un poste connecté, téléchargez $nom sur https://nodejs.org ;
  2. copiez le fichier sur ce serveur et double-cliquez dessus ;
  3. relancez ce script.
"@
    }

    Info 'Installation silencieuse…'
    $process = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "L'installation de Node.js a échoué (code $($process.ExitCode))." }
    Recharger-Path
    Remove-Item $msi -ErrorAction SilentlyContinue
    if (-not (Get-VersionNode)) { throw "Node.js reste introuvable après installation. Redémarrez la session et relancez." }
    Ok 'Node.js installé.'
}

$script:DerniereSortieNpm = ''

function Invoke-Externe {
    <#
        Lance un programme externe et rend son code de sortie.

        Indispensable : quand un programme écrit sur sa sortie d'erreur, PowerShell en fait
        une erreur à part entière, et le script s'arrêterait net sur un simple avertissement
        d'icacls ou de sc.exe. Ici, la sortie est ramassée et c'est l'appelant qui décide.
    #>
    param([string]$Fichier, [string[]]$Arguments, [string]$Dossier)
    $precedent = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    if ($Dossier) { Push-Location $Dossier }
    try {
        $sortie = & $Fichier @Arguments 2>&1 | ForEach-Object { "$_" }
        return [pscustomobject]@{
            Code = $LASTEXITCODE
            Sortie = ($sortie -join [Environment]::NewLine)
        }
    } catch {
        return [pscustomobject]@{ Code = -1; Sortie = $_.Exception.Message }
    } finally {
        if ($Dossier) { Pop-Location }
        $ErrorActionPreference = $precedent
    }
}

function Nom-Compte {
    <#
        Nom local d'un compte à partir de son identifiant de sécurité.

        Sur un Windows français, le groupe des administrateurs s'appelle
        « BUILTIN\Administrateurs » : un nom écrit en dur en anglais fait échouer icacls avec
        « Le mappage entre les noms de compte et les ID de sécurité n'a pas été effectué ».
        L'identifiant de sécurité, lui, est le même partout.
    #>
    param([string]$Sid)
    try {
        return (New-Object Security.Principal.SecurityIdentifier($Sid)).Translate(
            [Security.Principal.NTAccount]).Value
    } catch { return $null }
}

function Compte-Du-Service {
    <# Compte sous lequel le service tourne réellement, tel que Windows le rapporte. #>
    param([string]$Nom)
    try {
        $service = Get-CimInstance Win32_Service -Filter "Name='$Nom'" -ErrorAction SilentlyContinue
        if ($service -and $service.StartName) {
            if ($service.StartName -match '^(LocalSystem|\.\\LocalSystem)$') { return (Nom-Compte 'S-1-5-18') }
            return $service.StartName
        }
    } catch { }
    return $null
}

function Invoke-Npm {
    param([string]$Dossier, [string[]]$Arguments)
    # La sortie de npm est gardée de côté : inutile à l'écran quand tout va bien,
    # indispensable dans le journal quand la compilation échoue.
    $resultat = Invoke-Externe -Fichier 'npm' -Arguments $Arguments -Dossier $Dossier
    $script:DerniereSortieNpm = $resultat.Sortie
    return ($resultat.Code -eq 0)
}

function Detail-Npm {
    $texte = $script:DerniereSortieNpm
    if (-not $texte) { return '' }
    $lignes = $texte -split "`r?`n" | Where-Object { $_ -ne '' } | Select-Object -Last 12
    return "`n`nDernières lignes de npm :`n" + ($lignes -join "`n")
}

function Recuperer-Nssm {
    param([string]$Destination)
    # NSSM transforme un programme en service Windows qui redémarre tout seul. Sans lui, on
    # se rabat sur une tâche planifiée — utilisable, mais sans relance après un plantage.
    $zip = Join-Path $env:TEMP 'nssm-2.24.zip'
    $dossier = Join-Path $env:TEMP 'nssm-2.24'
    try {
        Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip -UseBasicParsing -TimeoutSec 60
        if (Test-Path $dossier) { Remove-Item $dossier -Recurse -Force }
        Expand-Archive -Path $zip -DestinationPath $env:TEMP -Force
        $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'AMD64') { 'win64' } else { 'win32' }
        $exe = Join-Path $dossier "$arch\nssm.exe"
        if (Test-Path $exe) {
            Copy-Item $exe $Destination -Force
            return $Destination
        }
    } catch {
        return $null
    } finally {
        Remove-Item $zip -ErrorAction SilentlyContinue
    }
    return $null
}

function Ecrire-Fichier {
    param([string]$Chemin, [string[]]$Lignes)
    # WriteAllLines écrit de l'UTF-8 sans marque d'ordre des octets : une marque en tête de
    # fichier se retrouverait collée au nom de la première variable de configuration.
    [IO.File]::WriteAllLines($Chemin, $Lignes, (New-Object Text.UTF8Encoding $false))
}

function Attendre-Service {
    param([int]$Secondes = 45)
    $fin = (Get-Date).AddSeconds($Secondes)
    while ((Get-Date) -lt $fin) {
        try {
            $reponse = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
            if ($reponse.ok) { return $true }
        } catch { Start-Sleep -Seconds 2 }
    }
    return $false
}

function Tache-Planifiee {
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $null }
    return Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
}

function Etat-Service {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service) { return "service $($service.Status)" }
    $tache = Tache-Planifiee
    if ($tache) { return "tâche planifiée $($tache.State)" }
    return 'absent'
}

function Arreter-Service {
    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    }
    if (Tache-Planifiee) { Stop-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue }
    # Un processus resté en vie garderait les fichiers ouverts pendant la copie.
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($InstallDir) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Demarrer-Service {
    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
        Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
    } elseif (Tache-Planifiee) {
        Start-ScheduledTask -TaskName $ServiceName
    }
}

# ══════════════════════════════════════════════════════════════════════════════
#  Diagnostic
# ══════════════════════════════════════════════════════════════════════════════

function Rapport-Diagnostic {
    $chemin = Join-Path ([IO.Path]::GetDirectoryName($DataDir)) ("diagnostic-{0:yyyyMMdd-HHmmss}.txt" -f (Get-Date))
    $lignes = New-Object Collections.Generic.List[string]
    function Bloc([string]$titre, [scriptblock]$action) {
        $lignes.Add('')
        $lignes.Add("=== $titre ===")
        try {
            $sortie = @(& $action | Out-String -Width 200 -Stream)
            if ($sortie.Count) { $lignes.AddRange([string[]]$sortie) } else { $lignes.Add('(rien)') }
        } catch { $lignes.Add("(erreur : $($_.Exception.Message))") }
    }

    $lignes.Add("Diagnostic NetSchema — $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    Bloc 'Machine' { "$env:COMPUTERNAME — $((Get-CimInstance Win32_OperatingSystem).Caption)" }
    Bloc 'PowerShell' { $PSVersionTable }
    Bloc 'Node.js' { & node --version 2>&1; (Get-Command node -ErrorAction SilentlyContinue).Source }
    Bloc 'Service' { Get-Service -Name $ServiceName -ErrorAction SilentlyContinue | Format-List * }
    Bloc 'Tâche planifiée' { Tache-Planifiee | Format-List TaskName, State }
    Bloc 'Dossier installé' { Get-ChildItem $InstallDir -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime }
    Bloc 'Configuration' { Get-Content (Join-Path $InstallDir 'netschema.env') -ErrorAction SilentlyContinue }
    Bloc 'Dossier de données' { Get-ChildItem $DataDir -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime }
    Bloc 'Ports en écoute' { (Invoke-Externe -Fichier 'netstat' -Arguments @('-ano')).Sortie -split "`r?`n" | Select-String ":$Port" }
    Bloc 'Santé du service' { try { Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 5 } catch { $_.Exception.Message } }
    Bloc 'Pare-feu' { Get-NetFirewallRule -DisplayName 'NetSchema*' -ErrorAction SilentlyContinue | Select-Object DisplayName, Enabled, Direction }
    Bloc 'Journal du service (50 dernières lignes)' { Get-Content (Join-Path $DataDir 'service.log') -Tail 50 -ErrorAction SilentlyContinue }
    Bloc 'Journal d''audit (20 dernières lignes)' { Get-Content (Join-Path $DataDir 'audit.log') -Tail 20 -ErrorAction SilentlyContinue }
    Bloc 'Dernier journal d''installation' {
        $dossierLogs = Join-Path ([IO.Path]::GetDirectoryName($DataDir)) 'logs'
        Get-ChildItem $dossierLogs -Filter 'installation-*.log' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1 |
            ForEach-Object { Get-Content $_.FullName -Tail 80 }
    }

    Ecrire-Fichier -Chemin $chemin -Lignes $lignes.ToArray()
    return $chemin
}

# ══════════════════════════════════════════════════════════════════════════════
#  Désinstallation
# ══════════════════════════════════════════════════════════════════════════════

function Desinstallation {
    Titre 'Désinstallation de NetSchema'
    Arreter-Service

    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
        $nssm = Join-Path $InstallDir 'nssm.exe'
        if (Test-Path $nssm) { Invoke-Externe -Fichier $nssm -Arguments @('remove', $ServiceName, 'confirm') | Out-Null }
        else { Invoke-Externe -Fichier 'sc.exe' -Arguments @('delete', $ServiceName) | Out-Null }
        Ok 'Service retiré.'
    }
    if (Tache-Planifiee) {
        Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false
        Ok 'Tâche planifiée retirée.'
    }
    Get-NetFirewallRule -DisplayName "NetSchema*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if (Test-Path $InstallDir) {
        Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        Ok "Dossier $InstallDir supprimé."
    }
    Info "Les données ($DataDir) ont été conservées : schémas, comptes et journal."
}

# ══════════════════════════════════════════════════════════════════════════════
#  Installation
# ══════════════════════════════════════════════════════════════════════════════

function Installation {
    # ── 1. Node.js ────────────────────────────────────────────────────────────
    Titre '1/8  Node.js'
    $version = Get-VersionNode
    if ($version -and $version -ge [version]'20.11.0') {
        Ok "Node.js $version déjà présent."
    } elseif ($SansNode) {
        throw "Node.js 20.11 ou plus récent est requis (trouvé : $(if ($version) { $version } else { 'aucun' }))."
    } else {
        if ($version) { Info "Node.js $version est trop ancien (20.11 minimum)." }
        else { Info 'Node.js est absent.' }
        Installer-Node
    }

    # ── 2. Sources ────────────────────────────────────────────────────────────
    Titre '2/8  Fichiers de l''application'
    $webPaquet = Join-Path $PSScriptRoot 'web\index.html'
    $srvPaquet = Join-Path $PSScriptRoot 'serveur\dist\index.js'

    if ((Test-Path $webPaquet) -and (Test-Path $srvPaquet)) {
        $webSource = Join-Path $PSScriptRoot 'web'
        $serveurSource = Join-Path $PSScriptRoot 'serveur'
        Ok 'Paquet prêt à installer détecté : aucune compilation nécessaire.'
    } else {
        if (-not $SourceRoot) {
            $candidats = @(
                (Join-Path $PSScriptRoot '..\..\..\..'),
                (Join-Path $PSScriptRoot '..\..\..'),
                (Join-Path $PSScriptRoot '..\..')
            )
            foreach ($candidat in $candidats) {
                $resolu = (Resolve-Path $candidat -ErrorAction SilentlyContinue)
                if ($resolu -and (Test-Path (Join-Path $resolu.Path 'apps\netschema-server\package.json'))) {
                    $SourceRoot = $resolu.Path
                    break
                }
            }
        }
        if (-not $SourceRoot -or -not (Test-Path (Join-Path $SourceRoot 'apps\netschema-server\package.json'))) {
            throw @"
Ni paquet prêt à installer, ni sources trouvés.

Attendu, à côté de ce script : les dossiers « web » et « serveur ».
Ou bien indiquez le dépôt : .\Installer-NetSchema.ps1 -SourceRoot C:\Sources\Test
"@
        }
        $webSource = Join-Path $SourceRoot 'apps\netschema\dist'
        $serveurSource = Join-Path $SourceRoot 'apps\netschema-server'
        Info "Compilation depuis $SourceRoot (quelques minutes)…"

        Etape 'Interface web'
        $web = Join-Path $SourceRoot 'apps\netschema'
        if (-not (Invoke-Npm $web @('ci', '--no-audit', '--no-fund'))) {
            if (-not (Invoke-Npm $web @('install', '--no-audit', '--no-fund'))) {
                throw ("Les dépendances de l'interface n'ont pas pu être installées (accès au registre npm ?)." + (Detail-Npm))
            }
        }
        if (-not (Invoke-Npm $web @('run', 'build'))) { throw ("La compilation de l'interface a échoué." + (Detail-Npm)) }
        Ok 'Interface compilée.'

        Etape 'Serveur'
        if (-not (Invoke-Npm $serveurSource @('ci', '--no-audit', '--no-fund'))) {
            if (-not (Invoke-Npm $serveurSource @('install', '--no-audit', '--no-fund'))) {
                throw ("Les dépendances du serveur n'ont pas pu être installées (accès au registre npm ?)." + (Detail-Npm))
            }
        }
        if (-not (Invoke-Npm $serveurSource @('run', 'build'))) { throw ("La compilation du serveur a échoué." + (Detail-Npm)) }
        Ok 'Serveur compilé.'
    }

    # ── 3. Copie ──────────────────────────────────────────────────────────────
    Titre '3/8  Installation des fichiers'
    if ((Etat-Service) -ne 'absent') {
        Info 'Arrêt du service en place…'
        Arreter-Service
        Start-Sleep -Seconds 2
    }
    New-Item -ItemType Directory -Force -Path $InstallDir, (Join-Path $InstallDir 'web'), $DataDir | Out-Null
    # On vide l'ancien contenu compilé : une mise à jour ne doit pas laisser traîner les
    # fichiers d'une version précédente. Les données et la configuration, elles, sont ailleurs.
    Remove-Item (Join-Path $InstallDir 'web\*') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $InstallDir 'dist') -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $webSource '*') (Join-Path $InstallDir 'web') -Recurse -Force
    foreach ($element in @('dist', 'node_modules', 'package.json', 'tools')) {
        $depuis = Join-Path $serveurSource $element
        if (Test-Path $depuis) { Copy-Item $depuis $InstallDir -Recurse -Force }
    }
    Copy-Item (Join-Path $PSScriptRoot 'Start-NetSchema.ps1') $InstallDir -Force -ErrorAction SilentlyContinue
    Ok "Fichiers installés dans $InstallDir"

    # ── 4. Configuration ──────────────────────────────────────────────────────
    Titre '4/8  Configuration'
    $fichierEnv = Join-Path $InstallDir 'netschema.env'
    if (Test-Path $fichierEnv) {
        Ok 'Configuration existante conservée.'
        $lignesEnv = Get-Content $fichierEnv
    } else {
        $lignesEnv = @(
            '# Configuration du service NetSchema — écrite par Installer-NetSchema.ps1.',
            '# Après toute modification : Restart-Service NetSchema',
            '',
            'NETSCHEMA_HOST=0.0.0.0',
            "NETSCHEMA_PORT=$Port",
            "NETSCHEMA_DATA_DIR=$DataDir",
            "NETSCHEMA_WEB_DIR=$(Join-Path $InstallDir 'web')",
            '',
            '# HTTPS : renseigner les deux lignes suivantes (certificat et clé au format PEM),',
            '# puis redémarrer le service. Voir Configurer-HTTPS.ps1.',
            '# NETSCHEMA_TLS_CERT=C:\ProgramData\NetSchema\tls\netschema.crt',
            '# NETSCHEMA_TLS_KEY=C:\ProgramData\NetSchema\tls\netschema.key',
            '',
            '# Tant que la liaison est en clair, les cookies ne peuvent pas être marqués Secure :',
            '# le navigateur ne les renverrait pas et la connexion bouclerait sur la page d''accueil.',
            'NETSCHEMA_SECURE_COOKIES=false',
            'NETSCHEMA_TRUST_PROXY=false',
            'NETSCHEMA_SESSION_MINUTES=720'
        )
        Ecrire-Fichier -Chemin $fichierEnv -Lignes $lignesEnv
        Ok "Configuration écrite : $fichierEnv"
    }

    # ── 5. Service ────────────────────────────────────────────────────────────
    Titre '5/8  Service Windows'
    if (-not $NssmPath) {
        $local = Join-Path $PSScriptRoot 'nssm.exe'
        $installe = Join-Path $InstallDir 'nssm.exe'
        if (Test-Path $local) { $NssmPath = $local }
        elseif (Test-Path $installe) { $NssmPath = $installe }
        else {
            Info 'Téléchargement de NSSM (gestionnaire de service)…'
            $NssmPath = Recuperer-Nssm -Destination $installe
        }
    }
    if ($NssmPath -and (Test-Path $NssmPath) -and $NssmPath -ne (Join-Path $InstallDir 'nssm.exe')) {
        Copy-Item $NssmPath (Join-Path $InstallDir 'nssm.exe') -Force
        $NssmPath = Join-Path $InstallDir 'nssm.exe'
    }

    $node = (Get-Command node).Source
    $avecNssm = [bool]($NssmPath -and (Test-Path $NssmPath))

    if ($avecNssm) {
        if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
            Invoke-Externe -Fichier $NssmPath -Arguments @('remove', $ServiceName, 'confirm') | Out-Null
            Start-Sleep -Seconds 1
        }
        $pose = Invoke-Externe -Fichier $NssmPath -Arguments @('install', $ServiceName, $node, (Join-Path $InstallDir 'dist\index.js'))
        if ($pose.Code -ne 0) { throw "Le service n'a pas pu être déclaré :`n$($pose.Sortie)" }
        foreach ($reglage in @(
                @('AppDirectory', $InstallDir),
                @('DisplayName', 'NetSchema — schémas d''infrastructure'),
                @('Description', 'Serveur NetSchema : interface web et API authentifiée.'),
                @('Start', 'SERVICE_AUTO_START'),
                @('AppStdout', (Join-Path $DataDir 'service.log')),
                @('AppStderr', (Join-Path $DataDir 'service.log')),
                @('AppRotateFiles', '1'),
                @('AppRotateBytes', '10485760'))) {
            Invoke-Externe -Fichier $NssmPath -Arguments (@('set', $ServiceName) + $reglage) | Out-Null
        }
        $variables = Get-Content $fichierEnv | Where-Object { $_ -match '^[A-Z][A-Z_]*=' } | ForEach-Object { $_.Trim() }
        if ($variables) {
            Invoke-Externe -Fichier $NssmPath -Arguments (@('set', $ServiceName, 'AppEnvironmentExtra') + $variables) | Out-Null
        }
        Ok "Service « $ServiceName » déclaré (redémarrage automatique en cas d'arrêt)."
    } else {
        Avert "NSSM indisponible : repli sur une tâche planifiée (pas de relance après un plantage)."
        $lanceur = Join-Path $InstallDir 'Start-NetSchema.ps1'
        if (-not (Test-Path $lanceur)) {
            Ecrire-Fichier -Chemin $lanceur -Lignes @(
                '# Démarre le serveur NetSchema en chargeant netschema.env.',
                '$dossier = $PSScriptRoot',
                'foreach ($ligne in Get-Content (Join-Path $dossier ''netschema.env'')) {',
                '    $t = $ligne.Trim()',
                '    if (-not $t -or $t.StartsWith(''#'')) { continue }',
                '    $i = $t.IndexOf(''='')',
                '    if ($i -lt 1) { continue }',
                '    [Environment]::SetEnvironmentVariable($t.Substring(0, $i).Trim(), $t.Substring($i + 1).Trim(), ''Process'')',
                '}',
                'Set-Location $dossier',
                '& node (Join-Path $dossier ''dist\index.js'')'
            )
        }
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
            -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$lanceur`"" `
            -WorkingDirectory $InstallDir
        $parametres = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
        Register-ScheduledTask -TaskName $ServiceName -Action $action `
            -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $parametres `
            -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
        Ok "Tâche planifiée « $ServiceName » déclarée."
    }

    # ── 6. Droits et pare-feu ─────────────────────────────────────────────────
    Titre '6/8  Droits et pare-feu'

    # Le service tourne sous le compte système local, celui que Windows donne par défaut aux
    # services. Un compte dédié serait plus fin, mais il se paie cher : compte virtuel refusé
    # par certains gestionnaires, droit « ouvrir une session en tant que service » à accorder
    # à part, service qui refuse alors de démarrer. Ce qui protège vraiment les schémas et les
    # comptes, c'est la restriction d'accès posée juste en dessous.
    #
    # On demande à Windows sous quel compte le service tourne réellement, plutôt que de le
    # supposer : les droits posés ensuite portent alors forcément sur le bon.
    $compte = Compte-Du-Service -Nom $ServiceName
    if (-not $compte) { $compte = (Nom-Compte 'S-1-5-18') }
    if (-not $compte) { $compte = 'NT AUTHORITY\SYSTEM' }

    $administrateurs = Nom-Compte 'S-1-5-32-544'
    $systeme = Nom-Compte 'S-1-5-18'

    $droits = @($DataDir, '/inheritance:r', '/grant:r', "$($compte):(OI)(CI)M")
    if ($administrateurs) { $droits += "$($administrateurs):(OI)(CI)F" }
    if ($systeme -and $systeme -ne $compte) { $droits += "$($systeme):(OI)(CI)F" }

    $resultat = Invoke-Externe -Fichier 'icacls' -Arguments $droits
    if ($resultat.Code -ne 0) {
        Avert "Les droits n'ont pas pu être restreints sur $DataDir (voir le journal)."
        Write-Verbose $resultat.Sortie
    } else {
        Ok "Dossier de données réservé à $compte et aux administrateurs."
        if ($compte -ne $systeme) {
            Invoke-Externe -Fichier 'icacls' -Arguments @($InstallDir, '/grant:r', "$($compte):(OI)(CI)RX") | Out-Null
        }
    }

    try {
        Get-NetFirewallRule -DisplayName 'NetSchema*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        New-NetFirewallRule -DisplayName "NetSchema ($Port/TCP)" -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $Port -Profile Domain, Private | Out-Null
        Ok "Port $Port ouvert (profils Domaine et Privé)."
    } catch {
        Avert "La règle de pare-feu n'a pas pu être créée : ouvrez le port $Port à la main."
    }

    # ── 7. Démarrage ──────────────────────────────────────────────────────────
    Titre '7/8  Démarrage'
    Demarrer-Service
    if (Attendre-Service -Secondes 45) {
        Ok 'Le service répond.'
    } else {
        Write-Host ''
        Write-Host '  Le service ne répond pas encore.' -ForegroundColor Red
        $journal = Join-Path $DataDir 'service.log'
        if (Test-Path $journal) {
            Write-Host '  Dernières lignes du journal du service :' -ForegroundColor Yellow
            Get-Content $journal -Tail 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
        Write-Host ''
        Write-Host '  Causes les plus fréquentes :' -ForegroundColor Yellow
        Write-Host "    • le port $Port est déjà utilisé  →  netstat -ano | findstr :$Port"
        Write-Host '    • Node.js absent du PATH du service  →  redémarrer le serveur'
        Write-Host "    • droits insuffisants sur $DataDir"
        Write-Host ''
        Write-Host '  Lancez ensuite :  .\Installer-NetSchema.ps1 -Diagnostic' -ForegroundColor Yellow
        return $false
    }

    # ── 8. Premier compte ─────────────────────────────────────────────────────
    Titre '8/8  Compte administrateur'
    $fichierComptes = Join-Path $DataDir 'users.json'
    if (Test-Path $fichierComptes) {
        Ok 'Des comptes existent déjà : aucune création.'
    } else {
        Write-Host '    Créons le premier compte administrateur.' -ForegroundColor Gray
        Write-Host '    Mot de passe : 12 caractères minimum, avec au moins trois catégories' -ForegroundColor Gray
        Write-Host '    parmi minuscules, majuscules, chiffres et symboles.' -ForegroundColor Gray
        Write-Host ''
        $identifiant = Read-Host "    Identifiant [$Admin]"
        if (-not $identifiant) { $identifiant = $Admin }

        $cree = $false
        for ($essai = 1; $essai -le 3 -and -not $cree; $essai++) {
            $secret = Read-Host '    Mot de passe' -AsSecureString
            $confirmation = Read-Host '    Confirmation' -AsSecureString
            $a = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret))
            $b = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation))
            if ($a -ne $b) { Avert 'Les deux saisies diffèrent.'; continue }

            $env:NETSCHEMA_DATA_DIR = $DataDir
            # Le mot de passe passe par l'entrée standard : en argument, il serait lisible
            # dans la liste des processus par n'importe qui sur la machine.
            # L'outil refuse un mot de passe trop faible en écrivant sur sa sortie d'erreur :
            # il faut donc désarmer l'arrêt sur erreur, sinon l'installation s'interromprait
            # sur une simple faute de frappe.
            $precedent = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $sortie = $a | & node (Join-Path $InstallDir 'tools\netschema-user.mjs') `
                add $identifiant --role admin --password-stdin 2>&1
            $code = $LASTEXITCODE
            $ErrorActionPreference = $precedent
            $a = $null; $b = $null
            if ($code -eq 0) {
                Ok "Compte « $identifiant » créé (administrateur)."
                $cree = $true
            } else {
                Avert ($sortie | Out-String).Trim()
            }
        }
        if (-not $cree) {
            Avert 'Compte non créé. À faire ensuite, sur le serveur :'
            Write-Host "      cd $InstallDir" -ForegroundColor Gray
            Write-Host "      `$env:NETSCHEMA_DATA_DIR='$DataDir'" -ForegroundColor Gray
            Write-Host "      node tools\netschema-user.mjs add $Admin --role admin" -ForegroundColor Gray
        }
    }
    return $true
}

# ══════════════════════════════════════════════════════════════════════════════
#  Déroulement
# ══════════════════════════════════════════════════════════════════════════════

Write-Host ''
Write-Host '  ╔══════════════════════════════════════════════════════════╗' -ForegroundColor Blue
Write-Host '  ║   NetSchema — installation sur serveur Windows           ║' -ForegroundColor Blue
Write-Host '  ╚══════════════════════════════════════════════════════════╝' -ForegroundColor Blue

if (-not (Test-Administrateur)) {
    Write-Host ''
    Write-Host '  Ce script doit être lancé en administrateur.' -ForegroundColor Red
    Write-Host '  Fermez cette fenêtre et faites un clic droit sur Installer-NetSchema.cmd' -ForegroundColor Yellow
    Write-Host '  → « Exécuter en tant qu''administrateur ».' -ForegroundColor Yellow
    if (-not $SansPause) { Read-Host '  Appuyez sur Entrée pour fermer' }
    exit 1
}

$dossierLogs = Join-Path ([IO.Path]::GetDirectoryName($DataDir)) 'logs'
New-Item -ItemType Directory -Force -Path $dossierLogs | Out-Null
$journalInstallation = Join-Path $dossierLogs ("installation-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
try { Start-Transcript -Path $journalInstallation | Out-Null } catch { }

$succes = $false
try {
    if ($Diagnostic) {
        Titre 'Diagnostic'
        $rapport = Rapport-Diagnostic
        Ok "Rapport écrit : $rapport"
        Info 'Transmettez ce fichier pour analyse : il ne contient aucun mot de passe.'
        $succes = $true
    } elseif ($Desinstaller) {
        Desinstallation
        $succes = $true
    } else {
        $succes = Installation
    }
} catch {
    Write-Host ''
    Write-Host '  ┌──────────────────────────────────────────────────────────' -ForegroundColor Red
    Write-Host '  │  L''installation s''est arrêtée' -ForegroundColor Red
    Write-Host '  └──────────────────────────────────────────────────────────' -ForegroundColor Red
    Write-Host ''
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host ''
    Write-Host "  Journal complet : $journalInstallation" -ForegroundColor Gray
    Write-Host '  Pour un état détaillé :  .\Installer-NetSchema.ps1 -Diagnostic' -ForegroundColor Gray
} finally {
    try { Stop-Transcript | Out-Null } catch { }
}

if ($succes -and -not $Diagnostic -and -not $Desinstaller) {
    $adresse = "http://$($env:COMPUTERNAME):$Port"
    Write-Host ''
    Write-Host '  ╔══════════════════════════════════════════════════════════╗' -ForegroundColor Green
    Write-Host '  ║   NetSchema est installé et démarré                      ║' -ForegroundColor Green
    Write-Host '  ╚══════════════════════════════════════════════════════════╝' -ForegroundColor Green
    Write-Host ''
    Write-Host "    Adresse          $adresse" -ForegroundColor White
    Write-Host "    Données          $DataDir   (à sauvegarder)"
    Write-Host "    Configuration    $(Join-Path $InstallDir 'netschema.env')"
    Write-Host "    Journal          $journalInstallation"
    Write-Host ''
    Write-Host '    Depuis un poste du réseau, ouvrez cette adresse : la page de connexion'
    Write-Host '    doit apparaître. La liaison est en clair (HTTP) : pour la chiffrer,'
    Write-Host '    lancez Configurer-HTTPS.ps1 quand vous aurez un certificat.'
    if ($script:Avertissements.Count) {
        Write-Host ''
        Write-Host '    Points à regarder :' -ForegroundColor Yellow
        $script:Avertissements | ForEach-Object { Write-Host "      • $_" -ForegroundColor Yellow }
    }
    Write-Host ''
}

if (-not $SansPause) { Read-Host '  Appuyez sur Entrée pour fermer' | Out-Null }
