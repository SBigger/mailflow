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
- **`xlsx` (hoch, KEIN Fix verfügbar)** – *offen, braucht Migration*: Prototype Pollution + ReDoS.
  Wird an mehreren Stellen auf **hochgeladene Dateien** angewendet (`XLSX.read(...)` in
  `KontaktImportExport.jsx`, `Abschlussdokumentation.jsx`, `Steuerausscheidung.jsx`) → verarbeitet
  fremde/untrusted Eingaben. → **Maßnahme**: auf die gepflegte SheetJS-Version von
  `https://cdn.sheetjs.com` umstellen (npm-Registry-`xlsx` ist eingefroren) **oder** auf `exceljs`
  migrieren; Uploads vorab auf Größe/Typ begrenzen.
- **Verbleibende 5 High brauchen Major-Upgrades** (bewusst NICHT per `--force` erzwungen, da riskant):
  `pdfjs-dist` 3→4 (Kern der Fibu-PDF-Pipeline – sorgfältig testen), `quill` via `react-quill-new`
  (Editor), `tar`/`canvas`/`@mapbox/node-pre-gyp` (Build-Kette), `elliptic` via
  `vite-plugin-node-polyfills` (Build). → einzeln planen und mit Build-Test mergen.

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
