# Kalender-Funktion auf artis.sm-artis.ch scharfstellen

Anleitung für Roger, Stand 04.07.2026. Auf smartis.me ist alles davon umgesetzt und getestet;
dieses Dokument beschreibt, was auf der Produktivumgebung (api-artis) zu portieren ist.

## Was die Kalender-Funktion macht

- Jeder Mitarbeiter verbindet sein Outlook (Settings → Outlook → „Outlook verbinden").
- Die Edge Function `sync-outlook-calendar` synct die Termine aller verbundenen User
  per Microsoft-Graph-Delta-Sync in die Tabelle `calendar_events` (RLS: jeder sieht nur seine).
- Frontend: Kalender-Seite (`/Kalender`, Wochen-/Listenansicht, Kundenzuordnung) und
  Kalender-Overlays in der Leistungserfassung (Tages-/Wochenansicht).
- Ein pg_cron-Job ruft den Sync alle 15 Minuten auf.

## Änderungen vom 04.07.2026 (in diesem Stand enthalten)

1. **Serientermin-Fix** in `supabase/functions/sync-outlook-calendar/index.ts`:
   Graph liefert Vorkommen von Serienterminen ohne Betreff (der steckt im `seriesMaster`).
   Der Sync fragt jetzt `seriesMasterId,type` mit ab, übernimmt Betreff/Ort/Organisator vom
   Serienmaster (bei Bedarf per Einzelabruf `/me/events/{id}`) und speichert den Master
   selbst nicht mehr als eigenen Termin (war ein Duplikat der ersten Instanz).
   **Ohne diesen Fix stehen Serientermine als „(Kein Titel)" im Kalender.**
2. **`login_hint`-Fix** in `src/pages/Settings.jsx` und `supabase/functions/microsoft-auth/index.ts`
   (vorher wurde `0` bzw. `undefined` als Login-Hint an Microsoft übergeben).
3. **Neue Migration** `supabase/migrations/20260704000001_calendar_sync_cron.sql`:
   Cron-Job (alle 15 Min) + einmaliger Reset der `calendar_delta_link`s, damit der nächste
   Sync bestehende „(Kein Titel)"-Einträge repariert.

## Schritt für Schritt auf api-artis

### 1. Azure-App-Registrierung prüfen

Die App-Registrierung, deren `MICROSOFT_CLIENT_ID` auf api-artis hinterlegt ist, braucht
die **delegierte** Graph-Berechtigung **`Calendars.Read`** mit Admin-Consent für den Tenant.

- Auf der smartis.me-App („MailFlowArtis", `cd293177-409f-4544-9f0c-0d4f2761d366`) ist
  `Calendars.Read` bereits tenant-weit gewährt (steht unter „Weitere für Artis Treuhand GmbH
  gewährte Berechtigungen") — dort ist nichts zu tun.
- Nutzt api-artis **dieselbe** App-Registrierung: nichts zu tun.
- Nutzt api-artis eine **eigene** App-Registrierung: Portal → App-Registrierungen → App →
  API-Berechtigungen → „Berechtigung hinzufügen" → Microsoft Graph → Delegiert →
  `Calendars.Read` → danach „Administratorzustimmung erteilen".

### 2. Secrets prüfen (Supabase Edge Function Secrets auf api-artis)

Alle vier existieren für den Mail-Sync vermutlich schon — nur verifizieren:

| Secret | Zweck |
|---|---|
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | App-Registrierung aus Schritt 1 |
| `MICROSOFT_TENANT_ID` | Tenant (auf smartis.me: fester Tenant, nicht `common`) |
| `MICROSOFT_REDIRECT_URI` | zeigt auf `<backend>/functions/v1/microsoft-callback` |
| `CRON_SECRET` | für den X-Cron-Secret-Header (existiert, Mail-Crons nutzen ihn) |

Kein neues Secret nötig.

### 3. Edge Functions deployen

```
supabase functions deploy sync-outlook-calendar
supabase functions deploy le-ms365-day
supabase functions deploy microsoft-auth
```

- `sync-outlook-calendar`: neu bzw. mit Serientermin-Fix (Pflicht).
- `le-ms365-day`: Kalender+Mails-Tagesabruf für die Leistungserfassung.
- `microsoft-auth`: enthält den Scope `Calendars.Read` und den login_hint-Fix.
  (`microsoft-callback` ist unverändert, schadet aber nicht mit zu deployen.)

### 4. DB-Migrationen einspielen

1. `supabase/migrations/20260503000001_calendar_events.sql`
   — Tabelle `calendar_events`, 4 neue Spalten in `profiles`
   (`calendar_access_token`, `calendar_token_expiry`, `calendar_delta_link`,
   `calendar_sync_days`), Indizes, RLS. Rein additiv.
2. `supabase/migrations/20260704000001_calendar_sync_cron.sql`
   — Cron-Job + Delta-Reset. **ACHTUNG: Die Function-URL im Job ist auf das
   smartis.me-Backend hartkodiert** (`https://uawgpxcihixqxqxxbjak.supabase.co/...`).
   **Vor dem Einspielen auf die api-artis-URL ändern**, z. B.
   `https://api-artis.sm-artis.ch/functions/v1/sync-outlook-calendar`.
   Reihenfolge beachten: Functions (Schritt 3) zuerst deployen, dann diese Migration.

### 5. Frontend portieren

| Datei | Inhalt |
|---|---|
| `src/pages/Kalender.jsx` | Kalender-Seite (Woche/Liste, Kundenzuordnung, Sync-Button) |
| `src/App.jsx` | Route `/Kalender` |
| `src/components/navigation/appCatalog.js` | Navigations-Eintrag „Kalender" |
| `src/pages/Settings.jsx` | Abschnitt Kalender-Sync/-Reset + login_hint-Fix |
| `src/components/leistungserfassung/KalenderTagPanel.jsx` | Tagesansicht mit Outlook-Overlay |
| `src/components/leistungserfassung/KalenderWochePanel.jsx` | Wochenansicht mit Outlook-Overlay |
| `src/lib/leApi.js` | API-Helper (ruft u. a. `le-ms365-day`) |

### 6. Mitarbeiter verbinden

Jeder Mitarbeiter muss Outlook einmal **neu** verbinden (Settings → Outlook →
„Outlook verbinden"), auch wer schon für Mail verbunden ist: Der alte Refresh-Token
enthält den Kalender-Scope nicht, und Microsoft gibt beim Token-Refresh nur die
ursprünglich konsentierten Scopes zurück. Der Button erzwingt den Consent bereits
(`forceConsent: true`), Neu-Verbinden genügt.

Danach einmal „Kalender synchronisieren" klicken (oder auf den 15-Min-Cron warten).

### 7. Testen

- [ ] Termin mit normalem Einzeltermin erscheint auf `/Kalender`.
- [ ] **Serientermin erscheint MIT Betreff** (nicht „(Kein Titel)").
- [ ] Serie erscheint nicht doppelt am Datum der ersten Instanz.
- [ ] Termin in Outlook löschen → verschwindet nach nächstem Sync.
- [ ] Zweiter User sieht nur seine eigenen Termine.
- [ ] Leistungserfassung → Tagesansicht zeigt Outlook-Termine hinter den Rapporten.
- [ ] Cron läuft: `select * from cron.job;` und `select * from cron.job_run_details order by start_time desc limit 10;`

## Bekannte Grenzen

- Nur Lesezugriff (`Calendars.Read`) — kein Zusagen/Absagen oder Erstellen aus der App.
- Sync-Fenster: `calendar_sync_days` Tage zurück (Default 30) + 1 Jahr voraus.
  Ältere „(Kein Titel)"-Altlasten ausserhalb des Fensters werden nicht repariert
  (bei Bedarf: Settings → „Kalender zurücksetzen" beim betroffenen User).
- Team-/Mandanten-übergreifende Kalenderansicht ist nicht gebaut (bewusst, RLS pro User).
