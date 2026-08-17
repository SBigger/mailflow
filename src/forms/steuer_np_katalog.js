// Positionskatalog für die Steuererklärung natürlicher Personen (kantonsneutral).
//
// Gegliedert nach VERZEICHNISSEN, nicht nach den vier Seiten des Hauptformulars.
// Der Grund steht in jeder echten Erklärung: die Seiten tragen nur Totale, die
// Substanz liegt in den Verzeichnissen — und ein Verzeichnis speist regelmässig
// MEHRERE Ziffern. Nachgemessen an der eingereichten Erklärung ZH 2024 dieses
// Mandats (Dr.-Tax-Ausdruck, 28 Seiten):
//
//   Wertschriftenverzeichnis  → Ertrag Ziff. 4.1 + Vermögen Ziff. 30.1
//                               + Verrechnungsantrag + Q-Blatt (VIER Ziele)
//   Liegenschaftenverzeichnis → Ertrag Ziff. 6 + Vermögen Ziff. 31
//   Schuldenverzeichnis       → Schuldzinsen Ziff. 12 + Schulden Ziff. 34
//
// Deshalb ist «ein Bankbeleg = Vermögen» falsch: der Beleg gehört in EIN
// Verzeichnis (Wertschriften), und das Verzeichnis verteilt auf die Ziffern.
// Derselbe ZKB-Steuerausweis erschien in der Referenz an drei Orten —
// Wertschriften, Schulden und Vermögensverwaltungskosten.
//
// Felder je Position:
//   id           – stabiler Schlüssel (wird gespeichert; Umbenennungen laufen
//                  über ALT_IDS, damit gespeicherte Stände lesbar bleiben)
//   verzeichnis  – zu welchem Stapel die Position gehört (Gliederung der UI)
//   seite, sort  – Seite des Hauptformulars (Info + Feinreihenfolge)
//   belege       – typische Belegarten; Anker für die KI, Hinweis für den Nutzer
//   einkommen    – was auf der EINKOMMENSSEITE gesucht wird (Einkunft oder
//                  Abzug; null = diese Seite bleibt leer, z. B. Autokaufvertrag)
//   wirkung      – 'einkunft' | 'abzug' (nur wo einkommen gesetzt ist)
//   vermoegen    – was auf der VERMÖGENSSEITE gesucht wird, Bestand per 31.12.
//                  (null = leer, z. B. Lohnausweis)
//
//                  JEDER Beleg führt BEIDE Felder — so wie die Erklärung selbst
//                  zwei Dimensionen hat. Der Bank-Steuerausweis füllt beide
//                  (Ertrag + Steuerwert), der Lohnausweis nur das Einkommen,
//                  der Kaufvertrag nur das Vermögen. Die Verzeichnissummen
//                  ergeben sich daraus von selbst.
//   dimensionen  – Zusatzangaben, ohne die die Position nicht auswertbar ist
//   pruefen      – verlangt eine fachliche Entscheidung, die kein Beleg hergibt
//   hinweis      – Fallstricke bei der Zuordnung (geht in den KI-Prompt)

export const DIMENSIONEN = {
  person: 'Ehegatte',
  objekt: 'Liegenschaft',
  konto:  'Konto / Depot',
};

