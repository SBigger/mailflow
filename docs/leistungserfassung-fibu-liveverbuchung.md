# Leistungserfassung: FiBu-Liveverbuchung

## Zweck

Definitive Rechnungen aus der Leistungserfassung werden in derselben
Datenbanktransaktion als Debitorenbeleg und im Hauptbuch verbucht. Schlägt ein
Teil fehl, bleibt die Rechnung ein Entwurf und es entstehen keine Teilbuchungen.

## Einmalige Mandantenbindung

Die Bindung erfolgt unter **Leistungserfassung → Stammdaten → Firma**.

- Auswählbar sind nur aktive FiBu-Mandanten, in denen der angemeldete Benutzer
  `admin` oder `buchhalter` ist.
- Die Person, welche die Erstbindung ausführt, wird als fachlicher Eigentümer
  gespeichert.
- Normale Benutzer, andere Administratoren, Claude und Codex können die Bindung
  nicht ändern.
- Nur der gespeicherte Eigentümer kann eine Fehlbindung mit mindestens zehn
  Zeichen Begründung korrigieren. Alte Buchungen bleiben beim alten Mandanten.
- Erstbindung und Korrekturen werden dauerhaft protokolliert.

Die Bindung wird nur akzeptiert, wenn der Mandant aktiv ist, CHF führt, eine
unterstützte MWST-Methode verwendet und alle benötigten Konten vorhanden sowie
aktiv sind.

## Buchungszeitpunkt und Buchungssätze

Gebucht wird beim Übergang der Rechnung von `entwurf` zu `definitiv`.

### Effektive MWST-Methode

| Vorgang | Soll | Haben | Betrag |
|---|---|---|---:|
| Rechnung netto | 1100 Debitoren | Ertragskonto der Leistungsart | Nettobetrag |
| Rechnung MWST | 1100 Debitoren | Umsatzsteuerkonto des FiBu-MWST-Codes | MWST |
| Gutschrift netto | Ertragskonto der Leistungsart | 1100 Debitoren | Nettobetrag |
| Gutschrift MWST | Umsatzsteuerkonto | 1100 Debitoren | MWST |

### Saldosteuersatz-Methode

| Vorgang | Soll | Haben | Betrag |
|---|---|---|---:|
| Rechnung | 1100 Debitoren | Ertragskonto der Leistungsart | Bruttobetrag |
| Gutschrift | Ertragskonto der Leistungsart | 1100 Debitoren | Bruttobetrag |

Die Saldosteuersatz-Abrechnung verwendet damit den Bruttoumsatz der
Ertragskonten. Die Rechnungsposition behält den ausgewiesenen MWST-Satz für die
Belegdarstellung.

## Kontierung

- Jede verrechenbare Leistungsart besitzt ein `ertragskonto`.
- Die Kontoauswahl zeigt nur aktive Ertragskonten des gebundenen Mandanten.
- Beim Binden werden Konto 1100, Standardkonto 3400 und alle Konten aktiver
  verrechenbarer Leistungsarten validiert.
- Verknüpfte Konten können nicht gelöscht, umnummeriert, deaktiviert oder in
  einen falschen Kontotyp geändert werden.
- Das verwendete Ertragskonto wird auf der Rechnungsposition eingefroren.
  Spätere Gutschriften verwenden dadurch dieselbe Kontierung wie das Original.

## Debitor und Kunde

- Ein CRM-Kunde wird je FiBu-Mandant genau einem FiBu-Kunden zugeordnet.
- Automatisch erzeugte Kundennummern verwenden einen atomaren Nummernkreis.
- Die LE-Rechnungsnummer wird als Debitoren-Belegnummer übernommen.
- `source_system = mailflow_le` und `source_id = le_invoice.id` verhindern
  Doppelbuchungen und bilden die Herkunft ab.

## Zahlung und Storno

- LE-Zahlungen aktualisieren den offenen Debitorenposten.
- Es wird bewusst keine Bank-Hauptbuchbuchung erzeugt: Erst die
  Bankabstimmung kennt das tatsächliche Bankkonto.
- Ein Direktstorno erzeugt eine vollständige Gutschrift und echte
  Gegenbuchungen. Buchungen werden nicht gelöscht.
- Teilgutschriften bleiben als negative offene Posten zur Verrechnung offen.

## Unterstützte Grenzen

- Rechnungen und gebundener Mandant müssen aktuell CHF verwenden.
- Unterstützte MWST-Methoden: `effektiv` und `saldosteuersatz`.
- Fehlt für einen Rechnungs-MWST-Satz ein aktiver FiBu-MWST-Code, wird die
  Finalisierung vollständig zurückgerollt.

## Zusätzlich behobene FiBu-/Debitorenfehler

- atomarer Debitoren-Nummernkreis;
- Schreibrollenprüfung und Zeilensperre beim Debitoren-Storno;
- echte Gegenbuchung statt Löschen;
- korrekte Vorzeichen von Gutschriften in MWST-Zusammenfassung,
  Kontenauswertung und Detailnachweis;
- interner Buchungsnummern-Helfer nicht mehr direkt für normale Benutzer
  ausführbar.

## Verbleibende Befunde ausserhalb der LE-Liveverbuchung

Die neue LE-Buchung ist atomar. Die bestehenden manuellen Erfassungsmasken der
FiBu sollten in einem eigenen Folgepaket gehärtet werden:

- Manuelle Kreditoren-Neuanlage erstellt Kopf, Positionen und Hauptbuch derzeit
  noch in mehreren Client-Schritten; ein Journalfehler wird nur protokolliert.
- Manuelle Debitoren-Neuanlage, Entwurf-Aktualisierung und «Stellen» laufen
  ebenfalls mehrstufig.
- Manuelle Zahlungsänderungen lesen und schreiben den Saldo getrennt und sind
  bei paralleler Bearbeitung nicht vollständig race-sicher.
- Der Kreditoren-Belegnummernvorschlag verwendet noch `MAX + 1`.

Diese Punkte betreffen nicht den neuen Weg Leistungserfassung → Debitoren →
Hauptbuch, sind aber vor einer Freigabe der gesamten manuellen FiBu als
produktionsreif separat zu beheben.

## Prüfung

Der Integrationstest deckt insbesondere ab:

- Rollback ohne Mandantenbindung;
- CHF-/MWST-Methodenprüfung;
- Eigentümersperre und auditierte Korrektur;
- Rechnung, Zahlung, Vollgutschrift und MWST-Vorzeichen;
- Idempotenz bei wiederholter Finalisierung;
- Kontenschutz und ungültige Leistungsartenkonten;
- effektive Methode und Saldosteuersatz-Methode;
- Erhalt historischer Mandantenzuordnungen nach einer Korrektur.
