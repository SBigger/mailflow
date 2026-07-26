# meeting-api — Einrichtung

Stellt LiveKit-Zugangstoken für das Modul **Besprechungen** (`/besprechungen`) aus.

## Was diese Function tut

1. Prüft **serverseitig**, dass der Aufrufer ein angemeldeter Mitarbeiter ist
   (`requireUser` aus `_shared/auth.ts` — Signaturprüfung via `auth.getUser`,
   nicht bloss Dekodieren; der anon-Key wird abgelehnt).
2. Signiert ein LiveKit-Zugangstoken (HS256, von Hand — es gibt keine
   JWT-Bibliothek im Repo).
3. Gibt Token + Serveradresse zurück. **Das API-Secret verlässt die Function nie.**

Der Anzeigename kommt aus `profiles.full_name`, nicht vom Client — sonst
könnte sich jemand als jemand anderes ausgeben.

Verifiziert (2026-07-27): Das handgebaute Token ist feldgleich mit dem der
offiziellen `livekit-server-sdk`, inklusive `canPublishSources`.

## Einmalige Einrichtung

### 1. LiveKit-Projekt anlegen (gratis)

Auf <https://cloud.livekit.io> registrieren, Projekt anlegen, unter
**Settings → Keys** einen Schlüssel erzeugen. Man erhält drei Werte:

| Wert | Beispiel |
|---|---|
| Server-Adresse | `wss://smartis-xxxx.livekit.cloud` |
| API Key | `APIxxxxxxxxxxxx` |
| API Secret | (langer Zufallsstring) |

Die Gratis-Stufe „Build" enthält 5000 Teilnehmerminuten pro Monat — für
interne Tests reichlich. **Nur für interne Gespräche verwenden:** Die Server
stehen in den USA; Mandantengespräche gehören erst ab Phase 2 auf den eigenen
Schweizer Server (dann ist der Umstieg ein Tausch von `LIVEKIT_URL` und den
beiden Schlüsseln — der Code bleibt unverändert).

### 2. Secrets setzen

```bash
supabase secrets set LIVEKIT_URL="wss://..." LIVEKIT_API_KEY="API..." LIVEKIT_API_SECRET="..." --project-ref uawgpxcihixqxqxxbjak
```

### 3. Function ausrollen

```bash
supabase functions deploy meeting-api --project-ref uawgpxcihixqxqxxbjak
```

`verify_jwt` bleibt **an** (Standard, kein Eintrag in `config.toml` nötig).
⚠️ `verify_jwt` lässt auch den anon-Key durch — die eigentliche Hürde ist
`requireUser` (gleiche Lehre wie bei `telefonie-transfer` dokumentiert).

### 4. Prüfen

In smartis anmelden → **Besprechungen** → „Besprechung starten" → beitreten.
Fehlen die Secrets, meldet die Oberfläche im Klartext
„Der Videodienst ist noch nicht eingerichtet".

## Was Phase 2 hier ändert

Heute darf jeder angemeldete Mitarbeiter jeden Raum betreten, dessen Namen er
kennt — bewusst so, weil alle Beteiligten authentifiziert sind und es noch
keine Gastlinks gibt. Mit Phase 2 kommen `meetings`/`meeting_participants`
dazu; dann wird hier gegen die Datenbank geprüft statt Raumnamen frei
anzunehmen, und Gäste bekommen eigene, kurzlebige Token nach Freigabe durch
den Berater im Warteraum.
