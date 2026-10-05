@echo off
rem ============================================================================
rem  NetSchema - activation du HTTPS (a lancer apres l'installation)
rem
rem  Le HTTPS n'est pas qu'une question de confidentialite : sans lui, les
rem  navigateurs refusent l'acces au micro, et la commande vocale ne fonctionne
rem  que sur le serveur lui-meme (localhost fait exception).
rem
rem  Trois certificats possibles : un auto-signe fabrique ici, un fichier .pfx,
rem  ou un certificat deja present dans le magasin de l'ordinateur.
rem ============================================================================
title NetSchema - HTTPS

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Demande des droits administrateur...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -Include *.ps1 | Unblock-File" >nul 2>&1
if not "%~1"=="" goto :lancer

echo.
echo   Quel certificat utiliser ?
echo.
echo     1. En fabriquer un pour cette machine (le plus rapide ; suffit pour le micro)
echo     2. Un fichier .pfx que vous possedez
echo     3. Un certificat deja dans le magasin de l'ordinateur (empreinte)
echo.
set "CHOIX="
set /p CHOIX=  Votre choix [1] : 
if "%CHOIX%"=="" set CHOIX=1
if "%CHOIX%"=="1" goto :autosigne
if "%CHOIX%"=="3" goto :empreinte
goto :lancer

:autosigne
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Configurer-HTTPS.ps1" -AutoSigne
goto :fin

:empreinte
set "EMPREINTE="
set /p EMPREINTE=  Empreinte du certificat : 
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Configurer-HTTPS.ps1" -Empreinte "%EMPREINTE%"
goto :fin

:lancer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Configurer-HTTPS.ps1" %*

:fin
