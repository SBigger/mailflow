# VoxDrop / Smartis – Was Roger machen muss

**Stand 01.06.2026** · **Autor:** Sascha Bigger (Artis Treuhand GmbH)

---

## Worum es geht

VoxDrop (das Sprache-zu-Text Tray-Tool von Artis) wurde auf das neue Backend `https://api-artis.sm-artis.ch` umgestellt. Die globalen Hotkeys funktionieren, die Verbindung zur Edge Function steht – **ABER** die Function `voice-assistant` auf dem neuen Backend ist eine abgespeckte Version und kennt einen Modus nicht, den VoxDrop dringend braucht.

---

## Beobachteter Fehler

Beim Drücken von `Strg+Shift+W` (Kunden-Picker) schickt VoxDrop:

```json
POST /functions/v1/voice-assistant
{"get_customers": true}
```

Die Function antwortet mit:

```
HTTP 400 Bad Request
{"error": "question is required"}
```

**Folge:** Kunden-Picker funktioniert nicht. Es lädt keine Kundenliste, das Auswahl-Popup erscheint gar nicht erst.

---

## Was du tun musst

In der Edge Function `voice-assistant` (Datei `index.ts`) **ganz am Anfang**, direkt nach `const body = await req.json();`, diesen Block ergänzen:

```typescript
if (body.get_customers) {
  const { data: customers } = await supabase
    .from('customers')
    .select('id, company_name')
    .order('company_name')
    .limit(2000);
  return new Response(JSON.stringify({ customers: customers || [] }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

Dieser Block:
- erkennt den `get_customers: true` Modus
- holt alle Kunden (id + Firmenname) aus der `customers` Tabelle
- gibt sie als JSON zurück, ohne durch die KI/Claude-Pipeline zu laufen

---

## Was die alte Function zusätzlich noch konnte

Neben `get_customers` und `question` gibt es einen dritten Modus:

```json
{"customer_id": "<uuid>", "since_months": 6}
```

Dieser liefert für einen bestimmten Kunden die Aktionen der letzten N Monate zurück:

```json
{
  "answer": "...",
  "sources": [...],
  "data": {
    "tasks": [...],
    "doks": [...],
    "fristen": [...],
    "mails": [...],
    "calls": [...],
    "aktien": [...],
    "fahrzeuge": [...]
  }
}
```

→ Bitte prüfen ob dieser Modus auf dem neuen Backend ebenfalls vorhanden ist, sonst funktioniert der Detail-Bereich des Kunden-Pickers (Quadranten-Popup nach Auswahl eines Kunden) nicht.

---

## Test nach dem Deploy

```bash
curl -X POST https://api-artis.sm-artis.ch/functions/v1/voice-assistant \
  -H "Authorization: Bearer <anon-key>" \
  -H "apikey: <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"get_customers": true}'
```

Soll eine JSON-Antwort mit `{"customers":[...]}` liefern (Liste aller Kunden mit `id` und `company_name`).

---

## Tabellen die die Function liest

`customers`, `tasks`, `fristen`, `mail_items`, `doks`, `calls`, `aktien`, `fahrzeuge`

Falls im neuen Schema Tabellen- oder Spaltennamen abweichen, müssen die Queries in der Function entsprechend angepasst werden.

---

## Source-Code-Referenz (alte Function)

Die vollständige alte Version der Function liegt im Mailflow-Repo unter:
`mailflow/supabase/functions/voice-assistant/index.ts`

Der `get_customers`-Block (Zeilen ~174-184) kann eins zu eins übernommen werden.

---

## Aktueller Workaround für Sascha

Solange der `get_customers`-Block nicht eingebaut ist:
- Alte installierte VoxDrop EXE (v1.7.0 vom 03.05.2026) behalten – sie zeigt noch auf die alte Supabase `uawgpxcihixqxqxxbjak.supabase.co` und funktioniert dort vollständig.
- Die neue v1.7.1 EXE (zeigt auf `api-artis.sm-artis.ch`) liegt bereit, wird aber erst installiert sobald die Function-Erweiterung deployed ist.
