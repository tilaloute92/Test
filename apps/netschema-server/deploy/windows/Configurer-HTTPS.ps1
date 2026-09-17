<#
.SYNOPSIS
    Active le HTTPS sur un service NetSchema déjà installé.

.DESCRIPTION
    Le service lit directement un certificat au format PFX — celui qu'exporte le magasin
    Windows. Aucune conversion, aucun OpenSSL à installer.

    Deux façons de désigner le certificat :
      • un fichier .pfx et son mot de passe ;
      • l'empreinte d'un certificat déjà présent dans le magasin de l'ordinateur, que le
        script exporte lui-même.

    Le script copie le certificat dans le dossier de données, en réserve la lecture au
    service, bascule la configuration (port, cookies « Secure »), redémarre et vérifie que
    l'application répond bien en HTTPS.

.EXAMPLE
    .\Configurer-HTTPS.ps1 -Pfx C:\Certificats\winas.pfx

.EXAMPLE
    .\Configurer-HTTPS.ps1 -Empreinte 9F2C4A...   # certificat déjà dans le magasin

.NOTES
    À lancer en administrateur, après Installer-NetSchema.ps1.
#>

[CmdletBinding()]
param(
    [string]$Pfx,
    [string]$Empreinte,
    [int]$Port = 8443,
    [string]$InstallDir = 'C:\Apps\NetSchema',
    [string]$DataDir = 'C:\ProgramData\NetSchema\data',
    [string]$ServiceName = 'NetSchema',
    [switch]$SansPause
)

$ErrorActionPreference = 'Stop'

function Etape([string]$t) { Write-Host "  → $t" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "    $t" -ForegroundColor Green }
function Info([string]$t) { Write-Host "    $t" -ForegroundColor Gray }

function Invoke-Externe {
    <# Lance un programme externe sans laisser sa sortie d'erreur interrompre le script. #>
    param([string]$Fichier, [string[]]$Arguments)
    $precedent = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $sortie = & $Fichier @Arguments 2>&1 | ForEach-Object { "$_" }
        return [pscustomobject]@{ Code = $LASTEXITCODE; Sortie = ($sortie -join [Environment]::NewLine) }
    } catch {
        return [pscustomobject]@{ Code = -1; Sortie = $_.Exception.Message }
    } finally { $ErrorActionPreference = $precedent }
}

function Nom-Compte {
    <#
        Nom local d'un compte à partir de son identifiant de sécurité : sur un Windows
        français, les administrateurs s'appellent « BUILTIN\Administrateurs ».
    #>
    param([string]$Sid)
    try {
        return (New-Object Security.Principal.SecurityIdentifier($Sid)).Translate(
            [Security.Principal.NTAccount]).Value
    } catch { return $null }
}

function Compte-Du-Service {
    param([string]$Nom)
    try {
        $service = Get-CimInstance Win32_Service -Filter "Name='$Nom'" -ErrorAction SilentlyContinue
        if ($service -and $service.StartName) {
            if ($service.StartName -match '^(LocalSystem|\.\\LocalSystem)$') { return (Nom-Compte 'S-1-5-18') }
            return $service.StartName
        }
    } catch { }
    return $null
}

function Ecrire-Fichier {
    param([string]$Chemin, [string[]]$Lignes)
    [IO.File]::WriteAllLines($Chemin, $Lignes, (New-Object Text.UTF8Encoding $false))
}

function Definir-Variable {
    param([string[]]$Lignes, [string]$Nom, [string]$Valeur)
    $trouve = $false
    $resultat = foreach ($ligne in $Lignes) {
        if ($ligne -match "^\s*#?\s*$Nom=") {
            $trouve = $true
            "$Nom=$Valeur"
        } else { $ligne }
    }
    if (-not $trouve) { $resultat = @($resultat) + "$Nom=$Valeur" }
    return @($resultat)
}

$identite = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identite).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "À lancer dans une console PowerShell « exécuter en tant qu'administrateur »."
}

$fichierEnv = Join-Path $InstallDir 'netschema.env'
if (-not (Test-Path $fichierEnv)) {
    throw "Configuration introuvable ($fichierEnv). Lancez d'abord Installer-NetSchema.ps1."
}

