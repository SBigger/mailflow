# Telefonie — Setup-Anleitung (peoplefone vPBX + CONNECTOR)

Stand: 2026-07-20 (Nacht-Session). Das ist der **aktuelle** Plan (ersetzt die
ältere `telefonie-test-server.md` mit LiveKit/Kamailio — die brauchen wir nicht mehr).

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

## Schritt 2 — CONNECTOR-Modul aktivieren + URLs hinterlegen

CONNECTOR ist ein Zusatzmodul der vPBX (~CHF 2/User/Mt. + einmalig CHF 50).
Im Portal aktivieren, dann bei den Connector-Einstellungen zwei URLs hinterlegen:

| Feld | Wert |
|---|---|
| **Lookup-URL** (bei jedem Anruf) | `https://<PROJECT-REF>.supabase.co/functions/v1/telefonie-connector-lookup` |
| **Workflow-URL** (bei Anrufende) | `https://<PROJECT-REF>.supabase.co/functions/v1/telefonie-connector-workflow` |
| **Auth-Header/Token** | ein von dir frei gewähltes Secret (z. B. per Passwort-Generator) |

`<PROJECT-REF>` = die Projekt-ID von smartis.me in Supabase (siehst du im
Supabase-Dashboard oben oder in der Projekt-URL).

Das gleiche Secret muss **zusätzlich** als Supabase-Secret gesetzt werden
(Schritt 3), unter dem Namen `CONNECTOR_SHARED_SECRET` — nur dann akzeptieren
die Functions den Aufruf.

## Schritt 3 — Die zwei Edge Functions deployen

Du brauchst dafür deinen Supabase-Zugang (den habe ich nicht). Im Repo-Ordner:

```bash
# einmalig einloggen (öffnet Browser)
supabase login

# Secrets setzen (das Secret aus Schritt 2 hier eintragen)
supabase secrets set CONNECTOR_SHARED_SECRET=<dein-gewähltes-secret> --project-ref <PROJECT-REF>

# beide Functions deployen (ohne JWT-Prüfung, da peoplefone kein Supabase-Login hat)
supabase functions deploy telefonie-connector-lookup --no-verify-jwt --project-ref <PROJECT-REF>
supabase functions deploy telefonie-connector-workflow --no-verify-jwt --project-ref <PROJECT-REF>
```

**Wichtiger Hinweis zur Ehrlichkeit:** Ich habe die exakte Form der
CONNECTOR-Anfragen (welche Feldnamen peoplefone genau schickt) nicht aus der
Original-Doku gelesen, sondern nur aus einer Recherche-Zusammenfassung
abgeleitet. Die Functions loggen darum den kompletten eingehenden Request
(`console.log(rawBody)`), damit man es beim ersten echten Testanruf sofort
sieht. So prüfst du das nach dem ersten Testanruf:

```bash
supabase functions logs telefonie-connector-lookup --project-ref <PROJECT-REF>
```

Falls der Screen-Pop nicht mit der richtigen Nummer ankommt: den geloggten
`rawBody` anschauen und in `supabase/functions/_shared/telefonie.ts` die
Funktionen `pickPhoneNumber()`/`pickCalleeNumber()` um das echte Feld ergänzen
(einfache Codeänderung, sag mir einfach was im Log steht, dann mache ich das).

## Schritt 4 — Softphones installieren

- **Desktop:** [MicroSIP](https://www.microsip.org/) (gratis) — Konto mit den
  Zugangsdaten deiner vPBX-Nebenstelle einrichten (SIP-Server/Proxy, Benutzer,
  Passwort findest du im vPBX-Portal bei der jeweiligen Nebenstelle).
- **Handy:** [Groundwire](https://acrobits.net/sip-client-ios-android/)
  (App Store/Play Store, einmalig ~CHF 10) — gleiche Zugangsdaten.

## Schritt 5 — Testen

1. **Intern anrufen**: von deiner Nebenstelle eine Kollegin/einen Kollegen
   über die interne Kurzwahl anrufen (Nummer/Kurzwahl im vPBX-Portal einsehbar).
2. **Verbinden/Transfer**: einen Anruf annehmen und an eine andere Nebenstelle
   weitergeben (blind und mit Rückfrage/attended — beides sollte im Softphone
   als Button vorhanden sein).
3. **Screen-Pop in smartis**: eine externe Nummer anrufen, die als
   Kunden-/Kontaktnummer in smartis hinterlegt ist (z. B. deine eigene
   Handynummer, falls sie irgendwo als Kontakt steht) — das Dossier sollte in
   smartis (`/telefonie`) automatisch aufpoppen.

## Was danach ansteht (nicht mehr diese Nacht)

- Presence im Team (heute Nacht gebaut) mit dem echten Softphone-Status
  verknüpfen (aktuell zeigt sie nur „ist in smartis angemeldet" + den manuell
  gewählten Status — nicht den echten SIP-Gesprächsstatus des Softphones).
- Click-to-Call aus den Kundenlisten auf MicroSIP/Groundwire umstellen
  (aktuell laufen die `tel:`-Links noch auf Teams — bewusst nicht angefasst,
  damit das heutige Wählen nicht bricht, bevor die vPBX steht).
- Falls die CONNECTOR-Integration zu flach ist (z. B. Presence direkt aus der
  PBX statt nur „App offen"): Umstieg auf eine self-hostete FreePBX mit voller
  AMI/ARI-Anbindung bleibt jederzeit möglich, ohne die smartis-Integration
  (Dossier/Leistung/Cockpit) neu zu bauen — nur die Event-Quelle wechselt.
