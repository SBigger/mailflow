' GV-Protokoll – stiller App-Start
' Startet den lokalen Mini-Server versteckt und oeffnet die App in einem
' eigenen Edge-Fenster (App-Mode, ohne Tabs/Adressleiste). Kein Konsolenfenster.
Option Explicit
Dim sh, fso, here, url, edge
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://localhost:8770/"

' 1) Lokalen Server versteckt starten (Arbeitsverzeichnis = App-Ordner).
'    Laeuft bereits einer auf Port 8770, beendet sich der neue Versuch leise.
sh.CurrentDirectory = here
sh.Run "cmd /c python -m http.server 8770", 0, False

' kurz warten, bis der Server bereit ist
WScript.Sleep 1200

' 2) App-Fenster oeffnen
edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
If fso.FileExists(edge) Then
  sh.Run """" & edge & """ --app=" & url & " --window-size=1300,880", 1, False
Else
  sh.Run url, 1, False   ' Fallback: Standardbrowser
End If
