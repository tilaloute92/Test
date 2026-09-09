<#
.SYNOPSIS
    Crée (ou met à jour) la tâche planifiée quotidienne de sauvegarde des données.

.DESCRIPTION
    Enregistre Backup-SuiviInfra.ps1 dans le Planificateur de tâches Windows, puis
    LANCE LA TÂCHE UNE FOIS et vérifie qu'elle a réussi. Une tâche planifiée qui
    n'a jamais tourné n'est pas une sauvegarde : c'est une intention.

    Peut aussi produire le fichier XML de la tâche (-ExportXml), pour déployer la même
    configuration sur d'autres serveurs sans rejouer ce script.

.PARAMETER Destination
    Dossier racine des sauvegardes (local ou UNC).

.PARAMETER At
    Heure d'exécution quotidienne, format HH:mm. Par défaut 21:00 — après les horaires
    décalés de l'équipe, pour maximiser les chances d'une copie cohérente.

.PARAMETER RunAsUser
    Compte d'exécution. Par défaut SYSTEM.

    ATTENTION pour une destination réseau (\\serveur\partage) : SYSTEM ne possède pas
    d'identité réseau propre — il se présente comme le COMPTE ORDINATEUR du serveur
    (DOMAINE\NOMSERVEUR$). Deux solutions, au choix :
      - autoriser ce compte ordinateur en écriture sur le partage ; ou
      - indiquer ici un compte de service dédié (-RunAsUser DOMAINE\svc-sauvegarde),
        dont le mot de passe sera demandé.
    Sans l'une des deux, la tâche échouera tous les soirs sans que personne ne le voie.

.PARAMETER RetentionDays
    Transmis au script de sauvegarde. Par défaut 30.

.PARAMETER IncludeEnv
    Transmis au script de sauvegarde (inclut le secret de session — voir son aide).

.PARAMETER ExportXml
    Chemin d'un fichier .xml où exporter la définition de la tâche, importable ailleurs
    avec :  schtasks /Create /TN "Suivi Infra - Sauvegarde" /XML tache.xml

.PARAMETER SkipTestRun
    N'exécute pas la tâche après l'avoir créée. À éviter : c'est ce test qui prouve que
    les droits d'accès à la destination sont corrects.

.EXAMPLE
    .\Register-SuiviInfraBackup.ps1 -Destination \\serveur-sauvegarde\suivi-infra

.EXAMPLE
    .\Register-SuiviInfraBackup.ps1 -Destination \\srv-bkp\suivi-infra `
        -RunAsUser MONDOMAINE\svc-sauvegarde -At 22:30 -RetentionDays 90
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Destination,
    [string] $ServicePath = 'C:\services\suivi-infra',
    [ValidatePattern('^\d{2}:\d{2}$')][string] $At = '21:00',
    [string] $RunAsUser = 'SYSTEM',
    [int]    $RetentionDays = 30,
    [switch] $IncludeEnv,
    [string] $ExportXml,
    [switch] $SkipTestRun,
    [string] $TaskName = 'Suivi Infra - Sauvegarde quotidienne'
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Ce script doit être lancé dans une console PowerShell ouverte en tant qu'administrateur."
    }
}

Assert-Admin

# Le script de sauvegarde est déposé à côté du service : la tâche planifiée doit pointer
# vers un emplacement stable, pas vers le dossier temporaire d'où l'installation a été faite.
$sourceScript = Join-Path $PSScriptRoot 'Backup-SuiviInfra.ps1'
if (-not (Test-Path -LiteralPath $sourceScript)) {
    throw "Backup-SuiviInfra.ps1 est introuvable à côté de ce script ($PSScriptRoot)."
}
$installedScript = Join-Path $ServicePath 'Backup-SuiviInfra.ps1'
Copy-Item -LiteralPath $sourceScript -Destination $installedScript -Force
Write-Host "Script de sauvegarde installé : $installedScript" -ForegroundColor Green

# --- Destination : la créer et en restreindre l'accès si elle est locale ----------------
if ($Destination -notlike '\\*') {
    if (-not (Test-Path -LiteralPath $Destination)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        Write-Host "Dossier de destination créé : $Destination" -ForegroundColor Green
    }
    # Les sauvegardes contiennent les données de l'équipe et les empreintes des mots de
    # passe des comptes locaux : mêmes restrictions que le dossier data\ du service.
    try {
        $acl = Get-Acl -LiteralPath $Destination
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($who in @('BUILTIN\Administrateurs', 'BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM')) {
            try {
                $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                    $who, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
                $acl.AddAccessRule($rule)
            } catch {
                # Le nom du groupe Administrateurs dépend de la langue de Windows : on essaie
                # les deux, il suffit qu'un des deux existe.
            }
        }
        Set-Acl -LiteralPath $Destination -AclObject $acl
        Write-Host "Droits restreints aux administrateurs et à SYSTEM : $Destination" -ForegroundColor Green
    } catch {
        Write-Warning "Droits d'accès non modifiés sur $Destination ($($_.Exception.Message)). Vérifiez manuellement qui peut lire ce dossier."
    }
} elseif ($RunAsUser -eq 'SYSTEM') {
    Write-Warning @"
Destination réseau avec le compte SYSTEM : le serveur se présentera au partage sous son
compte ordinateur ($env:USERDOMAIN\$env:COMPUTERNAME`$), pas sous SYSTEM. Autorisez ce
compte en écriture sur le partage, ou relancez avec -RunAsUser <compte de service>.
Le test d'exécution ci-dessous dira lequel des deux cas vous êtes.
"@
}

