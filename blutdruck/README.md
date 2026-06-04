# ❤️ Blutdruck-Tracker

Eine kleine, eigenständige App, um Blutdruckwerte per **Foto** zu erfassen.
Du fotografierst dein Messgerät (z. B. Omron) mit dem Handy – eine KI liest
**oberen Blutdruck (SYS)**, **unteren Blutdruck (DIA)**, **Puls** und ein
eventuelles **Herzrhythmusstörungs-Symbol** aus und speichert alles zusammen
mit dem **Aufnahmedatum des Fotos** in einer kleinen SQL-Datenbank.

Komplett unabhängig vom MailFlow-Projekt.

## Funktionen
- 📷 Foto aufnehmen/hochladen → Werte werden automatisch erkannt und **direkt gespeichert**
- 🗓️ Datum kommt aus den **EXIF-Daten des Fotos**
- ✏️ Jeder Eintrag lässt sich nachträglich **korrigieren** (Datum, Werte, Rhythmusstörung, Notiz)
- 📊 Grafische Auswertung (Verlauf SYS/DIA/Puls + markierte Rhythmusstörungen)
- 🧮 Durchschnitt, letzter Wert, Anzahl Messungen, Farbcodierung nach Blutdruck-Kategorie
- ⬇️ **Excel-Export** aller Werte
- 📱 Handytauglich (mobile-first Weboberfläche)
- 🗄️ Daten in einer **SQLite-Datenbank** (`data/blutdruck.db`)

## Schnellstart (lokal)

```bash
cd blutdruck
cp .env.example .env      # mindestens EINEN KI-Schlüssel eintragen
npm install
npm start
```

Dann im Browser (oder Handy im selben WLAN) öffnen: `http://localhost:8080`
bzw. `http://<PC-IP>:8080`.

## KI-Schlüssel
Trage in `.env` mindestens einen Schlüssel ein – die App nimmt automatisch den
verfügbaren Anbieter (Reihenfolge: Gemini → OpenAI → Anthropic):

| Anbieter | Variable | Standard-Modell |
|----------|----------|-----------------|
| Google Gemini | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4.1-mini` |
| Anthropic Claude | `ANTHROPIC_API_KEY` | `claude-haiku-4-5-20251001` |

> Ohne KI-Schlüssel funktioniert die App trotzdem – das Foto wird gespeichert
> und du trägst die Werte manuell ein.

## Deployment (von überall erreichbar)
Da die App eine SQLite-Datei nutzt, braucht sie einen Host mit **persistentem
Speicher** (kein reines „Serverless"). Bewährt: ein kleiner Docker-Host
(Render, Railway, Fly.io, eigener Server/VPS).

### Render (per Blueprint, am einfachsten)
Im Repo-Root liegt `render.yaml`. Auf [render.com](https://render.com):
**„New +" → „Blueprint" → dieses Repo wählen.** Render richtet Web-Dienst und
persistente Festplatte (`/data`) automatisch ein. Danach im Dashboard einen
KI-Schlüssel (z. B. `GEMINI_API_KEY`) eintragen. Hinweis: Die persistente
Festplatte erfordert den bezahlten „Starter"-Plan (~7 USD/Monat).

### Docker (eigener Host)
Datenbank und Fotos liegen unter `/data` – diesen Pfad als Volume mounten,
damit beim Neustart nichts verloren geht.

```bash
docker build -t blutdruck .
docker run -d -p 8080:8080 \
  -e GEMINI_API_KEY=dein_key \
  -v $(pwd)/bp-data:/data \
  --name blutdruck blutdruck
```

## Datenbank
Tabelle `readings`:

| Spalte | Bedeutung |
|--------|-----------|
| `measured_at` | Messzeitpunkt (ISO, aus Foto-EXIF) |
| `systolic` | oberer Blutdruck (SYS) |
| `diastolic` | unterer Blutdruck (DIA) |
| `pulse` | Puls |
| `arrhythmia` | Herzrhythmusstörung (1 = ja, 0 = nein) |
| `note` | freie Notiz |
| `photo` | Dateiname des Fotos |
| `source` | `foto` oder `manuell` |

## Hinweis
Die automatische Auslesung ist eine Hilfe, kein Medizinprodukt. Kontrolliere
die erkannten Werte und korrigiere sie bei Bedarf über ✏️.
