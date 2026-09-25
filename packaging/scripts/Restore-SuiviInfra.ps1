<#
.SYNOPSIS
    Restaure les données de « Suivi Infra & Réseau » depuis une sauvegarde.

.DESCRIPTION
    Accepte les DEUX formes de sauvegarde que produit ce produit, et les reconnaît seule :

      * un DOSSIER de sauvegarde créé par Backup-SuiviInfra.ps1 (business-*.json,
        users.json, éventuellement env.sauvegarde) ;
      * un FICHIER d'export fait depuis l'application, onglet Paramètres
        (sauvegarde_suivi-infra_AAAA-MM-JJ.json). En mode client/serveur, l'application
        refuse volontairement de réimporter ce fichier elle-même : côté navigateur, la
        restauration n'aurait aucun effet sur le serveur et disparaîtrait à l'actualisation
        suivante. C'est donc ici que cela se fait.

    Déroulé, dans cet ordre, parce qu'il est le seul qui ne perd rien :

      1. la sauvegarde est VALIDÉE avant que quoi que ce soit ne soit touché — chaque JSON
         est relu ; une sauvegarde illisible est refusée plutôt que restaurée à moitié ;
      2. le service est ARRÊTÉ. Sans cela il continuerait de servir sa copie mémoire et
         réécrirait par-dessus la restauration à la première modification ;
      3. les données actuelles sont MISES DE CÔTÉ, jamais supprimées : elles partent dans
         data\_avant_restauration_<horodatage>\, à l'intérieur du dossier protégé, d'où on
         peut revenir en arrière ;
      4. les fichiers sont copiés, le service est redémarré, et la restauration est
         VÉRIFIÉE par la sonde du service.

    Les comptes locaux (users.json) ne sont restaurés qu'avec -IncludeUsers : restaurer des
    données anciennes n'a pas de raison de faire revenir des comptes supprimés depuis, ni de
    réinstaller un ancien mot de passe.

.PARAMETER Source
    Dossier de sauvegarde, ou fichier d'export .json de l'application.

.PARAMETER ServicePath
    Dossier du service. Déduit du service installé s'il n'est pas précisé.

.PARAMETER IncludeUsers
    Restaure aussi les comptes locaux (users.json) présents dans la sauvegarde.

.PARAMETER IncludeEnv
    Restaure aussi env.sauvegarde en tant que .env. ATTENTION : cela remet l'ancien secret
    de session — toutes les sessions ouvertes sont invalidées — et l'ancienne configuration
    LDAP et SMTP.

.PARAMETER DryRun
    Valide la sauvegarde et affiche ce qui serait fait, sans rien modifier.

.EXAMPLE
    .\Restore-SuiviInfra.ps1 -Source D:\sauvegardes\suivi-infra\2026-09-20_0200 -DryRun

.EXAMPLE
    .\Restore-SuiviInfra.ps1 -Source D:\sauvegardes\suivi-infra\2026-09-20_0200

.EXAMPLE
    .\Restore-SuiviInfra.ps1 -Source C:\Users\moi\Downloads\sauvegarde_suivi-infra_2026-09-12.json
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Source,
    [string] $ServicePath,
    [switch] $IncludeUsers,
    [switch] $IncludeEnv,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ServiceName = 'SuiviInfraAuth'
# Collections d'équipe servies par le serveur. apiConnections, requestHistory et
# authSettings figurent dans l'export de l'application mais ne sont PAS des données
# d'équipe (identifiants de test personnels, réglages SSO du poste) : le serveur ne les
# gère pas, et les restaurer ici n'aurait aucun sens.
$COLLECTIONS = @('members', 'tasks', 'planningSlots', 'timeEntries', 'absences', 'roadmapItems', 'copils')

