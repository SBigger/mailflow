' LoginPilot – stiller Starter (kein Kommandofenster)
Set WshShell = CreateObject("WScript.Shell")
sDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
WshShell.CurrentDirectory = sDir
WshShell.Run "cmd /c """ & sDir & "\LoginPilot starten.bat""", 0, False
Set WshShell = Nothing
