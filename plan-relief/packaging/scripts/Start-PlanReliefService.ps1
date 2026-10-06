<#
.SYNOPSIS
    Lance le service Plan Relief et le relance s'il s'arrête.

.DESCRIPTION
    Exécuté au démarrage du serveur par la tâche planifiée « Plan Relief - Service »
    (installation sans NSSM, voir Install-PlanRelief.ps1). Il joue le rôle que tient NSSM
    dans l'autre mode d'installation :
      - démarre Node.js dans le dossier du service (c'est là que se trouve le fichier .env) ;
      - écrit la sortie dans service.log et les erreurs dans service.err.log ;
      - relance Node s'il s'arrête, en espaçant les relances quand il échoue dès le
        démarrage (fichier de données illisible, port déjà pris…) pour ne pas saturer
        les journaux ;
      - fait tourner les journaux au-delà de 10 Mo.

    Ne pas lancer à la main : passer par la tâche planifiée
    (Start-ScheduledTask / Stop-ScheduledTask -TaskName 'Plan Relief - Service').
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $NodePath,
    [string] $ServicePath = $PSScriptRoot
)

$ErrorActionPreference = 'Continue'
$log = Join-Path $ServicePath 'service.log'
$err = Join-Path $ServicePath 'service.err.log'
$entry = Join-Path $ServicePath 'src\index.js'

function Move-LogIfLarge([string] $file) {
    if ((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -gt 10MB) {
        Move-Item -LiteralPath $file -Destination "$file.1" -Force
    }
}
function Write-SupervisorLog([string] $message) {
    $line = '{0} [superviseur] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    [IO.File]::AppendAllText($log, $line + [Environment]::NewLine, (New-Object Text.UTF8Encoding $false))
}

# Un Node resté actif d'un lancement précédent (arrêt de la tâche planifiée : Windows ne
# termine pas toujours les processus enfants) occuperait le port : on l'arrête d'abord.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$entry*" } |
    ForEach-Object {
        Write-SupervisorLog ("arret d'une instance precedente (processus {0})" -f $_.ProcessId)
        Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null
    }

while ($true) {
    Move-LogIfLarge $log
    Move-LogIfLarge $err
    $started = Get-Date
    Write-SupervisorLog 'demarrage du service'
    # cmd.exe se charge des redirections en ajout (>>), comme NSSM ; le chemin complet de
    # index.js dans la ligne de commande permet aux scripts d'installation de retrouver
    # ce processus précis pour l'arrêter.
    $command = "/d /s /c `"`"$NodePath`" `"$entry`" >> `"$log`" 2>> `"$err`"`""
    $process = Start-Process -FilePath $env:ComSpec -ArgumentList $command -WorkingDirectory $ServicePath `
        -WindowStyle Hidden -PassThru -Wait
    $runtime = ((Get-Date) - $started).TotalSeconds
    Write-SupervisorLog ("arret du service (code {0}) apres {1:N0} s, relance" -f $process.ExitCode, $runtime)
    if ($runtime -lt 30) { Start-Sleep -Seconds 30 } else { Start-Sleep -Seconds 3 }
}
