# Feldaufnahme ZHprivateTax 2025 (Kanton Zürich)

**Aufgenommen:** 20.08.2026 · **Art der Aufnahme:** rein lesend
**Es wurde nichts eingetippt, keine Zeile angelegt, nichts gespeichert und nichts eingereicht.**

- **34 Masken**, **188 logische Felder** (im DOM 232 Steuerelemente — eine Radio-Auswahl wie «Zivilstand» zählt hier als *ein* Feld mit sieben Optionen).
- Maschinenlesbare Fassung: `docs/portal-felder-zh-2025.json`

> **Bitte prüfen, bevor erfasst wird:** stimmen die Zuordnungen in der Spalte
> «unsere Position»? Besonders die mit ⚠ markierten Zeilen und der Abschnitt
> «Offene Punkte» am Schluss.

---

## Wie man im Portal navigiert

| Schritt | Weg |
|---|---|
| Einstieg | Dashboard `#/<Dossier-ID>/home` |
| Reiterzeile oben | `Datenimport` · `Übersicht` · `Hilfsmittel / Formulare` · `Administration` — das sind **Ankerlinks auf Abschnitte derselben Seite**, keine eigenen Seiten |
| In die Masken | Aus dem Abschnitt «Übersicht» eine beliebige Maske anklicken. Danach steht **links die vollständige Seitenleiste** mit allen 6 Gruppen und 34 Masken bereit |
| Zurück | «Zur Übersicht» in der Seitenleiste |
| Routenmuster | `#/<Dossier-ID>/tax-assistant/<gruppe>/<maske>` |
| Zeilendialoge | `#/<Dossier-ID>/dialogs/<gruppe>/<dialog>` |

### ⚠ Gefahrenstelle im Dashboard

Im Abschnitt **Hilfsmittel** stehen vier Kacheln, die **alle erfassten Daten löschen** —
und alle vier tragen denselben Knopf «Start»:

- Vorjahresdaten erneut importieren
- Neuen Zugangscode erstellen
- Steuererklärung zurücksetzen
- Steuererklärung löschen

Nur die erste Kachel («Navigation über Formulare») ist harmlos.

### Feld-Namensmuster

| Muster | Bedeutung |
|---|---|
| `<name>:Input` / `:DatePicker` / `:Checkbox` / `:RadioJa` | einfaches Feld |
| `<name>P1:Input` bzw. `<name>P2:Input` | je Ehegatte — P1 = Person 1, P2 = Person 2, Umschaltung über die Personen-Reiter oben in der Maske |
| `<name>WR:<liste>:<index>:Input` | Zeile einer Zeilenliste; der Zeilenindex steht zwischen den beiden Doppelpunkten |
| `attachment_file…` | Beleg-Upload, readonly, nur über Dateidialog |

### Betragsformat — noch offen

Betragsfelder sind `type=text` mit generischem `maxlength=120`. Daraus lässt sich
**nichts** über Rappen oder Tausender-Apostroph ableiten. Das muss beim ersten
echten Feld ausprobiert und hier nachgetragen werden.
Beispielschreibweise zur späteren Prüfung (erfunden): `1234.55`

---

## Persönliches

### Steuerpflichtige Personen · `tax-assistant/personal/personal-data`
Personen-Reiter (P1/P2). Abschnitte: Personalien, Berufliche Angaben, Weitere Angaben.

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Vorname | `personDataFirstNameP1:Input` | Text | max. 60 | — |
| Name | `personDataOfficialNameP1:Input` | Text | max. 60 | — |
| Geburtsdatum | `personDataDateOfBirthP1:DatePicker` | Datum | | — |
| Strasse | `personDataStreetP1:Input` | Text | max. 60 | — |
| Nummer | `personDataHouseNumberP1:Input` | Text | max. 12 | — |
| Zusatz | `personDataAddressLine1P1:Input` | Text | max. 60 | — |
| PLZ | `personDataZipP1:Input` | Text | max. 15 | — |
| Ort | `OrtP1` | Text | max. 40 | — |
| Telefon | `personDataPhoneNumberP1:Input` | Text | max. 20 | — |
| E-Mail | `personDataEmailP1:Input` | Text | max. 60 | — |
| Zivilstand | `id-<code><text>married` | Auswahl | ledig / verheiratet / verwitwet / geschieden / getrennt / eingetragene Partnerschaft / aufgelöste Partnerschaft | — |
| Konfession | `id-<code><text>711` | Auswahl | 111 reformiert / 121 röm.-kath. / 122 christ-kath. / 811 andere / 711 keine | — |
| Beruf | `personDataJobP1:Input` | Text | max. 60 | — |
| Ordentliche PK-Beiträge 2025 geleistet? | `personDataPaymentPensionP1:RadioJa` | Auswahl | true=Ja / false=Nein | — |
| Gemeinde | `personDataTaxMunicipality:Input` | Text | **Rechenfeld** (readonly) | — |

**Personalien füllt Sascha selbst.**

