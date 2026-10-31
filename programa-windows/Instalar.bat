@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instalando o Node.js...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Feche esta janela e rode Instalar.bat de novo.
  pause & exit /b
)
call npm install
call npx playwright install chromium
echo.
echo Pronto. Agora use Iniciar.bat
pause
