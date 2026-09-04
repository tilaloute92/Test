<#
.SYNOPSIS
    Désinstalle "Suivi Infra & Réseau" d'un serveur Windows Server 2022.

.DESCRIPTION
    Retire le site IIS, la règle de pare-feu, et (si présent) le service Windows.

    Les DONNÉES sont conservées par défaut : le dossier service\data contient les
    comptes locaux et, en mode multi-utilisateur, le travail de toute l'équipe
    (tâches, planning, temps saisi, absences, FDR, COPIL). Il faut passer
    -RemoveData explicitement pour les supprimer, et le script demande alors une
    confirmation en toutes lettres.

.PARAMETER RemoveData
    Supprime aussi les données du service. Irréversible : sauvegardez d'abord.

.EXAMPLE
    .\Uninstall-SuiviInfra.ps1

.EXAMPLE
    .\Uninstall-SuiviInfra.ps1 -RemoveData
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string] $SiteName = 'Suivi Infra & Reseau',
    [string] $SitePath = 'C:\inetpub\suivi-infra',
    [string] $ServicePath = 'C:\services\suivi-infra',
    [string] $NssmPath,
    [switch] $RemoveData
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ServiceName = 'SuiviInfraAuth'

function Write-Step { param([string] $m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param([string] $m) Write-Host "    [OK] $m" -ForegroundColor Green }
function Write-Warn { param([string] $m) Write-Host "    [!]  $m" -ForegroundColor Yellow }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script doit être lancé depuis une console PowerShell *Administrateur*."
}

Write-Step 'Site IIS'
Import-Module WebAdministration -ErrorAction Stop
if (Test-Path "IIS:\Sites\$SiteName") {
    Remove-Website -Name $SiteName
    Write-Ok "Site « $SiteName » supprimé"
} else {
    Write-Warn 'Site introuvable (déjà supprimé ?)'
}

if (Test-Path $SitePath) {
    Remove-Item $SitePath -Recurse -Force
    Write-Ok "Fichiers du site supprimés ($SitePath)"
}

Write-Step 'Pare-feu'
$rule = Get-NetFirewallRule -DisplayName 'Suivi Infra - HTTPS' -ErrorAction SilentlyContinue
if ($rule) { $rule | Remove-NetFirewallRule; Write-Ok 'Règle 443/TCP supprimée' }
else { Write-Warn 'Règle absente' }

Write-Step 'Service Windows'
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    if (-not $NssmPath) {
        $c = Get-Command nssm.exe -ErrorAction SilentlyContinue
        if ($c) { $NssmPath = $c.Source }
    }
    if ($NssmPath -and (Test-Path $NssmPath)) {
        & $NssmPath stop $ServiceName confirm | Out-Null
        & $NssmPath remove $ServiceName confirm | Out-Null
        Write-Ok "Service $ServiceName supprimé"
    } else {
        Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
        sc.exe delete $ServiceName | Out-Null
        Write-Ok "Service $ServiceName supprimé (via sc.exe — nssm.exe introuvable)"
    }
} else {
    Write-Warn 'Service absent'
}

Write-Step 'Données du service'
$dataPath = Join-Path $ServicePath 'data'
if (-not (Test-Path $ServicePath)) {
    Write-Warn 'Aucun dossier de service à traiter'
} elseif ($RemoveData) {
    # Suppression irréversible du travail de l'équipe : on exige une confirmation
    # explicite tapée à la main, pas un simple -Force hérité d'un autre paramètre.
    Write-Host ""
    Write-Host "    ATTENTION : $dataPath contient les comptes locaux et, en mode" -ForegroundColor Red
    Write-Host "    multi-utilisateur, les données de toute l'équipe (tâches, planning," -ForegroundColor Red
    Write-Host "    temps saisi, absences, FDR, COPIL). Cette suppression est définitive." -ForegroundColor Red
    Write-Host ""
    $answer = Read-Host "    Tapez SUPPRIMER pour confirmer (toute autre saisie annule)"
    if ($answer -ceq 'SUPPRIMER') {
        Remove-Item $ServicePath -Recurse -Force
        Write-Ok 'Service et données supprimés'
    } else {
        Write-Warn "Suppression annulée — $ServicePath est conservé intact."
    }
} else {
    # On retire les fichiers programme mais on garde data\ et .env : une réinstallation
    # ultérieure repart alors des mêmes comptes et des mêmes données.
    foreach ($item in @('src', 'scripts', 'node_modules', 'package.json')) {
        $p = Join-Path $ServicePath $item
        if (Test-Path $p) { Remove-Item $p -Recurse -Force }
    }
    Write-Ok "Programme retiré — données conservées dans $dataPath"
    Write-Warn "Pour tout supprimer, relancez avec -RemoveData (après sauvegarde)."
}

Write-Step 'Désinstallation terminée'
Write-Host "    Les modules IIS (URL Rewrite, ARR), Node.js et NSSM n'ont pas été touchés :"
Write-Host "    ils peuvent servir à d'autres applications. Retirez-les à la main si besoin."
Write-Host ""