### Kinder · `tax-assistant/personal/children`
Zeilenliste. Anlegen: «Kind im Haushalt hinzufügen» / «Kind ausserhalb Haushalt hinzufügen».

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Gemeinsames Kind | `intChildIsCommonChildWR:intChild:<i>:Checkbox` | Häkchen | | — |
| Vorname | `intChildFirstNameWR:intChild:<i>:Input` | Text | max. 30 | — |
| Name | `intChildOfficialNameWR:intChild:<i>:Input` | Text | max. 30 | — |
| Geburtsdatum | `intChildDateOfBirthWR:intChild:<i>:DatePicker` | Datum | | — |
| Schule oder Lehrfirma | `intChildSchoolOrCompanyWR:intChild:<i>:Input` | Text | max. 34 | — |
| Voraussichtlich bis (Jahr) | `intChildCorrectToWR:intChild:<i>:Input` | Text | max. 120 | — |
| *dieselben Felder ausserhalb Haushalt* | `extChild…:extChild:<i>:…` | | zusätzlich «Adresse» max. 60 | — |

⚠ **Kinderbetreuungskosten fehlen hier.** Im Routenverzeichnis der App gibt es einen
Dialog `external-care` — der Abzug hängt vermutlich an der einzelnen Kinderzeile.
Nicht geprüft (hätte eine Zeile erfordert).

### Unterstützte Personen · `tax-assistant/personal/supported-person`
Ja/Nein-Schalter. Zeilenliste, innerhalb/ausserhalb Haushalt.

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Vorname | `intSupportedPersonFirstNameWR:…:<i>:Input` | Text | max. 22 | — |
| Name | `intSupportedPersonOfficialNameWR:…:<i>:Input` | Text | max. 34 | — |
| Geburtsjahr | `intSupportedPersonYearOfBirthWR:…:<i>:Input` | Text | max. 120 | — |
| *ausserhalb Haushalt* | `extSupportedPerson…` | | zusätzlich «Adresse» max. 50 | — |

### Vertreter · `tax-assistant/personal/representative-person`
Ja/Nein-Schalter.

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Treuhänder-ID | `representativePersonThId:Input` | Text | max. 20 | `vollmacht` |
| Firma | `representativePersonOrganisation:Input` | Text | max. 60 | `vollmacht` |
| Vorname | `representativePersonFirstName:Input` | Text | max. 60 | `vollmacht` |
| Name | `representativePersonOfficialName:Input` | Text | max. 60 | `vollmacht` |
| Strasse | `representativePersonStreet:Input` | Text | max. 60 | `vollmacht` |
| Nummer | `representativePersonHouseNumber:Input` | Text | max. 12 | `vollmacht` |
| PLZ | `representativePersonZip:Input` | Text | max. 15 | `vollmacht` |
| Ort | `representativePersonTown:Input` | Text | max. 40 | `vollmacht` |
| Telefon | `representativePersonPhoneNumber:Input` | Text | max. 20 | `vollmacht` |

### Erhaltene Schenkungen / Erbschaften · `tax-assistant/personal/benefit-payment-received`
Leere Zeilenliste, anlegen mit «Neue Schenkung/Erbschaft hinzufügen».
**Zeilenstruktur nicht aufgenommen** (erscheint erst nach Anlegen einer Zeile). Position: —

### Ausgerichtete Schenkungen / Erbvorbezüge · `tax-assistant/personal/benefit-paidout`
Ja/Nein-Schalter, leere Zeilenliste. **Zeilenstruktur nicht aufgenommen.** Position: —

### Kapitalleistungen · `tax-assistant/personal/benefit-payment`
Zeilenliste, anlegen mit «Kapitalleistung hinzufügen».

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Art | `id-<code><text>` | Auswahl | 1 AHV/IV · 2 Freizügigkeit · 3 Tod/bleibende Nachteile · 4 berufliche Vorsorge (2. Säule) · 5 Säule 3a · 6 sonstige | ⚠ `rente_saeule3` |
| Auszahlungsdatum | `benefitPaymentDateWR:benefitPayment:<i>:DatePicker` | Datum | | ⚠ `rente_saeule3` |
| Betrag | `benefitPaymentAmountWR:benefitPayment:<i>:Input` | Betrag | max. 120 | ⚠ `rente_saeule3` |

⚠ **Doppelkandidat:** `rente_saeule3` gehört je nach Beleg hierher (Kapitalleistung,
Sonderbesteuerung) **oder** in «Einkünfte > Renten und Versicherungen» (laufende Rente).

### Bankverbindung für Rückerstattungen · `tax-assistant/personal/account-data`

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| IBAN-Nr. | `listOfSecuritiesBankAccountIbanNumber:Input` | Text | max. 26 | — |
| Konto lautend auf | `listOfSecuritiesBankAccountAccountOwner:Input` | Text | max. 50 | — |

**Bankverbindung trägt Sascha selbst ein.**

---

## Einkünfte

