# Steuern nP

Lokale Anwendung für die Steuererklärung **natürlicher Personen**, Kanton St. Gallen.
Belege einscannen → sortieren und aussortieren → auf die Positionen des Hauptformulars
zuweisen → sortiert exportieren. Mit Benutzern und Mandanten.

**Läuft ab Laufwerk. Ohne Installation, ohne Server, ohne Netz.**

---

## Was die App tut

1. **Einlesen** — PDF, Scan, Foto oder eSteuerauszug-XML per Drag & Drop. Gescanntes wird
   per OCR gelesen (deutsch, englisch, französisch), alles offline.
2. **Sortieren** — jeder Beleg wird eingeordnet: Belegart, relevant / unklar / aussortiert,
   mit Begründung und Sicherheitsgrad. Duplikate werden am Dateiinhalt erkannt.
3. **Zuweisen** — die erkannten Beträge landen auf den Positionen des SG-Hauptformulars,
   gegliedert nach **Seite 1 bis 4**. Beträge lassen sich korrigieren und von Hand ergänzen.
   Summen und Totale rechnet die App.
4. **Exportieren** — sortiert nach Formularseite und Ziffer, in drei Formaten:
   Übersicht zum Abtippen, CSV für Excel, JSON als Datenformat.

Was sie **nicht** tut: elektronisch einreichen. Der Kanal dafür ist noch nicht geklärt —
siehe [`docs/recherche-und-architektur.md`](./docs/recherche-und-architektur.md).

## Wo die Daten liegen

Neben der Anwendung, nicht im Benutzerprofil:

```
SteuernNP/
  SteuernNP.exe
  daten/
    steuerdaten.json          Benutzer, Mandanten, Personen, Deklarationen, Belege, Positionen
    belege/<mandant>/<dekl>/  die abgelegten Belegdateien
    sicherung/                eine Kopie je Kalendertag
```

Den Ordner auf einen anderen Stick kopieren heisst: alles ist mitgekommen.

**Kein Netz.** Die Anwendung setzt `connect-src 'none'` — ausgehende Verbindungen sind
technisch unterbunden, nicht bloss unterlassen. Steuerdaten unterliegen dem Steuergeheimnis.

**Kein Passwortschutz.** «Benutzer» heisst hier: wer gerade arbeitet. Der Name landet im
Protokoll und bei jeder bestätigten Position. Wer Zugriff auf das Laufwerk hat, hat Zugriff
auf die Daten — der Schutz liegt beim Laufwerk, nicht in der Anwendung. Für Steuerdossiers
gehört das Laufwerk entsprechend verschlüsselt.

## Zwei Fassungen zum Verteilen

### Electron — für echte Mandate

```bash
npm install
npm run paket:win
```

Ergebnis: `release/SteuernNP-win32-x64/` — rund 300 MB, davon 270 MB Electron-Laufzeit.
Ordner aufs Laufwerk kopieren, `SteuernNP.exe` doppelklicken. Auf dem Zielrechner braucht
es weder npm noch Node. **Nur diese Fassung führt die Daten als Datei** neben dem Programm,
mit Tagessicherung, und lässt sich als Ordner mitnehmen.

### Portabel — zum Ausprobieren

```bash
npm install
npm run paket:portabel
cd portabel && zip -r ../SteuernNP-portabel.zip .
```

Ergebnis: `portabel/` — rund 22 MB. Enthält die gebaute Oberfläche und einen winzigen
lokalen Server ohne Fremdpakete (`portabel-vorlage/server.mjs`). Entpacken, `START.cmd`
doppelklicken, der Browser öffnet sich auf Port 5180.

Ein Server ist nötig, weil der Browser bei einem Datei-Aufruf (`file://`) die Web Worker
blockiert, die OCR braucht. Auf dem Zielrechner muss **Node.js** vorhanden sein; das
Startskript sagt es, falls nicht.

⚠️ **Nicht für echte Mandate.** Die Daten liegen hier im Browserspeicher — wer den
Verlauf löscht, löscht die Daten. Englisch ist aus den OCR-Daten entfernt (11 MB für einen
Fall, der bei Schweizer Belegen kaum vorkommt).

## Entwickeln

```bash
npm install
npm run ocr:daten     # holt Tesseract-Kern und Sprachdaten nach public/tesseract/
npm run dev           # http://localhost:5180
npm run start         # baut und startet die Electron-App
npm test              # 42 Tests
```

Die OCR-Dateien (31 MB) liegen bewusst nicht im Git — `npm run ocr:daten` stellt sie aus
den npm-Paketen wieder her. Ohne sie fällt OCR aus; die App würde sie sonst aus dem Netz
nachladen, und genau das soll sie nicht.

Im Browser (`npm run dev`) fehlt der Dateizugriff: Die Daten landen dann im
Browserspeicher, und die App weist darauf hin. Für echtes Arbeiten `npm run start`.

## Aufbau

```
src/lib/
  sgFormular.js     Positionen des SG-Hauptformulars, Seite 1–4, mit Summenlogik
  belegarten.js     18 Belegarten mit Erkennungsmustern
  triage.js         Relevanz-Triage über Regeln
  ingest.js         Die Kette: Hash → Extraktion → Triage → Ablage → Datenbank
  dokumentText.js   Text- und OCR-Extraktion, Hash, UID-/AHV-Erkennung
  ech0196.js        Parser für den eSteuerauszug
  ech0119.js        XML-Export (Gerüst, siehe unten)
  db.js             Lokale Datenbank
  export.js         Sortierter Export nach Seite und Ziffer
  pdfFill.js        PDF-Formularbefüllung (Rückfallpfad)
src/pages/
  Verwaltung.jsx    Benutzer, Mandanten, Personen, Deklarationen
  Dossier.jsx       Belege · Zuweisung · Export
electron/
  main.cjs          Hauptprozess: Dateiablage, Sicherung, Export-Dialog
  preload.cjs       Schmale Brücke, kein direkter Dateisystemzugriff im Fenster
```

## ⚠️ Zwei Dinge sind noch nicht geprüft

**Die Ziffern des SG-Hauptformulars.** Die Wegleitung war bei der Umsetzung nicht
zugänglich. Seitenaufbau und Reihenfolge folgen dem einheitlichen Formularsatz der
Schweizerischen Steuerkonferenz, die konkreten Nummern sind daran angelehnt und
**nicht verifiziert**. Export und Zuweisungsansicht weisen sichtbar darauf hin.
Zum Beheben: `Wegleitung_NP_2025.pdf` von sg.ch nach `docs/` legen, Ziffern in
`src/lib/sgFormular.js` abgleichen, `VERIFIZIERT` auf `true` setzen.

**Der eSteuerauszug-Parser.** Die eCH-0196-XSD lag nicht vor; die Feldzuordnung ist
begründet, aber an echten Auszügen ungetestet. Sie steht als korrigierbare Tabelle in
`ech0196.js`.

## Herkunft

Aus MailFlow übernommen (kopiert, nicht importiert): `pdfFill.js`, `PdfViewer.jsx`, die
OCR-/PDF-Extraktion aus `batchAiSuggest.js`, die OCR-tolerante UID-Erkennung und das
Triage-Muster. Die App hat keine Bauabhängigkeit zu MailFlow.
