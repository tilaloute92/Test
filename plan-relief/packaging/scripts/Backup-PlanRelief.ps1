<#
.SYNOPSIS
    Sauvegarde les données de "Plan Relief" : plans, équipements, comptes.

.DESCRIPTION
    Le dossier data\ du service contient la SEULE copie de la bibliothèque de plans :
    fichiers d'origine (DXF/PDF), équipements extraits et ajoutés à la main, réglages 3D,
    corbeille, plus les comptes locaux et la configuration LDAP. Rien ne le sauvegarde
    automatiquement.

    Même conception que la sauvegarde de Suivi Infra & Réseau, pour tourner sans
    surveillance en tâche planifiée :

    1. COHÉRENCE de l'instantané. Le service relève un compteur de version (meta.json) à
       chaque écriture. Il est lu avant et après la copie : s'il a bougé, la copie est
       refaite, pour ne jamais sauvegarder un plan à moitié importé.

    2. VÉRIFICATION de ce qui vient d'être écrit. Chaque fichier JSON copié est relu, et
       chaque plan doit avoir sa fiche (plan.json) ET son fichier d'origine (source.dxf ou
       source.pdf) : le service refuse justement de démarrer sur un fichier illisible.

    3. ROTATION seulement après une sauvegarde réussie, pour ne jamais se retrouver sans
       aucune copie valide.

    Le script ne modifie jamais les données de production : il ne fait que lire.

.PARAMETER Destination
    Dossier racine des sauvegardes (local ou UNC). Un sous-dossier horodaté y est créé.

.PARAMETER ServicePath
    Dossier d'installation du service. Par défaut C:\services\plan-relief.

.PARAMETER RetentionDays
    Nombre de jours de sauvegardes à conserver. 0 = ne rien supprimer. Par défaut 30.

.PARAMETER IncludeEnv
    Sauvegarde aussi le fichier .env (secret de session, configuration SSO). Ne l'activez
    que si la destination est aussi protégée que le serveur lui-même.

.PARAMETER LogPath
    Fichier journal. Par défaut <Destination>\sauvegarde.log.

.EXAMPLE
    .\Backup-PlanRelief.ps1 -Destination \\serveur-sauvegarde\plan-relief

.NOTES
    Code de sortie 0 = succès, 1 = échec, lu par le Planificateur de tâches.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Destination,
    [string] $ServicePath = 'C:\services\plan-relief',
    [int]    $RetentionDays = 30,
    [switch] $IncludeEnv,
    [string] $LogPath
)

$ErrorActionPreference = 'Stop'

if (-not $LogPath) { $LogPath = Join-Path $Destination 'sauvegarde.log' }

function Write-Log {
    param([string] $Message, [string] $Level = 'INFO')
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    try { Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8 } catch { }
}

function Get-DataVersion {
    param([string] $MetaFile)
    # -1 tant qu'aucun plan n'a jamais été écrit : valeur stable, pas de fausse alerte.
    if (-not (Test-Path -LiteralPath $MetaFile)) { return -1 }
    try { return (Get-Content -LiteralPath $MetaFile -Raw | ConvertFrom-Json).version } catch { return -1 }
}

