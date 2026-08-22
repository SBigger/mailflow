# Word-Add-in "In Ablage hochladen"

Ribbon-Knopf in Word, der das offene Dokument an die Smartis-Desktop-App schickt
(`POST http://localhost:7788/upload`, derselbe Weg wie der Excel-Upload). Die App
oeffnet damit ihren normalen Hochladen-Dialog.

Installiert wird die Vorlage als `%APPDATA%\Microsoft\Word\STARTUP\SmartisWord.dotm`;
Word laedt alles aus diesem Ordner beim Start als Add-in.

## Dateien
| Datei | Zweck |
|---|---|
| `SmartisHelper.bas` | Der Makro-Quelltext (**Wahrheit**, hier pflegen) |
| `SmartisWord.aktuell.dotm` | Kopie der installierten Vorlage, Stand 25.06.2026 — enthaelt noch den **alten** Code |
| `vba-auslesen.py` | Liest den VBA-Quelltext aus einer .dotm zurueck (braucht `olefile`) |

## Warum der Quelltext hier liegt
Die `.dotm` ist ein Binaercontainer; ohne diese `.bas` waere der Code nur noch in
der Vorlage selbst und nicht versionierbar. `vba-auslesen.py` holt ihn notfalls
wieder heraus:

```
python -m venv env && env/Scripts/pip install olefile
env/Scripts/python vba-auslesen.py "%APPDATA%\Microsoft\Word\STARTUP\SmartisWord.dotm"
```

## Stand 21.08.2026: gefundener Fehler, Korrektur noch nicht eingebaut
`SmartisHelper.bas` enthaelt bereits die Korrektur, die installierte `.dotm` **noch nicht**.

Der alte Code loeste SharePoint-Pfade so auf:

```vba
cand = cand & Replace(Mid(url, Len(ns) + 1), "/", "\")
If fso.FileExists(cand) Then ...
```

Word liefert solche Pfade aber URL-kodiert (`Artis%20Tools.docx`), waehrend die Datei
im Sync-Ordner echte Leerzeichen hat. `FileExists` schlaegt damit bei jedem Dokument
mit Leerzeichen im Namen fehl, und der Knopf meldet nur "lokale Kopie nicht gefunden".

Korrigiert durch `UrlDecode`; zusaetzlich behandelt `IstEntfernt` jetzt auch
WebDAV-Pfade (`\\host@SSL\DavWWWRoot\...`), und wenn gar kein Sync-Ordner passt,
schreibt Word die Kopie per `SaveCopyAs` selbst — das funktioniert auch bei
Bibliotheken, die nicht synchronisiert sind. `SmartisPfadtest` ist neu und gibt zur
Diagnose zurueck, welcher lokale Pfad fuer eine URL gefunden wird.

## Einbauen der Korrektur
Das Ersetzen des Moduls braucht Zugriff auf das VBA-Projektobjektmodell. Der ist
standardmaessig gesperrt (Fehler `0x800A17B4`), und **der Registry-Wert
`HKCU\Software\Microsoft\Office\16.0\Word\Security\AccessVBOM = 1` genuegt hier
nicht** — auch nach Word-Neustart und ohne blockierende Policy blieb der Zugriff zu.
Der Haken muss ueber die Oberflaeche gesetzt werden:

> Word → Datei → Optionen → Trust Center → Einstellungen für das Trust Center →
> Makroeinstellungen → **Zugriff auf das VBA-Projektobjektmodell vertrauen**

Danach (Word geschlossen) ersetzt dieses Snippet das Modul:

```powershell
$w = New-Object -ComObject Word.Application
$doc = $w.Documents.Open("$env:APPDATA\Microsoft\Word\STARTUP\SmartisWord.dotm")
$proj = $doc.VBProject
$proj.VBComponents.Remove($proj.VBComponents.Item("SmartisHelper"))
$proj.VBComponents.Import("<Pfad>\SmartisHelper.bas") | Out-Null
$doc.Save(); $doc.Close([ref]$false); $w.Quit([ref]$false)
```

Den Haken danach wieder entfernen — er erlaubt jedem Makro, fremde Makros zu aendern.
