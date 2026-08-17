# smartis Telefonie-Karte — Installation pro Mitarbeitendem

Die Karte zeigt beim Anruf den Kunden samt Pendenzen und Dokumenten und kann
annehmen, verbinden und auflegen — ohne dass ein Browser offen sein muss.

## Voraussetzungen

1. **MicroSIP** installiert und am peoplefone-Anschluss der Person angemeldet
   (bis der eigene Client fertig ist, siehe `apps/smartis-phone`).
2. **Nebenstellen-Zuordnung** in smartis gepflegt: Einstellungen → Telefonie →
   Nebenstellen-Zuordnung. Ohne sie bekommt die Person keine gezielten Anrufe.
3. Node.js auf dem PC (für den Fernsteuerungs-Helfer).

## 1. Karte einrichten

```bash
cd apps/telefonie-tray
npm install
npm start
```

Beim ersten Start legt Electron den Konfigurationsordner an. Dort
`config.json` anlegen bzw. ergänzen:

```
%APPDATA%\SmartisTelefonieTray\config.json
```

```json
{
  "profileId": "<UUID des smartis-Profils dieser Person>",
  "controlSecret": "<Wert aus profiles.telefonie_control_secret dieser Person>",
  "url": "https://smartis.me/telefonie",
  "targets": [
    { "name": "Romy Gerber", "extension": "21" }
  ]
}
```

⚠️ Die Datei **ohne BOM** speichern (in Notepad: „UTF-8", nicht „UTF-8 mit BOM";
in PowerShell nicht `Set-Content -Encoding utf8`). Mit BOM wird die gesamte
Konfiguration verworfen — die App warnt dann beim Start.

- **`profileId`** ist der wichtigste Wert: Er entscheidet, wessen Anrufe diese
  Karte zeigt. Zu finden in smartis (Einstellungen → Benutzer) bzw. in der
  Datenbank-Tabelle `profiles`.
  ⚠️ **Fehlt er, läuft die App unter der Vorgabe-Kennung mit** und zeigt fremde
  Anrufe — beim Start erscheint dann eine Warnung im Protokoll.
- **`controlSecret`** signiert Annehmen/Verbinden/Auflegen. Ohne diesen Wert
  bleiben die Knöpfe wirkungslos (der lokale Helfer lehnt unsignierte Befehle
  ab). Muss **identisch** in der Helfer-Konfiguration stehen (Schritt 2) und
  mit `profiles.telefonie_control_secret` dieser Person übereinstimmen.
  Wie ein Passwort behandeln — nicht ins Repo, nicht per Chat verschicken.
- `targets` ist die Auswahlliste beim Verbinden. **Nur echte Nebenstellen
  eintragen** (Liste: Einstellungen → Telefonie, kommt live aus der Anlage) —
  ein Transfer auf eine nicht existierende Nebenstelle kommt über die
  Rufgruppe zurück und wirkt wie ein doppelter Anruf.
- `supabaseUrl` / `supabaseAnonKey` nur setzen, wenn eine andere Umgebung als
  smartis.me angebunden werden soll (z.B. Produktiv).

Autostart richtet die App beim ersten Start selbst ein.

## 2. Fernsteuerungs-Helfer einrichten

Damit Annehmen/Verbinden/Auflegen aus der Karte MicroSIP wirklich steuern:

1. Ordner `%LOCALAPPDATA%\SmartisTelefonie\` anlegen.
2. `microsip-control-listener.js` und `start-control-listener.vbs` von einem
   eingerichteten PC kopieren.
3. Dort eine `config.json` anlegen (ebenfalls **ohne BOM**) — dieselben Werte
   wie bei der Karte:

   ```json
   {
     "profileId": "<UUID des smartis-Profils>",
     "controlSecret": "<identisch zur Karte>"
   }
   ```

   Ohne `controlSecret` lehnt der Helfer **jeden** Befehl ab (das ist Absicht:
   der Kanal ist öffentlich, nur signierte Befehle dürfen ausgeführt werden).
   MicroSIP-Pfad im Skript prüfen.
4. Autostart: Registry-Schlüssel `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
   Wert `SmartisTelefonieControl` =
   `wscript.exe "C:\Users\<Benutzer>\AppData\Local\SmartisTelefonie\start-control-listener.vbs"`

Der Helfer schreibt `control.log` in denselben Ordner — erste Anlaufstelle bei
Problemen.

## 3. Prüfen

- Karte: Protokoll zeigt `Realtime SUBSCRIBED` und die eingelesene Konfiguration.
- Helfer: `control.log` zeigt `Realtime-Status: SUBSCRIBED`.
- Testanruf: Karte erscheint unten rechts, Annehmen holt das Gespräch heran,
  MicroSIP verschwindet danach von selbst wieder.

## Absicherung

Der Realtime-Kanal ist öffentlich (anon-Key und Kanalname stehen im Repo).
Deshalb sind Fernsteuer-Befehle **signiert**: Der Helfer führt nur Befehle mit
gültiger Signatur aus, die höchstens 30 Sekunden alt sind und nicht schon
einmal ausgeführt wurden. Ohne Kenntnis des persönlichen `controlSecret` kann
niemand ein fremdes Telefon steuern.

**Noch offen:** Die Anruf-Ereignisse selbst (Kundenname, Pendenzen,
Dokumentnamen) laufen weiterhin unverschlüsselt über den öffentlichen Kanal —
mitlesen ist also technisch möglich. Nächster Schritt des Security-Pakets.