function Write-Titre($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Write-Ok($t)    { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Write-Ko($t)    { Write-Host "  [ECHEC] $t" -ForegroundColor Red }
function Write-Alerte($t){ Write-Host "  [ALERTE] $t" -ForegroundColor Yellow }
function Write-Info($t)  { Write-Host "          $t" -ForegroundColor Gray }

[System.Net.WebRequest]::DefaultWebProxy = $null

Write-Host ''
Write-Host 'Restauration - Suivi Infra & Reseau' -ForegroundColor White

# --- Élévation --------------------------------------------------------------------------
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Ko 'Console non élevée : le dossier de données est réservé aux administrateurs.'
    Write-Info 'Rouvrez PowerShell par clic droit -> « Exécuter en tant qu''administrateur ».'
    exit 1
}

# --- Où est le service ? ------------------------------------------------------------------
Write-Titre 'Service'
$svc   = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$tache = Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
if (-not $ServicePath) {
    if ($tache) {
        $action = @($tache.Actions)[0]
        if ($action.PSObject.Properties['WorkingDirectory'] -and $action.WorkingDirectory) {
            $ServicePath = [string]$action.WorkingDirectory
        } elseif ($action.PSObject.Properties['Execute'] -and $action.Execute) {
            $ServicePath = Split-Path -Parent ([string]$action.Execute)
        }
    }
    if (-not $ServicePath -and $svc) {
        try {
            $p = (Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").PathName
            if ($p -match '"?([A-Za-z]:\\[^"]*?)\\src\\index\.js') { $ServicePath = $Matches[1] }
        } catch { }
    }
    if (-not $ServicePath) { $ServicePath = 'C:\services\suivi-infra' }
}
if ($svc)   { Write-Ok "Service Windows « $ServiceName » : $($svc.Status)" }
if ($tache) { Write-Ok "Tâche planifiée « $ServiceName » : $($tache.State)" }
if (-not $svc -and -not $tache) { Write-Alerte "Ni service ni tâche « $ServiceName » : rien à arrêter." }

$dataDir = Join-Path $ServicePath 'data'
if (-not (Test-Path (Join-Path $ServicePath 'src\index.js'))) {
    Write-Ko "Service introuvable dans $ServicePath. Précisez -ServicePath."
    exit 1
}
Write-Ok "Dossier du service : $ServicePath"

# --- Lecture et validation de la sauvegarde ----------------------------------------------
Write-Titre 'Lecture de la sauvegarde'
if (-not (Test-Path -LiteralPath $Source)) { Write-Ko "Introuvable : $Source"; exit 1 }
$estDossier = (Get-Item -LiteralPath $Source).PSIsContainer

$aRestaurer = @{}   # nom de fichier cible -> chemin source (forme dossier)
$exportJson = $null # chemin de l'export applicatif (forme fichier)

if ($estDossier) {
    Write-Ok 'Forme reconnue : dossier de sauvegarde Backup-SuiviInfra.ps1'
    $fichiers = @(Get-ChildItem -LiteralPath $Source -Filter '*.json' -File)
    if ($fichiers.Count -eq 0) { Write-Ko "Aucun fichier .json dans $Source."; exit 1 }
    $metierTrouve = 0
    foreach ($f in $fichiers) {
        try { Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json | Out-Null }
        catch { Write-Ko "Sauvegarde corrompue : $($f.Name) illisible ($($_.Exception.Message))."; exit 1 }
        if ($f.Name -eq 'users.json') {
            if ($IncludeUsers) { $aRestaurer[$f.Name] = $f.FullName; Write-Info "- $($f.Name) (comptes locaux, sur demande)" }
            else { Write-Info "- $($f.Name) IGNORE (ajoutez -IncludeUsers pour le restaurer)" }
            continue
        }
        $aRestaurer[$f.Name] = $f.FullName
        if ($f.Name -like 'business-*') { $metierTrouve++ }
        Write-Info "- $($f.Name)"
    }
    if ($metierTrouve -eq 0) {
        Write-Ko "Aucun fichier business-*.json : ce dossier n'est pas une sauvegarde de cette application."
        exit 1
    }
    Write-Ok "$($fichiers.Count) fichier(s) relu(s) sans erreur"
} else {
    Write-Ok 'Forme reconnue : fichier d''export de l''application'
    try { $contenu = Get-Content -LiteralPath $Source -Raw | ConvertFrom-Json }
    catch { Write-Ko "Fichier JSON illisible : $($_.Exception.Message)"; exit 1 }
    # L'export enveloppe les données dans « data » ; les anciens exports sont à plat.
    $payload = if ($contenu.PSObject.Properties['data']) { $contenu.data } else { $contenu }
    $manquants = @($COLLECTIONS | Where-Object { -not $payload.PSObject.Properties[$_] })
    if ($manquants.Count -gt 0) {
        Write-Ko "Ce fichier n'est pas une sauvegarde de cette application."
        Write-Info "Collections absentes : $($manquants -join ', ')"
        exit 1
    }
    foreach ($c in $COLLECTIONS) {
        Write-Info ('- {0,-14} {1} enregistrement(s)' -f $c, @($payload.$c).Count)
    }
    $ignores = @(@('apiConnections', 'requestHistory', 'authSettings') |
        Where-Object { $payload.PSObject.Properties[$_] })
    if ($ignores.Count -gt 0) {
        Write-Info "Non restaure (hors donnees d'equipe) : $($ignores -join ', ')"
    }
    $exportJson = (Resolve-Path -LiteralPath $Source).Path
}

if ($DryRun) {
    Write-Host ''
    Write-Host 'Validation seule (-DryRun) : la sauvegarde est exploitable, rien n''a ete modifie.' -ForegroundColor Yellow
    Write-Host ''
    exit 0
}

# --- Arrêt du service ----------------------------------------------------------------------
# Indispensable : le service sert une copie mémoire des données et la réécrit à la première
# modification. Restaurer sous un service actif revient à écrire des fichiers qu'il écrasera.
Write-Titre 'Arret du service'
if ($svc -and $svc.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceName -Force
    Write-Ok 'Service Windows arrete'
} elseif ($tache -and $tache.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $ServiceName
    Write-Ok 'Tache planifiee arretee'
} else {
    Write-Info 'Deja arrete.'
}
# Le processus node peut survivre brièvement à l'arrêt de la tâche : attendre qu'il libère
# réellement le fichier avant d'écrire, sinon la copie échoue ou le service écrase.
for ($i = 0; $i -lt 10; $i++) {
    $restants = @(Get-Process -Name 'node' -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and $_.Path.StartsWith($ServicePath, 'OrdinalIgnoreCase') } catch { $false }
    })
    if ($restants.Count -eq 0) { break }
    Start-Sleep -Seconds 1
}

