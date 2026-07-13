# Sicherheit & Wartung – smartis.me / MailFlow

Stand: 2026-07-11 · Betrifft die Test-/Spielwiese **smartis.me** (Branch `master`, Vercel-Auto-Deploy).
Für das produktive **artis.sm-artis.ch** gilt zusätzlich: Änderungen nur mit ausdrücklicher Freigabe (siehe `CLAUDE.md`).

Dieses Dokument hat zwei Teile:
1. **Sicherheits-Statusbericht** – was aktuell gut ist und was gefixt gehört.
2. **Wartungs-Leitfaden** – wiederkehrende Aufgaben (täglich/wöchentlich/monatlich/quartalsweise), um so ein System dauerhaft gesund zu halten.

---

## 1. Sicherheits-Statusbericht

### Gesamteinschätzung
Das Fundament ist solide: serverseitige JWT-Prüfung, Rollen-Checks auf den Admin-Funktionen,
Row Level Security in der DB, keine Secrets im Repo. Die offenen Punkte sind vor allem
**veraltete Abhängigkeiten**, **fehlende HTTP-Security-Header** und **eine ungeprüft erreichbare Edge Function**.
Nichts davon ist ein akuter Daten-GAU, aber alles gehört abgearbeitet.

### ✅ Was bereits gut ist
- **Auth serverseitig**: `supabase/functions/_shared/auth.ts` (`requireUser`) prüft den JWT per
  `auth.getUser()` (Signaturprüfung), nicht per bloßem Dekodieren, und lehnt anon-Key-Aufrufe ab.
- **Rollen-Checks** auf allen kritischen Admin-Funktionen: `deleteUser`, `makeAdmin`,
  `setUserPassword`, `inviteUser`, `updateUserProfile` verlangen alle `role === 'admin'`.
- **Row Level Security** ist in den Migrationen aktiv (≈39 Migrationsdateien mit `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY`).
- **Keine Secrets im Repo**: keine eingecheckte `.env`, `.gitignore` deckt `.env.*` ab,
  Zugangsdaten laufen über Umgebungsvariablen (Supabase-Secrets / Vercel-Env).