### Erwerb · `tax-assistant/revenue/employed`
Personen-Reiter. Zeilenlisten für Haupt- und Nebenerwerb.

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Von | `revenueEmployedMainRevenueDetailP1BeginDateWR:…:<i>:DatePicker` | Datum | | `lohn_haupt` |
| Bis | `revenueEmployedMainRevenueDetailP1EndDateWR:…:<i>:DatePicker` | Datum | | `lohn_haupt` |
| Arbeitgeber | `revenueEmployedMainRevenueDetailP1EntrepreneurWR:…:<i>:Input` | Text | max. 86 | `lohn_haupt` |
| **Nettolohn** | `revenueEmployedMainRevenueDetailP1RevenueWR:…:<i>:Input` | Betrag | max. 120 | **`lohn_haupt`** |
| Beleg Lohnausweis Haupterwerb | `attachment_filerevenueEmployedMainRevenueDetailP1<i>` | Datei | readonly | `lohn_haupt` (Beleg) |
| Von / Bis / Arbeitgeber | `revenueEmployedSidelineRevenueDetailP1…` | Datum/Text | max. 86 | `lohn_neben` |
| **Nettolohn Nebenerwerb** | `revenueEmployedSidelineRevenueDetailP1RevenueWR:…:<i>:Input` | Betrag | max. 120 | **`lohn_neben`** |
| Beleg Lohnausweis Nebenerwerb | `attachment_filerevenueEmployedSidelineRevenueDetailP1<i>` | Datei | readonly | `lohn_neben` (Beleg) |
| Einkünfte (selbst., Haupt) | `revenueSelfemployedMainRevenueAmountP1:Input` | Betrag | max. 120 | `selbstaendig` (Einkommen) |
| Eigenkapital ohne Geschäftswertschriften | `revenueSelfemployedMainAssetsAmountP1:Input` | Betrag | max. 120 | `selbstaendig` (Vermögen) |
| Erhebliche Mitarbeit im Geschäft | `revenueRelevantCooperationMainP1:Checkbox` | Häkchen | | `selbstaendig` |
| Einkünfte (selbst., Neben) | `revenueSelfemployedSidelineRevenueAmountP1:Input` | Betrag | max. 120 | `selbstaendig` (Einkommen) |
| Eigenkapital (Neben) | `revenueSelfemployedSidelineAssetsAmountP1:Input` | Betrag | max. 120 | `selbstaendig` (Vermögen) |
| Erhebliche Mitarbeit (Neben) | `revenueRelevantCooperationSidelineP1:Checkbox` | Häkchen | | `selbstaendig` |
| Eigenkapital Selbständigerwerbender | `assetSelfEmployedBusinessCapitalFiscalValue:Input` | Betrag | max. 120 | `selbstaendig` (gemeinsam P1+P2) |

Nettolohn = Lohnausweis Ziffer 11.

### Renten und Versicherungen · `tax-assistant/revenue/insurance`
Personen-Reiter. Zeilenliste für Renten/Pensionen.

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Art | `id-<code><text>` | Auswahl | 0 AHV / 1 IV | `rente_ahv` |
| Betrag AHV-/IV-Rente (100 %) | `revenueInsuranceP1AHVIV100Amount:Input` | Betrag | max. 120 | `rente_ahv` |
| Erwerbsausfall aus Arbeitslosenversicherung | `revenueUnemploymentInsuranceP1:Input` | Betrag | max. 120 | `ersatz` |
| Kinder-/Familienzulagen, MSE, Taggelder, EO | `revenueChildAllowancesP1:Input` | Betrag | max. 120 | `ersatz` |
| Bezeichnung | `revenuePensionDetailP1DescriptionWR:…:<i>:Input` | Text | max. 86 | `rente_pk` |
| Betrag | `revenuePensionDetailP1Amount100WR:…:<i>:Input` | Betrag | max. 120 | `rente_pk` |
| Prozent | `id-<code><text>` | Auswahl | 0 / Leibrente / 60 / 80 / 100 | `rente_pk` (steuerbarer Anteil) |
| Steuerbar | `revenuePensionDetailP1AmountFinalWR:…:<i>:Input` | Betrag | **Rechenfeld** (readonly) | — |

### Übrige Einkünfte · `tax-assistant/revenue/rest`

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Unterhaltsbeiträge Ehegatte/Partner | `revenueRestRevenueAlimony:Input` | Betrag | **Rechenfeld** (readonly) | ⚠ `alimente_erhalten` |
| Unterhaltsbeiträge minderjährige Kinder | `revenueRestRevenueAlimonyChild:Input` | Betrag | **Rechenfeld** (readonly) | ⚠ `alimente_erhalten` |
| Nähere Bezeichnung (Kapitalabfindung) | `revenueRestRevenueLumpSumSettlementText:Input` | Text | max. 28 | `uebrige_einkuenfte` |
| Anzahl Monate | `revenueLumpSumSettlementMonths:Input` | Zahl | max. 120 | `uebrige_einkuenfte` |
| Betrag | `revenueRestRevenueLumpSumSettlementAmount:Input` | Betrag | max. 120 | `uebrige_einkuenfte` |
| Datum | `inheritanceEtcDetailDateWR:inheritanceEtcDetail:<i>:DatePicker` | Datum | | `uebriges_vermoegen` |
| Genaue Bezeichnung | `inheritanceEtcDetailDescriptionWR:…:<i>:Input` | Text | max. 68 | `uebriges_vermoegen` |
| Vermögen Betrag | `inheritanceEtcDetailAssetWR:…:<i>:Input` | Betrag | max. 120 | `uebriges_vermoegen` (Vermögen) |
| Einkommen Betrag | `inheritanceEtcDetailRevenueWR:…:<i>:Input` | Betrag | max. 120 | `uebrige_einkuenfte` (Einkommen) |
| Art | `revenueRestRevenueFreeTextDetailDescriptionWR:…:<i>:Input` | Text | max. 38 | `uebrige_einkuenfte` |
| Betrag | `revenueRestRevenueFreeTextDetailAmountWR:…:<i>:Input` | Betrag | max. 120 | `uebrige_einkuenfte` |

