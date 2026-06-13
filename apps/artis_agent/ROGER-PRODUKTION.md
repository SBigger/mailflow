# Produktiv-Rollout PDF-Agent + Excel → artis.sm-artis.ch

**Ziel:** Der „In Ablage hochladen"-Button in Excel und der neue PDF-Agent
(Alt+Shift+S) sollen Dateien in die **produktive** Ablage `artis.sm-artis.ch`
schieben — nicht nur in den Test (smartis.me).

**Wichtig vorab:** Im Excel-Add-in gibt es NICHTS umzustellen. Das VBA postet nur
an `http://localhost:7788/upload` und folgt damit dem *gerade offenen Desktop-Client*.
Auch der PDF-Agent nutzt 7788 (Client offen) bzw. den Browser-Weg (kein Client).
Welche Plattform befüllt wird, entscheidet also der **Client** bzw. die **Agent-Anmeldung**.

Damit ergeben sich genau zwei kleine Aufgaben:

---

## Aufgabe 1 — artis-Desktop-Client (deckt Excel UND PDF-Agent-Client-Weg ab)

Der Tauri-Client leitet den Kunden aus dem **EXE-Dateinamen** ab
(`get_customer_from_filename()` in `apps/src-tauri/src/lib.rs:315` → Teil vor dem
ersten `_`) und lädt dann `https://<kunde>.sm-artis.ch` (`lib.rs:431`).

**Änderung:** in `apps/src-tauri/tauri.conf.json`
```json
"productName": "artis_Smartis"   // statt "Smartis"
```
→ gebaute/installierte EXE heisst `artis_Smartis.exe` → Kunde = `artis`
→ Client lädt `https://artis.sm-artis.ch`.

- Der Upload-Server auf Port 7788 (`excel_upload_server`, `lib.rs:332`) ist bereits
  im Code — nichts weiter nötig.
- **Bitte prüfen**, dass die gebaute/installierte EXE wirklich den Präfix `artis_`
  trägt (Tauri leitet den Binärnamen aus `productName` ab; ggf. auch Cargo-Bin-Name).
- Rebuild über die übliche Pipeline (`npm run tauri build`) und verteilen.
- Hinweis: Es kann immer nur EINE Desktop-App gleichzeitig Port 7788 belegen.
  Für Produktion also den artis-Client laufen lassen (Test-Client schliessen).

---

## Aufgabe 2 — `?inbox`-Handler im artis-Frontend (für reine Browser-Nutzer)

Wenn kein Client offen ist, fällt der PDF-Agent auf den Browser-Weg zurück:
er lädt das PDF in den Transfer-Bereich (Bucket `dokumente`, Prefix `_inbox/`)
und öffnet `/<app>/Dokumente?inbox=<key>&filename=<name>`.

**Änderung:** Den `?inbox=`-Handler aus `src/pages/Dokumente.jsx` (Commit `e5c74216`)
nach artis portieren — derselbe Mechanismus wie die bestehende Excel-Integration
(`window.__SMARTIS_EXCEL_UPLOAD__`). Konkret der neue `useEffect`-Block (lädt die
Transfer-Datei per Signed URL → `setDropFile` → `setShowUpload`) plus das Entfernen
des `_inbox`-Objekts in `onUpload`/`onCancel`.

Nur nötig, wenn auch reine Browser-Nutzer (ohne Desktop-Client) den PDF-Agent
verwenden sollen. Reine Client-Nutzer brauchen das nicht.

---

## Aufgabe 3 (Check) — `checkin-discard` in api-artis

Der Checkout-Fix (Agent v3.2.0): ein unverändert geschlossenes Dokument wird über
die Edge-Function-Aktion `checkin-discard` freigegeben (setzt `checked_out_by=null`).
Diese Aktion existiert in `supabase/functions/sharepoint-files/index.ts:259`.

**Bitte prüfen**, dass die **api-artis**-Version dieser Edge Function die Aktion
`checkin-discard` kennt. Falls nicht: rüberportieren — sonst bleibt ein nur
angeschautes Dokument produktiv „ausgecheckt" (der Agent zeigt dann eine Warnung).

---

## Was NICHT nötig ist
- Keine Änderung am Excel-Add-in (VBA bleibt wie es ist).
- Kein neues Programm ausser dem Agent (`artis_agent.exe`) auf den Arbeitsplätzen.
