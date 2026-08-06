/**
 * Hauptformular Steuererklärung natürliche Personen — Kanton St. Gallen.
 *
 * Der Katalog folgt dem Aufbau des Formulars über vier Seiten. Jede Position
 * trägt ihre Ziffer, ihre Bezeichnung und die Belegarten, die typischerweise
 * darauf einzahlen. Danach richtet sich die Zuweisung und die Sortierung des
 * Exports.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ⚠️  ZIFFERN SIND VORLÄUFIG
 *
 * Die Wegleitung zur Steuererklärung SG konnte bei der Umsetzung nicht
 * eingesehen werden — sg.ch ist aus der Entwicklungsumgebung blockiert.
 * Der Seitenaufbau (1 Personalien · 2 Einkünfte · 3 Abzüge · 4 Vermögen
 * und Ermittlung) entspricht dem Aufbau der Hauptformulare nach dem
 * einheitlichen Formularsatz der Schweizerischen Steuerkonferenz; die
 * konkreten Ziffern sind daran angelehnt und NICHT verifiziert.
 *
 * Zum Verifizieren: Wegleitung_NP_2025.pdf von sg.ch in docs/ ablegen,
 * dann Ziffern und Bezeichnungen hier abgleichen und `VERIFIZIERT` auf
 * true setzen. Der Export weist bis dahin sichtbar darauf hin.
 * ══════════════════════════════════════════════════════════════════════
 */

export const VERIFIZIERT = false;
export const FORMULAR = "Hauptformular nP · Kanton St. Gallen";

export const SEITEN = [
  { nr: 1, titel: "Personalien und Verhältnisse",
    beschreibung: "Angaben zur steuerpflichtigen Person, Familie, berufliche Stellung" },
  { nr: 2, titel: "Einkünfte",
    beschreibung: "Erwerb, Renten, Wertschriftenertrag, Liegenschaften, übrige Einkünfte" },
  { nr: 3, titel: "Abzüge",
    beschreibung: "Berufsauslagen, Vorsorge, Versicherungen, Schuldzinsen, Sozialabzüge" },
  { nr: 4, titel: "Vermögen und Ermittlung",
    beschreibung: "Wertschriften, Liegenschaften, Schulden, steuerbares Einkommen und Vermögen" },
];

/**
 * ziffer        Nummer auf dem Formular (vorläufig)
 * seite         1–4
 * label         Bezeichnung wie im Formular
 * belegarten    Schlüssel aus belegarten.js, die auf diese Position einzahlen
 * typ           'betrag' | 'text' — steuert die Darstellung
 * hinweis       fachlicher Hinweis fürs Review
 */
