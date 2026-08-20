# Feldaufnahme ZHprivateTax 2024 (Kanton Zürich)

Aufgenommen am **2026-08-20** in der Offizielle Demo des Kantons Zürich (#/demo), ohne Anmeldung, ohne Mandantendaten.
Portalstand: **1.19.0 / FK-Version 2024-d55fc-790e0** · Basis-URL: `https://zhp.services.zh.ch/app/ZHprivateTax2024/`

> **Keine Mandantendaten.** Festgehalten ist ausschliesslich die Struktur des Portals.
> Maschinenlesbare Fassung: `docs/portal-felder-zh-2024.json`.

---

## 1. Wie das Portal tickt (vor dem ersten Feld lesen)

- **technik** — Angular-Einseiten-Anwendung. Version im Fussbereich: 1.19.0 / FK-Version 2024-d55fc-790e0.
- **sitzung** — Die Route enthält nach #/ die Sitzungskennung: in der Demo «demo», sonst der Zugangscode (z. B. #/ABCD-EF12-GH34/tax-assistant/…). In dieser Aufnahme steht dafür <sitzung>.
- **hash_navigation** — Direktes Setzen von location.hash funktioniert NICHT – ein Router-Wächter springt zurück. Navigiert wird über die Seitenleiste (li.level-1 / li.level-2) bzw. über die Knöpfe in der Maske.
- **feld_id** — Jedes Feld trägt eine id nach dem Muster <feldname>[:<liste>::<index>]…:<Art>. Die Art am Schluss ist Input, Select, Checkbox, DatePicker, RadioJa/RadioNein/Radio<Text>. Stabiler Selektor: [id="…"] – wegen des Doppelpunkts NICHT als #id verwenden (bzw. CSS.escape benutzen).
- **ausnahmen** — Bekannte Abweichungen: «OrtP1» (Personalien) ohne Doppelpunkt-Konvention; die beiden «Art»-Auswahlfelder bei Krankheits-/Unfallkosten und bei behinderungsbedingten Kosten tragen die id wörtlich «undefined» und sind nur über die Reihenfolge der button.atm-form_input__input--trigger ansprechbar; Schieber tragen den Beschriftungstext in der id (slider_<feld><Beschriftung>).
- **auswahlfeld** — Auswahlfelder sind KEINE <select>-Elemente, sondern <button id="…:Select"> mit einer Liste aus li.atm-list__item. Setzen daher über Klick auf den Knopf und dann auf den Listeneintrag, nicht über form_input.
- **betrag** — Beträge in GANZEN FRANKEN. Geprüft: Eingabe «12345.49» wird als «12'345» angezeigt, Eingabe «1234.55» als «1'235» – das Portal rundet die Rappen weg und setzt selbst den Tausender-Apostroph. Vor dem Feld steht die Währungsmarke «CHF». Bestätigt wird das vom Portal selbst: die Betragsspalten im Formulareditor sind mit «CHF ohne Rappen» überschrieben. Also: OHNE Rappen und OHNE Apostroph eintippen, das Portal formatiert.
- **zeilenlisten** — Zwei Bauarten. (a) Knopf «… hinzufügen» / «Weitere Zeile hinzufügen» erzeugt eine Zeile mit laufendem Index (…::0:, ::1:, …). (b) Formulare mit Endlosliste haben IMMER eine leere Schlusszeile, deren Feldnamen auf «WR» enden; sobald dort etwas eingetippt wird, wird sie zur echten Zeile und darunter erscheint eine neue WR-Zeile. WICHTIG beim Erfassen: nach jeder Eingabe die ids neu lesen, sie ändern sich.
- **vorjahresdaten** — Felder mit Vorjahreswert sind schreibgeschützt (readonly + disabled), bis die Vorjahresdaten bestätigt wurden. Knöpfe je Maske: «Alle bestätigen» / «Alle löschen», je Block «Bestätigen» / «Ändern». Ohne diesen Schritt schlägt jede Eingabe stillschweigend fehl.
- **rechenfelder** — Schreibgeschützte Betragsfelder (RO/DIS) sind Rechenfelder des Portals. Viele davon haben rechts einen Stift-Knopf (button.atm-form_input__functionality), der den Erfassungsdialog öffnet.
- **hilfetexte** — Der Schalter «Wegleitung» oben rechts blendet je Maske Hilfetexte ein; jedes Feld hat zusätzlich ein «i» mit erweitertem Hilfetext. Für die Aufnahme irrelevant, für Rückfragen nützlich.

---

## 2. Alle Masken des Assistenten

| # | Gruppe | Maske | Route | Felder | Zeilenlisten |
|---|---|---|---|---|---|
| 1 | Start | Übersicht / Dashboard | `#/<sitzung>/home` | 0 | 0 Listen / 0 Spalten |
| 2 | Persönliches | Steuerpflichtige Personen | `#/<sitzung>/tax-assistant/personal/personal-data` | 25 | 0 Listen / 0 Spalten |
| 3 | Persönliches | Kinder | `#/<sitzung>/tax-assistant/personal/children` | 0 | 2 Listen / 16 Spalten |
| 4 | Persönliches | Kinder › Unterhalt / Sorgerecht (Dialog) | `#/<sitzung>/dialogs/children/received-alimony` | 14 | 1 Listen / 2 Spalten |
| 5 | Persönliches | Kinder › Bezahlter Unterhalt (Dialog) | `#/<sitzung>/dialogs/children/paid-alimony` | 7 | 0 Listen / 0 Spalten |
| 6 | Persönliches | Unterstützte Personen | `#/<sitzung>/tax-assistant/personal/supported-person` | 0 | 2 Listen / 9 Spalten |
| 7 | Persönliches | Vertreter | `#/<sitzung>/tax-assistant/personal/representative-person` | 9 | 0 Listen / 0 Spalten |
| 8 | Persönliches | Erhaltene Schenkungen / Erbschaften | `#/<sitzung>/tax-assistant/personal/benefit-payment-received` | 0 | 1 Listen / 11 Spalten |
| 9 | Persönliches | Ausgerichtete Schenkungen / Erbvorbezüge | `#/<sitzung>/tax-assistant/personal/benefit-paidout` | 0 | 1 Listen / 11 Spalten |
| 10 | Persönliches | Kapitalleistungen | `#/<sitzung>/tax-assistant/personal/benefit-payment` | 0 | 1 Listen / 3 Spalten |
| 11 | Persönliches | Bankverbindung für Rückerstattungen | `#/<sitzung>/tax-assistant/personal/account-data` | 2 | 0 Listen / 0 Spalten |
| 12 | Einkünfte | Erwerb | `#/<sitzung>/tax-assistant/revenue/employed` | 9 | 2 Listen / 8 Spalten |
| 13 | Einkünfte | Renten und Versicherungen | `#/<sitzung>/tax-assistant/revenue/insurance` | 4 | 1 Listen / 4 Spalten |
| 14 | Einkünfte | Übrige Einkünfte | `#/<sitzung>/tax-assistant/revenue/rest` | 5 | 2 Listen / 6 Spalten |
| 15 | Einkünfte | Übrige Einkünfte › Erhaltene Unterhaltsbeiträge (Dialog) | `#/<sitzung>/dialogs/revenue/revenue-rest-revenue-alimony` | 5 | 1 Listen / 2 Spalten |
| 16 | Einkünfte / Vermögen | Liegenschaften (Liegenschaftenverzeichnis) | `#/<sitzung>/tax-assistant/revenue/properties  ==  #/<sitzung>/tax-assistant/assets/properties` | 0 | 1 Listen / 1 Spalten |
| 17 | Einkünfte / Vermögen | Liegenschaften Detailerfassung (Beiblatt je Objekt) | `#/<sitzung>/dialogs/assets/property-detail` | 27 | 2 Listen / 12 Spalten |
| 18 | Abzüge | Berufsbedingte Fahrkosten | `#/<sitzung>/tax-assistant/deductions/job-expenses-motorvehicle` | 9 | 1 Listen / 5 Spalten |
| 19 | Abzüge | Weitere Berufsauslagen | `#/<sitzung>/tax-assistant/deductions/job-expenses-other-expenses` | 7 | 2 Listen / 6 Spalten |
| 20 | Abzüge | Berufsorientierte Aus- und Weiterbildung | `#/<sitzung>/tax-assistant/deductions/job-expenses-education` | 1 | 1 Listen / 3 Spalten |
| 21 | Abzüge / Vermögen | Schuldzinsen = Schulden (Schuldenverzeichnis) | `#/<sitzung>/tax-assistant/deductions/deduction-private-liabilities  ==  #/<sitzung>/tax-assistant/assets/asset-private-liabilities` | 0 | 1 Listen / 3 Spalten |
| 22 | Abzüge | Unterhalt und Renten | `#/<sitzung>/tax-assistant/deductions/deduction-payment` | 3 | 0 Listen / 0 Spalten |
| 23 | Abzüge | Unterhalt und Renten › Bezahlte Unterhaltsbeiträge (Dialog) | `#/<sitzung>/dialogs/deductions/deduction-payment-alimony` | 5 | 1 Listen / 2 Spalten |
| 24 | Abzüge | Säule 3a und weitere Vorsorgearten | `#/<sitzung>/tax-assistant/deductions/provision` | 1 | 1 Listen / 2 Spalten |
| 25 | Abzüge | Versicherungsprämien | `#/<sitzung>/tax-assistant/deductions/insurance-premiums` | 6 | 0 Listen / 0 Spalten |
| 26 | Abzüge | Krankheits- und Unfallkosten | `#/<sitzung>/tax-assistant/deductions/disease-accident-expenses` | 7 | 1 Listen / 3 Spalten |
| 27 | Abzüge | Behinderungsbedingte Kosten | `#/<sitzung>/tax-assistant/deductions/handicap-expenses` | 7 | 1 Listen / 4 Spalten |
| 28 | Abzüge | Gemeinnützige Zuwendungen | `#/<sitzung>/tax-assistant/deductions/revenue-calculation-deduction-charity-detail` | 0 | 1 Listen / 3 Spalten |
| 29 | Abzüge | Weitere Abzüge | `#/<sitzung>/tax-assistant/deductions/deduction-further-deduction` | 0 | 3 Listen / 9 Spalten |
| 30 | Wertschriften | Wertschriftenverzeichnis | `#/<sitzung>/tax-assistant/securities/security-list` | 0 | 1 Listen / 5 Spalten |
| 31 | Wertschriften | Wertschriftenzeile – Art «Bankkonto» / «Steuerauszug/Depot» (Dialog) | `#/<sitzung>/dialogs/securities/securities-detail` | 18 | 0 Listen / 0 Spalten |
| 32 | Wertschriften | Wertschriftenzeile – Art «Wertschrift und Guthaben» (Dialog) | `#/<sitzung>/dialogs/securities/securities-detail (davor dialogs/securities/securities-search)` | 21 | 2 Listen / 8 Spalten |
| 33 | Wertschriften | Wertschriftenzeile – Art «Wertschrift mit ausländischer Quellensteuer (DA-1)» (Dialog) | `#/<sitzung>/dialogs/securities/da-1-detail (davor dialogs/securities/da1-search)` | 15 | 1 Listen / 5 Spalten |
| 34 | Wertschriften | eSteuerauszug importieren (Dialog) | `#/<sitzung>/dialogs/securities/load-tax-statement` | 1 | 0 Listen / 0 Spalten |
| 35 | Wertschriften | Angaben zum DA-1 Formular | `#/<sitzung>/tax-assistant/securities/da1-data` | 9 | 0 Listen / 0 Spalten |
| 36 | Vermögen | Bewegliches Vermögen | `#/<sitzung>/tax-assistant/assets/asset-movable-property` | 3 | 1 Listen / 4 Spalten |
| 37 | Vermögen | Lebens- und Rentenversicherungen | `#/<sitzung>/tax-assistant/assets/asset-movable-property-life-insurances` | 0 | 1 Listen / 4 Spalten |
| 38 | Vermögen | Motorfahrzeuge | `#/<sitzung>/tax-assistant/assets/asset-movable-property-vehicles` | 0 | 1 Listen / 4 Spalten |
| 39 | Abschluss | Steuerausscheidung | `#/<sitzung>/tax-assistant/finish/tax-separation` | 0 | 0 Listen / 0 Spalten |
| 40 | Abschluss | Bemerkungen | `#/<sitzung>/tax-assistant/finish/commentary` | 1 | 0 Listen / 0 Spalten |
| 41 | Abschluss | Belege | `#/<sitzung>/tax-assistant/finish/attachments` | 4 | 0 Listen / 0 Spalten |
| 42 | Abschluss | Einreichen *(nicht geöffnet)* | `#/<sitzung>/tax-assistant/finish/submit` | 0 | 0 Listen / 0 Spalten |

---

## 3. Feldkarte je Maske

### Start › Übersicht / Dashboard

**Route:** `#/<sitzung>/home`  
**Navigation:** Einstiegsseite; aus jeder Maske über «Zur Übersicht» in der Seitenleiste  

> Reine Übersicht mit Kacheln je Verzeichnis, Statusfarben (rot = fehlende Angaben, blau = unbestätigte Vorjahresdaten) und den Knöpfen «Daten importieren» und «Provisorische Steuerberechnung ausführen». Unten der Block «Hilfsmittel»: Formulareditor starten, Vorjahresdaten erneut importieren, Neuen Zugangscode erstellen, Steuererklärung zurücksetzen, Steuererklärung löschen. KEINE Erfassungsfelder.

_Keine Erfassungsfelder._


### Persönliches › Steuerpflichtige Personen

**Route:** `#/<sitzung>/tax-assistant/personal/personal-data`  
**Navigation:** Seitenleiste › Persönliches › Steuerpflichtige Personen  
**Registerkarten:** Person 1 (Name der pflichtigen Person) · Person 2 (Ehefrau Partner/Partnerin 2)  

> Alle Felder existieren doppelt: Suffix P1 / P2. Person 2 hat KEINE eigene Adresse (gemeinsamer Haushalt). Zivilstand nur bei P1.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Vorname | Personalien | `personDataFirstNameP1:Input` | Text | max. 60 Z. | — | — | — |
| Name | Personalien | `personDataOfficialNameP1:Input` | Text | max. 60 Z. | — | — | — |
| Geburtsdatum | Personalien | `personDataDateOfBirthP1:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Strasse | Personalien | `personDataStreetP1:Input` | Text | max. 60 Z. | — | — | — |
| Nummer | Personalien | `personDataHouseNumberP1:Input` | Text | max. 12 Z. | — | — | — |
| Zusatz | Personalien | `personDataAddressLine1P1:Input` | Text | max. 60 Z. | — | — | — |
| PLZ | Personalien | `personDataZipP1:Input` | Text | max. 15 Z. | — | — | — |
| Ort | Personalien | `OrtP1` | Text | max. 40 Z.; AUSNAHME: id folgt NICHT der Doppelpunkt-Konvention (kein «:Input»). Selektor [id="OrtP1"]. | — | — | — |
| Telefon | Personalien | `personDataPhoneNumberP1:Input` | Text | max. 20 Z. | — | — | — |
| E-Mail | Personalien | `personDataEmailP1:Input` | Text | max. 60 Z. | — | — | — |
| Zivilstand | Personalien | `personDataMaritalStatusTaxP1:Select` | Auswahl | Auswahl: ledig (single) · verheiratet (married) · verwitwet (widowed) · geschieden (divorced) · getrennt (separated) · eingetragene Partnerschaft (partnered) · aufgelöste Partnerschaft (unpartnered); Eigenbau-Dropdown: <button id="…:Select"> öffnet eine Liste <li class="atm-list__item">. | — | — | — |
| Konfession | Personalien | `personDataReligionP1:Select` | Auswahl | Auswahl: reformiert (111) · römisch-katholisch (121) · christ-katholisch (122) · andere (811) · keine (711); In der Demo gesperrt (disabled) – kommt aus dem Register. | — | — | — |
| Beruf | Berufliche Angaben | `personDataJobP1:Input` | Text | max. 60 Z. | — | — | — |
| Ordentliche PK-Beiträge geleistet? – Ja | Berufliche Angaben | `personDataPaymentPensionP1:RadioJa` | Radio | — | ja | — | — |
| Ordentliche PK-Beiträge geleistet? – Nein | Berufliche Angaben | `personDataPaymentPensionP1:RadioNein` | Radio | — | ja | — | — |
| Gemeinde | Weitere Angaben | `personDataTaxMunicipality:Input` | Text | Vorgegeben, nicht änderbar. | — | ja | — |
| Vorname (Person 2) | Personalien | `personDataFirstNameP2:Input` | Text | max. 60 Z. | ja | — | — |
| Name (Person 2) | Personalien | `personDataOfficialNameP2:Input` | Text | max. 60 Z. | ja | — | — |
| Geburtsdatum (Person 2) | Personalien | `personDataDateOfBirthP2:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Telefon (Person 2) | Personalien | `personDataPhoneNumberP2:Input` | Text | max. 20 Z. | — | — | — |
| E-Mail (Person 2) | Personalien | `personDataEmailP2:Input` | Text | max. 60 Z. | — | — | — |
| Konfession (Person 2) | Personalien | `personDataReligionP2:Select` | Auswahl | Optionen wie P1. | — | — | — |
| Beruf (Person 2) | Berufliche Angaben | `personDataJobP2:Input` | Text | max. 60 Z. | — | — | — |
| PK-Beiträge Person 2 – Ja | Berufliche Angaben | `personDataPaymentPensionP2:RadioJa` | Radio | — | ja | — | — |
| PK-Beiträge Person 2 – Nein | Berufliche Angaben | `personDataPaymentPensionP2:RadioNein` | Radio | — | ja | — | — |


### Persönliches › Kinder

**Route:** `#/<sitzung>/tax-assistant/personal/children`  
**Navigation:** Seitenleiste › Persönliches › Kinder  

> Zwei getrennte Listen: «Im Haushalt» (intChild) und «Ausserhalb des Haushalts» (extChild). Sozialabzüge werden daraus automatisch berechnet.

#### Zeilenliste: Kind im Haushalt

**So entsteht eine Zeile:** «Kind im Haushalt hinzufügen»  
**id-Muster:** `<feld>:intChild::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Gemeinsames Kind | `intChildIsCommonChild:intChild::0:Checkbox` | Häkchen | — | — | — | — |
| Vorname | `intChildFirstName:intChild::0:Input` | Text | max. 30 Z. | ja | — | — |
| Name | `intChildOfficialName:intChild::0:Input` | Text | max. 30 Z. | ja | — | — |
| Geburtsdatum | `intChildDateOfBirth:intChild::0:DatePicker` | Datum | TT.MM.JJJJ | ja | — | — |
| Schule oder Lehrfirma (wenn in Ausbildung) | `intChildSchoolOrCompany:intChild::0:Input` | Text | max. 34 Z. | — | — | — |
| Voraussichtlich bis (Jahr) | `intChildCorrectTo:intChild::0:Input` | Zahl | — | — | — | — |
| Erhaltene Unterhaltsbeiträge / Sorgerecht | `intChildReceivedAlimonyTotal2:intChild::0:Input` | Betrag | ganze Franken; Rechenfeld. Stift-Knopf öffnet Dialog dialogs/children/received-alimony. | — | ja | — |
| Fremdbetreuungskosten | `intChildExternalCareTotal2:intChild::0:Input` | Betrag | ganze Franken; Rechenfeld und EINZIGER Einstieg für die Kinderbetreuungskosten. Der Stift-Knopf öffnet den Dialog dialogs/children/external-care mit der Aufstellung – dieser Dialog wurde in der Aufnahme NICHT geöffnet, die Spalten sind daher offen. Total läuft in Ziff. 16.6 / Code 376. | — | ja | `kinderbetreuung` |

#### Zeilenliste: Kind ausserhalb Haushalt

**So entsteht eine Zeile:** «Kind ausserhalb Haushalt hinzufügen»  
**id-Muster:** `<feld>:extChild::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Gemeinsames Kind | `extChildIsCommonChild:extChild::0:Checkbox` | Häkchen | — | — | — | — |
| Vorname | `extChildFirstName:extChild::0:Input` | Text | max. 30 Z. | ja | — | — |
| Name | `extChildOfficialName:extChild::0:Input` | Text | max. 30 Z. | ja | — | — |
| Geburtsdatum | `extChildDateOfBirth:extChild::0:DatePicker` | Datum | TT.MM.JJJJ | ja | — | — |
| Adresse | `extChildAddressLine1:extChild::0:Input` | Text | max. 60 Z. | ja | — | — |
| Schule oder Lehrfirma | `extChildSchoolOrCompany:extChild::0:Input` | Text | max. 34 Z. | — | — | — |
| Voraussichtlich bis (Jahr) | `extChildCorrectTo:extChild::0:Input` | Zahl | — | — | — | — |
| Unterhalt/Sorgerecht | `extChildPaidAlimonyTotal:extChild::0:Input` | Betrag | ganze Franken; Rechenfeld. Stift öffnet Dialog dialogs/children/paid-alimony. | — | ja | — |


### Persönliches › Kinder › Unterhalt / Sorgerecht (Dialog)

**Route:** `#/<sitzung>/dialogs/children/received-alimony`  
**Navigation:** Kinder › Zeile «Im Haushalt» › Stift-Knopf bei «Erhaltene Unterhaltsbeiträge / Sorgerecht»  

> Zwei Registerkarten: «Unterhalt / Sorgerecht» und «Erhaltene Unterhaltsbeiträge». Die Empfänger-/Zahlerfelder sind gesperrt, solange «Gemeinsames Kind beider Ehepartner» angehakt ist. Die Registerkarte «Erhaltene Unterhaltsbeiträge» erscheint erst, wenn beim Kind ein Geburtsdatum steht (minderjährig) und «Erhalten Sie … Unterhaltsbeiträge?» = Ja.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Gemeinsames Kind beider Ehepartner | Unterhalt | `intChildIsCommonChild:intChild::0:Checkbox` | Häkchen | — | — | — | — |
| Zahler – Vorname | Zahler der Unterhaltsbeiträge | `intChildReceivedAlimonyPayerFirstName:intChild::0:Input` | Text | max. 60 Z. | — | — | — |
| Zahler – Name | Zahler der Unterhaltsbeiträge | `intChildReceivedAlimonyPayerOfficialName:intChild::0:Input` | Text | max. 60 Z. | — | — | — |
| Zahler – AHVN13 | Zahler der Unterhaltsbeiträge | `intChildReceivedAlimonyPayerVn:intChild::0:Input` | Text | max. 20 Z.; AHV-Nummer eines Dritten – nur aus Beleg, nie als Anmeldedatum. | — | — | — |
| Zahler – Adresse | Zahler der Unterhaltsbeiträge | `intChildReceivedAlimonyPayerAddress:intChild::0:Input` | Text | max. 60 Z. | — | — | — |
| Zahler – PLZ | Zahler der Unterhaltsbeiträge | `intChildReceivedAlimonyPayerZip:intChild::0:Input` | Text | max. 10 Z. | — | — | — |
| Zahler – Wohnort | Zahler der Unterhaltsbeiträge | `intChildReceivedAlimonyPayerTown:intChild::0:Input` | Text | max. 60 Z. | — | — | — |
| Wer hat das Sorgerecht für das Kind? | Sorgerecht und Obhut | `intChildCustodyHolder:intChild::0:Select` | Auswahl | Auswahl: Sorgerecht gemeinsam mit anderem Elternteil (1) · Sorgerecht alleinig (0) · Sorgerecht alleinig beim anderen Elternteil (2) | — | — | — |
| Alternierende Obhut – Ja | Sorgerecht und Obhut | `intChildAlternatingCustody:intChild::0:RadioJa` | Radio | — | ja | — | — |
| Alternierende Obhut – Nein | Sorgerecht und Obhut | `intChildAlternatingCustody:intChild::0:RadioNein` | Radio | — | ja | — | — |
| Erhalten Sie Unterhaltsbeiträge? – Ja | Sorgerecht und Obhut | `intChildHasReceivedAlimony:intChild::0:RadioJa` | Radio | — | ja | — | — |
| Erhalten Sie Unterhaltsbeiträge? – Nein | Sorgerecht und Obhut | `intChildHasReceivedAlimony:intChild::0:RadioNein` | Radio | — | ja | — | — |
| Lebensunterhalt zur Hauptsache finanziert? – Ja | Finanzierung Lebensunterhalt | `intChildMainSupportP1:intChild::0:RadioJa` | Radio | — | ja | — | — |
| Lebensunterhalt zur Hauptsache finanziert? – Nein | Finanzierung Lebensunterhalt | `intChildMainSupportP1:intChild::0:RadioNein` | Radio | — | ja | — | — |

#### Zeilenliste: Aufstellung Unterhaltsbeiträge

**So entsteht eine Zeile:** KEIN Knopf – die letzte, leere Zeile trägt das Kürzel «WR» im Namen; sobald man dort etwas eintippt, wird sie zur echten Zeile und eine neue WR-Zeile erscheint.  
**id-Muster:** `leere Zeile: <feld>WR:intChildReceivedAlimonyDetail::intChild::<kindIdx>:<Art> / gefüllte Zeile: <feld>:intChild::<kindIdx>:intChildReceivedAlimonyDetail::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Datum | `intChildReceivedAlimonyDetailDateWR:intChildReceivedAlimonyDetail::intChild::0:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Betrag | `intChildReceivedAlimonyDetailAmountImmaturityWR:intChildReceivedAlimonyDetail::intChild::0:Input` | Betrag | ganze Franken | — | — | `alimente_erhalten` |


### Persönliches › Kinder › Bezahlter Unterhalt (Dialog)

**Route:** `#/<sitzung>/dialogs/children/paid-alimony`  
**Navigation:** Kinder › Zeile «Ausserhalb des Haushalts» › Stift-Knopf bei «Unterhalt/Sorgerecht»  

> Aufbau spiegelbildlich zum Dialog «Erhaltene Unterhaltsbeiträge»; Aufstellung analog über die WR-Zeile.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Gemeinsames Kind beider Ehepartner | Unterhalt | `extChildIsCommonChild:extChild::0:Checkbox` | Häkchen | — | — | — | — |
| Empfänger – Vorname | Empfänger der Unterhaltsbeiträge | `extChildPaidAlimonyReceiverFirstName:extChild::0:Input` | Text | max. 60 Z. | — | — | — |
| Empfänger – Name | Empfänger der Unterhaltsbeiträge | `extChildPaidAlimonyReceiverOfficialName:extChild::0:Input` | Text | max. 60 Z. | — | — | — |
| Empfänger – AHVN13 | Empfänger der Unterhaltsbeiträge | `extChildPaidAlimonyReceiverVn:extChild::0:Input` | Text | max. 20 Z. | — | — | — |
| Empfänger – Adresse | Empfänger der Unterhaltsbeiträge | `extChildPaidAlimonyReceiverAddress:extChild::0:Input` | Text | max. 60 Z. | — | — | — |
| Empfänger – PLZ | Empfänger der Unterhaltsbeiträge | `extChildPaidAlimonyReceiverZip:extChild::0:Input` | Text | max. 15 Z. | — | — | — |
| Empfänger – Wohnort | Empfänger der Unterhaltsbeiträge | `extChildPaidAlimonyReceiverTown:extChild::0:Input` | Text | max. 60 Z. | — | — | — |


### Persönliches › Unterstützte Personen

**Route:** `#/<sitzung>/tax-assistant/personal/supported-person`  
**Navigation:** Seitenleiste › Persönliches › Unterstützte Personen  

#### Zeilenliste: Unterstützte Person im Haushalt

**So entsteht eine Zeile:** «Unterstützte Person im Haushalt hinzufügen»  
**id-Muster:** `<feld>:intSupportedPerson::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Vorname | `intSupportedPersonFirstName:intSupportedPerson::0:Input` | Text | max. 22 Z. | — | — | — |
| Name | `intSupportedPersonOfficialName:intSupportedPerson::0:Input` | Text | max. 34 Z. | — | — | — |
| Geburtsjahr | `intSupportedPersonYearOfBirth:intSupportedPerson::0:Input` | Zahl | — | — | — | — |
| Unterstützungsbetrag pro Jahr | `intSupportedPersonSupportAmount2:intSupportedPerson::0:Input` | Betrag | ganze Franken; Rechenfeld; Stift öffnet Dialog dialogs/… internal-detail mit der Aufstellung. | — | ja | — |

#### Zeilenliste: Unterstützte Person ausserhalb Haushalt

**So entsteht eine Zeile:** «Unterstützte Person ausserhalb Haushalt hinzufügen»  
**id-Muster:** `<feld>:extSupportedPerson::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Vorname | `extSupportedPersonFirstName:extSupportedPerson::0:Input` | Text | max. 22 Z. | — | — | — |
| Name | `extSupportedPersonOfficialName:extSupportedPerson::0:Input` | Text | max. 34 Z. | — | — | — |
| Geburtsjahr | `extSupportedPersonYearOfBirth:extSupportedPerson::0:Input` | Zahl | — | — | — | — |
| Adresse | `extSupportedPersonAddressLine1:extSupportedPerson::0:Input` | Text | max. 50 Z. | — | — | — |
| Unterstützungsbetrag pro Jahr | `extSupportedPersonSupportAmount2:extSupportedPerson::0:Input` | Betrag | ganze Franken; Rechenfeld; Stift öffnet Dialog external-detail. | — | ja | — |


### Persönliches › Vertreter

**Route:** `#/<sitzung>/tax-assistant/personal/representative-person`  
**Navigation:** Seitenleiste › Persönliches › Vertreter  

> Hier steht die Treuhandvertretung (Artis). Treuhänder-ID ist keine Anmeldung, sondern eine Registernummer.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Treuhänder-ID | Vertreter | `representativePersonThId:Input` | Text | max. 20 Z. | — | — | `vollmacht` |
| Firma | Vertreter | `representativePersonOrganisation:Input` | Text | max. 60 Z. | — | — | `vollmacht` |
| Vorname | Vertreter | `representativePersonFirstName:Input` | Text | max. 60 Z. | — | — | `vollmacht` |
| Name | Vertreter | `representativePersonOfficialName:Input` | Text | max. 60 Z. | — | — | `vollmacht` |
| Strasse | Vertreter | `representativePersonStreet:Input` | Text | max. 60 Z. | — | — | `vollmacht` |
| Nummer | Vertreter | `representativePersonHouseNumber:Input` | Text | max. 12 Z. | — | — | `vollmacht` |
| PLZ | Vertreter | `representativePersonZip:Input` | Text | max. 15 Z. | — | — | `vollmacht` |
| Ort | Vertreter | `representativePersonTown:Input` | Text | max. 40 Z. | — | — | `vollmacht` |
| Telefon | Vertreter | `representativePersonPhoneNumber:Input` | Text | max. 20 Z. | — | — | `vollmacht` |


### Persönliches › Erhaltene Schenkungen / Erbschaften

**Route:** `#/<sitzung>/tax-assistant/personal/benefit-payment-received`  
**Navigation:** Seitenleiste › Persönliches › Erhaltene Schenkungen / Erbschaften  

> Speist Hauptformular Seite 4, Ziff. 50.1 (Code 516).

#### Zeilenliste: Erhaltene Schenkung / Erbschaft

**So entsteht eine Zeile:** «Neue Schenkung/Erbschaft hinzufügen»; Löschen über «Schenkung/Erbschaft entfernen»  
**id-Muster:** `<feld>:benefitRestBenefitPaymentReceivedDetail::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Art | `benefitRestBenefitPaymentReceivedDetailRestSource:benefitRestBenefitPaymentReceivedDetail::0:Select` | Auswahl | Auswahl: Schenkung (1) · Erbvorbezug (2) · Erbschaft (3) · Beteiligung an Erbengemeinschaft (4) | — | — | — |
| Verwandtschaftsgrad | `benefitRestBenefitPaymentReceivedDetailRelation:benefitRestBenefitPaymentReceivedDetail::0:Input` | Text | max. 30 Z. | ja | — | — |
| Datum | `benefitRestBenefitPaymentReceivedDetailDate:benefitRestBenefitPaymentReceivedDetail::0:DatePicker` | Datum | TT.MM.JJJJ | ja | — | — |
| Vorname | `benefitRestBenefitPaymentReceivedDetailPersonFirstName:benefitRestBenefitPaymentReceivedDetail::0:Input` | Text | max. 30 Z. | ja | — | — |
| Name | `benefitRestBenefitPaymentReceivedDetailPersonOfficialName:benefitRestBenefitPaymentReceivedDetail::0:Input` | Text | max. 30 Z. | ja | — | — |
| AHVN13 | `benefitRestBenefitPaymentReceivedDetailPersonAhv13:benefitRestBenefitPaymentReceivedDetail::0:Input` | Text | max. 20 Z. | — | — | — |
| Strasse | `benefitRestBenefitPaymentReceivedDetailPersonStreet:benefitRestBenefitPaymentReceivedDetail::0:Input` | Text | max. 60 Z. | ja | — | — |
| Nummer | `benefitRestBenefitPaymentReceivedDetailPersonHouseNumber:benefitRestBenefitPaymentReceivedDetail::0:Input` | Text | max. 12 Z. | ja | — | — |
| PLZ | `benefitRestBenefitPaymentReceivedDetailPersonZip:benefitRestBenefitPaymentReceivedDetail::0:Input` | Text | max. 15 Z. | ja | — | — |
| Ort | `benefitRestBenefitPaymentReceivedDetailPersonTown:benefitRestBenefitPaymentReceivedDetail::0:Input` | Text | max. 40 Z. | ja | — | — |
| Betrag | `benefitRestBenefitPaymentReceivedDetailAmount:benefitRestBenefitPaymentReceivedDetail::0:Input` | Betrag | ganze Franken | — | — | — |


### Persönliches › Ausgerichtete Schenkungen / Erbvorbezüge

**Route:** `#/<sitzung>/tax-assistant/personal/benefit-paidout`  
**Navigation:** Seitenleiste › Persönliches › Ausgerichtete Schenkungen / Erbvorbezüge  

> Speist Hauptformular Seite 4, Ziff. 50.2 (Code 519).

#### Zeilenliste: Ausgerichtete Schenkung / Erbvorbezug

**So entsteht eine Zeile:** «Neue Ausgerichtete Schenkung / Erbvorbezug hinzufügen»  
**id-Muster:** `<feld>:benefitRestBenefitPaidOutDetail::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Art | `benefitRestBenefitPaidOutDetailRestSource:benefitRestBenefitPaidOutDetail::0:Select` | Auswahl | Auswahl: Schenkung (1) · Erbvorbezug (2) | — | — | — |
| Verwandtschaftsgrad | `benefitRestBenefitPaidOutDetailRelation:benefitRestBenefitPaidOutDetail::0:Input` | Text | max. 30 Z. | ja | — | — |
| Datum | `benefitRestBenefitPaidOutDetailDate:benefitRestBenefitPaidOutDetail::0:DatePicker` | Datum | TT.MM.JJJJ | ja | — | — |
| Vorname | `benefitRestBenefitPaidOutDetailPersonFirstName:benefitRestBenefitPaidOutDetail::0:Input` | Text | max. 30 Z. | ja | — | — |
| Name | `benefitRestBenefitPaidOutDetailPersonOfficialName:benefitRestBenefitPaidOutDetail::0:Input` | Text | max. 30 Z. | ja | — | — |
| AHVN13 | `benefitRestBenefitPaidOutDetailPersonAhv13:benefitRestBenefitPaidOutDetail::0:Input` | Text | max. 20 Z. | — | — | — |
| Strasse | `benefitRestBenefitPaidOutDetailPersonStreet:benefitRestBenefitPaidOutDetail::0:Input` | Text | max. 60 Z. | ja | — | — |
| Nummer | `benefitRestBenefitPaidOutDetailPersonHouseNumber:benefitRestBenefitPaidOutDetail::0:Input` | Text | max. 12 Z. | ja | — | — |
| PLZ | `benefitRestBenefitPaidOutDetailPersonZip:benefitRestBenefitPaidOutDetail::0:Input` | Text | max. 15 Z. | ja | — | — |
| Ort | `benefitRestBenefitPaidOutDetailPersonTown:benefitRestBenefitPaidOutDetail::0:Input` | Text | max. 40 Z. | ja | — | — |
| Betrag | `benefitRestBenefitPaidOutDetailAmount:benefitRestBenefitPaidOutDetail::0:Input` | Betrag | ganze Franken | — | — | — |


### Persönliches › Kapitalleistungen

**Route:** `#/<sitzung>/tax-assistant/personal/benefit-payment`  
**Navigation:** Seitenleiste › Persönliches › Kapitalleistungen  

> Gesonderte Besteuerung (Hauptformular Seite 4, Code 510). ACHTUNG: die Maske kennt KEINE Zuordnung zu Person 1/2 – bei Ehegatten im Bericht festhalten.

#### Zeilenliste: Kapitalleistung

**So entsteht eine Zeile:** «Kapitalleistung hinzufügen»; Zeile leeren über «Kapitalleistung leeren»  
**id-Muster:** `<feld>:benefitPayment::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Art | `benefitPaymentReason:benefitPayment::0:Select` | Auswahl | Auswahl: aus AHV/IV (1) · aus Freizügigkeitskonto/-police (2) · infolge Tod oder für bleibende körperliche/gesundheitliche Nachteile (3) · aus einer Einrichtung der beruflichen Vorsorge (2. Säule) (4) · aus einer anerkannten Form der geb. Selbstvorsorge (3. Säule a) (5) · sonstige (6) | — | — | `rente_saeule3` |
| Auszahlungsdatum | `benefitPaymentDate:benefitPayment::0:DatePicker` | Datum | TT.MM.JJJJ | — | — | `rente_saeule3` |
| Betrag | `benefitPaymentAmount:benefitPayment::0:Input` | Betrag | ganze Franken | — | — | `rente_saeule3` |


### Persönliches › Bankverbindung für Rückerstattungen

**Route:** `#/<sitzung>/tax-assistant/personal/account-data`  
**Navigation:** Seitenleiste › Persönliches › Bankverbindung für Rückerstattungen  

> ACHTUNG: Bankkontonummer. Wird vom Assistenten NICHT ausgefüllt – Sascha trägt IBAN und Kontoinhaber selbst ein.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| IBAN-Nr. | Kontoangaben | `listOfSecuritiesBankAccountIbanNumber:Input` | Text | max. 26 Z.; Nur durch Sascha. | — | — | — |
| Konto lautend auf | Kontoangaben | `listOfSecuritiesBankAccountAccountOwner:Input` | Text | max. 24 Z.; Nur durch Sascha. | — | — | — |


### Einkünfte › Erwerb

**Route:** `#/<sitzung>/tax-assistant/revenue/employed`  
**Navigation:** Seitenleiste › Einkünfte › Erwerb  
**Registerkarten:** Person 1 · Person 2 (Felder mit Suffix P2)  

> WICHTIG: Solange Vorjahresdaten unbestätigt sind, sind die Felder schreibgeschützt (readonly + disabled). Erst der Knopf «Alle bestätigen» (bzw. «Bestätigen»/«Ändern» je Block) gibt sie frei. «Alle löschen» leert den Block.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Einkünfte (selbständig, Haupterwerb) | Selbständiger Erwerb – Haupterwerb | `revenueSelfemployedMainRevenueAmountP1:Input` | Betrag | ganze Franken; Hauptformular Ziff. 2.1 / Code 120 (P1), 121 (P2). | — | — | `selbstaendig` |
| Eigenkapital ohne Geschäftswertschriften (Haupterwerb) | Selbständiger Erwerb – Haupterwerb | `revenueSelfemployedMainAssetsAmountP1:Input` | Betrag | ganze Franken | — | — | `selbstaendig` |
| Erhebliche Mitarbeit im Geschäft (Haupterwerb) | Selbständiger Erwerb – Haupterwerb | `revenueRelevantCooperationMainP1:Checkbox` | Häkchen | — | — | — | — |
| Einkünfte (selbständig, Nebenerwerb) | Selbständiger Erwerb – Nebenerwerb | `revenueSelfemployedSidelineRevenueAmountP1:Input` | Betrag | ganze Franken; Ziff. 2.2 / Code 122 (P1), 123 (P2). | — | — | `selbstaendig` |
| Eigenkapital ohne Geschäftswertschriften (Nebenerwerb) | Selbständiger Erwerb – Nebenerwerb | `revenueSelfemployedSidelineAssetsAmountP1:Input` | Betrag | ganze Franken | — | — | `selbstaendig` |
| Erhebliche Mitarbeit im Geschäft (Nebenerwerb) | Selbständiger Erwerb – Nebenerwerb | `revenueRelevantCooperationSidelineP1:Checkbox` | Häkchen | — | — | — | — |
| Eigenkapital Selbständigerwerbender ohne Geschäftswertschriften | Betriebsvermögen (Person 1 und Person 2) | `assetSelfEmployedBusinessCapitalFiscalValue:Input` | Betrag | ganze Franken; Hauptformular Ziff. 32 / Code 430. | — | — | `selbstaendig` |
| Beleg hochladen: Lohnausweis Haupterwerb | Haupterwerb | `attachment_filerevenueEmployedMainRevenueDetailP10` | Upload | — | — | ja | — |
| Beleg hochladen: Lohnausweis Nebenerwerb | Nebenerwerb | `attachment_filerevenueEmployedSidelineRevenueDetailP10` | Upload | — | — | ja | — |

#### Zeilenliste: Haupterwerb (unselbständig)

**So entsteht eine Zeile:** «Weitere Zeile hinzufügen»; «Zeile leeren»  
**id-Muster:** `<feld>:revenueEmployedMainRevenueDetailP1::<zeile>:<Art> (P2 analog)`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Von | `revenueEmployedMainRevenueDetailP1BeginDate:revenueEmployedMainRevenueDetailP1::0:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Bis | `revenueEmployedMainRevenueDetailP1EndDate:revenueEmployedMainRevenueDetailP1::0:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Arbeitgeber | `revenueEmployedMainRevenueDetailP1Entrepreneur:revenueEmployedMainRevenueDetailP1::0:Input` | Text | max. 86 Z. | — | — | — |
| Nettolohn | `revenueEmployedMainRevenueDetailP1Revenue:revenueEmployedMainRevenueDetailP1::0:Input` | Betrag | ganze Franken; Lohnausweis Ziffer 11. Hauptformular Ziff. 1.1 / Code 100 (P1), 101 (P2). | — | — | `lohn_haupt` |

#### Zeilenliste: Nebenerwerb (unselbständig)

**So entsteht eine Zeile:** «Weitere Zeile hinzufügen»  
**id-Muster:** `<feld>:revenueEmployedSidelineRevenueDetailP1::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Von | `revenueEmployedSidelineRevenueDetailP1BeginDate:revenueEmployedSidelineRevenueDetailP1::0:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Bis | `revenueEmployedSidelineRevenueDetailP1EndDate:revenueEmployedSidelineRevenueDetailP1::0:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Arbeitgeber | `revenueEmployedSidelineRevenueDetailP1Description:revenueEmployedSidelineRevenueDetailP1::0:Input` | Text | max. 86 Z. | — | — | — |
| Nettolohn | `revenueEmployedSidelineRevenueDetailP1Revenue:revenueEmployedSidelineRevenueDetailP1::0:Input` | Betrag | ganze Franken; Ziff. 1.2 / Code 102 (P1), 103 (P2). | — | — | `lohn_neben` |


### Einkünfte › Renten und Versicherungen

**Route:** `#/<sitzung>/tax-assistant/revenue/insurance`  
**Navigation:** Seitenleiste › Einkünfte › Renten und Versicherungen  
**Registerkarten:** Person 1 · Person 2  

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Art der Rente (AHV/IV) | AHV-/IV-Renten (100 %) | `revenueInsuranceP1AHVIV100:Select` | Auswahl | Auswahl: AHV (0) · IV (1) | — | — | `rente_ahv` |
| Betrag AHV-/IV-Rente (100 %) | AHV-/IV-Renten (100 %) | `revenueInsuranceP1AHVIV100Amount:Input` | Betrag | ganze Franken; Ziff. 3.1 / Code 130 (P1), 131 (P2). | — | — | `rente_ahv` |
| Erwerbsausfallentschädigungen aus Arbeitslosenversicherung | Entschädigungen, Zulagen und Taggelder | `revenueUnemploymentInsuranceP1:Input` | Betrag | ganze Franken; Code 140 (P1), 141 (P2). | — | — | `ersatz` |
| Kinder-/Familienzulagen, Mutterschaftsentschädigung, Taggelder, EO | Entschädigungen, Zulagen und Taggelder | `revenueChildAllowancesP1:Input` | Betrag | ganze Franken; Code 142 (P1), 143 (P2). | — | — | `ersatz` |

#### Zeilenliste: Renten/Pensionen

**So entsteht eine Zeile:** «Weitere Zeile hinzufügen»; «Zeile löschen»  
**id-Muster:** `<feld>:revenuePensionDetailP1::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Bezeichnung | `revenuePensionDetailP1Description:revenuePensionDetailP1::0:Input` | Text | max. 86 Z. | — | — | `rente_pk` |
| Betrag (100 %) | `revenuePensionDetailP1Amount100:revenuePensionDetailP1::0:Input` | Betrag | ganze Franken; Ziff. 3.2 / Codes 134–137. | — | — | `rente_pk` |
| Prozent | `revenuePensionDetailP1Percentage:revenuePensionDetailP1::0:Select` | Auswahl | Auswahl: 0 · 40 · 60 · 80 · 100 | — | — | `rente_pk` |
| Steuerbar | `revenuePensionDetailP1AmountFinal:revenuePensionDetailP1::0:Input` | Betrag | ganze Franken | — | ja | — |


### Einkünfte › Übrige Einkünfte

**Route:** `#/<sitzung>/tax-assistant/revenue/rest`  
**Navigation:** Seitenleiste › Einkünfte › Übrige Einkünfte  

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Unterhaltsbeiträge vom geschiedenen/getrennten Ehegatten | Unterhaltsbeiträge | `revenueRestRevenueAlimony:Input` | Betrag | ganze Franken; Rechenfeld; Stift öffnet Dialog dialogs/revenue/revenue-rest-revenue-alimony. Ziff. 5.1 / Code 160. | — | ja | `alimente_erhalten` |
| Unterhaltsbeiträge für minderjährige Kinder | Unterhaltsbeiträge | `revenueRestRevenueAlimonyChild:Input` | Betrag | ganze Franken; Rechenfeld, wird aus der Maske «Kinder» gespeist. Ziff. 5.2 / Code 161. | — | ja | `alimente_erhalten` |
| Kapitalabfindung – Nähere Bezeichnung | Kapitalabfindungen für wiederkehrende Leistungen | `revenueRestRevenueLumpSumSettlementText:Input` | Text | max. 28 Z. | — | — | — |
| Kapitalabfindung – Anzahl Monate | Kapitalabfindungen für wiederkehrende Leistungen | `revenueLumpSumSettlementMonths:Input` | Zahl | — | — | — | — |
| Kapitalabfindung – Betrag | Kapitalabfindungen für wiederkehrende Leistungen | `revenueRestRevenueLumpSumSettlementAmount:Input` | Betrag | ganze Franken; Ziff. 5.5 / Code 164. | — | — | — |

#### Zeilenliste: Geschäfts- und Korporationsanteile

**So entsteht eine Zeile:** «Geschäfts-/ Korporationsanteil hinzufügen» bzw. leere WR-Zeile ausfüllen  
**id-Muster:** `<feld>WR:inheritanceEtcDetail::<Art> (leere Zeile)`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Datum | `inheritanceEtcDetailDateWR:inheritanceEtcDetail::DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Genaue Bezeichnung | `inheritanceEtcDetailDescriptionWR:inheritanceEtcDetail::Input` | Text | max. 68 Z. | — | — | — |
| Vermögen Betrag | `inheritanceEtcDetailAssetWR:inheritanceEtcDetail::Input` | Betrag | ganze Franken; Ziff. 30.5 / Code 414. | — | — | `uebriges_vermoegen` |
| Einkommen Betrag | `inheritanceEtcDetailRevenueWR:inheritanceEtcDetail::Input` | Betrag | ganze Franken; Ziff. 5.3 / Code 162. | — | — | `uebrige_einkuenfte` |

#### Zeilenliste: Weitere Einkünfte

**So entsteht eine Zeile:** leere WR-Zeile ausfüllen («Weitere Zeile hinzufügen»)  
**id-Muster:** `<feld>WR:revenueRestRevenueFreeTextDetail::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Art | `revenueRestRevenueFreeTextDetailDescriptionWR:revenueRestRevenueFreeTextDetail::Input` | Text | max. 38 Z. | — | — | `uebrige_einkuenfte` |
| Betrag | `revenueRestRevenueFreeTextDetailAmountWR:revenueRestRevenueFreeTextDetail::Input` | Betrag | ganze Franken; Ziff. 5.4 / Code 163. | — | — | `uebrige_einkuenfte` |


### Einkünfte › Übrige Einkünfte › Erhaltene Unterhaltsbeiträge (Dialog)

**Route:** `#/<sitzung>/dialogs/revenue/revenue-rest-revenue-alimony`  
**Navigation:** Übrige Einkünfte › Stift-Knopf bei «Unterhaltsbeiträge vom geschiedenen/getrennten Ehegatten»  

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Zahler – Vorname | Zahler der Unterhaltsbeiträge | `revenueRestRevenueAlimonyPersonFirstName:Input` | Text | max. 30 Z. | — | — | — |
| Zahler – Name | Zahler der Unterhaltsbeiträge | `revenueRestRevenueAlimonyPersonOfficialName:Input` | Text | max. 30 Z. | — | — | — |
| Zahler – Adresse | Zahler der Unterhaltsbeiträge | `revenueRestRevenueAlimonyPersonAdress:Input` | Text | max. 30 Z. | — | — | — |
| Zahler – PLZ | Zahler der Unterhaltsbeiträge | `revenueRestRevenueAlimonyPersonZip:Input` | Text | max. 15 Z. | — | — | — |
| Zahler – Wohnort | Zahler der Unterhaltsbeiträge | `revenueRestRevenueAlimonyPersonTown:Input` | Text | max. 40 Z. | — | — | — |

#### Zeilenliste: Aufstellung Unterhaltsbeiträge

**So entsteht eine Zeile:** «Weitere Zeile hinzufügen» / leere WR-Zeile  
**id-Muster:** `<feld>WR:revenueRestRevenueAlimonyDetail::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Datum | `revenueRestRevenueAlimonyDetailDateWR:revenueRestRevenueAlimonyDetail::DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Betrag CHF | `revenueRestRevenueAlimonyDetailAmountWR:revenueRestRevenueAlimonyDetail::Input` | Betrag | ganze Franken | — | — | `alimente_erhalten` |


### Einkünfte / Vermögen › Liegenschaften (Liegenschaftenverzeichnis)

**Route:** `#/<sitzung>/tax-assistant/revenue/properties  ==  #/<sitzung>/tax-assistant/assets/properties`  
**Navigation:** Seitenleiste › Einkünfte › Liegenschaften  ODER  Seitenleiste › Vermögen › Liegenschaften – beide Wege führen auf dieselbe Liste  

> Tabellenansicht mit den Spalten: Nr. | Ort | Strasse und Nummer | Kanton / Land | Steuerwert Ertragswert | Steuerwert Verkehrswert | Ertrag | Kosten | Verbleibender Ertrag. Alle Werte in der Tabelle sind Anzeige; erfasst wird im Beiblatt (Detail-Dialog). Zeilenaktionen je Zeile: Stift (bearbeiten), Papierkorb (löschen, mit Rückfrage), Pfeil hoch/runter (Reihenfolge).

#### Zeilenliste: Liegenschaft

**So entsteht eine Zeile:** «Liegenschaften hinzufügen» (Plus unter der Tabelle) – öffnet direkt das Beiblatt  
**id-Muster:** `<feld>:propertyDetail::<objektNr>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| (Tabellenspalten) | `—` | Text | Nr. \| Ort \| Strasse und Nummer \| Kanton / Land \| Steuerwert Ertragswert \| Steuerwert Verkehrswert \| Ertrag \| Kosten \| Verbleibender Ertrag | — | — | — |


### Einkünfte / Vermögen › Liegenschaften Detailerfassung (Beiblatt je Objekt)

**Route:** `#/<sitzung>/dialogs/assets/property-detail`  
**Navigation:** Liegenschaften › «Liegenschaften hinzufügen» oder Stift in der Zeile  

> Ein Beiblatt je Objekt; <objektNr> im Feldnamen ist die Nummer aus der Verzeichnistabelle. Abschluss über «OK» (übernehmen), «Abbrechen» (verwerfen) oder «Löschen» (Objekt entfernen, Rückfrage mit OK/Abbrechen). Der Knopf «Schulden der Liegenschaft erfassen» springt ins Schuldenverzeichnis – es gibt dort KEINE Objektzuordnung.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Ort | Grundangaben | `propertyDetailTown:propertyDetail::1:Input` | Text | max. 50 Z. | — | — | `liegenschaften` |
| Strasse und Nummer | Grundangaben | `propertyDetailStreet:propertyDetail::1:Input` | Text | max. 80 Z. | — | — | `liegenschaften` |
| Kanton/Ausland | Grundangaben | `propertyDetailCantonOrCountry:propertyDetail::1:Select` | Auswahl | Auswahl: ZH · AG · AI · AR · BE · BL · BS · FR · GE · GL · GR · JU · LU · NE · NW · OW · SG · SH · SO · SZ · TG · TI · UR · VD · VS · ZG · Ausland (abroad) | — | — | `liegenschaften` |
| Art der Liegenschaft | Grundangaben | `propertyDetailTypeOfPropertyFreeText:propertyDetail::1:Input` | Text | max. 50 Z. | — | — | `liegenschaften` |
| Fläche in m² | Grundangaben | `propertyDetailArea:propertyDetail::1:Input` | Zahl | — | — | — | `liegenschaften` |
| Landwirtschaftliche Nutzung | Grundangaben | `propertyDetailAgriculturalUse:propertyDetail::1:Checkbox` | Häkchen | — | — | — | — |
| Wohnrecht | Grundangaben | `propertyDetailRightOfResidence:propertyDetail::1:Checkbox` | Häkchen | — | — | — | — |
| Nutzniessung | Grundangaben | `propertyDetailUsufruct:propertyDetail::1:Checkbox` | Häkchen | — | — | — | — |
| Nutzung | Grundangaben | `propertyDetailUse:propertyDetail::1:Select` | Auswahl | Auswahl: Selbstgenutzt (1) · Fremdgenutzt (2) · Gemischt (3) | — | — | `liegenschaften` |
| Schieber: Liegenschaft in der Steuerperiode gekauft/verkauft | Grundangaben | `slider_propertyDetailPurchasedOrSoldDie Liegenschaft wurde in der Steuerperiode gekauft/verkauft` | Häkchen | Schieber; blendet Kauf-/Verkaufsdatum ein. Die id enthält den Beschriftungstext – Selektor nur exakt so brauchbar. | — | — | — |
| Kaufdatum (in der Steuerperiode) | Grundangaben | `propertyDetailPurchaseDate:propertyDetail::1:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Verkaufsdatum (in der Steuerperiode) | Grundangaben | `propertyDetailSaleDate:propertyDetail::1:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Verkehrswert | Steuerwert | `propertyDetailCommercialValue:propertyDetail::1:Input` | Betrag | ganze Franken; Hauptformular Ziff. 31.1 / Code 421. | — | — | `liegenschaften` |
| Ertragswert (Land-/Forstwirtschaft) | Steuerwert | `propertyDetailCapitalizedValue:propertyDetail::1:Input` | Betrag | ganze Franken; Ziff. 31.2 / Code 422. | — | — | `liegenschaften` |
| Beleg hochladen: Steuerwert der Liegenschaft | Steuerwert | `attachment_file420` | Upload | — | — | ja | — |
| Eigenmietwert | Eigenmietwert/Mieteinnahmen | `propertyDetailNotionalRentalValue:propertyDetail::1:Input` | Betrag | ganze Franken | — | — | `liegenschaft_ertrag` |
| Schieber: Mieteinnahmen | Eigenmietwert/Mieteinnahmen | `slider_propertyDetailHasEarningsMieteinnahmen` | Häkchen | Blendet die Mietertragsfelder ein. | — | — | — |
| Mietertrag: Total angeben | Eigenmietwert/Mieteinnahmen | `propertyDetailHasDetailedEarnings:propertyDetail::1:RadioTotal angeben` | Radio | — | — | — | — |
| Mietertrag: Detailliert angeben (Mieterspiegel) | Eigenmietwert/Mieteinnahmen | `propertyDetailHasDetailedEarnings:propertyDetail::1:RadioDetailliert angeben` | Radio | — | — | — | — |
| Mieteinnahmen/Mietwert: Wohnungen, Zimmer, Garagen etc. | Eigenmietwert/Mieteinnahmen | `propertyDetailRentEarningsPrivate:propertyDetail::1:Input` | Betrag | ganze Franken | — | — | `liegenschaft_ertrag` |
| Mieteinnahmen/Mietwert: Gewerblich/geschäftlich benutzte Räume | Eigenmietwert/Mieteinnahmen | `propertyDetailRentEarningsBusiness:propertyDetail::1:Input` | Betrag | ganze Franken | — | — | `liegenschaft_ertrag` |
| Beleg hochladen: Ertrag der Liegenschaft | Eigenmietwert/Mieteinnahmen | `attachment_file180` | Upload | — | — | ja | — |
| Schieber: Unterhalt Pauschal (an) / Effektiv (aus) | Unterhalts- und Verwaltungskosten | `slider_propertyDetailMaintenanceCostsFlatRateOrRealPauschal` | Häkchen | ENTWEDER pauschal ODER effektiv – nie beides. Die Entscheidung trifft Sascha. | — | — | — |
| Effektive Kosten: Total angeben | Unterhalts- und Verwaltungskosten | `propertyDetailMaintenanceCostsHasDetail:propertyDetail::1:RadioTotal angeben` | Radio | — | — | — | — |
| Effektive Kosten: Detailliert angeben | Unterhalts- und Verwaltungskosten | `propertyDetailMaintenanceCostsHasDetail:propertyDetail::1:RadioDetailliert angeben` | Radio | — | — | — | — |
| Effektive Kosten (Total) | Unterhalts- und Verwaltungskosten | `propertyDetailMaintenanceCostsReal:propertyDetail::1:Input` | Betrag | ganze Franken | — | — | `liegenschaftsunterhalt` |
| Beleg hochladen: Unterhaltskosten der Liegenschaft | Unterhalts- und Verwaltungskosten | `attachment_file574` | Upload | — | — | ja | — |

#### Zeilenliste: Mieterspiegel (nur bei «Detailliert angeben»)

**So entsteht eine Zeile:** «Weitere Zeile hinzufügen» unter der Mieterspiegel-Tabelle  
**id-Muster:** `<feld>:propertyDetail::<objektNr>:propertyDetailEarningsDetail::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Stockwerk | `propertyDetailEarningsDetailFloor:propertyDetail::1:propertyDetailEarningsDetail::0:Input` | Text | max. 12 Z. | — | — | — |
| Zimmerzahl / Bürofläche | `propertyDetailEarningsDetailNumberOfRoomsOrOfficeArea:propertyDetail::1:propertyDetailEarningsDetail::0:Input` | Text | max. 18 Z. | — | — | — |
| Mieter: Name und Vorname | `propertyDetailEarningsDetailTenant:propertyDetail::1:propertyDetailEarningsDetail::0:Input` | Text | max. 82 Z. | — | — | — |
| Dauer der Miete | `propertyDetailEarningsDetailDurationOfRent:propertyDetail::1:propertyDetailEarningsDetail::0:Input` | Text | max. 26 Z. | — | — | — |
| Mietertrag | `propertyDetailEarningsDetailRentEarningsPrivate:propertyDetail::1:propertyDetailEarningsDetail::0:Input` | Betrag | ganze Franken | — | — | `liegenschaft_ertrag` |
| Mietertrag gewerbliche Nutzung | `propertyDetailEarningsDetailRentEarningsBusiness:propertyDetail::1:propertyDetailEarningsDetail::0:Input` | Betrag | ganze Franken | — | — | `liegenschaft_ertrag` |

#### Zeilenliste: Unterhalts- und Verwaltungskosten effektiv (nur bei «Detailliert angeben»)

**So entsteht eine Zeile:** «Weitere Zeile hinzufügen» unter der Kostentabelle  
**id-Muster:** `<feld>:propertyDetailMaintenanceCostsDetail::<zeile>:propertyDetail::<objektNr>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Datum | `propertyDetailMaintenanceCostsDetailDate:propertyDetailMaintenanceCostsDetail::1:propertyDetail::1:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Art | `propertyDetailMaintenanceCostsDetailTypeOfMaintenance:propertyDetailMaintenanceCostsDetail::1:propertyDetail::1:Input` | Text | max. 68 Z. | — | — | — |
| Empfänger | `propertyDetailMaintenanceCostsDetailCostRecipient:propertyDetailMaintenanceCostsDetail::1:propertyDetail::1:Input` | Text | max. 98 Z. | — | — | — |
| Betrag CHF | `propertyDetailMaintenanceCostsDetailCostAmount:propertyDetailMaintenanceCostsDetail::1:propertyDetail::1:Input` | Betrag | ganze Franken | — | — | `liegenschaftsunterhalt` |
| Wertvermehrender Anteil in % | `propertyDetailMaintenanceCostsDetailPercentageIncreasingValue:propertyDetailMaintenanceCostsDetail::1:propertyDetail::1:Input` | Zahl | Fachliche Entscheidung werterhaltend/wertvermehrend – trifft Sascha, nicht der Beleg. | — | — | — |
| Abzugsfähige Kosten | `propertyDetailMaintenanceCostsDetailDeductableCosts:propertyDetailMaintenanceCostsDetail::1:propertyDetail::1:Input` | Betrag | ganze Franken | — | ja | — |


### Abzüge › Berufsbedingte Fahrkosten

**Route:** `#/<sitzung>/tax-assistant/deductions/job-expenses-motorvehicle`  
**Navigation:** Seitenleiste › Abzüge › Berufsbedingte Fahrkosten  
**Registerkarten:** Person 1 · Person 2  

> Vorjahresdaten-Sperre wie beim Erwerb: erst «Alle bestätigen» drücken.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Arbeitgeber | Berufsbedingte Fahrkosten | `personDataEmployerP1:Input` | Text | max. 60 Z. | — | — | — |
| Arbeitsort Strasse | Berufsbedingte Fahrkosten | `jobExpensesPlaceOfWorkP1:Input` | Text | max. 96 Z. | ja | — | — |
| Abonnementskosten für öffentliche Verkehrsmittel | Öffentliches Verkehrsmittel, Fahrrad, Kleinmotorrad | `jobExpensesTicketCostPublicTransportP1:Input` | Betrag | ganze Franken; Formular Berufsauslagen Ziff. 1.1 / Code 201. | — | — | `berufsauslagen_fahrkosten` |
| Fahrrad, Kleinmotorrad | Öffentliches Verkehrsmittel, Fahrrad, Kleinmotorrad | `jobExpensesBicycleOrSmallMotorbikeP1:Input` | Betrag | ganze Franken; Ziff. 1.2 / Code 202, Pauschale CHF 700. | — | — | `berufsauslagen_fahrkosten` |
| Begründung Privatfahrzeug: Fehlen eines ÖV | Begründung für die Benützung eines privaten Motorfahrzeuges | `jobExpensesReasonPrivateMotorvehicleP1NoPublicTransport:Checkbox` | Häkchen | — | — | — | — |
| Begründung Privatfahrzeug: Zeitersparnis über 1 Stunde | Begründung für die Benützung eines privaten Motorfahrzeuges | `jobExpensesReasonPrivateMotorvehicleP1TimeSaving:Checkbox` | Häkchen | — | — | — | — |
| Begründung Privatfahrzeug: Ständige Benützung auf Verlangen des Arbeitgebers | Begründung für die Benützung eines privaten Motorfahrzeuges | `jobExpensesReasonPrivateMotorvehicleP1JobRequirement:Checkbox` | Häkchen | — | — | — | — |
| Begründung Privatfahrzeug: Krankheit/Gebrechlichkeit | Begründung für die Benützung eines privaten Motorfahrzeuges | `jobExpensesReasonPrivateMotorvehicleP1MedicalReasons:Checkbox` | Häkchen | — | — | — | — |
| Geleastes Fahrzeug | Angaben zur Benutzung eines privaten Motorfahrzeugs | `jobExpensesMotorvehicleP1IsLeased:Checkbox` | Häkchen | — | — | — | — |

#### Zeilenliste: Fahrten mit privatem Motorfahrzeug

**So entsteht eine Zeile:** «Weitere Zeile hinzufügen»; «Zeile leeren»  
**id-Muster:** `<feld>:jobExpensesDetailsMotorvehicleP1::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Arbeitsort | `jobExpensesDetailsMotorvehicleP1PlaceOfWork:jobExpensesDetailsMotorvehicleP1::0:Input` | Text | max. 22 Z. | — | — | — |
| Anzahl Arbeitstage | `jobExpensesDetailsMotorvehicleP1NumberOfWorkdays:jobExpensesDetailsMotorvehicleP1::0:Input` | Zahl | In der Regel max. 240 Tage. | — | — | — |
| Anzahl km pro Fahrt | `jobExpensesDetailsMotorvehicleP1Distance:jobExpensesDetailsMotorvehicleP1::0:Input` | Zahl | — | — | — | — |
| Fahrten pro Tag | `jobExpensesDetailsMotorvehicleP1NumberOfTrips:jobExpensesDetailsMotorvehicleP1::0:Input` | Zahl | — | — | — | — |
| Rappen pro km | `jobExpensesDetailsMotorvehicleP1AmountPerDistance:jobExpensesDetailsMotorvehicleP1::0:Select` | Auswahl | Auswahl: (leer) · 70 (Auto) · 40 (Motorrad) | — | — | `berufsauslagen_fahrkosten` |


### Abzüge › Weitere Berufsauslagen

**Route:** `#/<sitzung>/tax-assistant/deductions/job-expenses-other-expenses`  
**Navigation:** Seitenleiste › Abzüge › Weitere Berufsauslagen  
**Registerkarten:** Person 1 · Person 2  

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Auswärtige Verpflegung – mit Verbilligung Arbeitgeber | Auswärtige Verpflegung | `jobExpensesCateringSubsidizedP1:Input` | Betrag | ganze Franken; Code 206. Lohnausweis Feld G beachten. | — | — | `berufsauslagen_verpflegung` |
| Auswärtige Verpflegung – voll zu Lasten des Arbeitnehmers | Auswärtige Verpflegung | `jobExpensesCateringNonSubsidizedP1:Input` | Betrag | ganze Franken; Code 208. | — | — | `berufsauslagen_verpflegung` |
| Schicht-/Nachtarbeit – Anzahl Tage | Durchgehende mindestens achtstündige Schicht-/Nachtarbeit | `jobExpensesCateringShiftWorkNumberOfDaysP1:Input` | Zahl | Code 210. | — | — | `berufsauslagen_verpflegung` |
| Übrige Berufskosten: Pauschal 3 % des Nettolohns | Abrechnungsart Berufskosten | `jobExpensesRemainingJobCostFlatrateOrRealP1:RadioPauschal, 3 % des Nettolohns gemäss Lohnausweis` | Radio | Code 212, min. 2000 / max. 4000. | — | — | `berufsauslagen_uebrige` |
| Übrige Berufskosten: Effektive Kosten gemäss Aufstellung | Abrechnungsart Berufskosten | `jobExpensesRemainingJobCostFlatrateOrRealP1:RadioEffektive Kosten gemäss Aufstellung` | Radio | Code 213; blendet die Aufstellung ein. | — | — | `berufsauslagen_uebrige` |
| Nebenerwerbsauslagen: Pauschal 20 % der Einkünfte | Auslagen bei Nebenerwerb | `jobExpensesSidelineFlatrateOrRealP1:RadioPauschal, 20% der Einkünfte aus Nebenerwerb` | Radio | Code 216. | — | — | — |
| Nebenerwerbsauslagen: Effektive Kosten gemäss Aufstellung | Auslagen bei Nebenerwerb | `jobExpensesSidelineFlatrateOrRealP1:RadioEffektive Kosten gemäss Aufstellung` | Radio | Code 217. | — | — | — |

#### Zeilenliste: Mehrkosten Wochenaufenthalt

**So entsteht eine Zeile:** leere WR-Zeile ausfüllen / «Weitere Zeile hinzufügen»  
**id-Muster:** `<feld>WR:jobExpensesWeekdayStayDetailP1::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Datum | `jobExpensesWeekdayStayDetailP1DateWR:jobExpensesWeekdayStayDetailP1::DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Bezeichnung | `jobExpensesWeekdayStayDetailP1DescriptionWR:jobExpensesWeekdayStayDetailP1::Input` | Text | max. 144 Z. | — | — | — |
| Betrag | `jobExpensesWeekdayStayDetailP1AmountWR:jobExpensesWeekdayStayDetailP1::Input` | Betrag | ganze Franken | — | — | `berufsauslagen_verpflegung` |

#### Zeilenliste: Übrige Berufskosten effektiv

**So entsteht eine Zeile:** erscheint erst nach Wahl «Effektive Kosten gemäss Aufstellung»  
**id-Muster:** `<feld>WR:jobExpensesRemainingJobCostEffectiveDetailP1::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Datum | `jobExpensesRemainingJobCostEffectiveDetailP1DateWR:jobExpensesRemainingJobCostEffectiveDetailP1::DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Bezeichnung | `jobExpensesRemainingJobCostEffectiveDetailP1DescriptionWR:jobExpensesRemainingJobCostEffectiveDetailP1::Input` | Text | max. 144 Z. | — | — | — |
| Betrag | `jobExpensesRemainingJobCostEffectiveDetailP1AmountWR:jobExpensesRemainingJobCostEffectiveDetailP1::Input` | Betrag | ganze Franken | — | — | `berufsauslagen_uebrige` |


### Abzüge › Berufsorientierte Aus- und Weiterbildung

**Route:** `#/<sitzung>/tax-assistant/deductions/job-expenses-education`  
**Navigation:** Seitenleiste › Abzüge › Berufsorientierte Aus- und Weiterbildung  
**Registerkarten:** Person 1 · Person 2  

> Hauptformular Ziff. 16.2 / Code 292. Max. Abzug 12 400 (Staat) bzw. 12 900 (Bund) je Person.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Beitrag Arbeitgeber oder weiterer Stellen | Berufsorientierte Aus- und Weiterbildung | `furtherEducationEmployerContributionP1:Input` | Betrag | ganze Franken; Kürzt den Abzug (Code 2901). | — | — | `weiterbildung` |

#### Zeilenliste: Aus-/Weiterbildungskosten

**So entsteht eine Zeile:** «Weitere Zeile hinzufügen» / leere WR-Zeile  
**id-Muster:** `<feld>WR:furtherEducationCostDetail::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Bezeichnung | `furtherEducationCostDetailDescriptionWR:furtherEducationCostDetail::Input` | Text | — | — | — | `weiterbildung` |
| Betrag (Person 1) | `furtherEducationCostDetailAmountP1WR:furtherEducationCostDetail::Input` | Betrag | ganze Franken | — | — | `weiterbildung` |
| Betrag (Person 2) | `furtherEducationCostDetailAmountP2WR:furtherEducationCostDetail::Input` | Betrag | ganze Franken; Nur im Formulareditor sichtbar; im Assistenten über die Registerkarte Person 2. | — | — | `weiterbildung` |


### Abzüge / Vermögen › Schuldzinsen = Schulden (Schuldenverzeichnis)

**Route:** `#/<sitzung>/tax-assistant/deductions/deduction-private-liabilities  ==  #/<sitzung>/tax-assistant/assets/asset-private-liabilities`  
**Navigation:** Seitenleiste › Abzüge › Schuldzinsen  ODER  Seitenleiste › Vermögen › Schulden – dieselbe Liste  

> EINE Zeile je Gläubiger, Restschuld und Zins in getrennten Spalten. ZHprivateTax kennt KEINE Zuordnung der Schuld zu einer Liegenschaft – die Katalog-Dimension «objekt» hat hier kein Zielfeld. Totale: Ziff. 34 / Code 470 (Schuld) und Ziff. 12 / Code 250 (Zins).

#### Zeilenliste: Privatschulden inkl. Grundpfandschulden

**So entsteht eine Zeile:** «Weitere Zeile hinzufügen» / leere WR-Zeile ausfüllen; «Zeile leeren»  
**id-Muster:** `<feld>WR:listOfLiabilitiesPrivateLiabilities::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Name, Vorname und Adresse des Gläubigers | `listOfLiabilitiesPrivateLiabilitiesIdentificationWR:listOfLiabilitiesPrivateLiabilities::Input` | Text | max. 110 Z. | — | — | `schulden` |
| Schuld am 31.12. | `listOfLiabilitiesPrivateLiabilitiesLiabilityWR:listOfLiabilitiesPrivateLiabilities::Input` | Betrag | ganze Franken | — | — | `schulden` |
| Schuldzinsen | `listOfLiabilitiesPrivateLiabilitiesLiabilityInterestWR:listOfLiabilitiesPrivateLiabilities::Input` | Betrag | ganze Franken | — | — | `schulden` |


### Abzüge › Unterhalt und Renten

**Route:** `#/<sitzung>/tax-assistant/deductions/deduction-payment`  
**Navigation:** Seitenleiste › Abzüge › Unterhalt und Renten  

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Unterhaltsbeiträge an den geschiedenen/getrennt lebenden Ehegatten | Unterhaltsbeiträge | `deductionPaymentAlimonyCantonalTax:Input` | Betrag | ganze Franken; Rechenfeld; Stift öffnet Dialog dialogs/deductions/deduction-payment-alimony. Ziff. 13.1 / Code 254. | — | ja | `alimente_bezahlt` |
| Unterhaltsbeiträge für minderjährige Kinder | Unterhaltsbeiträge | `deductionPaymentAlimonyChildCantonalTax:Input` | Betrag | ganze Franken; Rechenfeld aus «Kinder ausserhalb Haushalt». Ziff. 13.2 / Code 255. | — | ja | `alimente_bezahlt` |
| Rentenleistungen | Rentenleistungen | `deductionPaymentPensionTotal:Input` | Betrag | ganze Franken; Ziff. 13.3 / Code 256; 40 % abzugsfähig. | — | — | — |


### Abzüge › Unterhalt und Renten › Bezahlte Unterhaltsbeiträge (Dialog)

**Route:** `#/<sitzung>/dialogs/deductions/deduction-payment-alimony`  
**Navigation:** Unterhalt und Renten › Stift bei «Unterhaltsbeiträge an den geschiedenen …»  

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Empfänger – Vorname | Empfänger der Unterhaltsbeiträge | `deductionPaymentAlimonyPersonFirstName:Input` | Text | max. 60 Z. | — | — | — |
| Empfänger – Name | Empfänger der Unterhaltsbeiträge | `deductionPaymentAlimonyPersonOfficialName:Input` | Text | max. 60 Z. | — | — | — |
| Empfänger – Adresse | Empfänger der Unterhaltsbeiträge | `deductionPaymentAlimonyPersonAdress:Input` | Text | max. 60 Z. | — | — | — |
| Empfänger – PLZ | Empfänger der Unterhaltsbeiträge | `deductionPaymentAlimonyPersonZip:Input` | Text | max. 15 Z. | — | — | — |
| Empfänger – Wohnort | Empfänger der Unterhaltsbeiträge | `deductionPaymentAlimonyPersonTown:Input` | Text | max. 60 Z. | — | — | — |

#### Zeilenliste: Tabelle Unterhaltsbeiträge

**So entsteht eine Zeile:** «Weitere Zeile hinzufügen» / leere WR-Zeile  
**id-Muster:** `<feld>WR:deductionPaymentAlimonyDetail::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Datum | `deductionPaymentAlimonyDetailDateWR:deductionPaymentAlimonyDetail::DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Betrag CHF | `deductionPaymentAlimonyDetailAmountWR:deductionPaymentAlimonyDetail::Input` | Betrag | ganze Franken | — | — | `alimente_bezahlt` |


### Abzüge › Säule 3a und weitere Vorsorgearten

**Route:** `#/<sitzung>/tax-assistant/deductions/provision`  
**Navigation:** Seitenleiste › Abzüge › Säule 3a und weitere Vorsorgearten  
**Registerkarten:** Person 1 · Person 2  

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Säule 3a – Betrag effektiv | Beiträge 3. Säule a | `deductionProvision3aP1Effective:Input` | Betrag | ganze Franken; Ziff. 14.1 / Code 260 (P1); P2 = deductionProvision3aP2Effective:Input, Ziff. 14.2 / Code 261. | — | — | `saeule_3a` |

#### Zeilenliste: Beiträge an AHV, IV und 2. Säule

**So entsteht eine Zeile:** «Weitere Zeile hinzufügen»  
**id-Muster:** `<feld>:deductionFurtherDeductionProvisionDetail::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Art | `deductionFurtherDeductionProvisionDetailKind:deductionFurtherDeductionProvisionDetail::0:Select` | Auswahl | Auswahl: 2. Säule ordentlich (1) · 2. Säule Einkauf (2) · AHV/IV Erwerbstätige (3) · AHV/IV Nichterwerbstätige (4); Hier laufen Katalogpositionen «Einkauf in die 2. Säule» und «AHV/IV/EO Nichterwerbstätige» hinein. | — | — | — |
| Betrag | `deductionFurtherDeductionProvisionDetailAmount:deductionFurtherDeductionProvisionDetail::0:Input` | Betrag | ganze Franken; EIN Feld, ZWEI Katalogpositionen – die Auswahl «Art» entscheidet: «2. Säule Einkauf» = einkauf_pk, «AHV/IV Nichterwerbstätige» = ahv_beitraege. Ziff. 16.1 / Code 280. | — | — | `einkauf_pk / ahv_beitraege` |


### Abzüge › Versicherungsprämien

**Route:** `#/<sitzung>/tax-assistant/deductions/insurance-premiums`  
**Navigation:** Seitenleiste › Abzüge › Versicherungsprämien  

> Gemeinsame Erfassung – KEINE Aufteilung auf Person 1/2. Der Maximalabzug wird vom Portal berechnet (Ziff. 15 / Code 270). Die GEBÄUDEversicherung gehört NICHT hierher, sondern zum Liegenschaftsunterhalt.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Private Krankenversicherungsprämien | Bezahlte Versicherungsprämien und Zinsen von Sparkapitalien | `insurancePremiumsPrivateHealthInsurance:Input` | Betrag | ganze Franken; Code 601. | — | — | `versicherungspraemien` |
| Private Unfallversicherungsprämien | Bezahlte Versicherungsprämien und Zinsen von Sparkapitalien | `insurancePremiumsPrivateAccidentInsurance:Input` | Betrag | ganze Franken; Code 602. | — | — | `versicherungspraemien` |
| Private Lebens- und Rentenversicherungsprämien | Bezahlte Versicherungsprämien und Zinsen von Sparkapitalien | `insurancePremiumsPrivateLifeAndPensionInsurance:Input` | Betrag | ganze Franken; Code 603. | — | — | `versicherungspraemien` |
| Zinsen von Sparkapitalien | Bezahlte Versicherungsprämien und Zinsen von Sparkapitalien | `insurancePremiumsInterestSavings:Input` | Betrag | ganze Franken; Code 604. | — | — | `versicherungspraemien` |
| Abzüglich erhaltene Prämienverbilligungen | Bezahlte Versicherungsprämien und Zinsen von Sparkapitalien | `insurancePremiumsDeductionsPremiumsReduction:Input` | Betrag | ganze Franken | — | — | `versicherungspraemien` |
| Beleg hochladen: Private Krankenversicherungsprämien | Bezahlte Versicherungsprämien | `attachment_file601` | Upload | — | — | ja | — |


### Abzüge › Krankheits- und Unfallkosten

**Route:** `#/<sitzung>/tax-assistant/deductions/disease-accident-expenses`  
**Navigation:** Seitenleiste › Abzüge › Krankheits- und Unfallkosten  

> Ziff. 22.1 / Code 320; Selbstbehalt 5 % von Ziff. 21 wird automatisch abgezogen. ACHTUNG: die zwei Dropdowns «Art» tragen die id "undefined" – sie sind NICHT über eine id ansteuerbar, nur über button.atm-form_input__input--trigger in der Reihenfolge des Abschnitts.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Selbstbehalt gemäss Abrechnung Krankenkasse/Versicherung | Aufwendungen | `diseaseAndAccidentExpensesExpenseFranchise:Input` | Betrag | ganze Franken; Code 300. | — | — | `krankheitskosten` |
| Art (weitere Aufwendungen) | In obigem Selbstbehalt NICHT enthaltene, weitere Aufwendungen | `undefined` | Auswahl | Auswahl: Arzt und vom Arzt verordnete Medikamente (301) · Zahnarztkosten (302) · Pflegepersonal (303) · Kosten für Aufenthalt in Spitälern und Heilstätten usw. (304) · Ärztlich verordnete Therapien, Kuraufenthalte usw. (305); PORTALFEHLER: id ist wörtlich "undefined". Selektor nur über Position: document.querySelectorAll("button.atm-form_input__input--trigger")[0]. | — | — | — |
| Betrag CHF (weitere Aufwendungen) | In obigem Selbstbehalt NICHT enthaltene, weitere Aufwendungen | `diseaseAndAccidentExpensesExpenseFreeTextAmount:Input` | Betrag | ganze Franken; Code 307. | — | — | `krankheitskosten` |
| Beschreibung weitere Aufwendungen | In obigem Selbstbehalt NICHT enthaltene, weitere Aufwendungen | `diseaseAndAccidentExpensesExpenseFreeText:Input` | Text | max. 104 Z. | — | — | — |
| Art (Vergütungen Dritter) | Vergütungen Dritter und Anteil Lebenshaltungskosten | `undefined` | Auswahl | Auswahl: Anteil Lebenshaltungskosten (z.B. Ernährung) (311) · Weitere Vergütungen (312); PORTALFEHLER: id "undefined"; zweiter Trigger-Knopf auf der Maske. | — | — | — |
| Betrag CHF (Vergütungen Dritter) | Vergütungen Dritter und Anteil Lebenshaltungskosten | `diseaseAndAccidentExpensesAllowanceInsurance:Input` | Betrag | ganze Franken; Code 308 – kürzt die Auslagen. | — | — | `krankheitskosten` |
| Pauschale (D) | Pauschale | `diseaseAndAccidentExpensesTotalAmountExpensesFlatrate:Input` | Betrag | ganze Franken; Code 315. | — | — | — |

#### Zeilenliste: Die Kosten wurden für folgende Personen aufgewendet

**So entsteht eine Zeile:** drei feste Zeilen (0–2), zusätzlich «Weitere Zeile hinzufügen»  
**id-Muster:** `<feld>:diseaseAndAccidentExpensesConcernedPerson::<zeile>:Input`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Vorname | `diseaseAndAccidentExpensesConcernedPersonFirstName:diseaseAndAccidentExpensesConcernedPerson::0:Input` | Text | max. 40 Z. | — | — | — |
| Name | `diseaseAndAccidentExpensesConcernedPersonOfficialName:diseaseAndAccidentExpensesConcernedPerson::0:Input` | Text | max. 50 Z. | — | — | — |
| Wohn-/Aufenthaltsort | `diseaseAndAccidentExpensesConcernedPersonLocation:diseaseAndAccidentExpensesConcernedPerson::0:Input` | Text | max. 62 Z. | — | — | — |


### Abzüge › Behinderungsbedingte Kosten

**Route:** `#/<sitzung>/tax-assistant/deductions/handicap-expenses`  
**Navigation:** Seitenleiste › Abzüge › Behinderungsbedingte Kosten  

> Ziff. 16.4. Auch hier zwei Dropdowns «Art» mit id "undefined".

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Betrag CHF (effektive Aufwendungen) | Effektive Aufwendungen | `handicapExpensesExpenseIVAllowances:Input` | Betrag | ganze Franken | — | — | `behinderungskosten` |
| Art (effektive Aufwendungen) | Effektive Aufwendungen | `undefined` | Auswahl | PORTALFEHLER: id "undefined". | — | — | — |
| Betrag CHF (Vergütungen Dritter) | Vergütungen Dritter und Anteil Lebenshaltungskosten | `handicapExpensesAllowanceFreeTextAmount:Input` | Betrag | ganze Franken | — | — | `behinderungskosten` |
| Beschreibung weitere Vergütungen | Vergütungen Dritter und Anteil Lebenshaltungskosten | `handicapExpensesAllowanceFreeText:Input` | Text | max. 106 Z. | — | — | — |
| Art (Vergütungen Dritter) | Vergütungen Dritter und Anteil Lebenshaltungskosten | `undefined` | Auswahl | PORTALFEHLER: id "undefined". | — | — | — |
| Pauschale, Art (D) | Pauschale | `handicapExpensesTotalAmountDeductionFlatrateDescription:Input` | Text | max. 86 Z. | — | — | — |
| Pauschale – Betrag | Pauschale | `handicapExpensesTotalAmountDeductionFlatrate:Input` | Betrag | ganze Franken | — | — | `behinderungskosten` |

#### Zeilenliste: Die Kosten wurden für folgende Personen aufgewendet

**So entsteht eine Zeile:** vier feste Zeilen (0–3), zusätzlich «Weitere Zeile hinzufügen»; «Zeile leeren»  
**id-Muster:** `<feld>:handicapExpensesConcernedPersonHandicap::<zeile>:Input`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Vorname | `handicapExpensesConcernedPersonHandicapFirstName:handicapExpensesConcernedPersonHandicap::0:Input` | Text | max. 38 Z. | — | — | — |
| Name | `handicapExpensesConcernedPersonHandicapOfficialName:handicapExpensesConcernedPersonHandicap::0:Input` | Text | max. 42 Z. | — | — | — |
| Wohn-/Aufenthaltsort | `handicapExpensesConcernedPersonHandicapLocation:handicapExpensesConcernedPersonHandicap::0:Input` | Text | max. 36 Z. | — | — | — |
| Art der Behinderung | `handicapExpensesConcernedPersonHandicapHandicap:handicapExpensesConcernedPersonHandicap::0:Input` | Text | max. 32 Z. | — | — | — |


### Abzüge › Gemeinnützige Zuwendungen

**Route:** `#/<sitzung>/tax-assistant/deductions/revenue-calculation-deduction-charity-detail`  
**Navigation:** Seitenleiste › Abzüge › Gemeinnützige Zuwendungen  

> Ziff. 22.2 / Code 324.

#### Zeilenliste: Gemeinnützige Zuwendungen

**So entsteht eine Zeile:** leere WR-Zeile ausfüllen; «Zeile leeren»  
**id-Muster:** `<feld>WR:revenueCalculationDeductionCharityDetail::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Datum | `revenueCalculationDeductionCharityDetailDateWR:revenueCalculationDeductionCharityDetail::DatePicker` | Datum | TT.MM.JJJJ | — | — | `spenden` |
| Bezeichnung | `revenueCalculationDeductionCharityDetailDescriptionWR:revenueCalculationDeductionCharityDetail::Input` | Text | max. 130 Z. | — | — | `spenden` |
| Betrag | `revenueCalculationDeductionCharityDetailAmountCantonalTaxWR:revenueCalculationDeductionCharityDetail::Input` | Betrag | ganze Franken | — | — | `spenden` |


### Abzüge › Weitere Abzüge

**Route:** `#/<sitzung>/tax-assistant/deductions/deduction-further-deduction`  
**Navigation:** Seitenleiste › Abzüge › Weitere Abzüge  

> Drei getrennte Blöcke plus «Automatische Abzüge» (Sonderabzug bei Erwerbstätigkeit beider Ehegatten, Abzug für Ehegatten Bundessteuer, Pauschalabzug Vermögensverwaltung) – letztere werden vom Portal gerechnet.

#### Zeilenliste: Kosten für die Verwaltung des beweglichen Privatvermögens

**So entsteht eine Zeile:** leere WR-Zeile / «Weitere Zeile hinzufügen»  
**id-Muster:** `<feld>WR:deductionFurtherDeductionFinancialManagementDetail::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Bezeichnung | `deductionFurtherDeductionFinancialManagementDetailDescriptionWR:deductionFurtherDeductionFinancialManagementDetail::Input` | Text | — | — | — | `uebrige_abzuege` |
| Betrag | `deductionFurtherDeductionFinancialManagementDetailAmountCantonalWR:deductionFurtherDeductionFinancialManagementDetail::Input` | Betrag | ganze Franken; Ziff. 16.3 / Code 283. Pauschalabzug rechnet das Portal selbst. | — | — | `uebrige_abzuege` |

#### Zeilenliste: Übrige weitere Abzüge

**So entsteht eine Zeile:** leere WR-Zeile  
**id-Muster:** `<feld>WR:deductionFurtherDeductionFreeTextDetail::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Art | `deductionFurtherDeductionFreeTextDetailKindWR:deductionFurtherDeductionFreeTextDetail::Select` | Auswahl | Auswahl: (leer) · Sonstige Abzüge · NBU-Abzüge Person 1 · NBU-Abzüge Person 2 · Diff. Grundstückgewinn Person 1 · Diff. Grundstückgewinn Person 2 · Realisierte stille Reserven Person 1 · Realisierte stille Reserven Person 2 · Einsatzkosten Lotteriegewinn · Diff. Freibetrag Feuerwehrsold Person 1 · Diff. Freibetrag Feuerwehrsold Person 2 · Patente, Forschung & Entwicklung Person 1 · Patente, Forschung & Entwicklung Person 2 | — | — | `uebrige_abzuege` |
| Bezeichnung | `deductionFurtherDeductionFreeTextDetailDescriptionWR:deductionFurtherDeductionFreeTextDetail::Input` | Text | max. 114 Z. | — | — | `uebrige_abzuege` |
| Staatssteuer | `deductionFurtherDeductionFreeTextDetailAmountCantonalTaxWR:deductionFurtherDeductionFreeTextDetail::Input` | Betrag | ganze Franken; Ziff. 16.5 / Code 284. | — | — | `uebrige_abzuege` |
| Bundessteuer | `deductionFurtherDeductionFreeTextDetailAmountFederalTaxWR:deductionFurtherDeductionFreeTextDetail::Input` | Betrag | ganze Franken | — | ja | — |

#### Zeilenliste: Beiträge an politische Parteien

**So entsteht eine Zeile:** leere WR-Zeile  
**id-Muster:** `<feld>WR:deductionFurtherDeductionPoliticalPartyDetail::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Datum | `deductionFurtherDeductionPoliticalPartyDetailDateWR:deductionFurtherDeductionPoliticalPartyDetail::DatePicker` | Datum | TT.MM.JJJJ | — | — | `parteispenden` |
| Bezeichnung | `deductionFurtherDeductionPoliticalPartyDetailDescriptionWR:deductionFurtherDeductionPoliticalPartyDetail::Input` | Text | max. 130 Z. | — | — | `parteispenden` |
| Betrag CHF | `deductionFurtherDeductionPoliticalPartyDetailAmountWR:deductionFurtherDeductionPoliticalPartyDetail::Input` | Betrag | ganze Franken; Läuft in Ziff. 16.5 / Code 284. | — | — | `parteispenden` |


### Wertschriften › Wertschriftenverzeichnis

**Route:** `#/<sitzung>/tax-assistant/securities/security-list`  
**Navigation:** Seitenleiste › Wertschriften › Wertschriftenverzeichnis  

> Tabelle mit den Spalten: Bezeichnung / Valoren-Nr. | Nennwert / Stückzahl | Steuerwert CHF | Ertrag CHF | Schaltfläche Bearbeiten/Löschen. Neue Zeile über den geteilten Knopf «+ Wertschrift hinzufügen ▾» mit VIER Zeilenarten (siehe unten). BEOBACHTETER PORTALFEHLER: wird die Maske aus einer anderen Gruppe heraus direkt angesprungen, bleibt der Inhalt manchmal leer (Konsole: «Cannot read properties of undefined (reading 'da1List')»). Abhilfe: zuerst «Angaben zum DA-1 Formular» öffnen, danach das Wertschriftenverzeichnis.

#### Zeilenliste: Wertschriftenzeile – Auswahl der Art

**So entsteht eine Zeile:** «+ Wertschrift hinzufügen» (Standardaktion) bzw. Pfeil daneben mit den Einträgen: Bankkonto · eSteuerauszug/Depot · Wertschrift und Guthaben · Wertschrift mit ausländischer Quellensteuer (Formular DA-1)  
**id-Muster:** `Anzeige-Zeilen im Formulareditor: <feld>:listOfSecurities::<zeile>:Input (alle schreibgeschützt)`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Bezeichnung / Valoren-Nr. | `securitiesSecuritiesNumber:listOfSecurities::0:Input` | Text | — | — | ja | — |
| Nennwert / Stückzahl | `securitiesFaceValueQuantity:listOfSecurities::0:Input` | Zahl | — | — | ja | — |
| Steuerwert CHF | `securitiesTaxValueEndOfYear:listOfSecurities::0:Input` | Betrag | ganze Franken | — | ja | `wertschriften` |
| Bruttoertrag A (mit VSt) | `securitiesGrossRevenueA:listOfSecurities::0:Input` | Betrag | ganze Franken | — | ja | `wertschriften` |
| Bruttoertrag B (ohne VSt) | `securitiesGrossRevenueB:listOfSecurities::0:Input` | Betrag | ganze Franken | — | ja | `wertschriften` |


### Wertschriften › Wertschriftenzeile – Art «Bankkonto» / «Steuerauszug/Depot» (Dialog)

**Route:** `#/<sitzung>/dialogs/securities/securities-detail`  
**Navigation:** «+ Wertschrift hinzufügen ▾» › «Bankkonto» bzw. «eSteuerauszug/Depot» › «Steuerauzug/Depot hinzufügen»; bestehende Zeile: Stift in der Tabelle  

> DAS ist die Maske für unsere Position «Konto / Depot / Titel»: EIN Beleg, drei Ziele – Steuerwert, Bruttoertrag A (mit VSt) und Bruttoertrag B (ohne VSt). Der Verrechnungssteuer-Anspruch (35 % von A) wird vom Portal gerechnet (Code 540). Bei der Art «Bankkonto» fehlt der Abschnitt «Zugehörigkeit in %» – eine Aufteilung auf Person 1/2 ist dort NICHT möglich; bei «Steuerauszug/Depot» und «Wertschrift und Guthaben» ist sie vorhanden.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Bank, Gesellschaft | Basisdaten erfassen | `securitiesWAEnteredDescription:Input` | Text | max. 50 Z. | ja | — | `wertschriften` |
| Konto-/Depot-Nr. | Basisdaten erfassen | `securitiesWAAccountNumber:Input` | Text | max. 42 Z.; Katalog-Dimension «konto». | — | — | `wertschriften` |
| Staat | Basisdaten erfassen | `securitiesWACountry:Select` | Auswahl | Auswahl: 257 Einträge, Kopf: CH Schweiz, AU, BE, DK, DE, FI, FR, GB, IT, JP, CA, LU, NZ, NL, NO, AT, PT, SE, ES, TH, US, dann alphabetisch | — | — | — |
| Bezeichnung | Basisdaten erfassen | `securitiesWAAccountDescription:Input` | Text | max. 20 Z. | — | — | `wertschriften` |
| Geschäftsvermögen | Angaben zum Wertpapier | `securitiesWAIsBusinessAssets:Checkbox` | Häkchen | — | — | — | — |
| Nutzniessungsvermögen | Angaben zum Wertpapier | `securitiesWAIsUsufructuary:Checkbox` | Häkchen | — | — | — | — |
| Zugangsart | Zugehörigkeit in % | `securitiesWAAccrualKind:Select` | Auswahl | Auswahl: Erbschaft · Schenkung | — | — | — |
| Zugehörigkeit Person 1 (%) | Zugehörigkeit in % | `securitiesWASharePartner1:Input` | Zahl | HIER sitzt die Katalog-Dimension «person». Fehlt bei der Art «Bankkonto». | — | — | `wertschriften` |
| Zugehörigkeit Person 2 (%) | Zugehörigkeit in % | `securitiesWASharePartner2:Input` | Zahl | — | — | — | `wertschriften` |
| Währung | Steuerwert | `securitiesWAOriginalCurrency:Select` | Auswahl | Auswahl: 150 Einträge, Kopf: CHF Franken, AUD, CAD, DKK, EUR, GBP, JPY, NZD, NOK, RUB, SEK, SGD, ZAR, USD | — | — | — |
| Total Guthaben / Total Steuerwert | Steuerwert | `securitiesWATaxValueOriginalCurrency:Input` | Betrag | ganze Franken; Vermögensseite; fliesst in Ziff. 30.1 / Code 400. | ja | — | `wertschriften` |
| VSt. auf Ertrag bis und mit CHF 200 | Ertrag | `securitiesWASuppressWithholdingWarning:Checkbox` | Häkchen | Nur bei der Art «Bankkonto»; unterdrückt die Warnung bei Kleinerträgen. | — | — | — |
| Ertrag mit Verrechnungssteuer (A) | Ertrag | `securitiesWAForeignGrossRevenueA:Input` | Betrag | ganze Franken; Grundlage für den Verrechnungssteuer-Antrag (35 %). | — | — | `wertschriften` |
| Ertrag ohne Verrechnungssteuer (B) | Ertrag | `securitiesWAForeignGrossRevenueB:Input` | Betrag | ganze Franken | — | — | `wertschriften` |
| Datum bei Eröffnung im Steuerjahr | Weitere Angaben | `securitiesWAIssue:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Datum bei Saldierung im Steuerjahr | Weitere Angaben | `securitiesWARedemption:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Bemerkungen (max. 66 Zeichen) | Weitere Angaben | `securitiesWAObservations:Input` | Text | max. 66 Z. | — | — | — |
| Beleg hochladen: Wertschrift | Weitere Angaben | `attachment_file2300` | Upload | — | — | ja | — |


### Wertschriften › Wertschriftenzeile – Art «Wertschrift und Guthaben» (Dialog)

**Route:** `#/<sitzung>/dialogs/securities/securities-detail (davor dialogs/securities/securities-search)`  
**Navigation:** «+ Wertschrift hinzufügen ▾» › «Wertschrift und Guthaben» › Kurslistensuche › entweder Treffer wählen oder Knopf «Manuell erfassen»  

> Vorgeschaltet ist die ESTV-Kurslistensuche (dialogs/securities/securities-search) mit den Feldern filterSecurityId (Valoren-Nr.), filterISINNumber, filterSecurityName sowie – nach «Erweiterte Suche» – includeShares / includeFonds / includeDevts / includeBonds / includeCurrNoteTokens (Häkchen), filterCurrency, filterInterest, filterEmissionYear, filterRedemptionYear.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Art | Basisdaten erfassen | `categorySelect` | Auswahl | Auswahl: Aktie · Anlagefonds · Darlehen · Derivat · Festgeld-/Treuhandanlage · Genossenschaftsanteil · Genussschein · GmbH-Anteil · Guthaben Anteil · Kassenobligation · Kryptowährung · Lotterie-/Geldspielgewinne · Obligation · Option · Partizipationsschein · Vergütungs-/Ausgleichszins · Wandelanleihe · Übrige; Kryptowährungen laufen über diese Art – NICHT über Bargeld. Selektor [id="categorySelect"]. | — | — | `krypto` |
| Valoren-Nr. | Basisdaten erfassen | `securitiesWASecuritiesNumber:Input` | Text | — | — | — | — |
| ISIN | Basisdaten erfassen | `securitiesWAISINNumber:Input` | Text | max. 20 Z. | — | — | — |
| Gesellschaft, Titel | Basisdaten erfassen | `securitiesWAEnteredDescription:Input` | Text | max. 50 Z. | ja | — | `wertschriften` |
| Staat | Basisdaten erfassen | `securitiesWACountry:Select` | Auswahl | — | — | — | — |
| Geschäftsvermögen | Angaben zum Wertpapier | `securitiesWAIsBusinessAssets:Checkbox` | Häkchen | — | — | — | — |
| Nutzniessungsvermögen | Angaben zum Wertpapier | `securitiesWAIsUsufructuary:Checkbox` | Häkchen | — | — | — | — |
| Qualifizierte Beteiligung | Angaben zum Wertpapier | `securitiesWAIsQualifiedParticipation:Checkbox` | Häkchen | Speist Ziff. 4.2 / Code 151 und das Formular «Qualifizierte Beteiligungen im Privatvermögen». | — | — | `beteiligung_qualifiziert` |
| Zugangsart | Zugehörigkeit in % | `securitiesWAAccrualKind:Select` | Auswahl | Auswahl: Erbschaft · Schenkung | — | — | — |
| Zugehörigkeit Person 1 (%) | Zugehörigkeit in % | `securitiesWASharePartner1:Input` | Zahl | — | — | — | `wertschriften` |
| Zugehörigkeit Person 2 (%) | Zugehörigkeit in % | `securitiesWASharePartner2:Input` | Zahl | — | — | — | `wertschriften` |
| Endbestand Vorjahr / Anfangsbestand Steuerjahr | Anfangsbestand per 01.01. | `securitiesWAFaceValueQuantityPreviousYear:Input` | Zahl | — | — | — | — |
| Schieber: Zu- oder Abgänge erfassen | Steuerwert | `slider_securitiesWAHasAdditionDivestitureDetailZu- oder Abgänge erfassen` | Häkchen | — | — | — | — |
| Mitarbeiter-Titel | Endbestand per 31.12. | `securitiesWABlocked:Checkbox` | Häkchen | — | — | — | — |
| Währung | Endbestand per 31.12. | `securitiesWAOriginalCurrency:Select` | Auswahl | — | — | — | — |
| Stückzahl | Endbestand per 31.12. | `securitiesWAFaceValueQuantity:Input` | Zahl | — | ja | — | — |
| Steuerwert pro Stück | Endbestand per 31.12. | `securitiesWATaxValueBase:Input` | Betrag | ganze Franken | — | — | — |
| Steuerwert | Endbestand per 31.12. | `securitiesWATaxValueOriginalCurrency:Input` | Betrag | ganze Franken | ja | — | `wertschriften` |
| Schieber: Es sind in der Steuerperiode Erträge erzielt worden | Ertrag | `slider_securitiesWAHasRevenueDetailEs sind in der Steuerperiode Erträge erzielt worden` | Häkchen | — | — | — | — |
| Bemerkungen (max. 66 Zeichen) | Weitere Angaben | `securitiesWAObservations:Input` | Text | max. 66 Z. | — | — | — |
| Beleg hochladen: Wertschrift | Weitere Angaben | `attachment_file2300` | Upload | — | — | ja | — |

#### Zeilenliste: Ertrag (Dividenden/Zinsen)

**So entsteht eine Zeile:** «Ertrag hinzufügen» (erscheint erst, wenn der Schieber «Erträge erzielt» an ist)  
**id-Muster:** `<feld>:securitiesWARevenueDetail::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Ex-Datum | `securitiesWARevenueDetailExDate:securitiesWARevenueDetail::0:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Zahlbar-Datum | `securitiesWARevenueDetailDueDate:securitiesWARevenueDetail::0:DatePicker` | Datum | TT.MM.JJJJ | ja | — | — |
| Stückzahl per Fälligkeit | `securitiesWARevenueDetailFaceValueQuantityAtDueDate:securitiesWARevenueDetail::0:Input` | Zahl | — | — | — | — |
| Ertrag pro Stück | `securitiesWARevenueDetailBaseOriginalCurrency:securitiesWARevenueDetail::0:Input` | Betrag | ganze Franken | — | — | `wertschriften` |
| VSt. (mit/ohne) | `securitiesWARevenueDetailWithHoldingTax:securitiesWARevenueDetail::0:Select` | Auswahl | Auswahl: ohne · mit; HIER entscheidet sich Spalte A oder B und damit der Verrechnungssteuer-Antrag. | — | — | `wertschriften` |

#### Zeilenliste: Zu- & Abgänge

**So entsteht eine Zeile:** «Zu- & Abgang hinzufügen» (nach Schieber «Zu- oder Abgänge erfassen»)  
**id-Muster:** `<feld>:securitiesWAAdditionDivestitureDetail::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Art/Grund | `securitiesWAAdditionDivestitureDetailReason:securitiesWAAdditionDivestitureDetail::0:Select` | Auswahl | Auswahl: Kauf · Gratisaktie/Stockdividende (Zugang) · Aufteilung (Zugang) · Fusion (Zugang) · Abspaltung (Zugang) · Schenkung (Zugang) · Erbfall/Vorempfang (Zugang) · Verkauf · Schenkung (Abgang) · Aufteilung (Abgang) · Fusion/Umtausch (Abgang) · Aktienrückgabe · Indirekte Teilliquidation · Vorempfang (Abgang) | — | — | — |
| Datum | `securitiesWAAdditionDivestitureDetailDate:securitiesWAAdditionDivestitureDetail::0:DatePicker` | Datum | TT.MM.JJJJ | ja | — | — |
| Stückzahl | `securitiesWAAdditionDivestitureDetailFaceValueQuantity:securitiesWAAdditionDivestitureDetail::0:Input` | Zahl | — | ja | — | — |


### Wertschriften › Wertschriftenzeile – Art «Wertschrift mit ausländischer Quellensteuer (DA-1)» (Dialog)

**Route:** `#/<sitzung>/dialogs/securities/da-1-detail (davor dialogs/securities/da1-search)`  
**Navigation:** «+ Wertschrift hinzufügen ▾» › «Wertschrift mit ausländischer Quellensteuer (Formular DA-1)» › «Manuell erfassen»  

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Art | Basisdaten erfassen | `categorySelect` | Auswahl | Auswahl: Aktie · Anlagefonds · Darlehen · Genussschein · Konto · Obligation · Steuerauszug/Depot | — | — | — |
| Valoren-Nr. | Basisdaten erfassen | `da1WASecuritiesNumber:Input` | Text | — | — | — | — |
| ISIN | Basisdaten erfassen | `da1WAISINNumber:Input` | Text | — | — | — | — |
| Gesellschaft, Titel | Basisdaten erfassen | `da1WAEnteredDescription:Input` | Text | — | — | — | — |
| Staat | Basisdaten erfassen | `da1WACountry:Select` | Auswahl | — | — | — | — |
| Ertragsart | Basisdaten erfassen | `da1WAPaymentType:Select` | Auswahl | Auswahl: Zinserträge · Dividendenerträge · Renten | — | — | — |
| Stückzahl (Anfangsbestand) | Anfangsbestand per 01.01. | `da1WAFaceValueQuantityPreviousYear:Input` | Zahl | — | — | — | — |
| Währung | Endbestand per 31.12. | `da1WAOriginalCurrency:Select` | Auswahl | — | — | — | — |
| Stückzahl | Endbestand per 31.12. | `da1WAFaceValueQuantity:Input` | Zahl | — | — | — | — |
| Steuerwert pro Stück | Endbestand per 31.12. | `da1WATaxValueBase:Input` | Betrag | ganze Franken | — | — | — |
| Total Steuerwert | Endbestand per 31.12. | `da1WATaxValueOriginalCurrency:Input` | Betrag | ganze Franken | — | — | `wertschriften` |
| Schieber: Zu- oder Abgänge erfassen | Steuerwert | `slider_da1WAHasAdditionDivestitureDetailZu- oder Abgänge erfassen` | Häkchen | — | — | — | — |
| Schieber: Es sind in der Steuerperiode Erträge erzielt worden | Ertrag | `slider_da1WAHasRevenueDetailEs sind in der Steuerperiode Erträge erzielt worden` | Häkchen | — | — | — | — |
| Bemerkungen (max. 66 Zeichen) | Weitere Angaben | `da1WAObservations:Input` | Text | max. 66 Z. | — | — | — |
| Beleg hochladen: DA-1 Wertschrift | Weitere Angaben | `attachment_file4100` | Upload | — | — | ja | — |

#### Zeilenliste: Ertrag DA-1

**So entsteht eine Zeile:** «Ertrag hinzufügen»  
**id-Muster:** `<feld>:da1WARevenueDetail::<zeile>:<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Ex-Datum | `da1WARevenueDetailExDate:da1WARevenueDetail::0:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Zahlbar-Datum | `da1WARevenueDetailDueDate:da1WARevenueDetail::0:DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Ertrag pro Stück | `da1WARevenueDetailBaseOriginalCurrency:da1WARevenueDetail::0:Input` | Betrag | ganze Franken | — | — | — |
| Ertrag (CHF) | `da1WARevenueDetailRevenueCHF:da1WARevenueDetail::0:Input` | Betrag | ganze Franken | — | — | `wertschriften` |
| Schieber: Ausl. Quellensteuer anrechnen lassen | `slider_da1WARevenueDetailStockDividendAusl. Quellensteuer anrechnen lassen` | Häkchen | — | — | — | — |


### Wertschriften › eSteuerauszug importieren (Dialog)

**Route:** `#/<sitzung>/dialogs/securities/load-tax-statement`  
**Navigation:** «+ Wertschrift hinzufügen ▾» › «eSteuerauszug/Depot»  

> Datei-Ablage/-Auswahl für den eSteuerauszug mit Barcode. In der Demo wird durch «Datei auswählen» ein Demo-Auszug importiert – in dieser Aufnahme NICHT ausgelöst. Zweiter Weg auf derselben Maske: «Steuerauzug/Depot hinzufügen» (Schreibweise so im Portal) für Depots ohne Barcode; das führt in den Dialog securities-detail (Art «Steuerauszug/Depot»).

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Datei hier reinziehen / Datei auswählen | eSteuerauszug importieren | `estaus-upload` | Upload | input type=file. Nicht durch den Assistenten bedienen. | — | — | — |


### Wertschriften › Angaben zum DA-1 Formular

**Route:** `#/<sitzung>/tax-assistant/securities/da1-data`  
**Navigation:** Seitenleiste › Wertschriften › Angaben zum DA-1 Formular  

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Wohnsitz am 01.01. | Persönliche Angaben | `da1DomicileBeginningOfYear:Input` | Text | max. 20 Z. | — | — | — |
| Wohnsitz am 31.12. | Persönliche Angaben | `da1DomicileEndOfYear:Input` | Text | max. 20 Z. | — | — | — |
| Erträge aus Gemeinschaftsdepot/Erbanfall? – Ja | Persönliche Angaben | `da1EarningsCommunity:RadioJa` | Radio | — | — | — | — |
| Erträge aus Gemeinschaftsdepot/Erbanfall? – Nein | Persönliche Angaben | `da1EarningsCommunity:RadioNein` | Radio | — | — | — | — |
| US-Erträge enthalten? – Ja | Persönliche Angaben | `da1CitizenshipUSA:RadioJa` | Radio | — | — | — | — |
| US-Erträge enthalten? – Nein | Persönliche Angaben | `da1CitizenshipUSA:RadioNein` | Radio | — | — | — | — |
| Kontoangaben aus «Bankverbindung für Rückerstattungen» übernehmen | DA-1 Kontoangaben | `da1BankAccountIsFromWV:Checkbox` | Häkchen | — | — | — | — |
| IBAN-Nr. | DA-1 Kontoangaben | `da1BankAccountIbanNumber:Input` | Text | max. 42 Z.; Bankkontonummer – nur durch Sascha. | — | — | — |
| Konto lautend auf | DA-1 Kontoangaben | `da1BankAccountAccountOwner:Input` | Text | max. 24 Z.; Nur durch Sascha. | — | — | — |


### Vermögen › Bewegliches Vermögen

**Route:** `#/<sitzung>/tax-assistant/assets/asset-movable-property`  
**Navigation:** Seitenleiste › Vermögen › Bewegliches Vermögen  

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Bargeld, Gold und andere Edelmetalle – Betrag | Bargeld, Gold und andere Edelmetalle | `assetMovablePropertyCashValueFiscalValue:Input` | Betrag | ganze Franken; Ziff. 30.2 / Code 404. Krypto gehört NICHT hierher. | — | — | `bargeld` |
| Übrige Vermögenswerte – Nähere Bezeichnung | Übrige Vermögenswerte | `assetMovablePropertyFreeText:Input` | Text | max. 60 Z. | — | — | `uebriges_vermoegen` |
| Übrige Vermögenswerte – Betrag | Übrige Vermögenswerte | `assetMovablePropertyFreeTextAmountFiscalValue:Input` | Betrag | ganze Franken; Ziff. 30.6 / Code 416. | — | — | `uebriges_vermoegen` |

#### Zeilenliste: Geschäfts- und Korporationsanteile

**So entsteht eine Zeile:** «Geschäfts-/ Korporationsanteil hinzufügen» (dieselbe Liste wie unter «Übrige Einkünfte»)  
**id-Muster:** `<feld>WR:inheritanceEtcDetail::<Art>`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Datum | `inheritanceEtcDetailDateWR:inheritanceEtcDetail::DatePicker` | Datum | TT.MM.JJJJ | — | — | — |
| Genaue Bezeichnung | `inheritanceEtcDetailDescriptionWR:inheritanceEtcDetail::Input` | Text | max. 68 Z. | — | — | — |
| Vermögen Betrag | `inheritanceEtcDetailAssetWR:inheritanceEtcDetail::Input` | Betrag | ganze Franken | — | — | `uebriges_vermoegen` |
| Einkommen Betrag | `inheritanceEtcDetailRevenueWR:inheritanceEtcDetail::Input` | Betrag | ganze Franken | — | — | `uebrige_einkuenfte` |


### Vermögen › Lebens- und Rentenversicherungen

**Route:** `#/<sitzung>/tax-assistant/assets/asset-movable-property-life-insurances`  
**Navigation:** Seitenleiste › Vermögen › Lebens- und Rentenversicherungen  

> Ziff. 30.3 / Code 406. Drei Zeilen sind vorgegeben.

#### Zeilenliste: Lebens-/Rentenversicherung

**So entsteht eine Zeile:** «Neue Versicherung hinzufügen»; «Zeile löschen»  
**id-Muster:** `<feld>:assetMovablePropertyLifeInsurances::<zeile>:Input`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Versicherungsgesellschaft | `assetMovablePropertyLifeInsurancesCompany:assetMovablePropertyLifeInsurances::0:Input` | Text | max. 40 Z. | — | — | `lebensversicherung` |
| Abschlussjahr | `assetMovablePropertyLifeInsurancesFixtureYear:assetMovablePropertyLifeInsurances::0:Input` | Zahl | — | — | — | `lebensversicherung` |
| Ablaufjahr | `assetMovablePropertyLifeInsurancesExpirationYear:assetMovablePropertyLifeInsurances::0:Input` | Zahl | — | — | — | `lebensversicherung` |
| Steuerwert (Rückkaufswert) | `assetMovablePropertyLifeInsurancesFiscalValue:assetMovablePropertyLifeInsurances::0:Input` | Betrag | ganze Franken | — | — | `lebensversicherung` |


### Vermögen › Motorfahrzeuge

**Route:** `#/<sitzung>/tax-assistant/assets/asset-movable-property-vehicles`  
**Navigation:** Seitenleiste › Vermögen › Motorfahrzeuge  

> Ziff. 30.4 / Code 412.

#### Zeilenliste: Motorfahrzeug

**So entsteht eine Zeile:** «Neues Motorfahrzeug hinzufügen»; «Zeile leeren»  
**id-Muster:** `<feld>:assetMovablePropertyVehicleDetails::<zeile>:Input`

| Spalte | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| Bezeichnung | `assetMovablePropertyVehicleDetailDescription:assetMovablePropertyVehicleDetails::0:Input` | Text | max. 34 Z. | — | — | `fahrzeuge` |
| Kaufjahr | `assetMovablePropertyVehicleDetailYear:assetMovablePropertyVehicleDetails::0:Input` | Zahl | — | — | — | `fahrzeuge` |
| Kaufpreis | `assetMovablePropertyVehicleDetailPurchasePrice:assetMovablePropertyVehicleDetails::0:Input` | Betrag | ganze Franken | — | — | `fahrzeuge` |
| Steuerwert | `assetMovablePropertyVehicleDetailFiscalValue:assetMovablePropertyVehicleDetails::0:Input` | Betrag | ganze Franken | — | — | `fahrzeuge` |


### Abschluss › Steuerausscheidung

**Route:** `#/<sitzung>/tax-assistant/finish/tax-separation`  
**Navigation:** Seitenleiste › Abschluss › Steuerausscheidung  

> Enthält im Demo-Stand keine Eingabefelder; Abschnitt «Manuelle Steuerausscheidung» erscheint nur, wenn ausserkantonale/ausländische Faktoren vorliegen. Die dazugehörigen Formulare liegen im Formulareditor (Ausscheidungstabellen ATLS/ATV/ATE).

_Keine Erfassungsfelder._


### Abschluss › Bemerkungen

**Route:** `#/<sitzung>/tax-assistant/finish/commentary`  
**Navigation:** Seitenleiste › Abschluss › Bemerkungen  

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Bemerkungen zur Steuererklärung | Bemerkungen | `commentary:Input` | Text | max. 10000 Z. | — | — | — |


### Abschluss › Belege

**Route:** `#/<sitzung>/tax-assistant/finish/attachments`  
**Navigation:** Seitenleiste › Abschluss › Belege  

> Sammelstelle für Belege, die keinem einzelnen Feld zugeordnet sind. Vier Ablagefelder je Verzeichnis.

| Beschriftung | Abschnitt | technischer Name (id) | Typ | Format / Grenzen | Pflicht | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|---|
| Weitere Belege für Einkünfte | Einkünfte | `attachment_file9000:revenue0` | Upload | — | — | ja | — |
| Weitere Belege für Abzüge | Abzüge | `attachment_file9000:deductions0` | Upload | — | — | ja | — |
| Weitere Belege für Wertschriften | Wertschriften | `attachment_file9000:securities0` | Upload | — | — | ja | — |
| Weitere Belege für Vermögen | Vermögen | `attachment_file9000:assets0` | Upload | — | — | ja | — |


### Abschluss › Einreichen

**Route:** `#/<sitzung>/tax-assistant/finish/submit`  
**Navigation:** Seitenleiste › Abschluss › Einreichen  

> NICHT AUFGENOMMEN – bewusst nicht geöffnet, weil auf dieser Maske die endgültige Übermittlung ausgelöst wird. Muss bei Bedarf von Sascha selbst nachgetragen werden.

_Keine Erfassungsfelder._


---

## 4. Formulareditor – klassische Formulare mit Ziffer und Code

**Einstieg:** Übersicht › Hilfsmittel › «Formulareditor starten» → #/<sitzung>/tax-forms/home

> Der Formulareditor zeigt DIESELBEN Daten wie der Assistent – identische Feld-ids. Zusätzlich stehen dort Ziffer und amtlicher Code je Feld. Die meisten Felder sind schreibgeschützt, weil sie aus den Verzeichnissen gerechnet werden. Rückweg über den Link «Formulare» oben rechts.

### 4.1 Inhaltsverzeichnis des Formulareditors

- **Steuererklärung Hauptformular**
  - Personalien (STE1)
  - Einkünfte (STE2)
  - Abzüge (STE3)
  - Vermögen (STE4)
- **Zusatzformulare Abzüge**
  - Berufsauslagen P1 / P2
  - Schuldenverzeichnis
  - Versicherungsprämien und Sparzinsen
  - Berufsorientierte Aus- und Weiterbildungskosten
  - Behinderungsbedingte Kosten
  - Krankheits- und Unfallkosten
- **Zusatzformulare Einkünfte und Vermögen**
  - Wertschriftenverzeichnis: Kontoverbindung + Verzeichnis
  - Liegenschaftenverzeichnis: Verzeichnis + Einkünfte
  - DA-1: Antrag + Verzeichnis
- **Weitere Formulare**
  - Bemerkungen
  - Qualifizierte Beteiligungen im Privatvermögen
  - Hilfsblatt A mit kaufmännischer Buchführung (Haupt-/Nebenerwerb P1/P2, je Einkünfte + Kapital)
  - Hilfsblatt A mit vereinfachter Buchführung (Haupt-/Nebenerwerb P1/P2, je Warenlager/Abschreibungen, Schulden/Umsatz, Aufwand/Aktiven, Eigenkapital)
  - Interkantonale/Internationale Steuerausscheidung (Ausscheidungstabellen Liegenschaften/Vermögen/Einkommen)
  - Steuerberechnung
  - Berechnung des satzbestimmenden Einkommens bei unterjähriger Steuerpflicht

### 4.2 Routen

| Formular | Route |
|---|---|
| Hauptformular Seite 1 (Personalien) | `#/<sitzung>/tax-forms/tax-declaration/STE1` |
| Hauptformular Seite 2 (Einkünfte) | `#/<sitzung>/tax-forms/tax-declaration/STE2` |
| Hauptformular Seite 3 (Abzüge) | `#/<sitzung>/tax-forms/tax-declaration/STE3` |
| Hauptformular Seite 4 (Vermögen) | `#/<sitzung>/tax-forms/tax-declaration/STE4` |
| Wertschriftenverzeichnis | `#/<sitzung>/tax-forms/securities-register/page-1 (Kontoverbindung) / page-2 (Verzeichnis)` |
| Liegenschaftenverzeichnis | `#/<sitzung>/tax-forms/properties-register/page-1 (Verzeichnis) / page-2 (Einkünfte)` |
| Schuldenverzeichnis | `#/<sitzung>/tax-forms/debtors-list/page-1` |
| Berufsauslagen | `#/<sitzung>/tax-forms/professional-expenses/p1 bzw. /p2` |
| Versicherungsprämien und Sparzinsen | `#/<sitzung>/tax-forms/insurance-premium/page-1` |
| Berufsorientierte Aus- und Weiterbildungskosten | `#/<sitzung>/tax-forms/professional-training/page-1` |
| Behinderungsbedingte Kosten | `#/<sitzung>/tax-forms/due-disability-costs/page-1` |
| Krankheits- und Unfallkosten | `#/<sitzung>/tax-forms/sickness-accident-costs/page-1` |
| Qualifizierte Beteiligungen im Privatvermögen | `#/<sitzung>/tax-forms/shareholding/page-1` |
| DA-1 Antrag | `#/<sitzung>/tax-forms/da-1/page-1` |
| Bemerkungen | `#/<sitzung>/tax-forms/comment` |
| Interkantonale Steuerausscheidung | `#/<sitzung>/tax-forms/intercantonal/ATLS \| ATV \| ATE \| ATdB` |
| Steuerberechnung | `#/<sitzung>/tax-forms/tax-computation/SB1` |
| Unterjährige Steuerpflicht | `#/<sitzung>/tax-forms/during-the-year/UJ1 \| UJ2 \| UJ3` |
| Hilfsblatt A kaufmännische Buchführung | `#/<sitzung>/tax-forms/commercial-accounting/ca/p1\|p2/main-income\|main-assets\|side-income\|side-assets` |
| Hilfsblatt A vereinfachte Buchführung | `#/<sitzung>/tax-forms/single-entry-accounting/sa/p1\|p2/main-company\|main-liabilities\|main-expenses\|main-assets\|side-…` |

### 4.3 Ziffern- und Code-Zuordnung

| Blatt | Ziffer | Code | Bezeichnung | Feld-id | Rechenfeld | unsere Position |
|---|---|---|---|---|---|---|
| STE2 | 1.1 | 100 / 101 | Haupterwerb Person 1 / 2 (Lohnausweis) | `revenueEmployedMainRevenueAmountP1Switch:Input / …P2Switch:Input` | — | `lohn_haupt` |
| STE2 | 1.2 | 102 / 103 | Nebenerwerb Person 1 / 2 (Lohnausweis) | `revenueEmployedSidelineRevenueAmountP1Switch:Input / …P2Switch:Input` | — | `lohn_neben` |
| STE2 | 2.1 | 120 / 121 | Selbständig Haupterwerb (Hilfsblatt) | `revenueSelfemployedMainRevenueAmountP1:Input / …P2:Input` | — | `selbstaendig` |
| STE2 | 2.2 | 122 / 123 | Selbständig Nebenerwerb | `revenueSelfemployedSidelineRevenueAmountP1:Input / …P2:Input` | — | `selbstaendig` |
| STE2 | 3.1 | 130 / 131 | AHV- / IV-Renten (100 %) | `revenueInsuranceP1AHVIV100Amount:Input / P2…` | — | `rente_ahv` |
| STE2 | 3.2 | 134–137 | Renten/Pensionen (mit Prozentsatz 0/40/60/80/100) | `revenuePension1PensionP1Amount100:Input, revenuePension2FP1Amount100Switch:Input (P2 analog); AmountFinal = Rechenfeld` | — | `rente_pk` |
| STE2 | 3.3 | 140 / 141 | Erwerbsausfall Arbeitslosenversicherung | `revenueUnemploymentInsuranceP1:Input / P2` | — | `ersatz` |
| STE2 | 3.4 | 142 / 143 | Kinder-/Familienzulagen, MSE, Taggelder, EO | `revenueChildAllowancesP1:Input / P2` | — | `ersatz` |
| STE2 | 4.1 | 150 | Ertrag aus Wertschriften, Guthaben und Lotterien | `revenueSecuritiesRevenue:Input` | ja | `wertschriften` |
| STE2 | 4.2 | 151 | Davon aus qualifizierten Beteiligungen | `revenueSecuritiesRevenueQualified:Input` | ja | `beteiligung_qualifiziert` |
| STE2 | 5.1 | 160 | Unterhaltsbeiträge vom geschiedenen/getrennten Ehegatten | `revenueRestRevenueAlimony:Input` | ja | `alimente_erhalten` |
| STE2 | 5.2 | 161 | Unterhaltsbeiträge für minderjährige Kinder | `revenueRestRevenueAlimonyChild:Input` | ja | `alimente_erhalten` |
| STE2 | 5.3 | 162 | Ertrag aus Geschäfts- und Korporationsanteilen | `revenueRestRevenueInheritanceEtc:Input` | ja | `uebrige_einkuenfte` |
| STE2 | 5.4 | 163 | Weitere Einkünfte | `revenueRestRevenueFreeText:Input / revenueRestRevenueFreeTextAmount:Input` | ja | `uebrige_einkuenfte` |
| STE2 | 5.5 | 164 | Kapitalabfindungen für wiederkehrende Leistungen | `revenueRestRevenueLumpSumSettlementAmount:Input, revenueLumpSumSettlementMonths:Input` | — | — |
| STE2 | 6. | 188 | Nettoertrag aus Liegenschaften | `revenuePropertyRevenueOtherPropertySwitch:Input` | — | `liegenschaft_ertrag` |
| STE2 | 7. | 199 | Total der Einkünfte | `revenueCalculationTotalAmountRevenue:Input` | ja | — |
| STE3 | 11.1 / 11.2 | 220 / 240 | Berufsauslagen Person 1 / 2 | `jobExpensesTotalAmountJobExpensesP1:Input / …P2:Input (+ …Federal)` | ja | `berufsauslagen_fahrkosten` |
| STE3 | 12. | 250 | Schuldzinsen | `assetTotalAmountLiabilitiesInterest:Input` | ja | `schulden` |
| STE3 | 13.1 | 254 | Unterhaltsbeiträge an geschiedenen/getrennten Ehegatten | `deductionPaymentAlimonyCantonalTax:Input (+ …FederalTax)` | ja | `alimente_bezahlt` |
| STE3 | 13.2 | 255 | Unterhaltsbeiträge für minderjährige Kinder | `deductionPaymentAlimonyChildCantonalTax:Input` | ja | `alimente_bezahlt` |
| STE3 | 13.3 | 256 | Rentenleistungen (40 % abzugsfähig) | `deductionPaymentPensionTotal:Input → deductionPaymentPensionDeduction:Input` | — | — |
| STE3 | 14.1 / 14.2 | 260 / 261 | Säule 3a Person 1 / 2 | `deductionProvision3aP1Effective:Input / …P2Effective:Input` | — | `saeule_3a` |
| STE3 | 15. | 270 | Versicherungsprämien, Zinsen von Sparkapitalien | `deductionInsuranceAndInterestCantonalTax:Input (+ …FederalTax)` | ja | `versicherungspraemien` |
| STE3 | 16.1 | 280 | Beiträge an AHV, IV und 2. Säule | `deductionFurtherDeductionProvision:Input` | ja | `einkauf_pk / ahv_beitraege` |
| STE3 | 16.2 | 292 | Berufsorientierte Aus- und Weiterbildungskosten | `deductionFurtherDeductionJobOrientedFurtherEducationCostCantonalTax:Input` | ja | `weiterbildung` |
| STE3 | 16.3 | 283 | Kosten für die Verwaltung des beweglichen Privatvermögens | `deductionFurtherDeductionFinancialManagementCantonalTax:Input` | ja | `uebrige_abzuege` |
| STE3 | 16.4 | — | Behinderungsbedingte Kosten | `deductionFurtherDeductionHandicap:Input` | ja | `behinderungskosten` |
| STE3 | 16.5 | 284 | Weitere Abzüge (z. B. Beiträge an politische Parteien) | `deductionFurtherDeductionFreeTextAmountCantonalTax:Input` | ja | `parteispenden / uebrige_abzuege` |
| STE3 | 16.6 | 376 | Abzug für fremdbetreute Kinder | `revenueCalculationSocialDeductionNonparentalSupervisionCantonalTax:Input` | ja | `kinderbetreuung` |
| STE3 | 17. | 290 | Sonderabzug bei Erwerbstätigkeit beider Ehegatten | `deductionEmploymentBothPartnerCantonalTax:Input` | ja | — |
| STE3 | 18. / 20. | 299 | Total der Abzüge | `deductionTotalAmountDeductionCantonalTax:Input` | ja | — |
| STE3 | 21. | 310 | Nettoeinkommen | `revenueCalculationNetIncomeCantonalTax:Input` | ja | — |
| STE3 | 22.1 | 320 | Krankheits- und Unfallkosten | `revenueCalculationDiseaseAndAccidentExpencesCantonalDeduction:Input` | ja | `krankheitskosten` |
| STE3 | 22.2 | 324 | Gemeinnützige Zuwendungen | `revenueCalculationDeductionCharityAmountCantonalTax:Input` | ja | `spenden` |
| STE3 | 23. | 350 | Reineinkommen | `revenueCalculationAdjustedNetIncomeCantonalTax:Input` | ja | — |
| STE3 | 24.1 | 370 / 372 | Abzug für Kinder im/ausserhalb Haushalt | `revenueCalculationSocialDeductionHomeChildCantonalTax:Input / …ExternalChild…` | ja | — |
| STE3 | 24.2 | 374 | Abzug für unterstützte Personen | `revenueCalculationSocialDeductionSupportedPersonCantonalTax:Input` | ja | — |
| STE3 | 24.3 | 365 | Abzug für Ehegatten (nur Bundessteuer) | `revenueCalculationSocialDeductionPartnerFederalTax:Input` | ja | — |
| STE3 | 25. | 390 | Steuerbares Einkommen gesamt | `revenueCalculationTotalAmountFiscalRevenueCantonalTax:Input` | ja | — |
| STE3 | 26.1 / 26.2 | 394 / 396 | Auf steuerbare Einkünfte in anderen Kantonen / im Ausland | `revenueCalculationFiscalRevenueOtherCanton:Input / …AbroadCantonalTax:Input` | — | — |
| STE3 | 27. | 398 | Steuerbares Einkommen im Kanton Zürich | `revenueCalculationResultingFiscalRevenueCantonalTax:Input` | ja | — |
| STE4 | 30.1 | 400 | Wertschriften und Guthaben | `assetMovablePropertySecuritiesAndAssetsFiscalValue:Input` | ja | `wertschriften` |
| STE4 | 30.2 | 404 | Bargeld, Gold und andere Edelmetalle | `assetMovablePropertyCashValueFiscalValue:Input` | — | `bargeld` |
| STE4 | 30.3 | 406 | Lebens- und Rentenversicherungen (Total) | `assetMovablePropertyLifeInsurancesTotal:Input` | ja | `lebensversicherung` |
| STE4 | 30.4 | 412 | Motorfahrzeuge | `assetMovablePropertyVehicleDescription/PurchasePrice/Year/FiscalValue:Input` | — | `fahrzeuge` |
| STE4 | 30.5 | 414 | Geschäfts- / Korporationsanteile | `assetMovablePropertyHeritageEtcFiscalValue:Input` | ja | `uebriges_vermoegen` |
| STE4 | 30.6 | 416 | Übrige Vermögenswerte | `assetMovablePropertyFreeText:Input / assetMovablePropertyFreeTextAmountFiscalValue:Input` | — | `uebriges_vermoegen` |
| STE4 | 31.1 | 421 | Liegenschaften zum Verkehrswert besteuert | `assetPropertyMarketValueFiscalValueSwitch:Input` | — | `liegenschaften` |
| STE4 | 31.2 | 422 | Liegenschaften zum Ertragswert besteuert | `assetPropertyCapitalizedValueFiscalValueSwitch:Input` | — | `liegenschaften` |
| STE4 | 32. | 430 | Eigenkapital Selbständigerwerbender | `assetSelfEmployedBusinessCapitalFiscalValue:Input` | — | `selbstaendig` |
| STE4 | 33. | 460 | Total der Vermögenswerte | `assetTotalAmountAssetsFiscalValue:Input` | ja | — |
| STE4 | 34. | 470 | Schulden | `assetTotalAmountLiabilities:Input` | ja | `schulden` |
| STE4 | 35. | 490 | Steuerbares Vermögen gesamt | `assetTotalAmountFiscalAssetsFiscalValue:Input` | ja | — |
| STE4 | 36.1 / 36.2 | 494 / 496 | Vermögen in anderen Kantonen / im Ausland | `assetFiscalAssetsOtherCanton:Input / assetFiscalAssetsAbroad:Input` | — | — |
| STE4 | 37. | 498 | Steuerbares Vermögen im Kanton Zürich | `assetResultingFiscalAssetsFiscalValue:Input` | ja | — |
| STE4 | 40. | 510 | Kapitalleistungen (gesonderte Besteuerung) | `benefitPaymentTotalSwitch:Input` | — | `rente_saeule3` |
| STE4 | 50.1 | 516 | Erhaltene Schenkungen/Erbschaften | `benefitRestBenefitPaymentReceivedTotal:Input` | ja | — |
| STE4 | 50.2 | 519 | Ausgerichtete Schenkungen/Erbvorbezüge | `benefitRestBenefitPaidOutTotal:Input` | ja | — |
| STE4 | — | — | Ort und Datum | `locationAndDate:Input` | — | — |
| securities-register/page-2 | Total Steuerwert | 400 | Total Steuerwert Wertschriftenverzeichnis | `securitiesSubtotalTaxValue:Input` | ja | `wertschriften` |
| securities-register/page-2 | Zwischentotal Bruttoerträge | 542 | Zwischentotal Bruttoertrag A / B | `securitiesSubtotalGrossRevenueA:Input / …B:Input` | ja | `wertschriften` |
| securities-register/page-2 | Übertrag A in B | 539 | Übertrag Bruttoertrag A in Kolonne B | `securitiesSubtotalGrossRevenueA:Input` | ja | `wertschriften` |
| securities-register/page-2 | Total Bruttoertrag | 150 | Total Bruttoertrag A + B | `securitiesTotalGrossRevenue:Input` | ja | `wertschriften` |
| securities-register/page-2 | Verrechnungssteueranspruch | 540 | 35 % von Total Bruttoertrag A | `securitiesWithholdingTax:Input` | ja | `wertschriften` |
| securities-register/page-2 | Übertrag DA-1 | — | Übertrag ab Formular DA-1 (Steuerwert / Ertrag B) | `securitiesCarryOverFormDA1TaxValue:Input / …RevenueB:Input` | — | `wertschriften` |
| debtors-list/page-1 | Total | 3200 / 3201 | Total Privatschulden / private Schuldzinsen | `listOfLiabilitiesTotalPrivateLiabilities:Input / …Interest:Input` | ja | `schulden` |
| properties-register/page-1 | Total | 3952 | Total Ertragswert / Verkehrswert | `propertyCapitalizedValueTotal:Input / propertyCommercialValueTotal:Input` | ja | `liegenschaften` |
| properties-register/page-2 | Nettoertrag | 3953 | Nettoertrag aus Liegenschaften | `propertyEarningsOtherPropertiesTotal:Input` | ja | `liegenschaft_ertrag` |
| properties-register/page-2 | je Objekt | 5701 / 5741 | Mietertrag / Unterhaltskosten effektiv je Objekt | `propertyDetailRentEarningsPrivateSwitch / …MaintenanceCostsRealSwitch:propertyDetail::<n>:Input` | ja | `liegenschaft_ertrag / liegenschaftsunterhalt` |
| professional-expenses/p1 | 1.1 | 201 | Abonnementkosten für öffentliche Verkehrsmittel | `jobExpensesTicketCostPublicTransportP1:Input` | — | `berufsauslagen_fahrkosten` |
| professional-expenses/p1 | 1.2 | 202 | Fahrrad, Kleinmotorrad (Pauschale CHF 700) | `jobExpensesBicycleOrSmallMotorbikeP1:Input` | — | `berufsauslagen_fahrkosten` |
| professional-expenses/p1 | 1.3 | 204 / 205 | Auto/Motorrad, Fahrten | `jobExpensesDetailsMotorvehicleP1…, Total jobExpensesAmountMotorvehicleP1:Input` | ja | `berufsauslagen_fahrkosten` |
| professional-expenses/p1 | 2.1 | 206 / 208 | Auswärtige Verpflegung (mit/ohne Verbilligung) | `jobExpensesCateringSubsidizedP1:Input / …NonSubsidizedP1:Input` | — | `berufsauslagen_verpflegung` |
| professional-expenses/p1 | 2.2 | 210 | Verpflegung bei Schicht-/Nachtarbeit | `jobExpensesCateringShiftWorkNumberOfDaysP1:Input` | — | `berufsauslagen_verpflegung` |
| professional-expenses/p1 | 3. | 212 / 213 | Übrige Berufskosten pauschal / effektiv | `jobExpensesRemainingJobCostFlatrateP1:Input / …EffectiveP1:Input` | ja | `berufsauslagen_uebrige` |
| professional-expenses/p1 | 4. | — | Mehrkosten bei auswärtigem Wochenaufenthalt | `jobExpensesWeekdayStayP1:Input` | ja | `berufsauslagen_verpflegung` |
| professional-expenses/p1 | 5. | 216 / 217 | Auslagen bei Nebenerwerb pauschal / effektiv | `jobExpensesSidelineFlatRateP1:Input / …EffectiveP1:Input` | ja | `berufsauslagen_uebrige` |
| professional-expenses/p1 | 6. | 220 | Total der Berufsauslagen | `jobExpensesTotalAmountJobExpensesP1:Input` | ja | — |
| insurance-premium/page-1 | 1.–4. | 601 / 602 / 603 / 604 | Kranken- / Unfall- / Lebens- und Rentenversicherung / Sparzinsen | `insurancePremiumsPrivateHealthInsurance / …PrivateAccidentInsurance / …PrivateLifeAndPensionInsurance / …InterestSavings:Input` | — | `versicherungspraemien` |
| insurance-premium/page-1 | 5./6. | 607 / 606 | Zwischentotal / abzüglich Prämienverbilligung | `insurancePremiumsSubtotalAmount:Input / insurancePremiumsPaidInsuranceAndInterest:Input` | ja | `versicherungspraemien` |
| insurance-premium/page-1 | Maximalabzug | 611 / 612 / 700 / 614 / 616 | Maximalabzüge (verheiratet/übrige, Kinder, unterstützte Personen) | `insurancePremiumsDeductionInsuranceAndInterest…` | ja | — |
| insurance-premium/page-1 | Abzug | 270 | Der niedrigere Betrag (A) oder (B) | `insurancePremiumsFinalDeductionCantonalTax:Input` | ja | `versicherungspraemien` |
| sickness-accident-costs/page-1 | A 1.–7. | 300 / 301 / 302 / 303 / 304 / 305 / 307 | Selbstbehalt, Arzt, Zahnarzt, Pflegepersonal, Spital, Therapien, Übrige | `diseaseAndAccidentExpensesExpenseFranchise / …ExpenseDoctor / …ExpenseDentist / …ExpenseNursingStaff / …ExpenseHospital / …ExpenseTherapy / …ExpenseFreeTextAmount:Input` | — | `krankheitskosten` |
| sickness-accident-costs/page-1 | B 1.–3. | 308 / 311 / 312 | Vergütungen Versicherung, Anteil Lebenshaltungskosten, Weitere | `diseaseAndAccidentExpensesAllowanceInsurance / …AllowanceCostOfLiving / …AllowanceFreeTextAmount:Input` | — | `krankheitskosten` |
| sickness-accident-costs/page-1 | C / D | 314 / 315 / 313 | Total Auslagen / Pauschale / Total (C und/oder D) | `diseaseAndAccidentExpensesTotalAmountExpenses / …Flatrate / …CalculationTotalAmountExpenses:Input` | ja | `krankheitskosten` |
| sickness-accident-costs/page-1 | Abzug | 320 | Abzug nach Selbstbehalt 5 % von Ziff. 21 | `diseaseAndAccidentExpensesCalculationDeductionCantonalTax:Input` | ja | `krankheitskosten` |
| professional-training/page-1 | Total/Beitrag/Selbst | 2900/2903 · 2901/2904 · 2902/2905 | Total Kosten / Beitrag Arbeitgeber / selbstgetragene Kosten (P1/P2) | `furtherEducationTotalCostP1\|P2 / furtherEducationEmployerContributionP1\|P2 / furtherEducationOwnCostP1\|P2:Input` | ja | `weiterbildung` |
| professional-training/page-1 | Abzug | 2920 / 2921 → 292 | Zulässiger Abzug (max. 12 400 Staat / 12 900 Bund je Person) | `furtherEducationAllowableDeductionP1\|P2:Input → furtherEducationTotalDeduction:Input` | ja | `weiterbildung` |
| da-1/page-1 | 1.–8. | 4150 / 4155 | DA-1 Antrag: Schuldzinsen, Vermögen, Verwaltungskosten, Wertschriftenertrag, steuerbares Einkommen; IBAN/Kontoinhaber | `da1DebtInterest / assetTotalAmountAssetsFiscalValue / deductionFurtherDeductionFinancialManagementCantonalTax / revenueSecuritiesRevenue / … / da1BankAccountIbanNumberCopy / da1BankAccountAccountOwner:Input` | ja | `wertschriften` |
| due-disability-costs/page-1 | A 1.–3. / B / D | 3100 / 3101 / 3102 … | Behinderungsbedingte Kosten bei IV-Leistungen, bei Heim-/Entlastungsaufenthalten, weitere; Vergütungen Dritter; Pauschale | `handicapExpensesExpenseIVAllowances / handicapExpensesExpenseReliefStay / handicapExpensesExpenseFreeTextAmount / handicapExpensesAllowance… / handicapExpensesTotalAmountDeductionFlatrate:Input` | — | `behinderungskosten` |
| shareholding/page-1 | — | — | Bruttoertrag qualifizierte Beteiligungen und Teilbesteuerungsabzug | `qualifiedInvestmentsPrivateInvestmentsPrivateTotalGrossRevenuePrivate / …DeductionPartialTaxationCantonal / …DeductionPartialTaxation:Input` | ja | `beteiligung_qualifiziert` |

---

## 5. Unsere Katalogpositionen → Zielfelder im Portal

| Verzeichnis | Position (id) | Was gesucht wird | Zielfeld(er) im Portal | Ziffer / Code |
|---|---|---|---|---|
| Allgemein | `formular` – Steuererklärungsformular / Zugangscode | — | **—  kein Zielfeld** | — |
| Allgemein | `vollmacht` – Vollmacht / Vertretung | — | Vertreter: Treuhänder-ID (`representativePersonThId:Input`)<br>Vertreter: Firma (`representativePersonOrganisation:Input`)<br>Vertreter: Vorname (`representativePersonFirstName:Input`)<br>Vertreter: Name (`representativePersonOfficialName:Input`)<br>Vertreter: Strasse (`representativePersonStreet:Input`)<br>Vertreter: Nummer (`representativePersonHouseNumber:Input`)<br>Vertreter: PLZ (`representativePersonZip:Input`)<br>Vertreter: Ort (`representativePersonTown:Input`)<br>Vertreter: Telefon (`representativePersonPhoneNumber:Input`) | — |
| Allgemein | `vorjahr` – Vorjahresveranlagung / Schlussrechnung | — | **—  kein Zielfeld** | — |
| Lohn, Renten & Erwerb | `lohn_haupt` – Unselbständige Erwerbstätigkeit – Haupterwerb | E: Nettolohn (Lohnausweis Ziffer 11) | Erwerb › Haupterwerb (unselbständig): Nettolohn (`revenueEmployedMainRevenueDetailP1Revenue:revenueEmployedMainRevenueDetailP1::0:Input`) | STE2 Ziff. 1.1 (Code 100 / 101) |
| Lohn, Renten & Erwerb | `lohn_neben` – Unselbständige Erwerbstätigkeit – Nebenerwerb | E: Nettolohn (Lohnausweis Ziffer 11) | Erwerb › Nebenerwerb (unselbständig): Nettolohn (`revenueEmployedSidelineRevenueDetailP1Revenue:revenueEmployedSidelineRevenueDetailP1::0:Input`) | STE2 Ziff. 1.2 (Code 102 / 103) |
| Lohn, Renten & Erwerb | `selbstaendig` – Selbständige Erwerbstätigkeit | E: Reingewinn · V: Eigenkapital per 31.12. (Geschäftsvermögen) | Erwerb: Einkünfte (selbständig, Haupterwerb) (`revenueSelfemployedMainRevenueAmountP1:Input`)<br>Erwerb: Eigenkapital ohne Geschäftswertschriften (Haupterwerb) (`revenueSelfemployedMainAssetsAmountP1:Input`)<br>Erwerb: Einkünfte (selbständig, Nebenerwerb) (`revenueSelfemployedSidelineRevenueAmountP1:Input`)<br>Erwerb: Eigenkapital ohne Geschäftswertschriften (Nebenerwerb) (`revenueSelfemployedSidelineAssetsAmountP1:Input`)<br>Erwerb: Eigenkapital Selbständigerwerbender ohne Geschäftswertschriften (`assetSelfEmployedBusinessCapitalFiscalValue:Input`) | STE2 Ziff. 2.1 (Code 120 / 121)<br>STE2 Ziff. 2.2 (Code 122 / 123)<br>STE4 Ziff. 32. (Code 430) |
| Lohn, Renten & Erwerb | `rente_ahv` – AHV- / IV-Renten | E: Jahresrente | Renten und Versicherungen: Art der Rente (AHV/IV) (`revenueInsuranceP1AHVIV100:Select`)<br>Renten und Versicherungen: Betrag AHV-/IV-Rente (100 %) (`revenueInsuranceP1AHVIV100Amount:Input`) | STE2 Ziff. 3.1 (Code 130 / 131) |
| Lohn, Renten & Erwerb | `rente_pk` – Renten aus 2. Säule (Pensionskasse) | E: Jahresrente | Renten und Versicherungen › Renten/Pensionen: Bezeichnung (`revenuePensionDetailP1Description:revenuePensionDetailP1::0:Input`)<br>Renten und Versicherungen › Renten/Pensionen: Betrag (100 %) (`revenuePensionDetailP1Amount100:revenuePensionDetailP1::0:Input`)<br>Renten und Versicherungen › Renten/Pensionen: Prozent (`revenuePensionDetailP1Percentage:revenuePensionDetailP1::0:Select`) | STE2 Ziff. 3.2 (Code 134–137) |
| Lohn, Renten & Erwerb | `rente_saeule3` – Renten und Kapitalleistungen aus Säule 3a / 3b | E: Rente bzw. Kapitalleistung | Kapitalleistungen › Kapitalleistung: Art (`benefitPaymentReason:benefitPayment::0:Select`)<br>Kapitalleistungen › Kapitalleistung: Auszahlungsdatum (`benefitPaymentDate:benefitPayment::0:DatePicker`)<br>Kapitalleistungen › Kapitalleistung: Betrag (`benefitPaymentAmount:benefitPayment::0:Input`) | STE4 Ziff. 40. (Code 510) |
| Lohn, Renten & Erwerb | `ersatz` – Erwerbsausfallentschädigungen (ALV, KTG, UVG, EO/MSE) | E: Total Taggelder | Renten und Versicherungen: Erwerbsausfallentschädigungen aus Arbeitslosenversicherung (`revenueUnemploymentInsuranceP1:Input`)<br>Renten und Versicherungen: Kinder-/Familienzulagen, Mutterschaftsentschädigung, Taggelder, EO (`revenueChildAllowancesP1:Input`) | STE2 Ziff. 3.3 (Code 140 / 141)<br>STE2 Ziff. 3.4 (Code 142 / 143) |
| Lohn, Renten & Erwerb | `alimente_erhalten` – Erhaltene Unterhaltsbeiträge (Alimente) | E: Jahresbetrag | Kinder › Unterhalt / Sorgerecht (Dialog) › Aufstellung Unterhaltsbeiträge: Betrag (`intChildReceivedAlimonyDetailAmountImmaturityWR:intChildReceivedAlimonyDetail::intChild::0:Input`)<br>Übrige Einkünfte: Unterhaltsbeiträge vom geschiedenen/getrennten Ehegatten (`revenueRestRevenueAlimony:Input`)<br>Übrige Einkünfte: Unterhaltsbeiträge für minderjährige Kinder (`revenueRestRevenueAlimonyChild:Input`)<br>Übrige Einkünfte › Erhaltene Unterhaltsbeiträge (Dialog) › Aufstellung Unterhaltsbeiträge: Betrag CHF (`revenueRestRevenueAlimonyDetailAmountWR:revenueRestRevenueAlimonyDetail::Input`) | STE2 Ziff. 5.1 (Code 160)<br>STE2 Ziff. 5.2 (Code 161) |
| Lohn, Renten & Erwerb | `uebrige_einkuenfte` – Übrige Einkünfte | E: Betrag | Übrige Einkünfte › Geschäfts- und Korporationsanteile: Einkommen Betrag (`inheritanceEtcDetailRevenueWR:inheritanceEtcDetail::Input`)<br>Übrige Einkünfte › Weitere Einkünfte: Art (`revenueRestRevenueFreeTextDetailDescriptionWR:revenueRestRevenueFreeTextDetail::Input`)<br>Übrige Einkünfte › Weitere Einkünfte: Betrag (`revenueRestRevenueFreeTextDetailAmountWR:revenueRestRevenueFreeTextDetail::Input`)<br>Bewegliches Vermögen › Geschäfts- und Korporationsanteile: Einkommen Betrag (`inheritanceEtcDetailRevenueWR:inheritanceEtcDetail::Input`) | STE2 Ziff. 5.3 (Code 162)<br>STE2 Ziff. 5.4 (Code 163) |
| Wertschriftenverzeichnis | `wertschriften` – Konto / Depot / Titel | E: Bruttoertrag im Jahr · V: Steuerwert per 31.12. | Wertschriftenverzeichnis › Wertschriftenzeile – Auswahl der Art: Steuerwert CHF (`securitiesTaxValueEndOfYear:listOfSecurities::0:Input`)<br>Wertschriftenverzeichnis › Wertschriftenzeile – Auswahl der Art: Bruttoertrag A (mit VSt) (`securitiesGrossRevenueA:listOfSecurities::0:Input`)<br>Wertschriftenverzeichnis › Wertschriftenzeile – Auswahl der Art: Bruttoertrag B (ohne VSt) (`securitiesGrossRevenueB:listOfSecurities::0:Input`)<br>Wertschriftenzeile – Art «Bankkonto» / «Steuerauszug/Depot» (Dialog): Bank, Gesellschaft (`securitiesWAEnteredDescription:Input`)<br>Wertschriftenzeile – Art «Bankkonto» / «Steuerauszug/Depot» (Dialog): Konto-/Depot-Nr. (`securitiesWAAccountNumber:Input`)<br>Wertschriftenzeile – Art «Bankkonto» / «Steuerauszug/Depot» (Dialog): Bezeichnung (`securitiesWAAccountDescription:Input`)<br>Wertschriftenzeile – Art «Bankkonto» / «Steuerauszug/Depot» (Dialog): Zugehörigkeit Person 1 (%) (`securitiesWASharePartner1:Input`)<br>Wertschriftenzeile – Art «Bankkonto» / «Steuerauszug/Depot» (Dialog): Zugehörigkeit Person 2 (%) (`securitiesWASharePartner2:Input`)<br>Wertschriftenzeile – Art «Bankkonto» / «Steuerauszug/Depot» (Dialog): Total Guthaben / Total Steuerwert (`securitiesWATaxValueOriginalCurrency:Input`)<br>Wertschriftenzeile – Art «Bankkonto» / «Steuerauszug/Depot» (Dialog): Ertrag mit Verrechnungssteuer (A) (`securitiesWAForeignGrossRevenueA:Input`)<br>Wertschriftenzeile – Art «Bankkonto» / «Steuerauszug/Depot» (Dialog): Ertrag ohne Verrechnungssteuer (B) (`securitiesWAForeignGrossRevenueB:Input`)<br>Wertschriftenzeile – Art «Wertschrift und Guthaben» (Dialog): Gesellschaft, Titel (`securitiesWAEnteredDescription:Input`)<br>Wertschriftenzeile – Art «Wertschrift und Guthaben» (Dialog): Zugehörigkeit Person 1 (%) (`securitiesWASharePartner1:Input`)<br>Wertschriftenzeile – Art «Wertschrift und Guthaben» (Dialog): Zugehörigkeit Person 2 (%) (`securitiesWASharePartner2:Input`)<br>Wertschriftenzeile – Art «Wertschrift und Guthaben» (Dialog): Steuerwert (`securitiesWATaxValueOriginalCurrency:Input`)<br>Wertschriftenzeile – Art «Wertschrift und Guthaben» (Dialog) › Ertrag (Dividenden/Zinsen): Ertrag pro Stück (`securitiesWARevenueDetailBaseOriginalCurrency:securitiesWARevenueDetail::0:Input`)<br>Wertschriftenzeile – Art «Wertschrift und Guthaben» (Dialog) › Ertrag (Dividenden/Zinsen): VSt. (mit/ohne) (`securitiesWARevenueDetailWithHoldingTax:securitiesWARevenueDetail::0:Select`)<br>Wertschriftenzeile – Art «Wertschrift mit ausländischer Quellensteuer (DA-1)» (Dialog): Total Steuerwert (`da1WATaxValueOriginalCurrency:Input`)<br>Wertschriftenzeile – Art «Wertschrift mit ausländischer Quellensteuer (DA-1)» (Dialog) › Ertrag DA-1: Ertrag (CHF) (`da1WARevenueDetailRevenueCHF:da1WARevenueDetail::0:Input`) | STE2 Ziff. 4.1 (Code 150)<br>STE4 Ziff. 30.1 (Code 400)<br>securities-register/page-2 Ziff. Total Steuerwert (Code 400)<br>securities-register/page-2 Ziff. Zwischentotal Bruttoerträge (Code 542)<br>securities-register/page-2 Ziff. Übertrag A in B (Code 539)<br>securities-register/page-2 Ziff. Total Bruttoertrag (Code 150)<br>securities-register/page-2 Ziff. Verrechnungssteueranspruch (Code 540)<br>securities-register/page-2 Ziff. Übertrag DA-1 (Code —)<br>da-1/page-1 Ziff. 1.–8. (Code 4150 / 4155) |
| Wertschriftenverzeichnis | `beteiligung_qualifiziert` – Qualifizierte Beteiligung (≥10%) | E: Bruttodividende im Jahr · V: Steuerwert per 31.12. | Wertschriftenzeile – Art «Wertschrift und Guthaben» (Dialog): Qualifizierte Beteiligung (`securitiesWAIsQualifiedParticipation:Checkbox`) | STE2 Ziff. 4.2 (Code 151)<br>shareholding/page-1 Ziff. — (Code —) |
| Wertschriftenverzeichnis | `krypto` – Kryptowährungen | V: Bestand per 31.12. | Wertschriftenzeile – Art «Wertschrift und Guthaben» (Dialog): Art (`categorySelect`) | — |
| Liegenschaftenverzeichnis | `liegenschaft_ertrag` – Ertrag / Eigenmietwert / Mieterspiegel | E: Mietertrag bzw. Eigenmietwert | Liegenschaften Detailerfassung (Beiblatt je Objekt): Eigenmietwert (`propertyDetailNotionalRentalValue:propertyDetail::1:Input`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt): Mieteinnahmen/Mietwert: Wohnungen, Zimmer, Garagen etc. (`propertyDetailRentEarningsPrivate:propertyDetail::1:Input`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt): Mieteinnahmen/Mietwert: Gewerblich/geschäftlich benutzte Räume (`propertyDetailRentEarningsBusiness:propertyDetail::1:Input`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt) › Mieterspiegel (nur bei «Detailliert angeben»): Mietertrag (`propertyDetailEarningsDetailRentEarningsPrivate:propertyDetail::1:propertyDetailEarningsDetail::0:Input`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt) › Mieterspiegel (nur bei «Detailliert angeben»): Mietertrag gewerbliche Nutzung (`propertyDetailEarningsDetailRentEarningsBusiness:propertyDetail::1:propertyDetailEarningsDetail::0:Input`) | STE2 Ziff. 6. (Code 188)<br>properties-register/page-2 Ziff. Nettoertrag (Code 3953)<br>properties-register/page-2 Ziff. je Objekt (Code 5701 / 5741) |
| Liegenschaftenverzeichnis | `liegenschaftsunterhalt` – Unterhalts- und Verwaltungskosten | E: Rechnungsbetrag (Unterhalt) | Liegenschaften Detailerfassung (Beiblatt je Objekt): Effektive Kosten (Total) (`propertyDetailMaintenanceCostsReal:propertyDetail::1:Input`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt) › Unterhalts- und Verwaltungskosten effektiv (nur bei «Detailliert angeben»): Betrag CHF (`propertyDetailMaintenanceCostsDetailCostAmount:propertyDetailMaintenanceCostsDetail::1:propertyDetail::1:Input`) | properties-register/page-2 Ziff. je Objekt (Code 5701 / 5741) |
| Liegenschaftenverzeichnis | `liegenschaften` – Steuerwert / Objektdaten | V: Steuerwert | Liegenschaften Detailerfassung (Beiblatt je Objekt): Ort (`propertyDetailTown:propertyDetail::1:Input`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt): Strasse und Nummer (`propertyDetailStreet:propertyDetail::1:Input`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt): Kanton/Ausland (`propertyDetailCantonOrCountry:propertyDetail::1:Select`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt): Art der Liegenschaft (`propertyDetailTypeOfPropertyFreeText:propertyDetail::1:Input`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt): Fläche in m² (`propertyDetailArea:propertyDetail::1:Input`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt): Nutzung (`propertyDetailUse:propertyDetail::1:Select`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt): Verkehrswert (`propertyDetailCommercialValue:propertyDetail::1:Input`)<br>Liegenschaften Detailerfassung (Beiblatt je Objekt): Ertragswert (Land-/Forstwirtschaft) (`propertyDetailCapitalizedValue:propertyDetail::1:Input`) | STE4 Ziff. 31.1 (Code 421)<br>STE4 Ziff. 31.2 (Code 422)<br>properties-register/page-1 Ziff. Total (Code 3952) |
| Schuldenverzeichnis | `schulden` – Schuld je Gläubiger | E: Schuldzinsen im Jahr · V: Restschuld per 31.12. | Schuldzinsen = Schulden (Schuldenverzeichnis) › Privatschulden inkl. Grundpfandschulden: Name, Vorname und Adresse des Gläubigers (`listOfLiabilitiesPrivateLiabilitiesIdentificationWR:listOfLiabilitiesPrivateLiabilities::Input`)<br>Schuldzinsen = Schulden (Schuldenverzeichnis) › Privatschulden inkl. Grundpfandschulden: Schuld am 31.12. (`listOfLiabilitiesPrivateLiabilitiesLiabilityWR:listOfLiabilitiesPrivateLiabilities::Input`)<br>Schuldzinsen = Schulden (Schuldenverzeichnis) › Privatschulden inkl. Grundpfandschulden: Schuldzinsen (`listOfLiabilitiesPrivateLiabilitiesLiabilityInterestWR:listOfLiabilitiesPrivateLiabilities::Input`) | STE3 Ziff. 12. (Code 250)<br>STE4 Ziff. 34. (Code 470)<br>debtors-list/page-1 Ziff. Total (Code 3200 / 3201) |
| Berufsauslagen | `berufsauslagen_fahrkosten` – Fahrkosten | E: Jahreskosten | Berufsbedingte Fahrkosten: Abonnementskosten für öffentliche Verkehrsmittel (`jobExpensesTicketCostPublicTransportP1:Input`)<br>Berufsbedingte Fahrkosten: Fahrrad, Kleinmotorrad (`jobExpensesBicycleOrSmallMotorbikeP1:Input`)<br>Berufsbedingte Fahrkosten › Fahrten mit privatem Motorfahrzeug: Rappen pro km (`jobExpensesDetailsMotorvehicleP1AmountPerDistance:jobExpensesDetailsMotorvehicleP1::0:Select`) | STE3 Ziff. 11.1 / 11.2 (Code 220 / 240)<br>professional-expenses/p1 Ziff. 1.1 (Code 201)<br>professional-expenses/p1 Ziff. 1.2 (Code 202)<br>professional-expenses/p1 Ziff. 1.3 (Code 204 / 205) |
| Berufsauslagen | `berufsauslagen_verpflegung` – Verpflegung / auswärtige Unterkunft | E: Jahreskosten | Weitere Berufsauslagen: Auswärtige Verpflegung – mit Verbilligung Arbeitgeber (`jobExpensesCateringSubsidizedP1:Input`)<br>Weitere Berufsauslagen: Auswärtige Verpflegung – voll zu Lasten des Arbeitnehmers (`jobExpensesCateringNonSubsidizedP1:Input`)<br>Weitere Berufsauslagen: Schicht-/Nachtarbeit – Anzahl Tage (`jobExpensesCateringShiftWorkNumberOfDaysP1:Input`)<br>Weitere Berufsauslagen › Mehrkosten Wochenaufenthalt: Betrag (`jobExpensesWeekdayStayDetailP1AmountWR:jobExpensesWeekdayStayDetailP1::Input`) | professional-expenses/p1 Ziff. 2.1 (Code 206 / 208)<br>professional-expenses/p1 Ziff. 2.2 (Code 210)<br>professional-expenses/p1 Ziff. 4. (Code —) |
| Berufsauslagen | `berufsauslagen_uebrige` – Übrige Berufskosten | E: Jahreskosten | Weitere Berufsauslagen: Übrige Berufskosten: Pauschal 3 % des Nettolohns (`jobExpensesRemainingJobCostFlatrateOrRealP1:RadioPauschal, 3 % des Nettolohns gemäss Lohnausweis`)<br>Weitere Berufsauslagen: Übrige Berufskosten: Effektive Kosten gemäss Aufstellung (`jobExpensesRemainingJobCostFlatrateOrRealP1:RadioEffektive Kosten gemäss Aufstellung`)<br>Weitere Berufsauslagen › Übrige Berufskosten effektiv: Betrag (`jobExpensesRemainingJobCostEffectiveDetailP1AmountWR:jobExpensesRemainingJobCostEffectiveDetailP1::Input`) | professional-expenses/p1 Ziff. 3. (Code 212 / 213)<br>professional-expenses/p1 Ziff. 5. (Code 216 / 217) |
| Berufsauslagen | `weiterbildung` – Aus- und Weiterbildung | E: Jahreskosten | Berufsorientierte Aus- und Weiterbildung: Beitrag Arbeitgeber oder weiterer Stellen (`furtherEducationEmployerContributionP1:Input`)<br>Berufsorientierte Aus- und Weiterbildung › Aus-/Weiterbildungskosten: Bezeichnung (`furtherEducationCostDetailDescriptionWR:furtherEducationCostDetail::Input`)<br>Berufsorientierte Aus- und Weiterbildung › Aus-/Weiterbildungskosten: Betrag (Person 1) (`furtherEducationCostDetailAmountP1WR:furtherEducationCostDetail::Input`)<br>Berufsorientierte Aus- und Weiterbildung › Aus-/Weiterbildungskosten: Betrag (Person 2) (`furtherEducationCostDetailAmountP2WR:furtherEducationCostDetail::Input`) | STE3 Ziff. 16.2 (Code 292)<br>professional-training/page-1 Ziff. Total/Beitrag/Selbst (Code 2900/2903 · 2901/2904 · 2902/2905)<br>professional-training/page-1 Ziff. Abzug (Code 2920 / 2921 → 292) |
| Vorsorge (3a / PK / AHV) | `saeule_3a` – Beiträge Säule 3a | E: Einzahlung im Steuerjahr | Säule 3a und weitere Vorsorgearten: Säule 3a – Betrag effektiv (`deductionProvision3aP1Effective:Input`) | STE3 Ziff. 14.1 / 14.2 (Code 260 / 261) |
| Vorsorge (3a / PK / AHV) | `einkauf_pk` – Einkauf in die 2. Säule | E: Einkaufssumme | Säule 3a und weitere Vorsorgearten › Beiträge an AHV, IV und 2. Säule: Betrag (`deductionFurtherDeductionProvisionDetailAmount:deductionFurtherDeductionProvisionDetail::0:Input`) | STE3 Ziff. 16.1 (Code 280) |
| Vorsorge (3a / PK / AHV) | `ahv_beitraege` – AHV/IV/EO-Beiträge Nichterwerbstätiger | E: Jahresbeitrag | Säule 3a und weitere Vorsorgearten › Beiträge an AHV, IV und 2. Säule: Betrag (`deductionFurtherDeductionProvisionDetailAmount:deductionFurtherDeductionProvisionDetail::0:Input`) | STE3 Ziff. 16.1 (Code 280) |
| Versicherungen & Krankheit | `versicherungspraemien` – Versicherungsprämien und Sparzinsen | E: Jahresprämie | Versicherungsprämien: Private Krankenversicherungsprämien (`insurancePremiumsPrivateHealthInsurance:Input`)<br>Versicherungsprämien: Private Unfallversicherungsprämien (`insurancePremiumsPrivateAccidentInsurance:Input`)<br>Versicherungsprämien: Private Lebens- und Rentenversicherungsprämien (`insurancePremiumsPrivateLifeAndPensionInsurance:Input`)<br>Versicherungsprämien: Zinsen von Sparkapitalien (`insurancePremiumsInterestSavings:Input`)<br>Versicherungsprämien: Abzüglich erhaltene Prämienverbilligungen (`insurancePremiumsDeductionsPremiumsReduction:Input`) | STE3 Ziff. 15. (Code 270)<br>insurance-premium/page-1 Ziff. 1.–4. (Code 601 / 602 / 603 / 604)<br>insurance-premium/page-1 Ziff. 5./6. (Code 607 / 606)<br>insurance-premium/page-1 Ziff. Abzug (Code 270) |
| Versicherungen & Krankheit | `krankheitskosten` – Krankheits- und Unfallkosten | E: Selbst getragener Betrag | Krankheits- und Unfallkosten: Selbstbehalt gemäss Abrechnung Krankenkasse/Versicherung (`diseaseAndAccidentExpensesExpenseFranchise:Input`)<br>Krankheits- und Unfallkosten: Betrag CHF (weitere Aufwendungen) (`diseaseAndAccidentExpensesExpenseFreeTextAmount:Input`)<br>Krankheits- und Unfallkosten: Betrag CHF (Vergütungen Dritter) (`diseaseAndAccidentExpensesAllowanceInsurance:Input`) | STE3 Ziff. 22.1 (Code 320)<br>sickness-accident-costs/page-1 Ziff. A 1.–7. (Code 300 / 301 / 302 / 303 / 304 / 305 / 307)<br>sickness-accident-costs/page-1 Ziff. B 1.–3. (Code 308 / 311 / 312)<br>sickness-accident-costs/page-1 Ziff. C / D (Code 314 / 315 / 313)<br>sickness-accident-costs/page-1 Ziff. Abzug (Code 320) |
| Versicherungen & Krankheit | `behinderungskosten` – Behinderungsbedingte Kosten | E: Betrag | Behinderungsbedingte Kosten: Betrag CHF (effektive Aufwendungen) (`handicapExpensesExpenseIVAllowances:Input`)<br>Behinderungsbedingte Kosten: Betrag CHF (Vergütungen Dritter) (`handicapExpensesAllowanceFreeTextAmount:Input`)<br>Behinderungsbedingte Kosten: Pauschale – Betrag (`handicapExpensesTotalAmountDeductionFlatrate:Input`) | STE3 Ziff. 16.4 (Code —)<br>due-disability-costs/page-1 Ziff. A 1.–3. / B / D (Code 3100 / 3101 / 3102 …) |
| Weitere Abzüge | `alimente_bezahlt` – Bezahlte Unterhaltsbeiträge (Alimente) | E: Jahresbetrag | Unterhalt und Renten: Unterhaltsbeiträge an den geschiedenen/getrennt lebenden Ehegatten (`deductionPaymentAlimonyCantonalTax:Input`)<br>Unterhalt und Renten: Unterhaltsbeiträge für minderjährige Kinder (`deductionPaymentAlimonyChildCantonalTax:Input`)<br>Unterhalt und Renten › Bezahlte Unterhaltsbeiträge (Dialog) › Tabelle Unterhaltsbeiträge: Betrag CHF (`deductionPaymentAlimonyDetailAmountWR:deductionPaymentAlimonyDetail::Input`) | STE3 Ziff. 13.1 (Code 254)<br>STE3 Ziff. 13.2 (Code 255) |
| Weitere Abzüge | `kinderbetreuung` – Kinderbetreuungskosten | E: Jahreskosten | Kinder › Kind im Haushalt: Fremdbetreuungskosten (`intChildExternalCareTotal2:intChild::0:Input`) | STE3 Ziff. 16.6 (Code 376) |
| Weitere Abzüge | `spenden` – Gemeinnützige Zuwendungen / Spenden | E: Jahresbetrag | Gemeinnützige Zuwendungen › Gemeinnützige Zuwendungen: Datum (`revenueCalculationDeductionCharityDetailDateWR:revenueCalculationDeductionCharityDetail::DatePicker`)<br>Gemeinnützige Zuwendungen › Gemeinnützige Zuwendungen: Bezeichnung (`revenueCalculationDeductionCharityDetailDescriptionWR:revenueCalculationDeductionCharityDetail::Input`)<br>Gemeinnützige Zuwendungen › Gemeinnützige Zuwendungen: Betrag (`revenueCalculationDeductionCharityDetailAmountCantonalTaxWR:revenueCalculationDeductionCharityDetail::Input`) | STE3 Ziff. 22.2 (Code 324) |
| Weitere Abzüge | `parteispenden` – Zuwendungen an politische Parteien | E: Jahresbetrag | Weitere Abzüge › Beiträge an politische Parteien: Datum (`deductionFurtherDeductionPoliticalPartyDetailDateWR:deductionFurtherDeductionPoliticalPartyDetail::DatePicker`)<br>Weitere Abzüge › Beiträge an politische Parteien: Bezeichnung (`deductionFurtherDeductionPoliticalPartyDetailDescriptionWR:deductionFurtherDeductionPoliticalPartyDetail::Input`)<br>Weitere Abzüge › Beiträge an politische Parteien: Betrag CHF (`deductionFurtherDeductionPoliticalPartyDetailAmountWR:deductionFurtherDeductionPoliticalPartyDetail::Input`) | STE3 Ziff. 16.5 (Code 284) |
| Weitere Abzüge | `uebrige_abzuege` – Übrige Abzüge / Vermögensverwaltung | E: Betrag | Weitere Abzüge › Kosten für die Verwaltung des beweglichen Privatvermögens: Bezeichnung (`deductionFurtherDeductionFinancialManagementDetailDescriptionWR:deductionFurtherDeductionFinancialManagementDetail::Input`)<br>Weitere Abzüge › Kosten für die Verwaltung des beweglichen Privatvermögens: Betrag (`deductionFurtherDeductionFinancialManagementDetailAmountCantonalWR:deductionFurtherDeductionFinancialManagementDetail::Input`)<br>Weitere Abzüge › Übrige weitere Abzüge: Art (`deductionFurtherDeductionFreeTextDetailKindWR:deductionFurtherDeductionFreeTextDetail::Select`)<br>Weitere Abzüge › Übrige weitere Abzüge: Bezeichnung (`deductionFurtherDeductionFreeTextDetailDescriptionWR:deductionFurtherDeductionFreeTextDetail::Input`)<br>Weitere Abzüge › Übrige weitere Abzüge: Staatssteuer (`deductionFurtherDeductionFreeTextDetailAmountCantonalTaxWR:deductionFurtherDeductionFreeTextDetail::Input`) | STE3 Ziff. 16.3 (Code 283)<br>STE3 Ziff. 16.5 (Code 284) |
| Übriges Vermögen | `bargeld` – Bargeld, Edelmetalle | V: Steuerwert per 31.12. | Bewegliches Vermögen: Bargeld, Gold und andere Edelmetalle – Betrag (`assetMovablePropertyCashValueFiscalValue:Input`) | STE4 Ziff. 30.2 (Code 404) |
| Übriges Vermögen | `lebensversicherung` – Lebensversicherungen (Rückkaufswert) | V: Rückkaufswert per 31.12. | Lebens- und Rentenversicherungen › Lebens-/Rentenversicherung: Versicherungsgesellschaft (`assetMovablePropertyLifeInsurancesCompany:assetMovablePropertyLifeInsurances::0:Input`)<br>Lebens- und Rentenversicherungen › Lebens-/Rentenversicherung: Abschlussjahr (`assetMovablePropertyLifeInsurancesFixtureYear:assetMovablePropertyLifeInsurances::0:Input`)<br>Lebens- und Rentenversicherungen › Lebens-/Rentenversicherung: Ablaufjahr (`assetMovablePropertyLifeInsurancesExpirationYear:assetMovablePropertyLifeInsurances::0:Input`)<br>Lebens- und Rentenversicherungen › Lebens-/Rentenversicherung: Steuerwert (Rückkaufswert) (`assetMovablePropertyLifeInsurancesFiscalValue:assetMovablePropertyLifeInsurances::0:Input`) | STE4 Ziff. 30.3 (Code 406) |
| Übriges Vermögen | `fahrzeuge` – Fahrzeuge | V: Zeitwert | Motorfahrzeuge › Motorfahrzeug: Bezeichnung (`assetMovablePropertyVehicleDetailDescription:assetMovablePropertyVehicleDetails::0:Input`)<br>Motorfahrzeuge › Motorfahrzeug: Kaufjahr (`assetMovablePropertyVehicleDetailYear:assetMovablePropertyVehicleDetails::0:Input`)<br>Motorfahrzeuge › Motorfahrzeug: Kaufpreis (`assetMovablePropertyVehicleDetailPurchasePrice:assetMovablePropertyVehicleDetails::0:Input`)<br>Motorfahrzeuge › Motorfahrzeug: Steuerwert (`assetMovablePropertyVehicleDetailFiscalValue:assetMovablePropertyVehicleDetails::0:Input`) | STE4 Ziff. 30.4 (Code 412) |
| Übriges Vermögen | `uebriges_vermoegen` – Übrige Vermögenswerte (Darlehen, Erbanteile, Kapitaleinlagen) | V: Wert per 31.12. | Übrige Einkünfte › Geschäfts- und Korporationsanteile: Vermögen Betrag (`inheritanceEtcDetailAssetWR:inheritanceEtcDetail::Input`)<br>Bewegliches Vermögen: Übrige Vermögenswerte – Nähere Bezeichnung (`assetMovablePropertyFreeText:Input`)<br>Bewegliches Vermögen: Übrige Vermögenswerte – Betrag (`assetMovablePropertyFreeTextAmountFiscalValue:Input`)<br>Bewegliches Vermögen › Geschäfts- und Korporationsanteile: Vermögen Betrag (`inheritanceEtcDetailAssetWR:inheritanceEtcDetail::Input`) | STE4 Ziff. 30.5 (Code 414)<br>STE4 Ziff. 30.6 (Code 416) |
| Arbeitspapiere | `arbeitsnotiz` – Besprechungs- und Arbeitsnotizen | — | **—  kein Zielfeld** | — |
| Arbeitspapiere | `eigene_berechnung` – Eigene Berechnungen und Aufstellungen | — | **—  kein Zielfeld** | — |
| Nicht benötigt | `_aussortiert` – Nicht zur Steuererklärung | — | **—  kein Zielfeld** | — |

### 5.1 Positionen OHNE Zielfeld im Portal

- `formular` – Steuererklärungsformular / Zugangscode
- `vorjahr` – Vorjahresveranlagung / Schlussrechnung
- `arbeitsnotiz` – Besprechungs- und Arbeitsnotizen
- `eigene_berechnung` – Eigene Berechnungen und Aufstellungen
- `_aussortiert` – Nicht zur Steuererklärung

### 5.2 Lücken bei den Dimensionen (Ehegatte / Objekt / Konto)

| Katalog-Dimension | Portalseitig | Bemerkung |
|---|---|---|
| `person` bei Erwerb, Renten, Berufsauslagen, Vorsorge | vorhanden | Registerkarten Person 1 / Person 2, Felder mit Suffix `P1` / `P2`. |
| `person` bei Wertschriften | teilweise | Nur bei den Zeilenarten «Wertschrift und Guthaben» und «Steuerauszug/Depot» über `securitiesWASharePartner1/2` (%). Bei der Art **Bankkonto fehlt** die Aufteilung ganz. |
| `person` bei Versicherungsprämien | **fehlt** | Die Maske wird gemeinsam geführt; der Maximalabzug richtet sich nach Zivilstand. |
| `person` bei Krankheits-/Behinderungskosten | nur Namensliste | Betroffene Personen werden namentlich erfasst, der Betrag jedoch nur einmal. |
| `person` bei Kapitalleistungen | **fehlt** | Die Maske «Kapitalleistungen» kennt keine Zuordnung zu Person 1/2. |
| `objekt` bei Liegenschaften | vorhanden | Je Objekt ein Beiblatt, Index `propertyDetail::<n>`. |
| `objekt` bei Schulden | **fehlt** | Das Schuldenverzeichnis kennt nur Gläubiger, Schuld und Zins – keine Zuordnung zur Liegenschaft. Der Knopf «Schulden der Liegenschaft erfassen» springt lediglich in dieselbe Liste. |
| `konto` bei Wertschriften | vorhanden | `securitiesWAAccountNumber:Input` (Konto-/Depot-Nr.). |

---

## 6. Was Sascha selbst ausfüllen muss

- **Bankverbindung für Rückerstattungen** (`listOfSecuritiesBankAccountIbanNumber`, `…AccountOwner`) und **DA-1 Kontoangaben** (`da1BankAccountIbanNumber`, `da1BankAccountAccountOwner`) – Kontonummern werden vom Assistenten grundsätzlich nicht eingetippt.
- **Personalien und AHVN13** – kommen aus dem Register bzw. sind Anmeldedaten.
- **Kinder, unterstützte Personen, Sorgerecht-Fragen** – fachliche Angaben, die kein Beleg hergibt.
- **Liegenschaften: pauschal ODER effektiv** (Schieber «Pauschal») und der **wertvermehrende Anteil in %** je Unterhaltszeile.
- **Zuordnung Ehegatte** überall dort, wo die Arbeitsliste keine Person nennt.
- **Vorjahresdaten bestätigen** – solange das nicht geschehen ist, sind die betroffenen Felder gesperrt.
- **Einreichen** – ausschliesslich durch Sascha.

---

## 7. Offene Punkte dieser Aufnahme

- Maske «Einreichen» (tax-assistant/finish/submit) wurde bewusst NICHT geöffnet – dort wird die Übermittlung ausgelöst.
- Dialog «Fremdbetreuungskosten» (dialogs/children/external-care) wurde nicht geöffnet; er hängt am Stift-Knopf des Feldes intChildExternalCareTotal2.
- Dialoge «Unterstützte Person – Aufstellung» (internal-detail / external-detail) wurden nicht geöffnet.
- Der Import eines eSteuerauszugs wurde nicht ausgelöst; die daraus entstehenden Masken (tax-statement-detail-*) sind daher nicht aufgenommen.
- Hilfsblätter A (kaufmännische / vereinfachte Buchführung) und die Ausscheidungstabellen sind nur mit Route und Blattnamen erfasst, nicht feldweise.
- Beobachteter Portalfehler: Beim Direktsprung auf das Wertschriftenverzeichnis bleibt die Maske gelegentlich leer (Konsolenfehler «…reading 'da1List'»). Abhilfe: zuerst «Angaben zum DA-1 Formular» öffnen.
