# Modul `steuern` – Steuererklaerungen juristische Personen aus dem Abschluss

Stand 05.09.2026. Teil des artis MCP-Servers (`apps/mcp-server`), registriert in
`src/index.ts` ueber `registerSteuernTools`.

## Idee

Eine JP-Steuererklaerung braucht aus der Jahresrechnung nur wenige Zahlen:
Reingewinn, Gewinnvortrag, Aktienkapital, gesetzliche und freiwillige Reserven,
Gewinnverwendung (Dividende, Zuweisungen, Vortrag) und die Verlustverrechnung.
Alle liegen in Smartis bereits vor – in der importierten Saldenliste des
Abschlusses (`abschluss` / `abschluss_konten`, dieselbe Basis wie die
Abschlussdokumentation). Das Modul leitet die Kennzahlen daraus ab und bespielt
damit alle Ausgabekanaele:

| Kanal | Tool | Ergebnis |
| --- | --- | --- |
| Smartis-Tool /Steuern (Tabelle `steuerdaten`) | `steuern_formular_vorschlag` | Felder ZH Form. 500 / SG JP 1b / TG 50I befuellt, PDF-Download im Tool |
| Amtliches PDF | `steuern_pdf` | fertiges Formular, lokal und/oder als Dokument im E-Binder (Kategorie `steuern`) |
| Kantonale Online-Deklaration (ZHcorporateTax, ab 2026 weitere Kantone) | `steuern_ebilanz_xml` | eCH-0276 E-Bilanz-XML (Bilanz, ER, Gewinnverwendung), gegen das XSD validiert |
| ESTV-Portal Verrechnungssteuer | `steuern_vst_datenblatt` | alle Positionen fuer Formular 103/110, Frist, 35 % VSt, Meldeverfahren-Check (106) anhand Aktienbuch, Beilagen |

Lesend: `steuern_abschluesse`, `steuern_kennzahlen`, `steuern_daten`, `steuern_formular_felder`.

## Ablauf in der Praxis

```
steuern_kennzahlen        firma="Ankab" jahr=2025 gewinnverwendung={dividende: 50000, auto_gesetzliche_reserve: true}
steuern_formular_vorschlag firma="Ankab" jahr=2025 kanton=ZH gewinnverwendung={...} speichern=true
steuern_pdf               firma="Ankab" jahr=2025 kanton=ZH in_ebinder=true
steuern_vst_datenblatt    firma="Ankab" jahr=2025 dividende_brutto=50000 gv_datum=2026-06-15
steuern_ebilanz_xml       firma="Ankab" jahr=2025 register_nr=1234567 ausgabe_pfad=C:\...\ebilanz.xml
```

Der Kunde wird ueber `firma` (Teilstring, eindeutig) oder `customer_id`
angesprochen; ohne beides gilt `CUSTOMER_ID` aus der `.env`.

## Regeln der Ableitung (src/steuern/kennzahlen.ts)

- Vorzeichen werden pro Abschluss erkannt (Abacus liefert Passiven/Ertrag negativ).
- Jahresergebnis = Bilanzdifferenz Aktiven − Passiven; Kontrolle gegen die
  Summe der Erfolgsrechnung und ein allfaelliges Jahresergebnis-Konto.
  Abweichungen erscheinen als Warnung.
- Eigenkapital-Konten werden ueber den **Kontonamen** klassifiziert
  (Aktienkapital, gesetzliche Kapitalreserve, KER, gesetzliche Gewinnreserve,
  freiwillige/uebrige Reserven, versteuerte stille Reserven, eigene Kapitalanteile,
  Gewinnvortrag, Jahresergebnis). Kontonummer nach KMU-Kontenrahmen und
  Smartis-Position sind nur Rueckfall, weil die Nummern je Kontenplan abweichen
  (Abacus 2900 = gesetzliche Reserven, KMU 2900 = Kapitalreserve).
- Pflichtzuweisung an die gesetzliche Gewinnreserve nach OR 672 (5 % des
  Gewinns bis 50 % des Kapitals) wird berechnet und mit
  `auto_gesetzliche_reserve=true` uebernommen.