⚠ Die Alimente-Felder sind **readonly** — sie werden aus einem Dialog gespeist, nicht direkt getippt.

### Liegenschaften · `tax-assistant/revenue/properties`
**Keine Einzelfelder.** Zeilenliste, anlegen mit «Liegenschaften hinzufügen».

Spalten der Liste: Nr. · Ort · Strasse und Nummer · Kanton / Land · Steuerwert Ertragswert ·
Steuerwert Verkehrswert · Ertrag · Kosten · Verbleibender Ertrag · Aktionen

Objektfelder liegen im Dialog `property-detail` / `property-taxvalue` — **nicht geöffnet**.
Positionen: `liegenschaft_ertrag`, `liegenschaftsunterhalt`, `liegenschaften`
*(Es ist dieselbe Liste wie unter Vermögen > Liegenschaften — ein Verzeichnis, zwei Einstiege.)*

---

## Abzüge

### Berufsbedingte Fahrkosten · `tax-assistant/deductions/job-expenses-motorvehicle`
Personen-Reiter. Alle Felder → **`berufsauslagen_fahrkosten`**

| Feld | technischer Name | Typ | Format/Grenze |
|---|---|---|---|
| Arbeitgeber | `personDataEmployerP1:Input` | Text | max. 60 |
| Arbeitsort Strasse | `jobExpensesPlaceOfWorkP1:Input` | Text | max. 96 |
| Abonnementskosten öffentliche Verkehrsmittel | `jobExpensesTicketCostPublicTransportP1:Input` | Betrag | max. 120 |
| Fahrrad, Kleinmotorrad | `jobExpensesBicycleOrSmallMotorbikeP1:Input` | Betrag | max. 120 |
| Fehlen eines öffentlichen Verkehrsmittels | `jobExpensesReasonPrivateMotorvehicleP1NoPublicTransport:Checkbox` | Häkchen | |
| Zeitersparnis über 1 Stunde | `…P1TimeSaving:Checkbox` | Häkchen | |
| Ständige Benützung während Arbeitszeit | `…P1JobRequirement:Checkbox` | Häkchen | |
| Unmöglichkeit zufolge Krankheit/Gebrechlichkeit | `…P1MedicalReasons:Checkbox` | Häkchen | |
| Geleastes Fahrzeug | `jobExpensesMotorvehicleP1IsLeased:Checkbox` | Häkchen | |
| Arbeitsort | `jobExpensesDetailsMotorvehicleP1PlaceOfWorkWR:…:<i>:Input` | Text | max. 22 |
| Anzahl Arbeitstage | `…NumberOfWorkdaysWR:…:<i>:Input` | Zahl | max. 120 |
| Anzahl km pro Fahrt | `…DistanceWR:…:<i>:Input` | Zahl | max. 120 |
| Fahrten pro Tag | `…NumberOfTripsWR:…:<i>:Input` | Zahl | max. 120 |
| Rappen pro km | `id-<code><text>` | Auswahl | 70 (Auto) / 40 (Motorrad) |

### Weitere Berufsauslagen · `tax-assistant/deductions/job-expenses-other-expenses`
Personen-Reiter.

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Mit Verbilligung Arbeitgeber | `jobExpensesCateringSubsidizedP1:Input` | Betrag | max. 120 | `berufsauslagen_verpflegung` |
| Voll zu Lasten des Arbeitnehmers | `jobExpensesCateringNonSubsidizedP1:Input` | Betrag | max. 120 | `berufsauslagen_verpflegung` |
| Anzahl Tage Schicht-/Nachtarbeit | `jobExpensesCateringShiftWorkNumberOfDaysP1:Input` | Zahl | max. 120 | `berufsauslagen_verpflegung` |
| Abrechnungsart Berufskosten | `jobExpensesRemainingJobCostFlatrateOrRealP1:Radio<text>` | Auswahl | true = Pauschal 3 % Nettolohn / false = Effektive Kosten | ⚠ `berufsauslagen_uebrige` |
| Datum | `jobExpensesWeekdayStayDetailP1DateWR:…:<i>:DatePicker` | Datum | | `berufsauslagen_verpflegung` |
| Bezeichnung | `…DescriptionWR:…:<i>:Input` | Text | max. 144 | `berufsauslagen_verpflegung` |
| Betrag | `…AmountWR:…:<i>:Input` | Betrag | max. 120 | `berufsauslagen_verpflegung` |
| Auslagen bei Nebenerwerb | `jobExpensesSidelineFlatrateOrRealP1:Radio<text>` | Auswahl | true = Pauschal 20 % / false = Effektive Kosten | ⚠ `berufsauslagen_uebrige` |

⚠ **Pauschal oder effektiv entscheidet Sascha**, nicht der Agent.

### Berufsorientierte Aus- und Weiterbildung · `tax-assistant/deductions/job-expenses-education`
Personen-Reiter. Alle Felder → **`weiterbildung`**

| Feld | technischer Name | Typ | Format/Grenze |
|---|---|---|---|
| Bezeichnung | `furtherEducationCostDetailDescriptionWR:…:<i>:Input` | Text | max. 120 |
| Betrag | `furtherEducationCostDetailAmountP1WR:…:<i>:Input` | Betrag | max. 120 |
| Beitrag Arbeitgeber / weiterer Stellen | `furtherEducationEmployerContributionP1:Input` | Betrag | max. 120 (Kürzung) |

