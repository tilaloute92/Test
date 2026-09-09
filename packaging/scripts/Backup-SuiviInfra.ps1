<#
.SYNOPSIS
    Sauvegarde les données de "Suivi Infra & Réseau" (mode client/serveur).

.DESCRIPTION
    En mode client/serveur, le dossier data\ du service contient la SEULE copie du travail
    de toute l'équipe : tâches, planning, temps saisi, absences, feuille de route, COPIL,
    membres, plus les comptes locaux. Rien ne le sauvegarde automatiquement.

    Ce script est conçu pour tourner sans surveillance, en tâche planifiée. Il fait donc
    trois choses qu'une simple copie ne fait pas :

    1. Il vérifie la COHÉRENCE de l'instantané. Le service écrit fichier par fichier ; une
       copie lancée au mauvais moment peut attraper un fichier après son écriture et un
       autre avant. Le script relève le compteur de version (business-meta.json) avant et
       après la copie : s'il a bougé, la copie est refaite. Ce compteur est incrémenté à
       chaque modification, c'est donc un témoin fiable.

    2. Il VÉRIFIE ce qu'il vient d'écrire. Chaque fichier copié est relu et analysé. Un
       JSON invalide dans la sauvegarde est inutile : le service refuse justement de
       démarrer sur un fichier illisible. Mieux vaut un échec bruyant qu'une sauvegarde
       qu'on découvre inexploitable le jour où on en a besoin.

    3. Il ne fait la ROTATION qu'après une sauvegarde réussie. Une purge qui s'exécuterait
       après un échec supprimerait les bonnes sauvegardes en n'en laissant aucune valide.

    Le script ne modifie jamais les données de production : il ne fait que lire.

.PARAMETER Destination
    Dossier racine des sauvegardes. Un sous-dossier horodaté y est créé à chaque exécution.
    Peut être un chemin local (D:\sauvegardes\suivi-infra) ou UNC
    (\\serveur-sauvegarde\suivi-infra). Voir la note sur les comptes, plus bas.

.PARAMETER ServicePath
    Dossier d'installation du service. Par défaut C:\services\suivi-infra.

.PARAMETER RetentionDays
    Nombre de jours de sauvegardes à conserver. 0 = ne rien supprimer. Par défaut 30.

.PARAMETER IncludeEnv
    Sauvegarde aussi le fichier .env. Il contient le SECRET DE SESSION et la configuration
    LDAP : ne l'activez que si la destination est aussi protégée que le serveur lui-même.
    Sans lui, une restauration est possible malgré tout — il faut simplement regénérer un
    secret (tout le monde se reconnecte) et ressaisir la configuration LDAP.

.PARAMETER LogPath
    Fichier journal. Par défaut <Destination>\sauvegarde.log.

.EXAMPLE
    .\Backup-SuiviInfra.ps1 -Destination \\serveur-sauvegarde\suivi-infra

.EXAMPLE
    .\Backup-SuiviInfra.ps1 -Destination D:\sauvegardes\suivi-infra -RetentionDays 90

.NOTES
    Code de sortie 0 = succès, 1 = échec. C'est ce que lit le Planificateur de tâches :
    un échec y apparaît comme tel au lieu de passer inaperçu.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Destination,
    [string] $ServicePath = 'C:\services\suivi-infra',
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
    try {
        Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    } catch {
        # Journal inaccessible : ne pas faire échouer la sauvegarde pour autant, la sortie
        # console reste visible dans l'historique du Planificateur de tâches.
    }
}

function Get-DataVersion {
    param([string] $MetaFile)
    # Témoin de cohérence : ce compteur change à chaque écriture du service.
    # Absent tant que le serveur n'a jamais été mis en service — on renvoie alors -1,
    # valeur stable qui ne déclenchera pas de fausse détection de modification.
    if (-not (Test-Path -LiteralPath $MetaFile)) { return -1 }
    try {
        return (Get-Content -LiteralPath $MetaFile -Raw | ConvertFrom-Json).version
    } catch {
        return -1
    }
}

