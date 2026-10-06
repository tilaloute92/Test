<#
.SYNOPSIS
    Déplace le service de « Suivi Infra & Réseau » sur un autre port local.

.DESCRIPTION
    À utiliser quand le port du service est pris par une autre application installée sur le
    même serveur — symptôme : « Serveur indisponible » dans le navigateur, et le journal du
    service annonce que le port est occupé.

    Le port figure à DEUX endroits qui doivent toujours s'accorder :

      1. PORT=… dans le .env du service, où Node écoute ;
      2. la règle de réécriture « Suivi Infra - API » du site IIS, vers où IIS relaie.

    Les changer à la main revient presque toujours à n'en changer qu'un : le service démarre
    alors parfaitement, la règle existe toujours, et pourtant plus rien ne fonctionne — IIS
    relaie vers un port où personne n'écoute. Ce script change les deux, dans cet ordre, et
    vérifie que la chaîne complète répond avant de se déclarer satisfait.

    Il ne touche ni aux données d'équipe, ni aux comptes, ni aux liaisons du site.

.PARAMETER NewPort
    Nouveau port local. Il n'est jamais exposé au réseau : seul IIS le joint, sur 127.0.0.1.

.PARAMETER ServicePath
    Dossier du service. Déduit du service installé s'il n'est pas précisé.

.PARAMETER SiteName
    Nom du site IIS portant la règle de relais. Défaut : SuiviInfra.

.PARAMETER Force
    Change le port même s'il est déjà occupé. À n'utiliser que si vous savez que le
    programme en question va libérer le port.

.EXAMPLE
    .\Set-SuiviInfraPort.ps1 -NewPort 4010

.EXAMPLE
    .\Set-SuiviInfraPort.ps1 -NewPort 4010 -SiteName "Suivi Infra"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(1024, 65535)][int] $NewPort,
    [string] $ServicePath,
    [string] $SiteName = 'SuiviInfra',
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ServiceName = 'SuiviInfraAuth'

function Write-Titre($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Write-Ok($t)    { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Write-Ko($t)    { Write-Host "  [ECHEC] $t" -ForegroundColor Red }
function Write-Alerte($t){ Write-Host "  [ALERTE] $t" -ForegroundColor Yellow }
function Write-Info($t)  { Write-Host "          $t" -ForegroundColor Gray }

[System.Net.WebRequest]::DefaultWebProxy = $null

Write-Host ''
Write-Host "Deplacement du service sur le port $NewPort" -ForegroundColor White

# --- Élévation ---------------------------------------------------------------------------
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Ko 'Console non élevée : la configuration IIS et le dossier du service sont réservés aux administrateurs.'
    Write-Info 'Rouvrez PowerShell par clic droit -> « Exécuter en tant qu''administrateur ».'
    exit 1
}

# --- Localisation du service ---------------------------------------------------------------
Write-Titre 'Service'
$svc   = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$tache = Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
if (-not $ServicePath) {
    if ($tache) {
        $action = @($tache.Actions)[0]
        if ($action.PSObject.Properties['WorkingDirectory'] -and $action.WorkingDirectory) {
            $ServicePath = [string]$action.WorkingDirectory
        } elseif ($action.PSObject.Properties['Execute'] -and $action.Execute) {
            $ServicePath = Split-Path -Parent ([string]$action.Execute)
        }
    }
    if (-not $ServicePath) { $ServicePath = 'C:\services\suivi-infra' }
}
$envFile = Join-Path $ServicePath '.env'
if (-not (Test-Path $envFile)) {
    Write-Ko "Fichier $envFile introuvable. Précisez -ServicePath."
    exit 1
}
Write-Ok "Service : $ServicePath"

$ancien = 4000
$ligneExistante = Get-Content $envFile | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -Last 1
if ($ligneExistante -and ($ligneExistante -split '=', 2)[1].Trim() -match '^\d+$') {
    $ancien = [int](($ligneExistante -split '=', 2)[1].Trim())
}
Write-Ok "Port actuel : $ancien"
if ($ancien -eq $NewPort) {
    Write-Alerte "Le service est déjà configuré sur $NewPort. La règle IIS sera tout de même vérifiée."
}

# --- Le nouveau port est-il libre ? --------------------------------------------------------
Write-Titre 'Disponibilite du port'
$occupants = @()
try {
    $occupants = @(Get-NetTCPConnection -State Listen -LocalPort $NewPort -ErrorAction SilentlyContinue |
        ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue } |
        Sort-Object Id -Unique)
} catch { }
# Notre propre service déjà sur ce port n'est pas un obstacle : il va être redémarré.
$etrangers = @($occupants | Where-Object {
    try { -not ($_.Path -and $_.Path.StartsWith($ServicePath, 'OrdinalIgnoreCase')) } catch { $true }
})
if ($etrangers.Count -gt 0) {
    foreach ($p in $etrangers) {
        $chemin = try { $p.Path } catch { '(chemin non lisible)' }
        Write-Ko "Port $NewPort déjà pris : PID $($p.Id) · $($p.ProcessName) · $chemin"
    }
    if (-not $Force) {
        Write-Info 'Choisissez un autre port, ou -Force si ce programme va libérer celui-ci.'
        exit 1
    }
    Write-Alerte '-Force : on continue malgré tout.'
} else {
    Write-Ok "Port $NewPort libre"
}

