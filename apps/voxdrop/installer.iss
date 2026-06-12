; VoxDrop by Artis - Inno Setup Script v1.7.0

[Setup]
AppId={{D4E2A1B3-7F8C-4D9E-A2B1-C3D4E5F67890}
AppName=VoxDrop by Artis
AppVersion=1.7.0
AppPublisher=Artis Treuhand GmbH
AppPublisherURL=https://smartis.me
DefaultDirName={autopf}\VoxDrop
DefaultGroupName=VoxDrop
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=VoxDrop-Setup-v1.7.0
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\VoxDrop.exe
WizardImageFile=wizard_main.bmp
WizardSmallImageFile=wizard_small.bmp
InfoBeforeFile=wizard_info.txt
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=lowest
WizardStyle=modern
ShowLanguageDialog=no
MinVersion=10.0.17763

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[CustomMessages]
german.WelcomeLabel2=VoxDrop wandelt Sprache direkt in Text um – in jedem Programm.%n%nHotkey: Strg+Q halten → sprechen → loslassen%n%nNach der Installation öffnen sich automatisch die Einstellungen.

[Tasks]
Name: "desktopicon"; Description: "Desktop-Verknüpfung erstellen"; GroupDescription: "Zusätzliche Aufgaben:"

[Files]
Source: "dist\VoxDrop.exe"; DestDir: "{app}"; Flags: ignoreversion
; config.txt direkt neben EXE – dort sucht VoxDrop zuerst (ignoreversion = immer überschreiben)
Source: "config_default.txt"; DestDir: "{app}"; DestName: "config.txt"; Flags: ignoreversion
; Wizard-Bilder werden NUR fuer das Setup verwendet (kein DestDir = nicht ins Zielverzeichnis)

[Icons]
Name: "{autodesktop}\VoxDrop"; Filename: "{app}\VoxDrop.exe"; Tasks: desktopicon
Name: "{group}\VoxDrop"; Filename: "{app}\VoxDrop.exe"
Name: "{group}\VoxDrop deinstallieren"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\VoxDrop.exe"; Description: "VoxDrop jetzt starten (Einstellungen öffnen sich automatisch)"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill"; Parameters: "/F /IM VoxDrop.exe"; Flags: runhidden; RunOnceId: "KillVoxDrop"

[UninstallDelete]
; Konfiguration und Logs vollständig entfernen
Type: filesandordirs; Name: "{localappdata}\VoxDrop"
Type: filesandordirs; Name: "{userappdata}\VoxDrop"
; App-Ordner vollständig entfernen
Type: filesandordirs; Name: "{app}"

[Registry]
; Autostart-Eintrag bei Deinstallation entfernen
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "VoxDrop"; Flags: deletevalue uninsdeletevalue

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then begin
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'VoxDrop');
    // Einstellungen-Ordner in allen möglichen Pfaden entfernen
    DelTree(ExpandConstant('{localappdata}\VoxDrop'), True, True, True);
    DelTree(ExpandConstant('{userappdata}\VoxDrop'), True, True, True);
  end;
end;
