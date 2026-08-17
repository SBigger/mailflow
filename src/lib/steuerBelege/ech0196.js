/**
 * Parser für den eSteuerauszug nach eCH-0196.
 *
 * Der eSteuerauszug ist die beste Datenquelle im ganzen Dossier: Er kommt
 * strukturiert von der Bank, wird nie vom Steuerpflichtigen von Hand erfasst
 * und deckt das Wertschriftenverzeichnis ab — den aufwendigsten Teil jeder
 * nP-Deklaration.
 *
 * ⚠️ WICHTIGER VORBEHALT
 * Die eCH-0196-XSD konnte bisher nicht eingesehen werden (ech.ch ist aus der
 * Entwicklungsumgebung blockiert, Backlog V11/V1). Die Elementnamen unten
 * stammen aus dem Standarddokument und aus Open-Source-Referenzen
 * (BrunoEberhard/open-ech-taxstatement, vroonhof/opensteuerauszug), nicht aus
 * dem Schema selbst.
 *
 * Der Parser ist deshalb bewusst DEFENSIV gebaut:
 *   - namespace-agnostisch (localName statt qualifiziertem Namen)
 *   - jedes Feld über eine Liste von Kandidaten-Tags statt eines festen Pfads
 *   - unbekannte Elemente werden ignoriert, nicht als Fehler behandelt
 *   - alles Gefundene bekommt eine Confidence; nichts wird stillschweigend geraten
 *
 * Sobald ein echtes Muster-XML vorliegt, muss nur die FELD_KANDIDATEN-Tabelle
 * korrigiert werden — nicht die Logik.
 */

// ══════════════════════════════════════════════════════════════════════
// Feld-Kandidaten: zu verifizieren gegen ein echtes Muster
// ══════════════════════════════════════════════════════════════════════

const FELD_KANDIDATEN = {
  institut:       ["institution", "bank", "institutionName", "name"],
  kundenname:     ["client", "clientName", "owner", "name"],
  periodeVon:     ["periodFrom", "taxPeriodFrom", "dateFrom"],
  periodeBis:     ["periodTo", "taxPeriodTo", "dateTo"],
  steuerjahr:     ["taxPeriod", "period", "year"],

  kontoListe:     ["listOfBankAccounts", "bankAccounts", "accounts"],
  konto:          ["bankAccount", "account"],
  depotListe:     ["listOfSecurities", "securities", "depots"],
  depot:          ["depot", "securityDepot"],
  wertschrift:    ["security", "position"],

  iban:           ["iban", "bankAccountNumber", "accountNumber"],
  bezeichnung:    ["bankAccountName", "securityName", "name", "description"],
  valor:          ["valorNumber", "valorNr", "valor"],
  isin:           ["isin", "isinNumber"],
  waehrung:       ["currency", "bankAccountCurrency"],

  steuerwert:     ["taxValue", "balanceCurrency", "balance", "value"],
  bruttoertrag:   ["grossRevenueA", "grossRevenueB", "grossRevenue", "totalGrossRevenueA",
                   "totalGrossRevenueB", "revenue"],
  verrechnung:    ["withHoldingTaxClaim", "withholdingTaxClaim", "taxClaim"],
  schuldzins:     ["debitInterest", "interestDebit"],
};

// ══════════════════════════════════════════════════════════════════════
// XML-Hilfen (namespace-agnostisch)
// ══════════════════════════════════════════════════════════════════════

function localName(el) {
  return (el.localName || el.nodeName || "").replace(/^.*:/, "");
}

/** Alle direkten und indirekten Kinder, deren localName einem der Namen entspricht. */
function findAll(root, namen) {
  if (!root) return [];
  const gesucht = new Set(namen.map(n => n.toLowerCase()));
  const treffer = [];
  const stack = [root];
  while (stack.length) {
    const el = stack.pop();
    for (const kind of el.children || []) {
      if (gesucht.has(localName(kind).toLowerCase())) treffer.push(kind);
      stack.push(kind);
    }
  }
  return treffer;
}

