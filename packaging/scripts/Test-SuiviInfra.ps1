<#
.SYNOPSIS
    Vérifie qu'une installation de "Suivi Infra & Réseau" est saine.

.DESCRIPTION
    À lancer après l'installation, ou en cas de doute. Chaque contrôle affiche
    OK / ÉCHEC et, en cas d'échec, ce qu'il faut regarder - le script ne modifie
    jamais rien.

.PARAMETER Protocol
    http (défaut) ou https - doit correspondre à l'installation en place.

.PARAMETER Port
    Port du site IIS. Défaut : 8081.

.PARAMETER HostName
    Nom DNS de l'application (ex. suivi-infra.monentreprise.local).

.PARAMETER WithService
    Vérifie aussi le service et le relais /api (Partie B).

.EXAMPLE
    .\Test-SuiviInfra.ps1 -HostName winas -Port 8081 -WithService
#>

[CmdletBinding()]
param(
    [string] $HostName = 'winas',
    [ValidateSet('http', 'https')][string] $Protocol = 'http',
    [int]    $Port = 8081,
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
            if ($Hint) { Write-Host "        -> $Hint" -ForegroundColor Yellow }
            $script:Failures++
        }
    } catch {
        Write-Host '[ÉCHEC]' -ForegroundColor Red
        Write-Host "        -> $($_.Exception.Message)" -ForegroundColor Yellow
        if ($Hint) { Write-Host "        -> $Hint" -ForegroundColor Yellow }
        $script:Failures++
    }
}

$BaseUrl = "${Protocol}://${HostName}" + $(if (($Protocol -eq 'https' -and $Port -eq 443) -or ($Protocol -eq 'http' -and $Port -eq 80)) { '' } else { ":$Port" })

Write-Host "`nVérification de l'installation - $BaseUrl`n" -ForegroundColor Cyan

