# artis MCP-Server

Lokaler **Model Context Protocol (MCP) Server** für die Treuhand-Plattform
**artis.sm-artis.ch** (Supabase-Backend). Er verbindet die Plattform-Module
direkt mit Claude, sodass Claude Daten **lesen, erstellen und ändern** kann –
**revDSG-konform**: Der Server läuft lokal (Nutzer-PC oder Infomaniak Swiss
Cloud), nur Anfragen/Antworten laufen über Claude, die **Rohdaten bleiben in der
Schweiz** und fliessen nicht in eine US-Cloud.

> Status: **Phase 1**. Module: Aufgaben-, Dokumenten-, Kunden-, Finanz- und
> Aktienbuch-Verwaltung.

## Architektur

- **TypeScript** + offizielles **`@modelcontextprotocol/sdk`**
- **stdio-Transport** – keine Netzwerk-Exposition, der Server wird vom
  MCP-Client (Claude Desktop / Claude Code) als Subprozess gestartet
- **Supabase** als Datenzugriff (`@supabase/supabase-js`)
- **Zod**-Validierung aller Tool-Inputs
- Strukturiertes **Logging auf stderr** (JSON-Lines; nur Metadaten: Tool,
  Mandant/Kunde, Dauer – **keine sensiblen Inhalte**)

### Mandanten-Scoping (wichtig)

Der Service-Role-Key **umgeht RLS**. Die Mandantentrennung wird darum im
**App-Layer** erzwungen: jede Query filtert explizit auf den konfigurierten
Kontext. Das Schema trennt den Mandanten-Begriff in **zwei** ID-Räume, die
denselben realen Klienten meinen, aber **nicht** per Foreign Key verbunden sind:

| Modul                | Scope-Spalte         | .env-Variable |
| -------------------- | -------------------- | ------------- |
| Aufgaben             | `tasks.customer_id`  | `CUSTOMER_ID` |
| Dokumente            | `dokumente.customer_id` | `CUSTOMER_ID` |
| Aktienbuch           | `aktienbuch.customer_id` | `CUSTOMER_ID` |
| Finanzbuchhaltung    | `fibu_*.mandant_id`  | `MANDANT_ID`  |

`CUSTOMER_ID` = `customers.id`, `MANDANT_ID` = `fibu_mandanten.id`. Beide für
denselben Klienten eintragen.

> **Hinweis Kundenverwaltung:** Kunden-*Suche* und *-Anlage* (`customers_search`,
> `customers_create`) arbeiten bewusst **instanzweit** (die `customers`-Tabelle
> ist der Klienten-Katalog der Treuhand-Firma selbst – so findet man auch erst
> die ID für `CUSTOMER_ID`). Operationen „auf den aktuellen Kunden“ defaulten
> auf `CUSTOMER_ID`.

## Setup

Voraussetzung: Node.js ≥ 20.

```bash
cd apps/mcp-server
npm install
cp .env.example .env      # Werte ausfüllen (siehe unten)
npm run build
```

### `.env`

Siehe `.env.example`. Pflichtfelder:

