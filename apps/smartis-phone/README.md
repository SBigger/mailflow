# smartis Telefon (`smartis-phone`)

Eigener Softphone-Client. Ziel: **MicroSIP + `telefonie-tray` ablösen** — ein
Programm statt zwei plus Fernsteuerungs-Brücke.

## Warum eine neue App neben der alten?

`apps/telefonie-tray` läuft im Alltag produktiv. Diese App entsteht **daneben**
(kein Fork, kein Branch): Die laufende Karte bleibt unangetastet, `master` bleibt
jederzeit auslieferbar, und beim Umstieg wird schlicht getauscht. Nebeneffekt:
Bei neuen Mitarbeitenden muss MicroSIP gar nicht erst installiert werden.

## Architektur: Oberfläche und Motor sind getrennt

```
renderer/app.js   ← Oberfläche (Ansichten, Knöpfe) — kennt NUR die Motor-Schnittstelle
      │
      │  phoneEngine (siehe engine/engine-api.md)
      ▼
engine/mock-engine.js   ← simuliert Anrufe, damit die Oberfläche ohne Telefonanlage entwickelt/getestet werden kann
      ⇢ später: SIP-Motor (JsSIP/SIP.js über WebSocket ODER nativer Stack via IPC)
```

Der Motor wird erst gewählt, wenn die Recherche geklärt hat, ob peoplefone
SIP-over-WebSocket unterstützt (dann reiner JavaScript-Stack) oder nicht (dann
nativer Stack hinter derselben Schnittstelle). **Die Oberfläche ändert sich
dadurch nicht** — das ist der Sinn der Trennung.

## Was schon steht

- Ansichten: Wählen (Tastenfeld), Anrufliste, Kollegen/Nebenstellen, Einstellungen
- Anruf-Ansichten: eingehend (mit Dossier-Bereich) und aktiv (Stumm, Halten,
  Verbinden, Tastatur, Notiz, Auflegen)
- Mock-Motor: simulierte eingehende und ausgehende Anrufe → alles klickbar testbar
- Design in der smartis-Farbwelt (artis-grün), Fensterrahmen dezent

## Was noch fehlt (Reihenfolge)

1. SIP-Motor einsetzen (nach Recherche-Entscheid)
2. Audio-Geräteauswahl real verdrahten (Mikrofon, Lautsprecher, getrenntes Klingel-Gerät)
3. Anbindung an smartis: Kundendossier beim Klingeln (Webhook-Daten wie in der
   heutigen Karte), Anrufliste aus `call_records`, Kollegen aus der Anlage
4. Verbinden serverseitig (Edge Function `telefonie-transfer` existiert bereits)
   bzw. nativ im Motor (dann auch begleitetes Verbinden mit Zurückholen)
5. Autostart + Tray, Übernahme der bewährten Karten-Logik aus `telefonie-tray`

## Starten (Entwicklung)

```bash
npm install
npm start
```

Ohne Telefonanlage läuft der Mock-Motor: In den Einstellungen gibt es Knöpfe, um
einen eingehenden Anruf zu simulieren.
