Unicode true
!define NOME "Bot de Fretes"
Name "${NOME}"
OutFile "BotFretes-Setup.exe"
InstallDir "$LOCALAPPDATA\BotFretes"
RequestExecutionLevel user
ShowInstDetails show
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Instalar"
  SetOutPath "$INSTDIR"
  File /r "pkg\*.*"
  DetailPrint "Instalando as pecas do bot (Node.js e navegador). Pode levar alguns minutos..."
  nsExec::ExecToLog 'cmd /c ""$INSTDIR\Instalar.bat" /silent"'
  Pop $0
  StrCmp $0 "0" ok
    MessageBox MB_ICONEXCLAMATION "Nao consegui terminar a instalacao das pecas (codigo $0). Veja os detalhes na janela e rode Instalar.bat dentro de $INSTDIR."
  ok:
  CreateShortCut "$DESKTOP\${NOME}.lnk" "$INSTDIR\Iniciar.bat" "" "" 0 SW_SHOWMINIMIZED
  CreateDirectory "$SMPROGRAMS\${NOME}"
  CreateShortCut "$SMPROGRAMS\${NOME}\${NOME}.lnk" "$INSTDIR\Iniciar.bat"
  CreateShortCut "$SMPROGRAMS\${NOME}\Gravar (relatorio).lnk" "$INSTDIR\Gravar.bat"
  CreateShortCut "$SMPROGRAMS\${NOME}\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BotFretes" "DisplayName" "${NOME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BotFretes" "UninstallString" "$INSTDIR\Desinstalar.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${NOME}.lnk"
  RMDir /r "$SMPROGRAMS\${NOME}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BotFretes"
  RMDir /r "$INSTDIR"
SectionEnd
