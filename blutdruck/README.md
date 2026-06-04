# ❤️ Blutdruck-Tracker

Eine kleine, eigenständige App, um Blutdruckwerte per **Foto** zu erfassen.
Du fotografierst dein Messgerät (z. B. Omron) mit dem Handy – eine KI liest
**oberen Blutdruck (SYS)**, **unteren Blutdruck (DIA)**, **Puls** und ein
eventuelles **Herzrhythmusstörungs-Symbol** aus und speichert alles zusammen
mit dem **Aufnahmedatum des Fotos**.

**Technik:** Hosting auf **Vercel** (serverlos), Daten & Fotos in **Supabase**
(Postgres + Storage). Komplett getrennt vom MailFlow-/Firmen-Projekt – eigenes
Supabase- und Vercel-Projekt.

## Funktionen
- 🔒 **Login** (E-Mail + Passwort via Supabase Auth) – Daten nur nach Anmeldung sichtbar
- 📷 Foto aufnehmen/hochladen → Werte werden automatisch erkannt und **direkt gespeichert**
- 🗓️ Datum kommt aus den **EXIF-Daten des Fotos** (im Browser ausgelesen)
- 🗜️ Foto wird vor dem Upload **im Browser verkleinert** (schnell & datensparsam)
- ✏️ Jeder Eintrag lässt sich nachträglich **korrigieren** (Datum, Werte, Rhythmusstörung, Notiz)
- 📊 Grafische Auswertung (Verlauf SYS/DIA/Puls + markierte Rhythmusstörungen)
- 🧮 Durchschnitt, letzter Wert, Anzahl Messungen, Farbcodierung nach Blutdruck-Kategorie
- ⬇️ **Excel-Export** aller Werte
- 📱 Handytauglich (mobile-first Weboberfläche)

---

## 🚀 Einrichtung (einmalig, ohne Programmierkenntnisse)

### Schritt 1 – Supabase-Projekt anlegen (Datenbank)
1. Auf [supabase.com](https://supabase.com) anmelden → **„New project"**.
   Name z. B. `mini-apps`, Region **Frankfurt (EU)**. Passwort merken.
2. Links im Menü **„SQL Editor"** öffnen → **„New query"**.
3. Den Inhalt der Datei [`supabase-setup.sql`](./supabase-setup.sql) hineinkopieren
   und **„Run"** klicken. (Legt die Tabelle `readings` + den Foto-Bucket an.)
4. Unter **Project Settings → API** diese drei Werte kopieren (für Schritt 2):
   - **Project URL** → `SUPABASE_URL`
   - **service_role**-Schlüssel (geheim!) → `SUPABASE_SERVICE_ROLE_KEY`
   - **anon**/publishable-Schlüssel (öffentlich) → `SUPABASE_ANON_KEY`
5. **Login einrichten** unter **Authentication**:
   - **Providers → Email** aktivieren.
   - **Providers → Email**: „Confirm email" ausschalten *oder* den Nutzer in Schritt b
     direkt bestätigt anlegen.
   - Empfehlung **Sign Ups deaktivieren** (Authentication → Settings → „Allow new users
     to sign up" aus) → niemand kann sich selbst registrieren.
   - **Users → Add user** → deine E-Mail + Passwort, Häkchen **„Auto Confirm User"**.
     Mit diesen Daten meldest du dich später in der App an.

### Schritt 2 – Auf Vercel veröffentlichen (Hosting)
1. Auf [vercel.com](https://vercel.com) mit GitHub anmelden → **„Add New… → Project"**.
2. Dieses Repository wählen. Bei **„Root Directory"** auf **`blutdruck`** stellen.
3. Vor dem Deploy unter **„Environment Variables"** eintragen:

   | Name | Wert |
   |------|------|
   | `SUPABASE_URL` | (aus Supabase, Schritt 1.4) |
   | `SUPABASE_SERVICE_ROLE_KEY` | (aus Supabase, Schritt 1.4 – geheim) |
   | `SUPABASE_ANON_KEY` | (aus Supabase, Schritt 1.4 – „anon"/publishable, öffentlich) |
   | `GEMINI_API_KEY` | dein Google-Gemini-Schlüssel *(oder OpenAI/Anthropic)* |

4. **„Deploy"** klicken. Nach ~1 Minute bekommst du eine feste Adresse wie
   `https://blutdruck-tracker.vercel.app` – diese am Handy öffnen, fertig. 🎉

> Ohne KI-Schlüssel funktioniert die App trotzdem – das Foto wird gespeichert
> und du trägst die Werte manuell ein.

---

## KI-Schlüssel
Mindestens **einen** Anbieter hinterlegen (die App nimmt automatisch den
verfügbaren, Reihenfolge: Gemini → OpenAI → Anthropic):

| Anbieter | Variable | Standard-Modell |
|----------|----------|-----------------|
| Google Gemini | `GEMINI_API_KEY` | `gemini-2.5-flash` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4.1-mini` |
| Anthropic Claude | `ANTHROPIC_API_KEY` | `claude-haiku-4-5-20251001` |

## Lokal testen (optional)
```bash
cd blutdruck
cp .env.example .env      # Supabase-Werte + einen KI-Schlüssel eintragen
npm install
npm start                 # http://localhost:8080
```

## Datenbank
Tabelle `readings` (siehe `supabase-setup.sql`):

| Spalte | Bedeutung |
|--------|-----------|
| `measured_at` | Messzeitpunkt (aus Foto-EXIF) |
| `systolic` | oberer Blutdruck (SYS) |
| `diastolic` | unterer Blutdruck (DIA) |
| `pulse` | Puls |
| `arrhythmia` | Herzrhythmusstörung (true/false) |
| `note` | freie Notiz |
| `photo` | Dateiname des Fotos im Storage-Bucket |
| `source` | `foto` oder `manuell` |

## Weitere Mini-Apps
Künftige kleine Apps können **dasselbe Supabase-Projekt** mitbenutzen – einfach
je eine eigene Tabelle anlegen. So bleibt es bei *einer* Datenbank für alles.

## Hinweis
Die automatische Auslesung ist eine Hilfe, kein Medizinprodukt. Kontrolliere
die erkannten Werte und korrigiere sie bei Bedarf über ✏️.
