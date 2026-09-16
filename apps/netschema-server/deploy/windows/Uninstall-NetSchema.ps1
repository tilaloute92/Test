<#
.SYNOPSIS
    Retire le service NetSchema.

.DESCRIPTION
    Arrête et supprime le service (NSSM ou tâche planifiée), retire la règle de pare-feu et,
    si on le demande explicitement, le dossier d'installation. Le dossier de données n'est
    jamais supprimé : il contient les schémas et les comptes.

.EXAMPLE
    .\Uninstall-NetSchema.ps1
    .\Uninstall-NetSchema.ps1 -RemoveFiles -InstallDir C:\Apps\NetSchema
#>

[CmdletBinding()]
param(
    [string]$ServiceName = 'NetSchema',
    [string]$InstallDir = 'C:\Apps\NetSchema',
    [int]$Port = 8443,
    [string]$NssmPath,
    [switch]$RemoveFiles
)

$ErrorActionPreference = 'Continue'

if (-not $NssmPath) {
    $candidate = Join-Path $PSScriptRoot 'nssm.exe'
    if (Test-Path $candidate) { $NssmPath = $candidate }
}

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Arrêt du service $ServiceName…"
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    if ($NssmPath -and (Test-Path $NssmPath)) {
        & $NssmPath remove $ServiceName confirm | Out-Null
    } else {
        & sc.exe delete $ServiceName | Out-Null
    }
}

if (Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Suppression de la tâche planifiée $ServiceName…"
    Stop-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false
}

Get-NetFirewallRule -DisplayName "NetSchema ($Port/TCP)" -ErrorAction SilentlyContinue | Remove-NetFirewallRule

if ($RemoveFiles -and (Test-Path $InstallDir)) {
    Write-Host "Suppression de $InstallDir…"
    Remove-Item $InstallDir -Recurse -Force
}

Write-Host 'Terminé. Le dossier de données (schémas, comptes, journal) a été conservé.' -ForegroundColor Green
