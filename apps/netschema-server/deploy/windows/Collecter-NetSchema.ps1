<#
    .SYNOPSIS
    Recollecte la topologie SNMP et la repose sur un schéma existant.

    .DESCRIPTION
    Relance le collecteur NetSchema, compare le relevé au schéma en place, et n'applique la
    fusion que si rien n'a disparu. C'est toute l'idée : un ajout de switch peut s'appliquer
    à trois heures du matin, une disparition non.

    Une disparition est presque toujours une communauté SNMP expirée, une maintenance ou un
    pare-feu qui bloque le 161 — pas un parc démonté. Appliquer dans ce cas détruirait un
    travail sur une supposition. Le rapport est donc écrit dans le journal et la fusion
    attend un œil humain.

    Le collecteur rend un code de sortie qui dit quoi faire, sans qu'on ait à relire son
    texte : 0 aucun écart, 3 des écarts sans disparition, 4 une disparition.

    .PARAMETER Captures
    Dossier des relevés snmpwalk : un sous-dossier par équipement.

    .PARAMETER Schema
    Schéma NetSchema à tenir à jour. Il est sauvegardé avant toute écriture.

    .PARAMETER Journal
    Fichier où sont écrits les rapports successifs.

    .PARAMETER Planifier
    Installe la tâche quotidienne au lieu de collecter tout de suite.

    .PARAMETER Heure
    Heure de la tâche planifiée, au format HH:mm.

    .PARAMETER AppliquerLesDisparitions
    Applique la fusion même quand des équipements ont disparu du relevé. À ne passer qu'après
    avoir lu le journal et compris pourquoi.

    .EXAMPLE
    .\Collecter-NetSchema.ps1 -Captures C:\NetSchema\captures -Schema C:\NetSchema\site.json

    .EXAMPLE
    .\Collecter-NetSchema.ps1 -Captures C:\NetSchema\captures -Schema C:\NetSchema\site.json -Planifier
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Captures,
    [Parameter(Mandatory = $true)][string]$Schema,
    [string]$Collecteur = 'C:\Apps\NetSchema\collector\netschema-collect.mjs',
    [string]$Journal = 'C:\ProgramData\NetSchema\data\collecte.log',
    [switch]$Planifier,
    [string]$Heure = '02:40',
    [switch]$AppliquerLesDisparitions,
    [string]$NomTache = 'NetSchema - collecte SNMP'
)

$ErrorActionPreference = 'Stop'

function Ok([string]$t) { Write-Host "    $t" -ForegroundColor Green }
function Etape([string]$t) { Write-Host "  → $t" -ForegroundColor Cyan }
function Avert([string]$t) { Write-Host "    $t" -ForegroundColor Yellow }

function Journaliser([string]$texte) {
    $dossier = Split-Path -Parent $Journal
    if ($dossier -and -not (Test-Path $dossier)) { New-Item -ItemType Directory -Force -Path $dossier | Out-Null }
    Add-Content -Path $Journal -Value $texte -Encoding UTF8
}

if ($Planifier) {
    # La tâche rappelle ce script avec les mêmes paramètres, sans -Planifier : le même code
    # tourne à la main et toutes les nuits, donc rien qui diverge en silence.
    $script = $MyInvocation.MyCommand.Path
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`" " +
                 "-Captures `"$Captures`" -Schema `"$Schema`" " +
                 "-Collecteur `"$Collecteur`" -Journal `"$Journal`""
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
    $declencheur = New-ScheduledTaskTrigger -Daily -At $Heure
    $reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable `
        -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName $NomTache -Action $action -Trigger $declencheur `
        -Settings $reglages -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
    Ok "Tâche « $NomTache » créée : tous les jours à $Heure."
    Ok 'Lancez-la une fois à la main pour vérifier les chemins et la joignabilité :'
    Write-Host "      Start-ScheduledTask -TaskName '$NomTache'" -ForegroundColor Gray
    return
}

foreach ($chemin in @($Captures, $Schema, $Collecteur)) {
    if (-not (Test-Path $chemin)) { throw "Introuvable : $chemin" }
}
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js est introuvable dans le PATH : le collecteur ne peut pas tourner." }

$horodatage = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Etape "Collecte et comparaison avec $Schema"

# Premier passage : on regarde, on n'écrit rien.
$rapport = & node $Collecteur --walk $Captures --fusion $Schema --rapport 2>&1 | Out-String
$code = $LASTEXITCODE
Journaliser "===== $horodatage (code $code) =====`r`n$rapport"
Write-Host $rapport

switch ($code) {
    0 {
        Ok 'Aucun écart : le schéma correspond déjà au relevé.'
        return
    }
    3 { Ok 'Des écarts, aucune disparition : la fusion peut être appliquée.' }
    4 {
        if (-not $AppliquerLesDisparitions) {
            Avert 'Des équipements ou des liaisons ont disparu du relevé : rien n’a été appliqué.'
            Avert "Lisez $Journal, vérifiez la communauté SNMP et la joignabilité, puis"
            Avert 'relancez avec -AppliquerLesDisparitions si la disparition est réelle.'
            return
        }
        Avert 'Disparitions appliquées sur demande explicite.'
    }
    default {
        Avert "Le collecteur a rendu le code $code : rien n’a été appliqué."
        return
    }
}

# Copie avant écriture : la fusion est réversible tant qu'on garde la version d'avant.
$copie = "$Schema.$(Get-Date -Format 'yyyyMMdd-HHmmss').avant"
Copy-Item $Schema $copie -Force
Ok "Version précédente conservée : $copie"

& node $Collecteur --walk $Captures --fusion $Schema --out $Schema
if ($LASTEXITCODE -ne 0) {
    Avert "L'écriture a échoué (code $LASTEXITCODE) ; $copie contient la version d'avant."
    Journaliser "$horodatage : ÉCHEC de l'écriture (code $LASTEXITCODE)"
    exit 1
}
Ok "Schéma mis à jour : $Schema"
Journaliser "$horodatage : fusion appliquée"