### Schuldzinsen · `tax-assistant/deductions/deduction-private-liabilities`
**Identisch mit Vermögen > Schulden** — ein einziges Schuldenverzeichnis, zwei Einstiege.
Zeilenliste, anlegen mit «Weitere Zeile hinzufügen».

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Name, Vorname und Adresse des Gläubigers | `listOfLiabilitiesPrivateLiabilitiesIdentificationWR:…:<i>:Input` | Text | max. 110 | `schulden` (Gläubiger) |
| Schuld am 31.12. | `…LiabilityWR:…:<i>:Input` | Betrag | max. 120 | `schulden` (Vermögen) |
| Schuldzinsen | `…LiabilityInterestWR:…:<i>:Input` | Betrag | max. 120 | `schulden` (Einkommen) |

⚠ Die Zeile kennt **keine Objektzuordnung** — die Katalog-Dimension `objekt` hat hier kein Gegenstück.

### Unterhalt und Renten · `tax-assistant/deductions/deduction-payment`

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Unterhaltsbeiträge Ehegatte/Partner | `deductionPaymentAlimonyCantonalTax:Input` | Betrag | **Rechenfeld** (readonly) | ⚠ `alimente_bezahlt` |
| Unterhaltsbeiträge minderjährige Kinder | `deductionPaymentAlimonyChildCantonalTax:Input` | Betrag | **Rechenfeld** (readonly) | ⚠ `alimente_bezahlt` |
| Rentenleistungen | `deductionPaymentPensionTotal:Input` | Betrag | max. 120 | — |
| Rentenleistungen, abzugsfähig: Ertragsanteil | `deductionPaymentPensionDeduction:Input` | Betrag | max. 120 | — |

### Säule 3a und weitere Vorsorgearten · `tax-assistant/deductions/provision`
Personen-Reiter.

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Betrag Effektiv (Säule 3a) | `deductionProvision3aP1Effective:Input` | Betrag | max. 120 | **`saeule_3a`** |
| *Beiträge an die AHV, IV und 2. Säule* | leere Zeilenliste | | Spalten erst nach «Weitere Zeile hinzufügen» sichtbar | ⚠ `einkauf_pk` **und** `ahv_beitraege` |

⚠ **Zwei Katalogpositionen zielen auf dieselbe Liste.** Welche Zeilenart welche Position
trägt, ist offen — das muss Sascha entscheiden.

### Versicherungsprämien · `tax-assistant/deductions/insurance-premiums`
Alle Felder → **`versicherungspraemien`**

| Feld | technischer Name | Typ | Format/Grenze |
|---|---|---|---|
| Private Krankenversicherungsprämien | `insurancePremiumsPrivateHealthInsurance:Input` | Betrag | max. 120 |
| Private Unfallversicherungsprämien | `insurancePremiumsPrivateAccidentInsurance:Input` | Betrag | max. 120 |
| Private Lebens- und Rentenversicherungsprämien | `insurancePremiumsPrivateLifeAndPensionInsurance:Input` | Betrag | max. 120 |
| Zinsen von Sparkapitalien | `insurancePremiumsInterestSavings:Input` | Betrag | max. 120 |
| Abzüglich erhaltene Prämienverbilligungen | `insurancePremiumsDeductionsPremiumsReduction:Input` | Betrag | max. 120 (Kürzung) |

Dazu eine Rechentabelle (Kategorie / Staatssteuer / Bundessteuer) — vom Portal selbst gefüllt.
**Die Gebäudeversicherung gehört NICHT hierher**, sondern in den Liegenschaftsunterhalt.

### Krankheits- und Unfallkosten · `tax-assistant/deductions/disease-accident-expenses`
Ja/Nein-Schalter. Alle Felder → **`krankheitskosten`**

| Feld | technischer Name | Typ | Format/Grenze |
|---|---|---|---|
| Vorname (betroffene Person) | `diseaseAndAccidentExpensesConcernedPersonFirstNameWR:…:<i>:Input` | Text | max. 40 |
| Name | `…OfficialNameWR:…:<i>:Input` | Text | max. 50 |
| Wohn-/Aufenthaltsort | `…LocationWR:…:<i>:Input` | Text | max. 62 |
| Selbstbehalt gemäss Abrechnung | `diseaseAndAccidentExpensesExpenseFranchise:Input` | Betrag | max. 120 |
| Art weitere Aufwendungen | `id-<code><text>Weitere Aufwendungen` | Auswahl | Arzt+Medikamente / Zahnarzt / Pflegepersonal / Spital+Heilstätten / verordnete Therapien, Kuren |
| Betrag CHF | `diseaseAndAccidentExpensesExpenseFreeTextAmount:Input` | Betrag | max. 120 |
| Beschreibung weitere Aufwendungen | `diseaseAndAccidentExpensesExpenseFreeText:Input` | Text | max. 104 |
| Art Krankenkasse/Versicherung | `id-<code><text>Krankenkasse/Versicherung` | Auswahl | Anteil Lebenshaltungskosten / Weitere Vergütungen |
| Betrag CHF (Vergütung) | `diseaseAndAccidentExpensesAllowanceInsurance:Input` | Betrag | max. 120 (Kürzung) |
| Pauschale (D) | `diseaseAndAccidentExpensesTotalAmountExpensesFlatrate:Input` | Betrag | max. 120 |

