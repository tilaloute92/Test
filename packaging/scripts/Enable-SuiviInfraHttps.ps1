<#
.SYNOPSIS
    Bascule une installation "Suivi Infra & Réseau" de HTTP vers HTTPS.

.DESCRIPTION
    À lancer APRÈS Install-SuiviInfra.ps1, une fois le certificat disponible. Le script ne
    touche ni aux fichiers du site, ni aux données d'équipe, ni au secret de session : il
    remplace la liaison IIS, ajuste le pare-feu, et aligne la configuration du service sur
    la nouvelle adresse.

    Deux valeurs du service doivent suivre le changement, sans quoi la connexion cesse de
    fonctionner sans message clair :
      - COOKIE_SECURE=true  : le cookie de session n'est plus émis qu'en HTTPS ;
      - CORS_ORIGIN         : l'adresse du site, que le service autorise à l'appeler.

.PARAMETER HostName
    Nom DNS du site. Défaut : winas. Il doit correspondre au certificat.

.PARAMETER Port
    Port HTTPS. Défaut : 443.

.PARAMETER CertificateThumbprint
    Empreinte du certificat dans Ordinateur local\Personnel. Si omis et qu'un seul
    certificat correspond à -HostName, il est choisi automatiquement.

.PARAMETER WithService
    L'installation comporte le service (met à jour .env et redémarre le service).

.PARAMETER KeepHttp
    Conserve aussi l'ancienne liaison HTTP. Déconseillé : l'application resterait
    joignable en clair. À n'utiliser que le temps d'une transition.

.EXAMPLE
    .\Enable-SuiviInfraHttps.ps1 -HostName winas -WithService
#>