try {
    $dataDir = Join-Path $ServicePath 'data'
    $metaFile = Join-Path $dataDir 'business-meta.json'

    if (-not (Test-Path -LiteralPath $dataDir)) {
        throw "Dossier de données introuvable : $dataDir. Vérifiez -ServicePath."
    }

    if (-not (Test-Path -LiteralPath $Destination)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }
    # Le journal doit exister avant le premier Write-Log si la destination vient d'être créée.
    Write-Log "Sauvegarde depuis $dataDir vers $Destination"

    $stamp  = Get-Date -Format 'yyyy-MM-dd_HHmm'
    $target = Join-Path $Destination $stamp

    # --- Copie cohérente : jusqu'à 3 tentatives si l'équipe écrit pendant la copie -------
    $copied = $false
    for ($attempt = 1; $attempt -le 3 -and -not $copied; $attempt++) {
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        New-Item -ItemType Directory -Path $target -Force | Out-Null

        $before = Get-DataVersion $metaFile

        $files = @(Get-ChildItem -LiteralPath $dataDir -Filter '*.json' -File)
        if ($files.Count -eq 0) {
            throw "Aucun fichier .json dans $dataDir : le service a-t-il déjà démarré ?"
        }
        foreach ($f in $files) {
            Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $target $f.Name) -Force
        }

        $after = Get-DataVersion $metaFile
        if ($before -eq $after) {
            $copied = $true
        } else {
            Write-Log "Données modifiées pendant la copie (version $before -> $after), nouvelle tentative $attempt/3." 'AVERT'
            Start-Sleep -Seconds 3
        }
    }

    if (-not $copied) {
        throw "Impossible d'obtenir une copie cohérente après 3 tentatives (activité continue sur le serveur). Décalez l'horaire de la tâche planifiée vers une heure creuse."
    }

    # --- Vérification : une sauvegarde illisible ne vaut rien ---------------------------
    $checked = 0
    foreach ($f in Get-ChildItem -LiteralPath $target -Filter '*.json' -File) {
        try {
            Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json | Out-Null
            $checked++
        } catch {
            throw "Fichier sauvegardé illisible : $($f.Name) ($($_.Exception.Message)). Sauvegarde considérée comme échouée."
        }
    }
    Write-Log "$checked fichier(s) copié(s) et relu(s) sans erreur (version des données : $(Get-DataVersion $metaFile))."

    # --- .env : uniquement sur demande explicite ----------------------------------------
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
    # Écrite ici plutôt que dans la documentation seule : le jour d'un incident, c'est ce
    # dossier qu'on ouvre, et souvent sans avoir la procédure sous la main.
    $note = @"
Sauvegarde "Suivi Infra & Réseau" — $stamp
Source : $dataDir (serveur $(if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'inconnu' }))

POUR RESTAURER
1. Arrêter le service :        Stop-Service SuiviInfraAuth
2. Mettre de côté l'existant : Rename-Item "$dataDir" "data_avant_restauration"
3. Recréer le dossier :        New-Item -ItemType Directory "$dataDir"
4. Copier les fichiers *.json de CE dossier dans "$dataDir"
5. Redémarrer le service :     Start-Service SuiviInfraAuth
6. Vérifier :                  .\Test-SuiviInfra.ps1 -HostName <nom> -WithService

Ne restaurez PAS depuis l'application (onglet Paramètres) : en mode client/serveur, une
restauration côté navigateur n'a aucun effet sur le serveur et serait effacée à
l'actualisation suivante.

Si "env.sauvegarde" est présent, il correspond au fichier .env du serveur (secret de
session et configuration LDAP) : à remettre sous le nom ".env" à la racine du service.
"@
    Set-Content -LiteralPath (Join-Path $target 'RESTAURATION.txt') -Value $note -Encoding UTF8

    # --- Rotation : seulement maintenant que la sauvegarde est valide -------------------
    if ($RetentionDays -gt 0) {
        $limit = (Get-Date).AddDays(-$RetentionDays)
        # L'âge est déduit du NOM du dossier, pas de sa date de création : celle-ci est
        # remise à zéro si l'arborescence de sauvegardes est un jour déplacée ou recopiée
        # (changement de baie, migration de partage), ce qui ferait alors tout conserver
        # indéfiniment — ou, selon le sens, tout supprimer.
        $old = @(Get-ChildItem -LiteralPath $Destination -Directory | Where-Object {
            if ($_.Name -notmatch '^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$') { return $false }
            $when = Get-Date -Year $Matches[1] -Month $Matches[2] -Day $Matches[3] `
                             -Hour $Matches[4] -Minute $Matches[5] -Second 0
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
    Write-Log "SAUVEGARDE EN ÉCHEC — les données de l'équipe ne sont pas protégées pour aujourd'hui." 'ERREUR'
    exit 1
}
