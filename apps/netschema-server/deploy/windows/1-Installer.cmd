@echo off
rem ============================================================================
rem  NetSchema - installation complete (double-cliquez sur ce fichier)
rem
rem  Ce fichier ne contient volontairement aucun accent : les consoles Windows
rem  les affichent selon la page de codes active, et le resultat serait illisible.
rem ============================================================================
title NetSchema - installation

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   Demande des droits administrateur...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

rem Les fichiers extraits d'une archive telechargee sont marques "bloques" par
rem Windows : PowerShell refuse alors de les executer.
powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -Include *.ps1 | Unblock-File" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer-NetSchema.ps1" %*
