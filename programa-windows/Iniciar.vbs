' Abre o Bot de Fretes sem janela preta. Se algo falhar, veja o arquivo bot.log nesta pasta.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c set ""PATH=%PATH%;%ProgramFiles%\nodejs"" && node programa.js >> bot.log 2>&1", 0, False
