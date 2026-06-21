# 🏛️ GV-Protokoll

Web-App zum **Aufnehmen, Transkribieren und Protokollieren von Generalversammlungen**
(und anderen Sitzungen) — mit automatischer Sprecher-Trennung und KI-Auswertung.

**Quellcode / Download:**
👉 https://github.com/SBigger/mailflow/tree/master/apps/gv-protokoll

Die ganze App steckt in **einer einzigen Datei** (`index.html`) — kein Build, keine Installation, keine externen Abhängigkeiten.

---

## Funktionen

- **Links:** Teilnehmer erfassen
- **Mitte:** Live-/Stopp-Transkript mit automatischer **Sprecher-Trennung**; jeder Sprecher per Dropdown einer Person zuordenbar (inkl. Vorhören & Zusammenführen)
- **Rechts:** **Zusammenfassung, Aufgaben und Beschlüsse** (von Claude erzeugt), editierbar
- **Crash-sicher:** Aufnahme wird laufend lokal gesichert (IndexedDB) → nach Browser-Absturz/Reload wiederherstellbar
- **Export** als Markdown-Protokoll

---

## Schnellstart (Windows)

1. **Starten** – eine der Optionen:
   - Doppelklick auf **`GV-Protokoll.vbs`** (stiller Launcher, öffnet ein eigenes App-Fenster) – kann an die Taskleiste angepinnt werden
   - oder **`GV-Protokoll starten.bat`**
   - oder `index.html` direkt im Browser (empfohlen: Chrome/Edge)
2. **Einmalig einrichten** (⚙️ oben rechts):
   - **ElevenLabs API-Key** eintragen → https://elevenlabs.io/app/developers/api-keys
   - **Claude (Anthropic) API-Key** eintragen → https://platform.claude.com/settings/keys
   - **Mikrofon** laden & auswählen (auch Bluetooth)
   - **Speichern** (die Status-Chips werden grün)
3. **Benutzen:** Teilnehmer erfassen → 🔴 **Aufnahme** → ■ **Stopp** (transkribiert automatisch) → Sprecher zuordnen → ✨ **Auswerten** → ⬇️ **Export**

> 💡 Statt aufnehmen kann man mit **📁 Audio laden** auch eine bestehende Audiodatei transkribieren.

---

## Für neue Mitarbeiter

1. Ordner `apps/gv-protokoll/` von GitHub herunterladen (oder das Repo klonen).
2. App starten (siehe Schnellstart) und **eigene API-Keys** eintragen.
3. Fertig.

**Wichtig:** Die API-Keys werden **nur lokal im Browser** gespeichert (pro Gerät/Adresse) und liegen **nicht** im Repo. Jede Person trägt ihre eigenen Keys ein. Beide Dienste sind kostenpflichtig (nutzungsabhängig); eine GV-Auswertung kostet nur wenige Rappen.

---

## Technik (kurz)

- **Transkription:** ElevenLabs `scribe_v2` (Batch, Diarization bis 32 Sprecher, bis 10 h / 3 GB)
- **KI-Auswertung:** Claude (Anthropic), Standardmodell `claude-opus-4-8` — Direktaufruf aus dem Browser
- **Speicherung:** Audio-Chunks + Transkript in IndexedDB / localStorage (crash-sicher, alles lokal)
- **Sprache:** Deutsch / Schweizerdeutsch (über das Deutsch-Modell; reine Mundart bleibt für jede STT herausfordernd)
- Reine Browser-App, kein eigenes Backend.
