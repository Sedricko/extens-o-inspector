@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Sem blocos com parenteses: o PATH do Windows tem "Program Files (x86)" e o ")" quebraria o bloco.
set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"
where node >nul 2>nul
if not errorlevel 1 goto temnode
echo Instalando o Node.js, aguarde...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>nul
if not errorlevel 1 goto temnode
echo.
echo Nao consegui instalar o Node.js sozinho. Instale em https://nodejs.org (versao LTS) e rode este instalador de novo.
if not "%~1"=="/silent" pause
exit /b 1

:temnode
echo Instalando as pecas do bot...
call npm install --no-audit --no-fund
if errorlevel 1 goto erro
call npx playwright install chromium
if errorlevel 1 goto erro
echo.
echo Pronto.
if not "%~1"=="/silent" pause
exit /b 0

:erro
echo.
echo Deu erro ao instalar as pecas. Confira a internet e rode Instalar.bat de novo.
if not "%~1"=="/silent" pause
exit /b 1
