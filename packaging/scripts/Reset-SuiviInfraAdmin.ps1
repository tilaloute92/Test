<#
.SYNOPSIS
    Crée ou réinitialise un compte local de « Suivi Infra & Réseau ».

.DESCRIPTION
    À utiliser quand personne ne peut plus se connecter : mot de passe oublié, compte jamais
    créé, ou installation interrompue avant cette étape. Le script ne touche à rien d'autre —
    ni au site, ni au service, ni aux données d'équipe.

    Il doit être lancé depuis une console ADMINISTRATEUR : le dossier de données est réservé
    aux administrateurs et au compte SYSTEM, et appartenir au groupe ne suffit pas sans
    élévation.

.PARAMETER UserName
    Identifiant à créer ou dont le mot de passe est réinitialisé. Défaut : admin.

.PARAMETER Password
    Mot de passe en clair (8 caractères minimum). Si omis, il est demandé de façon masquée.
    Passer -Password inscrit le mot de passe dans l'historique PowerShell : préférez la
    saisie interactive.

.PARAMETER FullName
    Nom complet affiché dans l'application. Défaut : Administrateur.

.EXAMPLE
    .\Reset-SuiviInfraAdmin.ps1
    Réinitialise « admin », mot de passe demandé de façon masquée.

.EXAMPLE
    .\Reset-SuiviInfraAdmin.ps1 -UserName rnelson -FullName "R. Nelson"
#>

[CmdletBinding()]
param(
    [string] $UserName = 'admin',
    [string] $Password,
    [string] $FullName = 'Administrateur',
    [string] $ServicePath = 'C:\services\suivi-infra'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script doit être lancé depuis une console PowerShell *Administrateur* : le dossier de données n'est pas lisible autrement."
}

if (-not (Test-Path (Join-Path $ServicePath 'scripts\create-local-user.js'))) {
    throw "Service introuvable dans $ServicePath. Précisez -ServicePath si vous l'avez installé ailleurs."
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js introuvable dans le PATH." }

if (-not $Password) {
    $s1 = Read-Host "Nouveau mot de passe pour « $UserName » (8 caractères minimum)" -AsSecureString
    $s2 = Read-Host 'Confirmez' -AsSecureString
    $p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
    $p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
    if ($p1 -ne $p2) { throw 'Les deux saisies diffèrent.' }
    $Password = $p1
}
if ($Password.Length -lt 8) { throw 'Le mot de passe doit faire au moins 8 caractères.' }

# Le mot de passe est remis à Node par une variable d'environnement : il n'apparaît ainsi ni
# dans la liste des processus, ni dans l'historique PowerShell.
$env:SUIVI_INFRA_PASSWORD = $Password
try {
    Push-Location $ServicePath
    # --name : un argument vide serait escamoté par Windows PowerShell 5.1 et le nom complet
    # prendrait la place du mot de passe.
    & $node.Source 'scripts\create-local-user.js' $UserName '--name' $FullName
    if ($LASTEXITCODE -ne 0) { throw "La création du compte a échoué (code $LASTEXITCODE)." }
} finally {
    Pop-Location
    Remove-Item Env:\SUIVI_INFRA_PASSWORD -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "Compte « $UserName » prêt. Connectez-vous par l'onglet « Compte local »." -ForegroundColor Green
Write-Host ''