# --- 1. Le service -------------------------------------------------------------------------
Write-Titre 'Arret du service'
if ($svc -and $svc.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force; Write-Ok 'Service Windows arrêté' }
elseif ($tache -and $tache.State -eq 'Running') { Stop-ScheduledTask -TaskName $ServiceName; Write-Ok 'Tâche planifiée arrêtée' }
else { Write-Info 'Déjà arrêté.' }
for ($i = 0; $i -lt 10; $i++) {
    $restants = @(Get-Process -Name 'node' -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and $_.Path.StartsWith($ServicePath, 'OrdinalIgnoreCase') } catch { $false }
    })
    if ($restants.Count -eq 0) { break }
    Start-Sleep -Seconds 1
}

Write-Titre 'Ecriture du port dans .env'
# Le .env porte aussi le secret de session : on réécrit la seule ligne PORT, ligne à ligne,
# plutôt que de régénérer le fichier — une régénération perdrait tout le reste.
$lignes = @(Get-Content $envFile)
if ($lignes | Where-Object { $_ -match '^\s*PORT\s*=' }) {
    $lignes = $lignes | ForEach-Object { if ($_ -match '^\s*PORT\s*=') { "PORT=$NewPort" } else { $_ } }
} else {
    $lignes += "PORT=$NewPort"
}
Set-Content -Path $envFile -Value $lignes -Encoding UTF8
Write-Ok "PORT=$NewPort"

# --- 2. La règle de relais IIS ---------------------------------------------------------------
Write-Titre 'Regle de relais IIS'
$iisOk = $false
try {
    Import-Module WebAdministration -ErrorAction Stop
    $iisOk = $true
} catch {
    try { Import-Module WebAdministration -UseWindowsPowerShell -ErrorAction Stop; $iisOk = $true } catch { }
}
if (-not $iisOk) {
    Write-Ko "Module WebAdministration indisponible : la règle IIS n'a PAS été changée."
    Write-Info "Le service écoute maintenant sur $NewPort et IIS relaie toujours vers $ancien : l'application restera"
    Write-Info 'indisponible tant que la règle ne sera pas corrigée. Installez Web-Scripting-Tools :'
    Write-Info '    Install-WindowsFeature Web-Scripting-Tools'
    Write-Info '  puis relancez ce script.'
    exit 1
}

$ruleFilter = "system.webServer/rewrite/rules/rule[@name='Suivi Infra - API']"
if (-not (Test-Path "IIS:\Sites\$SiteName")) {
    Write-Ko "Site IIS « $SiteName » introuvable. Précisez -SiteName."
    Write-Info "Sites présents : $((Get-ChildItem 'IIS:\Sites' | ForEach-Object Name) -join ', ')"
    exit 1
}
try {
    Set-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" -Filter "$ruleFilter/action" `
        -Name 'url' -Value "http://127.0.0.1:$NewPort/api/{R:1}"
    Write-Ok "/api/* -> http://127.0.0.1:$NewPort/api/*"
} catch {
    Write-Ko "Règle « Suivi Infra - API » introuvable sur le site « $SiteName » : $($_.Exception.Message)"
    Write-Info 'Relancez Install-SuiviInfra.ps1 avec les mêmes options pour la recréer.'
    exit 1
}

# --- 3. Redémarrage et vérification de la chaîne complète -------------------------------------
Write-Titre 'Redemarrage et verification'
if ($svc)       { Start-Service -Name $ServiceName; Write-Ok 'Service Windows redémarré' }
elseif ($tache) { Start-ScheduledTask -TaskName $ServiceName; Write-Ok 'Tâche planifiée relancée' }
else            { Write-Alerte 'Aucun service à redémarrer : démarrez-le vous-même.' }

$sain = $false
for ($i = 0; $i -lt 20 -and -not $sain; $i++) {
    Start-Sleep -Seconds 1
    try {
        if ((Invoke-WebRequest -Uri "http://127.0.0.1:$NewPort/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $sain = $true }
    } catch { }
}

Write-Host ''
if ($sain) {
    Write-Ok "Le service répond sur le port $NewPort"
    Write-Info "Vérifiez la chaîne complète depuis IIS : .\Test-SuiviInfra.ps1 -HostName <nom> -WithService -ServicePort $NewPort"
    Write-Host 'Pensez à passer -ServicePort à vos prochaines exécutions des scripts, sans quoi ils' -ForegroundColor Gray
    Write-Host "contrôleront le port 4000 et annonceront un échec qui n'en est pas un." -ForegroundColor Gray
} else {
    Write-Ko "Le service ne répond toujours pas sur $NewPort après 20 s"
    Write-Info "Journal : $(Join-Path $ServicePath 'logs\service.log') — ses dernières lignes disent pourquoi."
    Write-Info "Pour revenir en arrière : .\Set-SuiviInfraPort.ps1 -NewPort $ancien"
}
Write-Host ''