Nur der selbst getragene Teil zählt — Kassenleistung in die Kürzungsfelder.

### Behinderungsbedingte Kosten · `tax-assistant/deductions/handicap-expenses`
Alle Felder → **`behinderungskosten`**

| Feld | technischer Name | Typ | Format/Grenze |
|---|---|---|---|
| Vorname | `handicapExpensesConcernedPersonHandicapFirstNameWR:…:<i>:Input` | Text | max. 38 |
| Name | `…OfficialNameWR:…:<i>:Input` | Text | max. 42 |
| Wohn-/Aufenthaltsort | `…LocationWR:…:<i>:Input` | Text | max. 36 |
| Art der Behinderung | `…HandicapWR:…:<i>:Input` | Text | max. 32 |
| Art (IV-Leistungen etc.) | `id-<code><text>…` | Auswahl | Heim-/Entlastungsaufenthalte / Weitere Aufwendungen |
| Betrag CHF | `handicapExpensesExpenseIVAllowances:Input` | Betrag | max. 120 |
| Art weitere Vergütungen | `id-<code><text>Weitere Vergütungen` | Auswahl | Krankenkasse/Versicherungen / Hilflosenentschädigungen / Anteil Lebenshaltungskosten |
| Betrag CHF (Vergütung) | `handicapExpensesAllowanceFreeTextAmount:Input` | Betrag | max. 120 |
| Beschreibung weitere Vergütungen | `handicapExpensesAllowanceFreeText:Input` | Text | max. 106 |
| Pauschale, Art (D) | `handicapExpensesTotalAmountDeductionFlatrateDescription:Input` | Text | max. 86 |
| Betrag Pauschale | `handicapExpensesTotalAmountDeductionFlatrate:Input` | Betrag | max. 120 |

### Gemeinnützige Zuwendungen · `tax-assistant/deductions/revenue-calculation-deduction-charity-detail`
Ja/Nein-Schalter. Zeilenliste, anlegen mit «Neue Gemeinnützige Zuwendung hinzufügen».
Alle Felder → **`spenden`**

| Feld | technischer Name | Typ | Format/Grenze |
|---|---|---|---|
| Datum | `revenueCalculationDeductionCharityDetailDateWR:…:<i>:DatePicker` | Datum | |
| Bezeichnung | `…DescriptionWR:…:<i>:Input` | Text | max. 130 |
| Betrag | `…AmountCantonalTaxWR:…:<i>:Input` | Betrag | max. 120 |

Je Spende eine Zeile mit Datum und Empfänger — passt genau auf die Katalog-Aufstellung.

### Weitere Abzüge · `tax-assistant/deductions/deduction-further-deduction`

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Bezeichnung (Vermögensverwaltung) | `deductionFurtherDeductionFinancialManagementDetailDescriptionWR:…:<i>:Input` | Text | max. 120 | `uebrige_abzuege` |
| Betrag | `…AmountCantonalWR:…:<i>:Input` | Betrag | max. 120 | `uebrige_abzuege` |
| Art (übrige weitere Abzüge) | `id-<code><text>` | Auswahl | 1 Sonstige · 3/4 NBU-Abzüge P1/P2 · 5/6 Diff. Grundstückgewinn · 7/8 Realisierte stille Reserven · **9 Einsatzkosten Lotteriegewinn** · 10/11 Diff. Freibetrag Feuerwehrsold · 12/13 Patente, F&E | `uebrige_abzuege` |
| Bezeichnung | `deductionFurtherDeductionFreeTextDetailDescriptionWR:…:<i>:Input` | Text | max. 114 | `uebrige_abzuege` |
| Staatssteuer | `…AmountCantonalTaxWR:…:<i>:Input` | Betrag | max. 120 | `uebrige_abzuege` |
| Bundessteuer | `…AmountFederalTaxWR:…:<i>:Input` | Betrag | **Rechenfeld** (readonly) | — |
| Datum | `deductionFurtherDeductionPoliticalPartyDetailDateWR:…:<i>:DatePicker` | Datum | | `parteispenden` |
| Bezeichnung | `…DescriptionWR:…:<i>:Input` | Text | max. 130 | `parteispenden` |
| Betrag CHF | `…AmountWR:…:<i>:Input` | Betrag | max. 120 | `parteispenden` |

Der Pauschalabzug für Vermögensverwaltung wird vom Portal selbst gerechnet — hier nur effektive Kosten.

---

## Wertschriften

### Wertschriftenverzeichnis · `tax-assistant/securities/security-list`

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Wertschriftenanzeige gruppieren (nach Art) | `slider_groupListOfSecuritiesAndDa1` | Häkchen | nur Anzeige | — |
| Ich bestätige, dass ich über kein Bankkonto und keine sonstigen Wertschriften verfüge | `confirmNoSecurities:Checkbox` | Häkchen | | — (setzt Sascha) |

**Eine Zeile entsteht auf drei Wegen** (keiner wurde gedrückt):

1. **Importieren** → «eSteuerauszug importieren» (PDF mit Barcode)
2. **Wertschrift suchen** → Online-Suche über Valoren-/ISIN-Nr.; findet auch
   Kryptowährungen; füllt Steuerwert und Erträge automatisch
