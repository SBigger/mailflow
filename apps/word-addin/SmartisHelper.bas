Attribute VB_Name = "SmartisHelper"
Option Explicit

' Ribbon-Button "In Ablage hochladen": sendet die aktive Word-Datei an die
' lokal laufende Smartis Desktop App (HTTP POST localhost:7788).
'
' Stand 20.08.2026: Dokumente aus SharePoint/OneDrive scheiterten frueher an
' der Pfadaufloesung. Word liefert deren Pfad URL-kodiert ("Artis%20Tools.docx"),
' im Sync-Ordner heisst die Datei aber mit echten Leerzeichen -> FileExists
' schlug fehl und der Knopf meldete nur "lokale Kopie nicht gefunden".
' Behoben durch UrlDecode; zusaetzlich gibt es jetzt einen Rueckfallweg ueber
' SaveCopyAs, der auch ohne Synchronisierung funktioniert.
Public Sub ShowSmartisUpload(control As Object)
    On Error GoTo Err_
    Dim doc As Object: Set doc = ActiveDocument
    If doc.Path = "" Then
        MsgBox "Bitte das Dokument zuerst speichern.", vbExclamation
        Exit Sub
    End If
    If Not doc.Saved Then doc.Save

    Dim fso As Object: Set fso = CreateObject("Scripting.FileSystemObject")

    ' Temporaere Kopie erstellen
    Dim tmp As String, fn As String, srcPath As String
    fn = doc.FullName
    tmp = Environ("TEMP") & "\" & Format(Now, "yyyymmddhhnnss") & "_" & doc.Name

    If IstEntfernt(fn) Then
        ' SharePoint/OneDrive: erst die synchronisierte Kopie suchen ...
        srcPath = ResolveOneDrivePath(fn)
        If Len(srcPath) > 0 Then
            fso.CopyFile srcPath, tmp, True
        Else
            ' ... sonst laesst Word selbst eine lokale Kopie schreiben.
            ' Das geht auch bei Bibliotheken, die gar nicht synchronisiert sind.
            doc.SaveCopyAs tmp
        End If
    Else
        fso.CopyFile fn, tmp, True
    End If

    If Not fso.FileExists(tmp) Then
        MsgBox "Die Datei konnte nicht vorbereitet werden.", vbExclamation
        Exit Sub
    End If

    ' An Smartis Desktop App senden (muss geoeffnet sein)
    Dim h As Object: Set h = CreateObject("WinHttp.WinHttpRequest.5.1")
    h.Open "POST", "http://localhost:7788/upload", False
    h.SetRequestHeader "Content-Type", "application/json"
    h.Send "{""filepath"": """ & Replace(tmp, "\", "\\") & """}"

    If h.Status <> 200 Then
        MsgBox "Smartis App nicht geoeffnet." & vbCrLf & _
               "Bitte Smartis Desktop starten und nochmals versuchen.", vbExclamation
        On Error Resume Next: Kill tmp: On Error GoTo 0
    End If
    Exit Sub
Err_:
    MsgBox "Fehler: " & Err.Description & " (Code " & Err.Number & ")", vbCritical
End Sub

' Diagnose: gibt zurueck, welchen lokalen Pfad das Add-in fuer eine Server-URL
' findet. Ohne Upload und ohne Meldungsfenster, damit sich der Weg pruefen
' laesst - z.B. per Application.Run "SmartisPfadtest", "https://..."
Public Function SmartisPfadtest(url As String) As String
    Dim p As String
    p = ResolveOneDrivePath(url)
    If Len(p) = 0 Then
        SmartisPfadtest = "NICHT GEFUNDEN (es griffe SaveCopyAs)"
    Else
        SmartisPfadtest = p
    End If
End Function

' Liegt das Dokument auf einem Server? Word meldet solche Pfade entweder als
' http(s)-URL oder als WebDAV-Pfad (\\firma.sharepoint.com@SSL\DavWWWRoot\...).
Private Function IstEntfernt(pfad As String) As Boolean
    Dim p As String: p = LCase(pfad)
    IstEntfernt = (Left(p, 4) = "http") Or (InStr(p, "@ssl\") > 0)
End Function

' Wandelt %20 und Co. in echte Zeichen zurueck. Word liefert Pfade aus
' SharePoint URL-kodiert, im Dateisystem stehen dort aber Leerzeichen.
Private Function UrlDecode(ByVal s As String) As String
    Dim i As Long, c As String, hex2 As String
    Dim aus As String
    i = 1
    Do While i <= Len(s)
        c = Mid(s, i, 1)
        If c = "%" And i + 2 <= Len(s) Then
            hex2 = Mid(s, i + 1, 2)
            If hex2 Like "[0-9A-Fa-f][0-9A-Fa-f]" Then
                aus = aus & Chr(CLng("&H" & hex2))
                i = i + 3
            Else
                aus = aus & c
                i = i + 1
            End If
        Else
            aus = aus & c
            i = i + 1
        End If
    Loop
    UrlDecode = aus
End Function

' Loest eine SharePoint/OneDrive-URL ueber die OneDrive-Sync-Mappings auf.
Private Function ResolveOneDrivePath(url As String) As String
    On Error Resume Next
    Dim reg As Object
    Set reg = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\default:StdRegProv")
    If reg Is Nothing Then Exit Function
    Const HKCU As Long = &H80000001
    Dim base As String: base = "Software\SyncEngines\Providers\OneDrive"
    Dim subkeys As Variant
    reg.EnumKey HKCU, base, subkeys
    If Not IsArray(subkeys) Then Exit Function

    ' WebDAV-Form in eine normale URL zuruecksetzen, damit der Vergleich mit
    ' UrlNamespace greift: \\host@SSL\DavWWWRoot\pfad -> https://host/pfad
    Dim u As String: u = url
    If InStr(LCase(u), "@ssl\") > 0 Then
        u = Replace(u, "\", "/")
        u = Replace(u, "//", "", 1, 1)
        u = Replace(u, "@SSL", "", 1, 1, vbTextCompare)
        u = Replace(u, "/DavWWWRoot", "", 1, 1, vbTextCompare)
        u = "https://" & u
    End If
    u = UrlDecode(u)

    Dim fso As Object: Set fso = CreateObject("Scripting.FileSystemObject")
    Dim i As Long, ns As String, mp As String, cand As String
    For i = LBound(subkeys) To UBound(subkeys)
        ns = "": mp = ""
        reg.GetStringValue HKCU, base & "\" & subkeys(i), "UrlNamespace", ns
        reg.GetStringValue HKCU, base & "\" & subkeys(i), "MountPoint", mp
        If Len(ns) > 0 And Len(mp) > 0 Then
            ns = UrlDecode(ns)
            If LCase(Left(u, Len(ns))) = LCase(ns) Then
                cand = mp
                If Right(cand, 1) <> "\" Then cand = cand & "\"
                cand = cand & Replace(Mid(u, Len(ns) + 1), "/", "\")
                If fso.FileExists(cand) Then
                    ResolveOneDrivePath = cand
                    Exit Function
                End If
            End If
        End If
    Next i
End Function