Write-Host ''
Write-Host '  NetSchema — activation du HTTPS' -ForegroundColor White
Write-Host ''

# ── 1. Obtenir le certificat ─────────────────────────────────────────────────
$dossierTls = Join-Path $DataDir 'tls'
New-Item -ItemType Directory -Force -Path $dossierTls | Out-Null
$destination = Join-Path $dossierTls 'netschema.pfx'

if ($Empreinte) {
    Etape "Export du certificat $Empreinte depuis le magasin de l'ordinateur"
    $certificat = Get-ChildItem Cert:\LocalMachine\My |
        Where-Object { $_.Thumbprint -eq ($Empreinte -replace '\s', '').ToUpper() }
    if (-not $certificat) { throw "Certificat $Empreinte introuvable dans Cert:\LocalMachine\My." }
    if (-not $certificat.HasPrivateKey) { throw 'Ce certificat n''a pas de clé privée : il ne peut pas servir au serveur.' }

    # Mot de passe tiré au hasard : il ne sert qu'à protéger le fichier sur le disque, et
    # n'a donc pas à être mémorisé par qui que ce soit.
    $octets = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($octets)
    $motDePasse = [Convert]::ToBase64String($octets)
    $secret = ConvertTo-SecureString -String $motDePasse -AsPlainText -Force
    Export-PfxCertificate -Cert $certificat -FilePath $destination -Password $secret -Force | Out-Null
    Ok "Certificat exporté : $($certificat.Subject)"
    Info "Expire le $($certificat.NotAfter.ToString('dd/MM/yyyy'))"
} else {
    if (-not $Pfx) { $Pfx = Read-Host '  Chemin du fichier .pfx' }
    if (-not (Test-Path $Pfx)) { throw "Fichier introuvable : $Pfx" }
    $secret = Read-Host '  Mot de passe du PFX' -AsSecureString
    $motDePasse = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret))

    Etape 'Vérification du certificat'
    try {
        $certificat = New-Object Security.Cryptography.X509Certificates.X509Certificate2(
            $Pfx, $motDePasse, 'DefaultKeySet')
    } catch {
        throw "Le certificat n'a pas pu être ouvert : mot de passe incorrect, ou fichier illisible."
    }
    if (-not $certificat.HasPrivateKey) { throw 'Ce PFX ne contient pas de clé privée.' }
    Ok "Certificat : $($certificat.Subject)"
    Info "Expire le $($certificat.NotAfter.ToString('dd/MM/yyyy'))"
    Copy-Item $Pfx $destination -Force
}

# Lecture réservée : la clé privée est dans ce fichier.
$compte = Compte-Du-Service -Nom $ServiceName
if (-not $compte) { $compte = (Nom-Compte 'S-1-5-18') }
$administrateurs = Nom-Compte 'S-1-5-32-544'
$systeme = Nom-Compte 'S-1-5-18'

$droits = @($dossierTls, '/inheritance:r', '/grant:r', "$($compte):(OI)(CI)R")
if ($administrateurs) { $droits += "$($administrateurs):(OI)(CI)F" }
if ($systeme -and $systeme -ne $compte) { $droits += "$($systeme):(OI)(CI)F" }
$resultat = Invoke-Externe -Fichier 'icacls' -Arguments $droits
if ($resultat.Code -ne 0) {
    Write-Host "    Droits non restreints sur $dossierTls : à vérifier." -ForegroundColor Yellow
}
Ok "Certificat installé : $destination"

# ── 2. Configuration ─────────────────────────────────────────────────────────
Etape 'Mise à jour de la configuration'
$lignes = Get-Content $fichierEnv
$lignes = Definir-Variable -Lignes $lignes -Nom 'NETSCHEMA_TLS_PFX' -Valeur $destination
$lignes = Definir-Variable -Lignes $lignes -Nom 'NETSCHEMA_TLS_PASSPHRASE' -Valeur $motDePasse
$lignes = Definir-Variable -Lignes $lignes -Nom 'NETSCHEMA_PORT' -Valeur $Port
$lignes = Definir-Variable -Lignes $lignes -Nom 'NETSCHEMA_SECURE_COOKIES' -Valeur 'true'
Ecrire-Fichier -Chemin $fichierEnv -Lignes $lignes