// Die Stapel, in die sortiert wird. `fuehrung` sagt, wie das Verzeichnis im
// Original geführt wird — je Person ein Blatt, je Objekt ein Beiblatt, je
// Konto eine Zeile. `speist` dokumentiert die Ziffern-Ziele aus der Referenz.
export const VERZEICHNISSE = [
  { id: 'allgemein',      label: 'Allgemein',                 fuehrung: null,
    unter: 'Zugangsdaten, Vollmacht, Vorjahr' },
  { id: 'erwerb',         label: 'Lohn, Renten & Erwerb',     fuehrung: 'person',
    unter: 'je Ehegatte', speist: 'Ziff. 1–5' },
  { id: 'wertschriften',  label: 'Wertschriftenverzeichnis',  fuehrung: 'konto',
    unter: 'je Konto / Depot / Titel',
    speist: 'Ertrag Ziff. 4.1 + Vermögen Ziff. 30.1 + Verrechnungsantrag' },
  { id: 'liegenschaften', label: 'Liegenschaftenverzeichnis', fuehrung: 'objekt',
    unter: 'je Objekt, mit Beiblatt',
    speist: 'Ertrag Ziff. 6 + Vermögen Ziff. 31' },
  { id: 'schulden',       label: 'Schuldenverzeichnis',       fuehrung: 'objekt',
    unter: 'je Gläubiger',
    speist: 'Schuldzinsen Ziff. 12 + Schulden Ziff. 34' },
  { id: 'berufsauslagen', label: 'Berufsauslagen',            fuehrung: 'person',
    unter: 'je Ehegatte ein Blatt', speist: 'Ziff. 11' },
  { id: 'vorsorge',       label: 'Vorsorge (3a / PK / AHV)',  fuehrung: 'person',
    unter: 'je Ehegatte', speist: 'Ziff. 13–14' },
  { id: 'versicherungen', label: 'Versicherungen & Krankheit', fuehrung: null,
    unter: 'Prämien gemeinsam', speist: 'Ziff. 15 + 21' },
  { id: 'abzuege',        label: 'Weitere Abzüge',            fuehrung: null,
    unter: 'Spenden, Kinder, Alimente', speist: 'Ziff. 16–22' },
  { id: 'vermoegen',      label: 'Übriges Vermögen',          fuehrung: null,
    unter: 'Bargeld, Fahrzeuge, Übriges', speist: 'Ziff. 30.2–33' },
  { id: 'arbeitspapiere', label: 'Arbeitspapiere',            fuehrung: null,
    unter: 'Keine Beilage' },
  { id: 'aussortiert',    label: 'Nicht benötigt',            fuehrung: null,
    unter: 'Vom Bündel ausgeschlossen' },
];

export const VERZEICHNIS_NACH_ID = Object.fromEntries(VERZEICHNISSE.map(v => [v.id, v]));

// Umbenannte/verschmolzene Positionen: alte id → neue id. Wird beim Laden
// gespeicherter Stände angewandt, damit nichts verloren geht.
export const ALT_IDS = {
  wertschriften_ertrag: 'wertschriften',
  bankguthaben:         'wertschriften',
  schuldzinsen:         'schulden',
  geschaeftsvermoegen:  'selbstaendig',
};

