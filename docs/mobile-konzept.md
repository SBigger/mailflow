# SmartDesme am Handy — Konzept

**Stand 20.08.2026 · Vorschlag, noch nicht umgesetzt.**
Bedienbare Mockups: [`mockups/mobile/index.html`](../mockups/mobile/index.html)
(im Browser öffnen — Gerät, Farbwelt und Bildschirm sind umschaltbar).

Alles hier bezieht sich auf **smartis.me**. An api-artis wird nichts angefasst.

---

## Befund

| # | Punkt | Fundstelle |
|---|---|---|
| 1 | E-Binder hat kein Handy-UI — grösste Seite der App, 0× `isMobile` | `src/pages/Dokumente.jsx:2061` |
| 2 | 80× `h-screen` / `100vh`, 0× `dvh` → Adressleiste schneidet ab | projektweit |
| 3 | `viewport` ohne `viewport-fit=cover` → kein randloses Vollbild | `index.html:7` |
| 4 | Eine einzige Schwelle bei 768 px, kein Faltgerät | `src/components/mobile/useIsMobile.jsx:3` |
| 5 | App-Suche am Handy abgeschaltet → ~40 Apps nur per URL erreichbar | `src/Layout.jsx:662` |
| 6 | Keine Wischgesten, kein Pull-to-Refresh, Dialoge statt Bottom Sheets | `src/components/mobile/` |

Vorhanden und tragfähig: PWA mit Service Worker (`vite.config.js:63`), `BottomNav`,
`MobileColumnNav` / `MobileMailColumnNav`, Safe-Area unten (`Layout.jsx:635`).

---

## Geräteklassen (ersetzt die 768er-Schwelle)

| Klasse | Breite | Gerüst |
|---|---|---|
| `compact` | < 400 | 1 Spalte, 3 Tabs unten |
| `phone` | 400–599 | 1 Spalte, 5 Tabs unten, Detail schiebt über die Liste |
| `fold` / `tablet` | 600–1023 | Navigation Rail links, Liste + Detail nebeneinander |
| `desktop` | 1024–1599 | heutiges Sidebar-Gerüst |
| `widescreen` | ≥ 1600 | bestehende `WorkspaceShell` (2–4 Panels) |

Faltgerät zusätzlich über die Viewport-Segments-API
(`@media (horizontal-viewport-segments: 2)` + `env(viewport-segment-*)`),
mit Rückfall auf reine Breitenmessung. Die Panel-Grenze wird auf das Scharnier
gelegt — beim Galaxy Z Fold: Rail 68 dp + Liste 268 dp = 336 dp = 673/2.

**Regel:** Beim Auf-/Zuklappen wechselt die Klasse zur Laufzeit. Die Geräteklasse
darf ausschliesslich das Gerüst bestimmen, nie den Datenzustand — offene Mail,
Formularinhalt und Scrollposition müssen den Wechsel überleben.

---

## Umfang

- **Vollwertig (8):** Mails, Aufgaben, E-Binder, Paperboy/Scan, Kalender, Kontakte, Chartis, Fristen
- **Abgespeckt (6):** Zeiterfassung, Kunden, Tickets, Firmensuche, Dashboard, Einstellungen
- **Bewusst nur am Schreibtisch (~25):** Fibu komplett, Kontenplan, Jahresabschluss,
  Steuerausscheidung, Jahresplanung, Whiteboard, Benutzerverwaltung, Auswertungen
  → am Handy ein klarer Hinweis statt einer unbrauchbaren Miniaturansicht

Stärkstes handy-spezifisches Argument: **Beleg-Scan**. Kamera → Kantenschnitt →
bestehende KI-Belegerkennung (`supabase/functions/suggest-document-fields`) →
Mandantenzuordnung → E-Binder, direkt beim Kunden.

---

## Etappen

### 1 — Vollbild und Installation · ≈ 1 Tag, risikoarm
Rein gestalterisch, keine Logik betroffen.
- `100vh` → `100dvh` (80 Stellen), `viewport-fit=cover`, Safe-Area-Tokens oben **und** unten
- `public/manifest.json`: `display_override: ["fullscreen","standalone"]`, `orientation`,
  `shortcuts` (Scannen / Mails / Aufgaben), `screenshots`, `id`, `launch_handler`
- `theme-color` je Farbwelt, Touch-Ziele ≥ 48 dp, `overscroll-behavior`, kein Doppeltipp-Zoom

### 2 — Geräteklassen und Faltgerät · ≈ 3–4 Tage
- neuer Hook `useDeviceClass()`; `useIsMobile` bleibt als Weiterleitung bestehen
- gemeinsames Liste-/Detail-Muster (Push am Telefon, nebeneinander aufgeklappt)
- BottomNav am Telefon ↔ Navigation Rail aufgeklappt
- **Handy-Ansicht für den E-Binder** — Pfadleiste, Dateiliste, Vorschau als Bottom Sheet
  (Achtung: `handleCheckout` / `handleCheckin` sind laut CLAUDE.md tabu und bleiben unberührt)

### 3 — Anmutung einer echten App · ≈ 4–5 Tage
- Wischen zwischen Kanban-Spalten, Pull-to-Refresh
- Wischgesten auf Zeilen (links: Aufgabe/Ablegen · rechts: erledigt)
- Bottom Sheets statt Dialoge, Vibration bei bestätigten Aktionen
- App-Suche als Bottom Sheet — macht die ~40 Apps am Handy auffindbar
- Kamera-Scan an die bestehende Belegerkennung angeschlossen
- Android-Zurückgeste schliesst Sheets/Detail, statt die App zu verlassen

---

## Offener Entscheid: PWA oder Store-App?

**Empfehlung: alle drei Etappen als PWA.** Die Grundlage steht, Auslieferung
bleibt der Push auf master, Android und iPhone gleichermassen.

Eine Store-App (Tauri v2 kann Android, `apps/src-tauri/` ist vorhanden; alternativ TWA)
würde später genau diese Oberfläche einpacken — die Arbeit aus Etappe 1–3 ist zu 100 %
wiederverwendbar. Der Entscheid lässt sich also vertagen, ohne etwas zu verlieren.