| Variable                    | Bedeutung |
| --------------------------- | --------- |
| `SUPABASE_URL`              | Projekt-URL (Test `smartis.me` **oder** produktiv `artis.sm-artis.ch`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-Role-Key – **umgeht RLS**, nie ins Frontend/Repo |
| `CUSTOMER_ID`               | `customers.id` für Aufgaben/Dokumente/Aktienbuch |
| `MANDANT_ID`                | `fibu_mandanten.id` für die Finanzbuchhaltung |
| `MCP_ALLOW_WRITES`          | `true` (default) / `false` für reinen Lese-Modus |
| `LOG_LEVEL`                 | `debug` \| `info` \| `warn` \| `error` |

> **Produktiv-Daten:** Gegen `artis.sm-artis.ch` (scharfe Daten) ist Vorsicht
> geboten. Für reines Abfragen `MCP_ALLOW_WRITES=false` setzen; alle
> schreibenden Tools sind dann gesperrt.

## Lokaler Start

```bash
npm run build && npm start    # gebauter Server (dist/index.js)
# oder im Watch-Modus während der Entwicklung:
npm run dev
```

Der Server kommuniziert über **stdio** – beim manuellen Start „passiert“ nichts
Sichtbares; er wartet auf JSON-RPC vom MCP-Client. Logs erscheinen auf stderr.

## Anbindung an Claude Desktop

`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "artis": {
      "command": "node",
      "args": ["/ABSOLUTER/PFAD/zu/mailflow/apps/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "...",
        "CUSTOMER_ID": "...",
        "MANDANT_ID": "...",
        "MCP_ALLOW_WRITES": "true"
      }
    }
  }
}
```

Alternativ die Werte in `.env` lassen und im `env`-Block weglassen – `.env` wird
beim Start geladen.

## Anbindung an Claude Code (CLI)

```bash
claude mcp add artis -- node /ABSOLUTER/PFAD/zu/mailflow/apps/mcp-server/dist/index.js
```

Konfiguration über die `.env` im Server-Verzeichnis, oder pro-Variable via
`--env`:

```bash
claude mcp add artis \
  --env SUPABASE_URL=https://your-project.supabase.co \
  --env SUPABASE_SERVICE_ROLE_KEY=... \
  --env CUSTOMER_ID=... \
  --env MANDANT_ID=... \
  -- node /ABSOLUTER/PFAD/.../apps/mcp-server/dist/index.js
```

## Tools (Phase 1)

### Aufgabenverwaltung
`tasks_list` · `tasks_get` · `tasks_create` · `tasks_update` ·
`tasks_set_status` · `tasks_assign` · `tasks_list_columns`

### Dokumentenverwaltung
`documents_search` (Metadaten + Volltext) · `documents_get` ·
`documents_get_download_url` (signierte URL) · `documents_upload` ·
`documents_categorize` · `documents_list_tags`

> Check-out/Check-in ist laut Projektvorgaben **tabu** und nicht enthalten.

### Kundenverwaltung
`customers_search` · `customers_get` · `customers_create` · `customers_update` ·
`customers_get_links` (verknüpfte Aufgaben/Dokumente)

### Finanzverwaltung
`finance_list_creditor_invoices` · `finance_get_creditor_invoice` ·
`finance_create_creditor_invoice` · `finance_record_payment`
(Zahlungsabgleich) · `finance_list_suppliers` · `finance_list_accounts` ·
`finance_creditors_summary` (Reporting) · `finance_cost_center_report`
(Kostenstellen)

> **MwSt-Regel (CH):** Beträge (netto/mwst/brutto) werden **nicht
> nachgerechnet**, sondern so übernommen, wie übergeben.

### Aktienbuch
`shares_list` · `shares_get` · `shares_register_transaction` ·
`shares_update_shareholder` · `shares_cap_table` (Aktionärsstruktur)

## Sicherheit & Datenschutz

- Service-Role-Key **niemals** committen oder ins Frontend geben. `.env` ist
  per `.gitignore` ausgeschlossen.
- Logs enthalten nur Metadaten (Tool, Mandant/Kunde, Dauer, Fehlertext) – keine
  Dokumentinhalte, Beträge oder Personendaten.
- Reiner Lese-Betrieb über `MCP_ALLOW_WRITES=false`.

## Projektstruktur

```
apps/mcp-server/
├─ src/
│  ├─ index.ts          # Einstieg, stdio-Transport, Tool-Registrierung
│  ├─ config.ts         # .env laden + validieren (Zod)
│  ├─ logger.ts         # strukturiertes Logging (stderr)
│  ├─ supabase.ts       # Supabase-Client (Service-Role)
│  ├─ scope.ts          # Mandanten-/Kunden-Scoping + Schreibschutz
│  ├─ tool.ts           # Tool-Wrapper (Error-Handling, Logging)
│  └─ modules/
│     ├─ tasks.ts       # Aufgabenverwaltung
│     ├─ documents.ts   # Dokumentenverwaltung
│     ├─ customers.ts   # Kundenverwaltung
│     ├─ finance.ts     # Finanzverwaltung
│     └─ shares.ts      # Aktienbuch
├─ .env.example
└─ README.md
```
