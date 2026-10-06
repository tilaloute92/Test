<#
.SYNOPSIS
    Vérifie qu'une installation de "Plan Relief" est saine.

.DESCRIPTION
    À lancer après l'installation, ou en cas de doute. Chaque contrôle affiche
    OK / ÉCHEC et, en cas d'échec, ce qu'il faut regarder — le script ne modifie
    jamais rien.

.PARAMETER HostName
    Nom DNS de l'application (ex. plans.monentreprise.local).

.PARAMETER Port
    Port HTTPS de l'application (8082 par défaut, comme Install-PlanRelief.ps1).

.EXAMPLE
    .\Test-PlanRelief.ps1 -HostName plans.monentreprise.local
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $HostName,
    [string] $SiteName = 'Plan Relief',
    [ValidateRange(1, 65535)][int] $Port = 8082,
    [string] $ServicePath = 'C:\services\plan-relief',
    [int]    $ServicePort = 4100
)

$ErrorActionPreference = 'Continue'
$BaseUrl = if ($Port -eq 443) { "https://$HostName" } else { "https://${HostName}:$Port" }
$script:Failures = 0

function Test-Item {
    param([string] $Label, [scriptblock] $Check, [string] $Hint)
    Write-Host -NoNewline ("  {0,-58}" -f $Label)
    try {
        $result = & $Check
        if ($result) {
            Write-Host '[OK]' -ForegroundColor Green
        } else {
            Write-Host '[ÉCHEC]' -ForegroundColor Red
            if ($Hint) { Write-Host "        → $Hint" -ForegroundColor Yellow }
            $script:Failures++
        }
    } catch {
        Write-Host '[ÉCHEC]' -ForegroundColor Red
        Write-Host "        → $($_.Exception.Message)" -ForegroundColor Yellow
        if ($Hint) { Write-Host "        → $Hint" -ForegroundColor Yellow }
        $script:Failures++
    }
}

function Get-StatusCode {
    param([string] $Url)
    try {
        (Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 10).StatusCode
    } catch {
        if ($_.Exception.Response) { [int] $_.Exception.Response.StatusCode } else { throw }
    }
}

Write-Host "`nVérification de l'installation — $BaseUrl`n" -ForegroundColor Cyan

Import-Module WebAdministration -ErrorAction SilentlyContinue

Test-Item 'Site IIS présent et démarré' {
    $s = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
    $s -and $s.State -eq 'Started'
} "Relancez Install-PlanRelief.ps1, ou démarrez le site depuis le Gestionnaire IIS."

Test-Item "Liaison HTTPS ($Port) configurée" {
    (Get-WebBinding -Name $SiteName -Protocol https -Port $Port -ErrorAction SilentlyContinue) -ne $null
} "Aucune liaison https : relancez l'installation avec le bon -CertificateThumbprint."

Test-Item 'Liaison HTTP (80) absente' {
    (Get-WebBinding -Name $SiteName -Protocol http -ErrorAction SilentlyContinue) -eq $null
} "Le site répond aussi en clair sur le port 80 : retirez la liaison http."

