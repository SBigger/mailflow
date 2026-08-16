// Positionskatalog für die Steuererklärung natürlicher Personen (kantonsneutral).
//
// Wozu: Ein Mandant bringt einen Stapel Belege. Dieser Katalog sagt, wohin jeder
// Beleg in der Steuererklärung gehört – damit der Stapel in genau die Reihenfolge
// gebracht werden kann, in der die Erklärung ausgefüllt wird (Seite 2 Einkünfte,
// Seite 3 Abzüge, Seite 4 Vermögen).
//
// Warum kantonsneutral: Die Ziffernnummern unterscheiden sich je Kanton, der
// Aufbau kaum – das Steuerharmonisierungsgesetz gibt Einkommens- und
// Vermögensbegriff vor. Wir sortieren deshalb nach Position, nicht nach Ziffer.
//
// Felder je Position:
//   id          – stabiler Schlüssel (wird gespeichert, nie ändern)
//   seite       – Seite der Steuererklärung (Sortierung 1. Ebene)
//   sort        – Reihenfolge innerhalb der Seite
//   gruppe      – 'arbeitspapier' | 'allgemein' | 'einkommen' | 'abzuege' | 'vermoegen'
//   label       – Anzeigename
//   belege      – typische Belegarten; Anker für die KI, Hinweis für den Nutzer
//   betrag      – was für ein Betrag ausgelesen werden soll (null = kein Betrag)
//   stichtag    – 'jahr' = Summe über das Steuerjahr · 'ende' = Bestand per 31.12.
//                 · null = kein Betrag
//   dimensionen – Zusatzangaben, ohne die die Position nicht auswertbar ist
//   pruefen     – verlangt eine fachliche Entscheidung, die kein Beleg hergibt
//   hinweis     – Fallstricke bei der Zuordnung (geht in den KI-Prompt)

export const GRUPPEN = [
  { id: 'arbeitspapier', label: 'Arbeitspapiere (keine Beilage)', seite: 0 },
  { id: 'allgemein',     label: 'Allgemein / Personalien',        seite: 1 },
  { id: 'einkommen',     label: 'Einkünfte',                      seite: 2 },
  { id: 'abzuege',       label: 'Abzüge',                         seite: 3 },
  { id: 'vermoegen',     label: 'Vermögen',                       seite: 4 },
];

// Zusatzangaben, die ein Beleg an dieser Position braucht, damit die Sortierung
// überhaupt brauchbar ist. Ohne sie landen bei einem Ehepaar mit zwei
// Liegenschaften alle Belege auf einem Haufen.
//   'person' – bei gemeinsamer Veranlagung: welcher Ehegatte? Der Lohnausweis
//              der Frau gehört in ihre Spalte, nicht in die des Mannes.
//   'objekt' – welche Liegenschaft? Unterhalt und Hypothek werden je Objekt
//              gerechnet, nicht über alle zusammen.
//   'konto'  – welche Bankbeziehung? Das Wertschriftenverzeichnis führt jedes
//              Konto und Depot einzeln auf, mit Bestand und Ertrag.
export const DIMENSIONEN = {
  person: 'Ehegatte',
  objekt: 'Liegenschaft',
  konto:  'Konto / Depot',
};