/** Erster Treffer, sonst null. */
function findOne(root, namen) {
  return findAll(root, namen)[0] || null;
}

/** Textinhalt des ersten passenden Elements oder Attributs. */
function textVon(root, namen) {
  if (!root) return null;
  // Attribut hat Vorrang: eCH-Schemata legen Skalare oft als Attribute ab
  for (const n of namen) {
    const attr = root.getAttribute?.(n);
    if (attr != null && attr !== "") return attr.trim();
  }
  const el = findOne(root, namen);
  const txt = el?.textContent?.trim();
  return txt || null;
}

/** Zahl aus Text, tolerant gegenüber CH-Formatierung (1'234.50 / 1.234,50). */
export function parseBetrag(roh) {
  if (roh == null || roh === "") return null;
  if (typeof roh === "number") return Number.isFinite(roh) ? roh : null;
  let s = String(roh).trim().replace(/[^\d.,'\-]/g, "");
  if (!s) return null;
  s = s.replace(/'/g, "");
  // Wenn beide Trennzeichen vorkommen, ist das letzte das Dezimaltrennzeichen
  const letzterPunkt = s.lastIndexOf(".");
  const letztesKomma = s.lastIndexOf(",");
  if (letzterPunkt >= 0 && letztesKomma >= 0) {
    if (letztesKomma > letzterPunkt) s = s.replace(/\./g, "").replace(",", ".");
    else                             s = s.replace(/,/g, "");
  } else if (letztesKomma >= 0) {
    // Nur Komma: als Dezimaltrennzeichen lesen, wenn genau 1-2 Nachkommastellen
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function betragVon(root, namen) {
  return parseBetrag(textVon(root, namen));
}

// ══════════════════════════════════════════════════════════════════════
// Parser
// ══════════════════════════════════════════════════════════════════════

/**
 * Parst einen eSteuerauszug aus XML-Text.
 *
 * @param {string} xmlText
 * @returns {{
 *   ok: boolean,
 *   fehler?: string,
 *   institut: string|null,
 *   steuerjahr: number|null,
 *   konten: Array,
 *   wertschriften: Array,
 *   summen: { steuerwert: number, bruttoertrag: number, verrechnungssteuer: number },
 *   confidence: number,
 *   warnungen: string[]
 * }}
 */
export function parseESteuerauszug(xmlText) {
  const leer = {
    ok: false, institut: null, steuerjahr: null, konten: [], wertschriften: [],
    summen: { steuerwert: 0, bruttoertrag: 0, verrechnungssteuer: 0 },
    confidence: 0, warnungen: [],
  };

  if (!xmlText || typeof xmlText !== "string") {
    return { ...leer, fehler: "Kein XML-Inhalt" };
  }

  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, "application/xml");
  } catch (e) {
    return { ...leer, fehler: `XML nicht lesbar: ${e.message}` };
  }
  if (doc.querySelector("parsererror")) {
    return { ...leer, fehler: "XML nicht wohlgeformt" };
  }

  const root = doc.documentElement;
  if (!root) return { ...leer, fehler: "Kein Wurzelelement" };

  const warnungen = [];
  const wurzelName = localName(root).toLowerCase();
  if (!wurzelName.includes("taxstatement") && !wurzelName.includes("steuerauszug")) {
    warnungen.push(
      `Unerwartetes Wurzelelement «${localName(root)}» — als eCH-0196 behandelt, bitte prüfen.`
    );
  }

  const institut   = textVon(root, FELD_KANDIDATEN.institut);
  const jahrRoh    = textVon(root, FELD_KANDIDATEN.steuerjahr)
                  || textVon(root, FELD_KANDIDATEN.periodeBis);
  const steuerjahr = jahrRoh ? Number.parseInt(String(jahrRoh).slice(0, 4), 10) : null;

  // ─── Konten ──────────────────────────────────────────────────────
  const konten = findAll(root, FELD_KANDIDATEN.konto).map(el => ({
    iban:        textVon(el, FELD_KANDIDATEN.iban),
    bezeichnung: textVon(el, FELD_KANDIDATEN.bezeichnung),
    waehrung:    textVon(el, FELD_KANDIDATEN.waehrung) || "CHF",
    steuerwert:  betragVon(el, FELD_KANDIDATEN.steuerwert),
    ertrag:      betragVon(el, FELD_KANDIDATEN.bruttoertrag),
    verrechnungssteuer: betragVon(el, FELD_KANDIDATEN.verrechnung),
    schuldzins:  betragVon(el, FELD_KANDIDATEN.schuldzins),
  }));

  // ─── Wertschriften ───────────────────────────────────────────────
  const wertschriften = findAll(root, FELD_KANDIDATEN.wertschrift).map(el => ({
    bezeichnung: textVon(el, FELD_KANDIDATEN.bezeichnung),
    valor:       textVon(el, FELD_KANDIDATEN.valor),
    isin:        textVon(el, FELD_KANDIDATEN.isin),
    waehrung:    textVon(el, FELD_KANDIDATEN.waehrung) || "CHF",
    steuerwert:  betragVon(el, FELD_KANDIDATEN.steuerwert),
    ertrag:      betragVon(el, FELD_KANDIDATEN.bruttoertrag),
    verrechnungssteuer: betragVon(el, FELD_KANDIDATEN.verrechnung),
  }));

  const alle = [...konten, ...wertschriften];
  const summe = (feld) => alle.reduce((s, p) => s + (p[feld] || 0), 0);
  const summen = {
    steuerwert:         summe("steuerwert"),
    bruttoertrag:       summe("ertrag"),
    verrechnungssteuer: summe("verrechnungssteuer"),
  };

  // ─── Confidence ──────────────────────────────────────────────────
  // Ehrlich statt optimistisch: nur was tatsächlich gefunden wurde, zählt.
  let confidence = 0;
  if (wurzelName.includes("taxstatement")) confidence += 0.4;
  if (institut)                            confidence += 0.15;
  if (steuerjahr)                          confidence += 0.15;
  if (alle.length > 0)                     confidence += 0.2;
  if (summen.steuerwert > 0)               confidence += 0.1;
  confidence = Math.min(1, Number(confidence.toFixed(2)));

  if (alle.length === 0) {
    warnungen.push("Keine Konto- oder Wertschriftenpositionen gefunden — " +
                   "vermutlich weichen die Elementnamen ab (FELD_KANDIDATEN prüfen).");
  }

  return {
    ok: alle.length > 0,
    institut, steuerjahr, konten, wertschriften, summen, confidence, warnungen,
  };
}

/**
 * Wandelt ein Parse-Ergebnis in Positionen für steuer_positionen um.
 * Herkunft ist 'ech0196' — diese Werte sind belegt, nicht geraten.
 */
export function zuPositionen(ergebnis) {
  if (!ergebnis?.ok) return [];
  const positionen = [];

  const push = (pfad, bezeichnung, wert) => {
    if (wert == null || wert === 0) return;
    positionen.push({
      ech_pfad: pfad,
      bezeichnung,
      wert_num: Number(wert.toFixed(2)),
      waehrung: "CHF",
      herkunft: "ech0196",
      confidence: ergebnis.confidence,
    });
  };

  push("listOfSecurities.totalTaxValue",   "Steuerwert Wertschriften und Guthaben",
       ergebnis.summen.steuerwert);
  push("listOfSecurities.totalGrossRevenue", "Bruttoertrag Wertschriften",
       ergebnis.summen.bruttoertrag);
  push("listOfSecurities.withHoldingTaxClaim", "Verrechnungssteuer-Guthaben",
       ergebnis.summen.verrechnungssteuer);

  // Schuldzinsen gehören ins Schuldenverzeichnis, nicht ins Wertschriftenverzeichnis —
  // und werden dort brutto, getrennt von der Schuld selbst, ausgewiesen.
  const schuldzinsen = ergebnis.konten.reduce((s, k) => s + (k.schuldzins || 0), 0);
  push("listOfLiabilities.totalInterest", "Schuldzinsen", schuldzinsen);

  return positionen;
}