# --- Mise de côté de l'existant --------------------------------------------------------------
Write-Titre 'Mise de cote des donnees actuelles'
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
if (-not (Test-Path -LiteralPath $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Info 'Aucune donnee existante : dossier data cree.'
    $archive = $null
} else {
    # Les anciens fichiers restent DANS data\, qui porte déjà les bonnes permissions : les
    # déplacer ailleurs les exposerait, et recréer le dossier lui ferait perdre ses ACL.
    $archive = Join-Path $dataDir "_avant_restauration_$stamp"
    New-Item -ItemType Directory -Path $archive -Force | Out-Null
    $anciens = @(Get-ChildItem -LiteralPath $dataDir -Filter '*.json' -File)
    foreach ($f in $anciens) { Move-Item -LiteralPath $f.FullName -Destination $archive -Force }
    Write-Ok "$($anciens.Count) fichier(s) mis de cote dans $archive"
    Write-Info "Pour revenir en arriere : remettre ces fichiers dans $dataDir"
}

# --- Écriture ------------------------------------------------------------------------------
Write-Titre 'Restauration'
if ($estDossier) {
    foreach ($nom in $aRestaurer.Keys) {
        Copy-Item -LiteralPath $aRestaurer[$nom] -Destination (Join-Path $dataDir $nom) -Force
    }
    Write-Ok "$($aRestaurer.Count) fichier(s) restaure(s)"
    if (-not (Test-Path (Join-Path $dataDir 'business-meta.json'))) {
        Write-Alerte 'business-meta.json absent de la sauvegarde : compteur de version recree.'
    }
} else {
    # Conversion confiée à Node plutôt qu'à ConvertTo-Json : en PowerShell 5.1 ce dernier
    # tronque à 2 niveaux de profondeur par défaut et transforme certains tableaux d'un seul
    # élément — deux façons silencieuses de restaurer des données fausses.
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { Write-Ko 'node.exe introuvable dans le PATH.'; exit 1 }
    $temp = Join-Path $ServicePath ('restore-{0}.mjs' -f [guid]::NewGuid().ToString('N'))
    $corps = @'
import fs from 'node:fs';
import path from 'node:path';
const COLLECTIONS = ['members','tasks','planningSlots','timeEntries','absences','roadmapItems','copils'];
const src = process.env.SUIVI_RESTORE_FILE;
const dir = process.env.SUIVI_RESTORE_DIR;
const brut = JSON.parse(fs.readFileSync(src, 'utf8'));
const data = brut && typeof brut === 'object' && 'data' in brut ? brut.data : brut;
let total = 0;
for (const c of COLLECTIONS) {
  const rows = Array.isArray(data[c]) ? data[c] : [];
  fs.writeFileSync(path.join(dir, `business-${c}.json`), JSON.stringify(rows, null, 2));
  total += rows.length;
}
// Le serveur distingue « jamais mis en service » de « vide volontairement ». Une
// restauration est une mise en service : sans ce drapeau, l'application reproposerait
// l'ecran de premiere utilisation par-dessus les donnees qu'on vient de remettre.
fs.writeFileSync(path.join(dir, 'business-meta.json'), JSON.stringify({
  version: 1,
  initialized: true,
  initializedAt: new Date().toISOString(),
  initializedBy: 'Restore-SuiviInfra.ps1',
}, null, 2));
console.log('RESTAURE:' + total);
'@
    $env:SUIVI_RESTORE_FILE = $exportJson
    $env:SUIVI_RESTORE_DIR  = $dataDir
    $sortie = $null
    $code = 1
    try {
        Set-Content -Path $temp -Value $corps -Encoding UTF8
        $sortie = & $node.Source $temp 2>&1
        $code = $LASTEXITCODE
    } finally {
        Remove-Item $temp -Force -ErrorAction SilentlyContinue
        Remove-Item Env:\SUIVI_RESTORE_FILE -ErrorAction SilentlyContinue
        Remove-Item Env:\SUIVI_RESTORE_DIR  -ErrorAction SilentlyContinue
    }
    if ($code -ne 0) {
        Write-Ko "Conversion impossible (code $code)"
        $sortie | ForEach-Object { Write-Info $_ }
        if ($archive) { Write-Info "Vos donnees d'origine sont intactes dans $archive" }
        exit 1
    }
    $n = ("$sortie" -replace '(?s).*RESTAURE:(\d+).*', '$1')
    Write-Ok "$n enregistrement(s) restaure(s) dans $($COLLECTIONS.Count) collection(s)"
    if (-not $IncludeUsers) {
        Write-Info 'Les comptes locaux ne figurent pas dans un export applicatif : ils sont inchanges.'
    }
}

if ($IncludeEnv -and $estDossier) {
    $envSave = Join-Path $Source 'env.sauvegarde'
    if (Test-Path -LiteralPath $envSave) {
        Copy-Item -LiteralPath $envSave -Destination (Join-Path $ServicePath '.env') -Force
        Write-Alerte '.env restaure : ancien secret de session - toutes les sessions ouvertes sont invalidees.'
    } else {
        Write-Alerte 'env.sauvegarde absent de la sauvegarde (faite sans -IncludeEnv) : .env inchange.'
    }
}

# --- Redémarrage et vérification -----------------------------------------------------------
Write-Titre 'Redemarrage et verification'
if ($svc)        { Start-Service -Name $ServiceName; Write-Ok 'Service Windows redemarre' }
elseif ($tache)  { Start-ScheduledTask -TaskName $ServiceName; Write-Ok 'Tache planifiee relancee' }
else             { Write-Alerte 'Aucun service a redemarrer : demarrez-le vous-meme.' }

$port = 4000
$envFile = Join-Path $ServicePath '.env'
if (Test-Path $envFile) {
    $ligne = Get-Content $envFile | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -Last 1
    if ($ligne -and ($ligne -split '=', 2)[1].Trim() -match '^\d+$') { $port = [int](($ligne -split '=', 2)[1].Trim()) }
}

$sain = $false
for ($i = 0; $i -lt 15 -and -not $sain; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $sain = $true }
    } catch { }
}

Write-Host ''
if ($sain) {
    Write-Ok "Le service repond sur le port $port avec les donnees restaurees"
    Write-Host 'Ouvrez l''application et verifiez le contenu avant de supprimer quoi que ce soit.' -ForegroundColor Green
} else {
    Write-Ko "Le service ne repond pas sur le port $port apres 15 s"
    Write-Info "Journal : $(Join-Path $ServicePath 'logs\service.log')"
    Write-Info 'Le service refuse de demarrer sur un fichier de donnees illisible : le'
    Write-Info 'journal nomme le fichier en cause.'
    if ($archive) { Write-Info "Retour en arriere : remettre les fichiers de $archive dans $dataDir" }
}
Write-Host ''
