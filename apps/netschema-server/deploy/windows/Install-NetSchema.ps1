<#
.SYNOPSIS
    Installe NetSchema en service Windows.

.DESCRIPTION
    Copie l'application et le serveur vers le dossier d'installation, prépare le dossier de
    données, déclare le service Windows et ouvre le port dans le pare-feu.

    Deux façons de tenir le service selon ce qui est disponible sur la machine :

      - NSSM (recommandé) : redémarrage automatique en cas d'arrêt inattendu, journaux
        redirigés dans des fichiers. Télécharger nssm.exe et le placer à côté de ce script,
        ou indiquer -NssmPath.
      - Tâche planifiée au démarrage (repli) : aucun outil tiers, mais pas de redémarrage
        automatique en cas de plantage.

.EXAMPLE
    .\Install-NetSchema.ps1 -SourceRoot C:\Sources\Test -InstallDir C:\Apps\NetSchema

.EXAMPLE
    .\Install-NetSchema.ps1 -InstallDir C:\Apps\NetSchema -NssmPath C:\Outils\nssm.exe -Port 8443

.NOTES
    À lancer dans une console PowerShell ouverte en tant qu'administrateur.
#>

[CmdletBinding()]
param(
    # Racine du dépôt contenant apps\netschema et apps\netschema-server.
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path,
    [string]$InstallDir = 'C:\Apps\NetSchema',
    [string]$DataDir = 'C:\ProgramData\NetSchema\data',
    [string]$ServiceName = 'NetSchema',
    [int]$Port = 8443,
    [string]$NssmPath,
    # Compte de service. Par défaut : un compte de service géré, sans mot de passe.
    [string]$ServiceAccount = 'NT SERVICE\NetSchema'
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Warn([string]$Message) { Write-Host "    $Message" -ForegroundColor Yellow }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script doit être lancé dans une console PowerShell « exécuter en tant qu'administrateur »."
}

# ── 1. Prérequis ──────────────────────────────────────────────────────────────
Write-Step 'Vérification de Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js introuvable. Installez la version LTS (>= 20.11) depuis https://nodejs.org puis relancez." }
$nodeVersion = (& node --version).TrimStart('v')
if ([version]($nodeVersion -replace '-.*$') -lt [version]'20.11.0') {
    throw "Node.js $nodeVersion est trop ancien : version 20.11 ou supérieure attendue."
}
Write-Host "    Node.js $nodeVersion — $($node.Source)"

$webSource = Join-Path $SourceRoot 'apps\netschema'
$serverSource = Join-Path $SourceRoot 'apps\netschema-server'
foreach ($path in @($webSource, $serverSource)) {
    if (-not (Test-Path $path)) { throw "Dossier introuvable : $path (paramètre -SourceRoot ?)" }
}

# ── 2. Compilation ────────────────────────────────────────────────────────────
Write-Step 'Compilation de l''interface web'
Push-Location $webSource
try {
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { & npm install --no-audit --no-fund }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'La compilation de l''interface a échoué.' }
} finally { Pop-Location }

Write-Step 'Compilation du serveur'
Push-Location $serverSource
try {
    & npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { & npm install --omit=dev --no-audit --no-fund }
    # La compilation TypeScript a besoin des outils de développement.
    & npm install --no-audit --no-fund
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'La compilation du serveur a échoué.' }
} finally { Pop-Location }

# ── 3. Copie ──────────────────────────────────────────────────────────────────
Write-Step "Installation dans $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir, (Join-Path $InstallDir 'web'), $DataDir | Out-Null
Copy-Item (Join-Path $webSource 'dist\*') (Join-Path $InstallDir 'web') -Recurse -Force
foreach ($item in @('dist', 'node_modules', 'package.json', 'tools')) {
    $from = Join-Path $serverSource $item
    if (Test-Path $from) { Copy-Item $from $InstallDir -Recurse -Force }
}

$envFile = Join-Path $InstallDir 'netschema.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $PSScriptRoot 'netschema.env.example') $envFile
    (Get-Content $envFile) `
        -replace '^NETSCHEMA_DATA_DIR=.*$', "NETSCHEMA_DATA_DIR=$DataDir" `
        -replace '^NETSCHEMA_WEB_DIR=.*$', "NETSCHEMA_WEB_DIR=$(Join-Path $InstallDir 'web')" `
        -replace '^NETSCHEMA_PORT=.*$', "NETSCHEMA_PORT=$Port" `
        -replace '^NETSCHEMA_TLS_', '# NETSCHEMA_TLS_' |
        Set-Content $envFile -Encoding UTF8
    Write-Warn "Fichier de configuration créé : $envFile (HTTPS à activer, voir les commentaires)."
}

