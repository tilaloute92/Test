@echo off
rem ============================================================================
rem  NetSchema - activation du HTTPS (a lancer apres l'installation)
rem  Necessite un certificat : un fichier .pfx, ou un certificat deja present
rem  dans le magasin de l'ordinateur.
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
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Configurer-HTTPS.ps1" %*