export const POSITIONEN = [
  // ── Seite 1 · Personalien ─────────────────────────────────────
  { ziffer: "1.1", seite: 1, typ: "text",   label: "Name und Vorname", belegarten: [] },
  { ziffer: "1.2", seite: 1, typ: "text",   label: "Zivilstand", belegarten: [] },
  { ziffer: "1.3", seite: 1, typ: "text",   label: "Konfession", belegarten: [] },
  { ziffer: "1.4", seite: 1, typ: "text",   label: "Beruf und Arbeitgeber", belegarten: ["lohnausweis"] },
  { ziffer: "1.5", seite: 1, typ: "text",   label: "Kinder im eigenen Haushalt",
    belegarten: ["kinderbetreuung"],
    hinweis: "Massgebend für Kinder- und Betreuungsabzüge auf Seite 3." },

  // ── Seite 2 · Einkünfte ───────────────────────────────────────
  { ziffer: "100", seite: 2, typ: "betrag", label: "Einkünfte aus unselbständiger Erwerbstätigkeit",
    belegarten: ["lohnausweis"],
    hinweis: "Nettolohn gemäss Lohnausweis, Ziffer 11. Haupterwerb." },
  { ziffer: "105", seite: 2, typ: "betrag", label: "Nebenerwerb",
    belegarten: ["lohnausweis"] },
  { ziffer: "110", seite: 2, typ: "betrag", label: "Einkünfte aus selbständiger Erwerbstätigkeit",
    belegarten: [] },
  { ziffer: "120", seite: 2, typ: "betrag", label: "Renten AHV / IV",
    belegarten: ["rente"],
    hinweis: "Voll steuerbar." },
  { ziffer: "125", seite: 2, typ: "betrag", label: "Renten aus beruflicher Vorsorge (BVG)",
    belegarten: ["rente"],
    hinweis: "Besteuerungsquote je nach Beginn und Finanzierung der Rente prüfen." },
  { ziffer: "130", seite: 2, typ: "betrag", label: "Erwerbsausfallentschädigungen",
    belegarten: [] },
  { ziffer: "140", seite: 2, typ: "betrag", label: "Wertschriftenertrag",
    belegarten: ["esteuerauszug", "kontoauszug", "beteiligung"],
    hinweis: "Bruttoertrag aus dem Wertschriftenverzeichnis, Abschnitte A und B getrennt." },
  { ziffer: "150", seite: 2, typ: "betrag", label: "Erträge aus Liegenschaften",
    belegarten: ["liegenschaft"],
    hinweis: "Eigenmietwert und Mietertrag." },
  { ziffer: "160", seite: 2, typ: "betrag", label: "Unterhaltsbeiträge (erhalten)",
    belegarten: ["alimente"] },
  { ziffer: "180", seite: 2, typ: "betrag", label: "Übrige Einkünfte",
    belegarten: [] },
  { ziffer: "199", seite: 2, typ: "betrag", label: "Total der Einkünfte",
    belegarten: [], summeVon: ["100","105","110","120","125","130","140","150","160","180"] },

  // ── Seite 3 · Abzüge ──────────────────────────────────────────
  { ziffer: "200", seite: 3, typ: "betrag", label: "Berufsauslagen unselbständige Erwerbstätigkeit",
    belegarten: ["berufsauslagen"],
    hinweis: "Fahrkosten, Auswärtsverpflegung, übrige Berufskosten. Kantonale Deckelung beachten." },
  { ziffer: "210", seite: 3, typ: "betrag", label: "Schuldzinsen",
    belegarten: ["schuldzins"],
    hinweis: "Brutto, getrennt von der Schuld selbst (siehe Ziffer 420)." },
  { ziffer: "220", seite: 3, typ: "betrag", label: "Unterhaltsbeiträge (bezahlt)",
    belegarten: ["alimente"] },
  { ziffer: "230", seite: 3, typ: "betrag", label: "Beiträge Säule 2 (Einkauf)",
    belegarten: ["pk_einkauf"] },
  { ziffer: "235", seite: 3, typ: "betrag", label: "Beiträge Säule 3a",
    belegarten: ["saeule3a"],
    hinweis: "Jahresmaximum je nach Anschluss an eine Vorsorgeeinrichtung." },
  { ziffer: "240", seite: 3, typ: "betrag", label: "Versicherungsprämien und Sparzinsen",
    belegarten: ["krankenkasse"],
    hinweis: "Pauschale bzw. effektive Prämien, kantonal begrenzt." },
  { ziffer: "250", seite: 3, typ: "betrag", label: "Weiterbildungs- und Umschulungskosten",
    belegarten: ["weiterbildung"],
    hinweis: "Nur berufsorientiert." },
  { ziffer: "255", seite: 3, typ: "betrag", label: "Kinderbetreuungskosten",
    belegarten: ["kinderbetreuung"] },
  { ziffer: "260", seite: 3, typ: "betrag", label: "Krankheits- und Unfallkosten",
    belegarten: ["krankheitskosten"],
    hinweis: "Nur der selbst getragene Teil über dem Selbstbehalt." },
  { ziffer: "265", seite: 3, typ: "betrag", label: "Behinderungsbedingte Kosten",
    belegarten: ["behinderung"] },
  { ziffer: "270", seite: 3, typ: "betrag", label: "Freiwillige Zuwendungen",
    belegarten: ["spende"],
    hinweis: "Nur an steuerbefreite Institutionen, mit Bescheinigung." },
  { ziffer: "280", seite: 3, typ: "betrag", label: "Übrige Abzüge",
    belegarten: [] },
  { ziffer: "290", seite: 3, typ: "betrag", label: "Sozialabzüge (Kinder, Unterstützung)",
    belegarten: [] },
  { ziffer: "299", seite: 3, typ: "betrag", label: "Total der Abzüge",
    belegarten: [], summeVon: ["200","210","220","230","235","240","250","255","260","265","270","280","290"] },

  // ── Seite 4 · Vermögen und Ermittlung ─────────────────────────
  { ziffer: "300", seite: 4, typ: "betrag", label: "Steuerbares Einkommen",
    belegarten: [], hinweis: "Total Einkünfte (199) abzüglich Total Abzüge (299)." },
  { ziffer: "400", seite: 4, typ: "betrag", label: "Wertschriften und Guthaben",
    belegarten: ["esteuerauszug", "kontoauszug"],
    hinweis: "Steuerwert per 31.12. aus dem Wertschriftenverzeichnis." },
  { ziffer: "405", seite: 4, typ: "betrag", label: "Bargeld, Gold, Edelmetalle",
    belegarten: [] },
  { ziffer: "410", seite: 4, typ: "betrag", label: "Lebensversicherungen (Rückkaufswert)",
    belegarten: [] },
  { ziffer: "415", seite: 4, typ: "betrag", label: "Liegenschaften (Steuerwert)",
    belegarten: ["liegenschaft"] },
  { ziffer: "418", seite: 4, typ: "betrag", label: "Geschäftsvermögen und Beteiligungen",
    belegarten: ["beteiligung"] },
  { ziffer: "420", seite: 4, typ: "betrag", label: "Schulden",
    belegarten: ["schuldzins"],
    hinweis: "Bruttodarstellung — Schulden und Schuldzinsen werden getrennt ausgewiesen." },
  { ziffer: "430", seite: 4, typ: "betrag", label: "Sozialabzug vom Vermögen",
    belegarten: [] },
  { ziffer: "499", seite: 4, typ: "betrag", label: "Steuerbares Vermögen",
    belegarten: [], summeVon: ["400","405","410","415","418"] },
];

