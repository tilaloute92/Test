<#
    .SYNOPSIS
    Sauvegarde le dossier de données de NetSchema.

    .DESCRIPTION
    Les données de NetSchema sont des fichiers : comptes, schémas, historique, journal.
    Une sauvegarde est donc une copie de dossier, et une restauration aussi — c'est tout
    l'intérêt d'avoir écarté une base de données.

    Ce script en fait une archive horodatée, garde les N plus récentes et jette le reste.
    L'historique interne protège de l'erreur humaine ; cette copie-ci protège du disque,
    du chiffrement par rançongiciel et de la machine. Ce sont deux risques différents, et
    l'un ne remplace pas l'autre : rangez la destination ailleurs que sur le serveur.

    Le service n'est pas arrêté : toutes les écritures passent par un fichier temporaire
    renommé, donc une copie prise en cours de route attrape soit l'ancien fichier, soit le
    nouveau, jamais un fichier à moitié écrit.

    .PARAMETER DataDir
    Dossier de données à sauvegarder.

    .PARAMETER Destination
    Où déposer les archives. Un chemin UNC (\\serveur\partage\netschema) est recommandé :
    une sauvegarde sur le même disque ne sert à rien le jour où c'est le disque qui lâche.

    .PARAMETER Garder
    Nombre d'archives conservées. Les plus anciennes sont supprimées au-delà.

    .PARAMETER Planifier
    Crée la tâche planifiée quotidienne au lieu de sauvegarder tout de suite.

    .PARAMETER Heure
    Heure de la tâche planifiée, au format HH:mm.

    .EXAMPLE
    .\Sauvegarder-NetSchema.ps1 -Destination \\nas\sauvegardes\netschema -Planifier

    .EXAMPLE
    .\Sauvegarder-NetSchema.ps1 -Destination D:\Sauvegardes\NetSchema
#>
[CmdletBinding()]
param(
    [string]$DataDir = 'C:\ProgramData\NetSchema\data',
    [Parameter(Mandatory = $true)][string]$Destination,
    [int]$Garder = 14,
    [switch]$Planifier,
    [string]$Heure = '21:40',
    [string]$NomTache = 'NetSchema - sauvegarde'
)

$ErrorActionPreference = 'Stop'

function Ok([string]$t) { Write-Host "    $t" -ForegroundColor Green }
function Etape([string]$t) { Write-Host "  → $t" -ForegroundColor Cyan }
function Avert([string]$t) { Write-Host "    $t" -ForegroundColor Yellow }

if ($Planifier) {
    # La tâche rappelle ce script avec les mêmes paramètres, sans -Planifier : c'est le
    # même code qui tourne à la main et tous les soirs, donc rien qui diverge en silence.
    $script = $MyInvocation.MyCommand.Path
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" " +
                 "-DataDir `"$DataDir`" -Destination `"$Destination`" -Garder $Garder"
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
    $declencheur = New-ScheduledTaskTrigger -Daily -At $Heure
    $reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable `
        -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName $NomTache -Action $action -Trigger $declencheur `
        -Settings $reglages -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
    Ok "Tâche « $NomTache » créée : tous les jours à $Heure, vers $Destination."
    Ok 'Lancez-la une fois à la main pour vérifier que la destination est accessible :'
    Write-Host "      Start-ScheduledTask -TaskName '$NomTache'" -ForegroundColor Gray
    return
}

if (-not (Test-Path $DataDir)) { throw "Dossier de données introuvable : $DataDir" }

Etape "Sauvegarde de $DataDir"
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$horodatage = Get-Date -Format 'yyyyMMdd-HHmmss'
$archive = Join-Path $Destination "netschema-$horodatage.zip"

# Copie intermédiaire : Compress-Archive échoue sur un fichier ouvert par le service, ce
# qui arrive sur le journal. On copie d'abord, on compresse ensuite.
$provisoire = Join-Path $env:TEMP "netschema-sauvegarde-$horodatage"
try {
    Copy-Item $DataDir $provisoire -Recurse -Force -ErrorAction Stop
    Compress-Archive -Path (Join-Path $provisoire '*') -DestinationPath $archive -Force
} finally {
    if (Test-Path $provisoire) { Remove-Item $provisoire -Recurse -Force -ErrorAction SilentlyContinue }
}

$taille = [math]::Round((Get-Item $archive).Length / 1MB, 1)
Ok "Archive créée : $archive ($taille Mo)"

# Élagage : on ne garde que les N plus récentes, sinon la destination se remplit seule.
$anciennes = Get-ChildItem $Destination -Filter 'netschema-*.zip' |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip $Garder
foreach ($vieille in $anciennes) {
    Remove-Item $vieille.FullName -Force -ErrorAction SilentlyContinue
}
if ($anciennes) { Ok "$($anciennes.Count) archive(s) ancienne(s) supprimée(s), $Garder gardée(s)." }

# Contrôle : une archive qu'on ne sait pas relire ne sauvegarde rien. On vérifie qu'elle
# s'ouvre et qu'elle contient bien les comptes — c'est le fichier sans lequel une
# restauration ne sert à rien.
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    $noms = $zip.Entries | ForEach-Object { $_.FullName }
    $zip.Dispose()
    if ($noms -contains 'users.json') {
        Ok "Archive relue : $($noms.Count) fichier(s), comptes inclus."
    } else {
        Avert "Archive relue, mais users.json est absent — vérifiez $DataDir."
    }
} catch {
    Avert "L'archive n'a pas pu être relue : $($_.Exception.Message)"
}
