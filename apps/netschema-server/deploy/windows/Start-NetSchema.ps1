<#
.SYNOPSIS
    Démarre le serveur NetSchema en chargeant netschema.env.

.DESCRIPTION
    Utilisé par la tâche planifiée (et pratique pour un démarrage manuel de contrôle) : lit
    le fichier de configuration à côté du script, pose les variables d'environnement, puis
    lance le serveur. Aucune valeur sensible n'est écrite dans la ligne de commande — elle
    serait visible de tout le monde dans le gestionnaire des tâches.
#>

[CmdletBinding()]
param(
    [string]$InstallDir = $PSScriptRoot,
    [string]$EnvFile
)

$ErrorActionPreference = 'Stop'
if (-not $EnvFile) { $EnvFile = Join-Path $InstallDir 'netschema.env' }

if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $index = $trimmed.IndexOf('=')
        if ($index -lt 1) { continue }
        $name = $trimmed.Substring(0, $index).Trim()
        $value = $trimmed.Substring($index + 1).Trim()
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
} else {
    Write-Warning "Fichier de configuration introuvable : $EnvFile (valeurs par défaut utilisées)."
}

Set-Location $InstallDir
& node (Join-Path $InstallDir 'dist\index.js')
