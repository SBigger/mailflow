# MailFlow / smartis.me

React + Vite SaaS, Supabase-Backend, Vercel-Deployment (Branch `master` → Auto-Deploy).
Test-/Spielwiese: https://smartis.me · Desktop-Wrapper: Electron + Tauri (`apps/`).
Produktiv (scharfe Daten): https://artis.sm-artis.ch (Backend `api-artis.sm-artis.ch`).

## Commit-/Push-Freigabe (Stand 2026-05-31)
- **smartis.me (Branch `master`, Vercel-Auto-Deploy):** Commits + Pushes **erlaubt** ohne extra Rückfrage.
  smartis.me ist die Test-/Spielwiese; Vercel deployt automatisch nach jedem Push auf master.
- **api-artis (artis.sm-artis.ch, produktiv):** scharfe Daten — **sporadisch bis gar nicht** ändern,
  und wenn überhaupt nur **mit ausdrücklicher Bestätigung**. Default: nicht anfassen.
  Roger übernimmt Code-Änderungen von smartis.me nach artis.sm-artis.ch.

## Tabu / Hands-off
- **MS365-Mail-Integration** – produktiv, nicht anfassen.
- `handleCheckout` / `handleCheckin` in `src/pages/Dokumente.jsx`, `src/lib/fileHandleDB.js`, `CheckinDialog.jsx`.

## Repo-Struktur (nach Refactor 31.05.2026)
- `src/` – React-Frontend (Vite)
- `apps/electron/` – Electron-Wrapper (Desktop-App, früher `electron/`)
- `apps/src-tauri/` – Tauri-Wrapper (früher `src-tauri/`)
- `apps/artis_agent/` – Python-Agent für Checkout/Checkin (früher `artis_agent/`)
- `supabase/functions/` – Edge Functions
- `scripts/` – Daten-Import-Skripte (PowerShell)

## Import-Konfig (Daten-Import nach api-artis)
`scripts/artis-import-config/` enthält:
- `dok_tags_bereinigt.json` – aktuelle Tag-Liste (Soll-Wahrheit)
- `synonym_map.json` – Dateiname-Variante → Tag-Name
- `dok_tags_VOR_bereinigung.json` – Snapshot vor User-Aufräumen
- `GELOESCHTE_tags.json` – die 12 User-gelöschten Doppel-Tags

## Fibu-Modul – KI-Belegerkennung
- KI-Backend: **Infomaniak AI Tools** (CH-Cloud, OpenAI-kompatibel).
  Edge Function: `supabase/functions/suggest-document-fields`.
- Pipeline: digitale PDFs → `pdfjs`; Scans → Tesseract.js OCR; Text → LLM → JSON.
- Regel: **MwSt nicht nachrechnen** (CH-Recht). KI liest Brutto/MwSt-Betrag/Satz AB.
- Empfänger-Kontext mitgeben: „Rechnung an «[Mandant]» – das ist Empfänger, NICHT Lieferant".
- Plausi-Checks im Code (Datum/Betrag wörtlich im Belegtext?), nicht KI alles raten lassen.

### UID-OCR-Erkennung (erledigt)
`src/lib/batchAiSuggest.js`, `findUidInText()` (~Z. 267): Die UID-Regex ist OCR-tolerant –
die Trennzeichen-Klasse ist `[.,\s-]` (inkl. Komma), und sie läuft auf dem rohen Text.
`CHE-116.303,292` (OCR macht aus "." oft ",") wird korrekt erkannt. Kein offener Bug mehr.