export const KATALOG = [
  // ── Allgemein ─────────────────────────────────────────────────────────────
  { id: 'formular', verzeichnis: 'allgemein', seite: 1, sort: 10,
    label: 'Steuererklärungsformular / Zugangscode',
    belege: ['Zugangsdaten Online-Steuererklärung', 'Zugangscodeschreiben', 'Hauptformular'],
    einkommen: null, vermoegen: null,
    hinweis: 'Schlüsselbeleg: nennt Kanton, Gemeinde, beide Namen, AHVN13, Steuerjahr und Frist. '
           + 'Zuerst auswerten – der Rest des Stapels lässt sich damit sicherer zuordnen.' },

  { id: 'vollmacht', verzeichnis: 'allgemein', seite: 1, sort: 20,
    label: 'Vollmacht / Vertretung',
    belege: ['Vollmacht', 'Vertretungsvollmacht'],
    einkommen: null, vermoegen: null },

  { id: 'vorjahr', verzeichnis: 'allgemein', seite: 1, sort: 30,
    label: 'Vorjahresveranlagung / Schlussrechnung',
    belege: ['Veranlagungsverfügung', 'Schlussrechnung', 'Steuerausscheidung'],
    einkommen: null, vermoegen: null,
    hinweis: 'Betrifft das Vorjahr – Grundlage, nicht Beilage zum laufenden Jahr.' },

  // ── Lohn, Renten & Erwerb ────────────────────────────────────────────────
  { id: 'lohn_haupt', verzeichnis: 'erwerb', seite: 2, sort: 10,
    label: 'Unselbständige Erwerbstätigkeit – Haupterwerb',
    belege: ['Lohnausweis'],
    einkommen: 'Nettolohn (Lohnausweis Ziffer 11)', wirkung: 'einkunft', vermoegen: null,
    dimensionen: ['person'],
    hinweis: 'Massgebend ist der Nettolohn in Ziffer 11, nicht der Bruttolohn. '
           + 'Der Name des Arbeitnehmers steht im Adressfeld – daran hängt die Person.' },

  { id: 'lohn_neben', verzeichnis: 'erwerb', seite: 2, sort: 20,
    label: 'Unselbständige Erwerbstätigkeit – Nebenerwerb',
    belege: ['Lohnausweis', 'Honorarabrechnung'],
    einkommen: 'Nettolohn (Lohnausweis Ziffer 11)', wirkung: 'einkunft', vermoegen: null,
    dimensionen: ['person'],
    hinweis: 'Zweiter und weiterer Lohnausweis derselben Person im gleichen Jahr.' },

  { id: 'selbstaendig', verzeichnis: 'erwerb', seite: 2, sort: 30,
    label: 'Selbständige Erwerbstätigkeit',
    belege: ['Jahresrechnung', 'Erfolgsrechnung', 'Bilanz', 'Fragebogen Selbständigerwerbende'],
    einkommen: 'Reingewinn', wirkung: 'einkunft',
    vermoegen: 'Eigenkapital per 31.12. (Geschäftsvermögen)',
    dimensionen: ['person'],
    hinweis: 'DIESELBE Jahresrechnung speist den Gewinn (Einkommen) und das '
           + 'Geschäftsvermögen (Vermögen) – ein Beleg, zwei Beträge.' },

  { id: 'rente_ahv', verzeichnis: 'erwerb', seite: 2, sort: 40,
    label: 'AHV- / IV-Renten',
    belege: ['Rentenbescheinigung AHV', 'IV-Rentenbescheinigung', 'Ausgleichskasse'],
    einkommen: 'Jahresrente', wirkung: 'einkunft', vermoegen: null, dimensionen: ['person'] },

  { id: 'rente_pk', verzeichnis: 'erwerb', seite: 2, sort: 50,
    label: 'Renten aus 2. Säule (Pensionskasse)',
    belege: ['Rentenausweis Pensionskasse', 'BVG-Rentenbescheinigung'],
    einkommen: 'Jahresrente', wirkung: 'einkunft', vermoegen: null, dimensionen: ['person'],
    hinweis: 'Nicht mit dem Vorsorgeausweis aktiver Versicherter verwechseln – der ist kein Einkommen.' },

  { id: 'rente_saeule3', verzeichnis: 'erwerb', seite: 2, sort: 60,
    label: 'Renten und Kapitalleistungen aus Säule 3a / 3b',
    belege: ['Rentenbescheinigung', 'Kapitalleistungsabrechnung', 'Auszahlungsbeleg Säule 3a'],
    einkommen: 'Rente bzw. Kapitalleistung', wirkung: 'einkunft', vermoegen: null, dimensionen: ['person'],
    hinweis: 'Kapitalleistungen werden gesondert besteuert (Ziff. 40) – separat kennzeichnen.' },

  { id: 'ersatz', verzeichnis: 'erwerb', seite: 2, sort: 70,
    label: 'Erwerbsausfallentschädigungen (ALV, KTG, UVG, EO/MSE)',
    belege: ['Taggeldabrechnung', 'Arbeitslosenkasse', 'Krankentaggeld', 'EO-Abrechnung'],
    einkommen: 'Total Taggelder', wirkung: 'einkunft', vermoegen: null, dimensionen: ['person'] },

  { id: 'alimente_erhalten', verzeichnis: 'erwerb', seite: 2, sort: 80,
    label: 'Erhaltene Unterhaltsbeiträge (Alimente)',
    belege: ['Scheidungsurteil', 'Trennungsvereinbarung', 'Zahlungsnachweis'],
    einkommen: 'Jahresbetrag', wirkung: 'einkunft', vermoegen: null, dimensionen: ['person'],
    hinweis: 'Kinderalimente und Ehegattenalimente getrennt erfassen.' },

  { id: 'uebrige_einkuenfte', verzeichnis: 'erwerb', seite: 2, sort: 90,
    label: 'Übrige Einkünfte',
    belege: ['Verwaltungsratshonorar', 'Lotteriegewinn', 'Nutzniessung'],
    einkommen: 'Betrag', wirkung: 'einkunft', vermoegen: null, dimensionen: ['person'] },

  // ── Wertschriftenverzeichnis ─────────────────────────────────────────────
  { id: 'wertschriften', verzeichnis: 'wertschriften', seite: 4, sort: 10,
    label: 'Konto / Depot / Titel',
    belege: ['Steuerausweis Bank', 'Steuerverzeichnis', 'Kontoauszug 31.12.', 'Depotauszug',
             'Zinsausweis', 'Dividendenabrechnung', 'eSteuerauszug'],
    einkommen: 'Bruttoertrag im Jahr', wirkung: 'einkunft',
    vermoegen: 'Steuerwert per 31.12.',
    dimensionen: ['konto', 'person'],
    hinweis: 'EIN Beleg, MEHRERE Ziele: Steuerwert → Vermögen, Bruttoertrag → Einkommen, '
           + '35% des Ertrags A → Verrechnungsantrag. Je Konto/Depot eine eigene Zeile. '
           + 'Nennt der Ausweis auch Sollsaldi oder Schuldzinsen, zusätzlich dem '
           + 'Schuldenverzeichnis zuordnen.' },

  { id: 'beteiligung_qualifiziert', verzeichnis: 'wertschriften', seite: 4, sort: 20,
    label: 'Qualifizierte Beteiligung (≥10%)',
    belege: ['Dividendenbescheinigung', 'Steuerbescheinigung Beteiligung', 'Aktienregister'],
    einkommen: 'Bruttodividende im Jahr', wirkung: 'einkunft',
    vermoegen: 'Steuerwert per 31.12.',
    dimensionen: ['person'],
    hinweis: 'Eigene AG/GmbH-Anteile: stehen im Wertschriftenverzeichnis mit Code Q und '
           + 'zusätzlich auf dem Blatt «Qualifizierte Beteiligungen» (Teilbesteuerung Ziff. 16.5).' },

  { id: 'krypto', verzeichnis: 'wertschriften', seite: 4, sort: 30,
    label: 'Kryptowährungen',
    belege: ['Krypto-Bestandsauszug', 'Wallet-Auszug', 'Börsenauszug'],
    einkommen: null, vermoegen: 'Bestand per 31.12.', dimensionen: ['person'],
    hinweis: 'Gehören ins Wertschriftenverzeichnis (Kursliste ESTV), nicht zu Bargeld.' },

  // ── Liegenschaftenverzeichnis ────────────────────────────────────────────
  { id: 'liegenschaft_ertrag', verzeichnis: 'liegenschaften', seite: 2, sort: 10,
    label: 'Ertrag / Eigenmietwert / Mieterspiegel',
    belege: ['Mietzinsabrechnung', 'Mietvertrag', 'Eigenmietwertverfügung', 'Mietzinskonto'],
    einkommen: 'Mietertrag bzw. Eigenmietwert', wirkung: 'einkunft', vermoegen: null, dimensionen: ['objekt'],
    hinweis: 'Mieterspiegel steht auf der Vorderseite des Beiblatts je Objekt.' },

  { id: 'liegenschaftsunterhalt', verzeichnis: 'liegenschaften', seite: 3, sort: 20,
    label: 'Unterhalts- und Verwaltungskosten',
    belege: ['Handwerkerrechnung', 'Gebäudeversicherung', 'Kaminfeger', 'Heizung/Service',
             'Verwaltungsabrechnung', 'Strom/Gas Nebenkosten vermietet'],
    einkommen: 'Rechnungsbetrag (Unterhalt)', wirkung: 'abzug', vermoegen: null, dimensionen: ['objekt'],
    pruefen: 'werterhaltend oder wertvermehrend (Anteil in %)',
    hinweis: 'Aufstellung je Objekt auf der Rückseite des Beiblatts, mit Spalte '
           + '«davon wertvermehrend %». Die Gebäudeversicherung gehört HIERHER, '
           + 'nicht zu den Versicherungsprämien. Effektiv wird mit dem Pauschalabzug verglichen.' },

  { id: 'liegenschaften', verzeichnis: 'liegenschaften', seite: 4, sort: 30,
    label: 'Steuerwert / Objektdaten',
    belege: ['Steuerwertverfügung', 'Amtliche Schätzung', 'Kaufvertrag', 'Grundbuchauszug'],
    einkommen: null, vermoegen: 'Steuerwert', dimensionen: ['objekt'] },

  // ── Schuldenverzeichnis ──────────────────────────────────────────────────
  { id: 'schulden', verzeichnis: 'schulden', seite: 4, sort: 10,
    label: 'Schuld je Gläubiger',
    belege: ['Hypothekarausweis', 'Zinsausweis', 'Kreditausweis', 'Darlehensvertrag',
             'Kontokorrentauszug'],
    einkommen: 'Schuldzinsen im Jahr', wirkung: 'abzug',
    vermoegen: 'Restschuld per 31.12.',
    dimensionen: ['objekt'],
    hinweis: 'Eine Zeile je Gläubiger, beide Spalten aus demselben Ausweis: '
           + 'Restschuld → Ziff. 34, Zinsen → Ziff. 12. Hypotheken dem Objekt zuordnen.' },

  // ── Berufsauslagen (je Person ein Blatt) ─────────────────────────────────
  { id: 'berufsauslagen_fahrkosten', verzeichnis: 'berufsauslagen', seite: 3, sort: 10,
    label: 'Fahrkosten',
    belege: ['ÖV-Abonnement', 'Streckenabonnement', 'Arbeitswegbestätigung'],
    einkommen: 'Jahreskosten', wirkung: 'abzug', vermoegen: null, dimensionen: ['person'] },

  { id: 'berufsauslagen_verpflegung', verzeichnis: 'berufsauslagen', seite: 3, sort: 20,
    label: 'Verpflegung / auswärtige Unterkunft',
    belege: ['Bestätigung Arbeitgeber', 'Kantinenabrechnung', 'Mietvertrag Wochenaufenthalt'],
    einkommen: 'Jahreskosten', wirkung: 'abzug', vermoegen: null, dimensionen: ['person'],
    hinweis: 'Verbilligte Kantine kürzt den Abzug – Lohnausweis Ziffer 13 beachten.' },

  { id: 'berufsauslagen_uebrige', verzeichnis: 'berufsauslagen', seite: 3, sort: 30,
    label: 'Übrige Berufskosten',
    belege: ['Berufsverbandsbeitrag', 'Fachliteratur', 'Arbeitszimmer', 'Pauschalspesen'],
    einkommen: 'Jahreskosten', wirkung: 'abzug', vermoegen: null, dimensionen: ['person'] },

  { id: 'weiterbildung', verzeichnis: 'berufsauslagen', seite: 3, sort: 40,
    label: 'Aus- und Weiterbildung',
    belege: ['Kursrechnung', 'Studiengebühren', 'Prüfungsgebühren', 'Kursbestätigung'],
    einkommen: 'Jahreskosten', wirkung: 'abzug', vermoegen: null, dimensionen: ['person'],
    hinweis: 'Eigener Abzug (nicht Teil der Berufsauslagen-Pauschale), hier nur einsortiert.' },

  // ── Vorsorge ─────────────────────────────────────────────────────────────
  { id: 'saeule_3a', verzeichnis: 'vorsorge', seite: 3, sort: 10,
    label: 'Beiträge Säule 3a',
    belege: ['Vorsorgebescheinigung Säule 3a', 'Bescheinigung gebundene Vorsorge'],
    einkommen: 'Einzahlung im Steuerjahr', wirkung: 'abzug', vermoegen: null, dimensionen: ['person'],
    hinweis: 'Häufigster Beleg überhaupt. Je Person und Vorsorgeeinrichtung ein eigener '
           + 'Ausweis – in der Referenz als Aufstellung je Person mit Policen-Nr. geführt.' },

  { id: 'einkauf_pk', verzeichnis: 'vorsorge', seite: 3, sort: 20,
    label: 'Einkauf in die 2. Säule',
    belege: ['Einkaufsbestätigung Pensionskasse', 'Bestätigung freiwilliger Einkauf'],
    einkommen: 'Einkaufssumme', wirkung: 'abzug', vermoegen: null, dimensionen: ['person'] },

  { id: 'ahv_beitraege', verzeichnis: 'vorsorge', seite: 3, sort: 30,
    label: 'AHV/IV/EO-Beiträge Nichterwerbstätiger',
    belege: ['Beitragsverfügung Ausgleichskasse'],
    einkommen: 'Jahresbeitrag', wirkung: 'abzug', vermoegen: null, dimensionen: ['person'] },

  // ── Versicherungen & Krankheit ───────────────────────────────────────────
  { id: 'versicherungspraemien', verzeichnis: 'versicherungen', seite: 3, sort: 10,
    label: 'Versicherungsprämien und Sparzinsen',
    belege: ['Prämienbescheinigung Krankenkasse', 'Prämien- und Kostenübersicht',
             'Lebensversicherung', 'private Unfallversicherung'],
    einkommen: 'Jahresprämie', wirkung: 'abzug', vermoegen: null, dimensionen: ['person'],
    hinweis: 'Blatt wird gemeinsam geführt (abzüglich Prämienverbilligung, Maximalabzug '
           + 'nach Zivilstand). Die GEBÄUDEversicherung gehört zum Liegenschaftsunterhalt. '
           + 'Kassenübersichten enthalten oft auch Leistungsabrechnungen – dann zusätzlich '
           + 'Krankheitskosten.' },

  { id: 'krankheitskosten', verzeichnis: 'versicherungen', seite: 3, sort: 20,
    label: 'Krankheits- und Unfallkosten',
    belege: ['Arztrechnung', 'Zahnarztrechnung', 'Leistungsabrechnung Krankenkasse', 'Apothekenbeleg'],
    einkommen: 'Selbst getragener Betrag', wirkung: 'abzug', vermoegen: null, dimensionen: ['person'],
    hinweis: 'Nur der selbst getragene Teil zählt – Kassenleistung von der Rechnung abziehen.' },

  { id: 'behinderungskosten', verzeichnis: 'versicherungen', seite: 3, sort: 30,
    label: 'Behinderungsbedingte Kosten',
    belege: ['Pflegeheimrechnung', 'IV-Ausweis', 'Hilfsmittelrechnung'],
    einkommen: 'Betrag', wirkung: 'abzug', vermoegen: null, dimensionen: ['person'] },

  // ── Weitere Abzüge ───────────────────────────────────────────────────────
  { id: 'alimente_bezahlt', verzeichnis: 'abzuege', seite: 3, sort: 10,
    label: 'Bezahlte Unterhaltsbeiträge (Alimente)',
    belege: ['Scheidungsurteil', 'Zahlungsnachweis', 'Bankbelastung'],
    einkommen: 'Jahresbetrag', wirkung: 'abzug', vermoegen: null, dimensionen: ['person'] },

  { id: 'kinderbetreuung', verzeichnis: 'abzuege', seite: 3, sort: 20,
    label: 'Kinderbetreuungskosten',
    belege: ['Kita-Rechnung', 'Tagesmutter', 'Hortrechnung'],
    einkommen: 'Jahreskosten', wirkung: 'abzug', vermoegen: null },

  { id: 'spenden', verzeichnis: 'abzuege', seite: 3, sort: 30,
    label: 'Gemeinnützige Zuwendungen / Spenden',
    belege: ['Spendenbescheinigung', 'Zuwendungsbestätigung', 'Einzahlungsschein Hilfswerk'],
    einkommen: 'Jahresbetrag', wirkung: 'abzug', vermoegen: null,
    hinweis: 'In der Referenz als Aufstellung mit Datum und Empfänger je Zeile. '
           + 'Einzahlungsscheine sind oft blanko – Betrag steht nur im Kontoauszug: '
           + 'Position zuordnen, Betrag offen lassen statt raten.' },

  { id: 'parteispenden', verzeichnis: 'abzuege', seite: 3, sort: 40,
    label: 'Zuwendungen an politische Parteien',
    belege: ['Spendenbescheinigung Partei'],
    einkommen: 'Jahresbetrag', wirkung: 'abzug', vermoegen: null,
    hinweis: 'Läuft über «Weitere Abzüge» (Ziff. 16.5), nicht über die Spenden-Aufstellung.' },

  { id: 'uebrige_abzuege', verzeichnis: 'abzuege', seite: 3, sort: 50,
    label: 'Übrige Abzüge / Vermögensverwaltung',
    belege: ['Depotgebühren', 'Vermögensverwaltungskosten'],
    einkommen: 'Betrag', wirkung: 'abzug', vermoegen: null,
    hinweis: 'Die Pauschale für Vermögensverwaltung berechnet sich aus den Depots im '
           + 'Wertschriftenverzeichnis – der Bank-Steuerausweis liefert die Basis gleich mit.' },

  // ── Übriges Vermögen ─────────────────────────────────────────────────────
  { id: 'bargeld', verzeichnis: 'vermoegen', seite: 4, sort: 10,
    label: 'Bargeld, Edelmetalle',
    belege: ['Goldkauf-Quittung', 'Edelmetall-Depotauszug', 'Tresorbestand'],
    einkommen: null, vermoegen: 'Steuerwert per 31.12.',
    hinweis: 'In der Referenz als eigene Aufstellung (Goldkäufe, Tresorbestand) zu Ziff. 30.2. '
           + 'Krypto gehört NICHT hierher, sondern ins Wertschriftenverzeichnis.' },

  { id: 'lebensversicherung', verzeichnis: 'vermoegen', seite: 4, sort: 20,
    label: 'Lebensversicherungen (Rückkaufswert)',
    belege: ['Rückkaufswertbescheinigung', 'Steuerbescheinigung Lebensversicherung'],
    einkommen: null, vermoegen: 'Rückkaufswert per 31.12.', dimensionen: ['person'] },

  { id: 'fahrzeuge', verzeichnis: 'vermoegen', seite: 4, sort: 30,
    label: 'Fahrzeuge',
    belege: ['Kaufvertrag', 'Fahrzeugausweis', 'Eurotax-Bewertung'],
    einkommen: null, vermoegen: 'Zeitwert' },

  { id: 'uebriges_vermoegen', verzeichnis: 'vermoegen', seite: 4, sort: 40,
    label: 'Übrige Vermögenswerte (Darlehen, Erbanteile, Kapitaleinlagen)',
    belege: ['Darlehensvertrag', 'Erbteilungsvertrag', 'Sanierungsvereinbarung', 'Kapitaleinzahlung'],
    einkommen: null, vermoegen: 'Wert per 31.12.', dimensionen: ['person'],
    hinweis: 'Aktiv-Darlehen (verliehen) hierher bzw. ins Wertschriftenverzeichnis; '
           + 'Passiv-Darlehen (geschuldet) ins Schuldenverzeichnis.' },

  // ── Arbeitspapiere ───────────────────────────────────────────────────────
  { id: 'arbeitsnotiz', verzeichnis: 'arbeitspapiere', seite: 0, sort: 10,
    label: 'Besprechungs- und Arbeitsnotizen',
    belege: ['handschriftliche Notiz', 'Besprechungsnotiz', 'Pendenzenliste', 'Checkliste'],
    einkommen: null, vermoegen: null },

  { id: 'eigene_berechnung', verzeichnis: 'arbeitspapiere', seite: 0, sort: 20,
    label: 'Eigene Berechnungen und Aufstellungen',
    belege: ['Zinsberechnung', 'Aufstellung Treuhänder', 'Hilfsblatt'],
    einkommen: null, vermoegen: null,
    hinweis: 'Papier mit eigenem Briefkopf ist Arbeitspapier, kein Beleg des Mandanten.' },
];

