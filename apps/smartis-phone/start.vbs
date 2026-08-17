' Startet "smartis Telefon" ohne Konsolenfenster.
'
' Bis es ein richtiges Installationspaket gibt, ist das der bequeme Weg:
' Doppelklick hier, oder ueber die Verknuepfung auf dem Desktop.
'
' Voller Pfad zu Electron statt eines Suchpfad-Aufrufs -- dieselbe Lehre wie
' beim Fernsteuer-Helfer (31.07.2026): ueber den Suchpfad gestartet fand es
' die Programme nicht, wenn der Aufruf nicht aus einer normalen Anmeldung kam.
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

ordner = fso.GetParentFolderName(WScript.ScriptFullName)
electron = ordner & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electron) Then
  MsgBox "Electron fehlt. Bitte im Ordner" & vbCrLf & ordner & vbCrLf & _
         "einmal 'npm install' ausfuehren.", 48, "smartis Telefon"
  WScript.Quit 1
End If

WshShell.CurrentDirectory = ordner
' ⚠️ Fensterstil 1 (normal), NICHT 0. Mit 0 startet die App unsichtbar: sie
' laeuft dann zwar, hat aber kein Fenster -- man sucht sie vergeblich
' (10.08.2026 genau so passiert). Electron oeffnet ohnehin keine Konsole,
' der Trick mit 0 ist hier also nicht noetig.
WshShell.Run """" & electron & """ """ & ordner & """", 1, False
