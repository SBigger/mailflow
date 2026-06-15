# VoxDrop by Artis

Windows-Tray-Tool für Sprach-zu-Text und KI-gestützte Smartis-Abfragen.

**Aktuelle Version:** 1.7.1 · **Erstellt von:** Artis Treuhand GmbH

---

## Was es kann

| Hotkey | Funktion |
|--------|----------|
| `Strg+Q` (1×) | Diktat starten — Live-Stream beginnt |
| `Strg+Q` (2×) | Diktat stoppen — Text wird an Cursor-Position eingefügt |
| `Strg+Shift+Q` (1×) | "Frag Smartis" — Aufnahme einer Frage |
| `Strg+Shift+Q` (2×) | Frage absenden → KI-Antwort-Popup |
| `Strg+Shift+W` | Kunden-Picker → Aktionen der letzten Monate je Kunde |

## Transkriptions-Backends (im Tray umschaltbar)

1. **Deepgram Nova-3** — bestes Schweizer-Deutsch via WebSocket (Standard)
2. **ElevenLabs Scribe v2 Realtime** — ~150ms Latenz
3. **Lokal (faster-whisper)** — offline, 5 Modellgrössen tiny → large-v3

## Setup für Entwickler

```bash
pip install -r requirements.txt
python voxdrop.py
```

Konfiguration über lokalen Webserver auf `http://127.0.0.1:7799` (nach Start automatisch erreichbar via Tray-Menü).

## Build (EXE + Setup-Installer)

```bash
# 1. Haupt-EXE bauen
python -m PyInstaller --noconfirm VoxDrop.spec
# → erzeugt dist/VoxDrop.exe (~185 MB)

# 2. Setup-Installer drumherum bauen
python build_installer.py
# → erzeugt output/VoxDrop-Setup-v<VERSION>.exe (~200 MB)
```

**Achtung:** Vor dem Build die Versionsnummer in beiden Files synchron halten:
- `voxdrop.py` → `VERSION = "X.X.X"`
- `build_installer.py` → `APP_VERSION = "X.X.X"`

## Backend-Anbindung

VoxDrop ruft die Supabase Edge Function **`voice-assistant`** auf. Die URL und der Anon-Key sind in `voxdrop.py` (Zeilen ~238-239) konfiguriert:

```python
_SUPABASE_URL      = "https://api-artis.sm-artis.ch"
_SUPABASE_ANON_KEY = "<HS256-anon-key>"
```

**Drei Modi:**

| Request | Antwort |
|---------|---------|
| `{"get_customers": true}` | `{customers: [{id, company_name}, ...]}` |
| `{"customer_id": "<uuid>", "since_months": 6}` | `{answer, sources, data: {tasks, doks, fristen, mails, calls, aktien, fahrzeuge}}` |
| `{"question": "..."}` | `{answer, sources, data}` (KI-Antwort via Claude) |

## Aktueller Status auf neuem Backend

⚠️ Siehe [WAS-ROGER-MACHEN-MUSS.md](./WAS-ROGER-MACHEN-MUSS.md) — die `voice-assistant` Function auf `api-artis.sm-artis.ch` ist abgespeckt und kennt `get_customers` nicht. Roger muss einen kleinen Block ergänzen.

## Distribution

Setup-EXE wird via `mailflow/public/VoxDrop-Setup-vX.X.X.exe` ausgeliefert und in `src/pages/Settings.jsx` verlinkt. Da die EXE >100 MB ist, kann sie **nicht via Git** committed werden (GitHub-Limit) — Hosting via GitHub Releases oder Vercel-CLI-Upload nötig.
