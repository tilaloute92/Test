<#
.SYNOPSIS
    Vérifie qu'une installation de "Suivi Infra & Réseau" est saine.

.DESCRIPTION
    À lancer après l'installation, ou en cas de doute. Chaque contrôle affiche
    OK / ÉCHEC et, en cas d'échec, ce qu'il faut regarder — le script ne modifie
    jamais rien.

.PARAMETER HostName
    Nom DNS de l'application (ex. suivi-infra.monentreprise.local).

.PARAMETER WithService
    Vérifie aussi le service et le relais /api (Partie B).

.EXAMPLE
    .\Test-SuiviInfra.ps1 -HostName suivi-infra.monentreprise.local -WithService
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $HostName,
    [string] $SiteName = 'Suivi Infra & Reseau',
    [switch] $WithService,
    [int]    $ServicePort = 4000
)

$ErrorActionPreference = 'Continue'
$script:Failures = 0

function Test-Item {
    param([string] $Label, [scriptblock] $Check, [string] $Hint)
    Write-Host -NoNewline ("  {0,-52}" -f $Label)
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

Write-Host "`nVérification de l'installation — $HostName`n" -ForegroundColor Cyan

Import-Module WebAdministration -ErrorAction SilentlyContinue

Test-Item 'Site IIS présent et démarré' {
    $s = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
    $s -and $s.State -eq 'Started'
} "Relancez Install-SuiviInfra.ps1, ou démarrez le site depuis le Gestionnaire IIS."

Test-Item 'Liaison HTTPS (443) configurée' {
    (Get-WebBinding -Name $SiteName -Protocol https -ErrorAction SilentlyContinue) -ne $null
} "Aucune liaison https : relancez l'installation avec le bon -CertificateThumbprint."

Test-Item 'Liaison HTTP (80) absente' {
    (Get-WebBinding -Name $SiteName -Protocol http -ErrorAction SilentlyContinue) -eq $null
} "Le site répond aussi en clair sur le port 80 : retirez la liaison http (DEPLOYMENT, étape 5)."

Test-Item 'Page d''accueil servie en HTTPS' {
    (Invoke-WebRequest "https://$HostName" -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200
} "Vérifiez le DNS (le nom doit pointer sur ce serveur), le certificat et le pare-feu."

Test-Item 'En-têtes de sécurité présents' {
    $h = (Invoke-WebRequest "https://$HostName" -UseBasicParsing -TimeoutSec 10).Headers
    $h['Content-Security-Policy'] -and $h['X-Frame-Options'] -and $h['X-Content-Type-Options']
} "web.config n'est pas pris en compte : vérifiez qu'il est bien dans le dossier du site."

Test-Item 'Règle de pare-feu 443/TCP' {
    (Get-NetFirewallRule -DisplayName 'Suivi Infra - HTTPS' -ErrorAction SilentlyContinue) -ne $null
} "Absente — normal si vos règles sont gérées par GPO (-SkipFirewall)."

if ($WithService) {
    Write-Host ''
    Test-Item 'Service Windows en cours d''exécution' {
        $svc = Get-Service -Name 'SuiviInfraAuth' -ErrorAction SilentlyContinue
        if (-not $svc) { return $false }
        $svc.Status -eq 'Running'
    } "Service absent ou arrêté — consultez C:\services\suivi-infra\service.err.log."

    Test-Item 'Service en écoute en local' {
        (Invoke-RestMethod "http://127.0.0.1:$ServicePort/api/health" -TimeoutSec 5).ok -eq $true
    } "Le service ne répond pas : vérifiez le port dans .env et les journaux du service."

    Test-Item 'Relais /api par IIS (URL Rewrite + ARR)' {
        (Invoke-RestMethod "https://$HostName/api/health" -TimeoutSec 10).ok -eq $true
    } "Modules URL Rewrite/ARR manquants, proxy ARR désactivé, ou règle absente — voir INSTALL.md §5."

    Test-Item 'Accès aux données refusé sans session' {
        try {
            Invoke-WebRequest "https://$HostName/api/data" -UseBasicParsing -TimeoutSec 10 | Out-Null
            $false   # une réponse 200 sans authentification serait une faille
        } catch {
            $_.Exception.Response.StatusCode.value__ -eq 401
        }
    } "Les données d'équipe doivent être refusées (401) sans session authentifiée."

    Test-Item 'Au moins un compte local existe' {
        $f = 'C:\services\suivi-infra\data\users.json'
        if (-not (Test-Path $f)) { return $false }
        $raw = (Get-Content $f -Raw).Trim()
        if (-not $raw) { return $false }
        @($raw | ConvertFrom-Json).Count -ge 1
    } "Créez le premier compte : node scripts\create-local-user.js admin `"MotDePasse!`" `"Administrateur`""
}

Write-Host ''
if ($script:Failures -eq 0) {
    Write-Host "Tous les contrôles sont au vert." -ForegroundColor Green
} else {
    Write-Host "$($script:Failures) contrôle(s) en échec — voir les indications ci-dessus." -ForegroundColor Red
}
Write-Host ''
exit $script:Failures
