@echo off
chcp 65001 >nul
title SaaS Video Studio
cd /d "%~dp0"

if not exist venv\Scripts\activate.bat (
    echo [ERREUR] Environnement introuvable. Lancez d'abord install.bat
    pause
    exit /b 1
)

call venv\Scripts\activate.bat

REM Accepte automatiquement la licence des modeles Coqui (evite un prompt bloquant).
set COQUI_TOS_AGREED=1
REM Ajoute le dossier .\bin au PATH pour un FFmpeg portable.
set PATH=%~dp0bin;%PATH%
REM Streamlit : pas de telemetrie, pas d'ecran d'accueil.
set STREAMLIT_BROWSER_GATHER_USAGE_STATS=false

echo.
echo  Demarrage du Studio... (le navigateur s'ouvre automatiquement)
echo  Laissez cette fenetre ouverte pendant l'utilisation.
echo.

streamlit run app.py --server.headless=false --server.port=8501

pause