# Le mot de passe du certificat est dans ce fichier : il ne se lit plus que par le service.
$droitsEnv = @($fichierEnv, '/inheritance:r', '/grant:r', "$($compte):R")
if ($administrateurs) { $droitsEnv += "$($administrateurs):F" }
if ($systeme -and $systeme -ne $compte) { $droitsEnv += "$($systeme):F" }
Invoke-Externe -Fichier 'icacls' -Arguments $droitsEnv | Out-Null
Ok "Port $Port, cookies « Secure », certificat déclaré."

# ── 3. Service ───────────────────────────────────────────────────────────────
$nssm = Join-Path $InstallDir 'nssm.exe'
if (Test-Path $nssm) {
    Etape 'Mise à jour des variables du service'
    $variables = Get-Content $fichierEnv | Where-Object { $_ -match '^[A-Z][A-Z_]*=' } | ForEach-Object { $_.Trim() }
    Invoke-Externe -Fichier $nssm -Arguments (@('set', $ServiceName, 'AppEnvironmentExtra') + $variables) | Out-Null
}

Etape 'Ouverture du port dans le pare-feu'
try {
    Get-NetFirewallRule -DisplayName 'NetSchema*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName "NetSchema ($Port/TCP)" -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $Port -Profile Domain, Private | Out-Null
    Ok "Port $Port ouvert."
} catch {
    Write-Host "    Règle de pare-feu non créée : ouvrez le port $Port à la main." -ForegroundColor Yellow
}

Etape 'Redémarrage'
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Restart-Service -Name $ServiceName
} elseif (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
}

# ── 4. Vérification ──────────────────────────────────────────────────────────
Etape 'Vérification'
# Le certificat est peut-être émis pour le nom public du serveur, pas pour 127.0.0.1 :
# à ce stade on vérifie que le TLS répond, pas que le nom concorde.
$rappelInitial = [Net.ServicePointManager]::ServerCertificateValidationCallback
[Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$repond = $false
$fin = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $fin -and -not $repond) {
    try {
        $reponse = Invoke-RestMethod -Uri "https://127.0.0.1:$Port/api/health" -TimeoutSec 3
        if ($reponse.ok) { $repond = $true }
    } catch { Start-Sleep -Seconds 2 }
}
[Net.ServicePointManager]::ServerCertificateValidationCallback = $rappelInitial

Write-Host ''
if ($repond) {
    $nom = $env:COMPUTERNAME
    if ($certificat.Subject -match 'CN=([^,]+)') { $nom = $Matches[1].Trim() }
    Write-Host '  NetSchema répond maintenant en HTTPS.' -ForegroundColor Green
    Write-Host ''
    Write-Host "    Adresse    https://$($nom):$Port" -ForegroundColor White
    Write-Host "    Certificat $destination"
    Write-Host "    Expire le  $($certificat.NotAfter.ToString('dd/MM/yyyy'))"
    Write-Host ''
    Write-Host '    Les anciens favoris en http:// ne fonctionnent plus : le service ne répond'
    Write-Host '    plus qu''en HTTPS, sur le port ci-dessus.'
} else {
    Write-Host '  Le service ne répond pas en HTTPS.' -ForegroundColor Red
    $journal = Join-Path $DataDir 'service.log'
    if (Test-Path $journal) { Get-Content $journal -Tail 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
    Write-Host ''
    Write-Host '  Pour revenir en arrière : remettez NETSCHEMA_SECURE_COOKIES=false, commentez' -ForegroundColor Yellow
    Write-Host "  NETSCHEMA_TLS_PFX dans $fichierEnv, puis Restart-Service $ServiceName" -ForegroundColor Yellow
}
Write-Host ''

if (-not $SansPause) { Read-Host '  Appuyez sur Entrée pour fermer' | Out-Null }
