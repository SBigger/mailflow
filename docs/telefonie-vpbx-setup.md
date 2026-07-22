# Telefonie — Setup-Anleitung (peoplefone vPBX + lokales MicroSIP-Hook-Skript)

Stand: 2026-07-22. Ersetzt die ältere `telefonie-test-server.md` (LiveKit/Kamailio —
brauchen wir nicht mehr).

> ⚠️ **KORREKTUR (2026-07-22, Sascha hat bei peoplefone-Support nachgefragt):**
> **„peoplefone CONNECTOR" wurde zusammen mit „peoplefone HOSTED" abgeschafft** —
> das war kein Freischalt-Problem, das Produkt existiert schlicht nicht mehr.
> Schritt 2 (unten, CONNECTOR-URLs hinterlegen) ist damit **hinfällig**.
> **Das betrifft unsere Lösung zum Glück nicht:** Screen-Pop/Anrufstatus laufen
> längst über einen **eigenen, unabhängigen Weg** — ein kleines Skript auf dem
> Mitarbeiter-PC, das MicroSIP bei jedem Anruf-Ereignis aufruft und direkt
> unsere eigene Supabase-Function benachrichtigt (kein peoplefone-Produkt
> beteiligt). Dieser Weg ist bereits gebaut, deployt und Ende-zu-Ende getestet
> — siehe „Lokale MicroSIP-Anbindung" weiter unten statt Schritt 2.

## Was diese Nacht schon fertig wurde (ohne dass du etwas tun musstest)

- **Echte Presence** im Telefonie-Cockpit: wer gerade in smartis angemeldet ist
  und welchen Status er/sie hat (Verfügbar/Beschäftigt/DND/Abwesend/Im Gespräch),
  läuft jetzt live über Supabase Realtime — kein Server, keine Migration nötig.
  Live geprüft im Browser: funktioniert.
- **Screen-Pop läuft über einen echten Signalkanal** (Realtime-Broadcast) statt
  nur lokal im Browser zu simulieren — das ist exakt die Leitung, an die unten
  die CONNECTOR-Lookup-Function andockt. Live geprüft: funktioniert.
- **Zwei Supabase Edge Functions geschrieben** (`telefonie-connector-lookup`,
  `telefonie-connector-workflow`) — fertig committet, aber **noch nicht
  deployt** (dafür brauche ich deinen Supabase-Zugang, siehe Schritt 3).
- UI-Texte im Telefonie-Modul auf den neuen Plan abgeglichen.
- Roger per Mail informiert: die LiveKit/Kamailio-VM aus der letzten Mail an
  ihn braucht er **nicht mehr** zu bauen.

Alles oben ist bereits auf **smartis.me** live (nach Hard-Refresh `Strg+Shift+R`
sichtbar — smartis hat einen Service Worker, der manchmal hartnäckig alte
Versionen zeigt; falls es nach dem Refresh immer noch alt aussieht, einmal
`F12 → Application → Service Workers → Unregister` und neu laden).

---

## Schritt 1 — peoplefone vPBX 30-Tage-Test starten

Im Portal (`https://portal.peoplefone.ch`), dort wo du auch die SIP-Linien
siehst: nach **„vPBX"** bzw. **„peoplefone vPBX"** suchen (Produkte/Bestellen-
Bereich) und den **kostenlosen 30-Tage-Test** starten. Empfehlung: Paket
**BASIC** reicht funktional für den Test (Transfer/Rufgruppen/BLF/Voicemail
sind alle drin); **PLUS** bringt zusätzlich das Web-Softphone, falls gewünscht.

*(Ich kenne die exakten Klickpfade im vPBX-Bestellprozess nicht aus eigener
Anschauung — falls die Menüführung anders aussieht als erwartet, einfach den
Support-Chat im Portal fragen oder mir einen Screenshot schicken, dann sag
ich dir genau wo klicken.)*

Für den Test: **nicht** gleich eure Hauptnummer umziehen — erst mit einer
Testnummer/Extension ausprobieren, wie unten beschrieben.

## Schritt 2 — Lokale MicroSIP-Anbindung (ERLEDIGT auf Saschas PC, Vorlage für weitere Mitarbeitende)

Statt eines peoplefone-Produkts übernimmt ein **kleines Skript direkt auf dem
PC** die Meldung an smartis — MicroSIP ruft es bei jedem Anruf-Ereignis auf
(offiziell dokumentiertes MicroSIP-Feature, per Quellcode verifiziert:
`ShellExecute(..., cmdXxx, callerId, ...)`).