export const KATALOG = [
  // ── Seite 0 · Arbeitspapiere ──────────────────────────────────────────────
  // Eigene Unterlagen, keine Beilage für das Steueramt. Gehören weder ins
  // Bündel noch in den Aussortiert-Korb, sondern zum Dossier.
  { id: 'arbeitsnotiz', seite: 0, sort: 10, gruppe: 'arbeitspapier',
    label: 'Besprechungs- und Arbeitsnotizen',
    belege: ['handschriftliche Notiz', 'Besprechungsnotiz', 'Pendenzenliste', 'Checkliste'],
    betrag: null, stichtag: null },

  { id: 'eigene_berechnung', seite: 0, sort: 20, gruppe: 'arbeitspapier',
    label: 'Eigene Berechnungen und Aufstellungen',
    belege: ['Zinsberechnung', 'Aufstellung Treuhänder', 'Hilfsblatt'],
    betrag: null, stichtag: null,
    hinweis: 'Papier mit eigenem Briefkopf ist Arbeitspapier, kein Beleg des Mandanten.' },

  // ── Seite 1 · Allgemein ───────────────────────────────────────────────────
  { id: 'formular', seite: 1, sort: 10, gruppe: 'allgemein',
    label: 'Steuererklärungsformular / Zugangscode',
    belege: ['Zugangsdaten Online-Steuererklärung', 'Zugangscodeschreiben', 'Hauptformular'],
    betrag: null, stichtag: null,
    hinweis: 'Schlüsselbeleg: nennt Kanton, Gemeinde, beide Namen, AHVN13, Steuerjahr und Frist. '
           + 'Zuerst auswerten – der Rest des Stapels lässt sich damit sicherer zuordnen.' },

  { id: 'vollmacht', seite: 1, sort: 20, gruppe: 'allgemein',
    label: 'Vollmacht / Vertretung',
    belege: ['Vollmacht', 'Vertretungsvollmacht'],
    betrag: null, stichtag: null },

  { id: 'vorjahr', seite: 1, sort: 30, gruppe: 'allgemein',
    label: 'Vorjahresveranlagung / Schlussrechnung',
    belege: ['Veranlagungsverfügung', 'Schlussrechnung', 'Steuerausscheidung'],
    betrag: null, stichtag: null,
    hinweis: 'Betrifft das Vorjahr – Grundlage, nicht Beilage zum laufenden Jahr.' },

  // ── Seite 2 · Einkünfte ───────────────────────────────────────────────────
  { id: 'lohn_haupt', seite: 2, sort: 10, gruppe: 'einkommen',
    label: 'Unselbständige Erwerbstätigkeit – Haupterwerb',
    belege: ['Lohnausweis'],
    betrag: 'Nettolohn (Lohnausweis Ziffer 11)', stichtag: 'jahr',
    dimensionen: ['person'],
    hinweis: 'Massgebend ist der Nettolohn in Ziffer 11, nicht der Bruttolohn. '
           + 'Der Name des Arbeitnehmers steht im Adressfeld – daran hängt die Person.' },

  { id: 'lohn_neben', seite: 2, sort: 20, gruppe: 'einkommen',
    label: 'Unselbständige Erwerbstätigkeit – Nebenerwerb',
    belege: ['Lohnausweis', 'Honorarabrechnung'],
    betrag: 'Nettolohn (Lohnausweis Ziffer 11)', stichtag: 'jahr',
    dimensionen: ['person'],
    hinweis: 'Zweiter und weiterer Lohnausweis derselben Person im gleichen Jahr.' },

  { id: 'selbstaendig', seite: 2, sort: 30, gruppe: 'einkommen',
    label: 'Selbständige Erwerbstätigkeit',
    belege: ['Jahresrechnung', 'Erfolgsrechnung', 'Fragebogen Selbständigerwerbende', 'AHV-Beitragsverfügung'],
    betrag: 'Reingewinn', stichtag: 'jahr',
    dimensionen: ['person'] },

  { id: 'rente_ahv', seite: 2, sort: 40, gruppe: 'einkommen',
    label: 'AHV- / IV-Renten',
    belege: ['Rentenbescheinigung AHV', 'IV-Rentenbescheinigung', 'Ausgleichskasse'],
    betrag: 'Jahresrente', stichtag: 'jahr',
    dimensionen: ['person'] },

  { id: 'rente_pk', seite: 2, sort: 50, gruppe: 'einkommen',
    label: 'Renten aus 2. Säule (Pensionskasse)',
    belege: ['Rentenausweis Pensionskasse', 'BVG-Rentenbescheinigung'],
    betrag: 'Jahresrente', stichtag: 'jahr',
    dimensionen: ['person'],
    hinweis: 'Nicht mit dem Vorsorgeausweis aktiver Versicherter verwechseln – der ist kein Einkommen.' },

  { id: 'rente_saeule3', seite: 2, sort: 60, gruppe: 'einkommen',
    label: 'Renten und Kapitalleistungen aus Säule 3a / 3b',
    belege: ['Rentenbescheinigung', 'Kapitalleistungsabrechnung', 'Auszahlungsbeleg Säule 3a'],
    betrag: 'Rente bzw. Kapitalleistung', stichtag: 'jahr',
    dimensionen: ['person'],
    hinweis: 'Kapitalleistungen werden gesondert besteuert – separat kennzeichnen.' },

  { id: 'ersatz', seite: 2, sort: 70, gruppe: 'einkommen',
    label: 'Erwerbsausfallentschädigungen (ALV, KTG, UVG, EO/MSE)',
    belege: ['Taggeldabrechnung', 'Arbeitslosenkasse', 'Unfallversicherung', 'Krankentaggeld', 'EO-Abrechnung'],
    betrag: 'Total Taggelder', stichtag: 'jahr',
    dimensionen: ['person'] },

  { id: 'wertschriften_ertrag', seite: 2, sort: 80, gruppe: 'einkommen',
    label: 'Ertrag aus Wertschriften und Guthaben',
    belege: ['Steuerausweis Bank', 'Steuerverzeichnis', 'Zinsausweis', 'Dividendenabrechnung', 'Depotauszug'],
    betrag: 'Bruttoertrag / verrechnungssteuerpflichtiger Ertrag', stichtag: 'jahr',
    dimensionen: ['konto', 'person'],
    hinweis: 'Je Konto/Depot eine eigene Zeile – Grundlage des Wertschriftenverzeichnisses. '
           + 'Dasselbe Bankdokument liefert meist auch den Bestand (Seite 4).' },

  { id: 'liegenschaft_ertrag', seite: 2, sort: 90, gruppe: 'einkommen',
    label: 'Ertrag aus Liegenschaften / Eigenmietwert',
    belege: ['Mietzinsabrechnung', 'Liegenschaftsschätzung', 'Eigenmietwertverfügung', 'Mietzinskonto'],
    betrag: 'Mietertrag bzw. Eigenmietwert', stichtag: 'jahr',
    dimensionen: ['objekt'] },

  { id: 'alimente_erhalten', seite: 2, sort: 100, gruppe: 'einkommen',
    label: 'Erhaltene Unterhaltsbeiträge (Alimente)',
    belege: ['Scheidungsurteil', 'Trennungsvereinbarung', 'Zahlungsnachweis'],
    betrag: 'Jahresbetrag', stichtag: 'jahr',
    dimensionen: ['person'],
    hinweis: 'Kinderalimente und Ehegattenalimente getrennt erfassen.' },

  { id: 'uebrige_einkuenfte', seite: 2, sort: 110, gruppe: 'einkommen',
    label: 'Übrige Einkünfte',
    belege: ['Lotteriegewinn', 'Nutzniessung', 'Erbschaft', 'Verwaltungsratshonorar'],
    betrag: 'Betrag', stichtag: 'jahr',
    dimensionen: ['person'] },

  // ── Seite 3 · Abzüge ──────────────────────────────────────────────────────
  { id: 'berufsauslagen_fahrkosten', seite: 3, sort: 10, gruppe: 'abzuege',
    label: 'Berufsauslagen – Fahrkosten',
    belege: ['ÖV-Abonnement', 'Streckenabonnement', 'Arbeitswegbestätigung', 'Fahrkostennachweis'],
    betrag: 'Jahreskosten', stichtag: 'jahr',
    dimensionen: ['person'] },

  { id: 'berufsauslagen_verpflegung', seite: 3, sort: 11, gruppe: 'abzuege',
    label: 'Berufsauslagen – Verpflegung / auswärtige Unterkunft',
    belege: ['Bestätigung Arbeitgeber', 'Kantinenabrechnung', 'Mietvertrag Wochenaufenthalt'],
    betrag: 'Jahreskosten', stichtag: 'jahr',
    dimensionen: ['person'],
    hinweis: 'Verbilligte Kantine kürzt den Abzug – Lohnausweis Ziffer 13 beachten.' },

  { id: 'berufsauslagen_uebrige', seite: 3, sort: 12, gruppe: 'abzuege',
    label: 'Berufsauslagen – übrige Berufskosten',
    belege: ['Berufsverbandsbeitrag', 'Fachliteratur', 'Arbeitszimmer', 'Berufswerkzeug'],
    betrag: 'Jahreskosten', stichtag: 'jahr',
    dimensionen: ['person'] },

  { id: 'weiterbildung', seite: 3, sort: 13, gruppe: 'abzuege',
    label: 'Berufsauslagen – Aus- und Weiterbildung',
    belege: ['Kursrechnung', 'Studiengebühren', 'Prüfungsgebühren', 'Kursbestätigung'],
    betrag: 'Jahreskosten', stichtag: 'jahr',
    dimensionen: ['person'] },

  { id: 'saeule_3a', seite: 3, sort: 20, gruppe: 'abzuege',
    label: 'Beiträge Säule 3a',
    belege: ['Vorsorgebescheinigung Säule 3a', 'Bescheinigung gebundene Vorsorge'],
    betrag: 'Einzahlung im Steuerjahr', stichtag: 'jahr',
    dimensionen: ['person'],
    hinweis: 'Häufigster Beleg überhaupt. Pro Person und Vorsorgeeinrichtung ein eigener Ausweis.' },

  { id: 'einkauf_pk', seite: 3, sort: 30, gruppe: 'abzuege',
    label: 'Einkauf in die 2. Säule',
    belege: ['Einkaufsbestätigung Pensionskasse', 'Bestätigung freiwilliger Einkauf'],
    betrag: 'Einkaufssumme', stichtag: 'jahr',
    dimensionen: ['person'] },

  { id: 'ahv_beitraege', seite: 3, sort: 40, gruppe: 'abzuege',
    label: 'AHV/IV/EO-Beiträge Nichterwerbstätiger',
    belege: ['Beitragsverfügung Ausgleichskasse'],
    betrag: 'Jahresbeitrag', stichtag: 'jahr',
    dimensionen: ['person'] },

  { id: 'versicherungspraemien', seite: 3, sort: 50, gruppe: 'abzuege',
    label: 'Versicherungsprämien und Sparzinsen',
    belege: ['Prämienbescheinigung Krankenkasse', 'Prämien- und Kostenübersicht', 'Lebensversicherung'],
    betrag: 'Jahresprämie', stichtag: 'jahr',
    dimensionen: ['person'],
    hinweis: 'Die Prämienbescheinigung (Abzug) ist etwas anderes als die Leistungsabrechnung '
           + '(Krankheitskosten). Kassenübersichten enthalten oft beides – dann doppelt zuordnen.' },

  { id: 'schuldzinsen', seite: 3, sort: 60, gruppe: 'abzuege',
    label: 'Schuldzinsen',
    belege: ['Hypothekarzinsbescheinigung', 'Kreditzinsausweis', 'Zinsausweis Bank'],
    betrag: 'Zinsen im Steuerjahr', stichtag: 'jahr',
    dimensionen: ['objekt'],
    hinweis: 'Derselbe Ausweis nennt meist auch die Restschuld – die gehört zu den Schulden (Seite 4).' },

  { id: 'alimente_bezahlt', seite: 3, sort: 70, gruppe: 'abzuege',
    label: 'Bezahlte Unterhaltsbeiträge (Alimente)',
    belege: ['Scheidungsurteil', 'Zahlungsnachweis', 'Bankbelastung'],
    betrag: 'Jahresbetrag', stichtag: 'jahr',
    dimensionen: ['person'] },

  { id: 'kinderbetreuung', seite: 3, sort: 80, gruppe: 'abzuege',
    label: 'Kinderbetreuungskosten',
    belege: ['Kita-Rechnung', 'Tagesmutter', 'Hortrechnung'],
    betrag: 'Jahreskosten', stichtag: 'jahr' },

  { id: 'liegenschaftsunterhalt', seite: 3, sort: 90, gruppe: 'abzuege',
    label: 'Liegenschaftsunterhalt',
    belege: ['Handwerkerrechnung', 'Gebäudeversicherung', 'Kaminfeger', 'Heizkostenabrechnung',
             'Verwaltungsabrechnung', 'Serviceabonnement'],
    betrag: 'Rechnungsbetrag', stichtag: 'jahr',
    dimensionen: ['objekt'],
    pruefen: 'werterhaltend oder wertvermehrend',
    hinweis: 'Werterhaltend ist abzugsfähig, wertvermehrend nicht – das steht auf keiner Rechnung. '
           + 'Umbau- und Sanierungsprojekte immer zur Prüfung vorlegen, nie selber entscheiden. '
           + 'Effektive Summe je Objekt wird gebraucht, weil sie mit dem Pauschalabzug verglichen wird.' },

  { id: 'krankheitskosten', seite: 3, sort: 100, gruppe: 'abzuege',
    label: 'Krankheits- und Unfallkosten',
    belege: ['Arztrechnung', 'Zahnarztrechnung', 'Leistungsabrechnung Krankenkasse', 'Apothekenbeleg'],
    betrag: 'Selbst getragener Betrag', stichtag: 'jahr',
    dimensionen: ['person'],
    hinweis: 'Nur der selbst getragene Teil zählt – Kassenleistung von der Rechnung abziehen.' },

  { id: 'behinderungskosten', seite: 3, sort: 110, gruppe: 'abzuege',
    label: 'Behinderungsbedingte Kosten',
    belege: ['Pflegeheimrechnung', 'IV-Ausweis', 'Hilfsmittelrechnung'],
    betrag: 'Betrag', stichtag: 'jahr',
    dimensionen: ['person'] },

  { id: 'spenden', seite: 3, sort: 120, gruppe: 'abzuege',
    label: 'Freiwillige Zuwendungen / Spenden',
    belege: ['Spendenbescheinigung', 'Zuwendungsbestätigung', 'Einzahlungsschein Hilfswerk'],
    betrag: 'Jahresbetrag', stichtag: 'jahr',
    hinweis: 'Einzahlungsscheine sind oft blanko – der Betrag steht dann nur im Kontoauszug. '
           + 'Position zuordnen, Betrag offen lassen statt raten.' },

  { id: 'parteispenden', seite: 3, sort: 130, gruppe: 'abzuege',
    label: 'Zuwendungen an politische Parteien',
    belege: ['Spendenbescheinigung Partei'],
    betrag: 'Jahresbetrag', stichtag: 'jahr' },

  { id: 'uebrige_abzuege', seite: 3, sort: 150, gruppe: 'abzuege',
    label: 'Übrige Abzüge',
    belege: ['Vermögensverwaltungskosten', 'Depotgebühren'],
    betrag: 'Betrag', stichtag: 'jahr' },

  // ── Seite 4 · Vermögen ────────────────────────────────────────────────────
  { id: 'bankguthaben', seite: 4, sort: 10, gruppe: 'vermoegen',
    label: 'Bankguthaben und Wertschriften',
    belege: ['Steuerausweis Bank', 'Kontoauszug 31.12.', 'Depotauszug', 'Saldobescheinigung'],
    betrag: 'Bestand per 31.12.', stichtag: 'ende',
    dimensionen: ['konto', 'person'],
    hinweis: 'Je Konto/Depot eine eigene Zeile. Dasselbe Dokument liefert meist auch den Ertrag (Seite 2).' },

  { id: 'bargeld', seite: 4, sort: 20, gruppe: 'vermoegen',
    label: 'Bargeld, Edelmetalle, Kryptowährungen',
    belege: ['Depotauszug Edelmetalle', 'Krypto-Bestandsauszug'],
    betrag: 'Bestand per 31.12.', stichtag: 'ende' },

  { id: 'lebensversicherung', seite: 4, sort: 30, gruppe: 'vermoegen',
    label: 'Lebensversicherungen (Rückkaufswert)',
    belege: ['Rückkaufswertbescheinigung', 'Steuerbescheinigung Lebensversicherung'],
    betrag: 'Rückkaufswert per 31.12.', stichtag: 'ende',
    dimensionen: ['person'] },

  { id: 'fahrzeuge', seite: 4, sort: 40, gruppe: 'vermoegen',
    label: 'Fahrzeuge',
    belege: ['Kaufvertrag', 'Fahrzeugausweis', 'Eurotax-Bewertung'],
    betrag: 'Zeitwert', stichtag: 'ende' },

  { id: 'liegenschaften', seite: 4, sort: 50, gruppe: 'vermoegen',
    label: 'Liegenschaften',
    belege: ['Steuerwertverfügung', 'Amtliche Schätzung', 'Kaufvertrag', 'Grundbuchauszug'],
    betrag: 'Steuerwert', stichtag: 'ende',
    dimensionen: ['objekt'] },

  { id: 'geschaeftsvermoegen', seite: 4, sort: 60, gruppe: 'vermoegen',
    label: 'Geschäftsvermögen',
    belege: ['Bilanz', 'Jahresrechnung'],
    betrag: 'Eigenkapital per 31.12.', stichtag: 'ende',
    dimensionen: ['person'] },

  { id: 'uebriges_vermoegen', seite: 4, sort: 70, gruppe: 'vermoegen',
    label: 'Übrige Vermögenswerte (Beteiligungen, Darlehen, Erbanteile)',
    belege: ['Darlehensvertrag', 'Beteiligungsausweis', 'Erbteilungsvertrag', 'Sanierungsvereinbarung',
             'Kapitaleinzahlung'],
    betrag: 'Wert per 31.12.', stichtag: 'ende',
    dimensionen: ['person'] },

  { id: 'schulden', seite: 4, sort: 80, gruppe: 'vermoegen',
    label: 'Schulden',
    belege: ['Hypothekarausweis', 'Kreditausweis', 'Darlehensvertrag', 'Saldobescheinigung Schuld'],
    betrag: 'Restschuld per 31.12.', stichtag: 'ende',
    dimensionen: ['objekt'],
    hinweis: 'Derselbe Ausweis nennt meist auch die Zinsen – die gehören zu den Schuldzinsen (Seite 3).' },
];