[CmdletBinding()]
param(
    [string] $SiteName = 'Suivi Infra & Reseau',
    [string] $HostName = 'winas',
    [int]    $Port = 443,
    [string] $CertificateThumbprint,
    [switch] $WithService,
    [string] $ServicePath = 'C:\services\suivi-infra',
    [switch] $KeepHttp,
    [switch] $SkipFirewall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ServiceName = 'SuiviInfraAuth'
$BaseUrl = "https://$HostName" + $(if ($Port -eq 443) { '' } else { ":$Port" })

function Write-Step { param([string] $m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok   { param([string] $m) Write-Host "    [OK] $m" -ForegroundColor Green }
function Write-Warn { param([string] $m) Write-Host "    [!]  $m" -ForegroundColor Yellow }

Write-Step 'Contrôles préalables'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script doit être lancé depuis une console PowerShell *Administrateur*."
}
Write-Ok 'Console administrateur'

Import-Module WebAdministration -ErrorAction Stop
if (-not (Test-Path "IIS:\Sites\$SiteName")) {
    throw "Le site IIS « $SiteName » n'existe pas. Lancez d'abord Install-SuiviInfra.ps1."
}
Write-Ok "Site IIS « $SiteName » présent"

if ($CertificateThumbprint) {
    $cert = Get-ChildItem Cert:\LocalMachine\My |
        Where-Object { $_.Thumbprint -eq $CertificateThumbprint.Replace(' ', '') }
    if (-not $cert) { throw "Aucun certificat avec l'empreinte '$CertificateThumbprint' dans Ordinateur local\Personnel." }
} else {
    $candidates = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object {
        $_.NotAfter -gt (Get-Date) -and (
            $_.Subject -like "*$HostName*" -or
            ($_.DnsNameList | ForEach-Object { $_.Unicode }) -contains $HostName
        )
    })
    if ($candidates.Count -eq 1) {
        $cert = $candidates[0]
    } elseif ($candidates.Count -eq 0) {
        throw @"
Aucun certificat valide trouvé pour '$HostName' dans Ordinateur local\Personnel.
Importez-le d'abord (certlm.msc -> Personnel -> Certificats), puis relancez.
"@
    } else {
        $list = ($candidates | ForEach-Object { "  $($_.Thumbprint)  $($_.Subject)  (expire le $($_.NotAfter.ToString('yyyy-MM-dd')))" }) -join "`n"
        throw "Plusieurs certificats correspondent à '$HostName'. Relancez avec -CertificateThumbprint :`n$list"
    }
}
Write-Ok "Certificat : $($cert.Subject) (expire le $($cert.NotAfter.ToString('yyyy-MM-dd')))"

Write-Step "Liaison HTTPS $Port sur $HostName"

$binding = Get-WebBinding -Name $SiteName -Protocol https -Port $Port -ErrorAction SilentlyContinue
if (-not $binding) {
    New-WebBinding -Name $SiteName -Protocol https -Port $Port -HostHeader $HostName -SslFlags 1
    $binding = Get-WebBinding -Name $SiteName -Protocol https -Port $Port
}
$binding.AddSslCertificate($cert.Thumbprint, 'My')
Write-Ok 'Liaison HTTPS en place'

if ($KeepHttp) {
    Write-Warn "Liaison HTTP conservée (-KeepHttp) : l'application reste joignable en clair. Retirez-la dès que possible."
} else {
    foreach ($b in @(Get-WebBinding -Name $SiteName -Protocol http -ErrorAction SilentlyContinue)) {
        $info = $b.bindingInformation
        $bPort = ($info -split ':')[1]
        Remove-WebBinding -Name $SiteName -Protocol http -Port $bPort -HostHeader (($info -split ':')[2]) -ErrorAction SilentlyContinue
        Write-Ok "Liaison HTTP $bPort retirée - accès en HTTPS uniquement"
        if (-not $SkipFirewall) {
            $old = Get-NetFirewallRule -DisplayName "Suivi Infra - HTTP $bPort" -ErrorAction SilentlyContinue
            if ($old) { $old | Remove-NetFirewallRule; Write-Ok "Règle de pare-feu $bPort/TCP supprimée" }
        }
    }
}

if (-not $SkipFirewall) {
    $rule = "Suivi Infra - HTTPS $Port"
    if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP `
            -LocalPort $Port -Action Allow -Profile Domain | Out-Null
        Write-Ok "Règle de pare-feu $Port/TCP (profil Domaine) ajoutée"
    }
}

Start-Website -Name $SiteName -ErrorAction SilentlyContinue

if ($WithService) {
    Write-Step 'Mise à jour du service'
    $envPath = Join-Path $ServicePath '.env'
    if (-not (Test-Path $envPath)) {
        Write-Warn "$envPath introuvable : le service n'est pas installé ici, rien à mettre à jour."
    } else {
        $lines = Get-Content $envPath
        foreach ($pair in @(@{ k = 'COOKIE_SECURE'; v = 'true' }, @{ k = 'CORS_ORIGIN'; v = $BaseUrl })) {
            $line = "$($pair.k)=$($pair.v)"
            if ($lines -match "^$($pair.k)=") { $lines = $lines -replace "^$($pair.k)=.*$", $line } else { $lines += $line }
        }
        $lines | Set-Content -Path $envPath -Encoding UTF8
        Write-Ok "COOKIE_SECURE=true et CORS_ORIGIN=$BaseUrl"

        # Le service tourne comme service Windows ou comme tâche planifiée, selon que NSSM
        # était présent à l'installation : on redémarre celui qui existe.
        if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
            Restart-Service -Name $ServiceName
            Write-Ok "Service $ServiceName redémarré"
        } elseif (Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
            Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -and $_.CommandLine -like "*$ServicePath*" } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            Start-Sleep -Milliseconds 500
            Start-ScheduledTask -TaskName $ServiceName
            Write-Ok "Tâche planifiée $ServiceName redémarrée"
        } else {
            Write-Warn "Ni service Windows ni tâche planifiée $ServiceName : redémarrez le service à la main pour appliquer COOKIE_SECURE."
        }
    }
}

Write-Step 'Bascule terminée'
Write-Host "    Application : $BaseUrl" -ForegroundColor White
Write-Host ""
Write-Host "    Vérification :" -ForegroundColor Yellow
Write-Host "      .\Test-SuiviInfra.ps1 -HostName $HostName -Protocol https -Port $Port$(if ($WithService) { ' -WithService' })"
Write-Host ""
Write-Host "    Les sessions ouvertes en HTTP sont invalidées : chacun doit se reconnecter." -ForegroundColor Yellow
Write-Host ""
