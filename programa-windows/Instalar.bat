@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"
where node >nul 2>nul
if errorlevel 1 (
  echo Instalando o Node.js, aguarde...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Nao consegui instalar o Node.js sozinho. Instale em https://nodejs.org (versao LTS) e rode este instalador de novo.
  if not "%~1"=="/silent" pause
  exit /b 1
)
echo Instalando as pecas do bot...
call npm install --no-audit --no-fund || exit /b 1
call npx playwright install chromium || exit /b 1
echo.
echo Pronto.
if not "%~1"=="/silent" pause