3. **Wertschriftenart auswählen** → «Bankkonto» · «Wertschrift und Guthaben» ·
   «Wertschrift mit ausl. QS (DA-1)»

Spalten der Liste: Bezeichnung Valoren-Nr. · Nennwert/Stückzahl · Steuerwert CHF ·
Ertrag CHF · Bearbeiten/Löschen

> ⚠ **Grösste Lücke dieser Aufnahme.** Die eigentlichen Zeilenfelder (Konto/Depot,
> Bezeichnung, Valoren-Nr., Nennwert/Stückzahl, Steuerwert, Bruttoertrag,
> **Verrechnungssteuer-Antrag**, Code Q für qualifizierte Beteiligung) liegen im
> Dialog `securities-detail`. Der wurde **nicht geöffnet**, weil dazu eine Zeile
> hätte angelegt oder eine bestehende Zeile zur Bearbeitung geöffnet werden müssen.
> Betrifft die Positionen `wertschriften`, `beteiligung_qualifiziert`, `krypto`.

Bekannte Dialogrouten: `securities-detail`, `securities-search`, `load-tax-statement`,
`tax-statement-detail-bank-account`, `tax-statement-detail-security`,
`tax-statement-detail-security-ictax`, `tax-statement-detail-liability`,
`tax-statement-detail-lump-sum-tax-credit`, `securities-bfp-calculation`,
`da-1-detail`, `da1-search`

### Angaben zum DA-1 Formular · `tax-assistant/securities/da1-data`

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Wohnsitz am 01.01.2025 | `da1DomicileBeginningOfYear:Input` | Text | max. 20 | — |
| Wohnsitz am 31.12.2025 | `da1DomicileEndOfYear:Input` | Text | max. 20 | — |
| Erträge aus Gemeinschaftsdepot/Erbanfall? | `da1EarningsCommunity:RadioJa` | Auswahl | true=Ja / false=Nein | — |
| US-Erträge im Antrag enthalten? | `da1CitizenshipUSA:RadioJa` | Auswahl | true=Ja / false=Nein | — |
| Kontoangaben aus Persönliches übernehmen | `da1BankAccountIsFromWV:Checkbox` | Häkchen | | — |
| IBAN-Nr. | `da1BankAccountIbanNumber:Input` | Text | max. 42 | — |
| Konto lautend auf | `da1BankAccountAccountOwner:Input` | Text | max. 50 | — |

---

## Vermögen

### Bewegliches Vermögen · `tax-assistant/assets/asset-movable-property`

| Feld | technischer Name | Typ | Format/Grenze | unsere Position |
|---|---|---|---|---|
| Betrag (Bargeld, Gold, Edelmetalle) | `assetMovablePropertyCashValueFiscalValue:Input` | Betrag | max. 120 | **`bargeld`** |
| Datum | `inheritanceEtcDetailDateWR:inheritanceEtcDetail:<i>:DatePicker` | Datum | | `uebriges_vermoegen` |
| Genaue Bezeichnung | `…DescriptionWR:…:<i>:Input` | Text | max. 68 | `uebriges_vermoegen` |
| Vermögen Betrag | `…AssetWR:…:<i>:Input` | Betrag | max. 120 | `uebriges_vermoegen` |
| Einkommen Betrag | `…RevenueWR:…:<i>:Input` | Betrag | max. 120 | `uebrige_einkuenfte` |
| Nähere Bezeichnung | `assetMovablePropertyFreeText:Input` | Text | max. 60 | `uebriges_vermoegen` |
| Betrag | `assetMovablePropertyFreeTextAmountFiscalValue:Input` | Betrag | max. 120 | `uebriges_vermoegen` |

**Krypto gehört nicht hierher**, sondern ins Wertschriftenverzeichnis.

### Lebens- und Rentenversicherungen · `tax-assistant/assets/asset-movable-property-life-insurances`
Ja/Nein-Schalter. Alle Felder → **`lebensversicherung`**

| Feld | technischer Name | Typ | Format/Grenze |
|---|---|---|---|
| Versicherungsgesellschaft | `assetMovablePropertyLifeInsurancesCompanyWR:…:<i>:Input` | Text | max. 40 |
| Abschlussjahr | `…FixtureYearWR:…:<i>:Input` | Zahl | max. 120 |
| Ablaufjahr | `…ExpirationYearWR:…:<i>:Input` | Zahl | max. 120 |
| Steuerwert (Rückkaufswert) | `…FiscalValueWR:…:<i>:Input` | Betrag | max. 120 |

### Motorfahrzeuge · `tax-assistant/assets/asset-movable-property-vehicles`
Alle Felder → **`fahrzeuge`**

| Feld | technischer Name | Typ | Format/Grenze |
|---|---|---|---|
| Bezeichnung | `assetMovablePropertyVehicleDetailDescriptionWR:…:<i>:Input` | Text | max. 34 |
| Kaufjahr | `…YearWR:…:<i>:Input` | Zahl | max. 120 |
| Kaufpreis | `…PurchasePriceWR:…:<i>:Input` | Betrag | max. 120 |
| Steuerwert (Zeitwert) | `…FiscalValueWR:…:<i>:Input` | Betrag | max. 120 |

