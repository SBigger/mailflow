# Agentische Steuerdeklaration natürliche Personen (SG / TG / ZH)

Recherche- und Architekturdokument · Stand 04.08.2026 · Autor: Claude Code
Auftrag: Belege einlesen (OCR/PDF) → relevant/nicht relevant sortieren → Felder füllen →
elektronisch einreichen · mandantenfähig · Start mit natürlichen Personen (nP).

> **Status:** Recherche, Zielarchitektur und ein erster Aufbau (Ingest, Triage, Datenmodell).
> Offene Punkte, die sich nur durch direkte Anfrage bei den Steuerverwaltungen klären
> lassen, sind in [§11 Verifikations-Backlog](#11-verifikations-backlog) gesammelt und
> **nicht** als Fakten im Fliesstext behauptet.
>
> **Eigenständiges Produkt.** Diese App liegt unter `apps/steuern-np/` mit eigenem Build und
> **eigenem Supabase-Projekt** — sie ist kein MailFlow-Modul. Begründung in §10: Steuerdaten
> unterliegen dem Steuergeheimnis, und eine physisch getrennte Datenhaltung ist gegenüber
> Mandanten und Aufsicht das belastbarste Argument. Was aus MailFlow taugte, wurde
> **kopiert, nicht importiert** (§6.2).

---

## 1. Kernaussage in fünf Sätzen

1. Es gibt einen schweizweiten Austauschstandard für die Steuererklärung nP —
   **eCH-0119 «E-Tax Filing»** (aktuell V4.0.0, 08.03.2021). Er definiert ein
   Übermittlungspaket aus `taxDeclaration.xml` + Verzeichnis `attachments`.
2. eCH-0119 ist ein **Format**, kein Transportweg. Die eigentliche Einreichung läuft in
   allen drei Zielkantonen über den kantonalen Kanal — und für gewerbsmässige Vertreter
   heisst dieser Kanal **Treuhänder-Register + Direktupload aus der Treuhandsoftware**.
3. Damit ist der Weg für ein Artis-Produkt klar: **nicht** Browser-Automation der
   Bürger-Portale (ZHprivateTax, E-Tax SG, eFisc), sondern Registrierung als
   Softwareanbieter/Treuhänder und Upload über die offizielle Schnittstelle.
4. Der eigentliche Mehrwert liegt vorne in der Kette: **Beleg-Ingest, Relevanz-Triage und
   Feld-Mapping**. Genau dort hat MailFlow bereits produktive Bausteine (OCR-Pipeline,
   Infomaniak-LLM, mandantenfähige RLS).
5. Der Markt bewegt sich gerade: iqtax (März 2026, ZH-Direktanbindung) und Dr. Tax
   (Belegerkennung angekündigt für Herbst 2026) besetzen dieselbe Nische. Zeitfenster ist
   eng, aber der Treuhand-Kontext von Artis ist ein Vorteil, kein Nachteil.

**Zwei Funde der zweiten Recherche-Runde, die die Planung verschieben:**

- **AGOV authentifiziert Personen, keine Maschinen** (§9.1). Ein unbeaufsichtigter
  Server-Upload über den Bürgerportal-Pfad ist damit nicht vorgesehen — der
  Treuhänder-Kanal ist nicht die bequemere, sondern die einzige Option.
- **Thurgau verlangt auf dem eFisc-Pfad eine unterzeichnete Quittung per Post** (§3.3).
  Ob das auch für den Treuhänder-Kanal gilt, ist offen — bis dahin gehört TG in den
  Ausblick, nicht in die Aufwandschätzung.

---

## 2. Standard-Landschaft (eCH)

| Standard | Version | Was | Relevanz für uns |
|---|---|---|---|
| **eCH-0119** E-Tax Filing | V4.0.0 (2021-03-08) | Austauschformat Steuererklärung **nP**, basierend auf den vereinheitlichten Formularen der SSK | **Kern.** Zielformat unseres Exports |
| **eCH-0196** E-Steuerauszug | bis V2.3.0 | Elektronischer Bank-/Depot-Steuerauszug, XML + PDF mit PDF417-Barcode | **Kern.** Bester strukturierter Input für das Wertschriftenverzeichnis |
| **eCH-0270** Barcode-Generierung für Steuerbelege | V1.0.0, genehmigt 04.11.2024 | 2D-Barcodes (PDF417 Structured Append) auf Steuerbelegen, u.a. **Lohnausweis** und Wertschriftenverzeichnis | **Hoch.** Barcode lesen schlägt OCR — deterministisch statt geraten |
| **eCH-0275** Steuerbescheinigung Krankenkassen | V1.0.0 (2024-11-27) | Strukturierte KK-Bescheinigung | Mittel — Prämien/Selbstbehalt-Abzüge |

### 2.1 eCH-0119 — was gesichert ist

- Zweck: Übermittlung der **Deklarationsdaten der Steuererklärung natürlicher Personen**
  für Kantons- und direkte Bundessteuer.
- Paketaufbau: **`taxDeclaration.xml`** plus ein Verzeichnis **`attachments`** mit den
  Beilagen in beliebigem Format (Belege).
- Kantonale Besonderheiten werden über den Typ **`cantonExtensionType`** abgebildet: alle
  Typen tragen ein Attribut `cantonExtension`, in das kantonale Erweiterungen eingehängt
  werden — die einzufügende Struktur wird über **`xs:any`** aufgenommen. Die Zuordnung der
  kantonalen Namespaces ist in Kap. 3.5 des Standards geregelt.
- Das XML kann laut Standard entstehen aus: **Software**, **2D-Barcode-Scan** oder
  **OCR-Scan** — der Standard denkt unsere Pipeline also explizit mit.

#### Elementstruktur (Stand der Recherche)

`taxDeclaration` besteht — analog zu **eCH-0058** — aus einem **Header-Type** und einem
**Content-Type**. Im Content-Type liegen unter anderem:

| Element | Inhalt |
|---|---|
| `mainForm` | Hauptformular |
| `listOfSecurities` | **Wertschriftenverzeichnis**; Ertragstotale differenziert nach Abschnitt A/B sowie Bundes- und Staatssteuer |
| `listOfLiabilities` | **Schuldenverzeichnis** (Bruttodarstellung); Totale der Schulden und der Schuldzinsen sind getrennt auszuweisen |
| `qualifiedInvestmentsPrivate` / `qualifiedInvestmentsBusiness` | Qualifizierte Beteiligungen, Privat- bzw. Geschäftsvermögen |
| `jobExpenses` | Berufsauslagen |
| `jobOrientedFurtherEducationCost` | Berufsorientierte Weiterbildungskosten |
| `insurancePremiums` | Versicherungsprämien |
| `diseaseAndAccidentExpenses` | Krankheits- und Unfallkosten |
| `handicapExpenses` | Behinderungsbedingte Kosten |
| `cantonExtension` | Kantonale Erweiterung |

Personalien liegen unter `personalData` (ebenfalls Header + Content), mit den Typen
`representativePersonType` (Vertreter — für uns relevant!), `personDataPartner1Type` /
`personDataPartner2Type`, `childDataType` und `disabledPersonSupportType`.

> ⚠️ Diese Struktur stammt aus Suchmaschinen-Auszügen des Standarddokuments, **nicht** aus
> der XSD selbst: `ech.ch` ist von der Netzwerk-Policy dieser Umgebung hart blockiert (kein
> TLS-Handshake, CONNECT 403 — dasselbe gilt für den Mirror
> `2023.prod.ech.vereine5.myhostpoint.ch`). Kardinalitäten, Datentypen und die vollständige
> Feldliste fehlen. Der erste Umsetzungsschritt bleibt der Download von Hauptdokument
> **und** XSD-Beilagen. Siehe [§11](#11-verifikations-backlog).

#### Angrenzende Standards

- **eCH-0229** — Steuerdaten **juristische** Personen; ebenfalls mit `cantonExtension`.
  Relevant, sobald das Modul über nP hinausgeht.
- **eCH-0233** — *Archivierung Steuern*. Für unsere Aufbewahrungs- und Archivpflichten
  (§10) die einschlägige Referenz.

### 2.2 eCH-0196 — der unterschätzte Hebel

Die kantonalen Steuerverwaltungen, die ESTV, die Banken und die Softwarehersteller haben
eCH-0196 gemeinsam entwickelt. Der eSteuerauszug erlaubt es, **alle erforderlichen
Bankdaten strukturiert** in die Steuererklärung zu importieren — medienbruchfrei.

Praktische Konsequenz für unsere Triage: Ein eSteuerauszug ist kein «Beleg, den man
mit OCR liest», sondern eine **Datenquelle, die man parst**. Der Barcode wird nie vom
Steuerpflichtigen manipuliert oder eingetippt — er kommt entweder von der Bank oder gar
nicht. Das macht ihn zur vertrauenswürdigsten Quelle im ganzen Dossier.

Vorhandene Vorarbeit (Open Source, als Referenz-Implementierung lesenswert):

- `BrunoEberhard/open-ech-taxstatement` — Steuerauszug-Editor gemäss eCH-0196
- `vroonhof/opensteuerauszug` — erzeugt eSteuerauszüge aus Banking-Exports

Barcode-Extraktion: PDF417 **Structured Append** über mehrere Seiten; die technische
Wegleitung nennt die Java-Bibliothek J4L Vision.

**Empfehlung für unseren Stack: [`zxing-wasm`](https://github.com/Sec-ant/zxing-wasm)**
(ZXing-C++ als WASM, ES/CJS mit Typen). Gründe: läuft in **Web, Node, Bun und Deno** — also
sowohl im Browser-Client als auch in einer Supabase Edge Function, ohne zweite Laufzeit.
ZXing unterstützt Multi-Barcode-Erkennung und liefert Structured-Append-Metadaten
(`PDF417ResultMetadata`), was für das Zusammensetzen mehrseitiger Auszüge nötig ist. Das
Projekt ist aktiv gepflegt (u.a. Fixes für PDF417-Heap-Overflows). Alternative, falls es an
echten Auszügen scheitert: Python-Sidecar mit `zxing-cpp`.

> Vorbehalt: Das ist eine Bewertung nach Dokumentation, **keine Messung**. Der Test an
> echten mehrseitigen eSteuerauszügen verschiedener Banken steht aus (V11).

**Wirtschaftlicher Nebenaspekt:** Nicht alle Banken liefern den eSteuerauszug, und die
Preise schwanken erheblich — von gratis bis rund 300 Franken. Die Kantonalbanken Aargau,
Luzern und Schwyz sowie Valiant geben ihn allen Kundinnen und Kunden kostenlos ab, andere
verlangen eine Gebühr oder liefern nur eine reduzierte «Light»-Version. Für die Pipeline
heisst das: **der eSteuerauszug ist der beste, aber nicht der garantierte Fall.** Der
OCR-Pfad bleibt Pflicht, nicht Kür.

---

## 3. Kantons-Steckbriefe

### 3.1 Zürich — am weitesten, klarste Rechtslage

- **Bürger-Kanal:** ZHprivateTax (`zhp.services.zh.ch/app/ZHprivateTax`), browserbasiert.
  Rund 500'000 Nutzende ≈ die Hälfte aller Steuerpflichtigen. Login über **AGOV** mit
  2-Faktor. Die Offline-Software «Private Tax» ist eingestellt.
- **Rechtsgrundlage:** *Verordnung über die elektronische Einreichung der Steuererklärung*,
  ZStB 109c.4. Wesentliche Punkte:
  - Die Steuererklärung kann **vollständig elektronisch** eingereicht werden,
    **eine Unterschrift ist nicht erforderlich**.
  - Die **Belege müssen ebenfalls elektronisch** eingereicht werden.
  - Statt der früheren Freigabequittung erfolgt eine **elektronische Bestätigung** der
    wahrheitsgetreuen und vollständigen Deklaration.
- **Treuhänder-Kanal (für uns entscheidend):** Wer gewerbsmässig als Vertreter tätig ist,
  registriert sich im **Treuhänder-Register** (`steueramt.zh.ch/thregister`) und erhält
  eine eindeutige **TH-ID** plus Zugangsdaten. Registrierte Treuhänder können die
  Steuererklärungen ihrer Klienten **direkt aus ihrer Treuhandsoftware hochladen**.
  Es existiert eine **direkte Schnittstelle für Drittsoftware-Anbieter**, über die
  Funktionen des Treuhänder-Registers in die eigene Software integriert werden können.
- **Vollmacht:** Für eine dauerhafte Generalvollmacht in allen Steuersachen ist eine
  unterzeichnete Vollmacht beim Steueramt einzureichen. Alternativ autorisiert die
  Weitergabe des Zugangscode-Briefs den Vertreter für die laufende Periode.
- **Präzedenzfall:** iqtax reicht seit März 2026 «per zertifizierter Schnittstelle direkt
  beim Kantonalen Steueramt Zürich» ein. Der Weg ist für Dritte also gangbar.

**Bewertung:** ZH ist der richtige Pilotkanton. Klare Verordnung, dokumentierter
Treuhänder-Kanal, explizite Drittsoftware-Schnittstelle, unterschriftsfreie Einreichung.

### 3.2 St. Gallen — frisch umgebaut, technisch nah an ZH

- **Bürger-Kanal:** **E-Tax SG**, seit Januar 2026 für die Steuerperiode 2025. Ersetzt die
  über 20-jährige Download-Lösung durch eine Web-Applikation; Daten werden **zentral**
  gehalten, nicht mehr lokal. Zugang über **E-Login** (Kanton + Gemeinden SG) auf Basis
  von **AGOV**.
- **Plattformbetreiber:** Der Support läuft über `sg-support.etax.ch` — E-Tax SG ist damit
  erkennbar auf der **eTax-Plattform von Ringler Informatik** aufgesetzt (dieselbe Firma
  hinter Dr. Tax). Das ist strategisch relevant: SG und die Ringler-Produktwelt teilen
  Formate.
- **Import heute:** Vorjahresdaten über kantonseigene Dateiendungen (`.sgnp2024` für nP),
  **eSteuerauszug** über «Hinzufügen → +» mit automatischer Übernahme der
  steuerrelevanten Werte.
- **Treuhänder:** Für Treuhandbüros gibt es mehrere Login-Varianten; empfohlen wird ein
  E-Login mit **zentraler Firmen-E-Mail-Adresse**, hinterlegbar auf bis zu **fünf** Geräten
  in der AGOV-Access-App, sodass mehrere Mitarbeitende denselben Account nutzen können.
- **Drittsoftware:** SG ist in der E-Filing-Kantonsliste von Dr. Tax enthalten. Ein
  Treuhänder-Upload-Kanal existiert also; die technische Spezifikation ist öffentlich
  nicht auffindbar.
- **Einreichung — zwei Wege (bestätigt):**
  1. **Vollständiges eFiling:** Die Steuererklärung 2025 kann **komplett elektronisch
     inklusive Beilagen** eingereicht werden. Alle Belege werden über E-Tax SG hochgeladen.
  2. **Freigabebestätigung per Post:** Am Ende des Einreichungsprozesses wird ein Dokument
     ausgedruckt, unterschrieben und mit den darin aufgeführten Unterlagen ans
     Gemeindesteueramt geschickt.
- **Beleg-Erfassung:** Drag & Drop, dazu die Smartphone-Apps **oBeam** und **Snapshare**
  (Ringler) zum Scannen physischer Belege. Das ist funktional genau unser Ingest-Schritt —
  und zeigt, dass wir mit MailFlows Kundenportal-Upload nichts Exotisches bauen.

**Bewertung:** Zweiter Kanton. Weg 1 (volles eFiling) ist für uns der einzig interessante —
Weg 2 wäre ein Medienbruch mitten in der Automatisierung. Der AGOV-Firmenaccount mit
5 Geräten ist für unsere Mandantenfähigkeit relevant — aber auch eine Sollbruchstelle
(siehe §9).

### 3.3 Thurgau — Nachzügler, Sonderfall

- **Bürger-Kanal:** **eFisc** — eine **Desktop-Software** (Windows, macOS, Linux), jährlich
  neu von der Steuerverwaltung TG herausgegeben, gratis, beliebig viele Steuererklärungen.
  **Eine browserbasierte Online-Version existiert derzeit nicht.**
- Elektronische Einreichung über eFisc ist **freiwillig**; Papier bleibt zulässig.
- eSteuerauszug-Import ist unterstützt; der Datentransfer von der Bank läuft über den
  Steuer-Barcode.
- **Treuhänder:** TG ist in der Dr.-Tax-E-Filing-Kantonsliste enthalten. Voraussetzung ist
  auch hier ein Konto im Treuhänder-Register der Steuerverwaltung. Bei elektronischer
  Einreichung müssen Belege elektronisch mitgeliefert werden; Korrekturen sind innerhalb
  **24 Stunden** durch erneute Einreichung möglich.

> 🚩 **Kritischer Fund — Medienbruch auf dem eFisc-Pfad.** Nach der Wegleitung der
> Steuerverwaltung TG gilt die elektronisch übermittelte Steuererklärung **erst dann als
> eingereicht, wenn die unterzeichnete Quittung beim Gemeindesteueramt eingetroffen ist**;
> die Belege gehen zusammen mit dieser Quittung per Post. Anders als in ZH (keine
> Unterschrift) und SG (volles eFiling möglich) endet die Kette in TG damit auf Papier.
>
> Zwei Einschränkungen, bevor daraus eine Entscheidung wird: Die Quelle ist eine ältere
> Wegleitung, der Stand 2026 ist ungeprüft — und die Aussage betrifft den **eFisc-Bürgerpfad**.
> Ob für registrierte Treuhänder über den Dr.-Tax-Kanal dieselbe Unterschriftspflicht gilt,
> ist offen und der eigentlich zu klärende Punkt (V6/V7).

**Bewertung:** Dritter Kanton — und mit deutlicherem Abstand als zunächst angenommen. Weil
es keine Web-App gibt, ist Browser-Automation hier ohnehin keine Option. Falls sich die
Unterschriftspflicht auch für den Treuhänder-Kanal bestätigt, ist eine durchgehend
automatisierte Einreichung in TG **gar nicht möglich**; das Modul liefert dann bis zur
Freigabequittung und ein Mensch schickt sie ab. Das ist kein K.-o.-Kriterium, muss aber vor
der Aufwandschätzung für TG geklärt sein.

### 3.4 Vergleich

| | ZH | SG | TG |
|---|---|---|---|
| Bürger-Portal | ZHprivateTax (Web) | E-Tax SG (Web, seit 2026) | eFisc (Desktop) |
| Login | AGOV | E-Login / AGOV | lokal |
| Unterschrift nötig | **nein** (ZStB 109c.4) | wahlweise — volles eFiling möglich | **ja** auf dem eFisc-Pfad (Quittung per Post); Treuhänder-Kanal offen |
| Belege elektronisch | Pflicht | möglich (Weg 1) bzw. Post (Weg 2) | Pflicht bei e-Einreichung |
| Treuhänder-Register | ja, mit TH-ID | ja | ja |
| Drittsoftware-Schnittstelle | **dokumentiert** | vorhanden (Dr. Tax) | vorhanden (Dr. Tax) |
| Durchgehend automatisierbar | ja | ja | **fraglich** |
| Pilot-Eignung | **1** | 2 | 3 |

---

## 4. Warum nicht Browser-Automation

Die Entscheidung ist gefallen (eCH-0119-Weg), hier die Begründung zum Nachlesen:

1. **AGOV mit 2FA** ist der Login-Weg in ZH und SG. Ein Agent, der sich an einem
   2FA-geschützten Bürgerportal im Namen Dritter anmeldet, umgeht eine Sicherheitsmassnahme
   — unabhängig davon, ob es technisch ginge.
2. **TG hat gar kein Portal.** Ein Playwright-Ansatz deckt nur 2 von 3 Kantonen ab.
3. **Fragilität:** ZHprivateTax und E-Tax SG werden laufend aktualisiert; jede UI-Änderung
   bricht die Automation mitten in der Deklarationssaison.
4. **Haftung:** Bei einer fehlerhaft eingereichten Steuererklärung ist «der Roboter hat
   falsch geklickt» keine Verteidigung. Ein XML mit Validierung und Quittung ist
   nachweisbar.
5. **Es gibt einen legitimen Kanal**, der genau für Software wie unsere gebaut wurde.

---

## 5. Marktumfeld

| Anbieter | Was | Für uns |
|---|---|---|
| **iqtax AG** | Erste vollständig KI-gestützte CH-Steuerplattform; Belege hochladen → intelligente Dokumentenerkennung liest aus, interpretiert den steuerlichen Kontext, deklariert → Einreichung per **zertifizierter Schnittstelle** direkt beim Steueramt ZH. Cloudbasiert, mandantenfähig, kantonale Besonderheiten modular. ZH als erster Kanton, weitere 2026. | **Direkter Wettbewerber und Machbarkeitsbeweis in einem.** Bestätigt: der Schnittstellenweg ist für Dritte offen |
| **Dr. Tax / Ringler** | Marktführer Treuhand. E-Filing in 26 Kantonen (u.a. SG, TG, ZH). Automatisierte Belegerkennung/-verbuchung **angekündigt für Herbst 2026** | Setzt uns eine Deadline. Vorteil bleibt: Dr. Tax ist Steuersoftware, wir sind das Dossier |
| **eTax.ch (Ringler)** | Bürger-Web-App; KI erkennt Belegdaten und befüllt | Betreibt auch E-Tax SG |
| **TreuhandGPT** (Treuhand Suisse + Connect AI) | Branchen-KI seit Dez. 2025, Daten bleiben in der CH, >2'000 Treuhandbüros | Referenz für CH-Datenhaltung als Verkaufsargument |
| **TreuFlow** | KI-Treuhandsoftware, Belege automatisch erkennen und ablegen | Überschneidung mit MailFlow-Ablage |

**Positionierung Artis:** Alle Wettbewerber starten beim leeren Steuerformular. MailFlow
startet beim **bestehenden Mandantendossier** — Kunden, Tags, Belege, Fristen und die
Vorjahres-Steuererklärung sind schon im System. Der Ingest-Schritt, den iqtax verkauft, ist
bei uns ein Nebenprodukt der bestehenden Ablage.

---

## 6. Zielarchitektur

### 6.1 Pipeline

```
┌─ 1 INGEST ──────────────────────────────────────────────────────┐
│  Quellen: MailFlow-Ablage · Kundenportal-Upload · Fibu-Inbox    │
│           E-Mail-Anhang · Scan · Foto                           │
│                                                                  │
│  Klassifikation nach Quelltyp — NICHT alles ist ein OCR-Fall:   │
│   a) eCH-0196 eSteuerauszug (XML oder PDF+PDF417) → PARSEN      │
│   b) eCH-0270-Barcode (Lohnausweis, WV)          → PARSEN       │
│   c) digitales PDF  → pdfjs Textlayer                            │
│   d) Scan / Foto    → Tesseract.js OCR                           │
│                                                                  │
│  Regel: geparste Quellen schlagen OCR-Quellen IMMER.            │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 2 TRIAGE (relevant / nicht relevant) ──────────────────────────┐
│  Zweistufig, nach dem Muster von batchAiSuggest.js:             │
│   Stufe 1  Regeln + Mustererkennung (Barcode-Typ, Keywords,     │
│            Absender, Betragsstruktur) → Confidence               │
│   Stufe 2  nur bei Confidence < 0.85: LLM-Klassifikation        │
│            (Infomaniak, CH-Cloud)                                │
│  Output: belegart + relevanz + zielfeld-kandidaten + confidence │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 3 EXTRAKTION & MAPPING ────────────────────────────────────────┐
│  Beleg → normalisierte Position → eCH-0119-Feld                 │
│  Plausi-Checks im CODE, nicht im LLM                            │
│  (Datum/Betrag wörtlich im Belegtext? Summenkontrolle?)         │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 4 REVIEW (Mensch, nicht verhandelbar) ─────────────────────────┐
│  Vier-Augen-UI: links Beleg, rechts Feld, Herkunft je Wert      │
│  Alles unter Schwellwert und alles Neue muss bestätigt werden   │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 5 EXPORT & EINREICHUNG ────────────────────────────────────────┐
│  taxDeclaration.xml + attachments/ → XSD-Validierung            │
│  → kantonaler Upload (Treuhänder-Register / TH-ID)              │
│  → Quittung speichern, unveränderliches Archiv des Pakets       │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Was aus MailFlow übernommen wurde

Kopiert, nicht importiert — die App hat keine Bauabhängigkeit zu MailFlow.

| Baustein | Herkunft in MailFlow | Zustand hier |
|---|---|---|
| PDF-Formularbefüllung | `src/lib/pdfFill.js` | `src/lib/pdfFill.js`, 1:1 (nur `pdf-lib` als Abhängigkeit) |
| Belegvorschau | `src/components/PdfViewer.jsx` | `src/components/PdfViewer.jsx`, Import-Pfad angepasst |
| OCR-/PDF-Extraktion, Tesseract-Lazy-Load | `src/lib/batchAiSuggest.js` | `src/lib/dokumentText.js`, auf Belegtypen zugeschnitten, `fra` ergänzt |
| OCR-tolerante UID-Erkennung | `findUidInText()` | dito, plus `findAhvInText()` |
| Triage-Muster (Regeln, KI erst < 0.85) | `batchAiSuggest.js` | `src/lib/triage.js`, Logik neu, Muster übernommen |
| RLS über eine Zugriffstabelle | `fibu_user_mandant_access` | `user_mandant_access` im eigenen Schema |
| LLM-Edge-Function | `suggest-document-fields` | `steuer-suggest-position`, **ohne** US-Fallback |

#### 🔎 Fund: MailFlow hat bereits ein Steuermodul — für juristische Personen

Bei der Umsetzung ist aufgefallen, was die erste Recherche übersehen hatte:
`src/modules/tools/Steuern.jsx` füllt bereits amtliche **JP**-Steuerformulare aus —
`src/forms/sg_jp1b.js` (SG, Vereine/Stiftungen), `tg_50i.js` (TG) und `estv_19.js`
(ESTV Beteiligungen), über `pdfFill.js` mit vermessenen Overlay-Koordinaten, gespeichert in
einer Tabelle `steuerdaten` (Kunde × Kanton × Jahr, Felder als JSONB). Dazu kommt
`CustomerSteuerZugaengeTab.jsx`, das Zugangsnummer und Passwort der Steuererklärung
**pro Jahr** verwaltet.

Drei Konsequenzen:

1. **Der PDF-Weg ist im Haus erprobt.** Falls die kantonale Schnittstelle verschlossen
   bleibt, ist das Befüllen der amtlichen nP-Formulare kein Neuland, sondern eine bekannte
   Technik mit vorhandenem Werkzeug. Deshalb ist `pdfFill.js` mitkopiert.
2. **Die Formulardefinitionen sind ein Muster, keine Vorlage.** JP-Formulare haben mit der
   nP-Erklärung inhaltlich nichts gemein — übernehmbar ist die *Struktur* (Feld-IDs,
   Koordinaten, Favoriten), nicht der Inhalt.
3. **Zugangscodes werden bereits verwaltet.** Das entspricht genau dem ZH-Modell, bei dem
   die Weitergabe des Zugangscode-Briefs die Vertretung für die laufende Periode
   autorisiert (§9). Für die Trennung heisst das: Diese Daten bleiben in MailFlow, das
   Steuermodul führt seinen Vollmachtsstatus selbst.

**In MailFlow explizit nicht anfassen:** MS365-Mail-Integration,
`handleCheckout`/`handleCheckin` in `Dokumente.jsx`, `fileHandleDB.js`, `CheckinDialog.jsx`
— und neu auch das bestehende JP-Steuermodul, das produktiv genutzt wird.

---

## 7. Datenmodell (Entwurf)

Umgesetzt in `supabase/migrations/20260804210000_foundation.sql`. Weil die App ein eigenes
Supabase-Projekt hat, trägt das Schema **kein Präfix** — es gibt nichts, wovon es sich
abgrenzen müsste.

```sql
mandanten            (id, name, uid, th_id_zh, aktiv)          -- Treuhandmandat, TH-ID für ZH
user_mandant_access  (user_id, mandant_id, role)                -- admin|bearbeiter|readonly

np_personen          (id, mandant_id, name, vorname, ahv_nr_hash,
                      zivilstand, kanton, gemeinde, …)

deklarationen        (id, person_id, periode, kanton,
                      status,            -- entwurf|review|freigegeben|eingereicht|quittiert
                      ech_version,
                      vollmacht_status,  -- offen|erteilt|abgelaufen → sperrt die Einreichung
                      created_by, freigegeben_von, freigegeben_am)

belege               (id, deklaration_id, storage_path, datei_hash, quelle,
                      belegart, parse_methode,   -- ech0196|ech0270|ech0275|pdf_text|ocr
                      relevanz, relevanz_grund,  -- relevant|nicht_relevant|unklar
                      confidence, periode_beleg, roh_text, roh_xml)

positionen           (id, deklaration_id, beleg_id, ech_pfad,
                      wert_num, wert_text, waehrung, confidence,
                      herkunft,          -- ech0196|ech0270|ech0275|ki|manuell|vorjahr
                      bestaetigt_von, bestaetigt_am)

einreichungen        (id, deklaration_id, kanal, paket_hash, paket_path,
                      uebermittelt_von, uebermittelt_am,
                      quittung_ref, quittung_raw, ersetzt_id)

audit_log            (id, deklaration_id, user_id, aktion, entitaet, alt, neu, ts)
parameter            (kanton, periode, schluessel, wert_num, quelle)  -- Pauschalen, Maxima
```

**Zwei Invarianten, die im Schema erzwungen werden müssen:**

1. Jede `steuer_position` mit `wert_num IS NOT NULL` hat entweder ein `beleg_id` oder ein
   `bestaetigt_von` — kein Wert ohne Herkunft.
2. `steuer_einreichung` ist append-only (kein UPDATE/DELETE-Policy für `authenticated`).
   Eine Korrektur ist eine neue Zeile, keine Änderung.

**RLS:** nach dem bewährten Fibu-Muster, aber im eigenen Schema — Zugriff über
`user_mandant_access` und die Helper `mandant_ids_for_user()` / `darf_einreichen()`.
Rollen: `admin` (freigeben + einreichen), `bearbeiter` (erfassen, nicht einreichen),
`readonly`.

**Die Freigaberegel steht in der Datenbank, nicht im UI.** Ein `BEFORE INSERT`-Trigger auf
`einreichungen` verweigert die Übermittlung, solange Vollmacht fehlt, keine menschliche
Freigabe vorliegt oder noch Positionen unter dem Schwellwert unbestätigt sind. Eine Regel,
die nur im Frontend lebt, hält beim ersten Skript nicht.

---

## 8. Relevanz-Triage — die Taxonomie

Der schwierigste Teil ist nicht «lesen», sondern «entscheiden, ob es zählt». Vorschlag für
die erste Ausbaustufe:

**Relevant, strukturiert parsebar (höchste Priorität):**
`eSteuerauszug (eCH-0196)` · `Lohnausweis (eCH-0270-Barcode)` ·
`Krankenkassen-Steuerbescheinigung (eCH-0275)`

**Relevant, OCR/LLM:**
`Säule-3a-Bescheinigung` · `Pensionskassen-Einkaufsbestätigung` ·
`Schuldzins-/Hypothekarausweis` · `Liegenschaftsunterhalt` · `Eigenmietwert-Mitteilung` ·
`Spendenbescheinigung` · `Kinderbetreuungskosten` · `Weiterbildungskosten` ·
`Alimente` · `Renten (AHV/IV/BVG)` · `Arbeitswegkosten` · `Krankheitskosten` ·
`Vorjahres-Veranlagung`

**Nicht relevant (aber archivieren, nie wegwerfen):**
Werbung · Kontoauszüge ohne Steuerbezug · Quittungen des privaten Lebensbedarfs ·
Doppel bereits erfasster Belege · Korrespondenz ohne Zahlenbezug

**Regeln, die vor dem LLM greifen:**

- Barcode erkannt → Belegart steht fest, keine LLM-Frage mehr.
- Dokument bereits im Dossier (Hash-Dedup) → `nicht_relevant`, Grund `duplikat`.
- Periode passt nicht zur Deklaration → `unklar`, nie stillschweigend verwerfen.
- Steuerperiode und Betrag müssen **wörtlich** im Belegtext vorkommen, sonst
  Confidence-Abschlag (bewährtes Muster aus dem Fibu-Modul).

**Wichtig:** «nicht relevant» ist im UI immer sichtbar und einklappbar, nie versteckt.
Ein Beleg, den die KI aussortiert hat und der eigentlich einen Abzug begründet hätte, ist
der teuerste Fehler im ganzen System.

---

## 8a. Feld-Mapping-Katalog (Entwurf)

Der fachliche Kern des Moduls. Er lässt sich **ohne** die noch fehlende XSD vorbereiten:
Beleg → normalisierte Position → eCH-0119-Zielelement. Die Spalte «eCH-0119-Ziel» ist eine
begründete Zuordnung auf Basis der in §2.1 ermittelten Elementnamen und **nach XSD-Erhalt
zu verifizieren**.

| Belegart | Parse-Methode | Extrahierte Werte | eCH-0119-Ziel (vorläufig) |
|---|---|---|---|
| **Lohnausweis** | eCH-0270-Barcode → sonst OCR | Bruttolohn, AHV/ALV, BVG, Quellensteuer, Spesen, Arbeitgeber | `mainForm` Einkommen (Haupt-/Nebenerwerb) |
| **eSteuerauszug** | eCH-0196 XML → sonst PDF417 | Depot-/Kontobestände per 31.12., Bruttoerträge A/B, VSt-Guthaben, Schuldzinsen | `listOfSecurities` (Totale nach A/B sowie Bund/Staat getrennt) |
| **Kontoauszug/Saldobestätigung** | OCR | Saldo 31.12., Zinsertrag | `listOfSecurities` |
| **Schuld-/Hypothekarausweis** | OCR | Schuldbetrag 31.12., Schuldzinsen, Gläubiger | `listOfLiabilities` (**brutto**, Schulden und Zinsen getrennt ausweisen) |
| **Säule 3a** | OCR | Einzahlung, Vorsorgeeinrichtung | `mainForm` Abzüge |
| **PK-Einkauf** | OCR | Einkaufssumme, Datum | `mainForm` Abzüge |
| **Krankenkasse** | eCH-0275 → sonst OCR | Prämien, Selbstbehalt, Franchise | `insurancePremiums` |
| **Arzt-/Zahnarztrechnungen** | OCR | Betrag, Datum, selbst getragen? | `diseaseAndAccidentExpenses` (Selbstbehalt-Schwelle beachten) |
| **Behinderungskosten** | OCR | Betrag, Art | `handicapExpenses` |
| **Weiterbildung** | OCR | Kurskosten, Anbieter, berufsorientiert? | `jobOrientedFurtherEducationCost` |
| **Arbeitsweg / Verpflegung** | Erfassung + OCR | ÖV-Abo, km, Auswärtsverpflegung | `jobExpenses` |
| **Kinderbetreuung** | OCR | Betrag, Kind, Institution | `mainForm` Abzüge, Bezug zu `childDataType` |
| **Spendenbescheinigung** | OCR | Betrag, Organisation, gemeinnützig? | `mainForm` Abzüge |
| **Alimente** | OCR/Vertrag | Betrag, Empfänger, Kind vs. Ex-Gatte | `mainForm` Einkommen bzw. Abzüge |
| **Renten AHV/IV/BVG** | OCR | Jahresbetrag, Rentenart | `mainForm` Einkommen (Besteuerungsquote je Art) |
| **Liegenschaft** | OCR + Vorjahr | Eigenmietwert, Mietertrag, Steuerwert, Unterhalt | Liegenschaftenverzeichnis (Formular gem. SSK) |
| **Qualifizierte Beteiligung** | OCR | Anteil ≥ 10 %, Ertrag, privat/geschäftlich | `qualifiedInvestmentsPrivate` / `…Business` |
| **Vorjahres-Veranlagung** | OCR/Import | Vorjahreswerte als Plausi-Referenz | kein Zielfeld — **Prüfgrösse** |

**Drei Regeln, die im Mapping-Code stehen müssen, nicht im Prompt:**

1. **Bruttoprinzip bei `listOfLiabilities`.** Schulden und Schuldzinsen werden getrennt
   ausgewiesen — niemals saldieren, auch wenn der Beleg es zusammenfasst.
2. **A/B-Trennung im Wertschriftenverzeichnis** und die getrennte Führung von Bundes- und
   Staatssteuer sind strukturgebend, nicht kosmetisch. Wer das im Datenmodell flach
   abbildet, baut es später teuer um.
3. **Analog zur MwSt-Regel des Fibu-Moduls: nicht nachrechnen, ablesen.** Die KI liest
   Beträge ab; Summen- und Plausi-Kontrollen macht der Code gegen die Vorjahreswerte.

**Was der Katalog bewusst noch nicht leistet:** Schwellenwerte, Pauschalen und Maxima
(Säule-3a-Maximum, Fahrkostendeckel, Selbstbehalt Krankheitskosten, Kinderabzüge) sind
kantonal und jährlich verschieden. Sie gehören in eine **versionierte Parametertabelle pro
Kanton und Steuerperiode**, nicht in den Code und schon gar nicht in den LLM-Prompt.

---

## 9. Mandantenfähigkeit & Multiuser

Drei Ebenen, die nicht vermischt werden dürfen:

1. **Artis-intern:** mehrere Mitarbeitende arbeiten an vielen Mandaten → gelöst über
   `*_user_mandant_access` + RLS, Muster steht.
2. **Mandant ↔ Steuerverwaltung:** Die Vertretung braucht eine **Vollmacht**. In ZH
   entweder unterzeichnete Generalvollmacht beim Steueramt oder Weitergabe des
   Zugangscode-Briefs für die laufende Periode. Das ist ein **Prozess**, kein Feature —
   das Modul muss den Vollmachtsstatus pro Person/Periode führen und die Einreichung
   blockieren, solange er fehlt.
3. **Artis ↔ Kanton:** Ein **Treuhänder-Register-Konto mit TH-ID** (ZH). In SG ein
   E-Login/AGOV mit zentraler Firmen-E-Mail, auf bis zu fünf Geräten hinterlegbar.

### 9.1 AGOV authentifiziert Menschen, keine Maschinen

Der wichtigste architektonische Fund dieser Recherche-Runde: **AGOV authentifiziert
Personen, keine Maschinen-Identitäten.** Die Anbindung erfolgt zwar über Standardprotokolle
(**OIDC** oder **SAML**, Spezifikation unter `agov.ch/spec`), und Zielanwendungen lassen
sich direkt oder über bestehende IAM-Systeme als SSO-Domäne anbinden — aber es gibt keinen
technischen Service-Account-Typ.

**Konsequenz:** Eine vollautomatische, unbeaufsichtigte Einreichung über den
Bürgerportal-Pfad (ZHprivateTax, E-Tax SG) ist nicht bloss unerwünscht, sondern
**technisch nicht vorgesehen**. Das ist kein Rückschlag — es bestätigt die Grundentscheidung
dieses Dokuments: Der Weg führt über den **Treuhänder-Register-Kanal**, der eine eigene
Authentifizierung mitbringt.

Für ZH ist beim Treuhänder-Register von **starker Authentisierung mittels SuisseID oder
mTAN** die Rede. ⚠️ **SuisseID wurde eingestellt** — diese Angabe ist also mit hoher
Wahrscheinlichkeit veraltet und muss zwingend am aktuellen Stand geprüft werden (V3). Genau
hier entscheidet sich, ob ein serverseitiger Upload ohne menschlichen Zwischenschritt
überhaupt möglich ist — und damit, wie «agentisch» das Modul am Ende wirklich sein kann.

Ebenfalls aus der ZH-Recherche: Das Treuhänder-Register kennt einen **Excel-Import in
vorgegebenem Format** für die Klientenerfassung (Download auf der Treuhänder-Seite des
KStA). Das betrifft die Mandantenliste, nicht die Deklaration — ist aber ein nützlicher
Nebeneingang für das initiale Onboarding der Mandate.

> ⚠️ **Sollbruchstelle:** Das SG-Modell «ein Firmenaccount, fünf Geräte» ist ein geteilter
> Zugang. Wenn unser Server in dessen Namen einreicht, geht die Zuordnung «welcher
> Mitarbeitende hat eingereicht» auf Kantonsseite verloren. Genau deshalb ist der
> **interne** Audit-Trail (`steuer_audit_log`, `freigegeben_von`) nicht optional: er ist
> die einzige Stelle, an der diese Information überhaupt noch existiert.

---

## 10. Datenschutz, Steuergeheimnis, Haftung

- **Alle Steuerdaten unterliegen dem Steuergeheimnis.** Das ist strenger als
  «normale» Personendaten und gilt zusätzlich zum revDSG.
- **revDSG** (in Kraft seit 01.09.2023): Auftragsbearbeitung nur vertraglich geregelt und
  nur so, wie sie dem Verantwortlichen selbst erlaubt wäre. Bei hohem Risiko für die
  Persönlichkeit ist eine **Datenschutz-Folgenabschätzung** zu erstellen — bei einer
  KI-gestützten Verarbeitung vollständiger Steuerdossiers ist von hohem Risiko auszugehen.
  Die DSFA ist einzuplanen, nicht wegzudiskutieren.
- **Auftragsbearbeitungsverträge** braucht es mit jedem Unterauftragnehmer, insbesondere:
  Supabase (Hosting/DB) und **Infomaniak AI Tools** (LLM).
- **Konsequenz für die Architektur:**
  - **Eigenes Supabase-Projekt**, getrennt von MailFlow. Steuerdaten teilen keine Datenbank
    mit Mail, Dokumenten und Leistungserfassung. Das ist der Hauptgrund für die Trennung
    des ganzen Produkts.
  - LLM-Verarbeitung ausschliesslich über die **Infomaniak-CH-Cloud**. Keine US-Anbieter für
    Steuerdaten, auch nicht «nur zum Testen».

  > ⚠️ **Abweichung zu MailFlow, die auffiel:** `CLAUDE.md` nennt Infomaniak als KI-Backend,
  > die produktive Function `suggest-document-fields` ruft aber OpenAI, Gemini und
  > Anthropic auf. Für die Fibu-Belegerkennung mag das vertretbar sein — für Steuerdaten
  > ist es das nicht. `steuer-suggest-position` hat deshalb **bewusst keinen Fallback**:
  > Fehlt der Infomaniak-Schlüssel, gibt die Function einen Fehler zurück und die App
  > bleibt bei der Regel-Einschätzung, statt die Daten ins Ausland zu schicken.
  > Ob MailFlows Fibu-Pfad ebenfalls angepasst werden sollte, ist eine offene Frage an
  > Sascha — sie betrifft ein produktives Modul und wird hier nicht einseitig entschieden.
  - AHV-Nummern nie im Klartext in Logs, LLM-Prompts oder Fehlermeldungen. Im Prompt
    pseudonymisieren, erst beim XML-Export einsetzen.
  - Aufbewahrung: Steuerakten typischerweise 10 Jahre → Löschkonzept **jetzt** definieren,
    nicht nach dem ersten Produktivjahr.
- **Haftung:** Die Steuererklärung wird vom Steuerpflichtigen bzw. vom bevollmächtigten
  Treuhänder verantwortet. Der Agent schlägt vor, ein Mensch gibt frei. Eine automatische
  Einreichung ohne Freigabeklick darf es in Stufe 1 nicht geben — und in Stufe 2 nur nach
  einer bewussten, protokollierten Opt-in-Entscheidung pro Mandat.

---

## 11. Verifikations-Backlog

Stand nach der zweiten Recherche-Runde. Die Netzwerk-Policy dieser Umgebung lässt **nur
GitHub** durch — `ech.ch`, `zh.ch`, `sg.ch`, `tg.ch`, `steueramt.zh.ch`, `sg-support.etax.ch`,
`helpdesk.drtax.ch`, `esteuer.ewv-ete.ch`, `ssk-csi.ch` und `agov.ch` scheitern bereits am
TLS-Handshake. Alles unten Stehende beruht daher auf Suchmaschinen-Auszügen, nicht auf
Primärdokumenten.

| # | Frage | Status | Wo klären |
|---|---|---|---|
| V1 | eCH-0119 XSD: Kardinalitäten, Datentypen, vollständige Feldliste | 🟡 **Struktur teilweise** — Elementnamen in §2.1, XSD fehlt | ech.ch |
| V2 | Version > 4.0.0? Welche verlangen ZH/SG/TG für 2025/2026? | 🔴 offen — keine Hinweise auf > 4.0.0 gefunden | ech.ch / Kantone |
| V3 | ZH-Schnittstelle zum Treuhänder-Register: Protokoll, Auth, Testumgebung | 🟡 **Existenz bestätigt**, Spezifikation fehlt. Auth-Angabe «SuisseID oder mTAN» ist vermutlich **veraltet** | KStA ZH |
| V4 | «Zertifizierte Schnittstelle» (iqtax) — formales Zulassungsverfahren? | 🔴 offen | KStA ZH |
| V5 | SG: Treuhänder-Upload-Kanal; akzeptiert E-Tax SG eCH-0119 aus Fremdsoftware? | 🟡 volles eFiling für Bürger bestätigt; Treuhänder-Kanal-Spezifikation fehlt | Steueramt SG / Ringler |
| V6 | TG: Einreichungskanal für Fremdsoftware neben eFisc; 24h-Korrekturfrist | 🔴 offen — **jetzt prioritär**, siehe V7 | Steuerverwaltung TG |
| V7 | Signatur-/Bestätigungserfordernis SG und TG | 🟢 **SG geklärt** (volles eFiling möglich) · 🚩 **TG: Unterschrift auf eFisc-Pfad**, Treuhänder-Pfad offen | TG |
| V8 | Maximale Paketgrösse und erlaubte Beilagen-Formate je Kanton | 🔴 offen | alle drei |
| V9 | Quittung: Format, Aufbewahrungspflicht, Rechtswirkung | 🔴 offen — dazu **eCH-0233** (Archivierung Steuern) auswerten | alle drei / ech.ch |
| V10 | eCH-0270-Barcode-Abdeckung 2026; eSteuerauszug-Verbreitung | 🟡 **eSteuerauszug: nicht alle Banken, 0–300 CHF, teils «Light»** · Lohnausweis-Barcode-Abdeckung offen | SSK |
| V11 | PDF417-Decoder für JS/Deno | 🟢 **Empfehlung `zxing-wasm`** (Deno-fähig, Structured-Append-Metadaten) — Messung an echten Auszügen steht aus | intern |
| V12 | AGOV: technischer Account für Software-Anbieter? | 🟢 **geklärt: nein.** AGOV authentifiziert Personen, keine Maschinen. OIDC/SAML, Spec unter `agov.ch/spec` | — |

**Was sich durch diese Runde geändert hat:**

1. **TG rutscht ab.** Der mögliche Unterschriftszwang macht eine durchgehende
   Automatisierung fraglich. V6/V7 sind von «nice to know» zu **entscheidungsrelevant**
   geworden — sie bestimmen, ob TG überhaupt in den Scope gehört.
2. **AGOV ist geklärt und bestätigt die Architektur.** Kein M2M-Login heisst: der
   Treuhänder-Kanal ist nicht die bequemere, sondern die **einzige** Option.
3. **Der eSteuerauszug ist schwächer als erhofft.** Nicht flächendeckend, teils
   kostenpflichtig, teils «Light». Der OCR-Pfad bleibt gleichwertig zu bauen — er ist kein
   Fallback für Randfälle.

**Empfohlener erster Schritt, unverändert:** schriftliche Anfrage an das Kantonale
Steueramt Zürich (Treuhänder-Register) mit V3, V4, V8, V9 — ergänzt um die aktuelle
Authentifizierungsmethode, nachdem SuisseID weggefallen ist. Parallel dazu die analoge
Anfrage an die Steuerverwaltung TG zu V6/V7, weil davon der Zuschnitt des Projekts abhängt.

---

## 12. Umsetzungsplan

| Phase | Inhalt | Ergebnis | Aufwand (grob) |
|---|---|---|---|
| **0 Klärung** | V1–V6, V12; Anfrage KStA ZH; XSD beschaffen | Go/No-Go, technische Zielspezifikation | 2–3 Wochen, überwiegend Wartezeit |
| **1 Ingest & Triage** | `steuer_beleg`, eCH-0196-Parser (XML zuerst, Barcode danach), Regel-Triage + LLM-Fallback, Review-UI | Belege werden erkannt und sortiert. **Für sich allein bereits nutzbar** — auch wenn Phase 3 scheitert | 4–6 Wochen |
| **2 Mapping & Deklaration** | `steuer_position`, Feld-Mapping ZH, Plausi-Checks, Vier-Augen-Review, PDF-Vorschau | Vollständige Deklaration im System, Ausgabe vorerst als PDF/Papier | 6–8 Wochen |
| **3 eCH-0119-Export** | XML-Generator + XSD-Validierung + Attachment-Paket, gegen Testumgebung | Gültiges Paket, manuell hochladbar | 3–4 Wochen |
| **4 Einreichung ZH** | Anbindung Treuhänder-Register, Quittungsverarbeitung, Audit-Trail | End-to-End für ZH | abhängig von V3 |
| **5 SG, dann TG** | Kantonale Erweiterungen über `cantonExtension`, Kanal je Kanton | Drei Kantone | je 2–4 Wochen |

**Schnittkante nach Phase 1/2:** Wenn sich in Phase 0 herausstellt, dass die kantonale
Schnittstelle für uns nicht zugänglich ist, bleibt das Modul trotzdem wertvoll — die
aufbereiteten Positionen lassen sich dann in Dr. Tax oder ZHprivateTax übertragen. Der
Investitionsschutz liegt bewusst vorne in der Kette.

---

## 13. Empfehlung

- **Pilotkanton ZH**, Steuerperiode 2026 als Zielsaison (Deklaration ab Frühjahr 2027).
  Für die Saison 2026 (Periode 2025) ist es zu spät — das ist kein Rückschlag, sondern
  gibt uns die Zeit, Phase 0 richtig zu machen.
- **Scope auf ZH + SG zuschneiden, TG unter Vorbehalt.** Nach der zweiten Recherche-Runde
  ist TG der einzige der drei Kantone, bei dem eine durchgehende elektronische Einreichung
  nicht belegt ist. Solange V6/V7 offen sind, gehört TG in den Ausblick, nicht in die
  Aufwandschätzung.
- **Nicht auf den eSteuerauszug allein bauen.** Er ist nicht flächendeckend, kostet bei
  manchen Banken bis zu dreistellig und existiert teils nur als «Light»-Version. OCR ist
  gleichwertiger Pfad, nicht Notnagel.
- **Reihenfolge nicht umdrehen.** Verlockend ist, mit dem XML-Generator anzufangen, weil er
  technisch klar umrissen ist. Falsch: ohne verifizierte XSD baut man am Schema vorbei, und
  ohne Ingest hat man nichts zu exportieren.
- **eCH-0196 vor OCR.** Der eSteuerauszug deckt das Wertschriftenverzeichnis ab — den
  aufwendigsten Teil jeder nP-Deklaration — und liefert ihn strukturiert. Ein Nachmittag
  Parser schlägt drei Wochen OCR-Tuning.
- **Der Mensch bleibt im Loop.** «Agentisch» heisst hier: der Agent bereitet vor, sortiert,
  füllt, begründet jeden Wert und markiert jede Unsicherheit. Er reicht nicht ungefragt ein.

---

## Quellen

**Standards**
- [eCH-0119 E-Tax Filing V4.0.0](https://www.ech.ch/de/ech/ech-0119/4.0.0) · [Hauptdokument PDF](https://www.ech.ch/sites/default/files/dosvers/hauptdokument/STAN_d_DEF_2021-03-08_eCH-0119_V4.0.0_E-Tax%20Filing_1.pdf) · [V3.2](https://www.ech.ch/de/ech/ech-0119/3.2)
- [eCH-0196 E-Steuerauszug V2.2.0](https://www.ech.ch/de/ech/ech-0196/2.2.0) · [V2.3.0](https://www.ech.ch/de/ech/ech-0196/2.3.0) · [Technische Wegleitung](https://www.ech.ch/sites/default/files/dosvers/beilagen/BEIL1_d_DEF_2022-06-07_eCH-0196_V2.2.0_Technische%20Wegleitung.pdf) · [Barcode-Generierung](https://www.ech.ch/sites/default/files/dosvers/beilagen/BEIL2_d_DEF_2022-06-07_eCH-0196_V2.0.0_Barcode%20Generierung%20-%20Technische%20Wegleitung.pdf)
- [eCH-0270 Barcode-Generierung für Steuerbelege V1.0.0](https://www.ech.ch/de/ech/ech-0270/1.0.0) · [PDF](https://www.ech.ch/sites/default/files/imce/eCH-Dossier/eCH-Dossier_PDF_Publikationen/Hauptdokument/STAN_d_DEF_2024-11-04_eCH-0270_V1.0.0_Barcode%20Generierung.pdf)
- [eCH-0275 Steuerbescheinigung Krankenkassen V1.0.0](https://www.ech.ch/de/ech/ech-0275/1.0.0)
- [eCH-0233 Archivierung Steuern V1.0](https://www.ech.ch/sites/default/files/dosvers/hauptdokument/BEST_d_DEF_2019-11-29_eCH-0233_V1.0_Archivierung_Steuern.pdf) (eCH-0229 = Pendant für juristische Personen)
- [SSK – eSteuerauszug](https://www.ssk-csi.ch/de/links/esteuerauszug) · [esteuer.ewv-ete.ch](https://esteuer.ewv-ete.ch/de/esteuerauszug/) · [Allg. Infos zu eStA](https://esteuer.ewv-ete.ch/de/esteuerauszug/information/allg-infos-zu-esta/)

**Zürich**
- [Steuererklärung Privatpersonen](https://www.zh.ch/de/steuern-finanzen/steuern/steuern-natuerliche-personen/steuererklaerung-natuerliche-personen.html) · [Auf die Online-Steuererklärung umsteigen](https://www.zh.ch/de/steuern-finanzen/steuern/steuern-natuerliche-personen/steuererklaerung-natuerliche-personen/auf-online-steuererklaerung-umsteigen.html)
- [Verordnung über die elektronische Einreichung der Steuererklärung (ZStB 109c.4)](https://www.zh.ch/de/steuern-finanzen/steuern/treuhaender/steuerbuch/steuerbuch-definition/zstb-109c-4.html)
- [Steuerberater & Vertreter](https://www.zh.ch/de/steuern-finanzen/steuern/treuhaender.html) · [Treuhänder-Register](https://www.steueramt.zh.ch/thregister)
- [Medienmitteilung: Kanton Zürich setzt auf ZHprivateTax (01/2026)](https://www.zh.ch/de/news-uebersicht/medienmitteilungen/2026/01/digitale-steuererklaerung-kanton-zuerich-setzt-auf-den-online-kanal-zhprivatetax.html)

**St. Gallen**
- [E-Tax SG für Privatpersonen](https://www.sg.ch/steuern-finanzen/steuern/elektronische-steuererklaerung/etaxnp.html) · [Elektronische Steuererklärung](https://www.sg.ch/steuern-finanzen/steuern/elektronische-steuererklaerung.html)
- [Medienmitteilung: Neue Online-Steuererklärung E-Tax SG](https://www.sg.ch/news/sgch_allgemein/2026/01/neue-online-steuererklaerung-e-tax-sg.html)
- [E-Tax SG Support – Vorjahresdaten importieren](https://sg-support.etax.ch/hc/de/sections/21413153298076-Vorjahresdaten-importieren) · [eSteuerauszug hinzufügen](https://sg-support.etax.ch/hc/de/articles/25891860972956-Wie-kann-ich-einen-eSteuerauszug-hinzuf%C3%BCgen) · [Wie reiche ich meine Steuererklärung ein?](https://sg-support.etax.ch/hc/de/articles/22940093561756-Wie-reiche-ich-meine-Steuererkl%C3%A4rung-ein) · [Belege hinzufügen](https://sg-support.etax.ch/hc/de/articles/22937939269532-Wie-k%C3%B6nnen-Belege-hinzugef%C3%BCgt-werden)
- [Elektronische Steuererklärung – e-service.sg.ch](https://www.e-service.sg.ch/eservices/elektronische-steuererklaerung.html)

**Thurgau**
- [Steuerverwaltung TG](https://steuerverwaltung.tg.ch/) · [eFisc Steuererklärungssoftware](https://steuerverwaltung.tg.ch/hilfsmittel/efisc-steuererklaerungssoftware.html/2958) · [eSteuerauszug in eFisc](https://steuerverwaltung.tg.ch/hilfsmittel/efisc-steuererklaerungssoftware/funktionen-efisc2016.html/5541)
- [Wegleitung zur Steuererklärung 2026 (nP)](https://steuerverwaltung.tg.ch/public/upload/assets/183684/FW26_Form_01a_Wegleitung.pdf) · [Wegleitung 2022 (Quelle Unterschriftserfordernis)](https://steuerverwaltung.tg.ch/public/upload/assets/125713/FW22_Form.01a_Wegleitung_Steuererkl%C3%A4rung_TG_V2_NP.pdf)

**AGOV / Identität**
- [AGOV – Informationen für Behörden](https://www.agov.admin.ch/de/informationen-behoerden) · [agov.ch](https://www.agov.ch/?l=de) · [AGOV help](https://help.agov.ch/?l=de)

**Markt & Software**
- [Dr. Tax Helpdesk – Online-Einreichung / E-Filing](https://helpdesk.drtax.ch/hc/de/articles/115000806069-Online-Einreichung-E-Filing) · [Dr. Tax Professional](https://www.drtax.ch/web/ch/de/produkte/steuererklaerung/drtax-professional.aspx) · [News: automatisierte Belegerkennung](https://www.drtax.ch/web/ch/de/news.aspx?newsid=4b744b34-3084-4759-a5b6-4a7faa2e52bd)
- [iqtax – Erste KI-Plattform mit Direktanbindung an Kanton Zürich](https://www.moneycab.com/finanz/iqtax-setzt-einen-neuen-standard-im-schweizer-steuerwesen-erste-ki-plattform-mit-direktanbindung-an-kanton-zuerich/) · [iqtax.ch](https://www.iqtax.ch/)
- [eTax.ch](https://etax.ch/) · [Ringler Informatik AG](https://www.ringler.ch/) · [TreuFlow](https://treuflow.ch/)

**Datenschutz**
- [revDSG – KMU.admin.ch](https://www.kmu.admin.ch/kmu/de/home/fakten-trends/digitalisierung/datenschutz/neues-datenschutzgesetz-rev-dsg.html) · [Auftragsbearbeitervereinbarung – PwC Schweiz](https://www.pwc.ch/de/insights/regulierung/die-auftragsbearbeitervereinbarung.html) · [revDSG für Treuhänder:innen](https://accounto.ch/totalrevidiertes-datenschutzgesetz-revdsg-was-treuhaenderinnen-beachten-muessen/)

**Open Source / Technik (Referenzen)**
- [BrunoEberhard/open-ech-taxstatement](https://github.com/BrunoEberhard/open-ech-taxstatement) · [vroonhof/opensteuerauszug](https://github.com/vroonhof/opensteuerauszug/)
- [Sec-ant/zxing-wasm](https://github.com/Sec-ant/zxing-wasm) · [PeculiarVentures/js-zxing-pdf417](https://github.com/PeculiarVentures/js-zxing-pdf417) · [ZXing PDF417Reader API](https://zxing.github.io/zxing/apidocs/com/google/zxing/pdf417/PDF417Reader.html)
- [Blick: Kosten für E-Steuerauszug bei Banken schwanken stark](https://www.blick.ch/wirtschaft/von-0-bis-300-franken-bei-welcher-bank-du-fuer-den-e-steuerauszug-nichts-bezahlen-musst-id21621793.html)