// Belege, die zwar im Stapel liegen, aber nirgends hingehören. Sichtbar
// liegen lassen, nie automatisch löschen — sie stehen auf dem Deckblatt des
// Bündels unter «Gesichtet, nicht beigelegt».
export const AUSSORTIERT = {
  id: '_aussortiert', verzeichnis: 'aussortiert', seite: 99, sort: 999,
  label: 'Nicht zur Steuererklärung',
  belege: ['Werbung', 'Doppel', 'Privatpost', 'privater Konsum', 'unleserlich', 'leere Seite'],
  einkommen: null, vermoegen: null,
  hinweis: 'Rechnungen für privaten Konsum (Möbel, Geräte, Hobby, Garten) sind nicht '
         + 'abzugsfähig, auch wenn sie wie eine Handwerkerrechnung aussehen.',
};

// Ein Beleg kann zwei Verzeichnisse bedienen. Seit dem Verzeichnis-Umbau sind
// die meisten alten Paare in EINE Position mit zwei Betragsfeldern verschmolzen;
// übrig bleiben die echten verzeichnisübergreifenden Fälle.
export const MEHRFACH_ZUORDNUNG = [
  ['wertschriften', 'schulden'],              // Bank-Steuerausweis mit Sollsaldi
  ['versicherungspraemien', 'krankheitskosten'], // Kassenübersicht mit Leistungsteil
];