### Liegenschaften · `tax-assistant/assets/properties`
Dieselbe Liste wie unter Einkünfte. **Keine Einzelfelder**, Detaildialog nicht geöffnet.
Positionen: `liegenschaften`, `liegenschaft_ertrag`, `liegenschaftsunterhalt`

⚠ Der Entscheid **Unterhalt effektiv ODER pauschal** liegt im Objektdialog und gehört Sascha.

### Schulden · `tax-assistant/assets/asset-private-liabilities`
**Identisch mit Abzüge > Schuldzinsen** — nur einmal erfassen. Siehe dortige Tabelle.

---

## Abschluss

| Maske | Route | Felder | unsere Position |
|---|---|---|---|
| Steuerausscheidung | `tax-assistant/finish/tax-separation` | keine im Grundzustand | — |
| Bemerkungen | `tax-assistant/finish/commentary` | `commentary:Input` (Textfeld, max. 10 000) | — |
| Belege | `tax-assistant/finish/attachments` | `attachment_file9000:revenue<i>` · `:deductions<i>` · `:securities<i>` · `:assets<i>` (Datei, readonly) | — (Beleg-Upload) |
| Einreichen | `tax-assistant/finish/submit` | keine | — |

> **Einreichen:** nur angesehen, nichts gedrückt. Der Knopf
> «Steuererklärung übermitteln» ist ausschliesslich Sascha vorbehalten.

---

## Katalogpositionen ohne Zielfeld

| Position | Grund |
|---|---|
| `formular` | Zugangscode/Hauptformular — das ist der Portalzugang selbst, kein Feld |
| `vorjahr` | Vorjahresveranlagung — kein Erfassungsfeld; das Portal bietet dafür nur «Datenimport» |
| `kinderbetreuung` | In keiner erreichbaren Maske gefunden; vermutlich Dialog `external-care` an der Kinderzeile |
| `arbeitsnotiz` | Arbeitspapier, keine Beilage |
| `eigene_berechnung` | Arbeitspapier, keine Beilage |
| `_aussortiert` | Nicht zur Steuererklärung |

## Was nicht aufgenommen werden konnte

| Was | Grund | Betroffene Positionen |
|---|---|---|
| Wertschriften-Zeilendialog | Nur über Zeile anlegen / Zeile bearbeiten erreichbar | `wertschriften`, `beteiligung_qualifiziert`, `krypto` |
| Liegenschaften-Objektdialog | Nur über Zeile anlegen / Zeile bearbeiten erreichbar | `liegenschaft_ertrag`, `liegenschaftsunterhalt`, `liegenschaften` |
| Zeilen der Liste «Beiträge an AHV, IV und 2. Säule» | Liste leer, Spalten erst nach Zeilenanlage sichtbar | `einkauf_pk`, `ahv_beitraege` |
| Kinderbetreuungskosten | In Maske «Kinder» nicht sichtbar | `kinderbetreuung` |
| Zeilen der Schenkungs-/Erbschaftslisten | Listen leer | — |
| Felder hinter Ja/Nein-Schaltern | Umschalten wäre eine Eingabe gewesen (viele Felder waren trotzdem im DOM lesbar und sind erfasst) | — |
| Personen-Ansicht P2 | Personen-Reiter nicht umgeschaltet; dass es zu jedem P1-Feld ein P2-Gegenstück gibt, ist im Programmcode der App belegt | — |
| Alternative «Navigation über Formulare» | Direkter Routenaufruf wird umgeleitet; danach hing das Dashboard im Ladezustand | — |
| Zahlenformat der Betragsfelder | Nur durch Eingabe feststellbar | — |

## Offene Punkte für Sascha

1. **Doppelkandidat `rente_saeule3`:** Kapitalleistungen (Persönliches) **oder**
   Rente/Pension (Einkünfte > Renten und Versicherungen)?
2. **`einkauf_pk` und `ahv_beitraege`** zielen beide auf dieselbe Zeilenliste
   «Beiträge an die AHV, IV und 2. Säule» — welche Zeilenart trägt welche Position?
3. **`alimente_erhalten` und `alimente_bezahlt`** erscheinen in den Übersichtsmasken nur
   als Rechenfelder (readonly). Der beschreibbare Ort ist ein Dialog
   (`deduction-payment-alimony`) bzw. die Kinderzeile — nicht aufgenommen.
4. **Das Schuldenverzeichnis kennt keine Objektzuordnung** der Hypothek. Die
   Katalog-Dimension `objekt` bei `schulden` hat im Portal kein Gegenstück.
5. **Betragsformat** (Rappen? Apostroph?) beim ersten echten Feld testen und hier nachtragen.
6. **Portalzustand — erledigt, aber merkenswert:** Zwischenzeitlich hing das
   Dashboard im Ladezustand «laden…». Behoben durch erneuten Einstieg über die
   Portal-Startseite → «Steuererklärung weiterbearbeiten». Danach lief alles wieder
   normal, der Dashboard-Stand war unverändert.
   Auslöser war vermutlich ein direkt gesetzter Routen-Hash.
   **Merke: im Portal nur über die Oberfläche navigieren, nicht über die Adresszeile.**
   Der Fehler `ReferenceError: ReactDOM is not defined` stammt aus dem
   Vendor-Bundle des Portals und tritt auch beim normalen Laden auf — nicht von uns verursacht.
