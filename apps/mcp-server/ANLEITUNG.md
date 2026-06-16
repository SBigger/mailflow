# Anleitung: artis MCP-Connector einrichten & testen

Schritt-für-Schritt von Null bis „Connector läuft in Claude". Alles spielt sich
im Verzeichnis `apps/mcp-server/` ab.

> Ergänzend zum [README](./README.md) (Architektur & Referenz). Diese Anleitung
> ist der praktische Durchlauf.

## Voraussetzungen
- **Node.js ≥ 20** installiert (`node --version`)
- Zugang zum Supabase-Projekt – zum Testen die **Spielwiese smartis.me**, nicht
  produktiv `artis.sm-artis.ch`
- **Claude Desktop** oder **Claude Code** (CLI)

---

## Schritt 1 – Server bauen
```bash
cd mailflow/apps/mcp-server
npm install
npm run build
```
Ergebnis: Ordner `dist/` entsteht.

---

## Schritt 2 – Zugangsdaten besorgen
Im **Supabase-Dashboard** des Test-Projekts: `Project Settings → API`
- **Project URL** → `SUPABASE_URL`
- **`service_role` secret** (nicht `anon`!) → `SUPABASE_SERVICE_ROLE_KEY`

> ⚠️ Der `service_role`-Key ist ein Vollzugriffs-Schlüssel und umgeht RLS. Nur
> lokal in `.env`, niemals committen oder weitergeben.

---

## Schritt 3 – `.env` anlegen
```bash
cp .env.example .env
```
Dann `.env` ausfüllen:
```bash
SUPABASE_URL=https://<dein-projekt>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role-key>
CUSTOMER_ID=                 # vorerst leer – holen wir in Schritt 5
MANDANT_ID=                  # vorerst leer
MCP_ALLOW_WRITES=false       # erst mal NUR LESEN (sicher)
LOG_LEVEL=info
```

---

## Schritt 4 – Startet der Server? (Schnellcheck)
```bash
npm start
```
Es erscheint nur eine Log-Zeile auf stderr (`server_started …`) und sonst
„nichts" – **das ist korrekt**. Der Server wartet über stdio auf einen
MCP-Client. Mit `Strg+C` beenden.

---

## Schritt 5 – Mit dem MCP Inspector testen (empfohlen)
Der Inspector ist eine kleine Web-Oberfläche zum Anklicken der Tools:
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```
Im Browser-Tab:
1. **„List Tools"** klicken → alle 31 Tools erscheinen.
2. Tool **`customers_search`** wählen, `query` = Stück eines Kundennamens, **Run**.
3. In der Antwort die **`id`** des Test-Kunden kopieren.
4. Diese ID in `.env` als **`CUSTOMER_ID`** eintragen.
   - Für das Finanzmodul zusätzlich die **`fibu_mandanten.id`** als `MANDANT_ID`
     (aus der App unter Fibu/Mandanten).
5. Inspector neu starten und Lese-Tools ausprobieren:
   `tasks_list`, `documents_search`, `finance_list_creditor_invoices`,
   `shares_cap_table`.

Liefern diese saubere Daten, ist der Connector funktionsfähig. ✅

---

## Schritt 6 – Schreiben testen (optional)
In `.env` `MCP_ALLOW_WRITES=true` setzen, Inspector neu starten, z. B.
`tasks_create` mit `title="MCP Test"` ausführen und mit `tasks_list` prüfen.

---

## Schritt 7 – In Claude anbinden

**Claude Code (CLI):**
```bash
claude mcp add artis -- node /ABSOLUTER/PFAD/mailflow/apps/mcp-server/dist/index.js
claude
```
Im Chat `/mcp` → „artis: connected". Dann z. B.: „Liste die offenen Aufgaben des
aktuellen Kunden."

**Claude Desktop:** Eintrag in `claude_desktop_config.json` (Pfade/Env siehe
README, Abschnitt „Anbindung an Claude Desktop"), App neu starten.

---

## Häufige Stolpersteine

| Symptom | Ursache / Lösung |
| --- | --- |
| „CUSTOMER_ID ist nicht konfiguriert" | ID in `.env` eintragen (Schritt 5) |
| Finanz-Tools melden Fehler | `MANDANT_ID` fehlt (= `fibu_mandanten.id`, ≠ CUSTOMER_ID) |
| Schreib-Tool „gesperrt" | `MCP_ALLOW_WRITES=true` setzen |
| Claude findet Server nicht | **absoluten** Pfad zu `dist/index.js`; vorher `npm run build` |
| Leere Ergebnisse | richtige `CUSTOMER_ID`? richtige Instanz (smartis.me)? |

---

## Sicherheit
- Gegen **produktiv** (`artis.sm-artis.ch`) zunächst `MCP_ALLOW_WRITES=false`.
- `service_role`-Key niemals committen – `.env` ist per `.gitignore`
  ausgeschlossen.
- Logs enthalten nur Metadaten (Tool, Mandant/Kunde, Dauer), keine Inhalte.
