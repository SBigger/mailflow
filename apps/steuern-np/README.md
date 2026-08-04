# Steuern nP

Agentische Steuerdeklaration für **natürliche Personen** in den Kantonen ZH, SG und TG.
Belege einlesen (OCR/PDF/XML) → relevant/nicht relevant sortieren → Felder füllen →
elektronisch einreichen. Mandantenfähig.

> **Status: früher Aufbau.** Ingest und Triage stehen, der eCH-0119-Export wartet auf die
> Schema-Verifikation und der Einreichungskanal auf die Antwort der Steuerverwaltungen.
> Details und offene Punkte: [`docs/recherche-und-architektur.md`](./docs/recherche-und-architektur.md).

## Eigenständig, nicht Teil von MailFlow

Diese App ist bewusst von MailFlow getrennt:

- **eigener Build** — eigenes `package.json`, eigenes Vite-Setup, kein Import aus `../../src`
- **eigenes Supabase-Projekt** — eigene Datenbank, eigene Auth, eigene Edge Functions
- **eigenes Deployment**

Der Grund ist nicht Ordnungsliebe: Steuerdaten unterliegen dem **Steuergeheimnis**,
zusätzlich zum revDSG. Eine physisch getrennte Datenhaltung ist das belastbarste Argument
gegenüber Mandanten und Aufsicht — und sie macht eine spätere Ausgliederung des Produkts
möglich, ohne Daten entflechten zu müssen.

**Aus MailFlow übernommen** (kopiert, nicht importiert):

| Datei | Herkunft | Warum |
|---|---|---|
| `src/lib/pdfFill.js` | `src/lib/pdfFill.js` | Befüllt amtliche PDF-Formulare. Der Rückfallpfad, falls die kantonale Schnittstelle verschlossen bleibt |
| `src/components/PdfViewer.jsx` | dito | Belegvorschau im Review |
| `src/lib/dokumentText.js` | Auszug aus `src/lib/batchAiSuggest.js` | OCR-/PDF-Extraktion, Tesseract-Lazy-Loading, OCR-tolerante UID-Erkennung |
| Triage-Muster (Regeln, dann KI ab < 0.85) | `batchAiSuggest.js` | Bewährt in der Massenablage |
| RLS-Muster über `user_mandant_access` | FiBu-Modul | Mandantenfähigkeit |

## Setup

```bash
cd apps/steuern-np
npm install
cp .env.example .env.local     # eigenes Supabase-Projekt eintragen
npm run dev
```

Datenbank aufsetzen:

```bash
supabase db push               # gegen das Steuer-Projekt, NICHT gegen MailFlow
```

Edge Function:

```bash
supabase functions deploy steuer-suggest-position
supabase secrets set INFOMANIAK_API_KEY=…
```

## Aufbau

```
src/
  lib/
    belegarten.js     Katalog der Belegarten mit Erkennungsmustern und eCH-0119-Ziel
    triage.js         Zweistufige Relevanz-Triage (Regeln → KI ab < 0.85)
    ech0196.js        Parser für den eSteuerauszug
    dokumentText.js   Text-/OCR-Extraktion, Hash, UID/AHV-Erkennung
    pdfFill.js        PDF-Formularbefüllung (Rückfallpfad)
  pages/
    Triage.jsx        Vier-Augen-Review: Beleg links, Positionen rechts
supabase/
  migrations/         Schema mit RLS und den beiden Invarianten
  functions/          steuer-suggest-position (nur Infomaniak, kein US-Fallback)
scripts/
  spike-pdf417-…      Spike: PDF417-Barcodes aus eSteuerauszug lesen (Backlog V11)
docs/
  recherche-und-architektur.md   Recherche, Kantonsvergleich, Zielarchitektur, Backlog
  anfragen-kantone.md            Versandfertige Anfragen an KStA ZH und Steuerverwaltung TG
```

## Zwei Regeln, die das System durchhält

1. **Kein Wert ohne Herkunft.** Jede Position verweist entweder auf einen Beleg oder auf
   den Menschen, der sie bestätigt hat. Als CHECK-Constraint in der Datenbank, nicht nur
   im UI.
2. **Der Agent bereitet vor, ein Mensch gibt frei.** Die Einreichung ist per Trigger
   gesperrt, solange Vollmacht, Freigabe oder Bestätigungen fehlen.

## Nächste Schritte

Der kritische Pfad läuft nicht über Code, sondern über zwei Briefe — siehe
[`docs/anfragen-kantone.md`](./docs/anfragen-kantone.md). Ohne die Antwort des KStA Zürich
ist nicht bekannt, wie der Upload technisch funktioniert; ohne die Antwort der
Steuerverwaltung Thurgau nicht, ob TG überhaupt in den Projektumfang gehört.

Parallel dazu, unabhängig von den Antworten:

- eCH-0119-XSD beschaffen und den Feld-Mapping-Katalog (§8a der Recherche) verbindlich machen
- PDF417-Spike an einem echten eSteuerauszug messen
- Beleg-Upload und Storage-Anbindung ergänzen
