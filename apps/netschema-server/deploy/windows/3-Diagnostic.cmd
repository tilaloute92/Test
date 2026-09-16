@echo off
rem ============================================================================
rem  NetSchema - diagnostic
rem  N'installe rien : ecrit un rapport complet a transmettre en cas de probleme.
rem ============================================================================
title NetSchema - diagnostic

net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -Include *.ps1 | Unblock-File" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer-NetSchema.ps1" -Diagnostic
