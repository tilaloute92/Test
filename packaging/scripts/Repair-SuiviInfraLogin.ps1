<#
.SYNOPSIS
    Diagnostique et répare l'impossibilité de se connecter à « Suivi Infra & Réseau ».

.DESCRIPTION
    À utiliser quand l'écran de connexion répond « Identifiant ou mot de passe incorrect »
    avec les identifiants attendus. Ce message vient du service lui-même : il prouve que le
    service tourne et que le relais /api fonctionne, et que le compte visé n'existe pas ou
    n'a pas le mot de passe supposé.

    Le script ne suppose rien. Il :
      1. retrouve le dossier réellement utilisé par le service, depuis la tâche planifiée —
         et non depuis un chemin supposé, car une installation antérieure ailleurs suffit à
         ce que le compte soit créé dans un dossier que le service ne lit pas ;
      2. affiche les comptes réellement présents (identifiants seuls : les mots de passe ne
         sont stockés que sous forme d'empreinte bcrypt, et rien ne permet de les relire) ;
      3. fixe le mot de passe que vous choisissez ;
      4. le VÉRIFIE en appelant la vraie API de connexion, celle qu'utilise le navigateur.

    L'étape 4 est le cœur du script : écrire le fichier ne prouve pas qu'on pourra se
    connecter. Seule une réponse HTTP 200 de /api/auth/local le prouve.

    Il ne touche ni au site, ni aux données d'équipe, ni aux autres comptes.

.PARAMETER UserName
    Compte à créer ou à réinitialiser. Défaut : admin.

.PARAMETER Password
    Mot de passe en clair (8 caractères minimum). Omis, il est demandé de façon masquée.

.PARAMETER FullName
    Nom complet affiché. Défaut : l'identifiant.

.PARAMETER ServicePath
    Dossier du service, si la tâche planifiée est absente ou pointe ailleurs.

.PARAMETER DiagnoseOnly
    N'écrit rien : se contente d'afficher le diagnostic.

.EXAMPLE
    .\Repair-SuiviInfraLogin.ps1
    Diagnostic complet, puis réinitialisation de « admin » avec saisie masquée.

.EXAMPLE
    .\Repair-SuiviInfraLogin.ps1 -DiagnoseOnly
#>

[CmdletBinding()]
param(
    [string] $UserName = 'admin',
    [string] $Password,
    [string] $FullName,
    [string] $ServicePath,
    [switch] $DiagnoseOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ServiceName = 'SuiviInfraAuth'

function Write-Titre($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Write-Ok($t)    { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Write-Ko($t)    { Write-Host "  [ECHEC] $t" -ForegroundColor Red }
function Write-Info($t)  { Write-Host "          $t" -ForegroundColor Gray }

# Un proxy d'entreprise configuré au niveau du système intercepte jusqu'aux appels à
# 127.0.0.1 et ferait échouer la vérification finale pour une raison sans rapport.
[System.Net.WebRequest]::DefaultWebProxy = $null

Write-Host ''
Write-Host 'Diagnostic de connexion - Suivi Infra & Reseau' -ForegroundColor White

# --- 1. Élévation -----------------------------------------------------------------------
Write-Titre 'Droits'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$estAdmin = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $estAdmin) {
    Write-Ko 'Console non élevée'
    Write-Info "Le dossier de données est réservé aux administrateurs et à SYSTEM : sans"
    Write-Info "élévation ce script ne peut ni le lire ni le corriger. Rouvrez PowerShell par"
    Write-Info 'clic droit -> « Exécuter en tant qu''administrateur ».'
    Write-Info "Appartenir au groupe Administrateurs ne suffit pas : sans élévation, Windows"
    Write-Info 'retire ce groupe du jeton de la session.'
    exit 1
}
Write-Ok "Console administrateur ($($identity.Name))"

# --- 2. Dossier réellement utilisé par le service ---------------------------------------
Write-Titre 'Dossier du service'
$cheminTache = $null
# L'installateur pose soit un vrai service Windows (quand NSSM est présent), soit une tâche
# planifiée, sous le même nom. Chercher l'un sans l'autre laisserait la moitié des
# installations sans diagnostic.
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Ok "Service Windows « $ServiceName » : état $($svc.Status)"
    try {
        $chemin = (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").PathName
        if ($chemin -match '"?([A-Za-z]:\\[^"]*?)\\src\\index\.js') { $cheminTache = $Matches[1] }
    } catch { }
}
$tache = Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
if ($tache) {
    Write-Ok "Tâche planifiée « $ServiceName » : état $($tache.State)"
    # Le dossier de travail de la tâche, ou à défaut celui du programme lancé : c'est là que
    # le service lit ses données, quoi qu'en dise le paramètre -ServicePath.
    $action = @($tache.Actions)[0]
    $repTravail = if ($action.PSObject.Properties['WorkingDirectory']) { [string]$action.WorkingDirectory } else { '' }
    $programme  = if ($action.PSObject.Properties['Execute'])          { [string]$action.Execute }          else { '' }
    if ($repTravail)     { $cheminTache = $repTravail }
    elseif ($programme)  { $cheminTache = Split-Path -Parent $programme }
    if ($cheminTache) { Write-Info "Dossier de travail déclaré : $cheminTache" }
} elseif (-not $svc) {
    Write-Ko "Ni service Windows ni tâche planifiée nommés « $ServiceName »"
    Write-Info "Le service n'est pas installé, ou porte un autre nom."
}

if ($ServicePath) {
    if ($cheminTache -and ($cheminTache.TrimEnd('\') -ne $ServicePath.TrimEnd('\'))) {
        Write-Host "  [ALERTE] -ServicePath ($ServicePath) diffère du dossier de la tâche ($cheminTache)." -ForegroundColor Yellow
        Write-Info "C'est exactement le cas où l'on crée un compte que le service ne lira jamais."
        Write-Info '-ServicePath est prioritaire ; retirez-le pour suivre la tâche planifiée.'
    }
} elseif ($cheminTache) {
    $ServicePath = $cheminTache
} else {
    $ServicePath = 'C:\services\suivi-infra'
    Write-Info "Aucune source fiable : repli sur $ServicePath"
}

$localAuth = Join-Path $ServicePath 'src\auth\localAuth.js'
if (-not (Test-Path $localAuth)) {
    Write-Ko "Service introuvable dans $ServicePath (src\auth\localAuth.js absent)"
    Write-Info 'Précisez -ServicePath avec le dossier où le service a été installé.'
    exit 1
}
Write-Ok "Service localisé : $ServicePath"

if (-not (Test-Path (Join-Path $ServicePath 'node_modules\bcryptjs'))) {
    Write-Ko 'Dépendance bcryptjs absente de node_modules'
    Write-Info "Le service ne peut pas vérifier un mot de passe. Réinstallez le paquet."
    exit 1
}
Write-Ok 'Dépendance bcryptjs présente'

# --- 3. Port réellement écouté ----------------------------------------------------------
Write-Titre 'Port du service'
$port = 4000
$envFile = Join-Path $ServicePath '.env'
if (Test-Path $envFile) {
    $ligne = Get-Content $envFile | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -Last 1
    if ($ligne -and ($ligne -split '=', 2)[1].Trim() -match '^\d+$') {
        $port = [int](($ligne -split '=', 2)[1].Trim())
    }
    Write-Ok "PORT lu dans .env : $port"
} else {
    Write-Ko ".env absent de $ServicePath - le service ne peut pas démarrer (JWT_SECRET manquant)"
    Write-Info "Port supposé : $port"
}

$ecoute = $false
try { $ecoute = [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) } catch { $ecoute = $false }
if ($ecoute) { Write-Ok "Quelque chose écoute sur le port $port" }
else { Write-Ko "Rien n'écoute sur le port $port - le service n'est pas démarré" }

# --- 4. Comptes réellement présents -----------------------------------------------------
Write-Titre 'Comptes locaux enregistres'
$usersFile = Join-Path $ServicePath 'data\users.json'
$comptes = @()
if (-not (Test-Path $usersFile)) {
    Write-Ko "data\users.json absent : AUCUN compte n'a jamais été créé dans ce dossier"
} else {
    $brut = (Get-Content $usersFile -Raw)
    if (-not $brut.Trim()) {
        Write-Ko 'data\users.json vide'
    } else {
        try {
            $comptes = @($brut | ConvertFrom-Json)
        } catch {
            Write-Ko "data\users.json illisible : $($_.Exception.Message)"
        }
    }
}

if ($comptes.Count -eq 0) {
    Write-Ko 'Aucun compte : toute connexion sera refusée, quel que soit le mot de passe saisi'
} else {
    Write-Ok "$($comptes.Count) compte(s) :"
    foreach ($c in $comptes) {
        $nom  = if ($c.PSObject.Properties['username'])     { [string]$c.username }     else { '' }
        $hash = if ($c.PSObject.Properties['passwordHash']) { [string]$c.passwordHash } else { '' }
        # Seul le préfixe de l'empreinte est affiché : il suffit à confirmer que c'est bien
        # du bcrypt (et non un champ vide ou tronqué), sans divulguer l'empreinte complète.
        $etat = if ($hash -match '^\$2[aby]\$\d\d\$' -and $hash.Length -ge 59) {
            "empreinte bcrypt valide ($($hash.Substring(0,7))..., $($hash.Length) car.)"
        } elseif (-not $hash) { 'AUCUNE EMPREINTE - compte inutilisable' }
        else { "EMPREINTE SUSPECTE ($($hash.Length) car.) - compte inutilisable" }
        Write-Info "- $(if ($nom) { $nom } else { '(sans identifiant)' })  [$etat]"
    }
    $vise = $comptes | Where-Object {
        $_.PSObject.Properties['username'] -and ([string]$_.username).ToLower() -eq $UserName.ToLower()
    }
    if ($vise) { Write-Ok "Le compte « $UserName » existe : le mot de passe saisi ne correspond pas" }
    else       { Write-Ko "Le compte « $UserName » N'EXISTE PAS dans ce fichier" }
}

if ($DiagnoseOnly) {
    Write-Host ''
    Write-Host 'Diagnostic seul (-DiagnoseOnly) : rien n''a été modifié.' -ForegroundColor Yellow
    Write-Host 'Relancez sans ce paramètre pour fixer un mot de passe.' -ForegroundColor Yellow
    Write-Host ''
    exit 0
}

# --- 5. Nouveau mot de passe ------------------------------------------------------------
Write-Titre 'Nouveau mot de passe'
if (-not $Password) {
    $s1 = Read-Host "Mot de passe pour « $UserName » (8 caractères minimum)" -AsSecureString
    $s2 = Read-Host 'Confirmez' -AsSecureString
    $p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
    $p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
    if ($p1 -ne $p2) { Write-Ko 'Les deux saisies diffèrent.'; exit 1 }
    $Password = $p1
}
if ($Password.Length -lt 8) { Write-Ko 'Le mot de passe doit faire au moins 8 caractères.'; exit 1 }
if (-not $FullName) { $FullName = $UserName }

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { Write-Ko 'node.exe introuvable dans le PATH.'; exit 1 }

# Le travail est confié à un script Node temporaire déposé DANS le dossier du service,
# plutôt qu'au script create-local-user.js qui s'y trouve déjà. Raison : ce dernier a changé
# de convention d'arguments d'une version à l'autre, et ce script doit pouvoir réparer une
# installation plus ancienne que lui. La fonction upsertLocalUser, elle, n'a jamais changé.
# Identifiant et mot de passe passent par l'environnement : ils n'apparaissent ainsi ni dans
# la liste des processus, ni dans l'historique du terminal.
$temp = Join-Path $ServicePath ('repair-login-{0}.mjs' -f [guid]::NewGuid().ToString('N'))
$corps = @'
import { upsertLocalUser, verifyLocalLogin, listLocalUsers } from './src/auth/localAuth.js';
const u = process.env.SUIVI_REPAIR_USER;
const p = process.env.SUIVI_REPAIR_PASSWORD;
const n = process.env.SUIVI_REPAIR_NAME || u;
await upsertLocalUser(u, p, n);
if (!(await verifyLocalLogin(u, p))) {
  console.error('ECHEC: le compte a ete ecrit mais ne se verifie pas.');
  process.exit(1);
}
console.log('ECRIT:' + listLocalUsers().map((x) => x.username).join(','));
'@

$env:SUIVI_REPAIR_USER     = $UserName
$env:SUIVI_REPAIR_PASSWORD = $Password
$env:SUIVI_REPAIR_NAME     = $FullName
$sortie = $null
try {
    Set-Content -Path $temp -Value $corps -Encoding UTF8
    Push-Location $ServicePath
    $sortie = & $node.Source $temp 2>&1
    $code = $LASTEXITCODE
} finally {
    Pop-Location
    Remove-Item $temp -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\SUIVI_REPAIR_USER -ErrorAction SilentlyContinue
    Remove-Item Env:\SUIVI_REPAIR_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\SUIVI_REPAIR_NAME -ErrorAction SilentlyContinue
}

if ($code -ne 0) {
    Write-Ko "Écriture du compte impossible (code $code)"
    $sortie | ForEach-Object { Write-Info $_ }
    if ("$sortie" -match 'EPERM|EACCES') {
        Write-Info "Accès refusé au dossier data\ malgré l'élévation : vérifiez que le compte"
        Write-Info 'courant figure bien dans les ACL, ou reprenez la propriété du dossier.'
    }
    exit 1
}
Write-Ok "Compte « $UserName » écrit et relu avec succès"
$sortie | Where-Object { $_ -like 'ECRIT:*' } | ForEach-Object {
    Write-Info "Comptes présents : $($_.Substring(6))"
}

# --- 6. Vérification par la vraie API ---------------------------------------------------
# C'est la seule étape qui prouve quoi que ce soit. Écrire le fichier ne dit pas que le
# service le lit : il peut tourner depuis un autre dossier, ou ne pas tourner du tout.
Write-Titre 'Verification par l''API de connexion'
if (-not $ecoute) {
    Write-Ko "Service arrêté : impossible de vérifier. Démarrez-le, puis relancez avec -DiagnoseOnly."
    Write-Info "Start-ScheduledTask -TaskName $ServiceName   (ou Start-Service $ServiceName)"
    exit 1
}

$corpsJson = @{ username = $UserName; password = $Password } | ConvertTo-Json -Compress
$verifOk = $false
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/auth/local" -Method Post `
        -ContentType 'application/json' -Body $corpsJson -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -eq 200) {
        Write-Ok "POST /api/auth/local -> 200 : la connexion fonctionne réellement"
        $verifOk = $true
        if ("$($r.Content)" -match '"defaultPassword"\s*:\s*true') {
            Write-Host '  [ALERTE] Ce mot de passe est un mot de passe PUBLIC connu.' -ForegroundColor Yellow
            Write-Host '           Relancez ce script avec un mot de passe qui vous est propre.' -ForegroundColor Yellow
        }
    }
} catch {
    $statut = $null
    if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
        try { $statut = [int]$_.Exception.Response.StatusCode } catch { $statut = $null }
    }
    switch ($statut) {
        401 {
            Write-Ko 'POST /api/auth/local -> 401 alors que le fichier vient d''être vérifié'
            Write-Info "Le service tourne donc sur d'AUTRES données que $ServicePath\data."
            Write-Info 'Comparez le dossier de travail de la tâche planifiée avec celui réparé :'
            Write-Info "Get-ScheduledTask -TaskName $ServiceName | Select-Object -Expand Actions"
        }
        429 {
            Write-Host '  [ALERTE] POST /api/auth/local -> 429 : trop de tentatives récentes.' -ForegroundColor Yellow
            Write-Info 'Le compte est réparé, mais le service refuse temporairement les essais'
            Write-Info '(10 par quart d''heure). Le compteur est en mémoire : redémarrer le'
            Write-Info 'service le remet à zéro immédiatement.'
            Write-Info "Restart-ScheduledTask -TaskName $ServiceName   (ou Restart-Service $ServiceName)"
        }
        default {
            Write-Ko "POST /api/auth/local a échoué : $($_.Exception.Message)"
        }
    }
}

Write-Host ''
if ($verifOk) {
    Write-Host "Connectez-vous sur l'onglet « Compte local » avec l'identifiant « $UserName »." -ForegroundColor Green
    Write-Host 'Si le navigateur refuse encore, videz son cache (Ctrl+Maj+Suppr) : il peut' -ForegroundColor Gray
    Write-Host "retenir une ancienne version de l'application." -ForegroundColor Gray
} else {
    Write-Host 'Le compte est en place mais la connexion n''a pas pu être prouvée. Ne concluez' -ForegroundColor Yellow
    Write-Host 'pas que c''est réglé : traitez d''abord le point signalé ci-dessus.' -ForegroundColor Yellow
}
Write-Host ''
