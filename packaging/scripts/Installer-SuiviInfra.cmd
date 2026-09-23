@echo off
REM ---------------------------------------------------------------------------
REM  Suivi Infra & Reseau - installation de bout en bout (double-clic).
REM
REM  Ce fichier ne fait qu appeler Install-SuiviInfra.ps1 en contournant la
REM  strategie d execution PowerShell et en demandant les elevations voulues.
REM  Toute la logique est dans le .ps1, lisible et rejouable a la main.
REM ---------------------------------------------------------------------------
setlocal
REM Console en UTF-8 : sans cela les accents des messages s affichent de travers.
chcp 65001 >nul
cd /d "%~dp0"

net session >/dev/null 2>&1
if errorlevel 1 (
  echo.
  echo   Cette installation doit etre lancee en tant qu administrateur.
  echo   Clic droit sur ce fichier ^> "Executer en tant qu administrateur".
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================================
echo     Suivi Infra ^& Reseau - installation
echo   ============================================================
echo.
set "SRV=winas"
set /p SRV=  Nom du serveur [winas] : 
set "PORT=8081"
set /p PORT=  Port IIS [8081] : 
echo.
echo   Mode :
echo     1^) HTTP  - immediat, sans certificat  (par defaut)
echo     2^) HTTPS - exige un certificat deja importe pour %SRV%
set "MODE=1"
set /p MODE=  Votre choix [1] : 
if "%MODE%"=="2" (set "PROTO=https") else (set "PROTO=http")
echo.
echo   Service ^(comptes locaux/LDAP, donnees partagees, envoi de mail^) ?
echo     1^) Non - site seul, donnees dans chaque navigateur
echo     2^) Oui - mode client/serveur  ^(necessite Node.js et NSSM^)
set "SVC=1"
set /p SVC=  Votre choix [1] : 
set "SVCARG="
if "%SVC%"=="2" set "SVCARG=-WithService"

echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-SuiviInfra.ps1" -HostName "%SRV%" -Protocol "%PROTO%" -Port %PORT% %SVCARG%
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
  echo   L installation s est arretee sur une erreur ^(code %RC%^).
  echo   Le message ci-dessus indique quoi corriger, puis relancez ce fichier.
) else (
  echo   Termine.
)
echo.
pause
endlocal