- **Zefix-Credentials** liegen nur serverseitig; der frühere offene Proxy `api/zefix.js` wurde
  bewusst mit Token-Prüfung abgesichert (Commit „gegen offenen Zugriff absichern").

### ⚠️ Offene Punkte (nach Priorität)

#### P1 – `zefix-search` Edge Function ohne Aufrufer-Prüfung ✅ behoben
`supabase/functions/zefix-search/index.ts` prüfte den Aufrufer **nicht** (kein `requireUser`/`getUser`).
Sie war nur durch das Supabase-Gateway (`verify_jwt=true`) geschützt – das akzeptiert aber auch den
**öffentlichen anon-Key**, der im Frontend für jeden sichtbar ist. Damit war die Function faktisch ein
offener Proxy auf die (mengenmäßig limitierten) Zefix-Zugangsdaten. Genau dieses Loch wurde beim
Vercel-Fallback `api/zefix.js` bereits geschlossen – bei der Edge Function fehlte es noch.
→ **Erledigt in diesem PR**: `requireUser(req)` am Handler-Anfang eingebaut (lehnt anon-Aufrufe ab).

#### P1 – Verwundbare npm-Abhängigkeiten (`npm audit`: 37, davon 19 hoch)
- **`vite`, `ws`, `yaml`, `esbuild` u. a. (Fix verfügbar)**: ✅ **behoben in diesem PR** via
  `npm audit fix --package-lock-only` (nur Lockfile, semver-kompatibel, `package.json` unverändert).
  Ergebnis: **37 → 13** Vulnerabilities (19 → 5 hoch). Verifikation: der Vercel-Preview-Build des PR
  (lokal ließ sich `npm install` wegen eines Proxy-Fehlers nicht ausführen).
- **`xlsx` (hoch, Prototype Pollution + ReDoS)**: ✅ **behoben in diesem PR**. Die npm-Registry-`xlsx`
  ist bei 0.18.5 eingefroren (kein Fix mehr), deshalb Umstieg auf **`@e965/xlsx@0.20.3`** – den
  registry-installierbaren Mirror der gepflegten SheetJS-Version (Prototype Pollution ab 0.19.3, ReDoS
  ab 0.20.2 behoben). API-identisch → **Drop-in**, nur der Modul-Bezeichner in 14 Import-Stellen (8 Dateien)
  geändert, keine Logik. Lockfile mit Integrity-Hash gepinnt.
  → *Alternative/Upgrade-Pfad:* wer die **Original-Quelle** statt des Mirrors will, setzt
  `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`, ändert die Imports zurück auf `"xlsx"`
  und führt einmal lokal `npm install` aus (das CDN ist aus dem CI-Container nicht erreichbar).
  → *Optionale Zusatzhärtung (nicht in diesem PR):* Upload-Größenlimit + `try/catch` an den Parse-Stellen
  (Defense in Depth gegen client-seitiges DoS; die CVEs selbst sind bereits gefixt).
- **Verbleibende 4 High brauchen Major-Upgrades** (bewusst NICHT per `--force` erzwungen, da riskant):
  `pdfjs-dist` 3→4 (Kern der Fibu-PDF-Pipeline – sorgfältig testen), `quill` via `react-quill-new`
  (Editor), `tar`/`canvas`/`@mapbox/node-pre-gyp` (Build-Kette), `elliptic` via
  `vite-plugin-node-polyfills` (Build). → einzeln planen und mit Build-Test mergen.
  Aktueller Stand nach diesem PR: **12 Vulnerabilities (8 low, 4 high)**.

#### P2 – Keine HTTP-Security-Header ✅ (Basis) behoben
`vercel.json` setzte keine Sicherheits-Header. Die SPA war damit anfällig für Clickjacking und MIME-Sniffing.
→ **Erledigt in diesem PR**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, konservative `Permissions-Policy`.
→ **Noch offen**: eine **Content-Security-Policy** – wünschenswert, aber wegen PowerBI/Supabase/Infomaniak/PDF-Workern
sorgfältig zu testen (erst `Content-Security-Policy-Report-Only`, dann scharf schalten).

Beispiel für `vercel.json` (`headers`-Block ergänzen):
```json
"headers": [
  { "source": "/(.*)", "headers": [
    { "key": "X-Frame-Options", "value": "DENY" },
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
    { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" }
  ]}
]
```

#### P2 – Keine automatisierten Dependency-Updates
Bisher kein Dependabot/Renovate → Lücken bleiben unbemerkt bis zum nächsten manuellen `npm audit`.
→ **Behoben in diesem PR**: `.github/dependabot.yml` (wöchentliche npm- + Actions-Updates, Security sofort).

#### P3 – Uneinheitliches Auth-Muster in Edge Functions
Neuere Functions nutzen den zentralen Helfer `requireUser`; ältere (`deleteUser`, `makeAdmin`, …)
haben den gleichen Auth-Code handkopiert. Funktioniert, ist aber wartungsanfällig (eine Korrektur
muss an vielen Stellen nachgezogen werden).
→ **Maßnahme**: schrittweise auf `_shared/auth.ts` (`requireUser({ roles: ['admin'] })`) vereinheitlichen.

#### P3 – CORS `Access-Control-Allow-Origin: *` überall
Für tokengeschützte APIs vertretbar, aber in Kombination mit P1 (ungeprüfte Function) ein Verstärker.
→ **Maßnahme**: nach P1 optional auf die bekannten Origins (`smartis.me`, `artis.sm-artis.ch`) einschränken.

#### P4 – Kleinigkeiten
- Keine gepinnte Node-Version (`.nvmrc`/`engines`) → „läuft bei mir"-Drift zwischen Devs/CI/Vercel.
- `README.md` ist noch Base44-Boilerplate → durch echte Setup-Doku ersetzen.
- Der `dump schema`-Script in `package.json` enthält Pooler-Host/User im Klartext (Passwort ist Platzhalter) – ok, aber besser über Env.

---

## 2. Wartungs-Leitfaden – „Wie hält man smartis.me gesund?"

Checkliste zum Abarbeiten. Faustregel: **Automatisieren, was geht** (Dependabot, CI), den Rest terminieren.

### Laufend / bei jeder Änderung
- [ ] Vor dem Merge: `npm run build` läuft durch, kein neuer Lint-Fehler (`eslint`).
- [ ] Neue Edge Function? → `requireUser` (mit passenden `roles`) am Anfang, **bevor** irgendetwas passiert.
- [ ] Neue DB-Tabelle? → RLS aktivieren **und** Policies schreiben (Default: deny), nie „nur im Frontend" absichern.
- [ ] Keine Secrets/Keys in Commits (Pre-Commit-Check oder GitHub Secret Scanning).

### Wöchentlich
- [ ] Dependabot-PRs sichten und mergen (Patch/Minor meist gefahrlos, `npm run build` + Klick-Test).
- [ ] `npm audit` prüfen; neue „high"-Findings priorisieren.
- [ ] Supabase-Logs auf auffällige 401/403/500-Muster durchsehen (Missbrauch/Brute-Force?).
- [ ] Vercel-Deploys: sind alle Builds grün? Fehlgeschlagene untersuchen.

### Monatlich
- [ ] `npm outdated` – Minor/Patch nachziehen; Major-Upgrades einzeln planen (React, Vite, Supabase-JS).
- [ ] Supabase-Plattform-Updates (Postgres-Version, Auth) prüfen und einspielen.
- [ ] Auth durchsehen: aktive User/Rollen korrekt? Verwaiste Admin-Rechte entfernen (Least Privilege).
- [ ] Backups verifizieren: existiert ein aktueller DB-Dump und lässt er sich **testweise einspielen**? (Backup ohne Restore-Test = kein Backup.)
- [ ] Umgebungsvariablen/Secrets sichten (Vercel + Supabase): nichts Verwaistes, nichts Doppeltes.

### Quartalsweise
- [ ] Größere Framework-Upgrades einplanen und testen (Vite/React/Tailwind/Supabase-JS Majors).
- [ ] Secret-Rotation: Zefix-Credentials, Infomaniak-API-Key, Service-Role-Keys, ggf. MS365-App-Secrets erneuern.
- [ ] RLS-Policies stichprobenartig gegen echte Rollen testen (kann Rolle X wirklich nur die eigenen Daten sehen?).
- [ ] Node-LTS-Stand prüfen; auf gepinnte, unterstützte LTS-Version bleiben.
- [ ] Abhängigkeiten ohne Fix (z. B. `xlsx`) neu bewerten: Migration nötig geworden?

### Jährlich / anlassbezogen
- [ ] Vollständiger Security-Review (extern oder mit Checkliste): OWASP-Top-10-Durchgang, Auth-Flows, Datei-Uploads.
- [ ] DSGVO/CH-DSG-Sicht: Welche Personendaten liegen wo, wie lange? Löschkonzept aktuell?
- [ ] Disaster-Recovery-Übung: Supabase-Projekt aus Backup wiederherstellen, Ziel-Wiederanlaufzeit messen.
- [ ] Zugriffsrechte-Audit über alle Systeme (GitHub, Vercel, Supabase, MS365, Infomaniak).

### Grundprinzipien
- **Least Privilege**: jede Function/Rolle bekommt nur, was sie braucht. Admin ist die Ausnahme, nicht der Default.
- **Defense in Depth**: RLS in der DB **und** Auth-Check in der Function **und** UI-Gating – nicht nur eine Ebene.
- **Untrusted Input**: alles vom Client (Uploads, Query-Params, JSON-Bodies) ist potenziell bösartig → validieren (`zod` ist bereits im Projekt).
- **Automatisieren > Erinnern**: Dependabot, CI-Build-Gate und Secret-Scanning fangen mehr als jede Kalender-Erinnerung.
- **Test-first bei Prod**: Änderungen zuerst auf smartis.me, dann (mit Freigabe) nach artis.sm-artis.ch.

---

## 3. Anhang – Upgrade-Plan verbleibende Vulnerabilities (Stand nach diesem PR: 12, davon 4 hoch)

Diese vier brauchen Major-Upgrades; **je ein eigener Branch/PR mit Build- und Funktionstest**.
Nicht per `npm audit fix --force` bündeln – das reisst alle vier gleichzeitig hoch und macht Fehler unauffindbar.

### 3.1 `pdfjs-dist` 3.11.174 → 4.x  (hoch, Priorität 1)
- **Warum kritisch**: pdfjs ist das Herz der Fibu-PDF-Pipeline (digitale PDFs → Text) und wird an vielen
  Stellen genutzt (Belegerkennung, Abschluss-Import, Dokument-Preview).
- **Sofort-Mitigation ohne Upgrade** (empfohlen, low-risk): bei jedem `getDocument({ ... })`
  `isEvalSupported: false` setzen. Der bekannte High-Sev-Bug (Codeausführung via manipuliertes PDF)
  hängt an `eval`; das Abschalten neutralisiert ihn auch auf v3.
- **Upgrade v3→v4**: API-/Worker-Setup ändert sich (ESM-Worker, `GlobalWorkerOptions.workerSrc`,
  ggf. `import 'pdfjs-dist/build/pdf.worker.min.mjs'`). Testfälle: Beleg-OCR, PDF-Text-Extraktion,
  Vorschau, Abschluss-Import. Erst wenn alle grün → mergen.

### 3.2 `quill` 2.0.3 via `react-quill-new`  (hoch, Priorität 2)
- **Warum**: XSS-Klasse im Rich-Text-Editor. Betrifft alle Stellen mit Rich-Text
  (z. B. Ticket-Antworten, Notizen). Nutzer-Eingaben, die als HTML gerendert werden → real relevant.
- **Plan**: auf eine `react-quill-new`-Version aktualisieren, die gepatchtes quill zieht; Editor-Flows
  testen (Eingabe, Speichern, Anzeige). Zusätzlich serverseitig/DB-seitig HTML sanitizen (z. B. beim
  Rendern), nicht nur auf die Editor-Version verlassen.

### 3.3 `tar` / `canvas` / `@mapbox/node-pre-gyp`  (hoch, Priorität 3)
- **Warum niedriger real**: `tar`-Path-Traversal greift bei **Archiv-Extraktion zur Install-/Build-Zeit**,
  nicht im Browser-Runtime. `canvas` ist ein transitiver (Build-/Optional-)Dep.
- **Plan**: prüfen, wer `canvas` zieht (`npm ls canvas`); wenn nur Build/optional → `canvas` bumpen oder
  entfernen. Kein Produktiv-Runtime-Risiko für die SPA, aber CI/Dev-Hygiene.

### 3.4 `elliptic` via `vite-plugin-node-polyfills`  (hoch, Priorität 3)
- **Warum niedriger real**: kommt nur über den Node-Polyfill in den Bundle; relevant, falls Client-Code
  tatsächlich elliptische-Kurven-Signaturen prüft (im Projekt nicht ersichtlich).
- **Plan**: `vite-plugin-node-polyfills` aktualisieren (zieht gepatchtes `elliptic`); Build testen.
  Alternativ prüfen, ob der Polyfill überhaupt gebraucht wird.

### 3.5 Nicht per Bump lösbar – laufend beobachten
- **`xlsx`**: über `@e965/xlsx@0.20.3` erledigt (siehe P1). Falls der Mirror einschläft → auf die
  offizielle SheetJS-CDN-Quelle wechseln (Ein-Schritt, in P1 dokumentiert).
