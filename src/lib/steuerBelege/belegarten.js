/**
 * Belegarten-Katalog für die Steuerdeklaration natürlicher Personen.
 *
 * Eine Zeile pro Belegart mit allem, was die Triage und das Mapping brauchen:
 * Erkennungsmuster, bevorzugte Parse-Methode und vorläufiges eCH-0119-Ziel.
 *
 * ⚠️ Die ech_pfad-Werte sind VORLÄUFIG. Die eCH-0119-XSD konnte noch nicht
 * eingesehen werden (Backlog V1 in docs/recherche-und-architektur.md).
 * Die Elementnamen stammen aus dem Standarddokument, die Zuordnung ist begründet,
 * aber nicht verifiziert. Vor dem XML-Export gegen die XSD prüfen.
 *
 * Konzept: docs/recherche-und-architektur.md §8a
 */

export const RELEVANZ = {
  RELEVANT:       "relevant",
  NICHT_RELEVANT: "nicht_relevant",
  UNKLAR:         "unklar",
};

/**
 * keywords  – Treffer im normalisierten Belegtext, jeder Treffer gibt Punkte
 * stark     – ein Treffer hier allein reicht für hohe Confidence
 * parse     – bevorzugte Parse-Methode; 'ocr' ist der Rückfall
 * ech_pfad  – vorläufiges Zielelement im eCH-0119-XML
 */