export const KATALOG_NACH_ID = Object.fromEntries(
  [...KATALOG, AUSSORTIERT].map(p => [p.id, p])
);

/** Alte Positions-ids aus gespeicherten Ständen auf die heutigen abbilden. */
export function migriereId(positionId) {
  return ALT_IDS[positionId] || positionId;
}

const VERZEICHNIS_RANG = Object.fromEntries(VERZEICHNISSE.map((v, i) => [v.id, i]));

/** Belege in die Reihenfolge der Erklärung bringen: Verzeichnis, dann Position. */
export function sortiereNachKatalog(belege, positionVon = b => b.positionId) {
  const rang = Object.fromEntries(
    [...KATALOG, AUSSORTIERT].map(p => [
      p.id,
      (VERZEICHNIS_RANG[p.verzeichnis] ?? 90) * 1000 + p.sort,
    ])
  );
  return [...belege].sort((a, b) => {
    const ra = rang[positionVon(a)] ?? Number.MAX_SAFE_INTEGER;
    const rb = rang[positionVon(b)] ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

/** Kompakte Positionsliste für den KI-Prompt. */
export function katalogFuerPrompt() {
  return [...KATALOG, AUSSORTIERT]
    .map(p => {
      const v = VERZEICHNIS_NACH_ID[p.verzeichnis];
      const teile = [p.id, v?.label || p.verzeichnis, p.label, p.belege.join(', ')];
      if (p.dimensionen) teile.push(`benötigt: ${p.dimensionen.join(' + ')}`);
      if (p.einkommen)   teile.push(`${p.wirkung === 'abzug' ? 'Abzug' : 'Einkunft'}: ${p.einkommen}`);
      if (p.vermoegen)   teile.push(`Vermögen: ${p.vermoegen}`);
      if (p.hinweis)     teile.push(`Hinweis: ${p.hinweis}`);
      return teile.join(' | ');
    })
    .join('\n');
}

// Rückwärtskompatibilität: GRUPPEN hiess die alte Seitengliederung. Ein paar
// Stellen (Bündel-Deckblatt) lesen sie noch für die Seitenbeschriftung.
export const GRUPPEN = [
  { id: 'allgemein', label: 'Allgemein / Personalien', seite: 1 },
  { id: 'einkommen', label: 'Einkünfte',               seite: 2 },
  { id: 'abzuege',   label: 'Abzüge',                  seite: 3 },
  { id: 'vermoegen', label: 'Vermögen',                seite: 4 },
];
