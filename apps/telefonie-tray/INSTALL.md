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
  "url": "https://smartis.me/telefonie",
  "targets": [
    { "name": "Romy Gerber", "extension": "21" },
    { "name": "Reto Mühlemann", "extension": "22" }
  ]
}
```

- **`profileId`** ist der wichtigste Wert: Er entscheidet, wessen Anrufe diese
  Karte zeigt. Zu finden in smartis (Einstellungen → Benutzer) bzw. in der
  Datenbank-Tabelle `profiles`.
  ⚠️ **Fehlt er, läuft die App unter der Vorgabe-Kennung mit** und zeigt fremde
  Anrufe — beim Start erscheint dann eine Warnung im Protokoll.
- `targets` ist die Auswahlliste beim Verbinden (Vorgabe: die bekannten
  Nebenstellen).
- `supabaseUrl` / `supabaseAnonKey` nur setzen, wenn eine andere Umgebung als
  smartis.me angebunden werden soll (z.B. Produktiv).

Autostart richtet die App beim ersten Start selbst ein.

## 2. Fernsteuerungs-Helfer einrichten

Damit Annehmen/Verbinden/Auflegen aus der Karte MicroSIP wirklich steuern:

1. Ordner `%LOCALAPPDATA%\SmartisTelefonie\` anlegen.
2. `microsip-control-listener.js` und `start-control-listener.vbs` von einem
   eingerichteten PC kopieren.
3. Im Listener `MY_PROFILE_ID` auf die Profil-UUID dieser Person setzen und den
   MicroSIP-Pfad prüfen.
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

## Bekannte Einschränkung

Der Fernsteuerungs-Kanal ist derzeit nicht signiert — die Absicherung steht im
Security-Paket an und sollte **vor** dem breiten Rollout erledigt sein.