Copy-Item (Join-Path $PSScriptRoot 'Start-NetSchema.ps1') $InstallDir -Force

# ── 4. Droits ─────────────────────────────────────────────────────────────────
Write-Step 'Droits sur le dossier de données'
# Le service écrit dans les données ; personne d'autre n'a besoin d'y toucher.
& icacls $DataDir /inheritance:r /grant:r "$ServiceAccount:(OI)(CI)M" 'BUILTIN\Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' | Out-Null
& icacls $InstallDir /grant:r "$ServiceAccount:(OI)(CI)RX" | Out-Null

# ── 5. Service ────────────────────────────────────────────────────────────────
if (-not $NssmPath) {
    $candidate = Join-Path $PSScriptRoot 'nssm.exe'
    if (Test-Path $candidate) { $NssmPath = $candidate }
}

$starter = Join-Path $InstallDir 'Start-NetSchema.ps1'

if ($NssmPath -and (Test-Path $NssmPath)) {
    Write-Step "Déclaration du service via NSSM ($ServiceName)"
    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
        & $NssmPath stop $ServiceName confirm | Out-Null
        & $NssmPath remove $ServiceName confirm | Out-Null
    }
    & $NssmPath install $ServiceName $node.Source (Join-Path $InstallDir 'dist\index.js') | Out-Null
    & $NssmPath set $ServiceName AppDirectory $InstallDir | Out-Null
    & $NssmPath set $ServiceName DisplayName 'NetSchema — schémas d''infrastructure' | Out-Null
    & $NssmPath set $ServiceName Description 'Serveur NetSchema : interface web et API authentifiée.' | Out-Null
    & $NssmPath set $ServiceName Start SERVICE_AUTO_START | Out-Null
    & $NssmPath set $ServiceName AppStdout (Join-Path $DataDir 'service.log') | Out-Null
    & $NssmPath set $ServiceName AppStderr (Join-Path $DataDir 'service.log') | Out-Null
    & $NssmPath set $ServiceName AppRotateFiles 1 | Out-Null
    & $NssmPath set $ServiceName AppRotateBytes 10485760 | Out-Null
    # Les variables du fichier .env sont passées au service.
    $pairs = Get-Content $envFile | Where-Object { $_ -match '^[A-Z]' } | ForEach-Object { $_.Trim() }
    if ($pairs) { & $NssmPath set $ServiceName AppEnvironmentExtra $pairs | Out-Null }
    & $NssmPath start $ServiceName | Out-Null
    Write-Host "    Service $ServiceName démarré." -ForegroundColor Green
} else {
    Write-Step "NSSM absent : installation en tâche planifiée au démarrage ($ServiceName)"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$starter`"" `
        -WorkingDirectory $InstallDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Settings $settings `
        -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
    Start-ScheduledTask -TaskName $ServiceName
    Write-Warn 'Pour un redémarrage automatique en cas de plantage, préférez NSSM (-NssmPath).'
}

# ── 6. Pare-feu ───────────────────────────────────────────────────────────────
Write-Step "Ouverture du port $Port dans le pare-feu"
$ruleName = "NetSchema ($Port/TCP)"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort $Port -Profile Domain, Private | Out-Null

# ── 7. Premier compte ─────────────────────────────────────────────────────────
$usersFile = Join-Path $DataDir 'users.json'
if (-not (Test-Path $usersFile)) {
    Write-Host ''
    Write-Host 'Dernière étape : créer le premier administrateur' -ForegroundColor Green
    Write-Host "  cd $InstallDir"
    Write-Host "  `$env:NETSCHEMA_DATA_DIR='$DataDir'; node tools\netschema-user.mjs add <identifiant> --role admin"
}

Write-Host ''
Write-Host "NetSchema est installé : https://$env:COMPUTERNAME`:$Port" -ForegroundColor Green
Write-Host "  Données     : $DataDir  (à sauvegarder)"
Write-Host "  Journal     : $DataDir\audit.log"
Write-Host "  Configuration : $envFile"