# --- Définition de la tâche -------------------------------------------------------------
$arguments = @(
    '-NoProfile'
    '-ExecutionPolicy Bypass'
    '-NonInteractive'
    "-File `"$installedScript`""
    "-Destination `"$Destination`""
    "-ServicePath `"$ServicePath`""
    "-RetentionDays $RetentionDays"
)
if ($IncludeEnv) { $arguments += '-IncludeEnv' }

$action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($arguments -join ' ')
$trigger   = New-ScheduledTaskTrigger -Daily -At $At
# StartWhenAvailable : rattrape l'exécution si le serveur était éteint à l'heure prévue.
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
                -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

if ($RunAsUser -eq 'SYSTEM') {
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $register = { Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
                    -Settings $settings -Principal $principal -Force }
} else {
    $cred = Get-Credential -UserName $RunAsUser -Message "Mot de passe du compte d'exécution de la tâche planifiée"
    $plain = $cred.GetNetworkCredential().Password
    $register = { Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
                    -Settings $settings -User $RunAsUser -Password $plain -RunLevel Highest -Force }
}

& $register | Out-Null
Write-Host "Tâche planifiée enregistrée : « $TaskName » (tous les jours à $At)" -ForegroundColor Green

if ($ExportXml) {
    Export-ScheduledTask -TaskName $TaskName | Set-Content -LiteralPath $ExportXml -Encoding Unicode
    Write-Host "Définition exportée : $ExportXml" -ForegroundColor Green
    Write-Host '  Import sur un autre serveur : schtasks /Create /TN "' -NoNewline
    Write-Host "$TaskName`" /XML `"$ExportXml`""
}

# --- Exécution de contrôle --------------------------------------------------------------
if ($SkipTestRun) {
    Write-Warning "Test d'exécution ignoré (-SkipTestRun) : rien ne prouve encore que la sauvegarde fonctionne."
    return
}

Write-Host ''
Write-Host "Exécution de contrôle en cours…" -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName

$deadline = (Get-Date).AddMinutes(5)
do {
    Start-Sleep -Seconds 3
    $info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
    $running = (Get-ScheduledTask -TaskName $TaskName).State -eq 'Running'
} while ($running -and (Get-Date) -lt $deadline)

if ($running) {
    Write-Warning "La tâche tourne encore après 5 minutes — vérifiez le journal : $Destination\sauvegarde.log"
    exit 1
}

if ($info.LastTaskResult -eq 0) {
    $last = Get-ChildItem -LiteralPath $Destination -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' } |
            Sort-Object CreationTime -Descending | Select-Object -First 1
    if ($last) {
        $n = @(Get-ChildItem -LiteralPath $last.FullName -Filter '*.json' -File).Count
        Write-Host "Sauvegarde de contrôle réussie : $($last.FullName) ($n fichier(s))." -ForegroundColor Green
        Write-Host "La sauvegarde tournera désormais tous les jours à $At." -ForegroundColor Green
        exit 0
    }
    Write-Warning "La tâche s'est terminée sans erreur mais aucun dossier de sauvegarde n'a été trouvé dans $Destination."
    exit 1
}

Write-Host ''
Write-Warning "La tâche s'est terminée en erreur (code $($info.LastTaskResult))."
Write-Host "Journal : $Destination\sauvegarde.log" -ForegroundColor Yellow
Write-Host "Cause la plus fréquente sur une destination réseau : le compte d'exécution n'a pas le droit d'écrire sur le partage (voir -RunAsUser dans l'aide de ce script)." -ForegroundColor Yellow
exit 1