# L'accès à la configuration d'IIS exige une console élevée : sans cela, le fournisseur
# « WebAdministration » ne se charge pas et TOUS les contrôles IIS échouent avec un message
# incompréhensible. Autant le dire une fois, clairement, plutôt que trois fois de travers.
$estAdmin = (New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

$iisDispo = $false
$iisRaison = ''
if (-not $estAdmin) {
    $iisRaison = "console non élevée : rouvrez PowerShell par clic droit -> « Exécuter en tant qu'administrateur »."
} else {
    try {
        if ($PSVersionTable.PSVersion.Major -ge 6) {
            # PowerShell 7 ne charge pas ce module nativement : il passe par la couche de
            # compatibilité Windows PowerShell.
            Import-Module WebAdministration -UseWindowsPowerShell -ErrorAction Stop -WarningAction SilentlyContinue
        } else {
            Import-Module WebAdministration -ErrorAction Stop
        }
        $iisDispo = $true
    } catch {
        $iisRaison = "module WebAdministration indisponible ($($_.Exception.Message)). Installez les outils de script IIS : Install-WindowsFeature Web-Scripting-Tools"
    }
}

if ($iisDispo) {
    Test-Item 'Site IIS présent et démarré' {
        $s = Get-Website -Name $SiteName -ErrorAction SilentlyContinue
        $s -and $s.State -eq 'Started'
    } "Relancez Install-SuiviInfra.ps1, ou démarrez le site depuis le Gestionnaire IIS."

    Test-Item "Liaison $($Protocol.ToUpper()) ($Port) configurée" {
        (Get-WebBinding -Name $SiteName -Protocol $Protocol -Port $Port -ErrorAction SilentlyContinue) -ne $null
    } "Aucune liaison $Protocol sur le port $Port : relancez Install-SuiviInfra.ps1 avec -Protocol $Protocol -Port $Port."

    # Une liaison en clair n'est un défaut qu'en HTTPS. En HTTP assumé, c'est l'installation
    # demandée : la signaler comme un échec n'aurait aucun sens.
    if ($Protocol -eq 'https') {
        Test-Item 'Aucune liaison HTTP en clair' {
            (Get-WebBinding -Name $SiteName -Protocol http -ErrorAction SilentlyContinue) -eq $null
        } "Le site répond aussi en clair : retirez la liaison http (Enable-SuiviInfraHttps.ps1 le fait)."
    }
} else {
    Write-Host "  Contrôles IIS ignorés - $iisRaison" -ForegroundColor Yellow
    Write-Host ''
}

Test-Item "Page d'accueil servie en $($Protocol.ToUpper())" {
    (Invoke-WebRequest $BaseUrl -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200
} "Vérifiez le DNS (le nom doit pointer sur ce serveur), le pare-feu$(if ($Protocol -eq 'https') { ' et le certificat' })."

# Si le nom ne répond pas, on retente en local avec l'en-tête Host : cela sépare « IIS ne
# sert pas le site » de « le nom winas ne résout pas, ou le pare-feu bloque ».
Test-Item 'Site joignable depuis le serveur lui-même (127.0.0.1)' {
    $r = Invoke-WebRequest "${Protocol}://127.0.0.1:$Port" -Headers @{ Host = $HostName } -UseBasicParsing -TimeoutSec 10
    $r.StatusCode -eq 200
} "IIS ne sert pas le site sur ce port. Si ce contrôle passe alors que le précédent échoue, c'est le DNS ou le pare-feu qui sont en cause, pas IIS."

Test-Item 'En-têtes de sécurité présents' {
    $h = (Invoke-WebRequest $BaseUrl -UseBasicParsing -TimeoutSec 10).Headers
    $h['Content-Security-Policy'] -and $h['X-Frame-Options'] -and $h['X-Content-Type-Options']
} "web.config n'est pas pris en compte : vérifiez qu'il est bien dans le dossier du site."

Test-Item "Règle de pare-feu $Port/TCP" {
    (Get-NetFirewallRule -DisplayName "Suivi Infra - $($Protocol.ToUpper()) $Port" -ErrorAction SilentlyContinue) -ne $null
} "Absente - normal si vos règles sont gérées par GPO (-SkipFirewall)."

if ($WithService) {
    Write-Host ''
    # Le service tourne comme service Windows (installation avec NSSM) ou comme tâche
    # planifiée (repli natif) : les deux sont des réussites, seule l'absence est un échec.
    Test-Item 'Service en cours d''exécution' {
        $svc = Get-Service -Name 'SuiviInfraAuth' -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -eq 'Running') { return $true }
        $task = Get-ScheduledTask -TaskName 'SuiviInfraAuth' -ErrorAction SilentlyContinue
        if ($task -and $task.State -eq 'Running') { return $true }
        $false
    } "Ni service Windows ni tâche planifiée en cours - consultez C:\services\suivi-infra\service.log."

    Test-Item 'Service en écoute en local' {
        (Invoke-RestMethod "http://127.0.0.1:$ServicePort/api/health" -TimeoutSec 5).ok -eq $true
    } "Le service ne répond pas : vérifiez le port dans .env et les journaux du service."

    Test-Item 'Relais /api par IIS (URL Rewrite + ARR)' {
        (Invoke-RestMethod "$BaseUrl/api/health" -TimeoutSec 10).ok -eq $true
    } "Modules URL Rewrite/ARR manquants, proxy ARR désactivé, ou règle absente - voir INSTALL.md §5."

    # C'est cette réponse qui fait basculer les navigateurs en mode client/serveur : sans le
    # champ 'mode', ils se croiraient sur une installation autonome et travailleraient chacun
    # sur leur propre copie sans que personne ne s'en aperçoive.
    Test-Item 'Le service se déclare bien en mode client/serveur' {
        (Invoke-RestMethod "$BaseUrl/api/health" -TimeoutSec 10).mode -eq 'client-serveur'
    } "La sonde /api/health ne déclare pas le mode : version du service trop ancienne, ou réponse altérée par un proxy intermédiaire."

    Test-Item 'Accès aux données refusé sans session' {
        try {
            Invoke-WebRequest "$BaseUrl/api/data" -UseBasicParsing -TimeoutSec 10 | Out-Null
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

# ---------------------------------------------------------------------------------------
# Diagnostic du relais /api : quand la chaîne est cassée, dire OÙ.
#
# « Serveur indisponible » côté navigateur a quatre causes possibles, qui demandent quatre
# gestes différents. Les tests ci-dessus disent que ça ne marche pas ; cette section dit
# lequel des quatre maillons a lâché, pour ne pas laisser chercher au hasard.
# ---------------------------------------------------------------------------------------
if ($WithService) {
    $relaisOk = $false
    try { $relaisOk = (Invoke-RestMethod "$BaseUrl/api/health" -TimeoutSec 10).ok -eq $true } catch { }

    if (-not $relaisOk) {
        Write-Host ''
        Write-Host 'DIAGNOSTIC DU RELAIS /api' -ForegroundColor Cyan
        Write-Host ('-' * 60)

        # 1. Le service tourne-t-il et répond-il en local ?
        $localOk = $false
        try { $localOk = (Invoke-RestMethod "http://127.0.0.1:$ServicePort/api/health" -TimeoutSec 5).ok -eq $true } catch { }

        if (-not $localOk) {
            Write-Host '  [X] Le service ne répond pas sur 127.0.0.1 : le problème est AVANT IIS.' -ForegroundColor Red
            $svc  = Get-Service -Name 'SuiviInfraAuth' -ErrorAction SilentlyContinue
            $task = Get-ScheduledTask -TaskName 'SuiviInfraAuth' -ErrorAction SilentlyContinue
            if ($svc)  { Write-Host "      Service Windows  : $($svc.Status)" }
            if ($task) { Write-Host "      Tâche planifiée  : $($task.State)" }
            if (-not $svc -and -not $task) {
                Write-Host '      Ni service ni tâche : relancez Install-SuiviInfra.ps1 -WithService.' -ForegroundColor Yellow
            } else {
                Write-Host '      Journal : C:\services\suivi-infra\service.log (les dernières lignes disent pourquoi Node s''arrête).' -ForegroundColor Yellow
                Write-Host '      Relancer : Start-ScheduledTask -TaskName SuiviInfraAuth   (ou Restart-Service SuiviInfraAuth)' -ForegroundColor Yellow
            }
        } else {
            Write-Host '  [OK] Le service répond sur 127.0.0.1 : le problème est DANS IIS.' -ForegroundColor Green

            $rewrite = Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\URL Rewrite'
            $arr     = Test-Path 'HKLM:\SOFTWARE\Microsoft\IIS Extensions\Application Request Routing'
            Write-Host ("  [{0}] Module URL Rewrite" -f $(if ($rewrite) { 'OK' } else { 'X ' })) -ForegroundColor $(if ($rewrite) { 'Green' } else { 'Red' })
            Write-Host ("  [{0}] Module Application Request Routing (ARR)" -f $(if ($arr) { 'OK' } else { 'X ' })) -ForegroundColor $(if ($arr) { 'Green' } else { 'Red' })

            if (-not $rewrite -or -not $arr) {
                Write-Host ''
                Write-Host '      Ce sont eux qui manquent. Téléchargez-les sur https://www.iis.net/downloads :' -ForegroundColor Yellow
                if (-not $rewrite) { Write-Host '        - URL Rewrite 2.1' -ForegroundColor Yellow }
                if (-not $arr)     { Write-Host '        - Application Request Routing 3.0' -ForegroundColor Yellow }
                Write-Host '      Puis relancez Install-SuiviInfra.ps1 avec les mêmes options : la règle sera créée.' -ForegroundColor Yellow
            } else {
                # Modules présents : reste le proxy ARR au niveau serveur, et la règle du site.
                $proxyOn = $false
                try {
                    $proxyOn = [bool]::Parse((Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
                        -Filter 'system.webServer/proxy' -Name 'enabled').Value)
                } catch { }
                Write-Host ("  [{0}] Proxy ARR activé au niveau serveur" -f $(if ($proxyOn) { 'OK' } else { 'X ' })) -ForegroundColor $(if ($proxyOn) { 'Green' } else { 'Red' })
                if (-not $proxyOn) {
                    Write-Host '      Corriger : Set-WebConfigurationProperty -PSPath MACHINE/WEBROOT/APPHOST -Filter system.webServer/proxy -Name enabled -Value True' -ForegroundColor Yellow
                }

                $regle = $null
                try {
                    $regle = Get-WebConfigurationProperty -PSPath "IIS:\Sites\$SiteName" `
                        -Filter "system.webServer/rewrite/rules/rule[@name='Suivi Infra - API']/action" -Name 'url' -ErrorAction SilentlyContinue
                } catch { }
                if ($regle -and $regle.Value) {
                    Write-Host "  [OK] Règle « Suivi Infra - API » -> $($regle.Value)" -ForegroundColor Green
                } else {
                    Write-Host '  [X ] Règle « Suivi Infra - API » absente du site.' -ForegroundColor Red
                    Write-Host '      Corriger : relancez Install-SuiviInfra.ps1 avec les mêmes options.' -ForegroundColor Yellow
                }
            }
        }
        Write-Host ('-' * 60)
    }
}

Write-Host ''
if ($script:Failures -eq 0) {
    Write-Host "Tous les contrôles sont au vert." -ForegroundColor Green
} else {
    Write-Host "$($script:Failures) contrôle(s) en échec - voir les indications ci-dessus." -ForegroundColor Red
}
Write-Host ''
exit $script:Failures
