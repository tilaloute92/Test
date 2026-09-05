@echo off
chcp 65001 >nul
title SaaS Video Studio - Installation
cd /d "%~dp0"

echo.
echo ===============================================================
echo    SaaS Video Studio - Installation de l'environnement
echo ===============================================================
echo.

REM --- 1. Verification de Python -------------------------------------------
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Python est introuvable.
    echo Installez Python 3.11 depuis python.org en cochant
    echo "Add Python to PATH", puis relancez ce script.
    pause
    exit /b 1
)
python --version

REM --- 2. Creation de l'environnement virtuel ------------------------------
if exist venv\Scripts\python.exe (
    echo [1/4] Environnement virtuel deja present.
) else (
    echo [1/4] Creation de l'environnement virtuel...
    python -m venv venv
    if errorlevel 1 goto :fail
)

set PY=venv\Scripts\python.exe

echo [2/4] Mise a jour de pip...
"%PY%" -m pip install --upgrade pip wheel setuptools
if errorlevel 1 goto :fail

REM --- 3. PyTorch (GPU si possible) ----------------------------------------
echo.
echo [3/4] Installation de PyTorch...
echo       Version CUDA 12.1 (carte NVIDIA). Cela peut prendre 10 minutes.
"%PY%" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
if errorlevel 1 (
    echo [INFO] Echec de la version CUDA, bascule sur la version CPU...
    "%PY%" -m pip install torch torchaudio
    if errorlevel 1 goto :fail
)

REM --- 4. Le reste des dependances -----------------------------------------
echo.
echo [4/4] Installation des librairies du Studio...
"%PY%" -m pip install -r requirements.txt
if errorlevel 1 goto :fail

REM --- Verification finale --------------------------------------------------
echo.
echo ===============================================================
echo    Diagnostic
echo ===============================================================
"%PY%" worker.py --doctor

echo.
echo ---------------------------------------------------------------
echo  Installation terminee.
echo.
echo  Il reste 3 elements EXTERNES a installer si ce n'est pas fait :
echo    1. FFmpeg      -^> https://www.gyan.dev/ffmpeg/builds/
echo                      (ou copiez ffmpeg.exe et ffprobe.exe dans .\bin)
echo    2. Ollama      -^> https://ollama.com  puis : ollama pull mistral
echo    3. Musiques et bruitages dans .\assets\music et .\assets\sfx
echo.
echo  Lancez ensuite : lancer_studio.bat
echo ---------------------------------------------------------------
pause
exit /b 0

:fail
echo.
echo [ERREUR] L'installation a echoue. Lisez le message ci-dessus.
pause
exit /b 1