**Auf Saschas PC bereits eingerichtet** (Ordner bewusst ausserhalb von OneDrive,
da dort das Secret drin liegt — nicht ins Git-Repo committen!):
`C:\Users\<Name>\AppData\Local\SmartisTelefonie\`
- `microsip-notify.ps1` — meldet Nummer + Status an unsere Function
- `hook-ringing.bat` / `hook-answered.bat` / `hook-ended.bat` — dünne Aufrufer

In `%APPDATA%\MicroSIP\MicroSIP.ini` (MicroSIP davor beenden, sonst
überschreibt es die Änderung beim Schliessen!) sind gesetzt:
```
cmdIncomingCall="...\SmartisTelefonie\hook-ringing.bat"
cmdCallStart="...\SmartisTelefonie\hook-answered.bat"
cmdCallEnd="...\SmartisTelefonie\hook-ended.bat"
```

**Für jeden weiteren Mitarbeitenden (Petra/Roger/...):** dieselben 4 Dateien
in denselben lokalen Ordner auf deren PC kopieren + dieselben 3 ini-Zeilen
eintragen (Pfad ggf. an den jeweiligen Windows-Benutzernamen anpassen). Eine
kleine Einrichtungs-Routine dafür lässt sich bei Bedarf noch bauen.

Die Functions selbst (`telefonie-connector-lookup`/`-workflow`) heissen noch
nach dem ursprünglichen CONNECTOR-Plan, sind aber jetzt ganz normale, von uns
selbst aufgerufene Endpunkte — der Name ist nur historisch, keine Abhängigkeit
zu einem peoplefone-Produkt mehr.

## Schritt 3 — Die zwei Edge Functions deployen ✅ ERLEDIGT

Beide Functions sind deployt und per curl Ende-zu-Ende getestet (echter
Server-Aufruf → Realtime-Broadcast → Screen-Pop in smartis, ohne Klick im
Browser). Secret `CONNECTOR_SHARED_SECRET` ist gesetzt. Für spätere eigene
Deploys (z. B. nach einer Code-Änderung), falls kein Supabase-Zugang gerade
verfügbar ist:

```bash
supabase login
supabase functions deploy telefonie-connector-lookup --no-verify-jwt --project-ref uawgpxcihixqxqxxbjak
supabase functions deploy telefonie-connector-workflow --no-verify-jwt --project-ref uawgpxcihixqxqxxbjak
```

Logs ansehen (Achtung: `supabase functions logs` gibt es in älteren CLI-
Versionen nicht — dann im Supabase-Dashboard unter Functions → Name → Logs
nachsehen):
```bash
supabase functions logs telefonie-connector-lookup --project-ref uawgpxcihixqxqxxbjak
```

## Schritt 4 — Softphones installieren ✅ ERLEDIGT (Sascha)

- **Desktop:** [MicroSIP](https://www.microsip.org/) — installiert, Konto
  eingerichtet und registriert (`pbxs.peoplefone.ch`, Benutzer `90746408026`).
  ⚠️ Beim Download **nur** die Datei `MicroSIP-3.22.12.exe` direkt von
  microsip.org nehmen — die grossen "Download"-Werbekästchen auf der Seite
  sind KEIN MicroSIP (haben beim ersten Versuch Adware installiert, wieder entfernt).
- **Handy:** [Groundwire](https://acrobits.net/sip-client-ios-android/)
  (App Store/Play Store, einmalig ~CHF 10) — gleiche Zugangsdaten, noch offen.

## Schritt 5 — Testen

1. **Intern anrufen**: von deiner Nebenstelle eine Kollegin/einen Kollegen
   über die interne Kurzwahl anrufen (Nummer/Kurzwahl im vPBX-Portal einsehbar).
2. **Verbinden/Transfer**: einen Anruf annehmen und an eine andere Nebenstelle
   weitergeben (blind und mit Rückfrage/attended — beides sollte im Softphone
   als Button vorhanden sein).
3. **Screen-Pop in smartis (echter Anruf, nicht simuliert):** smartis
   (`/telefonie`) offen lassen, dann bei MicroSIP wirklich anrufen lassen —
   das Dossier sollte automatisch aufpoppen (Mechanismus curl-seitig schon
   bestätigt, echter Anruf über MicroSIP noch nicht verifiziert).
4. **Auflegen → Wrap-up automatisch:** nach Gesprächsende sollte in smartis
   automatisch das Leistungs-Panel erscheinen (kein Klick auf "Auflegen" in
   smartis nötig — das Ereignis kommt von MicroSIP selbst).

## Was danach ansteht

- Presence im Team mit dem echten Softphone-Status verknüpfen (aktuell zeigt
  sie nur „ist in smartis angemeldet" + den manuell gewählten Status — nicht
  den echten SIP-Gesprächsstatus des Softphones). Der lokale Hook-Mechanismus
  (`hook-ringing`/`-answered`/`-ended`) liefert die Rohdaten dafür bereits;
  fehlt nur die Verdrahtung auf `effectivePresence`.
- Click-to-Call aus den Kundenlisten (Telefonliste, Kunden, Chartis) von
  Teams-`tel:`-Links auf den neuen MicroSIP-Weg umstellen — bewusst noch nicht
  angefasst, bis der echte Anruf-Test (Schritt 5) bestätigt ist.
- Lokale Anbindung für weitere Mitarbeitende (Petra/Roger/...) ausrollen,
  siehe Schritt 2 — ggf. als kleine Setup-Routine statt manuellem Kopieren.
- Peoplefones generisches API-Key-System (`Phone Control`-Scope) als
  möglicher Ersatz für einzelne Handgriffe (z. B. Anruf serverseitig
  auslösen) — bisher nicht gebraucht, nicht im Detail geprüft.
- Falls mehr Tiefe nötig wird als der lokale Hook-Mechanismus bietet (z. B.
  Rufgruppen-Events direkt aus der PBX statt nur pro Endgerät): Umstieg auf
  eine self-hostete FreePBX mit voller AMI/ARI-Anbindung bleibt jederzeit
  möglich, ohne die smartis-Integration (Dossier/Leistung/Cockpit) neu zu
  bauen — nur die Event-Quelle wechselt.