try {
    $dataDir = Join-Path $ServicePath 'data'
    $metaFile = Join-Path $dataDir 'meta.json'
    if (-not (Test-Path -LiteralPath $dataDir)) { throw "Dossier de données introuvable : $dataDir. Vérifiez -ServicePath." }
    if (-not (Test-Path -LiteralPath $Destination)) { New-Item -ItemType Directory -Path $Destination -Force | Out-Null }
    Write-Log "Sauvegarde depuis $dataDir vers $Destination"

    $stamp  = Get-Date -Format 'yyyy-MM-dd_HHmm'
    $target = Join-Path $Destination $stamp

    # --- Copie cohérente : jusqu'à 3 tentatives si l'équipe écrit pendant la copie -------
    $copied = $false
    for ($attempt = 1; $attempt -le 3 -and -not $copied; $attempt++) {
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        $before = Get-DataVersion $metaFile

        $files = @(Get-ChildItem -LiteralPath $dataDir -Recurse -File | Where-Object { $_.Extension -ne '.tmp' })
        if ($files.Count -eq 0) { throw "Aucun fichier dans $dataDir : le service a-t-il déjà démarré ?" }
        foreach ($f in $files) {
            $rel = $f.FullName.Substring($dataDir.Length).TrimStart('\')
            $dest = Join-Path $target $rel
            New-Item -ItemType Directory -Path (Split-Path $dest -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        }

        $after = Get-DataVersion $metaFile
        if ($before -eq $after) { $copied = $true }
        else {
            Write-Log "Données modifiées pendant la copie (version $before -> $after), nouvelle tentative $attempt/3." 'AVERT'
            Start-Sleep -Seconds 5
        }
    }
    if (-not $copied) {
        throw "Impossible d'obtenir une copie cohérente après 3 tentatives (activité continue). Décalez l'horaire de la tâche vers une heure creuse."
    }

    # --- Vérification : une sauvegarde illisible ne vaut rien ---------------------------
    $checked = 0
    foreach ($f in Get-ChildItem -LiteralPath $target -Filter '*.json' -File -Recurse) {
        try { Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json | Out-Null; $checked++ }
        catch { throw "Fichier sauvegardé illisible : $($f.FullName.Substring($target.Length)) ($($_.Exception.Message))." }
    }
    $plans = 0
    $plansDir = Join-Path $target 'plans'
    if (Test-Path -LiteralPath $plansDir) {
        foreach ($d in Get-ChildItem -LiteralPath $plansDir -Directory) {
            if (-not (Test-Path (Join-Path $d.FullName 'plan.json'))) { continue }  # import interrompu : ignoré aussi par le service
            if (-not (Get-ChildItem -LiteralPath $d.FullName -Filter 'source.*' -File)) {
                throw "Le plan $($d.Name) n'a pas de fichier d'origine dans la sauvegarde."
            }
            $plans++
        }
    }
    $size = (Get-ChildItem -LiteralPath $target -Recurse -File | Measure-Object Length -Sum).Sum
    Write-Log ("{0} plan(s), {1} fichier(s) JSON relus sans erreur, {2:N1} Mo (version des données : {3})." -f $plans, $checked, ($size / 1MB), (Get-DataVersion $metaFile))

    if ($IncludeEnv) {
        $envFile = Join-Path $ServicePath '.env'
        if (Test-Path -LiteralPath $envFile) {
            Copy-Item -LiteralPath $envFile -Destination (Join-Path $target 'env.sauvegarde') -Force
            Write-Log "Fichier .env inclus — il contient le secret de session : la destination doit être protégée en conséquence." 'AVERT'
        } else {
            Write-Log "Fichier .env introuvable dans $ServicePath — ignoré." 'AVERT'
        }
    }

    # --- Note de restauration, déposée dans chaque sauvegarde ---------------------------
    $note = @"
Sauvegarde "Plan Relief" — $stamp
Source : $dataDir (serveur $(if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'inconnu' }))
Contenu : $plans plan(s) avec leurs fichiers d'origine, comptes locaux, configuration LDAP.

POUR RESTAURER TOUTE LA BIBLIOTHÈQUE
1. Arrêter le service :        Stop-Service PlanReliefSvc
2. Mettre de côté l'existant : Rename-Item "$dataDir" "data_avant_restauration"
3. Copier CE dossier (sauf RESTAURATION.txt et env.sauvegarde) vers "$dataDir"
4. Redémarrer le service :     Start-Service PlanReliefSvc
5. Vérifier :                  .\Test-PlanRelief.ps1 -HostName <nom>

POUR RÉCUPÉRER UN SEUL PLAN
Copier le dossier plans\<identifiant> de cette sauvegarde dans "$dataDir\plans\",
puis redémarrer le service. (Un plan retiré du stock depuis l'application se trouve aussi
dans "$dataDir\corbeille\" : même manipulation, en retirant le suffixe _date du nom.)

Si "env.sauvegarde" est présent, c'est le fichier .env du serveur (secret de session,
configuration SSO) : à remettre sous le nom ".env" à la racine du service.
"@
    Set-Content -LiteralPath (Join-Path $target 'RESTAURATION.txt') -Value $note -Encoding UTF8

    # --- Rotation : seulement maintenant que la sauvegarde est valide -------------------
    if ($RetentionDays -gt 0) {
        $limit = (Get-Date).AddDays(-$RetentionDays)
        # Âge déduit du NOM du dossier, pas de sa date de création (remise à zéro si
        # l'arborescence de sauvegardes est un jour déplacée).
        $old = @(Get-ChildItem -LiteralPath $Destination -Directory | Where-Object {
            if ($_.Name -notmatch '^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$') { return $false }
            $when = Get-Date -Year $Matches[1] -Month $Matches[2] -Day $Matches[3] -Hour $Matches[4] -Minute $Matches[5] -Second 0
            $when -lt $limit
        })
        foreach ($d in $old) {
            Remove-Item -LiteralPath $d.FullName -Recurse -Force
            Write-Log "Ancienne sauvegarde supprimée : $($d.Name)"
        }
        if ($old.Count -eq 0) { Write-Log "Rotation : rien à supprimer (rétention $RetentionDays jours)." }
    }

    Write-Log "Sauvegarde terminée : $target"
    exit 0
} catch {
    Write-Log $_.Exception.Message 'ERREUR'
    Write-Log "SAUVEGARDE EN ÉCHEC — la bibliothèque de plans n'est pas protégée pour aujourd'hui." 'ERREUR'
    exit 1
}
