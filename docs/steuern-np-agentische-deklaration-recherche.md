# Agentische Steuerdeklaration natürliche Personen (SG / TG / ZH)

Recherche- und Architekturdokument · Stand 04.08.2026 · Autor: Claude Code
Auftrag: Belege einlesen (OCR/PDF) → relevant/nicht relevant sortieren → Felder füllen →
elektronisch einreichen · mandantenfähig · Start mit natürlichen Personen (nP).

> **Status:** Recherche + Zielarchitektur. Kein Produktivcode. Offene Punkte, die sich nur
> durch direkte Anfrage bei den Steuerverwaltungen klären lassen, sind in
> [§11 Verifikations-Backlog](#11-verifikations-backlog) gesammelt und **nicht** als Fakten
> im Fliesstext behauptet.

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
  werden. Die Zuordnung der kantonalen Namespaces ist in Kap. 3.5 des Standards geregelt.
- Das XML kann laut Standard entstehen aus: **Software**, **2D-Barcode-Scan** oder
  **OCR-Scan** — der Standard denkt unsere Pipeline also explizit mit.

> ⚠️ Die konkrete Elementhierarchie (Personalien / Einkommen / Abzüge / Vermögen /
> Wertschriftenverzeichnis / Liegenschaften) konnte in dieser Session **nicht** verifiziert
> werden: `ech.ch` ist von der Netzwerk-Policy dieser Umgebung blockiert (CONNECT 403).
> Der erste Umsetzungsschritt ist daher zwingend der Download von Hauptdokument **und**
> XSD-Beilagen von ech.ch. Siehe [§11](#11-verifikations-backlog).

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
Wegleitung nennt die Java-Bibliothek J4L Vision. Für unseren JS/Deno-Stack ist das ein
offener Punkt — realistische Kandidaten sind `zxing-wasm` (PDF417-Decoder, läuft im
Browser wie in Deno) oder ein Python-Sidecar mit `zxing-cpp`. Muss prototypisch
gemessen werden, bevor wir uns festlegen.

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

**Bewertung:** Zweiter Kanton. Der AGOV-Firmenaccount mit 5 Geräten ist für unsere
Mandantenfähigkeit relevant — aber auch eine Sollbruchstelle (siehe §9).

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

**Bewertung:** Dritter Kanton. Weil es keine Web-App gibt, ist Browser-Automation hier
ohnehin keine Option — was die Entscheidung für den XML-/Schnittstellenweg zusätzlich
stützt.

### 3.4 Vergleich

| | ZH | SG | TG |
|---|---|---|---|
| Bürger-Portal | ZHprivateTax (Web) | E-Tax SG (Web, seit 2026) | eFisc (Desktop) |
| Login | AGOV | E-Login / AGOV | lokal |
| Unterschrift nötig | nein (ZStB 109c.4) | zu prüfen | zu prüfen |
| Belege elektronisch | Pflicht | zu prüfen | Pflicht bei e-Einreichung |
| Treuhänder-Register | ja, mit TH-ID | ja | ja |
| Drittsoftware-Schnittstelle | **dokumentiert** | vorhanden (Dr. Tax) | vorhanden (Dr. Tax) |
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

### 6.2 Wiederverwendung aus MailFlow

| Baustein | Datei | Verwendung |
|---|---|---|
| OCR/PDF-Extraktion | `src/lib/batchAiSuggest.js` | Stufe 1c/1d unverändert übernehmen |
| Zweistufiges Matching mit 0.85-Schwelle | ebd. | Muster für die Triage |
| UID-Erkennung (OCR-tolerant) | `findUidInText()` | Personen-/Firmenzuordnung |
| LLM-Call CH-Cloud | `supabase/functions/suggest-document-fields` | Vorlage für `steuer-suggest-position` |
| Beleg-OCR Edge Function | `supabase/functions/fibu-kassenbeleg-ocr` | Vorlage Server-seitiges OCR |
| Mandantenfähigkeit + RLS | `fibu_mandanten`, `fibu_user_mandant_access` | Direkt als Muster übernehmen |
| Dokumentenablage, Tags, Kunden | Dokumente-Modul | Belegquelle |
| Fristen | `Fristen.jsx`, `portal-sg-fristeingabe` | Einreichungsfristen-Kopplung |

**Explizit nicht anfassen:** MS365-Mail-Integration, `handleCheckout`/`handleCheckin` in
`Dokumente.jsx`, `fileHandleDB.js`, `CheckinDialog.jsx`.

---

## 7. Datenmodell (Entwurf)

```sql
-- Steuerpflichtige Person (nP), pro Mandant/Kunde
steuer_np_person        (id, mandant_id, kunde_id, ahv_nr_hash, zivilstand,
                         kanton, gemeinde, ...)

-- Eine Steuererklärung = Person × Steuerperiode × Kanton
steuer_deklaration      (id, person_id, periode, kanton,
                         status,           -- entwurf|review|freigegeben|eingereicht|quittiert
                         ech_version, created_by, freigegeben_von, freigegeben_am)

-- Beleg im Dossier, mit Herkunftsnachweis
steuer_beleg            (id, deklaration_id, storage_path, quelle,
                         belegart,         -- lohnausweis|esteuerauszug|kk_bescheinigung|
                                           -- saeule3a|liegenschaft|schuldzins|spende|...
                         parse_methode,    -- ech0196|ech0270|pdf_text|ocr|manuell
                         relevanz,         -- relevant|nicht_relevant|unklar
                         confidence, roh_text, roh_xml)

-- Extrahierte Position, immer mit Rückverweis auf den Beleg
steuer_position         (id, deklaration_id, beleg_id,
                         ech_pfad,         -- Ziel im eCH-0119-XML
                         wert_num, wert_text, waehrung,
                         confidence, bestaetigt_von, bestaetigt_am)

-- Jede Einreichung ist ein unveränderlicher Snapshot
steuer_einreichung      (id, deklaration_id, paket_hash, paket_path,
                         kanal, uebermittelt_am, quittung_ref, quittung_raw)

-- Lückenloser Audit-Trail
steuer_audit_log        (id, deklaration_id, user_id, aktion, alt, neu, ts)
```

**Zwei Invarianten, die im Schema erzwungen werden müssen:**

1. Jede `steuer_position` mit `wert_num IS NOT NULL` hat entweder ein `beleg_id` oder ein
   `bestaetigt_von` — kein Wert ohne Herkunft.
2. `steuer_einreichung` ist append-only (kein UPDATE/DELETE-Policy für `authenticated`).
   Eine Korrektur ist eine neue Zeile, keine Änderung.

**RLS:** exakt nach dem Fibu-Muster — Zugriff über `steuer_user_mandant_access`
(bzw. Wiederverwendung von `fibu_user_mandant_access`, falls die Mandantendefinition
identisch bleibt). Rollen: `admin` (freigeben + einreichen), `bearbeiter` (erfassen,
nicht einreichen), `readonly`.

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
  - LLM-Verarbeitung ausschliesslich über die bestehende **Infomaniak-CH-Cloud**. Keine
    US-Anbieter für Steuerdaten, auch nicht «nur zum Testen».
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

Diese Punkte sind **nicht verifiziert** und müssen vor dem ersten Codezeile-Commit geklärt
werden. Die Netzwerk-Policy dieser Umgebung blockiert `ech.ch`, `zh.ch`, `sg.ch` und
`tg.ch` (Proxy antwortet mit CONNECT 403), Recherche war daher auf Suchmaschinen-Ergebnisse
beschränkt.

| # | Frage | Wo klären |
|---|---|---|
| V1 | eCH-0119 V4.0.0 Hauptdokument + **XSD-Beilagen** herunterladen; Elementhierarchie, Namespaces, Kap. 3.5 kantonale Namespaces | ech.ch |
| V2 | Gibt es eine Version > 4.0.0? Welche Version verlangen ZH/SG/TG für Periode 2025/2026? | ech.ch / Kantone |
| V3 | **Spezifikation der ZH-Drittsoftware-Schnittstelle** zum Treuhänder-Register: Protokoll, Auth, Zertifizierung, Testumgebung | KStA ZH, Treuhänder-Register |
| V4 | Was bedeutet «zertifizierte Schnittstelle» (iqtax)? Gibt es ein formales Zulassungsverfahren für Softwareanbieter? | KStA ZH |
| V5 | SG: Upload-Kanal für Treuhänder — Format, Auth, akzeptiert E-Tax SG eCH-0119-Import von Fremdsoftware? | Steueramt SG / Ringler |
| V6 | TG: Einreichungskanal für Fremdsoftware neben eFisc; gilt die 24h-Korrekturfrist generell? | Steuerverwaltung TG |
| V7 | Signatur-/Bestätigungserfordernis in SG und TG (in ZH geklärt: keine Unterschrift) | SG / TG |
| V8 | Maximale Paketgrösse und erlaubte Beilagen-Formate je Kanton | alle drei |
| V9 | Quittung/Empfangsbestätigung: Format, Aufbewahrungspflicht, Rechtswirkung | alle drei |
| V10 | eCH-0270: Welche Belegarsteller liefern den Barcode 2026 tatsächlich? Abdeckungsgrad Lohnausweis | SSK |
| V11 | PDF417-Structured-Append-Decoder für JS/Deno: `zxing-wasm` prototypisch gegen echte eSteuerauszüge messen | intern |
| V12 | AGOV: Gibt es einen technischen Account-Typ für Software-Anbieter (M2M), oder nur personengebundene Logins? | AGOV / Kantone |

**Empfohlener erster Schritt, bevor irgendetwas gebaut wird:** eine schriftliche Anfrage an
das Kantonale Steueramt Zürich (Treuhänder-Register) mit den Punkten V3, V4, V8, V9. Das ist
der günstigste Weg, um in zwei Wochen zu wissen, ob das Produkt überhaupt existieren kann.

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
- [SSK – eSteuerauszug](https://www.ssk-csi.ch/de/links/esteuerauszug) · [esteuer.ewv-ete.ch](https://esteuer.ewv-ete.ch/de/esteuerauszug/)

**Zürich**
- [Steuererklärung Privatpersonen](https://www.zh.ch/de/steuern-finanzen/steuern/steuern-natuerliche-personen/steuererklaerung-natuerliche-personen.html) · [Auf die Online-Steuererklärung umsteigen](https://www.zh.ch/de/steuern-finanzen/steuern/steuern-natuerliche-personen/steuererklaerung-natuerliche-personen/auf-online-steuererklaerung-umsteigen.html)
- [Verordnung über die elektronische Einreichung der Steuererklärung (ZStB 109c.4)](https://www.zh.ch/de/steuern-finanzen/steuern/treuhaender/steuerbuch/steuerbuch-definition/zstb-109c-4.html)
- [Steuerberater & Vertreter](https://www.zh.ch/de/steuern-finanzen/steuern/treuhaender.html) · [Treuhänder-Register](https://www.steueramt.zh.ch/thregister)
- [Medienmitteilung: Kanton Zürich setzt auf ZHprivateTax (01/2026)](https://www.zh.ch/de/news-uebersicht/medienmitteilungen/2026/01/digitale-steuererklaerung-kanton-zuerich-setzt-auf-den-online-kanal-zhprivatetax.html)

**St. Gallen**
- [E-Tax SG für Privatpersonen](https://www.sg.ch/steuern-finanzen/steuern/elektronische-steuererklaerung/etaxnp.html) · [Elektronische Steuererklärung](https://www.sg.ch/steuern-finanzen/steuern/elektronische-steuererklaerung.html)
- [Medienmitteilung: Neue Online-Steuererklärung E-Tax SG](https://www.sg.ch/news/sgch_allgemein/2026/01/neue-online-steuererklaerung-e-tax-sg.html)
- [E-Tax SG Support – Vorjahresdaten importieren](https://sg-support.etax.ch/hc/de/sections/21413153298076-Vorjahresdaten-importieren) · [eSteuerauszug hinzufügen](https://sg-support.etax.ch/hc/de/articles/25891860972956-Wie-kann-ich-einen-eSteuerauszug-hinzuf%C3%BCgen)

**Thurgau**
- [Steuerverwaltung TG](https://steuerverwaltung.tg.ch/) · [eFisc Steuererklärungssoftware](https://steuerverwaltung.tg.ch/hilfsmittel/efisc-steuererklaerungssoftware.html/2958) · [eSteuerauszug in eFisc](https://steuerverwaltung.tg.ch/hilfsmittel/efisc-steuererklaerungssoftware/funktionen-efisc2016.html/5541)

**Markt & Software**
- [Dr. Tax Helpdesk – Online-Einreichung / E-Filing](https://helpdesk.drtax.ch/hc/de/articles/115000806069-Online-Einreichung-E-Filing) · [Dr. Tax Professional](https://www.drtax.ch/web/ch/de/produkte/steuererklaerung/drtax-professional.aspx) · [News: automatisierte Belegerkennung](https://www.drtax.ch/web/ch/de/news.aspx?newsid=4b744b34-3084-4759-a5b6-4a7faa2e52bd)
- [iqtax – Erste KI-Plattform mit Direktanbindung an Kanton Zürich](https://www.moneycab.com/finanz/iqtax-setzt-einen-neuen-standard-im-schweizer-steuerwesen-erste-ki-plattform-mit-direktanbindung-an-kanton-zuerich/) · [iqtax.ch](https://www.iqtax.ch/)
- [eTax.ch](https://etax.ch/) · [Ringler Informatik AG](https://www.ringler.ch/) · [TreuFlow](https://treuflow.ch/)

**Datenschutz**
- [revDSG – KMU.admin.ch](https://www.kmu.admin.ch/kmu/de/home/fakten-trends/digitalisierung/datenschutz/neues-datenschutzgesetz-rev-dsg.html) · [Auftragsbearbeitervereinbarung – PwC Schweiz](https://www.pwc.ch/de/insights/regulierung/die-auftragsbearbeitervereinbarung.html) · [revDSG für Treuhänder:innen](https://accounto.ch/totalrevidiertes-datenschutzgesetz-revdsg-was-treuhaenderinnen-beachten-muessen/)

**Open Source (Referenzen)**
- [BrunoEberhard/open-ech-taxstatement](https://github.com/BrunoEberhard/open-ech-taxstatement) · [vroonhof/opensteuerauszug](https://github.com/vroonhof/opensteuerauszug/)