export const POSITION_BY_ZIFFER = Object.fromEntries(POSITIONEN.map(p => [p.ziffer, p]));

/** Positionen einer Formularseite, in Formularreihenfolge. */
export function positionenDerSeite(seite) {
  return POSITIONEN.filter(p => p.seite === seite);
}

/**
 * Vorschlag: auf welche Positionen zahlt eine Belegart ein?
 * Mehrere Treffer sind normal — ein eSteuerauszug liefert Ertrag (140)
 * und Steuerwert (400).
 */
export function positionenFuerBelegart(belegart) {
  if (!belegart) return [];
  return POSITIONEN.filter(p => p.belegarten.includes(belegart));
}

/** Sortierschlüssel: erst Seite, dann Ziffer numerisch, Unterziffern korrekt. */
export function sortSchluessel(position) {
  const [haupt, unter = "0"] = String(position.ziffer).split(".");
  return position.seite * 1e6 + parseInt(haupt, 10) * 1000 + parseInt(unter, 10);
}

/** Positionen sortiert wie auf dem Formular. */
export function sortiert(liste) {
  return [...liste].sort((a, b) => {
    const pa = POSITION_BY_ZIFFER[a.ziffer], pb = POSITION_BY_ZIFFER[b.ziffer];
    if (!pa || !pb) return 0;
    return sortSchluessel(pa) - sortSchluessel(pb);
  });
}

/** Errechnet die Summenpositionen aus den zugewiesenen Beträgen. */
export function summenBerechnen(betraegeProZiffer) {
  const ergebnis = { ...betraegeProZiffer };
  for (const p of POSITIONEN) {
    if (!p.summeVon) continue;
    ergebnis[p.ziffer] = p.summeVon.reduce((s, z) => s + (ergebnis[z] || 0), 0);
  }
  // Steuerbares Einkommen: Einkünfte abzüglich Abzüge
  if (ergebnis["199"] != null || ergebnis["299"] != null) {
    ergebnis["300"] = (ergebnis["199"] || 0) - (ergebnis["299"] || 0);
  }
  // Steuerbares Vermögen: Aktiven abzüglich Schulden und Sozialabzug
  if (ergebnis["499"] != null) {
    ergebnis["499"] = ergebnis["499"] - (ergebnis["420"] || 0) - (ergebnis["430"] || 0);
  }
  return ergebnis;
}