export const BELEGARTEN = [
  {
    key: "lohnausweis",
    label: "Lohnausweis",
    parse: "ech0270",
    ech_pfad: "mainForm.income.employment",
    stark: ["lohnausweis", "certificat de salaire"],
    keywords: ["bruttolohn", "ahv", "alv", "nbuv", "quellensteuer", "arbeitgeber",
               "beitraege bvg", "lohnausweis"],
  },
  {
    key: "esteuerauszug",
    label: "eSteuerauszug",
    parse: "ech0196",
    ech_pfad: "listOfSecurities",
    stark: ["esteuerauszug", "e-steuerauszug", "steuerauszug"],
    keywords: ["wertschriftenverzeichnis", "depot", "verrechnungssteuer",
               "bruttoertrag", "steuerwert", "kursliste"],
  },
  {
    key: "kontoauszug",
    label: "Kontoauszug / Saldobestätigung",
    parse: "ocr",
    ech_pfad: "listOfSecurities",
    stark: ["saldobestaetigung", "saldobescheinigung"],
    // «iban» war hier und steht auf jeder Schweizer Rechnung.
    keywords: ["kontoauszug", "saldo per", "zinsertrag", "kontostand", "privatkonto", "sparkonto"],
  },
  {
    key: "schuldzins",
    label: "Schuld- / Hypothekarausweis",
    parse: "ocr",
    ech_pfad: "listOfLiabilities",
    stark: ["hypothekarausweis", "zinsausweis", "schuldenausweis"],
    keywords: ["hypothek", "darlehen", "schuldzins", "restschuld", "zinssatz"],
  },
  {
    key: "saeule3a",
    label: "Säule 3a",
    parse: "ocr",
    ech_pfad: "mainForm.deduction.pillar3a",
    stark: ["saeule 3a", "saule 3a", "3a-bescheinigung", "vorsorgebescheinigung"],
    // «einzahlung» war hier und stand auf jedem Einzahlungsschein — damit wurden
    // Spenden, Architekten- und Versicherungsrechnungen zu Saeule-3a-Belegen.
    keywords: ["gebundene vorsorge", "vorsorgestiftung", "bvg 3a", "freizuegigkeit"],
  },
  {
    key: "pk_einkauf",
    label: "Pensionskassen-Einkauf",
    parse: "ocr",
    ech_pfad: "mainForm.deduction.pensionPurchase",
    stark: ["einkauf pensionskasse", "einkaufsbestaetigung"],
    keywords: ["pensionskasse", "vorsorgeeinrichtung", "einkaufssumme", "bvg"],
  },
  {
    key: "krankenkasse",
    label: "Krankenkassen-Bescheinigung",
    parse: "ech0275",
    ech_pfad: "insurancePremiums",
    stark: ["praemienbescheinigung", "steuerbescheinigung krankenkasse"],
    keywords: ["krankenkasse", "praemien", "franchise", "selbstbehalt",
               "grundversicherung", "zusatzversicherung"],
  },
  {
    key: "krankheitskosten",
    label: "Krankheits- / Unfallkosten",
    parse: "ocr",
    ech_pfad: "diseaseAndAccidentExpenses",
    stark: [],
    keywords: ["arztrechnung", "zahnarzt", "spital", "apotheke", "therapie",
               "selbst getragen", "rueckerstattung"],
  },
  {
    key: "behinderung",
    label: "Behinderungsbedingte Kosten",
    parse: "ocr",
    ech_pfad: "handicapExpenses",
    stark: ["behinderungsbedingte kosten"],
    keywords: ["invalidenausweis", "hilflosenentschaedigung", "behinderung"],
  },
  {
    key: "weiterbildung",
    label: "Weiterbildung",
    parse: "ocr",
    ech_pfad: "jobOrientedFurtherEducationCost",
    stark: ["kursbestaetigung", "weiterbildungsbestaetigung"],
    keywords: ["weiterbildung", "kurskosten", "lehrgang", "seminar", "diplom",
               "studiengebuehr"],
  },
  {
    key: "berufsauslagen",
    label: "Berufsauslagen / Arbeitsweg",
    parse: "ocr",
    ech_pfad: "jobExpenses",
    stark: [],
    keywords: ["generalabonnement", "ga sbb", "streckenabo", "verbundabo",
               "arbeitsweg", "auswaertsverpflegung", "fahrkosten"],
  },
  {
    key: "kinderbetreuung",
    label: "Kinderbetreuung",
    parse: "ocr",
    ech_pfad: "mainForm.deduction.childCare",
    stark: ["betreuungsgutschrift", "kita-rechnung"],
    keywords: ["kinderkrippe", "kita", "hort", "tagesmutter", "betreuung",
               "mittagstisch"],
  },
  {
    key: "spende",
    label: "Spendenbescheinigung",
    parse: "ocr",
    ech_pfad: "mainForm.deduction.donation",
    stark: ["spendenbescheinigung", "zuwendungsbestaetigung"],
    keywords: ["spende", "gemeinnuetzig", "steuerbefreit", "zuwendung"],
  },
  {
    key: "alimente",
    label: "Alimente / Unterhaltsbeiträge",
    parse: "ocr",
    ech_pfad: "mainForm.deduction.alimony",
    stark: ["unterhaltsbeitraege", "scheidungsurteil"],
    keywords: ["alimente", "unterhalt", "trennungsvereinbarung"],
  },
  {
    key: "rente",
    label: "Renten (AHV/IV/BVG)",
    parse: "ocr",
    ech_pfad: "mainForm.income.pension",
    stark: ["rentenbescheinigung", "rentenausweis"],
    keywords: ["ahv-rente", "iv-rente", "bvg-rente", "leibrente", "ausgleichskasse"],
  },
  {
    key: "liegenschaft",
    label: "Liegenschaft",
    parse: "ocr",
    ech_pfad: "listOfRealEstate",
    stark: ["eigenmietwert", "liegenschaftenschatzung"],
    keywords: ["liegenschaft", "grundstueck", "mietertrag", "unterhalt",
               "steuerwert", "amtlicher wert"],
  },
  {
    key: "beteiligung",
    label: "Qualifizierte Beteiligung",
    parse: "ocr",
    ech_pfad: "qualifiedInvestmentsPrivate",
    stark: ["qualifizierte beteiligung"],
    keywords: ["beteiligung", "dividende", "stammanteil", "aktienkapital"],
  },
  {
    key: "veranlagung_vorjahr",
    label: "Vorjahres-Veranlagung",
    parse: "ocr",
    ech_pfad: null,              // Prüfgrösse, kein Zielfeld
    // «schlussrechnung» stand hier als starkes Signal und ist doch ein normales
    // Rechnungswort — eine Kaminfegerrechnung wurde damit zur Veranlagung.
    stark: ["veranlagungsverfuegung", "schlussrechnung staats- und gemeindesteuern",
            "schlussrechnung staatssteuer"],
    keywords: ["veranlagung", "steuerbares einkommen", "steuerbares vermoegen",
               "steueramt", "einsprachefrist"],
  },

  // ── Ergaenzt nach dem ersten Probelauf an einem echten Stapel ────────────
  // Diese vier Arten fehlten und wurden dadurch zwangslaeufig falsch
  // einsortiert — das Zugangsdatenschreiben zum Beispiel als Lohnausweis,
  // weil darauf eine AHV-Nummer steht.
  {
    key: "steuerformular",
    label: "Steuerformular / Zugangsdaten",
    parse: "ocr",
    ech_pfad: null,
    stark: ["zugangsdaten", "zugangscode", "online-steuererklaerung", "steuererklaerung 20"],
    keywords: ["ahvn13", "pid", "einreichungsfrist", "privatetax", "steuersoftware",
               "kantonales steueramt"],
  },
  {
    key: "liegenschaftsunterhalt",
    label: "Liegenschaftsunterhalt",
    parse: "ocr",
    ech_pfad: "listOfRealEstate",
    // Der Absender traegt hier die Information, nicht der Rechnungstext:
    // wer eine Gebaeudeversicherung oder einen Kaminfeger im Briefkopf hat,
    // schickt eine Unterhaltsrechnung.
    stark: ["gebaeudeversicherung", "kaminfeger", "feuerungskontrolle",
            "liegenschaftenunterhalt", "unterhaltskosten"],
    keywords: ["architektur", "bauherr", "umbau", "sanierung", "handwerker", "installation",
               "heizung", "sanitaer", "reinigung", "hauswartung", "serviceabonnement",
               "nebenkostenabrechnung"],
  },
  {
    key: "arbeitspapier",
    label: "Arbeitspapier (keine Beilage)",
    parse: "ocr",
    ech_pfad: null,
    // Der eigene Firmenname taugt NICHT als Merkmal: Artis steht als
    // Zahlungsauftraggeber auf den Kontoauszuegen der Mandanten und machte
    // im Probelauf einen Bankauszug zum Arbeitspapier.
    stark: ["besprechungsnotiz", "berechnung zins", "zins- und kapitalausweis"],
    keywords: ["pendenzen", "checkliste", "hilfsblatt", "aufstellung treuhaender", "notiz"],
  },
  {
    key: "zahlungsauftrag",
    label: "Zahlungsauftrag / Kapitaleinlage",
    parse: "ocr",
    ech_pfad: null,
    stark: ["inlandzahlung", "zahlungsauftrag", "vergütungsauftrag", "verguetungsauftrag"],
    keywords: ["beguenstigter", "kapitaleinlage", "aktienkapital", "einzahlung kapital"],
  },
];

/** Belegarten ohne Steuerbezug — erkannt, archiviert, aber nicht deklariert. */
export const NICHT_RELEVANT_MUSTER = [
  { key: "werbung",      keywords: ["werbung", "newsletter", "unverbindlich", "jetzt profitieren"] },
  { key: "mahnung",      keywords: ["mahnung", "zahlungserinnerung"] },
  { key: "privatbeleg",  keywords: ["quittung", "kassenbon", "restaurant", "tankstelle"] },
];

export const BELEGART_BY_KEY = Object.fromEntries(BELEGARTEN.map(b => [b.key, b]));

/** Zielelement im eCH-0119-XML für eine Belegart (vorläufig, siehe Kopfkommentar). */
export function echPfadFuer(belegartKey) {
  return BELEGART_BY_KEY[belegartKey]?.ech_pfad ?? null;
}
