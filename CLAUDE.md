# MailFlow / smartis.me

React + Vite SaaS, Supabase-Backend, Vercel-Deployment (Branch `master` → Auto-Deploy).
Produktiv: https://smartis.me · Desktop-Wrapper: Electron.

## Tabu / Hands-off
- **MS365-Mail-Integration** – produktiv, nicht anfassen.
- `handleCheckout` / `handleCheckin` in `src/pages/Dokumente.jsx`, `src/lib/fileHandleDB.js`, `CheckinDialog.jsx`.
- **Keine Commits/Pushes ohne ausdrückliches OK** des Users.

---

# Fibu-Modul – KI-Belegerkennung (Stand 2026-05-15)

Kontext: Das Fibu-Modul (`src/modules/fibu/`) soll Kreditoren-Belege per KI
verbuchen helfen (Beleg → Lieferant, Datum, Beträge, MwSt → Buchungsvorschlag).
Multi-Mandanten-fähig (`MandantContext`). Das Tool soll auch **verkauft** werden.

## Architektur-Entscheidung: Schweizer Cloud-KI, NICHT Offline-Hardware

Nach PoC (Mai 2026) entschieden: **Infomaniak AI Tools** als KI-Backend.
- CH-Rechenzentren (Genf/Zürich), kein US Cloud Act, OpenAI-kompatible API
- ~0.10 CHF / Mio Token → ~0.00025 CHF pro Beleg (vernachlässigbar)
- Skaliert automatisch mit Verkäufen – kein Hardware-Rollout pro Kunde
- **Offline-KI (Ollama/Mac Mini/GPU-Server) verworfen** als Standard: skaliert
  nicht bei Verkauf, Hardware-/Wartungskosten. Nur als Premium-On-Premise-Option
  für Kunden mit "nichts darf raus"-Anforderung im Hinterkopf behalten.

**Umbau-Aufwand:** minimal. Die KI steckt schon hinter EINER Edge Function
(`supabase/functions/suggest-document-fields`). Aktuell ruft sie OpenAI→Gemini→Claude
(alles US-Anbieter). → Nur diesen Provider auf Infomaniak umstellen (OpenAI-kompatibel,
also Endpoint + Key + Modellname tauschen). Rest der Pipeline bleibt 1:1.

## Pipeline (durch PoC bestätigt)

1. **Digitale PDFs** → Text direkt via `pdfjs` (Millisekunden, KEIN KI/OCR nötig).
2. **Scans** (kein Textlayer) → OCR via Tesseract.js → Text.
3. **Text → LLM → strukturiertes JSON** (Lieferant, Datum, Beträge, MwSt, Positionen).
4. **Lokales Matching behalten** (`batchAiSuggest.js`: UID/Firmenname/Adresse) –
   findet den Lieferanten oft ohne KI-Call.

- **Vision-LLM (Bild direkt ans Modell) NICHT nutzen** – im PoC 2-8 Min/Beleg, viel
  zu langsam. Immer erst Text extrahieren, dann Text-LLM.

## Regeln für die KI-Extraktion

- **MwSt nicht nachrechnen.** Ausgewiesene Steuer = geschuldete/abziehbare Steuer
  (CH-Recht). KI liest Brutto, MwSt-Betrag, MwSt-Satz nur AB. MwSt-Code danach im Code.
- **Empfänger-Kontext mitgeben:** Prompt sagt "Rechnung ist an «[Mandant]» adressiert
  – das ist der Empfänger, NICHT der Lieferant". Behebt Lieferant/Empfänger-Verwechslung.
- **Plausi-Checks im Code**, nicht die KI alles raten lassen: z.B. prüfen ob das
  extrahierte Datum/der Betrag wörtlich im Belegtext vorkommt (gegen Halluzination).

## Bekannter Bug (offen)

`src/lib/batchAiSuggest.js`, `findUidInText()` (~Z.265): Der UID-Regex erlaubt nur
`[.\s-]` als Trenner. OCR macht aus "." oft ein "," → `CHE-116.303,292` wird NICHT
erkannt. Fix: Trennzeichen-Klasse auf `[.,\s-]` erweitern (OCR-Toleranz).

## PoC-Code

`mailflow/ai-poc/` – Test-Scripts aus dem PoC (Python). Wiederverwendbar für
Infomaniak: nur den LLM-Endpoint (war lokales Ollama `127.0.0.1:11434`) auf die
Infomaniak-API umstellen. `extract.py` = komplette Pipeline (digital + OCR + LLM).

## Bestehende Fibu-Struktur (Orientierung)

- `src/modules/fibu/` – Seiten: RechnungInbox, RechnungErfassen, KreditorenDashboard,
  Kontenplan, MwstCodes, Lieferanten, Bilanz, Belegjournal, BankAbstimmung …
- `src/lib/batchAiSuggest.js` – Text-Extraktion (PDF/Office/Bild), OCR (Tesseract.js),
  lokales Matching, KI-Fallback via Edge Function.
- DB: `fibu_rechnung_inbox` (+ `mandant_id`-RLS), Storage-Bucket `fibu-inbox`.