// Belege, die zwar im Stapel liegen, aber nirgends hingehören. Landen in einem
// eigenen Bereich, damit nichts unbemerkt verschwindet – aussortiert wird von
// Hand, nie automatisch gelöscht.
export const AUSSORTIERT = {
  id: '_aussortiert',
  seite: 99,
  sort: 999,
  gruppe: 'aussortiert',
  label: 'Nicht zur Steuererklärung',
  belege: ['Werbung', 'Doppel', 'Privatpost', 'privater Konsum', 'unleserlich', 'leere Seite'],
  betrag: null,
  stichtag: null,
  hinweis: 'Rechnungen für privaten Konsum (Möbel, Geräte, Hobby) sind nicht abzugsfähig, '
         + 'auch wenn sie wie eine Handwerkerrechnung aussehen.',
};

// Ein Beleg kann zu mehreren Positionen gehören – der Bank-Steuerausweis nennt
// Ertrag, Bestand und oft auch Schuldzinsen. Diese Paare kennt die Erkennung,
// damit sie den Beleg mehrfach einordnet statt sich für eine Seite zu entscheiden.
export const MEHRFACH_ZUORDNUNG = [
  ['wertschriften_ertrag', 'bankguthaben'],
  ['schuldzinsen', 'schulden'],
  ['liegenschaft_ertrag', 'liegenschaften'],
  ['versicherungspraemien', 'krankheitskosten'],
];

export const KATALOG_NACH_ID = Object.fromEntries(
  [...KATALOG, AUSSORTIERT].map(p => [p.id, p])
);

/** Belege in die Reihenfolge der Steuererklärung bringen (Seite, dann Position). */
export function sortiereNachKatalog(belege, positionVon = b => b.positionId) {
  const rang = Object.fromEntries(
    [...KATALOG, AUSSORTIERT].map(p => [p.id, p.seite * 1000 + p.sort])
  );
  return [...belege].sort((a, b) => {
    const ra = rang[positionVon(a)] ?? Number.MAX_SAFE_INTEGER;
    const rb = rang[positionVon(b)] ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

/** Kompakte Positionsliste für den KI-Prompt (id · Seite · Label · typische Belege). */
export function katalogFuerPrompt() {
  return [...KATALOG, AUSSORTIERT]
    .map(p => {
      const teile = [p.id, `S${p.seite}`, p.label, p.belege.join(', ')];
      if (p.dimensionen) teile.push(`benötigt: ${p.dimensionen.join(' + ')}`);
      if (p.hinweis)     teile.push(`Hinweis: ${p.hinweis}`);
      return teile.join(' | ');
    })
    .join('\n');
}