- Verlustvortrag: aus frueheren Erklaerungen desselben Kantons in `steuerdaten`
  (Restverlust bzw. negativer steuerbarer Gewinn), sonst 0; mit `verlustvortrag`
  uebersteuerbar.
- Bereits von Hand erfasste Felder werden beim Speichern nie ueberschrieben,
  ausser `ueberschreiben=true`; Konflikte werden gemeldet. Meta unter `_autofill`.

## PDF ohne Code-Duplikat

`steuern_pdf` laedt die Formulardefinitionen `src/forms/*.js` und den
Fuell-Code `src/lib/pdfFill.js` **direkt aus dem Frontend** (Repo-Pfad
`../../src`). Der Vite-Alias `@/lib/steuerFormularPdf` wird ueber einen
Node-Loader-Hook (`src/steuern/aliasLoader.ts`) auf einen Shim umgeleitet, der
die Signed URL des Buckets `steuerformulare` mit dem Service-Role-Client holt.
Fixes an den pdf-lib-Fallen wirken damit automatisch auch im Server.
Voraussetzung: der Server laeuft innerhalb des mailflow-Repos.

## E-Bilanz (eCH-0276 V1.0.0)

- Standard, XSD und Beispiel: https://www.ech.ch/de/ech/ech-0276/1.0.0
- Mapping Smartis-Position → eCH-Element in `src/steuern/ebilanz.ts`;
  Erloes-/Aufwandarten ueber die Kontonummer (KMU-Kontenrahmen).
- Bilanzkonten mit "falschem" Saldo (Bank im Passiv mit Guthaben, Kreditor mit
  Sollsaldo) werden auf die andere Bilanzseite umgegliedert und gemeldet;
  Delkredere/Wertberichtigungen landen in den `valueAdjustment…`-Elementen.
- Pflichtfelder: `registerNumber` (ganze Zahl; ZH-Register-Nr. `J…` passt
  nicht – Ruecksprache mit dem Kanton, welcher Wert erwartet wird) und
  BFS-Gemeindenummer (ZH aus `zh_gemeinden.js`, sonst Suche ueber
  api3.geo.admin.ch; mit `bfs_nr` uebersteuerbar).
- Validierung: `scratch/ech0276/validate.py` (lxml, alle referenzierten
  eCH-Schemata lokal). Getestet: smarterion (SG), Ankab (ZH), TG-Mapping –
  alle drei Dateien gueltig.

## Tests

```
node scripts/test-steuern.mjs "smarterion" 2025 SG <ausgabeordner>      # lesend, schreibt PDF+XML lokal
MCP_ALLOW_WRITES=true node scripts/test-steuern-write.mjs "Ankab" 2025 ZH 50000   # speichert + E-Binder
```

## Offene Punkte

1. SG: das im Tool hinterlegte Formular JP 1b ist laut Formularkopf fuer
   Vereine, Stiftungen und kollektive Kapitalanlagen; Kapitalgesellschaften
   brauchen JP 1a. Ab Steuererklaerung 2026 loest E-Tax SG (Web, AGOV) die
   PDF-Formulare ab.
2. ZH nimmt ab Steuerjahr 2025 nur noch ZHcorporateTax (kein Papierversand,
   kein E-Mail). Der dokumentierte Import ist die cTax-ZIP; der E-Bilanz-Upload
   (XBRL/eCH-0276) ist fuer die Steuerperiode 2025 angekuendigt – vor dem
   ersten Echtlauf mit dem Support (zh-support.etax.ch) das akzeptierte Format
   bestaetigen.
3. ESTV 103/110/106: nur QDF (Snapform) oder ePortal. Automatisierung =
   Datenblatt + Browser-Agent (wie `steuer-erfassung`) im ePortal.
4. `customers.uid_nr` und `rechtsform` sind auf smartis.me leer – der
   Zefix-Abgleich sollte sie fuellen; das Datenblatt waehlt 103/110 sonst nur
   ueber den Firmennamen.
5. Sicherheitsmodell des Servers (Service-Role-Key) ist unveraendert Phase 1;
   fuer den Betrieb bei mehreren Mitarbeitenden auf User-JWT umstellen (siehe
   Konzept Todo-MCP an Roger).