Test-Item 'Page d''accueil servie en HTTPS' {
    (Invoke-WebRequest "$BaseUrl" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200
} "Vérifiez le DNS (le nom doit pointer sur ce serveur), le certificat et le pare-feu."

Test-Item 'En-têtes de sécurité présents (CSP, X-Frame-Options…)' {
    $h = (Invoke-WebRequest "$BaseUrl" -UseBasicParsing -TimeoutSec 10).Headers
    $h['Content-Security-Policy'] -and $h['X-Frame-Options'] -and $h['X-Content-Type-Options']
} "web.config n'est pas pris en compte : vérifiez qu'il est bien dans le dossier du site."

Test-Item 'HSTS neutralisé (ne touche pas les autres sites HTTP du serveur)' {
    $h = (Invoke-WebRequest "$BaseUrl" -UseBasicParsing -TimeoutSec 10).Headers
    (-not $h['Strict-Transport-Security']) -or ($h['Strict-Transport-Security'] -match '^\s*max-age=0\b')
} "web.config envoie Strict-Transport-Security : le navigateur forcerait alors HTTPS sur tous les ports de ce serveur (8080, 8081…). Mettez max-age=0."

Test-Item 'Page de retour de la connexion Microsoft publiée' {
    (Get-StatusCode "$BaseUrl/auth-redirect.html") -eq 200
} "auth-redirect.html manquant dans le dossier du site : republiez le paquet."

Test-Item 'Imports jusqu''à 100 Mo autorisés par IIS' {
    $limit = Get-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" `
        -Filter 'system.webServer/security/requestFiltering/requestLimits' -Name 'maxAllowedContentLength'
    [long] $limit.Value -ge 100MB
} "La limite IIS par défaut (30 Mo) bloquerait les grands plans : vérifiez requestLimits dans web.config."

Test-Item "Règle de pare-feu $Port/TCP" {
    $r = Get-NetFirewallRule -DisplayName 'Plan Relief - HTTPS' -ErrorAction SilentlyContinue
    $r -and (($r | Get-NetFirewallPortFilter).LocalPort -contains "$Port")
} "Absente — normal si vos règles sont gérées par GPO (-SkipFirewall)."

Write-Host ''
Test-Item 'Service en cours d''exécution (service Windows ou tâche planifiée)' {
    $svc = Get-Service -Name 'PlanReliefSvc' -ErrorAction SilentlyContinue
    if ($svc) { return $svc.Status -eq 'Running' }
    $task = Get-ScheduledTask -TaskName 'Plan Relief - Service' -ErrorAction SilentlyContinue
    $task -and $task.State -eq 'Running'
} "Ni service PlanReliefSvc démarré, ni tâche planifiée « Plan Relief - Service » en cours — consultez $ServicePath\service.err.log."

Test-Item 'Service en écoute en local' {
    (Invoke-RestMethod "http://127.0.0.1:$ServicePort/api/health" -TimeoutSec 5).app -eq 'plan-relief'
} "Le service ne répond pas, ou un autre programme occupe le port $ServicePort : vérifiez PORT dans .env."

Test-Item 'Relais /api par IIS (URL Rewrite + ARR)' {
    (Invoke-RestMethod "$BaseUrl/api/health" -TimeoutSec 10).app -eq 'plan-relief'
} "Modules URL Rewrite/ARR manquants, proxy ARR désactivé, ou règle « Plan Relief - API » absente — voir INSTALL.md."

# Contrôles de sécurité, pas seulement de bon fonctionnement : une réponse 200 ici serait
# une faille (plans et recherche lisibles sans être connecté).
Test-Item 'Plans refusés sans session (401)' {
    (Get-StatusCode "$BaseUrl/api/plans") -eq 401
} "La bibliothèque de plans doit être refusée sans session authentifiée."

Test-Item 'Recherche refusée sans session (401)' {
    (Get-StatusCode "$BaseUrl/api/search?q=test") -eq 401
} "La recherche d'équipements doit être refusée sans session authentifiée."

Test-Item 'Secret de session personnalisé dans .env' {
    $envFile = Join-Path $ServicePath '.env'
    (Test-Path $envFile) -and -not (Select-String -Path $envFile -Pattern 'JWT_SECRET=change-moi' -Quiet)
} "JWT_SECRET doit être une valeur aléatoire propre à cette installation."

Test-Item 'Au moins un compte local existe' {
    $f = Join-Path $ServicePath 'data\users.json'
    if (-not (Test-Path $f)) { return $false }
    $raw = (Get-Content $f -Raw).Trim()
    if (-not $raw) { return $false }
    @($raw | ConvertFrom-Json).Count -ge 1
} "Créez le premier compte : node scripts\create-local-user.js admin `"MotDePasse!`" `"Administrateur`""

Test-Item 'Tâche de sauvegarde planifiée' {
    $t = Get-ScheduledTask -TaskName 'Plan Relief - Sauvegarde quotidienne' -ErrorAction SilentlyContinue
    if (-not $t) { return $false }
    ($t | Get-ScheduledTaskInfo).LastTaskResult -eq 0
} "Aucune sauvegarde (ou dernière exécution en échec) : lancez Register-PlanReliefBackup.ps1 — voir INSTALL.md."

Write-Host ''
if ($script:Failures -eq 0) {
    Write-Host "Tous les contrôles sont au vert." -ForegroundColor Green
} else {
    Write-Host "$($script:Failures) contrôle(s) en échec — voir les indications ci-dessus." -ForegroundColor Red
}
Write-Host ''
exit $script:Failures
